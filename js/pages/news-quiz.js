// ข่าวช่อง AI: แบบทดสอบท้ายข่าวสำหรับผู้อ่าน (47_ai_news_check.sql · news_quiz · ผู้ดูแลตั้งคำถาม/เฉลยเอง ไม่ใช่ข้อสอบของสภาเภสัชกรรม)
//   กล่องตรวจของผู้ดูแล: กล่องข้อความละ 1 ข้อ → "ฉบับที่จะเผยแพร่" (แก้ได้ · ติ๊ก ✓ ข้อที่ถูก)
//   → ai_news_quiz_start/poll: AI ลองตอบจาก PDF (ข้อความที่ถอดเก็บไว้ใน news_sources หรือเปิดลิงก์) + บอกว่าเฉลยตรงกับ PDF ไหม + เรียบเรียง/เติมตัวเลือกที่ผิด
//   → บันทึกพร้อมข่าว (saveQuiz) → หน้าอ่านข่าวแสดงท้ายข่าว renderReaderQuiz() (กดตอบ รู้ผล + คำอธิบาย)
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, errText, busy } from '../util.js?v=4.4';

const MAX_Q = 10, WRONG = 3;
let news = null, quiz = [], bound = false;
const SPIN = '<span class="spin" aria-hidden="true"></span>';
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function poll(id) {
  for (let i = 0; i < 90; i++) {
    const { data, error } = await sb.rpc('ai_news_check_poll', { p_id: id });
    if (error) throw error;
    if (data.status !== 'pending') return data;
    await wait(2500);
  }
  return { status: 'error', note: 'หมดเวลารอ AI กรุณาลองใหม่' };
}

/* ======================= กล่องตรวจของผู้ดูแล ======================= */
/** เปิดข่าวในกล่องตรวจ: แสดงเครื่องมือเฉพาะข่าวที่มี PDF ต้นฉบับ + โหลดแบบทดสอบที่บันทึกไว้ */
export async function openQuizTools(n) {
  if (!bound) { bound = true; bind(); }
  news = n; quiz = [];
  $('#aqQuizOut').innerHTML = '';
  $('#aqTools').hidden = !n?.source_file_url;
  if ($('#aqTools').hidden) return;
  $('#aqQuiz').innerHTML = '<div class="skeleton"></div>'; $('#aqSrc').textContent = '';
  sb.from('news_sources').select('pages,method').eq('news_id', n.id).maybeSingle().then(({ data: src }) => {   // ข้อความ PDF ที่ช่อง AI ถอดเก็บไว้
    if (news === n) $('#aqSrc').textContent = src ? `📄 มีข้อความจาก PDF ต้นฉบับในระบบแล้ว${src.pages ? ` (${src.pages} หน้า)` : ''} · AI ตรวจได้เร็ว ไม่ต้องเปิด PDF ซ้ำ`
      : '📄 ยังไม่มีข้อความจาก PDF ในระบบ · AI จะเปิดอ่าน PDF จากลิงก์ (ช้ากว่า) · ระบบจะถอดเก็บให้ในรอบทำข่าวถัดไป';
  }, () => {});
  const { data, error } = await sb.from('news_quiz').select('question,answer,choices,explain,page,sort').eq('news_id', n.id).order('sort');
  if (news !== n) return;
  if (error) { $('#aqQuiz').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  quiz = (data || []).map((x) => { const text = toText({ q: x.question, a: x.answer, wrong: x.choices || [], explain: x.explain || '', pos: 0 }); return { ...blank(), text, f: parseQuizItem(text), page: x.page }; });
  renderQuiz();
}
export function closeQuizTools() { news = null; quiz = []; }

function bind() {
  $('#aqQuizAdd').addEventListener('click', () => {
    if (quiz.length >= MAX_Q) { toast(`ตั้งคำถามได้ไม่เกิน ${MAX_Q} ข้อ`, 'err'); return; }
    quiz.push(blank()); renderQuiz();
    $(`#aqQ${quiz.length - 1}`)?.focus();
  });
  $('#aqQuizBtn').addEventListener('click', runQuiz);
  $('#aqQuiz').addEventListener('input', onQuizInput);
  $('#aqQuiz').addEventListener('change', onQuizChange);
  $('#aqQuiz').addEventListener('click', (e) => {
    const d = e.target.closest('[data-rmq]'); if (!d) return;
    quiz.splice(+d.dataset.rmq, 1); renderQuiz();
  });
}

/* ---------- แบบทดสอบสำหรับผู้อ่าน: 1 กล่องข้อความ = 1 ข้อ (ฝั่งผู้ดูแล) + ฉบับที่จะเผยแพร่ (ฝั่ง AI · แก้ได้ · ติ๊ก ✓ หน้าข้อที่ถูก) ----------
   กล่องข้อความ: บรรทัดแรก = คำถาม · ตัวเลือกบรรทัดละข้อ (ก. ข. ค. ง.) · "(ถูก)" ท้ายข้อที่ถูก · "อธิบาย: …" (ถ้ามี)
   วางหลายข้อในกล่องเดียว (เว้นบรรทัดคั่น) → แยกเป็นหลายกล่องให้เอง
   ฉบับที่จะเผยแพร่ = อ่านจากกล่องข้อความ → กด "ให้ AI ตรวจกับ PDF" แล้ว AI เรียบเรียง/เติมตัวเลือก · บันทึกจากฉบับนี้ */
const MATCH = { yes: ['✅', 'เฉลยตรงกับ PDF', 'ok'], no: ['❌', 'AI คิดว่าเฉลยไม่ตรงกับ PDF — ตรวจแล้วแก้เอง', 'bad'], not_found: ['⚠️', 'ไม่พบข้อมูลนี้ในบทความ', 'warn'] };
const CHOICE = /^\s*(?:[ก-ฮ]|[a-dA-D])\s*[.)]\s*|^\s*[-•*]\s+/, RIGHT = /\s*\((?:ถูก|ถูกต้อง|เฉลย|correct|✓|✔)\)\s*$/i, EXPLAIN = /^\s*(?:อธิบาย|คำอธิบาย)\s*[:：]\s*/;
const LETTERS = ['ก', 'ข', 'ค', 'ง'], OPTS = WRONG + 1;
/** ข้อความ → [{ q, opts:[{t, ok}], explain, raw[] }] (หลายข้อคั่นด้วยบรรทัดว่าง) */
function splitBlocks(text) {
  const qs = [];
  let cur = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) { if (cur?.opts.length) cur = null; continue; }
    if (cur && EXPLAIN.test(line)) { cur.explain = line.replace(EXPLAIN, '').trim(); cur.raw.push(line); continue; }
    if (cur && CHOICE.test(line)) { const t = line.replace(CHOICE, '').trim(); cur.opts.push({ t: t.replace(RIGHT, '').trim(), ok: RIGHT.test(t) }); cur.raw.push(line); continue; }
    if (cur && !cur.opts.length) { cur.q += ' ' + line; cur.raw.push(line); continue; }   // คำถามยาวหลายบรรทัด
    cur = { q: line.replace(/^(?:ข้อ\s*)?\d+\s*[.)]\s*/, ''), opts: [], explain: '', raw: [line] }; qs.push(cur);
  }
  return qs;
}
/** ข้อความ 1 ข้อ → ฉบับที่จะเผยแพร่ { q, opts:[{t, ok}] (4 ช่อง), explain } หรือ { error } */
export function parseQuizItem(text) {
  const [x, more] = splitBlocks(text);
  if (!x) return { error: 'พิมพ์คำถามและตัวเลือก' };
  if (more) return { error: 'กล่องนี้มีมากกว่า 1 ข้อ' };
  const opts = x.opts.filter((o) => o.t).map((o) => ({ t: o.t.slice(0, 200), ok: o.ok }));
  if (!opts.length) return { error: 'ยังไม่มีตัวเลือก (ขึ้นต้นบรรทัดด้วย ก. ข. ค.)' };
  if (opts.filter((o) => o.ok).length !== 1) return { error: 'ใส่ (ถูก) ท้ายตัวเลือกที่ถูก 1 ข้อ' };
  if (opts.length > OPTS) return { error: `ตัวเลือกได้ไม่เกิน ${OPTS} ข้อ` };
  return { q: x.q.slice(0, 300), opts: pad(opts), explain: x.explain.slice(0, 600) };
}
const pad = (opts) => [...opts, ...Array(OPTS).fill(0).map(() => ({ t: '', ok: false }))].slice(0, OPTS);
/** ฉบับที่จะเผยแพร่ → { q, a, wrong[], explain, pos } หรือ { error } */
function finalOf(f) {
  if (!f) return { error: 'ยังไม่มีฉบับที่จะเผยแพร่ (พิมพ์ในกล่องข้อความให้ครบก่อน)' };
  const q = f.q.trim(), right = f.opts.findIndex((o) => o.ok && o.t.trim());
  if (!q) return { error: 'ยังไม่มีคำถาม' };
  if (right < 0) return { error: 'ติ๊ก ✓ หน้าตัวเลือกที่ถูก 1 ข้อ' };
  const a = f.opts[right].t.trim(), wrong = [...new Set(f.opts.filter((o, k) => k !== right).map((o) => o.t.trim()).filter((t) => t && t !== a))];
  return { q, a, wrong, explain: f.explain.trim(), pos: f.opts.slice(0, right).filter((o) => o.t.trim()).length };
}
/** สร้างข้อความในกล่อง (ข้อที่บันทึกไว้แล้ว) */
function toText({ q, a, wrong, explain, pos = 0 }) {
  const opts = [...wrong]; opts.splice(Math.min(pos, opts.length), 0, `${a} (ถูก)`);
  return [q, ...opts.map((o, k) => `${LETTERS[k] || k + 1}. ${o}`), explain ? `อธิบาย: ${explain}` : ''].filter(Boolean).join('\n');
}
const blank = () => ({ text: '', f: null, page: null, ai: null });
function quizCount() {
  const ok = quiz.filter((x) => !finalOf(x.f).error).length;
  $('#aqQuizN').textContent = quiz.length ? `${ok}/${quiz.length} ข้อพร้อม` : 'ยังไม่มีคำถาม';
}
function statusLine(it) {
  if (!it.text.trim() && !it.f) return '';
  const p = parseQuizItem(it.text);
  if (!it.ai) return p.error && it.text.trim() ? `<span class="small aq-warn">⚠️ ${esc(p.error)}</span>` : '';
  const [ic, label, cls] = MATCH[it.ai.match] || MATCH.not_found;
  return `<span class="small aq-${cls}">${ic} ${label}${it.ai.page ? ` (บทความหน้า ${it.ai.page})` : ''}</span>`
    + (it.ai.ai_answer ? `<span class="small muted">AI ลองตอบจาก PDF: ${esc(it.ai.ai_answer)}</span>` : '')
    + (it.ai.match !== 'yes' && it.ai.explain ? `<span class="small">เหตุผล: ${esc(it.ai.explain)}</span>` : '');
}
function finalHtml(it, i) {
  if (!it.f) return '';
  return `<p class="small aq-final-h">${it.ai ? 'ฉบับที่จะเผยแพร่ (AI ตรวจและเรียบเรียงแล้ว)' : 'ฉบับที่จะเผยแพร่ (อ่านจากกล่องข้อความ · กด "ให้ AI ตรวจกับ PDF" เพื่อตรวจและเรียบเรียง)'} · แก้ได้ทุกช่อง · ติ๊ก ✓ หน้าข้อที่ถูก</p>`
    + `<label class="sr-only" for="aqF${i}q">คำถามข้อ ${i + 1}</label><input id="aqF${i}q" class="input aq-fq" maxlength="300" data-i="${i}" data-f="q" value="${esc(it.f.q)}">`
    + it.f.opts.map((o, k) => `<div class="aq-opt"><label class="aq-tick" title="ข้อที่ถูก"><input type="radio" name="aqOk${i}" data-i="${i}" data-f="ok" data-k="${k}"${o.ok ? ' checked' : ''} aria-label="ตัวเลือก ${LETTERS[k]} เป็นข้อที่ถูก"><span aria-hidden="true">✓</span></label>`
      + `<input class="input" maxlength="200" data-i="${i}" data-f="opt" data-k="${k}" value="${esc(o.t)}" placeholder="ตัวเลือก ${LETTERS[k]}${k ? ' (ว่างได้)' : ''}" aria-label="ตัวเลือก ${LETTERS[k]} ของข้อ ${i + 1}"></div>`).join('')
    + `<label class="sr-only" for="aqF${i}e">คำอธิบายเฉลยข้อ ${i + 1}</label><input id="aqF${i}e" class="input" maxlength="600" data-i="${i}" data-f="explain" value="${esc(it.f.explain)}" placeholder="คำอธิบายเฉลย (ถ้ามี)">`;
}
const PH = 'ยาสแตตินแบบทาอาจช่วยเรื่องใด\nก. ลดไขมันในเลือด\nข. ช่วยให้แผลหายเร็วขึ้น (ถูก)\nค. รักษาสิวอักเสบ\nอธิบาย: (ถ้ามี)';
function renderQuiz() {
  $('#aqQuiz').innerHTML = quiz.length ? quiz.map((it, i) => `<div class="aq-q" data-card="${i}">`
    + `<div class="aq-q-head"><b>ข้อ ${i + 1}</b><button type="button" class="btn btn-no btn-sm" data-rmq="${i}">ลบข้อนี้</button></div>`
    + `<label class="sr-only" for="aqQ${i}">คำถามและตัวเลือกข้อ ${i + 1}</label><textarea id="aqQ${i}" class="aq-qtext" rows="6" maxlength="2000" data-i="${i}" data-f="text" placeholder="${esc(PH)}">${esc(it.text)}</textarea>`
    + `<div class="aq-ai">${statusLine(it)}</div><div class="aq-final">${finalHtml(it, i)}</div></div>`).join('')
    : '<p class="empty">ยังไม่มีคำถาม · กด "+ เพิ่มคำถาม"</p>';
  quizCount();
}
function onQuizInput(e) {
  const el = e.target, i = +el.dataset.i, it = quiz[i]; if (!it) return;
  const f = el.dataset.f, card = el.closest('.aq-q');
  if (f === 'text') {   // แก้กล่องข้อความ → อ่านใหม่ (ผลตรวจเดิมใช้ไม่ได้)
    it.text = el.value; it.ai = null;
    const p = parseQuizItem(it.text);
    if (!p.error) it.f = p; else if (!it.text.trim()) it.f = null;
    card.querySelector('.aq-ai').innerHTML = statusLine(it); card.querySelector('.aq-final').innerHTML = finalHtml(it, i);
  } else if (it.f) {
    if (f === 'q') it.f.q = el.value;
    else if (f === 'explain') it.f.explain = el.value;
    else if (f === 'opt') it.f.opts[+el.dataset.k].t = el.value;
    else if (f === 'ok') it.f.opts.forEach((o, k) => { o.ok = k === +el.dataset.k; });
  }
  quizCount();
}
/** วางหลายข้อในกล่องเดียว → แยกเป็นหลายกล่อง */
function onQuizChange(e) {
  if (e.target.dataset.f !== 'text') return;
  const i = +e.target.dataset.i, it = quiz[i]; if (!it) return;
  const parts = splitBlocks(it.text).map((b) => b.raw.join('\n'));
  if (parts.length < 2) return;
  if (quiz.length - 1 + parts.length > MAX_Q) { toast(`ตั้งคำถามได้ไม่เกิน ${MAX_Q} ข้อ`, 'err'); return; }
  quiz.splice(i, 1, ...parts.map((t) => { const p = parseQuizItem(t); return { ...blank(), text: t, f: p.error ? null : p }; }));
  renderQuiz(); toast(`แยกเป็น ${parts.length} ข้อแล้ว`);
}
async function runQuiz() {
  const out = $('#aqQuizOut'), btn = $('#aqQuizBtn');
  if (!quiz.length) { out.innerHTML = '<p class="small ai-err">กรุณาเพิ่มคำถามอย่างน้อย 1 ข้อ</p>'; return; }
  const fs = quiz.map((x) => finalOf(x.f)), bad = fs.findIndex((p) => p.error);
  if (bad >= 0) { out.innerHTML = `<p class="small ai-err">ข้อ ${bad + 1}: ${esc(fs[bad].error)} (หรือลบข้อนี้)</p>`; $(`#aqQ${bad}`)?.focus(); return; }
  const n = news; busy(btn, true, 'AI กำลังตรวจ…');
  out.innerHTML = `<p class="small muted">${SPIN}AI กำลังอ่าน PDF ตรวจเฉลย และเรียบเรียงตัวเลือก กรุณารอสักครู่ (ประมาณ 30 วินาที – 2 นาที)</p>`;
  try {
    const { data: id, error } = await sb.rpc('ai_news_quiz_start', { p_news: n.id, p_items: fs.map((p) => ({ q: p.q, a: p.a, w: p.wrong })) });
    if (error) throw error;
    const r = await poll(id);
    if (news !== n) return;
    if (r.status !== 'done') { out.innerHTML = `<p class="small ai-err">${esc(r.note || 'AI ตรวจไม่สำเร็จ')}</p>`; return; }
    (r.result?.items || []).forEach((x) => {
      const it = quiz[x.n - 1], p = fs[x.n - 1]; if (!it || p.error) return;
      // ตัวเลือกที่ผู้ดูแลพิมพ์ = AI เรียบเรียงให้อ่านง่ายขึ้น (ลำดับเดิม) · ไม่ครบ = AI เติม · เฉลยตรงกับ PDF = ใช้ถ้อยคำที่อ่านง่ายขึ้น · ไม่ตรง = ไม่แก้เฉลย (ผู้ดูแลแก้เอง)
      const ds = (x.distractors || []).filter((d) => d && d !== p.a);
      const wrong = [...p.wrong.map((w, k) => ds[k] || w), ...ds.slice(p.wrong.length)].slice(0, WRONG);
      const a = x.match === 'yes' && x.answer_rewrite ? x.answer_rewrite : p.a, opts = wrong.map((t) => ({ t, ok: false }));
      opts.splice(Math.min(p.pos, opts.length), 0, { t: a, ok: true });
      it.f = { q: p.q, opts: pad(opts), explain: p.explain || x.explain || '' };
      it.ai = x; if (x.page) it.page = x.page;
    });
    renderQuiz();
    const nBad = quiz.filter((x) => x.ai && x.ai.match !== 'yes').length;
    out.innerHTML = `<p class="small">${nBad ? `⚠️ มี ${nBad} ข้อที่ AI คิดว่าเฉลยไม่ตรงหรือหาในบทความไม่พบ — ดูเหตุผลแล้วแก้เอง` : '✅ ทุกข้อเฉลยตรงกับ PDF'} · AI เรียบเรียงตัวเลือกใน "ฉบับที่จะเผยแพร่" แล้ว (แก้ต่อได้) · บันทึกพร้อมข่าวเมื่อกดบันทึก/อนุมัติ</p>`;
  } catch (err) { out.innerHTML = `<p class="small ai-err">${esc(errText(err))}</p>`; }
  finally { busy(btn, false); }
}

/** ตรวจความครบก่อนบันทึก → ข้อความผิดพลาด หรือ null */
export function quizProblem() {
  if (!news?.source_file_url) return null;
  for (const [i, x] of quiz.entries()) {
    const p = finalOf(x.f);
    if (p.error) return `แบบทดสอบข้อ ${i + 1}: ${p.error} (หรือลบข้อนี้)`;
    if (!p.wrong.length) return `แบบทดสอบข้อ ${i + 1}: ยังไม่มีตัวเลือกที่ผิด (พิมพ์เอง หรือกด "ให้ AI ตรวจกับ PDF" ให้เติม)`;
  }
  return null;
}
/** บันทึกแบบทดสอบของข่าว (แทนที่ของเดิมทั้งชุด) จาก "ฉบับที่จะเผยแพร่" */
export async function saveQuiz(newsId) {
  if (!news?.source_file_url || news.id !== newsId) return;
  const del = await sb.from('news_quiz').delete().eq('news_id', newsId);
  if (del.error) throw del.error;
  if (!quiz.length) return;
  const rows = quiz.map((x, i) => { const p = finalOf(x.f); return { news_id: newsId, sort: i + 1, question: p.q, answer: p.a, choices: p.wrong, explain: p.explain || null, page: x.page || null }; });
  const { error } = await sb.from('news_quiz').insert(rows);
  if (error) throw error;
}

/* ======================= หน้าอ่านข่าว: แบบทดสอบท้ายข่าว ======================= */
const seeded = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return () => ((h = (h * 1103515245 + 12345) >>> 0) / 4294967296); };
/** แสดงแบบทดสอบท้ายข่าว (ถ้ามี) · ลำดับตัวเลือกสุ่มแบบคงที่ต่อข้อ */
export async function renderReaderQuiz(box, newsId) {
  box.hidden = true; box.innerHTML = '';
  const { data } = await sb.from('news_quiz').select('id,question,answer,choices,explain,page,sort').eq('news_id', newsId).order('sort');
  if (!data?.length) return;
  const qs = data.map((x) => {
    const rnd = seeded(x.id), opts = [x.answer, ...(x.choices || [])];
    for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
    return { ...x, opts };
  });
  box.innerHTML = `<h2>แบบทดสอบท้ายข่าว</h2><p class="small muted">ลองตอบดูว่าเข้าใจเนื้อหาแค่ไหน · กดเลือกคำตอบแล้วรู้ผลทันที</p>`
    + qs.map((x, i) => `<div class="rq" data-q="${i}"><p class="rq-q"><b>${i + 1}.</b> ${esc(x.question)}</p><div class="rq-opts">`
      + x.opts.map((o, k) => `<button type="button" class="rq-opt" data-k="${k}">${esc(o)}</button>`).join('') + '</div><p class="small rq-res" aria-live="polite"></p></div>').join('')
    + '<p class="small rq-score" aria-live="polite"></p>';
  box.hidden = false;
  let right = 0, done = 0;
  box.onclick = (e) => {
    const b = e.target.closest('.rq-opt'); if (!b) return;
    const card = b.closest('.rq'); if (card.classList.contains('answered')) return;
    const x = qs[+card.dataset.q], ok = x.opts[+b.dataset.k] === x.answer;
    card.classList.add('answered'); done++; if (ok) right++;
    card.querySelectorAll('.rq-opt').forEach((o, k) => { o.disabled = true; if (x.opts[k] === x.answer) o.classList.add('right'); });
    if (!ok) b.classList.add('wrong');
    card.querySelector('.rq-res').textContent = (ok ? '✅ ถูกต้อง' : `❌ ยังไม่ถูก · คำตอบคือ "${x.answer}"`) + (x.explain ? ` · ${x.explain}` : '') + (x.page ? ` (บทความหน้า ${x.page})` : '');
    if (done === qs.length) box.querySelector('.rq-score').textContent = `ตอบถูก ${right} จาก ${qs.length} ข้อ`;
  };
}
