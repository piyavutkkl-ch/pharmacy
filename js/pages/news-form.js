// ฟอร์มข่าวที่ใช้ร่วมกัน (เจ้าหน้าที่ #sn… ใน staff.js / ผู้ดูแล #an… ใน admin-news.js)
//   ประเภทข่าว · รูปประกอบ (ย่อไม่เกิน A4 + แสดงตัวอย่างทันที) · ไฟล์ PDF แนบให้ผู้อ่านดาวน์โหลด
import { publicImageUrl } from '../supabase.js?v=4.4';
import { $, esc } from '../util.js?v=4.4';
import { A4, imagePicker, uploadPublicImage, uploadNewsFile, removeFiles, extOf, newsFileUrl } from '../upload.js?v=4.4';

export const NEWS_TAGS = ['ข่าว', 'ประชาสัมพันธ์', 'ความรู้'];
const HINT_IMG = 'ระบบย่อรูปให้ไม่เกินขนาด A4 อัตโนมัติ';
const HINT_PDF = 'ผู้อ่านข่าวดาวน์โหลดไฟล์นี้ได้';

export function newsForm(p) {
  const img = imagePicker($(`#${p}Image`), $(`#${p}ImagePreview`), $(`#${p}ImageNote`), { fit: A4 });
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
    reset() { img.reset(); setTag(''); pdf.value = ''; sayPdf(HINT_PDF); $(`#${p}ImageNote`).textContent = HINT_IMG; },
    edit(n) {
      setTag(n.tag);
      img.showExisting(n.image_path ? publicImageUrl(n.image_path) : '', n.image_path ? 'รูปเดิม · เลือกรูปใหม่เพื่อเปลี่ยน' : HINT_IMG);
      pdf.value = ''; sayPdf(n.file_path ? `ไฟล์เดิม: ${n.file_name || 'PDF'} · เลือกไฟล์ใหม่เพื่อแทนที่` : HINT_PDF);
    },
    /** อัปโหลดรูป/ไฟล์ที่เลือก → { fields: ช่องที่ต้องบันทึก, undo(): ลบไฟล์ที่เพิ่งอัปโหลด (ใช้เมื่อบันทึกข่าวไม่สำเร็จ) } */
    async upload(userId) {
      const fields = {}, done = [];
      const undo = () => done.forEach(([b, path]) => removeFiles(b, [path]));
      try {
        const blob = await img.ready();
        if (blob) { fields.image_path = await uploadPublicImage(blob, `news/${userId}`); done.push(['public-images', fields.image_path]); }
        const f = pdf.files[0];
        if (f) { fields.file_path = await uploadNewsFile(f, userId); fields.file_name = f.name.slice(0, 200); done.push(['news-files', fields.file_path]); }
      } catch (e) { undo(); throw e; }
      return { fields, undo };
    },
  };
}

/** ลบรูป/PDF ของข่าว n — ส่ง fields เพื่อลบเฉพาะไฟล์เดิมที่ถูกแทนที่ (ไม่ส่ง = ลบทั้งหมด เช่น ลบข่าว) */
export function removeNewsFiles(n, fields = null) {
  if (n?.image_path && (!fields || fields.image_path)) removeFiles('public-images', [n.image_path]);
  if (n?.file_path && (!fields || fields.file_path)) removeFiles('news-files', [n.file_path]);
}

const PDF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>';
/** ลิงก์ดาวน์โหลด PDF แนบข่าว (ใช้ทั้งหน้าอ่านข่าวและหน้าตรวจข่าว) */
export const fileLink = (n) => `<a class="file-link" href="${esc(newsFileUrl(n.file_path))}" target="_blank" rel="noopener" download="${esc(n.file_name || 'ไฟล์แนบ.pdf')}">${PDF_SVG}<span>ดาวน์โหลด ${esc(n.file_name || 'ไฟล์แนบ (PDF)')}</span></a>`;
