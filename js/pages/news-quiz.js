// ข่าวช่อง AI: เครื่องมือในกล่องตรวจของผู้ดูแล + แบบทดสอบท้ายข่าวสำหรับผู้อ่าน (47_ai_news_check.sql)
//   ① ตรวจกับความเข้าใจของฉัน: ผู้ดูแลพิมพ์ประเด็นที่เข้าใจ (บรรทัดละข้อ · ไม่บันทึก) → ai_news_check_start/poll
//      → AI เทียบ ประเด็น ↔ ข่าว ↔ PDF ต้นฉบับ ทีละข้อ (ถูก/ผิด/ไม่ได้พูดถึง + หน้า) + ร่างข่าวฉบับแก้ (กดใช้แทนเนื้อข่าวได้)
//   ② แบบทดสอบสำหรับผู้อ่าน (news_quiz · ผู้ดูแลตั้งคำถาม + คำตอบที่ถูกเอง ไม่ใช่ข้อสอบของสภาเภสัชกรรม)
//      → ai_news_quiz_start/poll: AI ลองตอบจาก PDF + บอกว่าคำตอบของผู้ดูแลตรงกับ PDF ไหม + สร้างตัวเลือกที่ผิด 3 ข้อ
//      → บันทึกพร้อมข่าว (saveQuiz) → หน้าอ่านข่าวแสดงท้ายข่าว renderReaderQuiz() (กดตอบ รู้ผล + คำอธิบาย)
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, errText, busy } from '../util.js?v=4.4';

const MAX_Q = 10, WRONG = 3;
let news = null, quiz = [], draft = null, bound = false;
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
  news = n; draft = null; quiz = [];
  $('#aqNotes').value = ''; $('#aqCheckOut').innerHTML = ''; $('#aqQuizOut').innerHTML = '';
  $('#aqTools').hidden = !n?.source_file_url;
  if ($('#aqTools').hidden) return;
  $('#aqQuiz').innerHTML = '<div class="skeleton"></div>';
  const { data, error } = await sb.from('news_quiz').select('question,answer,choices,explain,page,sort').eq('news_id', n.id).order('sort');
  if (news !== n) return;
  if (error) { $('#aqQuiz').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  quiz = (data || []).map((x) => ({ q: x.question, a: x.answer, wrong: [...(x.choices || []), '', '', ''].slice(0, WRONG), explain: x.explain || '', page: x.page, ai: null }));
  renderQuiz();
}
export function closeQuizTools() { news = null; quiz = []; draft = null; }

function bind() {
  $('#aqCheckBtn').addEventListener('click', runCheck);
  $('#aqQuizAdd').addEventListener('click', () => {
    if (quiz.length >= MAX_Q) { toast(`ตั้งคำถามได้ไม่เกิน ${MAX_Q} ข้อ`, 'err'); return; }
    quiz.push({ q: '', a: '', wrong: ['', '', ''], explain: '', page: null, ai: null }); renderQuiz();
    $(`#aqQuiz [data-i="${quiz.length - 1}"][data-k="q"]`)?.focus();
  });
  $('#aqQuizBtn').addEventListener('click', runQuiz);
  $('#aqQuiz').addEventListener('input', (e) => {
    const el = e.target, i = +el.dataset.i, it = quiz[i]; if (!it) return;
    if (el.dataset.k === 'w') it.wrong[+el.dataset.w] = el.value;
    else it[el.dataset.k] = el.value;
    if (el.dataset.k === 'q' || el.dataset.k === 'a') { it.ai = null; el.closest('.aq-q').querySelector('.aq-ai').innerHTML = ''; }   // แก้แล้ว = ผลตรวจเดิมใช้ไม่ได้
    quizCount();
  });
  $('#aqQuiz').addEventListener('click', (e) => {
    const d = e.target.closest('[data-rmq]'); if (!d) return;
    quiz.splice(+d.dataset.rmq, 1); renderQuiz();
  });
  $('#aqCheckOut').addEventListener('click', (e) => {
    if (!e.target.closest('[data-usedraft]') || !draft) return;
    if (!confirm('ใช้ร่างข่าวฉบับแก้ของ AI แทนเนื้อข่าวในช่อง "เนื้อหาข่าว"?\nตรวจดูอีกครั้งก่อนกดบันทึก/อนุมัติ')) return;
    $('#aqBody').value = draft; toast('ใส่ร่างข่าวฉบับแก้แล้ว · ตรวจดูแล้วกดบันทึกหรืออนุมัติ');
    $('#aqBody').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

/* ---------- ① ตรวจกับความเข้าใจของฉัน ---------- */
const VERDICT = { correct: ['✅', 'ข่าวเขียนถูก', 'ok'], wrong: ['❌', 'ข่าวเขียนผิด', 'bad'], missing: ['⚠️', 'ข่าวยังไม่ได้พูดถึง', 'warn'], unsupported: ['❓', 'บทความไม่ได้เขียนแบบนี้', 'warn'] };
async function runCheck() {
  const notes = $('#aqNotes').value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 15), out = $('#aqCheckOut'), btn = $('#aqCheckBtn');
  if (!notes.length) { out.innerHTML = '<p class="small ai-err">กรุณาพิมพ์ประเด็นที่เข้าใจอย่างน้อย 1 บรรทัด</p>'; $('#aqNotes').focus(); return; }
  const n = news; busy(btn, true, 'AI กำลังตรวจ…'); draft = null;
  out.innerHTML = `<p class="small muted">${SPIN}AI กำลังอ่าน PDF ต้นฉบับและเทียบกับข่าว กรุณารอสักครู่ (ประมาณ 30 วินาที – 2 นาที)</p>`;
  try {
    const { data: id, error } = await sb.rpc('ai_news_check_start', { p_news: n.id, p_notes: notes.join('\n'), p_body: $('#aqBody').value });
    if (error) throw error;
    const r = await poll(id);
    if (news !== n) return;
    if (r.status !== 'done') { out.innerHTML = `<p class="small ai-err">${esc(r.note || 'AI ตรวจไม่สำเร็จ')}</p>`; return; }
    const items = r.result?.items || [];
    draft = String(r.result?.body || '').trim() || null;
    out.innerHTML = '<ul class="aq-check">' + notes.map((t, i) => {
      const it = items.find((x) => x.n === i + 1);
      const [ic, label, cls] = VERDICT[it?.verdict] || ['❔', 'AI ไม่ได้ตอบข้อนี้', 'warn'];
      return `<li class="aq-${cls}"><b>${ic} ${esc(t)}</b><span class="small">${label}${it?.page ? ` · บทความหน้า ${it.page}` : ''}</span>`
        + (it?.explain ? `<span class="small muted">${esc(it.explain)}</span>` : '') + (it?.fix ? `<span class="small">ควรเขียนว่า: ${esc(it.fix)}</span>` : '') + '</li>';
    }).join('') + '</ul>'
      + (r.result?.summary ? `<p class="small"><b>สรุป:</b> ${esc(r.result.summary)}</p>` : '')
      + (draft ? `<details class="aq-draft"><summary>ดูร่างข่าวฉบับแก้ (เขียนจาก PDF)</summary><div class="aq-draft-body">${esc(draft)}</div></details>`
        + '<div class="row-btns"><button type="button" class="btn btn-p btn-sm" data-usedraft="1">ใช้ร่างนี้แทนเนื้อข่าว</button></div>' : '');
  } catch (err) { out.innerHTML = `<p class="small ai-err">${esc(errText(err))}</p>`; }
  finally { busy(btn, false); }
}

/* ---------- ② แบบทดสอบสำหรับผู้อ่าน ---------- */
const MATCH = { yes: ['✅', 'คำตอบตรงกับ PDF', 'ok'], no: ['❌', 'คำตอบไม่ตรงกับ PDF — แก้คำถามหรือคำตอบแล้วกดตรวจใหม่', 'bad'], not_found: ['⚠️', 'ไม่พบข้อมูลนี้ในบทความ', 'warn'] };
function quizCount() {
  const ok = quiz.filter((x) => x.q.trim() && x.a.trim()).length;
  $('#aqQuizN').textContent = quiz.length ? `${ok} ข้อ` : 'ยังไม่มีคำถาม';
}
function aiLine(it) {
  if (!it.ai) return '';
  const [ic, label, cls] = MATCH[it.ai.match] || MATCH.not_found;
  return `<span class="small aq-${cls}">${ic} ${label}${it.ai.page ? ` (บทความหน้า ${it.ai.page})` : ''}</span>`
    + (it.ai.ai_answer ? `<span class="small muted">AI ลองตอบจาก PDF: ${esc(it.ai.ai_answer)}</span>` : '');
}
function renderQuiz() {
  $('#aqQuiz').innerHTML = quiz.length ? quiz.map((it, i) => `<div class="aq-q">`
    + `<div class="aq-q-head"><b>ข้อ ${i + 1}</b><button type="button" class="btn btn-no btn-sm" data-rmq="${i}">ลบข้อนี้</button></div>`
    + `<label class="small">คำถาม<input class="input" maxlength="300" data-i="${i}" data-k="q" value="${esc(it.q)}" placeholder="เช่น ยาทาสแตตินอาจช่วยเรื่องใด"></label>`
    + `<label class="small">คำตอบที่ถูก<input class="input" maxlength="200" data-i="${i}" data-k="a" value="${esc(it.a)}"></label>`
    + `<div class="aq-ai">${aiLine(it)}</div>`
    + `<fieldset class="aq-wrong"><legend class="small">ตัวเลือกที่ผิด (AI สร้างให้ · แก้ได้)</legend>${it.wrong.map((w, k) => `<input class="input" maxlength="200" data-i="${i}" data-k="w" data-w="${k}" value="${esc(w)}" aria-label="ตัวเลือกที่ผิด ${k + 1} ของข้อ ${i + 1}">`).join('')}</fieldset>`
    + `<label class="small">คำอธิบายเฉลย (ถ้ามี)<input class="input" maxlength="600" data-i="${i}" data-k="explain" value="${esc(it.explain)}"></label>`
    + '</div>').join('') : '<p class="empty">ยังไม่มีคำถาม · กด "+ เพิ่มคำถาม"</p>';
  quizCount();
}
async function runQuiz() {
  const out = $('#aqQuizOut'), btn = $('#aqQuizBtn');
  const idx = quiz.map((x, i) => (x.q.trim() && x.a.trim() ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) { out.innerHTML = '<p class="small ai-err">กรุณาพิมพ์คำถามและคำตอบที่ถูกอย่างน้อย 1 ข้อ</p>'; return; }
  if (idx.length !== quiz.length) { out.innerHTML = '<p class="small ai-err">ทุกข้อต้องมีทั้งคำถามและคำตอบที่ถูก (หรือลบข้อที่ว่างออก)</p>'; return; }
  const n = news; busy(btn, true, 'AI กำลังตรวจ…');
  out.innerHTML = `<p class="small muted">${SPIN}AI กำลังอ่าน PDF ลองตอบ และสร้างตัวเลือก กรุณารอสักครู่ (ประมาณ 30 วินาที – 2 นาที)</p>`;
  try {
    const { data: id, error } = await sb.rpc('ai_news_quiz_start', { p_news: n.id, p_items: quiz.map((x) => ({ q: x.q.trim(), a: x.a.trim() })) });
    if (error) throw error;
    const r = await poll(id);
    if (news !== n) return;
    if (r.status !== 'done') { out.innerHTML = `<p class="small ai-err">${esc(r.note || 'AI ตรวจไม่สำเร็จ')}</p>`; return; }
    (r.result?.items || []).forEach((x) => {
      const it = quiz[x.n - 1]; if (!it) return;
      it.ai = x;
      const ds = (x.distractors || []).filter((d) => d && d !== it.a);
      it.wrong = it.wrong.map((w) => w.trim() || ds.shift() || '');   // ช่องที่ว่างเท่านั้น (ที่แก้เองไว้ไม่ทับ)
      if (!it.explain.trim() && x.explain) it.explain = x.explain;
      if (x.page) it.page = x.page;
    });
    renderQuiz();
    const bad = quiz.filter((x) => x.ai && x.ai.match !== 'yes').length;
    out.innerHTML = `<p class="small">${bad ? `⚠️ มี ${bad} ข้อที่ AI ตอบไม่ตรงหรือหาในบทความไม่พบ — ตรวจและแก้เอง` : '✅ ทุกข้อตรงกับ PDF'} · ตัวเลือกที่ผิดใส่ให้แล้ว (แก้ได้) · บันทึกพร้อมข่าวเมื่อกดบันทึก/อนุมัติ</p>`;
  } catch (err) { out.innerHTML = `<p class="small ai-err">${esc(errText(err))}</p>`; }
  finally { busy(btn, false); }
}

/** ตรวจความครบก่อนบันทึก → ข้อความผิดพลาด หรือ null */
export function quizProblem() {
  if (!news?.source_file_url) return null;
  for (const [i, x] of quiz.entries()) {
    if (!x.q.trim() || !x.a.trim()) return `แบบทดสอบข้อ ${i + 1}: กรุณาพิมพ์ทั้งคำถามและคำตอบที่ถูก (หรือลบข้อนี้)`;
    if (!x.wrong.some((w) => w.trim())) return `แบบทดสอบข้อ ${i + 1}: ยังไม่มีตัวเลือกที่ผิด (กด "ให้ AI ตรวจกับ PDF + สร้างตัวเลือก" หรือพิมพ์เอง)`;
  }
  return null;
}
/** บันทึกแบบทดสอบของข่าว (แทนที่ของเดิมทั้งชุด) */
export async function saveQuiz(newsId) {
  if (!news?.source_file_url || news.id !== newsId) return;
  const del = await sb.from('news_quiz').delete().eq('news_id', newsId);
  if (del.error) throw del.error;
  if (!quiz.length) return;
  const rows = quiz.map((x, i) => ({ news_id: newsId, sort: i + 1, question: x.q.trim(), answer: x.a.trim(),
    choices: [...new Set(x.wrong.map((w) => w.trim()).filter((w) => w && w !== x.a.trim()))], explain: x.explain.trim() || null, page: x.page || null }));
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
