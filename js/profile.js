// ข้อมูลส่วนตัว: กดรูปวงกลม/ชื่อที่หัวหน้า (สวัสดี …) ของหน้าประชาชน/เจ้าหน้าที่/ผู้ดูแล → หน้าต่างแก้รูป ชื่อ เบอร์โทร ที่อยู่ (+ รพ.สต. ใกล้บ้าน สำหรับประชาชน)
//   (ชื่อบนแถบเมนูด้านบน = ลิงก์ไปหน้าเมนูตามสิทธิ์ · main.js renderNav)
//   แก้ได้เฉพาะช่องที่ฐานข้อมูลอนุญาต (03_grants.sql: full_name, phone, address, home_unit_id · 71_avatar.sql: avatar_path) · บทบาท/หน่วยงานแก้ไม่ได้
//   รูปประจำตัว: public-images/avatars/<user id>/… (ย่อ ≤ 400 px) · ไม่มี = รูปจากบัญชี Google (avatar_url) · ไม่มีทั้งคู่ = ตัวอักษรย่อ
//   บันทึกแล้วส่งเหตุการณ์ 'pcps:profile' ให้แถบเมนู/หน้า "ของฉัน"/คำทักทายหัวหน้าอัปเดตชื่อตาม
import { sb, publicImageUrl } from './supabase.js?v=4.4';
import { $, $$, esc, errText, busy, toast } from './util.js?v=4.4';
import { compressImage, uploadPublicImage } from './upload.js?v=4.4';
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

/** รูปของผู้ใช้ปัจจุบัน → URL ('' = ไม่มี) */
export const myAvatarUrl = (p = auth.profile) => (p?.avatar_path ? publicImageUrl(p.avatar_path) : p?.avatar_url && /^https:\/\//.test(p.avatar_url) ? p.avatar_url : '');

/** อักษรแรกของชื่อ (ข้ามสระหน้า เ แ โ ใ ไ) — ไม่มีรูป */
const firstLetter = (n) => (String(n).trim().replace(/^[เแโใไ]+/, '')[0] || '').toUpperCase();

/** วาดรูปวงกลมทุกจุดที่มี data-my-avatar (หัวหน้าเจ้าหน้าที่/ผู้ดูแล/ประชาชน + หน้าต่างข้อมูลส่วนตัว) */
export function paintAvatars() {
  const p = auth.profile, url = myAvatarUrl(p);
  $$('[data-my-avatar]').forEach((el) => {
    el.hidden = !p;
    el.innerHTML = url ? `<img src="${esc(url)}" alt="" referrerpolicy="no-referrer">` : esc(firstLetter(p?.full_name || p?.email || ''));
  });
  const del = $('#pdPhotoDel'); if (del) del.hidden = !p?.avatar_path;
}
window.addEventListener('pcps:profile', paintAvatars);
document.addEventListener('click', (e) => { if (e.target.closest('[data-edit-profile]') && auth.profile) openProfile(); });

async function onPhoto() {
  const f = $('#pdPhoto').files[0], m = $('#pdPhotoMsg'); if (!f) return;
  const old = auth.profile.avatar_path;
  m.textContent = 'กำลังอัปโหลดรูป…';
  try {
    const blob = await compressImage(f, { maxSide: 400, maxBytes: 150_000 });
    const path = await uploadPublicImage(blob, `avatars/${auth.profile.id}`);
    const error = await saveMyProfile({ avatar_path: path });
    if (error) { await sb.storage.from('public-images').remove([path]); throw error; }
    if (old) sb.storage.from('public-images').remove([old]).catch(() => {});
    m.textContent = 'บันทึกรูปแล้ว';
  } catch (err) { m.textContent = err.message && !err.code ? err.message : errText(err); }
  $('#pdPhoto').value = '';
}

async function onPhotoDel() {
  const old = auth.profile.avatar_path; if (!old) return;
  const error = await saveMyProfile({ avatar_path: null });
  if (error) { $('#pdPhotoMsg').textContent = errText(error); return; }
  sb.storage.from('public-images').remove([old]).catch(() => {});
  $('#pdPhotoMsg').textContent = 'ลบรูปแล้ว · ใช้รูปจากบัญชี Google แทน';
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
  $('#pdPhotoMsg').textContent = 'รูปประจำตัว (ไม่บังคับ) · ไม่มีรูปจะใช้รูปจากบัญชี Google';
  paintAvatars();
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
  $('#pdPhoto').addEventListener('change', onPhoto);
  $('#pdPhotoDel').addEventListener('click', onPhotoDel);
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
