// ช่อง AI: สร้างข่าวจากบทความวิชาการ CCPE วันละ 1 ข่าว (รันใน GitHub Actions: .github/workflows/ai-news.yml)
//
//   node tools/ai_news/run.mjs --check     ตรวจว่าตอนนี้ต้องทำไหม (ยังไม่ได้ทำของวันนี้หลัง 06:00 น. หรือผู้ดูแลกด "สร้างข่าวตอนนี้") → พิมพ์ run=true|false
//   node tools/ai_news/run.mjs             ทำข่าว 1 ข่าว: เลือกบทความใหม่ → อ่าน PDF → Gemini เขียนข่าว → ภาพ 3 แบบ → บันทึกข่าว (รอตรวจ หรือเผยแพร่ทันที ตามค่าตั้ง)
//   node tools/ai_news/run.mjs --offline <fixtures> <out>   ทดสอบในเครื่องโดยไม่ใช้เน็ต/ฐานข้อมูลจริง (tests/ai_news/run.sh)
//
//   ค่าลับ (GitHub Secrets เท่านั้น): SUPABASE_SECRET_KEY, GEMINI_API_KEY · SUPABASE_URL อ่านจาก js/config.js
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
async function gemini(model, body) {
  if (OFFLINE) return JSON.parse(fs.readFileSync(path.join(OFFLINE.dir, model.includes('image') ? 'gemini-image.json' : 'gemini.json'), 'utf8'));
  const r = await fetch(`${GEMINI}/models/${model}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini ${model} HTTP ${r.status}: ${(j.error?.message || '').slice(0, 200)}`);
  return j;
}
/** เลือกรุ่นที่ใช้ได้จริงกับคีย์นี้ (ชื่อรุ่นเปลี่ยนบ่อย จึงไม่ตายตัว) */
async function pickModels() {
  if (OFFLINE) return { text: 'offline-flash', image: 'offline-image' };
  const r = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini: คีย์ใช้ไม่ได้ (HTTP ${r.status}) ${(j.error?.message || '').slice(0, 150)}`);
  const ok = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace('models/', ''));
  const rank = (n) => (/pro/.test(n) ? 1 : 0) + (/lite/.test(n) ? 2 : 0) + (/preview|exp/.test(n) ? 1 : 0);
  const text = ok.filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/image|tts|audio|live|thinking/.test(n)).sort((a, b) => rank(a) - rank(b) || b.localeCompare(a))[0]
    || ok.find((n) => /flash-latest/.test(n)) || ok.find((n) => /^gemini/.test(n));
  const image = ok.filter((n) => /^gemini.*image/.test(n)).sort((a, b) => rank(a) - rank(b) || b.localeCompare(a))[0] || null;
  if (!text) throw new Error('Gemini: ไม่พบรุ่นที่ใช้สร้างข้อความได้');
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
 "art": {"infographic": "English prompt: modern flat vector medical illustration for the hero image, slate blue & teal with coral accents, NO text, NO letters",
   "comic": ["English prompt per panel (3 items): 2D hand-drawn ink comic with warm watercolor, cute characters, NO text, NO speech bubbles, NO letters"]}
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
/** ภาพวาดจาก AI (ถ้าโควตาฟรีรองรับ) → data URL · ไม่ได้ = null แล้วใช้อีโมจิแทน */
async function artImage(model, prompt) {
  if (!model || !prompt) return null;
  try {
    const j = await gemini(model, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } });
    const part = (j.candidates?.[0]?.content?.parts || []).find((x) => (x.inlineData || x.inline_data)?.data);
    const d = part && (part.inlineData || part.inline_data);
    return d ? `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}` : null;
  } catch (e) { log('ข้ามภาพวาด AI:', e.message.slice(0, 160)); return null; }
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
  const doneToday = logs.some((l) => thaiDay(new Date(new Date(l.created_at).getTime() + 7 * 3600_000)) === thaiDay());
  const due = requested || (!doneToday && thaiNow().getUTCHours() >= START_HOUR);

  if (args[0] === '--check') {
    log(requested ? 'มีคำสั่ง "สร้างข่าวตอนนี้"' : due ? 'ถึงเวลาทำข่าวของวันนี้' : 'วันนี้ทำแล้ว/ยังไม่ถึงเวลา');
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
  log('รุ่น AI:', models.text, '· ภาพ:', models.image || '(ไม่มี ใช้อีโมจิ)');
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
    let imgs;
    try {
      const heroArt = await artImage(models.image, g.art?.infographic);
      const comicArts = [];
      for (const p of (g.art?.comic || []).slice(0, 3)) comicArts.push(await artImage(models.image, p));
      imgs = {
        infographic: await render(browser, 'infographic', infographic(g.infographic || {}, heroArt)),
        comic: await render(browser, 'comic', comic(g.comic || {}, comicArts)),
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
      title: clip(g.title, 200), tag: 'ความรู้', body: buildBody(g), status: settings.auto === 'on' ? 'published' : 'pending',
      image_path: paths.infographic, gallery: [paths.comic, paths.clinical], ai_generated: true,
      source_url: art.url, source_title: clip(`${art.title}${art.authors ? ' — ' + art.authors : ''}`, 300),
    };
    if (OFFLINE) { fs.writeFileSync(path.join(OFFLINE.out, 'news.json'), JSON.stringify({ article: art, row }, null, 2)); log('offline: บันทึกที่', OFFLINE.out); return; }
    const [news] = await db.insert('news', row);
    await status(db, { article_id: art.id, title: clip(art.title, 300), news_id: news.id, status: 'done', note: row.status === 'published' ? 'เผยแพร่อัตโนมัติ' : 'รอผู้ดูแลตรวจ' });
    log('สร้างข่าวแล้ว:', news.id, row.status);
  } catch (e) {
    await status(db, { article_id: art.id, title: clip(art.title, 300), status: 'error', note: clip(e.message, 900) });
    throw e;
  }
}

main().catch((e) => { console.log(`::error::${String(e.message).slice(0, 300)}`); process.exit(1); });
