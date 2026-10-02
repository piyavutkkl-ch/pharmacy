// ข้อมูลส่วนตัว: กดชื่อบนแถบเมนูด้านบน → หน้าต่างแก้ชื่อ เบอร์โทร ที่อยู่ (+ รพ.สต. ใกล้บ้าน สำหรับประชาชน) — ใช้ได้ทุกบทบาท
//   แก้ได้เฉพาะช่องที่ฐานข้อมูลอนุญาต (03_grants.sql: full_name, phone, address, home_unit_id) · บทบาท/หน่วยงานแก้ไม่ได้
//   บันทึกแล้วส่งเหตุการณ์ 'pcps:profile' ให้แถบเมนู/หน้า "ของฉัน"/คำทักทายหัวหน้าอัปเดตชื่อตาม
import { sb } from './supabase.js?v=4.4';
import { $, esc, errText, busy, toast } from './util.js?v=4.4';
import { auth } from './auth.js?v=4.4';
import { loadUnits } from './data.js?v=4.4';

export const PHONE_RE = /^[0-9][0-9 -]{7,14}$/;
const ROLE_TEXT = { admin: 'ผู้ดูแลระบบ', staff: 'เจ้าหน้าที่ รพ.สต.', citizen: 'ประชาชนทั่วไป' };
let bound = false;

/** บันทึกข้อมูลส่วนตัวของผู้ใช้ปัจจุบัน → คืน error (null = สำเร็จ) */
export async function saveMyProfile(row) {
  const { error } = await sb.from('profiles').update(row).eq('id', auth.profile.id);
  if (error) return error;
  Object.assign(auth.profile, row);
  window.dispatchEvent(new CustomEvent('pcps:profile'));
  return null;
}

export async function openProfile() {
  const p = auth.profile, dlg = $('#pdDialog');
  if (!p) return;
  if (!bound) { bound = true; bind(); }
  const citizen = p.role === 'citizen';
  $('#pdRole').textContent = ROLE_TEXT[p.role] || '';
  $('#pdName').value = p.full_name || ''; $('#pdPhone').value = p.phone || ''; $('#pdAddr').value = p.address || ''; $('#pdEmail').value = p.email || '';
  $('#pdPhoneReq').hidden = !citizen;
  $('#pdUnitField').hidden = !citizen;
  $('#pdMsg').textContent = '';
  ['#pdName', '#pdPhone'].forEach((s) => $(s).removeAttribute('aria-invalid'));
  if (!dlg.open) dlg.showModal();
  if (citizen) {
    const units = await loadUnits();
    $('#pdUnit').innerHTML = '<option value="">— เลือก —</option>' + units.map((u) => `<option value="${u.id}">รพ.สต. ${esc(u.name)}</option>`).join('');
    $('#pdUnit').value = p.home_unit_id ?? '';
  }
}

function bind() {
  const dlg = $('#pdDialog');
  $('#pdClose').addEventListener('click', () => dlg.close());
  $('#pdCancel').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });   // คลิกพื้นหลัง = ปิด
  $('#pdForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = $('#pdMsg'), say = (t) => { m.className = 'small err-text'; m.textContent = t; };
    const citizen = auth.profile.role === 'citizen';
    const full_name = $('#pdName').value.trim(), phone = $('#pdPhone').value.trim();
    ['#pdName', '#pdPhone'].forEach((s) => $(s).removeAttribute('aria-invalid'));
    if (!full_name) { say('กรุณากรอกชื่อ-นามสกุล'); $('#pdName').setAttribute('aria-invalid', 'true'); $('#pdName').focus(); return; }
    if ((citizen || phone) && !PHONE_RE.test(phone)) { say('เบอร์โทรไม่ถูกต้อง (ตัวเลข 9–10 หลัก เช่น 0812345678)'); $('#pdPhone').setAttribute('aria-invalid', 'true'); $('#pdPhone').focus(); return; }
    const row = { full_name, phone: phone || null, address: $('#pdAddr').value.trim() || null };
    if (citizen) row.home_unit_id = $('#pdUnit').value === '' ? null : +$('#pdUnit').value;
    const btn = $('#pdSave'); busy(btn, true, 'กำลังบันทึก…');
    const error = await saveMyProfile(row);
    busy(btn, false);
    if (error) { say(errText(error)); return; }
    dlg.close(); toast('บันทึกข้อมูลส่วนตัวแล้ว');
  });
}
