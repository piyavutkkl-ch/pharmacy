// ช่อง AI: สร้างข่าวจากบทความวิชาการ CCPE วันละ 1 ข่าว (รันใน GitHub Actions: .github/workflows/ai-news.yml)
//
//   node tools/ai_news/run.mjs --check     ตรวจว่าตอนนี้ต้องทำไหม (ยังไม่ได้ทำของวันนี้หลัง 06:00 น. หรือผู้ดูแลกด "สร้างข่าวตอนนี้") → พิมพ์ run=true|false
//   node tools/ai_news/run.mjs             ทำข่าว 1 ข่าว: เลือกบทความใหม่ → ดาวน์โหลด PDF → Gemini อ่าน PDF เขียนข่าว + เติมคำสั่งวาดภาพ
//                                          → AI วาดภาพ 1 ภาพ 3 ส่วน (อินโฟกราฟิก · การ์ตูน 3 ช่อง · แผนภูมิ/ตารางสำหรับบุคลากร — คำสั่งตามที่เจ้าของเว็บกำหนด IMAGE_PROMPT)
//                                          → บันทึกข่าว (รอตรวจ หรือเผยแพร่ทันที ตามค่าตั้ง)
//   ผู้วาดภาพ (ฟรีทั้งหมด ลองตามลำดับ): Gemini รุ่นวาดภาพ (ถ้าโควตาฟรีมี) → Cloudflare Workers AI (ถ้าตั้ง CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN)
//     → Pollinations (ไม่ต้องใช้คีย์) → วาดไม่ได้ทุกที่ = ใช้ภาพแม่แบบ 3 ภาพ (templates.mjs) แทน
//   node tools/ai_news/run.mjs --offline <fixtures> <out>   ทดสอบในเครื่องโดยไม่ใช้เน็ต/ฐานข้อมูลจริง (tests/ai_news/run.sh)
//
//   ค่าลับ (GitHub Secrets เท่านั้น): SUPABASE_SECRET_KEY, GEMINI_API_KEY (+ ไม่บังคับ CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN) · SUPABASE_URL อ่านจาก js/config.js
//   ส่งออกไปวาดภาพได้แค่เนื้อหาบทความสาธารณะ (ห้ามข้อมูลผู้ป่วย)
//   repo เป็นสาธารณะ: ห้าม log ค่าลับ · log ได้แค่ชื่อ/รหัสบทความ (ข้อมูลสาธารณะอยู่แล้ว)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { infographic, comic, clinical, SIZES } from './templates.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CCPE = 'https://ccpe.pharmacycouncil.org/';
const LIST_URL = CCPE + 'index.php?option=article&subpage=article';
const detailUrl = (id) => `${CCPE}index.php?option=article_detail&subpage=article_detail&id=${id}`;
const pdfUrl = (id) => `${CCPE}showfile.php?file=${id}`;
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const START_HOUR = 6, CANDIDATES = 8, MAX_PDF = 18 * 1024 * 1024, MAX_IMG = 1_000_000;

const args = process.argv.slice(2);
const OFFLINE = args[0] === '--offline' ? { dir: args[1], out: args[2] } : null;
const log = (...a) => console.log('ai-news:', ...a);

/* ---------------- เวลาไทย ---------------- */
const thaiNow = () => new Date(Date.now() + 7 * 3600_000);
const thaiDay = (d = thaiNow()) => d.toISOString().slice(0, 10);

/* ---------------- Supabase (secret key → ข้าม RLS) ---------------- */
function supa() {
  const cfg = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8');
  const url = process.env.SUPABASE_URL || cfg.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('ไม่พบ SUPABASE_URL หรือ SUPABASE_SECRET_KEY');
  const h = { apikey: key, Authorization: 'Bearer ' + key };
  const call = async (p, init = {}) => {
    const r = await fetch(url + p, { ...init, headers: { ...h, ...(init.headers || {}) } });
    const t = await r.text();
    if (!r.ok) throw new Error(`Supabase ${r.status} ${p.split('?')[0]}: ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : null;
  };
  return {
    get: (p) => call('/rest/v1/' + p),
    insert: (table, row) => call('/rest/v1/' + table, { method: 'POST', headers: { 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(row) }),
    upload: (p, buf, type) => call(`/storage/v1/object/public-images/${p}`, { method: 'POST', headers: { 'content-type': type, 'x-upsert': 'true' }, body: buf }),
  };
}

/* ---------------- CCPE ---------------- */
async function fetchText(url) {
  if (OFFLINE) {
    const id = url.match(/[?&]id=(\d+)/)?.[1];
    return fs.readFileSync(path.join(OFFLINE.dir, id ? `detail-${id}.html` : 'listing.html'), 'utf8');
  }
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (pharmacy-news-bot; +https://github.com)' } });
  if (!r.ok) throw new Error(`โหลด ${url} ไม่ได้ (HTTP ${r.status})`);
  return r.text();
}
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));

/** รหัสบทความในหน้ารวม (เรียงตามที่หน้าเว็บแสดง ไม่ซ้ำ) */
export function parseListing(html) {
  return [...new Set([...html.matchAll(/option=article_detail(?:&amp;|&)subpage=article_detail(?:&amp;|&)id=(\d+)/g)].map((m) => +m[1]))];
}
/** ข้อมูลบทความจากหน้ารายละเอียด (อ่านตามป้ายชื่อช่อง) */
export function parseDetail(html, id) {
  const text = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, '\n'));
  const lines = text.split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const after = (label) => { const i = lines.indexOf(label); return i >= 0 ? lines[i + 1] || '' : ''; };
  return {
    id, url: detailUrl(id), pdf: pdfUrl(id),
    title: after('ชื่อบทความ'), authors: after('ผู้เขียนบทความ'), producer: after('ผู้ผลิตบทความ'),
    approved: after('วันที่ได้รับการรับรอง'), expires: after('วันที่หมดอายุ'), abstract: after('บทคัดย่อ').slice(0, 3000), keywords: after('คำสำคัญ'),
  };
}

/* ---------------- Gemini (ฟรี: aistudio.google.com) ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** เรียก Gemini: ลองทีละรุ่นตามลำดับ · รุ่นไหนคนใช้เยอะ/โควตาเต็ม (429/5xx) รอแล้วลองใหม่ ก่อนเปลี่ยนไปรุ่นถัดไป */
async function gemini(models, body, { waits = [15_000, 45_000] } = {}) {
  const list = [].concat(models).filter(Boolean);
  if (OFFLINE) return JSON.parse(fs.readFileSync(path.join(OFFLINE.dir, String(list[0]).includes('image') ? 'gemini-image.json' : 'gemini.json'), 'utf8'));
  let last = new Error('Gemini: ไม่มีรุ่นให้ใช้');
  for (const model of list) {
    for (let i = 0; i <= waits.length; i++) {
      const r = await fetch(`${GEMINI}/models/${model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body: JSON.stringify(body),
      }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }));
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j;
      last = new Error(`Gemini ${model} HTTP ${r.status}: ${(j.error?.message || '').slice(0, 160)}`);
      if (![0, 429, 500, 502, 503, 504].includes(r.status) || i === waits.length) break;   // 4xx อื่น = รุ่นนี้ใช้ไม่ได้ → รุ่นถัดไป
      log(`${model} ไม่ว่าง (HTTP ${r.status}) รอ ${waits[i] / 1000} วินาทีแล้วลองใหม่`);
      await sleep(waits[i]);
    }
    log('เปลี่ยนรุ่น:', last.message.slice(0, 120));
  }
  throw last;
}
/** เลือกรุ่นที่ใช้ได้จริงกับคีย์นี้ (ชื่อรุ่นเปลี่ยนบ่อย จึงไม่ตายตัว) */
async function pickModels() {
  if (OFFLINE) return { text: ['offline-flash'], image: ['offline-image'] };
  const r = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini: คีย์ใช้ไม่ได้ (HTTP ${r.status}) ${(j.error?.message || '').slice(0, 150)}`);
  const ok = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace('models/', ''));
  const rank = (n) => (/pro/.test(n) ? 1 : 0) + (/lite/.test(n) ? 2 : 0) + (/preview|exp/.test(n) ? 1 : 0);
  const sorted = (xs) => xs.sort((a, b) => rank(a) - rank(b) || b.localeCompare(a));
  // ข้อความ: รุ่น flash ใหม่สุดก่อน แล้วสำรองรุ่นอื่น (รุ่นใหม่มักคนใช้เยอะจนไม่ว่าง) · ภาพ: รุ่น image (ไม่มี/โควตาไม่พอ = ใช้อีโมจิ)
  //   รุ่นใหม่สุด 2 รุ่น → รุ่นเสถียรเก่ากว่า (2.x มักว่างกว่า) → รุ่น lite → flash-latest · รวมไม่เกิน 6 รุ่น
  const flash = ok.filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/image|tts|audio|live|thinking/.test(n));
  const full = sorted(flash.filter((n) => !/lite/.test(n))), lite = sorted(flash.filter((n) => /lite/.test(n)));
  const older = full.filter((n) => n.split('-')[1]?.[0] !== full[0]?.split('-')[1]?.[0]);   // คนละรุ่นหลัก (เช่น 2.x เมื่อรุ่นใหม่สุดเป็น 3.x)
  const text = [...new Set([...full.slice(0, 2), ...older.slice(0, 2), ...lite.slice(0, 1), ...ok.filter((n) => /flash-latest/.test(n)), ...full.slice(2)])].slice(0, 6);
  const image = sorted(ok.filter((n) => /^gemini.*image/.test(n))).slice(0, 2);
  if (!text.length) throw new Error('Gemini: ไม่พบรุ่นที่ใช้สร้างข้อความได้');
  return { text, image };
}
const textOf = (j) => (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
const jsonOf = (j) => { const t = textOf(j).replace(/^```(?:json)?\s*|\s*```$/g, '').trim(); return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); };

const PICK_PROMPT = (arts) => `คุณเป็นเภสัชกรงานปฐมภูมิของโรงพยาบาลชุมชน เลือก "1 บทความ" ที่เหมาะที่สุดสำหรับทำข่าวความรู้เรื่องยาให้ประชาชนและเจ้าหน้าที่ รพ.สต. อ่าน
(เรื่องใกล้ตัว ใช้ได้จริงในชุมชน เช่น การใช้ยา โรคเรื้อรัง ความปลอดภัยด้านยา · หลีกเลี่ยงเรื่องสถิติ/การวิจัย/กฎหมายล้วน ถ้ามีตัวเลือกอื่น)
ตอบเป็น JSON เท่านั้น: {"id": <เลข id>, "reason": "<เหตุผลสั้น ๆ>"}
${arts.map((a) => `- id ${a.id}: ${a.title}\n  บทคัดย่อ: ${a.abstract.slice(0, 600)}`).join('\n')}`;

const WRITE_PROMPT = (a) => `คุณเป็นเภสัชกรผู้เขียนข่าวความรู้เรื่องยาให้หน้าเว็บโรงพยาบาลควนกาหลง จ.สตูล (ผู้อ่าน: ประชาชนทั่วไป ผู้ป่วย และเจ้าหน้าที่ รพ.สต.)
อ่านบทความ PDF ที่แนบ ("${a.title}" โดย ${a.authors}) แล้วเขียนข่าวภาษาไทยสั้น อ่านเข้าใจง่าย
กติกา:
- ใช้เฉพาะข้อมูลที่อยู่ในบทความ ห้ามแต่งตัวเลข ขนาดยา หรือข้อสรุปที่บทความไม่ได้บอก · ถ้าบทความไม่มีขนาดยา ห้ามใส่ขนาดยา
- ภาษาสุภาพ เป็นกันเอง ประโยคสั้น ศัพท์เทคนิคให้วงเล็บคำอธิบาย · ไม่ชักชวนให้ซื้อยาหรือใช้ยาเอง · ย้ำให้ปรึกษาแพทย์/เภสัชกร
- ไม่คัดลอกข้อความยาว ๆ จากบทความ ให้สรุปด้วยคำของตัวเอง
ตอบเป็น JSON เท่านั้น ตามโครงนี้:
{
 "title": "หัวข้อข่าว ไม่เกิน 90 ตัวอักษร ชวนอ่านแต่ถูกต้อง",
 "lead": "1-2 ประโยคนำ บอกว่าเรื่องนี้สำคัญกับผู้อ่านอย่างไร",
 "paragraphs": ["ย่อหน้าสั้น 3-5 ย่อหน้า สำหรับประชาชน"],
 "tips": ["ข้อควรรู้/ข้อปฏิบัติ 3-5 ข้อ แต่ละข้อไม่เกิน 1 บรรทัด"],
 "for_professionals": "สรุปประเด็นสำคัญสำหรับบุคลากรทางการแพทย์ 2-3 ประโยค",
 "infographic": {"headline": "ไม่เกิน 40 ตัวอักษร", "subhead": "ไม่เกิน 90 ตัวอักษร", "hero_emoji": "อีโมจิ 1-2 ตัวแทนเรื่อง",
   "points": [{"emoji": "อีโมจิ 1 ตัว", "title": "ไม่เกิน 25 ตัวอักษร", "text": "ไม่เกิน 90 ตัวอักษร"}] (4 ข้อพอดี), "note": "ข้อความเตือนสั้น ๆ"},
 "comic": {"title": "ชื่อตอนการ์ตูน สนุก ไม่เกิน 40 ตัวอักษร",
   "panels": [{"emoji": "อีโมจิ 2-3 ตัวเล่าฉาก", "speech": "คำพูดตัวละคร ไม่เกิน 60 ตัวอักษร", "caption": "คำบรรยายใต้ภาพ ไม่เกิน 80 ตัวอักษร"}] (3 ช่องพอดี เล่าแบบมุกตลกเบา ๆ ช่องสุดท้ายชวนอ่านข่าวต่อ)},
 "clinical": {"title": "หัวข้อสำหรับบุคลากร ไม่เกิน 60 ตัวอักษร",
   "flow": [{"step": "ขั้น/เงื่อนไข ไม่เกิน 50 ตัวอักษร", "detail": "สิ่งที่ควรทำ ไม่เกิน 90 ตัวอักษร"}] (3-6 ขั้น),
   "table": {"caption": "ชื่อตาราง", "columns": ["2-4 คอลัมน์"], "rows": [["ข้อมูลตามคอลัมน์ 3-7 แถว"]]}, "notes": ["หมายเหตุ 1-3 ข้อ"]},
 "image": {"_": "ข้อมูลสำหรับเติมคำสั่งวาดภาพ เขียนเป็นภาษาอังกฤษสั้น ๆ ทุกช่อง (โปรแกรมวาดภาพเขียนตัวอักษรอังกฤษได้ดีกว่าไทย) ใช้ข้อมูลจากบทความเท่านั้น",
   "infographic": {"title": "หัวข้อหลัก ตัวพิมพ์ใหญ่ ไม่เกิน 6 คำ เช่น DIABETES MANAGEMENT PROTOCOL", "overview": "กลไก/ภาพรวมสั้น ๆ ไม่เกิน 20 คำ", "interventions": "วิธีการรักษา/ข้อดี 2-4 อย่าง คั่นด้วยจุลภาค", "outcomes": "ผลลัพธ์ที่คาดหวัง 2-3 อย่าง", "colors": "โทนสี 3 สี เช่น dark teal, navy blue, and soft white"},
   "comic": {"character": "ตัวละครหลักน่ารักที่เกี่ยวกับเรื่อง เช่น A cute kidney character", "problem": "ปัญหา/สถานการณ์เดิม", "emotion": "อารมณ์ เช่น tired/stressed", "complaint": "คำพูดตลก ๆ หรือบ่น ไม่เกิน 8 คำ", "solution": "ทางแก้ปัญหา/ยา/แนวทางใหม่จากบทความ", "result": "ผลลัพธ์ที่ดีขึ้น"},
   "clinical": {"title": "ชื่อแนวทางสำหรับบุคลากร ตัวพิมพ์ใหญ่ ไม่เกิน 6 คำ", "start": "จุดเริ่มต้น เช่น Patient Screening", "branch": "ทางแยกการตัดสินใจ เช่น BP > 140/90 vs BP < 140/90", "action": "การรักษา/ส่งต่อ เช่น Standard Care / Consult Doctor", "table": "ข้อมูลที่เปรียบเทียบในตาราง เช่น Drug classifications, dosages, side effects", "colors": "โทนสี เช่น Slate blue, dark grey, muted teal"}}
}`;

/* ---------------- ภาพ ---------------- */
function loadPlaywright() {
  const req = createRequire(path.join(ROOT, 'tests/ui/package.json'));
  try { return req('playwright'); } catch { return createRequire(import.meta.url)('playwright'); }
}
async function render(browser, kind, html) {
  const [w, h] = SIZES[kind];
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  try {
    await p.setContent(html, { waitUntil: 'load', timeout: 30000 });
    await p.evaluate(() => document.fonts?.ready).catch(() => {});
    if (kind === 'clinical') {   // สูงตามเนื้อหา (ไม่เหลือที่ว่างล่างภาพ) แต่ไม่เตี้ยกว่าจัตุรัส และไม่สูงเกิน A4
      const need = await p.evaluate(() => document.body.scrollHeight);
      await p.setViewportSize({ width: w, height: Math.min(h, Math.max(w, need)) });
    }
    for (const q of [85, 75, 62, 50]) {
      const buf = await p.screenshot({ type: 'jpeg', quality: q });
      if (buf.length <= MAX_IMG) return buf;
    }
    throw new Error(`ภาพ ${kind} ใหญ่เกิน 1 MB`);
  } finally { await p.close(); }
}
/* ---------------- ภาพ AI 1 ภาพ 3 ส่วน (คำสั่งตามที่เจ้าของเว็บกำหนด) ---------------- */
const en = (v, d, n = 160) => clip(String(v ?? '').replace(/["'`]/g, ''), n) || d;
/** คำสั่งวาดภาพ: "สร้างภาพ โดยสร้างออกมาแค่รูปเดียว แต่มี 3 ส่วน" + Universal Prompt 3 แบบ เติมข้อมูลจากบทความ (Gemini เติมให้ใน g.image) */
export function imagePrompt(im = {}) {
  const i = im.infographic || {}, c = im.comic || {}, k = im.clinical || {};
  return [
    'Create ONLY ONE single image: a tall portrait poster divided into 3 clearly separated sections stacked from top to bottom, with thin divider lines. Use short, correctly spelled English text only.',
    `SECTION 1 (top): An informative medical infographic poster titled '${en(i.title, 'MEDICATION KNOWLEDGE', 60)}'. Flat modern vector graphic design, clean and minimalist layout. Features 3 main sections: 1. Core Mechanism/Overview: ${en(i.overview, 'how the treatment works')}. 2. Key Interventions: ${en(i.interventions, 'medication, lifestyle')}. 3. Target Outcomes: ${en(i.outcomes, 'better health')}. Professional medical color palette of ${en(i.colors, 'dark teal, navy blue, and soft white', 80)}. Clean typography, precise medical icons, organized visual hierarchy.`,
    `SECTION 2 (middle): A funny 3-panel comic strip in 2D hand-drawn editorial cartoon style with speech bubbles. Panel 1: ${en(c.character, 'A cute pill character')} dealing with ${en(c.problem, 'a health problem')}, looking ${en(c.emotion, 'stressed', 40)} and saying '${en(c.complaint, 'Oh no!', 60)}'. Panel 2: The character discovers/transforms using ${en(c.solution, 'the right medication')} with energy sparks, caption 'NEW SOLUTION!'. Panel 3: The character happily performing ${en(c.result, 'well')}, with a patient looking surprised and happy. Comic book art, vibrant watercolors, expressive faces, humorous and lighthearted tone.`,
    `SECTION 3 (bottom): A professional clinical flowchart and decision matrix poster for healthcare providers titled '${en(k.title, 'CLINICAL WORKFLOW', 60)}'. Clean, minimalist medical data visualization layout. Left side: A detailed clinical decision tree starting from ${en(k.start, 'Patient Assessment', 80)} -> ${en(k.branch, 'decision point', 100)} -> ${en(k.action, 'Treatment / Referral', 100)}. Right side: Structured comparison tables showing ${en(k.table, 'drug options and key points', 120)}. ${en(k.colors, 'Slate blue, dark grey, muted teal', 80)} color scheme with clear boxes, step-by-step arrows, color-coded sections, and crisp readable typography. No visual noise.`,
  ].join('\n');
}
const dataUrl = (buf, type) => `data:${type || 'image/png'};base64,${Buffer.from(buf).toString('base64')}`;
let geminiArtOff = false;
/** ผู้วาดภาพแต่ละเจ้า → data URL หรือ null (ไม่ได้ = ลองเจ้าถัดไป) · log แค่สาเหตุ ไม่ log ค่าลับ */
const PAINTERS = [
  ['Gemini', async (prompt, models) => {
    if (!models.image?.length || geminiArtOff) return null;
    try {
      const j = await gemini(models.image, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }, { waits: [15_000] });
      const part = (j.candidates?.[0]?.content?.parts || []).find((x) => (x.inlineData || x.inline_data)?.data);
      const d = part && (part.inlineData || part.inline_data);
      return d ? `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}` : null;
    } catch (e) { if (/HTTP (429|403|404)/.test(e.message)) geminiArtOff = true; throw e; }
  }],
  ['Cloudflare', async (prompt) => {
    const acc = process.env.CLOUDFLARE_ACCOUNT_ID, tok = process.env.CLOUDFLARE_API_TOKEN;
    if (OFFLINE || !acc || !tok) return null;
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
      method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ prompt: prompt.slice(0, 2048), steps: 8 }),
      signal: AbortSignal.timeout(120_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.result?.image) throw new Error(`HTTP ${r.status} ${(j.errors?.[0]?.message || '').slice(0, 120)}`);
    return `data:image/jpeg;base64,${j.result.image}`;
  }],
  ['Pollinations', async (prompt, _m, seed) => {
    if (OFFLINE) return null;
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 2400))}?width=1024&height=1536&model=flux&nologo=true&private=true&seed=${seed}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) throw new Error(`HTTP ${r.status} ${type}`);
    return dataUrl(await r.arrayBuffer(), type);
  }],
];
/** วาดภาพ 1 ภาพ 3 ส่วน → { src: data URL, by: ชื่อผู้วาด } หรือ null */
async function paint(prompt, models, seed) {
  for (const [name, fn] of PAINTERS) {
    try { const src = await fn(prompt, models, seed); if (src) { log('วาดภาพด้วย', name); return { src, by: name }; } }
    catch (e) { log(`วาดภาพด้วย ${name} ไม่ได้:`, String(e.message).slice(0, 160)); }
  }
  return null;
}
/** ภาพจาก AI → JPEG ไม่เกิน 1 MB (ด้านยาวไม่เกิน 1754 = A4 · ไม่ขยายภาพเล็ก) */
async function toJpeg(browser, src) {
  const p = await browser.newPage({ viewport: { width: 800, height: 800 } });
  try {
    await p.setContent(`<html><body style="margin:0;background:#fff"><img id="i" src="${src}" style="display:block;width:100%;height:100%;object-fit:contain"></body></html>`, { waitUntil: 'load', timeout: 30000 });
    const [nw, nh] = await p.$eval('#i', (i) => [i.naturalWidth, i.naturalHeight]);
    if (!nw || !nh) throw new Error('เปิดภาพจาก AI ไม่ได้');
    const k = Math.min(1, 1754 / Math.max(nw, nh));
    await p.setViewportSize({ width: Math.round(nw * k), height: Math.round(nh * k) });
    for (const q of [88, 78, 66, 54]) {
      const buf = await p.screenshot({ type: 'jpeg', quality: q });
      if (buf.length <= MAX_IMG) return buf;
    }
    throw new Error('ภาพจาก AI ใหญ่เกิน 1 MB');
  } finally { await p.close(); }
}

/* ---------------- ประกอบข่าว ---------------- */
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export function buildBody(g) {
  const out = [clip(g.lead, 400), ...(g.paragraphs || []).slice(0, 6).map((p) => clip(p, 900))];
  const tips = (g.tips || []).slice(0, 6).map((t) => '• ' + clip(t, 200));
  if (tips.length) out.push('ข้อควรรู้', ...tips);
  if (g.for_professionals) out.push('สำหรับบุคลากรทางการแพทย์: ' + clip(g.for_professionals, 800));
  out.push('ข่าวนี้สรุปโดย AI จากบทความวิชาการ และผ่านการตรวจทานก่อนเผยแพร่ · ข้อมูลเพื่อความรู้ ไม่ใช้แทนคำแนะนำของแพทย์หรือเภสัชกร');
  return out.filter(Boolean).join('\n');
}

async function status(db, row) { if (!OFFLINE) await db.insert('ai_news_log', row).catch((e) => log('บันทึก log ไม่ได้:', e.message)); }

async function main() {
  const db = OFFLINE ? null : supa();
  const settings = OFFLINE ? { auto: 'off', request: '' }
    : Object.fromEntries((await db.get("site_texts?select=key,body&key=in.(ai_news_auto,ai_news_request)")).map((r) => [r.key === 'ai_news_auto' ? 'auto' : 'request', r.body]));
  const logs = OFFLINE ? JSON.parse(fs.readFileSync(path.join(OFFLINE.dir, 'log.json'), 'utf8'))
    : await db.get('ai_news_log?select=article_id,status,created_at&order=created_at.desc&limit=500');
  const last = logs[0]?.created_at || '';
  const requested = !!settings.request && !isNaN(Date.parse(settings.request)) && (!last || Date.parse(settings.request) > Date.parse(last));
  // วันละ 1 ข่าว: ทำแล้ว/ไม่มีบทความใหม่ = พอสำหรับวันนี้ · ไม่สำเร็จ (เช่น AI ไม่ว่าง) = ลองใหม่รอบชั่วโมงถัดไป ไม่เกินวันละ 3 ครั้ง
  const today = logs.filter((l) => thaiDay(new Date(new Date(l.created_at).getTime() + 7 * 3600_000)) === thaiDay());
  const finishedToday = today.some((l) => l.status !== 'error'), errorsToday = today.filter((l) => l.status === 'error').length;
  const due = requested || (!finishedToday && errorsToday < 3 && thaiNow().getUTCHours() >= START_HOUR);

  if (args[0] === '--check') {
    log(requested ? 'มีคำสั่ง "สร้างข่าวตอนนี้"' : due ? `ถึงเวลาทำข่าวของวันนี้${errorsToday ? ` (ลองใหม่ครั้งที่ ${errorsToday + 1})` : ''}` : 'วันนี้ทำแล้ว/ยังไม่ถึงเวลา');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `run=${due}\n`);
    return;
  }
  if (!OFFLINE && !process.env.GEMINI_API_KEY) {
    await status(db, { status: 'error', note: 'ยังไม่ได้ตั้งค่าคีย์ GEMINI_API_KEY ใน GitHub Secrets' });
    console.log('::warning::ยังไม่ได้ตั้ง GEMINI_API_KEY — ข้ามรอบนี้'); return;
  }

  const done = new Set(logs.filter((l) => l.status !== 'error').map((l) => l.article_id));
  const ids = parseListing(await fetchText(LIST_URL)).filter((id) => !done.has(id)).slice(0, CANDIDATES);
  if (!ids.length) { await status(db, { status: 'skipped', note: 'ยังไม่มีบทความใหม่ใน CCPE' }); log('ไม่มีบทความใหม่'); return; }
  const arts = [];
  for (const id of ids) { try { const a = parseDetail(await fetchText(detailUrl(id)), id); if (a.title) arts.push(a); } catch (e) { log('ข้าม', id, e.message); } }
  if (!arts.length) throw new Error('อ่านหน้ารายละเอียดบทความไม่ได้ (หน้าเว็บ CCPE อาจเปลี่ยนรูปแบบ)');

  const models = await pickModels();
  log('รุ่น AI:', models.text.join(', '), '· ภาพ:', models.image.join(', ') || '(Gemini ไม่มีรุ่นวาดภาพ)');
  let art = arts[0];
  if (arts.length > 1) {
    try {
      const pick = jsonOf(await gemini(models.text, { contents: [{ parts: [{ text: PICK_PROMPT(arts) }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }));
      art = arts.find((a) => a.id === +pick.id) || art;
      log('เลือกบทความ', art.id, '-', clip(pick.reason, 120));
    } catch (e) { log('เลือกบทความไม่ได้ ใช้บทความล่าสุด:', e.message.slice(0, 120)); }
  }
  let row = null;
  try {
    let pdf;
    if (OFFLINE) pdf = fs.readFileSync(path.join(OFFLINE.dir, 'article.pdf'));
    else {
      const r = await fetch(art.pdf);
      if (!r.ok || !/pdf/i.test(r.headers.get('content-type') || '')) throw new Error(`ดาวน์โหลด PDF ไม่ได้ (HTTP ${r.status})`);
      pdf = Buffer.from(await r.arrayBuffer());
    }
    if (pdf.length > MAX_PDF) throw new Error(`PDF ใหญ่เกิน ${MAX_PDF / 1048576} MB`);
    const g = jsonOf(await gemini(models.text, {
      contents: [{ parts: [{ inlineData: { mimeType: 'application/pdf', data: pdf.toString('base64') } }, { text: WRITE_PROMPT(art) }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
    }));
    if (!g.title || !(g.paragraphs || []).length) throw new Error('AI ตอบไม่ครบ (ไม่มีหัวข้อ/เนื้อหา)');

    const pw = loadPlaywright();
    const browser = await pw.chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
    let imgs, painter = '';
    try {
      // ภาพหลัก: AI วาด 1 ภาพ 3 ส่วน จากข้อมูลในไฟล์บทความ · วาดไม่ได้ทุกเจ้า = ภาพแม่แบบ 3 ภาพ (ตัวหนังสือไทยชัด)
      const ai = await paint(imagePrompt(g.image), models, art.id);
      if (ai) { imgs = { ai: await toJpeg(browser, ai.src) }; painter = ai.by; }
      else {
        log('วาดภาพ AI ไม่ได้ทุกเจ้า → ใช้ภาพแม่แบบ 3 ภาพ');
        imgs = {
          infographic: await render(browser, 'infographic', infographic(g.infographic || {})),
          comic: await render(browser, 'comic', comic(g.comic || {})),
          clinical: await render(browser, 'clinical', clinical(g.clinical || {})),
        };
      }
    } finally { await browser.close(); }

    const stamp = thaiDay().replace(/-/g, '');
    const paths = {};
    for (const [k, buf] of Object.entries(imgs)) {
      paths[k] = `ai/${art.id}/${stamp}-${k}.jpg`;
      if (OFFLINE) { fs.mkdirSync(OFFLINE.out, { recursive: true }); fs.writeFileSync(path.join(OFFLINE.out, `${k}.jpg`), buf); } else await db.upload(paths[k], buf, 'image/jpeg');
    }
    row = {
      title: clip(g.title, 200), tag: 'ความรู้', body: buildBody(g), status: settings.auto === 'on' ? 'published' : 'pending',
      image_path: paths.ai || paths.infographic, gallery: paths.ai ? [] : [paths.comic, paths.clinical], ai_generated: true,
      source_url: art.url, source_file_url: art.pdf, source_title: clip(`${art.title}${art.authors ? ' — ' + art.authors : ''}`, 300),
    };
    if (OFFLINE) { fs.writeFileSync(path.join(OFFLINE.out, 'news.json'), JSON.stringify({ article: art, row, painter, prompt: imagePrompt(g.image) }, null, 2)); log('offline: บันทึกที่', OFFLINE.out); return; }
    const [news] = await db.insert('news', row);
    await status(db, { article_id: art.id, title: clip(art.title, 300), news_id: news.id, status: 'done', note: `${row.status === 'published' ? 'เผยแพร่อัตโนมัติ' : 'รอผู้ดูแลตรวจ'} · ${painter ? 'ภาพวาดโดย AI (' + painter + ')' : 'ภาพแม่แบบ (AI วาดภาพไม่ได้)'}` });
    log('สร้างข่าวแล้ว:', news.id, row.status);
  } catch (e) {
    await status(db, { article_id: art.id, title: clip(art.title, 300), status: 'error', note: clip(e.message, 900) });
    throw e;
  }
}

main().catch((e) => { console.log(`::error::${String(e.message).slice(0, 300)}`); process.exit(1); });
