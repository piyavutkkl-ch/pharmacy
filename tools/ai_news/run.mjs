// ช่อง AI: สร้างข่าวจากบทความวิชาการ CCPE วันละ 1 ข่าว (รันใน GitHub Actions: .github/workflows/ai-news.yml)
//
//   node tools/ai_news/run.mjs --check     ตรวจว่าตอนนี้ต้องทำไหม (ยังไม่ได้ทำของวันนี้หลัง 06:00 น. หรือผู้ดูแลกด "สร้างข่าวตอนนี้") → พิมพ์ run=true|false
//   node tools/ai_news/run.mjs             ทำข่าว 1 ข่าว: เลือกบทความใหม่ → ดาวน์โหลด PDF → ใช้ AI เต็มที่กับความถูกต้อง (ไม่ใช้ AI วาดภาพ):
//                                          ① วิเคราะห์ PDF ดึงข้อเท็จจริงพร้อมข้อความอ้างอิง/หน้า → ② เขียนข่าวจากข้อเท็จจริงนั้นเท่านั้น
//                                          → ③ ตรวจทานเทียบ PDF ทีละประโยค แก้จุดที่ไม่ตรง (สูงสุด 3 รอบ) · ยังพบจุดผิด = เข้าคิวรอผู้ดูแลตรวจเสมอ
//                                          → ภาพแม่แบบ 3 ภาพจากข้อมูลที่ตรวจแล้ว (templates.mjs: อินโฟกราฟิก · การ์ตูน 3 ช่อง · แผนภูมิสำหรับบุคลากร) → บันทึกข่าว
//                                          → ถอดข้อความ PDF เก็บใน news_sources (pdftotext ถ้ามี · ภาษาไทยเพี้ยน/ไม่มี = Gemini ถอด) ให้ผู้ดูแลตรวจข่าว/แบบทดสอบได้เร็ว
//                                            ไม่ต้องให้ AI เปิด PDF ซ้ำ (47_ai_news_check.sql) · ข่าว AI เดิมที่ยังไม่มี = เติมให้รอบละ 2 ข่าว
//   รุ่น AI: รุ่น pro (วิเคราะห์ละเอียดกว่า) ก่อน → โควตาฟรีหมด = รุ่น flash
//   node tools/ai_news/run.mjs --offline <fixtures> <out>   ทดสอบในเครื่องโดยไม่ใช้เน็ต/ฐานข้อมูลจริง (tests/ai_news/run.sh)
//
//   ค่าลับ (GitHub Secrets เท่านั้น): SUPABASE_SECRET_KEY, GEMINI_API_KEY · SUPABASE_URL อ่านจาก js/config.js
//   ส่งให้ AI ได้แค่บทความสาธารณะ (ห้ามข้อมูลผู้ป่วย)
//   repo เป็นสาธารณะ: ห้าม log ค่าลับ · log ได้แค่ชื่อ/รหัสบทความ (ข้อมูลสาธารณะอยู่แล้ว)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { infographic, comic, clinical, SIZES } from './templates.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CCPE = 'https://ccpe.pharmacycouncil.org/';
const LIST_URL = CCPE + 'index.php?option=article&subpage=article';
const detailUrl = (id) => `${CCPE}index.php?option=article_detail&subpage=article_detail&id=${id}`;
const pdfUrl = (id) => `${CCPE}showfile.php?file=${id}`;
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const START_HOUR = 6, CANDIDATES = 8, MAX_PDF = 18 * 1024 * 1024, MAX_IMG = 1_000_000, VERIFY_ROUNDS = 3;

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
    upsert: (table, row) => call('/rest/v1/' + table, { method: 'POST', headers: { 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(row) }),
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
const deadModels = new Set();   // โควตาฟรีของรุ่นนี้หมดแล้ว → ข้ามในขั้นถัดไป (ไม่เสียเวลารอ)
async function gemini(models, body, { waits = [15_000, 45_000], step = 'write' } = {}) {
  const list = [].concat(models).filter((m) => m && !deadModels.has(m));
  if (OFFLINE) {   // คำตอบจำลองแยกตามขั้น: gemini-<step>.json (ไม่มี = gemini.json)
    const f = path.join(OFFLINE.dir, `gemini-${step}.json`);
    return JSON.parse(fs.readFileSync(fs.existsSync(f) ? f : path.join(OFFLINE.dir, 'gemini.json'), 'utf8'));
  }
  let last = new Error('Gemini: ไม่มีรุ่นให้ใช้');
  for (const model of list) {
    for (let i = 0; i <= waits.length; i++) {
      const r = await fetch(`${GEMINI}/models/${model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body: JSON.stringify(body),
      }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }));
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j;
      last = new Error(`Gemini ${model} HTTP ${r.status}: ${(j.error?.message || '').slice(0, 160)}`);
      if (r.status === 429 && /quota|exhausted|per day|limit: 0/i.test(j.error?.message || '')) { deadModels.add(model); break; }
      if (r.status === 404) { deadModels.add(model); break; }   // รุ่นเลิกให้บริการ/ไม่เปิดให้คีย์นี้ → ไม่ลองซ้ำในขั้นถัดไป
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
  if (OFFLINE) return { text: ['offline-pro', 'offline-flash'] };
  const r = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini: คีย์ใช้ไม่ได้ (HTTP ${r.status}) ${(j.error?.message || '').slice(0, 150)}`);
  const ok = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace('models/', ''));
  const rank = (n) => (/pro/.test(n) ? 1 : 0) + (/lite/.test(n) ? 2 : 0) + (/preview|exp/.test(n) ? 1 : 0);
  const sorted = (xs) => xs.sort((a, b) => rank(a) - rank(b) || b.localeCompare(a));
  // ความถูกต้องมาก่อน: รุ่น pro ใหม่สุด 2 รุ่น (วิเคราะห์ละเอียด · โควตาฟรีน้อย) → รุ่น flash ใหม่สุด 2 รุ่น → รุ่นเสถียรเก่ากว่า (2.x มักว่างกว่า)
  //   → รุ่น lite → flash-latest · รวมไม่เกิน 8 รุ่น
  const flash = ok.filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/image|tts|audio|live|thinking/.test(n));
  const full = sorted(flash.filter((n) => !/lite/.test(n))), lite = sorted(flash.filter((n) => /lite/.test(n)));
  const older = full.filter((n) => n.split('-')[1]?.[0] !== full[0]?.split('-')[1]?.[0]);   // คนละรุ่นหลัก (เช่น 2.x เมื่อรุ่นใหม่สุดเป็น 3.x)
  const pro = sorted(ok.filter((n) => /^gemini-[\d.]+-pro/.test(n) && !/image|tts|audio|live/.test(n)));
  const text = [...new Set([...pro.slice(0, 2), ...full.slice(0, 2), ...older.slice(0, 2), ...lite.slice(0, 1), ...ok.filter((n) => /flash-latest/.test(n)), ...full.slice(2)])].slice(0, 8);
  if (!text.length) throw new Error('Gemini: ไม่พบรุ่นที่ใช้สร้างข้อความได้');
  return { text };
}
const textOf = (j) => (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
const jsonOf = (j) => { const t = textOf(j).replace(/^```(?:json)?\s*|\s*```$/g, '').trim(); return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); };
/** ถาม AI แล้วอ่าน JSON · AI ตอบ JSON ไม่สมบูรณ์ (เช่น มีเครื่องหมายคำพูดในข้อความ) → ถามใหม่ ≤ tries ครั้ง (ไม่ล้มทั้งรอบ) */
export async function askJson(call, tries = 3) {
  for (let i = 0; ; i++) {
    const j = await call(i);
    try { return jsonOf(j); } catch (e) {
      if (i + 1 >= tries) throw new Error(`AI ตอบรูปแบบ JSON ไม่สมบูรณ์ ${tries} ครั้ง (${String(e.message).slice(0, 80)})`);
      log(`AI ตอบรูปแบบ JSON ไม่สมบูรณ์ (${String(e.message).slice(0, 80)}) ถามใหม่ครั้งที่ ${i + 2}`);
    }
  }
}

const PICK_PROMPT = (arts) => `คุณเป็นเภสัชกรงานปฐมภูมิของโรงพยาบาลชุมชน เลือก "1 บทความ" ที่เหมาะที่สุดสำหรับทำข่าวความรู้เรื่องยาให้ประชาชนและเจ้าหน้าที่ รพ.สต. อ่าน
(เรื่องใกล้ตัว ใช้ได้จริงในชุมชน เช่น การใช้ยา โรคเรื้อรัง ความปลอดภัยด้านยา · หลีกเลี่ยงเรื่องสถิติ/การวิจัย/กฎหมายล้วน ถ้ามีตัวเลือกอื่น)
ตอบเป็น JSON เท่านั้น: {"id": <เลข id>, "reason": "<เหตุผลสั้น ๆ>"}
${arts.map((a) => `- id ${a.id}: ${a.title}\n  บทคัดย่อ: ${a.abstract.slice(0, 600)}`).join('\n')}`;

const ANALYZE_PROMPT = (a) => `คุณเป็นเภสัชกรผู้ตรวจสอบข้อมูลวิชาการ อ่านบทความ PDF ที่แนบ ("${a.title}") อย่างละเอียดทุกหน้า รวมตาราง/รูป/บทสรุป
แล้วดึง "ข้อเท็จจริง" ที่จะใช้ทำข่าว โดยทุกข้อต้องมีข้อความจากบทความ (quote คัดลอกตรงตัวสั้น ๆ) และเลขหน้า เพื่อให้ตรวจย้อนกลับได้
ห้ามสรุปเกินกว่าที่บทความเขียน · ตัวเลข/ขนาดยา/ระยะเวลา/ชื่อยา คัดลอกให้ตรงตามบทความ · ถ้าบทความไม่ได้ระบุ ให้ใส่ null
ตอบเป็น JSON เท่านั้น:
{
 "topic": "บทความนี้เกี่ยวกับอะไร 1-2 ประโยค",
 "article_type": "เช่น ทบทวนวรรณกรรม / งานวิจัย / แนวทางเวชปฏิบัติ",
 "facts": [{"claim": "ข้อเท็จจริงภาษาไทย 1 ประโยค", "quote": "ข้อความต้นฉบับสั้น ๆ", "page": <เลขหน้า>}] (8-20 ข้อ ครอบคลุมประเด็นสำคัญ),
 "drugs": [{"name": "ชื่อยา", "dose": "ขนาดยาตามบทความ หรือ null", "use": "ใช้ทำอะไรตามบทความ", "page": <เลขหน้า>}],
 "evidence_strength": "ความหนักแน่นของหลักฐานตามที่บทความบอก",
 "limitations": ["ข้อจำกัด/ข้อควรระวังตามบทความ"],
 "conclusion": "ข้อสรุปของผู้เขียนบทความ ตามต้นฉบับ"
}`;

const WRITE_PROMPT = (a, facts) => `คุณเป็นเภสัชกรผู้เขียนข่าวความรู้เรื่องยาให้หน้าเว็บโรงพยาบาลควนกาหลง จ.สตูล (ผู้อ่าน: ประชาชนทั่วไป ผู้ป่วย และเจ้าหน้าที่ รพ.สต.)
อ่านบทความ PDF ที่แนบ ("${a.title}" โดย ${a.authors}) และ "ข้อเท็จจริงที่ตรวจแล้ว" ด้านล่าง แล้วเขียนข่าวภาษาไทยสั้น อ่านเข้าใจง่าย
กติกา (ความถูกต้องสำคัญที่สุด):
- ทุกประโยค ทุกตัวเลข ทุกชื่อยา/ขนาดยา ต้องมาจากข้อเท็จจริงที่ตรวจแล้วหรือจากบทความโดยตรง ห้ามแต่ง ห้ามเดา ห้ามเติมความรู้ทั่วไปที่บทความไม่ได้บอก
- คงระดับความมั่นใจตามบทความ (เช่น "อาจ", "ในการศึกษาขนาดเล็ก") ห้ามเขียนให้ดูแน่นอนกว่าที่บทความสรุป · ถ้าบทความไม่มีขนาดยา ห้ามใส่ขนาดยา
- ถ้าข้อมูลไม่พอสำหรับช่องไหน ให้เขียนสั้นลงหรือเว้นไว้ ดีกว่าใส่ข้อมูลที่ไม่มีในบทความ
- ภาษาสุภาพ เป็นกันเอง ประโยคสั้น ศัพท์เทคนิคให้วงเล็บคำอธิบาย · ไม่ชักชวนให้ซื้อยาหรือใช้ยาเอง · ย้ำให้ปรึกษาแพทย์/เภสัชกร
- ไม่คัดลอกข้อความยาว ๆ จากบทความ ให้สรุปด้วยคำของตัวเอง
ข้อเท็จจริงที่ตรวจแล้ว (JSON จากขั้นวิเคราะห์):
${JSON.stringify(facts).slice(0, 30000)}
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
   "table": {"caption": "ชื่อตาราง", "columns": ["2-4 คอลัมน์"], "rows": [["ข้อมูลตามคอลัมน์ 3-7 แถว"]]}, "notes": ["หมายเหตุ 1-3 ข้อ"]}
}`;

const VERIFY_PROMPT = (a, draft) => `คุณเป็นเภสัชกรผู้ตรวจทานข่าวก่อนเผยแพร่ หน้าที่คือทำให้ข่าวถูกต้องตามบทความ PDF ที่แนบ ("${a.title}") 100%
ตรวจ "ทุกประโยค" ในข่าว JSON ด้านล่าง (รวมข้อความในอินโฟกราฟิก การ์ตูน และแผนภูมิ/ตาราง) เทียบกับบทความ:
- ตัวเลข ขนาดยา ระยะเวลา ชื่อยา ข้อบ่งใช้ ผลการศึกษา ต้องตรงกับบทความ
- ห้ามมีข้อมูลที่บทความไม่ได้บอก (แม้จะเป็นความรู้ทั่วไปที่ถูก) · ห้ามเขียนแน่นอนเกินกว่าบทความ · ห้ามขัดกับข้อสรุป/ข้อจำกัดของบทความ
- ภาษาไทยถูกต้อง ไม่ชวนใช้ยาเอง
ถ้าพบจุดผิด ให้แก้ใน "corrected" (โครงเดียวกับข่าวเดิมทุกช่อง) โดยแก้เฉพาะจุดที่ผิด หรือตัดออกถ้าบทความไม่รองรับ · ถ้าไม่พบจุดผิดเลย ให้ issues เป็น [] และ corrected = ข่าวเดิม
ตอบเป็น JSON เท่านั้น: {"issues": [{"text": "ข้อความที่ผิด", "problem": "ผิดอย่างไร (อ้างหน้าในบทความ)", "fix": "แก้เป็น"}], "corrected": { ...ข่าว JSON ทั้งหมด... }}
ข่าวที่ต้องตรวจ:
${JSON.stringify(draft)}`;

/* ---------------- ถอดข้อความ PDF (เก็บไว้ให้ผู้ดูแลตรวจข่าว/แบบทดสอบ · ห้าม log เนื้อหา) ---------------- */
const MAX_SRC = 280_000;
const TRANSCRIBE_PROMPT = `ถอดข้อความทั้งหมดใน PDF ที่แนบตามต้นฉบับทุกตัวอักษร ทุกหน้า (รวมตาราง หัวข้อ เชิงอรรถ) ห้ามสรุป ห้ามแปล ห้ามเพิ่มความเห็น
ขึ้นต้นแต่ละหน้าด้วยบรรทัด [หน้า n] (n = เลขหน้าใน PDF) · ตารางให้เขียนแถวละบรรทัด คั่นช่องด้วย " | " · ตอบเป็นข้อความล้วน`;
/** pdftotext (ถ้ามีในเครื่อง · เร็ว ไม่ใช้โควตา) → ไม่มี/ภาษาไทยเพี้ยน = ให้ Gemini ถอด → { body, pages, method } */
export function cleanPdfText(raw) {
  const pages = String(raw).split('\f').map((t) => t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
  const body = pages.map((t, i) => (t ? `[หน้า ${i + 1}]\n${t}` : '')).filter(Boolean).join('\n\n');
  const thai = (body.match(/[\u0E00-\u0E7F]/g) || []).length;
  const broken = (body.match(/(^|\s)[\u0E31\u0E33-\u0E3A\u0E47-\u0E4E]/gm) || []).length + (body.match(/\uFFFD/g) || []).length * 5;   // สระ/วรรณยุกต์ลอย = ฟอนต์ถอดไม่ได้
  const ok = body.length > 500 && thai > 200 && broken < thai / 50;
  return { ok, body: body.slice(0, MAX_SRC), pages: pages.filter(Boolean).length };
}
async function pdfText(pdf, pdfPart, models) {
  if (!OFFLINE) {
    const f = path.join(os.tmpdir(), `ccpe-${process.pid}-${Date.now()}.pdf`);
    try {
      fs.writeFileSync(f, pdf);
      const r = cleanPdfText(execFileSync('pdftotext', ['-enc', 'UTF-8', f, '-'], { maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8'));
      if (r.ok) return { body: r.body, pages: r.pages, method: 'pdftotext' };
      log('pdftotext ถอดภาษาไทยไม่ครบ → ให้ AI ถอด');
    } catch { log('ไม่มี pdftotext → ให้ AI ถอด'); } finally { fs.rmSync(f, { force: true }); }
  }
  const quick = [...models.filter((n) => !/pro/.test(n)), ...models.filter((n) => /pro/.test(n))];   // งานถอดข้อความใช้รุ่น flash ก่อน (เก็บโควตา pro)
  const j = await gemini(quick, { contents: [{ parts: [pdfPart, { text: TRANSCRIBE_PROMPT }] }], generationConfig: { temperature: 0, maxOutputTokens: 65536 } }, { step: 'transcribe' });
  const body = textOf(j).trim();
  if (body.length < 200) throw new Error('ถอดข้อความจาก PDF ไม่ได้');
  return { body: body.slice(0, MAX_SRC), pages: (body.match(/^\[หน้า \d+\]/gm) || []).length || null, method: 'gemini' };
}
async function downloadPdf(url) {
  const r = await fetch(url);
  if (!r.ok || !/pdf/i.test(r.headers.get('content-type') || '')) throw new Error(`ดาวน์โหลด PDF ไม่ได้ (HTTP ${r.status})`);
  const pdf = Buffer.from(await r.arrayBuffer());
  if (pdf.length > MAX_PDF) throw new Error(`PDF ใหญ่เกิน ${MAX_PDF / 1048576} MB`);
  return pdf;
}
/** ข่าว AI เดิมที่ยังไม่มีข้อความ PDF ในระบบ → ถอดเติมให้ (รอบละไม่เกิน n ข่าว · ไม่สำเร็จก็ไม่เป็นไร) */
async function backfillSources(db, models, n = 2) {
  if (OFFLINE) return;
  try {
    const news = await db.get('news?select=id,source_file_url&ai_generated=eq.true&source_file_url=not.is.null&order=created_at.desc&limit=20');
    const have = new Set((await db.get('news_sources?select=news_id')).map((x) => x.news_id));
    for (const x of news.filter((y) => !have.has(y.id)).slice(0, n)) {
      try {
        const pdf = await downloadPdf(x.source_file_url);
        const src = await pdfText(pdf, { inlineData: { mimeType: 'application/pdf', data: pdf.toString('base64') } }, models);
        await db.upsert('news_sources', { news_id: x.id, body: src.body, pages: src.pages, method: src.method });
        log('เติมข้อความ PDF ให้ข่าวเดิม:', x.id, src.method, src.pages, 'หน้า');
      } catch (e) { log('เติมข้อความ PDF ไม่สำเร็จ:', x.id, String(e.message).slice(0, 120)); }
    }
  } catch (e) { log('ตรวจข้อความ PDF ของข่าวเดิมไม่ได้:', String(e.message).slice(0, 120)); }
}

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
/* ---------------- ประกอบข่าว ---------------- */
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export function buildBody(g) {
  const out = [clip(g.lead, 400), ...(g.paragraphs || []).slice(0, 6).map((p) => clip(p, 900))];
  const tips = (g.tips || []).slice(0, 6).map((t) => '• ' + clip(t, 200));
  if (tips.length) out.push('ข้อควรรู้', ...tips);
  if (g.for_professionals) out.push('สำหรับบุคลากรทางการแพทย์: ' + clip(g.for_professionals, 800));
  out.push('ข่าวนี้สรุปโดย AI จากบทความวิชาการ · ข้อมูลเพื่อความรู้ ไม่ใช้แทนคำแนะนำของแพทย์หรือเภสัชกร');
  return out.filter(Boolean).join('\n');
}

async function status(db, row) { if (!OFFLINE) await db.insert('ai_news_log', row).catch((e) => log('บันทึก log ไม่ได้:', e.message)); }

async function main() {
  const db = OFFLINE ? null : supa();
  const settings = OFFLINE ? { auto: 'off', request: '', ...(fs.existsSync(path.join(OFFLINE.dir, 'settings.json')) ? JSON.parse(fs.readFileSync(path.join(OFFLINE.dir, 'settings.json'), 'utf8')) : {}) }
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
  if (!ids.length) {
    await status(db, { status: 'skipped', note: 'ยังไม่มีบทความใหม่ใน CCPE' }); log('ไม่มีบทความใหม่');
    try { await backfillSources(db, (await pickModels()).text); } catch { /* ไม่เป็นไร */ }
    return;
  }
  const arts = [];
  for (const id of ids) { try { const a = parseDetail(await fetchText(detailUrl(id)), id); if (a.title) arts.push(a); } catch (e) { log('ข้าม', id, e.message); } }
  if (!arts.length) throw new Error('อ่านหน้ารายละเอียดบทความไม่ได้ (หน้าเว็บ CCPE อาจเปลี่ยนรูปแบบ)');

  const models = await pickModels();
  log('รุ่น AI:', models.text.join(', '));
  // รุ่น flash ที่ใช้ได้จริงกับคีย์นี้ → ให้ช่อง "AI แนะนำข้อมาตรฐาน" ในฐานข้อมูลใช้ตาม (37_ai_match.sql · ค่าเริ่ม gemini-flash-latest)
  //   + รุ่นสำรองเมื่อรุ่นแรกไม่ว่าง (503 ฯลฯ) ฐานข้อมูลลองต่อให้เอง (49_ai_retry.sql) · ไม่รวมรุ่นที่รอบนี้พบว่าใช้ไม่ได้ (404/โควตาหมด) → บันทึกซ้ำตอนจบรอบ
  const saveModels = async () => {
    if (OFFLINE) return;
    const live = models.text.filter((n) => !/pro/.test(n) && !deadModels.has(n)), fast = live.find((n) => !/lite/.test(n));
    if (fast) await db.upsert('site_texts', { key: 'ai_match_model', body: fast }).catch((e) => log('บันทึกรุ่น AI ไม่ได้:', e.message.slice(0, 120)));
    if (live.length) await db.upsert('site_texts', { key: 'ai_match_models', body: live.join(',') }).catch((e) => log('บันทึกรุ่นสำรองไม่ได้:', e.message.slice(0, 120)));
  };
  await saveModels();
  const quick = [...models.text.filter((n) => !/pro/.test(n)), ...models.text.filter((n) => /pro/.test(n))];   // งานเลือกบทความใช้รุ่น flash (เก็บโควตา pro ไว้วิเคราะห์)
  let art = arts[0];
  if (arts.length > 1) {
    try {
      const pick = await askJson(() => gemini(quick, { contents: [{ parts: [{ text: PICK_PROMPT(arts) }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }, { step: 'pick' }), 2);
      art = arts.find((a) => a.id === +pick.id) || art;
      log('เลือกบทความ', art.id, '-', clip(pick.reason, 120));
    } catch (e) { log('เลือกบทความไม่ได้ ใช้บทความล่าสุด:', e.message.slice(0, 120)); }
  }
  let row = null;
  try {
    let pdf;
    if (OFFLINE) pdf = fs.readFileSync(path.join(OFFLINE.dir, 'article.pdf'));
    else pdf = await downloadPdf(art.pdf);
    if (pdf.length > MAX_PDF) throw new Error(`PDF ใหญ่เกิน ${MAX_PDF / 1048576} MB`);
    const pdfPart = { inlineData: { mimeType: 'application/pdf', data: pdf.toString('base64') } };
    const ask = (text, step, temperature) => askJson((i) => gemini(models.text, { contents: [{ parts: [pdfPart, { text }] }], generationConfig: { responseMimeType: 'application/json', temperature: temperature + i * 0.1 } }, { step }));
    // ① วิเคราะห์ PDF → ข้อเท็จจริงพร้อมข้อความอ้างอิง/หน้า
    const facts = await ask(ANALYZE_PROMPT(art), 'analyze', 0);
    if (!(facts.facts || []).length) throw new Error('AI วิเคราะห์บทความไม่ได้ (ไม่พบข้อเท็จจริงในไฟล์)');
    log('วิเคราะห์แล้ว:', facts.facts.length, 'ข้อเท็จจริง');
    // ② เขียนข่าวจากข้อเท็จจริงที่ตรวจแล้วเท่านั้น
    let g = await ask(WRITE_PROMPT(art, facts), 'write', 0.2);
    if (!g.title || !(g.paragraphs || []).length) throw new Error('AI ตอบไม่ครบ (ไม่มีหัวข้อ/เนื้อหา)');
    // ③ ตรวจทานเทียบ PDF ทีละประโยค → แก้ → ตรวจซ้ำจนไม่พบจุดผิด (สูงสุด VERIFY_ROUNDS รอบ)
    let fixed = 0, left = -1, rounds = 0;
    for (let r = 1; r <= VERIFY_ROUNDS; r++) {
      rounds = r;
      const v = await ask(VERIFY_PROMPT(art, g), `verify${r}`, 0);
      const issues = (v.issues || []).filter((x) => x && (x.text || x.problem));
      log(`ตรวจทานรอบ ${r}: พบ ${issues.length} จุด`);
      if (!issues.length) { left = 0; break; }
      if (!v.corrected?.title || !(v.corrected.paragraphs || []).length) { left = issues.length; break; }
      g = v.corrected; fixed += issues.length; left = issues.length;
    }
    if (left !== 0) log('ตรวจทานครบรอบแล้วยังพบจุดที่ต้องดู → ส่งเข้าคิวรอผู้ดูแลตรวจ');

    const pw = loadPlaywright();
    const browser = await pw.chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
    let imgs;
    try {
      // ภาพแม่แบบ 3 ภาพ จากข้อมูลที่ตรวจทานแล้ว (ไม่ใช้ AI วาดภาพ · ตัวหนังสือไทยชัด ตรงกับเนื้อข่าว)
      imgs = {
        infographic: await render(browser, 'infographic', infographic(g.infographic || {})),
        comic: await render(browser, 'comic', comic(g.comic || {})),
        clinical: await render(browser, 'clinical', clinical(g.clinical || {})),
      };
    } finally { await browser.close(); }

    const stamp = thaiDay().replace(/-/g, '');
    const paths = {};
    for (const [k, buf] of Object.entries(imgs)) {
      paths[k] = `ai/${art.id}/${stamp}-${k}.jpg`;
      if (OFFLINE) { fs.mkdirSync(OFFLINE.out, { recursive: true }); fs.writeFileSync(path.join(OFFLINE.out, `${k}.jpg`), buf); } else await db.upload(paths[k], buf, 'image/jpeg');
    }
    row = {
      title: clip(g.title, 200), tag: 'ความรู้', body: buildBody(g), status: settings.auto === 'on' && left === 0 ? 'published' : 'pending',
      image_path: paths.infographic, gallery: [paths.comic, paths.clinical], ai_generated: true,
      source_url: art.url, source_file_url: art.pdf, source_title: clip(`${art.title}${art.authors ? ' — ' + art.authors : ''}`, 300),
    };
    // ข้อความ PDF เก็บไว้ให้ผู้ดูแลตรวจข่าว/แบบทดสอบ (ไม่สำเร็จ = ข่าวยังสร้างได้ · AI ตรวจจะเปิด PDF จากลิงก์แทน)
    let src = null;
    try { src = await pdfText(pdf, pdfPart, models.text); log('ถอดข้อความ PDF:', src.method, src.pages ?? '-', 'หน้า'); } catch (e) { log('ถอดข้อความ PDF ไม่ได้:', String(e.message).slice(0, 120)); }
    if (OFFLINE) { fs.writeFileSync(path.join(OFFLINE.out, 'news.json'), JSON.stringify({ article: art, row, facts, check: { rounds, fixed, left }, source: src }, null, 2)); log('offline: บันทึกที่', OFFLINE.out); return; }
    const [news] = await db.insert('news', row);
    if (src) await db.upsert('news_sources', { news_id: news.id, body: src.body, pages: src.pages, method: src.method }).catch((e) => log('บันทึกข้อความ PDF ไม่ได้:', String(e.message).slice(0, 120)));
    await status(db, { article_id: art.id, title: clip(art.title, 300), news_id: news.id, status: 'done', note: `${row.status === 'published' ? 'เผยแพร่อัตโนมัติ' : 'รอผู้ดูแลตรวจ'} · AI วิเคราะห์ ${facts.facts.length} ข้อเท็จจริง · ตรวจทาน ${rounds} รอบ แก้ ${fixed} จุด${left !== 0 ? ` · ยังมีจุดที่ควรตรวจ ${Math.max(left, 1)} จุด` : ''}` });
    log('สร้างข่าวแล้ว:', news.id, row.status);
    await backfillSources(db, models.text);
  } catch (e) {
    await status(db, { article_id: art.id, title: clip(art.title, 300), status: 'error', note: clip(e.message, 900) });
    throw e;
  } finally { await saveModels(); }
}

if (!process.env.AI_NEWS_IMPORT_ONLY) main().catch((e) => { console.log(`::error::${String(e.message).slice(0, 300)}`); process.exit(1); });   // AI_NEWS_IMPORT_ONLY = ทดสอบฟังก์ชันย่อย
