// ฟอร์มข่าวที่ใช้ร่วมกัน (เจ้าหน้าที่ #sn… ใน staff.js / ผู้ดูแล #an… ใน admin-news.js)
//   ประเภทข่าว · รูปประกอบหลายรูป (ย่อไม่เกิน A4 + แสดงตัวอย่างทันที · กด × ลบทีละรูป · รูปแรก = รูปหลัก, ที่เหลือ = gallery) · ไฟล์ PDF แนบให้ผู้อ่านดาวน์โหลด
import { publicImageUrl } from '../supabase.js?v=4.4';
import { $, esc } from '../util.js?v=4.4';
import { A4, compressImage, uploadPublicImage, uploadNewsFile, removeFiles, extOf, newsFileUrl } from '../upload.js?v=4.4';

export const NEWS_TAGS = ['ข่าว', 'ประชาสัมพันธ์', 'ความรู้'];
export const MAX_NEWS_IMAGES = 7;   // รูปหลัก 1 + ภาพเพิ่ม (gallery) ไม่เกิน 6 — ตรงกับ news_source_check
const HINT_IMG = `ระบบย่อรูปให้ไม่เกินขนาด A4 อัตโนมัติ · ไม่เกิน ${MAX_NEWS_IMAGES} รูป · รูปแรกเป็นรูปหลัก`;

/** รูปประกอบหลายรูป (ข่าว + สรุปผลงานเยี่ยมบ้าน): รายการ = รูปเดิม { path } + รูปใหม่ที่ย่อแล้ว { blob, url } · ปุ่ม × ลบ · ปุ่ม "ตั้งเป็นรูปหลัก" ย้ายไปไว้หน้าสุด */
export function imageList(input, box, note, { max = MAX_NEWS_IMAGES, hint = HINT_IMG } = {}) {
  let items = [], job = 0, pending = Promise.resolve();
  const say = (t, err) => { note.textContent = t; note.classList.toggle('err-text', !!err); };
  const free = (x) => { if (x.url) URL.revokeObjectURL(x.url); };
  const render = () => {
    box.hidden = !items.length;
    box.innerHTML = items.map((x, i) => `<figure class="img-item${i ? '' : ' main'}"><img src="${esc(x.url || publicImageUrl(x.path))}" alt="รูปประกอบที่ ${i + 1}">`
      + `<button type="button" class="img-x" data-rmimg="${i}" aria-label="ลบรูปที่ ${i + 1}" title="ลบรูปนี้">×</button>`
      + `<figcaption>${i ? `<button type="button" class="linkish" data-mainimg="${i}">ตั้งเป็นรูปหลัก</button>` : 'รูปหลัก'}</figcaption></figure>`).join('');
    input.disabled = items.length >= max;
  };
  const sayCount = () => say(items.length ? `${items.length}/${max} รูป · ย่อไม่เกินขนาด A4 · กด × เพื่อลบ${items.length >= max ? ' · ครบแล้ว' : ' · เลือกไฟล์เพื่อเพิ่มรูป'}` : hint);
  input.addEventListener('change', () => {
    const files = [...input.files], my = job; input.value = '';
    if (!files.length) return;
    const room = max - items.length;
    say('กำลังย่อรูป…');
    pending = pending.then(async () => {
      let bad = '';
      for (const f of files.slice(0, room)) {
        if (!f.type.startsWith('image/')) { bad = 'กรุณาเลือกไฟล์รูปภาพ'; continue; }
        try { const blob = await compressImage(f, { fit: A4 }); if (my !== job) return; items.push({ blob, url: URL.createObjectURL(blob) }); render(); }
        catch (e) { bad = e.message; }
      }
      if (my !== job) return;
      sayCount();
      if (files.length > room) say(`${note.textContent} · เพิ่มได้อีก ${room} รูปเท่านั้น`, true);
      if (bad) say(bad, true);
    });
  });
  box.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rmimg]'), mn = e.target.closest('[data-mainimg]');
    if (rm) { const [x] = items.splice(+rm.dataset.rmimg, 1); free(x); render(); sayCount(); }
    if (mn) { const [x] = items.splice(+mn.dataset.mainimg, 1); items.unshift(x); render(); }
  });
  return {
    ready: () => pending,
    set(paths) { job++; items.forEach(free); items = paths.filter(Boolean).map((path) => ({ path })); pending = Promise.resolve(); input.value = ''; render(); sayCount(); },
    items: () => items,
  };
}
const HINT_PDF = 'ผู้อ่านข่าวดาวน์โหลดไฟล์นี้ได้';

export function newsForm(p) {
  const img = imageList($(`#${p}Image`), $(`#${p}ImagePreview`), $(`#${p}ImageNote`));
  const tag = $(`#${p}Tag`), pdf = $(`#${p}File`), pdfNote = $(`#${p}FileNote`);
  const sayPdf = (t, err) => { pdfNote.textContent = t; pdfNote.classList.toggle('err-text', !!err); };
  pdf.addEventListener('change', () => {
    const f = pdf.files[0];
    if (!f) { sayPdf(HINT_PDF); return; }
    if (!(f.type === 'application/pdf' || extOf(f.name) === 'pdf')) { pdf.value = ''; sayPdf('กรุณาเลือกไฟล์ PDF', true); return; }
    if (f.size > 5 * 1024 * 1024) { pdf.value = ''; sayPdf(`ไฟล์ใหญ่เกิน 5 MB (${(f.size / 1048576).toFixed(1)} MB) — ลองบีบอัด PDF ก่อน`, true); return; }
    sayPdf(`จะแนบ: ${f.name} · ${Math.max(1, Math.round(f.size / 1024))} KB`);
  });
  // ข่าวเก่าที่ใช้ประเภทเดิม (ประกาศ/อบรม/รายงาน) — แสดงเป็นตัวเลือกชั่วคราว ไม่ให้ประเภทเปลี่ยนเองตอนแก้ไข
  const setTag = (v) => {
    [...tag.options].filter((o) => o.dataset.old).forEach((o) => o.remove());
    if (v && !NEWS_TAGS.includes(v)) { const o = new Option(`${v} (ประเภทเดิม)`, v); o.dataset.old = '1'; tag.add(o); }
    tag.value = v || NEWS_TAGS[0];
  };
  return {
    reset() { img.set([]); setTag(''); pdf.value = ''; sayPdf(HINT_PDF); },
    edit(n) {
      setTag(n.tag);
      img.set([n.image_path, ...(n.gallery || [])]);
      pdf.value = ''; sayPdf(n.file_path ? `ไฟล์เดิม: ${n.file_name || 'PDF'} · เลือกไฟล์ใหม่เพื่อแทนที่` : HINT_PDF);
    },
    /** อัปโหลดรูปใหม่/ไฟล์ที่เลือก → { fields: ช่องที่ต้องบันทึก (image_path + gallery ตามลำดับในฟอร์มเสมอ), undo(): ลบไฟล์ที่เพิ่งอัปโหลด (ใช้เมื่อบันทึกข่าวไม่สำเร็จ) } */
    async upload(userId) {
      const fields = {}, done = [];
      const undo = () => done.forEach(([b, path]) => removeFiles(b, [path]));
      try {
        await img.ready();
        const paths = [];
        for (const x of img.items()) {
          if (x.path) { paths.push(x.path); continue; }
          const path = await uploadPublicImage(x.blob, `news/${userId}`); done.push(['public-images', path]); paths.push(path);
        }
        fields.image_path = paths[0] || null; fields.gallery = paths.slice(1);
        const f = pdf.files[0];
        if (f) { fields.file_path = await uploadNewsFile(f, userId); fields.file_name = f.name.slice(0, 200); done.push(['news-files', fields.file_path]); }
      } catch (e) { undo(); throw e; }
      return { fields, undo };
    },
  };
}

/** ลบรูป/PDF ของข่าว n — ส่ง fields เพื่อลบเฉพาะไฟล์เดิมที่ถูกเอาออก/แทนที่ (ไม่ส่ง = ลบทั้งหมด เช่น ลบข่าว) */
export function removeNewsFiles(n, fields = null) {
  const keep = fields && 'image_path' in fields ? new Set([fields.image_path, ...(fields.gallery || [])]) : null;
  const imgs = [n?.image_path, ...(n?.gallery || [])].filter((x) => x && (!fields || (keep && !keep.has(x))));
  if (imgs.length) removeFiles('public-images', imgs);
  if (n?.file_path && (!fields || fields.file_path)) removeFiles('news-files', [n.file_path]);
}

const PDF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>';
/** ลิงก์ไฟล์ภายนอก (เช่น PDF บทความต้นฉบับของข่าว AI) — เปิดแท็บใหม่ */
export const extFileLink = (url, label) => `<a class="file-link" href="${esc(url)}" target="_blank" rel="noopener">${PDF_SVG}<span>${esc(label)}</span></a>`;
/** ลิงก์ดาวน์โหลด PDF แนบข่าว (ใช้ทั้งหน้าอ่านข่าวและหน้าตรวจข่าว) */
export const fileLink = (n) => `<a class="file-link" href="${esc(newsFileUrl(n.file_path))}" target="_blank" rel="noopener" download="${esc(n.file_name || 'ไฟล์แนบ.pdf')}">${PDF_SVG}<span>ดาวน์โหลด ${esc(n.file_name || 'ไฟล์แนบ (PDF)')}</span></a>`;
