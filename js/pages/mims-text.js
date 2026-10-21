// ข้อความหน้า MIMS ที่ผู้ดูแลวาง (คัดลอกจากหน้าเว็บ หรือข้อความจาก PDF ที่พิมพ์หน้า MIMS) → แยกหัวข้ออัตโนมัติ (ทำในเบราว์เซอร์ ไม่ใช้ AI)
//   ตัดส่วนที่ไม่ใช่เนื้อหา: ลิงก์หัว/ท้ายหน้า · วันเวลาที่พิมพ์ · "Page x of y" · โฆษณา · Disclaimer / Related Diseases / เมนูท้ายหน้า
//   หัวข้อหลักตามหน้า MIMS (HEADS) → [{title, body}] · ชื่อการค้าในไทย (What are the brands available…) → หัวข้อ Brands
//   ข้อบ่งใช้และขนาดยา → การ์ดข้อบ่งใช้ (ข้อบ่งใช้ × กลุ่มผู้ป่วย) พร้อมข้อความต้นฉบับ (quote) ให้เภสัชกรกรอกตัวเลขเอง (skip = ยังไม่ได้แปลงเป็นตัวเลข · ไม่เดาตัวเลข)
//   ข้อมูล MIMS เป็นข้อมูลสมาชิก: เก็บใน drug_mims (ผู้ดูแลเท่านั้น) · ห้ามใส่ข้อความ MIMS จริงลงไฟล์ใน repo (การทดสอบใช้ข้อความสมมติ)
export const HEADS = ['Indications and Dosage', 'Special Patient Group', 'Administration', 'Reconstitution', 'Incompatibility', 'Contraindications', 'Special Precautions',
  'Adverse Reactions', 'Patient Counseling Information', 'Monitoring Parameters', 'Overdosage', 'Drug Interactions', 'Food Interaction', 'Lab Interference', 'Action',
  'Chemical Structure', 'Storage', 'MIMS Class', 'ATC Classification', 'Pregnancy Category (US FDA)', 'References'];
export const HEAD_TH = { 'Indications and Dosage': 'ข้อบ่งใช้และขนาดยา', 'Special Patient Group': 'ผู้ป่วยกลุ่มพิเศษ', Administration: 'วิธีให้ยา', Reconstitution: 'การผสมยา',
  Incompatibility: 'ความไม่เข้ากันของยา', Contraindications: 'ข้อห้ามใช้', 'Special Precautions': 'ข้อควรระวัง', 'Adverse Reactions': 'อาการไม่พึงประสงค์',
  'Patient Counseling Information': 'คำแนะนำผู้ป่วย', 'Monitoring Parameters': 'การติดตาม', Overdosage: 'ยาเกินขนาด', 'Drug Interactions': 'ยาตีกัน', 'Food Interaction': 'อาหาร',
  'Lab Interference': 'ผลต่อการตรวจทางห้องปฏิบัติการ', Action: 'การออกฤทธิ์ · เภสัชจลนศาสตร์', 'Chemical Structure': 'โครงสร้าง', Storage: 'การเก็บรักษา', 'MIMS Class': 'กลุ่มยา (MIMS)',
  'ATC Classification': 'ATC', 'Pregnancy Category (US FDA)': 'การใช้ในหญิงตั้งครรภ์', References: 'เอกสารอ้างอิง', Brands: 'ชื่อการค้าในไทย' };
const ROUTES = /^(Oral|Intravenous|IV|Intramuscular|IM|Subcutaneous|SC|Topical\/Cutaneous|Topical|Rectal|Ophthalmic|Otic|Nasal|Inhalation|Sublingual|Transdermal|Vaginal|Parenteral|Buccal)$/i;
const POPS = { Adult: 'ผู้ใหญ่', Child: 'เด็ก', Elderly: 'ผู้สูงอายุ', Infant: 'ทารก', Neonate: 'ทารกแรกเกิด', Adolescent: 'วัยรุ่น' };
const POP_RE = new RegExp(`^(${Object.keys(POPS).join('|')})s?:\\s*`);
const STOP = /^(Disclaimer:|Related Diseases|MIMS Drugs V\d|Copyright ©)/;
const NOISE = [/^https?:\/\/\S+$/, /^\d{1,2}\/\d{1,2}\/\d{4}(\s*BE)?,?\s*\d{1,2}:\d{2}$/, /^Page \d+ of \d+$/i, /^Advertisement for Healthcare Professionals only$/i, /^>\s*Drugs\s*>?$/,
  /^Generic Medicine Info$/i, /^This information is not country-specific/i, /^Other Known Brands$/i, /^See More\s*$/i, /^\d+\s*\/\s*\d+$/, /^[‹›]$/];
const okUrl = (u) => (typeof u === 'string' && /^https:\/\/(www\.)?mims\.com\//.test(u) && u.length <= 300 ? u : null);

/** ข้อความ PDF ตัดบรรทัดกลางประโยค → ต่อบรรทัดที่ยาวและไม่จบประโยค (ยกเว้นบรรทัดถัดไปขึ้นหัวข้อย่อย เช่น "Adult:") */
function joinWrapped(lines) {
  const out = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev != null && prev.length >= 70 && !/[.:;]$/.test(prev) && !POP_RE.test(l) && !ROUTES.test(l) && !/^[A-Z][A-Za-z ()/-]{2,40}:/.test(l)) out[out.length - 1] = `${prev} ${l}`;
    else out.push(l);
  }
  return out;
}

/** แยกข้อความหน้า MIMS → { name, url, sections: [{title, body}], inds: [ข้อบ่งใช้รอกรอกตัวเลข], brands } */
export function parseMimsText(text, fallbackName = '') {
  const raw = String(text || '').replace(/\r/g, '').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬀ/g, 'ff').replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl').replace(/ /g, ' ');
  if (raw.length > 300000) throw new Error('ข้อความยาวเกินไป (เกิน 300,000 ตัวอักษร)');
  const urlM = /https:\/\/(?:www\.)?mims\.com\/[a-z]+\/drug\/info\/[a-z0-9-]+/i.exec(raw);
  const url = okUrl(urlM ? urlM[0] : null);
  const lines = raw.split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const sections = [], brands = [];
  let cur = null, name = '', mode = null;
  for (const l of lines) {
    if (STOP.test(l)) break;
    if (NOISE.some((re) => re.test(l))) continue;
    if (/^What are the brands available for .+\?$/i.test(l)) { mode = 'brands'; cur = null; continue; }
    const head = HEADS.find((h) => l.toLowerCase() === h.toLowerCase());
    if (head) { mode = 'body'; cur = { title: head, lines: [] }; sections.push(cur); continue; }
    if (mode === 'brands') { if (l.length <= 60) brands.push(l); continue; }
    if (!cur) { if (!name && l.length <= 120 && !/[.:]$/.test(l)) name = l; continue; }
    cur.lines.push(l);
  }
  const out = sections.map((s) => ({ title: s.title, body: joinWrapped(s.lines).join('\n').slice(0, 20000) })).filter((s) => s.body);
  if (brands.length) out.push({ title: 'Brands', body: [...new Set(brands)].slice(0, 80).join(', ') });
  const slug = url ? /\/drug\/info\/([a-z0-9-]+)/i.exec(url)[1].replace(/-plus-/g, ' + ').replace(/-/g, ' ') : '';
  const nm = (slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : '') || name || String(fallbackName || '').trim();
  const dose = out.find((s) => s.title === 'Indications and Dosage');
  return { name: nm.slice(0, 200), url, sections: out, inds: dose ? indCards(dose.body, url) : [], brands };
}

/** ข้อบ่งใช้และขนาดยา → การ์ด (ช่องทางให้ยา → ชื่อข้อบ่งใช้ → กลุ่มผู้ป่วย "Adult:" …) · ตัวเลขให้เภสัชกรกรอกจากข้อความ (ไม่เดา) */
export function indCards(body, url) {
  const lines = String(body || '').split('\n'), cards = [];
  let route = '', ind = [], pop = null;
  const flush = () => {
    if (!pop) return;
    const q = pop.text.join(' ').replace(/\s+/g, ' ').trim();
    const nm = `${ind.join(' ').trim() || 'ข้อบ่งใช้'} · ${POPS[pop.who] || pop.who}${route && !/^oral$/i.test(route) ? ` (${route})` : ''}`;
    cards.push({ name: nm.slice(0, 200), quote: q.slice(0, 400), route: route || null, pop: pop.who, skip: 'ยังไม่ได้แปลงเป็นตัวเลข · อ่านข้อความต้นฉบับแล้วกรอกขนาดยา', ...(url ? { ref: { label: 'MIMS Thailand', url } } : {}) });
    pop = null;
  };
  for (const l0 of lines) {
    const l = l0.trim(); if (!l) continue;
    if (ROUTES.test(l)) { flush(); route = l; ind = []; continue; }
    const m = POP_RE.exec(l);
    if (m) { flush(); pop = { who: m[1], text: [l.slice(m[0].length)] }; continue; }
    if (pop) pop.text.push(l); else ind.push(l);
  }
  flush();
  return cards.slice(0, 40);
}
/** ชื่อหัวข้อสำหรับแสดง (ไทย · อังกฤษ) */
export const headTh = (t) => (HEAD_TH[t] ? `${HEAD_TH[t]}` : t);
