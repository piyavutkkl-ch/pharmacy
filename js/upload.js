// อัปโหลดไฟล์ขึ้น Supabase Storage — ย่อรูปในเครื่องก่อน (WebP) เพื่อให้อยู่ในพื้นที่ฟรี 1 GB
import { sb } from './supabase.js?v=4.3.1';

const rand = () => Math.random().toString(36).slice(2, 8);
export const extOf = (name) => (String(name).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();

/** ย่อรูปเป็น WebP ด้านยาวไม่เกิน maxSide และขนาดไม่เกิน maxBytes */
export async function compressImage(file, { maxSide = 1600, maxBytes = 900_000 } = {}) {
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch { throw new Error(`เปิดรูป "${file.name}" ไม่ได้ — กรุณาใช้ไฟล์ JPG หรือ PNG (รูปจาก iPhone ให้ตั้งกล้องเป็น "Most Compatible" หรือแคปหน้าจอแทน)`); }
  let scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    for (const q of [0.82, 0.7, 0.58]) {
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', q));
      if (blob && blob.size <= maxBytes) return blob;
    }
    scale *= 0.75;
  }
  throw new Error('รูปใหญ่เกินไป ย่อแล้วยังเกินขนาดที่กำหนด');
}

/** รูปสาธารณะ (ข่าว/ผลงาน) → bucket public-images; คืน path */
export async function uploadPublicImage(file, folder) {
  if (!file.type.startsWith('image/')) throw new Error('กรุณาเลือกไฟล์รูปภาพ');
  const blob = await compressImage(file);
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
