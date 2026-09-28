// อัปโหลดไฟล์ขึ้น Supabase Storage — ย่อรูปในเครื่องก่อน (WebP) เพื่อให้อยู่ในพื้นที่ฟรี 1 GB
import { sb } from './supabase.js?v=4.4';
import { esc } from './util.js?v=4.4';

const rand = () => Math.random().toString(36).slice(2, 8);
export const extOf = (name) => (String(name).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();

/** A4 ที่ 150 dpi (พิกเซล) — รูปประกอบข่าวย่อให้ไม่เกินขนาดนี้ ทั้งแนวตั้งและแนวนอน */
export const A4 = { long: 1754, short: 1240 };

/** ย่อรูปเป็น WebP ด้านยาวไม่เกิน maxSide (หรือให้พอดีกรอบ fit = {long, short}) และขนาดไม่เกิน maxBytes · blob.w/.h = ขนาดที่ได้ */
export async function compressImage(file, { maxSide = 1600, maxBytes = 900_000, fit = null } = {}) {
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch { throw new Error(`เปิดรูป "${file.name}" ไม่ได้ — กรุณาใช้ไฟล์ JPG หรือ PNG (รูปจาก iPhone ให้ตั้งกล้องเป็น "Most Compatible" หรือแคปหน้าจอแทน)`); }
  const long = Math.max(bmp.width, bmp.height), short = Math.min(bmp.width, bmp.height);
  let scale = fit ? Math.min(1, fit.long / long, fit.short / short) : Math.min(1, maxSide / long);
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    for (const q of [0.82, 0.7, 0.58]) {
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', q));
      if (blob && blob.size <= maxBytes) return Object.assign(blob, { w, h });
    }
    scale *= 0.75;
  }
  throw new Error('รูปใหญ่เกินไป ย่อแล้วยังเกินขนาดที่กำหนด');
}

/**
 * ช่องเลือกรูป: เลือกแล้วย่อทันที + แสดงตัวอย่างใน box (<div hidden><img></div>) + บอกขนาดใน note
 * คืน { ready(): Promise<Blob|null> รูปที่ย่อแล้ว, reset(), showExisting(src, text) }
 */
export function imagePicker(input, box, note, opts = {}) {
  const img = box.querySelector('img');
  let blob = null, url = null, pending = Promise.resolve(null), job = 0;
  const say = (t, err) => { note.textContent = t; note.classList.toggle('err-text', !!err); };
  const clear = () => { if (url) URL.revokeObjectURL(url); url = null; blob = null; img.removeAttribute('src'); box.hidden = true; };
  input.addEventListener('change', () => {
    clear(); const f = input.files[0], my = ++job;
    if (!f) { say(''); pending = Promise.resolve(null); return; }
    if (!f.type.startsWith('image/')) { input.value = ''; say('กรุณาเลือกไฟล์รูปภาพ', true); pending = Promise.resolve(null); return; }
    say('กำลังย่อรูป…');
    pending = compressImage(f, opts).then((b) => {
      if (my !== job) return null;
      blob = b; url = URL.createObjectURL(b); img.src = url; box.hidden = false;
      say(`${opts.fit ? 'ย่อให้ไม่เกินขนาด A4 แล้ว · ' : ''}${b.w}×${b.h} พิกเซล · ${Math.max(1, Math.round(b.size / 1024))} KB`);
      return b;
    }, (e) => { if (my === job) { input.value = ''; say(e.message, true); } return null; });
  });
  return {
    ready: () => pending,
    reset() { job++; clear(); input.value = ''; say(''); pending = Promise.resolve(null); },
    showExisting(src, text) { job++; clear(); input.value = ''; pending = Promise.resolve(null); if (src) { img.src = src; box.hidden = false; } say(text || ''); },
  };
}

/** รูปสาธารณะ (ข่าว/ผลงาน) → bucket public-images; คืน path · ส่งรูปที่ย่อแล้วจาก imagePicker ได้ */
export async function uploadPublicImage(file, folder) {
  if (!file.type.startsWith('image/')) throw new Error('กรุณาเลือกไฟล์รูปภาพ');
  const blob = file.w ? file : await compressImage(file);
  const path = `${folder}/${Date.now()}-${rand()}.webp`;
  const { error } = await sb.storage.from('public-images').upload(path, blob, { contentType: 'image/webp', upsert: false });
  if (error) throw error;
  return path;
}

/** ไฟล์หลักฐาน (ส่วนตัว) → bucket evidence · รับ PDF หรือรูป · ไม่เกิน 2 MB */
export async function uploadEvidence(file, folder) {
  const isPdf = file.type === 'application/pdf' || extOf(file.name) === 'pdf';
  let blob = file, ext = 'pdf', type = 'application/pdf';
  if (!isPdf) {
    if (!file.type.startsWith('image/')) throw new Error(`"${file.name}" ไม่ใช่ PDF หรือรูปภาพ`);
    blob = await compressImage(file, { maxSide: 2000, maxBytes: 1_900_000 });
    ext = 'webp'; type = 'image/webp';
  } else if (file.size > 2 * 1024 * 1024) {
    throw new Error(`"${file.name}" ใหญ่เกิน 2 MB — ลองบีบอัด PDF หรือถ่ายเป็นรูปแทน`);
  }
  const path = `${folder}/${Date.now()}-${rand()}.${ext}`;
  const { error } = await sb.storage.from('evidence').upload(path, blob, { contentType: type, upsert: false });
  if (error) throw error;
  return path;
}

/** รูปในแชท (ส่วนตัว) → bucket chat-images/<ห้องแชท>/… · รับรูปที่ย่อแล้วจาก imagePicker; คืน path */
export async function uploadChatImage(blob, convId) {
  const path = `${convId}/${Date.now()}-${rand()}.webp`;
  const { error } = await sb.storage.from('chat-images').upload(path, blob, { contentType: 'image/webp', upsert: false });
  if (error) throw error;
  return path;
}

/** ไฟล์ PDF แนบข่าว (สาธารณะ) → bucket news-files/<user id>/… · ไม่เกิน 5 MB; คืน path */
export async function uploadNewsFile(file, userId) {
  if (!(file.type === 'application/pdf' || extOf(file.name) === 'pdf')) throw new Error(`"${file.name}" ไม่ใช่ไฟล์ PDF`);
  if (file.size > 5 * 1024 * 1024) throw new Error(`"${file.name}" ใหญ่เกิน 5 MB — ลองบีบอัด PDF ก่อน`);
  const path = `${userId}/${Date.now()}-${rand()}.pdf`;
  const { error } = await sb.storage.from('news-files').upload(path, file, { contentType: 'application/pdf', upsert: false });
  if (error) throw error;
  return path;
}
export const newsFileUrl = (path) => (path ? sb.storage.from('news-files').getPublicUrl(path).data.publicUrl : '');

const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isImgPath = (p) => /\.(webp|jpe?g|png)$/i.test(p);
const PDF_ICON = '<span class="ficon" aria-hidden="true">PDF</span>';
let previewUrls = [];

/** ตัวอย่างไฟล์ที่เลือก (ก่อนส่ง) ลงใน el: รูป = ภาพย่อ, PDF = ชื่อไฟล์ + ขนาด */
export function previewFiles(files, el) {
  previewUrls.forEach((u) => URL.revokeObjectURL(u)); previewUrls = [];
  el.innerHTML = [...files].map((f) => {
    const img = f.type.startsWith('image/') ? (previewUrls[previewUrls.push(URL.createObjectURL(f)) - 1]) : '';
    return `<figure class="fthumb">${img ? `<img src="${img}" alt="">` : PDF_ICON}<figcaption>${esc(f.name)} · ${kb(f.size)}</figcaption></figure>`;
  }).join('');
  el.hidden = !files.length;
}

/** การ์ดไฟล์ส่วนตัวที่ส่งแล้ว (กดเปิดได้ · data-file) — รูปแสดงภาพย่อ เติมด้วย hydrateSigned() */
export function fileCard(bucket, path, label, extraClass = '') {
  return `<button type="button" class="fthumb${extraClass ? ' ' + extraClass : ''}" data-file="${esc(path)}" data-bucket="${esc(bucket)}" aria-label="เปิด${esc(label)}">`
    + (isImgPath(path) ? `<img data-signed="${esc(bucket)}|${esc(path)}" alt="">` : PDF_ICON)
    + `<figcaption>${esc(label)}</figcaption></button>`;
}

const signedCache = new Map();   // "bucket|path" → { url, at } — ลิงก์อายุ 5 นาที ใช้ซ้ำได้ 4 นาที
/** เติมรูปจากลิงก์ชั่วคราวให้ <img data-signed="bucket|path"> ใน root */
export async function hydrateSigned(root) {
  await Promise.all([...root.querySelectorAll('img[data-signed]:not([src])')].map(async (img) => {
    const key = img.dataset.signed, hit = signedCache.get(key);
    if (hit && Date.now() - hit.at < 240_000) { img.src = hit.url; return; }
    const [bucket, path] = key.split('|');
    try { const url = await signedUrl(bucket, path); signedCache.set(key, { url, at: Date.now() }); img.src = url; } catch { img.alt = 'เปิดรูปไม่ได้'; }
  }));
}

/** ไฟล์ตัวอย่างหลักฐานของเกณฑ์ (ผู้ดูแล) → bucket criteria-samples/<ปีงบ>/<หัวข้อย่อย>/… · PDF ≤ 5 MB หรือรูป (ย่อเป็น WebP); คืน {path, name} */
export async function uploadSample(file, folder) {
  const isPdf = file.type === 'application/pdf' || extOf(file.name) === 'pdf';
  let blob = file, ext = 'pdf', type = 'application/pdf';
  if (!isPdf) {
    if (!file.type.startsWith('image/')) throw new Error(`"${file.name}" ไม่ใช่ PDF หรือรูปภาพ`);
    blob = await compressImage(file, { maxSide: 2000, maxBytes: 1_900_000 }); ext = 'webp'; type = 'image/webp';
  } else if (file.size > 5 * 1024 * 1024) throw new Error(`"${file.name}" ใหญ่เกิน 5 MB`);
  const path = `${folder}/${Date.now()}-${rand()}.${ext}`;
  const { error } = await sb.storage.from('criteria-samples').upload(path, blob, { contentType: type, upsert: false });
  if (error) throw error;
  return { path, name: file.name.slice(0, 120) };
}

/** เปิดไฟล์ส่วนตัวจากปุ่ม [data-file][data-bucket] ในแท็บใหม่ */
export async function openPrivateFile(btn, fallbackBucket = 'evidence') {
  const url = await signedUrl(btn.dataset.bucket || fallbackBucket, btn.dataset.file);
  const w = window.open(url, '_blank', 'noopener');
  if (!w) location.assign(url);   // บางเบราว์เซอร์/แอปบล็อกหน้าต่างใหม่
}

/** รูปถ่ายเยี่ยมบ้าน (ส่วนตัว · PDPA) → bucket visit-photos/<unit>/<patient>/…; คืน path */
export async function uploadVisitPhoto(blob, unit, patientId) {
  const path = `${unit}/${patientId}/${Date.now()}-${rand()}.webp`;
  const { error } = await sb.storage.from('visit-photos').upload(path, blob, { contentType: 'image/webp', upsert: false });
  if (error) throw error;
  return path;
}

/** ลิงก์ชั่วคราว (5 นาที) สำหรับเปิดไฟล์ส่วนตัว */
export async function signedUrl(bucket, path) {
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}

export async function removeFiles(bucket, paths) {
  if (!paths?.length) return;
  await sb.storage.from(bucket).remove(paths);
}
