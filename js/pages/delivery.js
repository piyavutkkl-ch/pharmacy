// บริการจัดส่งยาถึงบ้าน (ขั้น 21)
//   หน้าหลัก #/delivery: โปสเตอร์เลื่อนซ้าย-ขวา + ข้อความแนะนำบริการ (ส่วนสรุป Google Sheets อยู่ใน delivery-report.js) → initDelivery()
//   ผู้ดูแล › จัดส่งยาถึงบ้าน: โปสเตอร์ / ข้อความแนะนำ → initDeliveryAdmin()
import { sb, publicImageUrl } from '../supabase.js?v=4.4';
import { $, esc, toast, errText, busy } from '../util.js?v=4.4';
import { A4, imagePicker, uploadPublicImage, removeFiles } from '../upload.js?v=4.4';

/* ---------- แถวโปสเตอร์ (ใช้ร่วมกับผลงาน) ---------- */
/** ปุ่ม ‹ › ข้างแถวโปสเตอร์ (อยู่ใน .poster-wrap เดียวกัน) */
export function bindPosterNav(row) {
  row.parentNode.querySelectorAll('[data-poster-nav]').forEach((b) => b.addEventListener('click', () => {
    row.scrollBy({ left: (b.dataset.posterNav === 'next' ? 1 : -1) * row.clientWidth * 0.8, behavior: 'smooth' });
  }));
}
/** โปสเตอร์ [{title,image_path,tag?}] → แถวเลื่อนซ้าย-ขวา · กดเปิดภาพเต็ม */
export function renderPosterRow(row, list, alt) {
  row.innerHTML = list.length ? list.map((x) => `<a class="poster" href="${esc(publicImageUrl(x.image_path))}" target="_blank" rel="noopener">`
    + `<img src="${esc(publicImageUrl(x.image_path))}" alt="${esc(x.title || alt)}" loading="lazy">`
    + (x.title || x.tag ? `<span>${esc(x.title || '')}${x.tag ? `<em class="small muted"> ${esc(x.tag)}</em>` : ''}</span>` : '') + '</a>').join('')
    : '<p class="empty">ยังไม่มีโปสเตอร์</p>';
  row.parentNode.querySelectorAll('[data-poster-nav]').forEach((b) => { b.hidden = list.length < 2; });
}
export const paras = (t) => String(t || '').split(/\n+/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');

/* ======================= หน้าหลัก ======================= */
let dlBound = false;

export async function initDelivery() {
  if (!dlBound) {
    dlBound = true;
    bindPosterNav($('#dlPosters'));
  }
  $('#dlPosters').innerHTML = '<div class="skeleton poster-skel"></div>';
  const [p, t] = await Promise.all([
    sb.from('delivery_posters').select('id,title,image_path,sort').order('sort').order('created_at', { ascending: false }),
    sb.from('site_texts').select('body').eq('key', 'delivery_info').maybeSingle(),
  ]);
  renderPosterRow($('#dlPosters'), p.data || [], 'โปสเตอร์บริการจัดส่งยาถึงบ้าน');
  $('#dlInfo').innerHTML = paras(t.data?.body) || '<p class="muted">ยังไม่มีข้อมูลบริการ</p>';
}

/* ======================= ผู้ดูแล ======================= */
let adminBound = false, posters = [], picker = null;

export async function initDeliveryAdmin() {
  if (!adminBound) {
    adminBound = true;
    picker = imagePicker($('#daImage'), $('#daPreview'), $('#daImageNote'), { fit: A4 });
    $('#daAdd').addEventListener('click', addPoster);
    $('#daList').addEventListener('click', onPosterList);
    $('#daList').addEventListener('change', onPosterSort);
    $('#daInfoSave').addEventListener('click', saveInfo);
  }
  const t = await sb.from('site_texts').select('body').eq('key', 'delivery_info').maybeSingle();
  $('#daInfo').value = t.data?.body || '';
  await loadPosters();
}

async function loadPosters() {
  const { data, error } = await sb.from('delivery_posters').select('id,title,image_path,sort').order('sort').order('created_at', { ascending: false });
  if (error) { $('#daList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  posters = data;
  $('#daList').innerHTML = posters.length ? posters.map((x) => `<div class="da-poster"><img src="${esc(publicImageUrl(x.image_path))}" alt="">`
    + `<div class="l"><b>${esc(x.title || '(ไม่มีชื่อ)')}</b><label class="small">ลำดับ <input class="input da-sort" type="number" inputmode="numeric" value="${x.sort}" data-sort="${x.id}" aria-label="ลำดับโปสเตอร์"></label></div>`
    + `<button type="button" class="btn btn-no btn-sm" data-del="${x.id}">ลบ</button></div>`).join('')
    : '<p class="empty">ยังไม่มีโปสเตอร์ · เพิ่มได้จากฟอร์มด้านบน</p>';
}

async function addPoster() {
  const btn = $('#daAdd'), blob = await picker.ready();
  if (!blob) { toast('กรุณาเลือกรูปโปสเตอร์', 'err'); return; }
  busy(btn, true, 'กำลังอัปโหลด…');
  let path = null;
  try {
    path = await uploadPublicImage(blob, 'delivery');
    const sort = posters.length ? Math.max(...posters.map((x) => x.sort)) + 1 : 0;
    const { error } = await sb.from('delivery_posters').insert({ title: $('#daTitle').value.trim() || null, image_path: path, sort });
    if (error) throw error;
    $('#daTitle').value = ''; picker.reset(); toast('เพิ่มโปสเตอร์แล้ว'); await loadPosters();
  } catch (err) { if (path) removeFiles('public-images', [path]); toast(errText(err), 'err'); }
  finally { busy(btn, false); }
}

async function onPosterList(e) {
  const b = e.target.closest('[data-del]'); if (!b) return;
  const x = posters.find((p) => p.id === +b.dataset.del);
  if (!x || !confirm(`ลบโปสเตอร์ "${x.title || 'ไม่มีชื่อ'}"?`)) return;
  const { error } = await sb.from('delivery_posters').delete().eq('id', x.id);
  if (error) { toast(errText(error), 'err'); return; }
  removeFiles('public-images', [x.image_path]); toast('ลบโปสเตอร์แล้ว'); loadPosters();
}

async function onPosterSort(e) {
  const i = e.target.closest('[data-sort]'); if (!i) return;
  const { error } = await sb.from('delivery_posters').update({ sort: Math.round(+i.value || 0) }).eq('id', +i.dataset.sort);
  if (error) { toast(errText(error), 'err'); return; }
  toast('บันทึกลำดับแล้ว'); loadPosters();
}

async function saveInfo() {
  const btn = $('#daInfoSave'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = await sb.from('site_texts').upsert({ key: 'delivery_info', body: $('#daInfo').value.trim() });
  busy(btn, false);
  if (error) toast(errText(error), 'err'); else toast('บันทึกข้อความแล้ว');
}
