// คำขอสิทธิ์เจ้าหน้าที่ รพ.สต. (ตาราง staff_requests · ขั้น 20)
//   ประชาชน (#/me): กรอกคำขอ / ดูสถานะ / ยกเลิก → initStaffRequest()
//   ผู้ดูแล (ตั้งค่า › บัญชีเจ้าหน้าที่): อนุมัติ (เพิ่มใน staff_roster ให้เอง) / ไม่อนุมัติ → initRequestsAdmin()
import { sb } from '../supabase.js?v=4.4';
import { $, esc, thaiDate, toast, errText, busy } from '../util.js?v=4.4';
import { auth } from '../auth.js?v=4.4';
import { loadUnits, unitName } from '../data.js?v=4.4';

const PHONE_RE = /^[0-9][0-9 -]{7,14}$/;
const STATUS = { pending: ['รออนุมัติ', 'c-rev'], approved: ['อนุมัติแล้ว', 'c-ok'], rejected: ['ไม่อนุมัติ', 'c-fix'] };

/* ======================= ประชาชน ======================= */
let mine = null, citizenBound = false;

export async function initStaffRequest(open = false) {
  const units = await loadUnits();
  if (!citizenBound) {
    citizenBound = true;
    $('#srUnit').innerHTML = units.map((u) => `<option value="${u.id}">รพ.สต. ${esc(u.name)}</option>`).join('');
    $('#srOpen').addEventListener('click', () => showForm(true));
    $('#srCancelForm').addEventListener('click', () => showForm(false));
    $('#srForm').addEventListener('submit', submit);
    $('#srState').addEventListener('click', async (e) => {
      if (e.target.closest('[data-sr-again]')) { showForm(true); return; }
      const w = e.target.closest('[data-sr-withdraw]'); if (!w || !confirm('ยกเลิกคำขอสิทธิ์เจ้าหน้าที่?')) return;
      busy(w, true, 'กำลังยกเลิก…');
      const { error } = await sb.from('staff_requests').delete().eq('id', +w.dataset.srWithdraw);
      if (error) { busy(w, false); toast(errText(error), 'err'); return; }
      toast('ยกเลิกคำขอแล้ว'); load();
    });
  }
  await load();
  if (open && (!mine || mine.status === 'rejected')) { showForm(true); $('#srPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

async function load() {
  const { data } = await sb.from('staff_requests').select('id,full_name,unit_id,position,status,review_note,created_at,reviewed_at').order('created_at', { ascending: false }).limit(1);
  mine = data?.[0] || null;
  const st = $('#srState');
  if (!mine) { st.innerHTML = ''; $('#srOpen').hidden = false; showForm(false); return; }
  const [label, cls] = STATUS[mine.status];
  st.innerHTML = `<div class="sr-status"><span class="chip ${cls}">${label}</span><span class="small">ขอเป็นเจ้าหน้าที่ รพ.สต. ${esc(unitName(mine.unit_id))}${mine.position ? ' · ' + esc(mine.position) : ''} · ส่งเมื่อ ${esc(thaiDate(mine.created_at))}</span>`
    + (mine.status === 'pending' ? `<button type="button" class="btn btn-o btn-sm" data-sr-withdraw="${mine.id}">ยกเลิกคำขอ</button>` : '')
    + (mine.status === 'rejected' ? `${mine.review_note ? `<span class="small">เหตุผล: ${esc(mine.review_note)}</span>` : ''}<button type="button" class="btn btn-o btn-sm" data-sr-again>ส่งคำขอใหม่</button>` : '')
    + (mine.status === 'approved' ? '<span class="small">ออกจากระบบแล้วเข้าใหม่ เพื่อเปิดเมนูเจ้าหน้าที่</span>' : '') + '</div>';
  $('#srOpen').hidden = true; showForm(false);
}

function showForm(on) {
  $('#srForm').hidden = !on; if (mine?.status !== 'rejected') $('#srOpen').hidden = on || !!mine;
  if (on) {
    const p = auth.profile || {};
    $('#srName').value ||= p.full_name || ''; $('#srPhone').value ||= p.phone || '';
    if (p.home_unit_id != null && !$('#srForm').dataset.touched) $('#srUnit').value = String(p.home_unit_id);
    $('#srName').focus();
  }
}

async function submit(e) {
  e.preventDefault();
  const m = $('#srMsg'), say = (t) => { m.textContent = t; m.classList.add('err-text'); };
  const full_name = $('#srName').value.trim(), phone = $('#srPhone').value.trim();
  if (!full_name) { say('กรุณากรอกชื่อ-นามสกุล'); $('#srName').focus(); return; }
  if (!phone || !PHONE_RE.test(phone)) { say('กรุณากรอกเบอร์โทรที่ติดต่อได้ (ตัวเลข 9–10 หลัก)'); $('#srPhone').focus(); return; }
  const row = { full_name, phone, unit_id: +$('#srUnit').value, position: $('#srPos').value.trim() || null, note: $('#srNote').value.trim() || null };
  const btn = $('#srSubmit'); busy(btn, true, 'กำลังส่ง…'); m.textContent = '';
  const { error } = await sb.from('staff_requests').insert(row);
  busy(btn, false);
  if (error) { say(/duplicate|already/i.test(error.message) ? 'คุณมีคำขอที่รออนุมัติอยู่แล้ว' : errText(error)); return; }
  $('#srForm').reset(); toast('ส่งคำขอแล้ว · ผู้ดูแลจะตรวจสอบและอนุมัติ'); load();
}

/* ======================= ผู้ดูแล ======================= */
let reqs = [], adminBound = false;

export async function initRequestsAdmin(onApproved) {
  const units = await loadUnits();
  if (!adminBound) {
    adminBound = true;
    $('#srList').addEventListener('click', async (e) => {
      const ok = e.target.closest('[data-sr-approve]'), no = e.target.closest('[data-sr-reject]');
      if (!ok && !no) return;
      const id = +(ok || no).dataset[ok ? 'srApprove' : 'srReject'], row = e.target.closest('.sr-row');
      const r = reqs.find((x) => x.id === id); if (!r) return;
      if (ok) {
        const unit = +row.querySelector('.sr-unit').value;
        if (!confirm(`อนุมัติ ${r.full_name} (${r.email}) เป็นเจ้าหน้าที่ รพ.สต. ${unitName(unit)}?`)) return;
        busy(ok, true, 'กำลังอนุมัติ…');
        const { error } = await sb.rpc('approve_staff_request', { p_id: id, p_unit: unit });
        if (error) { busy(ok, false); toast(errText(error), 'err'); return; }
        toast(`อนุมัติแล้ว · ${r.full_name} ใช้เมนูเจ้าหน้าที่ได้เมื่อเข้าสู่ระบบครั้งถัดไป`);
        onApproved?.();
      } else {
        const note = row.querySelector('.sr-note').value.trim();
        if (!confirm(`ไม่อนุมัติคำขอของ ${r.full_name}?`)) return;
        busy(no, true, 'กำลังบันทึก…');
        const { error } = await sb.rpc('reject_staff_request', { p_id: id, p_note: note || null });
        if (error) { busy(no, false); toast(errText(error), 'err'); return; }
        toast('บันทึกว่าไม่อนุมัติแล้ว');
      }
      loadRequests(units);
    });
  }
  await loadRequests(units);
}

async function loadRequests(units) {
  $('#srList').innerHTML = '<div class="skeleton"></div>';
  const { data, error } = await sb.from('staff_requests').select('id,email,full_name,unit_id,position,phone,note,created_at').eq('status', 'pending').order('created_at');
  if (error) { $('#srList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  reqs = data;
  $('#srCount').textContent = `(${reqs.length})`;
  $('#srList').innerHTML = reqs.length ? reqs.map((r) => `<div class="sr-row"><div class="l"><b>${esc(r.full_name)}</b>`
    + `<span class="small muted">${esc(r.email)}${r.phone ? ' · ' + esc(r.phone) : ''} · ส่งเมื่อ ${esc(thaiDate(r.created_at))}</span>`
    + `<span class="small">${r.position ? esc(r.position) + ' · ' : ''}ขอเป็นเจ้าหน้าที่ รพ.สต. ${esc(unitName(r.unit_id))}</span>`
    + (r.note ? `<span class="small muted">หมายเหตุ: ${esc(r.note)}</span>` : '') + '</div>'
    + `<div class="sr-actions"><label class="small">รพ.สต. ที่อนุมัติ<select class="input sr-unit">${units.map((u) => `<option value="${u.id}"${u.id === r.unit_id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>`
    + '<input class="input sr-note" maxlength="500" placeholder="เหตุผล (กรณีไม่อนุมัติ)" aria-label="เหตุผลที่ไม่อนุมัติ">'
    + `<div class="row-btns"><button type="button" class="btn btn-ok btn-sm" data-sr-approve="${r.id}">อนุมัติ</button><button type="button" class="btn btn-no btn-sm" data-sr-reject="${r.id}">ไม่อนุมัติ</button></div></div></div>`).join('')
    : '<p class="empty">ไม่มีคำร้องใหม่ · ผู้ขอสิทธิ์กรอกได้ที่หน้า "เข้าสู่ระบบ" › ขอสิทธิ์เจ้าหน้าที่</p>';
}
