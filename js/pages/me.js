// ประชาชน (#/me): ข้อมูลส่วนตัว + แชทสอบถามเจ้าหน้าที่ รพ.สต. / ห้องยา รพ. แบบ real-time
// ต้องมีเบอร์โทรก่อนเริ่มแชท (RLS บังคับ) เพื่อให้เจ้าหน้าที่ติดต่อกลับได้
// ยังไม่เข้าสู่ระบบ (guest): คุยได้ผ่าน rpc guest_chat_* (30_guest_chat.sql) · ใส่ชื่อเล่น · ข้อความละ ≤ 15 ตัวอักษร วันละ 20 ข้อความ
//   ส่งรูปไม่ได้ · ห้องจำด้วยรหัสเครื่อง (deviceToken) · อ่านข้อความใหม่ทุก 10 วินาที (ไม่มี real-time สำหรับผู้ไม่ได้ล็อกอิน)
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, errText, busy, deviceToken } from '../util.js?v=4.4';
import { auth } from '../auth.js?v=4.4';
import { loadUnits } from '../data.js?v=4.4';
import { PHONE_RE, saveMyProfile } from '../profile.js?v=4.4';
import { initStaffRequest } from './staff-request.js?v=4.4';
import { targetName, loadMessages, sendMessage, renderLog, openRoom, markRead, refreshMsgBadge, onConversationChange, chatPicker } from './chat.js?v=4.4';

let convs = [], target, msgs = [], closeRoom = null, bound = false, units = [], pick = null, guest = false;
const NONE = '';   // ยังไม่ได้เลือก รพ.สต. (null = ห้องยา รพ. เดิม — ปิดรับห้องใหม่แล้ว เปิดอ่านได้ถ้าเคยคุย)
const GUEST_MAX = 15, NAME_KEY = 'pcps_guest_name', POLL_MS = 10_000;
const chars = (t) => [...t].length;   // นับแบบเดียวกับ char_length ของ Postgres

export async function showMe(openRequest = false) {
  units = await loadUnits();
  guest = !auth.session;
  $('[data-view="me"]').classList.toggle('guest', guest);
  if (!bound) { bound = true; bind(); }
  $('#meAttach').hidden = guest;
  $('#meInput').placeholder = guest ? `พิมพ์สั้น ๆ ไม่เกิน ${GUEST_MAX} ตัวอักษร` : 'พิมพ์ข้อความ…';
  $('#meChatHint').textContent = '';
  if (guest) {
    $('#meRoleLbl').textContent = 'ประชาชนทั่วไป · ยังไม่ได้เข้าสู่ระบบ';
    $('#meHello').textContent = 'สอบถามเรื่องยา';
    try { $('#meGuestName').value = localStorage.getItem(NAME_KEY) || ''; } catch { /* โหมดส่วนตัว */ }
    $('#meInput').disabled = false; $('#meSend').disabled = false; $('#meFile').disabled = true;
  } else {
    $('#meRoleLbl').textContent = 'ประชาชนทั่วไป';
    $('#meHello').textContent = 'สวัสดี ' + (auth.profile.full_name || '');
    fillProfile();
  }
  await loadConvs();
  if (target === undefined) target = convs.find((c) => c.target_unit != null)?.target_unit ?? (guest ? null : auth.profile.home_unit_id) ?? NONE;   // ห้องล่าสุด → หน่วยใกล้บ้าน → ให้เลือก
  renderTargets();
  openTarget(target);
  if (!guest) initStaffRequest(openRequest);
}

/** ออกจากหน้า → ปิดการฟังข้อความ */
export function leaveMe() { closeRoom?.(); closeRoom = null; }

/* ---------- ข้อมูลส่วนตัว ---------- */
function fillProfile() {
  const p = auth.profile;
  $('#meUnit').innerHTML = '<option value="">— เลือก —</option>' + units.map((u) => `<option value="${u.id}">รพ.สต. ${esc(u.name)}</option>`).join('');
  $('#meName').value = p.full_name || ''; $('#meEmail').value = p.email; $('#mePhone').value = p.phone || '';
  $('#meAddr').value = p.address || ''; $('#meUnit').value = p.home_unit_id ?? '';
  syncHint();
}

async function saveProfile(e) {
  e.preventDefault();
  const m = $('#meMsg'), say = (t, ok) => { m.style.color = ok ? 'var(--success)' : 'var(--error)'; m.textContent = t; };
  const full_name = $('#meName').value.trim(), phone = $('#mePhone').value.trim();
  $('#meName').removeAttribute('aria-invalid'); $('#mePhone').removeAttribute('aria-invalid');
  if (!full_name) { say('กรุณากรอกชื่อ-นามสกุล'); $('#meName').setAttribute('aria-invalid', 'true'); $('#meName').focus(); return; }
  if (!PHONE_RE.test(phone)) { say('เบอร์โทรไม่ถูกต้อง (ตัวเลข 9–10 หลัก เช่น 0812345678)'); $('#mePhone').setAttribute('aria-invalid', 'true'); $('#mePhone').focus(); return; }
  const row = { full_name, phone, address: $('#meAddr').value.trim() || null, home_unit_id: $('#meUnit').value === '' ? null : +$('#meUnit').value };
  const btn = $('#meSave'); busy(btn, true, 'กำลังบันทึก…');
  const error = await saveMyProfile(row);
  busy(btn, false);
  if (error) { say(errText(error)); return; }
  say('บันทึกแล้ว', true);
}
// แก้จากหน้าต่างข้อมูลส่วนตัว (ชื่อบนแถบเมนู) หรือจากฟอร์มในหน้านี้ → เติมฟอร์ม/คำทักทายใหม่
window.addEventListener('pcps:profile', () => { if (!bound) return; $('#meHello').textContent = 'สวัสดี ' + (auth.profile.full_name || ''); if (units.length) fillProfile(); });

function syncHint() {
  const ok = !!auth.profile.phone;
  $('#meChatHint').textContent = ok ? '' : 'กรอกชื่อและเบอร์โทรในข้อมูลส่วนตัวก่อน เพื่อให้เจ้าหน้าที่ติดต่อกลับได้';
  $('#meInput').disabled = !ok; $('#meSend').disabled = !ok; $('#meFile').disabled = !ok; $('#meAttach').classList.toggle('is-disabled', !ok);
  $('[data-view="me"] .citizen-split').classList.toggle('ready', ok);   // มือถือ: กรอกข้อมูลครบแล้ว ให้แชทขึ้นก่อน
}

/* ---------- แชท ---------- */
async function loadConvs() {
  if (guest) {
    const { data } = await sb.rpc('guest_chat_list', { p_token: deviceToken() });
    convs = (data || []).map((c) => ({ target_unit: c.target_unit ?? null, unread_citizen: c.unread || 0, last_message_at: c.last_message_at }))
      .sort((a, b) => String(b.last_message_at || '').localeCompare(String(a.last_message_at || '')));
    return;
  }
  const { data } = await sb.from('conversations').select('id,target_unit,last_message_at,unread_citizen')
    .eq('citizen_id', auth.profile.id).order('last_message_at', { ascending: false, nullsFirst: false });
  convs = data || [];
}
const convOf = (t) => convs.find((c) => (c.target_unit ?? null) === (t ?? null));

// ปลายทางแชท: เลือก รพ.สต. จากรายการเท่านั้น (ผู้ดูแลเข้ามาช่วยตอบในห้องของ รพ.สต. ได้) · ห้องยา รพ. เดิมแสดงเฉพาะคนที่เคยคุยไว้
function renderTargets() {
  const unread = (t) => convOf(t)?.unread_citizen || 0, legacy = convOf(null);
  $('#meTargets').innerHTML = `<label class="me-pick${target !== NONE ? ' on' : ''}"><span class="sr-only">เลือก รพ.สต.</span>`
    + `<select id="meUnitPick" aria-label="เลือก รพ.สต. ที่ต้องการถาม"><option value=""${target === NONE ? ' selected' : ''}>เลือก รพ.สต. ที่ต้องการถาม…</option>`
    + units.map((u) => `<option value="${u.id}"${target === u.id ? ' selected' : ''}>รพ.สต. ${esc(u.name)}${unread(u.id) ? ` (ใหม่ ${unread(u.id)})` : ''}</option>`).join('')
    + (legacy ? `<option value="h"${target === null ? ' selected' : ''}>ห้องยา รพ. (ข้อความเดิม)${unread(null) ? ` (ใหม่ ${unread(null)})` : ''}</option>` : '')
    + '</select></label>';
}
const unitName = (id) => units.find((u) => u.id === id)?.name || '';

async function openTarget(t) {
  closeRoom?.(); closeRoom = null;
  target = t;
  if (t === NONE) {                                         // ยังไม่ได้เลือกปลายทาง
    msgs = []; $('#meChatTitle').textContent = '';
    $('#meLog').innerHTML = '<p class="chat-empty">เลือก รพ.สต. ที่ต้องการถามจากรายการด้านบนก่อน เจ้าหน้าที่ รพ.สต. นั้นจะตอบในเวลาราชการ</p>';
    return;
  }
  $('#meChatTitle').textContent = 'ส่งถึง ' + targetName(t);
  const c = convOf(t);
  msgs = [];
  const empty = `ยังไม่มีข้อความ — พิมพ์คำถามเรื่องยาถึง${targetName(t)} ได้เลย เจ้าหน้าที่จะตอบในเวลาราชการ`;
  if (guest) {
    $('#meLog').innerHTML = '<div class="skeleton"></div>';
    await guestFetch(t, empty);
    const timer = setInterval(async () => {
      if ($('[data-view="me"]').hidden || document.hidden || target !== t) return;
      await guestFetch(t, empty);
      const before = JSON.stringify(convs); await loadConvs(); if (JSON.stringify(convs) !== before) renderTargets();
    }, POLL_MS);
    closeRoom = () => clearInterval(timer);
    return;
  }
  if (!c) { renderLog($('#meLog'), msgs, 'citizen', empty); return; }
  $('#meLog').innerHTML = '<div class="skeleton"></div>';
  try { msgs = await loadMessages(c.id); } catch (e) { $('#meLog').innerHTML = `<p class="chat-empty">${esc(errText(e))}</p>`; return; }
  if (target !== t) return;
  renderLog($('#meLog'), msgs, 'citizen', empty);
  if (c.unread_citizen) { await markRead(c.id); c.unread_citizen = 0; renderTargets(); refreshMsgBadge(); }
  listen(c);
}

/** ผู้ไม่ได้ล็อกอิน: อ่านข้อความของห้อง (วาดใหม่เฉพาะเมื่อมีข้อความเปลี่ยน กันเลื่อนจอกลับล่างเอง) */
async function guestFetch(t, empty) {
  const { data, error } = await sb.rpc('guest_chat_fetch', { p_token: deviceToken(), p_target: t });
  if (target !== t || !guest) return;
  if (error) { $('#meLog').innerHTML = `<p class="chat-empty">${esc(errText(error))}</p>`; return; }
  const list = data || [], changed = list.length !== msgs.length || list.at(-1)?.id !== msgs.at(-1)?.id || $('#meLog .skeleton');
  msgs = list;
  if (changed) renderLog($('#meLog'), msgs, 'citizen', empty);
  const c = convOf(t); if (c?.unread_citizen) { c.unread_citizen = 0; renderTargets(); }
}
function loginHint(text) {
  $('#meChatHint').innerHTML = `${esc(text || 'กรุณาเข้าสู่ระบบเพื่อแชทต่อ')} · <a href="#/login">เข้าสู่ระบบด้วย Google</a>`;
}
async function guestSend(body) {
  const inp = $('#meInput'), nameEl = $('#meGuestName'), name = nameEl.value.trim();
  if (!name) { $('#meChatHint').textContent = 'กรุณาใส่ชื่อเล่นก่อนเริ่มคุย'; nameEl.setAttribute('aria-invalid', 'true'); nameEl.focus(); return; }
  nameEl.removeAttribute('aria-invalid');
  if (chars(body) > GUEST_MAX) { loginHint(`ยังไม่ได้เข้าสู่ระบบ พิมพ์ได้ข้อความละไม่เกิน ${GUEST_MAX} ตัวอักษร — กรุณาเข้าสู่ระบบเพื่อแชทต่อ`); toast('กรุณาเข้าสู่ระบบเพื่อแชทต่อ', 'err'); return; }
  try { localStorage.setItem(NAME_KEY, name); } catch { /* โหมดส่วนตัว */ }
  const btn = $('#meSend'); busy(btn, true, '…');
  const { data, error } = await sb.rpc('guest_chat_send', { p_token: deviceToken(), p_target: target, p_name: name, p_body: body });
  busy(btn, false);
  if (error) {
    if (/เข้าสู่ระบบ/.test(error.message)) { loginHint(errText(error)); toast('กรุณาเข้าสู่ระบบเพื่อแชทต่อ', 'err'); } else toast(errText(error), 'err');
    return;
  }
  inp.value = ''; $('#meChatHint').textContent = '';
  msgs.push(data); renderLog($('#meLog'), msgs, 'citizen', '');
  if (!convOf(target)) { await loadConvs(); renderTargets(); }
  inp.focus();
}

function listen(c) {
  closeRoom = openRoom(c.id, (m) => {
    if (msgs.some((x) => x.id === m.id)) return;
    msgs.push(m); renderLog($('#meLog'), msgs, 'citizen', '');
    if (m.sender_role === 'staff') markRead(c.id).then(() => { c.unread_citizen = 0; renderTargets(); refreshMsgBadge(); });
  });
}

async function send(e) {
  e.preventDefault();
  const inp = $('#meInput'), body = inp.value.trim();
  if (target === NONE) { $('#meChatHint').textContent = 'กรุณาเลือก รพ.สต. ที่ต้องการถามก่อน'; $('#meUnitPick').focus(); return; }
  if (target === null) { $('#meChatHint').textContent = 'ห้องยา รพ. ปิดรับข้อความใหม่แล้ว — กรุณาเลือก รพ.สต. ที่ต้องการถาม'; return; }   // อ่านข้อความเดิมได้อย่างเดียว
  if (guest) { if (body) await guestSend(body); return; }
  const blob = await pick.ready();
  if (!body && !blob) return;
  if (/\b\d[\s-]?\d{4}[\s-]?\d{5}[\s-]?\d{2}[\s-]?\d\b/.test(body) && !confirm('ข้อความนี้อาจมีเลขบัตรประชาชน — ไม่จำเป็นต้องส่งทางแชท ต้องการส่งต่อหรือไม่?')) return;
  const btn = $('#meSend'); busy(btn, true, '…');
  try {
    let c = convOf(target);
    if (!c) {                                               // ข้อความแรก → เปิดห้องก่อน
      const ins = await sb.from('conversations').insert({ target_unit: target }).select('id,target_unit,last_message_at,unread_citizen').single();
      if (ins.error) {
        if (!/duplicate|already exists/i.test(ins.error.message)) throw ins.error;
        await loadConvs(); c = convOf(target);             // มีห้องอยู่แล้ว (เปิดจากอีกเครื่อง)
      } else { c = ins.data; convs.unshift(c); }
      listen(c);
    }
    const m = await sendMessage(c.id, body, blob);
    inp.value = ''; pick.reset();
    if (!msgs.some((x) => x.id === m.id)) msgs.push(m);
    renderLog($('#meLog'), msgs, 'citizen', '');
  } catch (err) { toast(errText(err), 'err'); }
  finally { busy(btn, false); syncHint(); inp.focus(); }
}

function bind() {
  $('#meForm').addEventListener('submit', saveProfile);
  $('#meChatForm').addEventListener('submit', send);
  $('#meInput').addEventListener('input', () => {        // ผู้ไม่ได้ล็อกอิน: เตือนทันทีเมื่อพิมพ์เกิน 15 ตัวอักษร
    if (!guest) return;
    const n = chars($('#meInput').value.trim());
    if (n > GUEST_MAX) loginHint(`เกิน ${GUEST_MAX} ตัวอักษร (${n}) — กรุณาเข้าสู่ระบบเพื่อแชทต่อ`); else $('#meChatHint').textContent = '';
  });
  pick = chatPicker($('#meFile'), $('#mePick'), $('#mePickNote'));
  $('#meTargets').addEventListener('change', (e) => {
    if (e.target.id !== 'meUnitPick' || e.target.value === '') return;
    const t = e.target.value === 'h' ? null : +e.target.value; if (t === target) return;
    $('#meChatHint').textContent = '';
    openTarget(t); renderTargets();
  });
  onConversationChange(async () => {                        // เจ้าหน้าที่ตอบห้องอื่น → อัปเดตตัวเลข
    if ($('[data-view="me"]').hidden) return;
    await loadConvs(); renderTargets();
  });
}
