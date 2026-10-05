// ผู้ดูแล › ตั้งค่า › บัญชีเจ้าหน้าที่ (ตาราง staff_roster)
// ความปลอดภัยจริงอยู่ที่ RLS + trigger ในฐานข้อมูล (เช่น ห้ามลดสิทธิ์ตัวเอง, ต้องเหลือผู้ดูแล ≥ 1 คน)
import { sb } from '../supabase.js?v=4.4';
import { $, esc, initials, toast, errText, busy } from '../util.js?v=4.4';
import { auth } from '../auth.js?v=4.4';
import { loadUnits, unitName } from '../data.js?v=4.4';
import { initRequestsAdmin } from './staff-request.js?v=4.4';
import { refreshAdminBadges } from './admin.js?v=4.4';

let roster = [], loggedIn = new Set(), editing = null, filter = 'all', bound = false;

export async function initRoster() {
  const units = await loadUnits();
  if (!bound) { bound = true; bind(units); }
  await Promise.all([reload(), initRequestsAdmin(() => { reload(); refreshAdminBadges(); })]);
}

function bind(units) {
  $('#rfUnit').innerHTML = units.map((u) => `<option value="${u.id}">รพ.สต. ${esc(u.name)}</option>`).join('');
  $('#rfRole').addEventListener('change', syncRole);
  $('#rfCancel').addEventListener('click', resetForm);
  $('#rosterForm').addEventListener('submit', save);
  $('#rosterFilter').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; filter = b.dataset.f; render(); });
  $('#rosterList').addEventListener('click', onListClick);
  syncRole();
}

function syncRole() { $('#rfUnitWrap').hidden = $('#rfRole').value === 'admin'; }

async function reload() {
  $('#rosterList').innerHTML = '<div class="skeleton" style="margin:12px 0"></div><div class="skeleton" style="width:70%"></div>';
  const [r, p] = await Promise.all([
    sb.from('staff_roster').select('email,full_name,role,unit_id,phone,position,active,created_at').order('role').order('unit_id').order('full_name'),
    sb.from('profiles').select('email'),
  ]);
  if (r.error) { $('#rosterList').innerHTML = `<p class="empty">โหลดรายชื่อไม่สำเร็จ: ${esc(errText(r.error))}</p>`; return; }
  roster = r.data;
  loggedIn = new Set((p.data || []).map((x) => x.email));
  render();
}

function render() {
  const counts = { all: roster.length, admin: roster.filter((x) => x.role === 'admin').length };
  const units = [...new Set(roster.filter((x) => x.role === 'staff').map((x) => x.unit_id))].sort((a, b) => a - b);
  $('#rosterFilter').innerHTML = [`<button type="button" data-f="all" aria-current="${filter === 'all'}">ทั้งหมด (${counts.all})</button>`,
    `<button type="button" data-f="admin" aria-current="${filter === 'admin'}">ผู้ดูแล (${counts.admin})</button>`]
    .concat(units.map((u) => `<button type="button" data-f="${u}" aria-current="${filter === String(u)}">${esc(unitName(u))} (${roster.filter((x) => x.unit_id === u && x.role === 'staff').length})</button>`)).join('');
  $('#rosterCount').textContent = `(${roster.length})`;
  const list = roster.filter((x) => filter === 'all' || (filter === 'admin' ? x.role === 'admin' : x.role === 'staff' && String(x.unit_id) === filter));
  const me = auth.profile?.email;
  $('#rosterList').innerHTML = list.length ? list.map((x) => {
    const self = x.email === me;
    return `<div class="roster-row"><span class="avatar">${esc(initials(x.full_name))}</span>`
      + `<div class="l"><b>${esc(x.full_name)}${self ? ' <span class="small muted">(คุณ)</span>' : ''}</b><span class="small muted">${x.position ? esc(x.position) + ' · ' : ''}${esc(x.email)}${x.phone ? ' · ' + esc(x.phone) : ''}</span>`
      + `<div class="meta"><span class="chip c-role">${x.role === 'admin' ? 'ผู้ดูแลระบบ' : 'รพ.สต. ' + esc(unitName(x.unit_id))}</span>`
      + `<span class="chip ${x.active ? 'c-on' : 'c-off'}">${x.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span>`
      + `<span class="chip c-off">${loggedIn.has(x.email) ? 'เคยเข้าสู่ระบบแล้ว' : 'ยังไม่เคยเข้าสู่ระบบ'}</span></div></div>`
      + `<div class="actions"><button type="button" class="btn btn-o btn-sm" data-edit="${esc(x.email)}">แก้ไข</button>`
      + (self ? '' : `<button type="button" class="btn btn-o btn-sm" data-toggle="${esc(x.email)}">${x.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button><button type="button" class="btn btn-no btn-sm" data-del="${esc(x.email)}">ลบ</button>`)
      + '</div></div>';
  }).join('') : '<p class="empty">ยังไม่มีรายชื่อในกลุ่มนี้ · เพิ่มได้จากแบบฟอร์มด้านบน</p>';
}

function msg(text, ok) { const m = $('#rfMsg'); m.style.color = ok ? 'var(--success)' : 'var(--error)'; m.textContent = text; }

function resetForm() {
  editing = null;
  $('#rosterForm').reset();
  $('#rfEmail').readOnly = false;
  $('#rfActiveWrap').hidden = true;
  $('#rosterFormTitle').textContent = 'เพิ่มบัญชีเจ้าหน้าที่';
  $('#rfSubmit').textContent = 'เพิ่มบัญชี';
  $('#rfCancel').hidden = true;
  ['#rfEmail', '#rfName'].forEach((s) => $(s).removeAttribute('aria-invalid'));
  syncRole(); msg('');
}

function startEdit(email) {
  const x = roster.find((r) => r.email === email); if (!x) return;
  editing = email;
  $('#rfEmail').value = x.email; $('#rfEmail').readOnly = true;
  $('#rfName').value = x.full_name; $('#rfRole').value = x.role;
  if (x.unit_id != null) $('#rfUnit').value = String(x.unit_id);
  $('#rfPhone').value = x.phone || ''; $('#rfPos').value = x.position || '';
  $('#rfActive').value = String(x.active);
  const self = x.email === auth.profile?.email;
  $('#rfActiveWrap').hidden = self; $('#rfRole').disabled = self;
  $('#rosterFormTitle').textContent = 'แก้ไขบัญชี · ' + x.full_name;
  $('#rfSubmit').textContent = 'บันทึกการแก้ไข';
  $('#rfCancel').hidden = false;
  syncRole(); msg(self ? 'บัญชีของคุณเอง: เปลี่ยนบทบาทหรือปิดใช้งานเองไม่ได้' : '', true);
  $('#rosterForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#rfName').focus({ preventScroll: true });
}

async function save(e) {
  e.preventDefault();
  const email = $('#rfEmail').value.trim().toLowerCase(), name = $('#rfName').value.trim();
  const role = $('#rfRole').value, phone = $('#rfPhone').value.trim() || null;
  const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  $('#rfEmail').setAttribute('aria-invalid', okEmail ? 'false' : 'true');
  $('#rfName').setAttribute('aria-invalid', name ? 'false' : 'true');
  if (!okEmail) { msg('กรุณากรอกอีเมลให้ถูกต้อง'); $('#rfEmail').focus(); return; }
  if (!name) { msg('กรุณากรอกชื่อ-นามสกุล'); $('#rfName').focus(); return; }
  const row = { full_name: name, role, unit_id: role === 'admin' ? null : +$('#rfUnit').value, phone, position: $('#rfPos').value.trim() || null };
  const btn = $('#rfSubmit');
  busy(btn, true, 'กำลังบันทึก…');
  let res;
  if (editing) {
    if (!$('#rfActiveWrap').hidden) row.active = $('#rfActive').value === 'true';
    res = await sb.from('staff_roster').update(row).eq('email', editing).select();
  } else {
    res = await sb.from('staff_roster').insert({ email, ...row }).select();
  }
  busy(btn, false);
  $('#rfRole').disabled = false;
  if (res.error) { msg(/duplicate|already exists/i.test(res.error.message) ? 'อีเมลนี้มีอยู่ในรายชื่อแล้ว — กด "แก้ไข" ที่รายชื่อด้านล่างแทน' : errText(res.error)); return; }
  if (!res.data?.length) { msg('บันทึกไม่สำเร็จ (ไม่มีสิทธิ์)'); return; }
  toast(editing ? 'บันทึกการแก้ไขแล้ว' : `เพิ่ม ${name} แล้ว — เข้าสู่ระบบด้วย ${email} ได้ทันที`);
  resetForm();
  reload();
}

async function onListClick(e) {
  const ed = e.target.closest('[data-edit]'); if (ed) { startEdit(ed.dataset.edit); return; }
  const tg = e.target.closest('[data-toggle]');
  if (tg) {
    const x = roster.find((r) => r.email === tg.dataset.toggle); if (!x) return;
    if (x.active && !confirm(`ปิดใช้งานบัญชี ${x.full_name}?\nเขาจะยังเข้าเว็บได้ แต่ในฐานะประชาชนทั่วไป`)) return;
    tg.disabled = true;
    const { error } = await sb.from('staff_roster').update({ active: !x.active }).eq('email', x.email);
    if (error) { tg.disabled = false; toast(errText(error), 'err'); return; }
    toast(x.active ? 'ปิดใช้งานแล้ว' : 'เปิดใช้งานแล้ว'); reload(); return;
  }
  const dl = e.target.closest('[data-del]');
  if (dl) {
    const x = roster.find((r) => r.email === dl.dataset.del); if (!x) return;
    if (!confirm(`ลบ ${x.full_name} (${x.email}) ออกจากรายชื่อ?\nถ้าเคยเข้าสู่ระบบแล้ว บัญชีจะกลายเป็นประชาชนทั่วไป`)) return;
    dl.disabled = true;
    const { error } = await sb.from('staff_roster').delete().eq('email', x.email);
    if (error) { dl.disabled = false; toast(errText(error), 'err'); return; }
    if (editing === x.email) resetForm();
    toast('ลบออกจากรายชื่อแล้ว'); reload();
  }
}
