// ผู้ดูแล › ข่าว: ตรวจข่าวจากเจ้าหน้าที่ (อนุมัติ/ขอแก้/ไม่ผ่าน) + เขียนข่าวเอง + จัดการข่าวที่เผยแพร่
import { sb, publicImageUrl } from '../supabase.js?v=4.4';
import { $, esc, thaiDate, toast, errText, busy } from '../util.js?v=4.4';
import { auth } from '../auth.js?v=4.4';
import { loadUnits, unitName } from '../data.js?v=4.4';
import { newsForm, removeNewsFiles, fileLink, extFileLink } from './news-form.js?v=4.4';
import { newsFileUrl } from '../upload.js?v=4.4';
import { loadNews, renderSlides } from './news.js?v=4.4';
import { refreshAdminBadges } from './admin.js?v=4.4';
import { initAiPanel } from './admin-ai.js?v=4.4';
import { openQuizTools, closeQuizTools, quizProblem, saveQuiz } from './news-quiz.js?v=4.4';
import { loadTopics, mountTopicAdmin, runAi as topicAi, topicChips, topicOptions, topicMatch, renderTopicPick, pickedTopics, hasTopic } from './news-topics.js?v=4.4';

let queue = [], published = [], trash = [], reviewing = null, reviewFrom = 'queue', editing = null, bound = false;   // reviewFrom: queue = ข่าวรอตรวจ · published = ข่าวที่เผยแพร่แล้ว (แบบทดสอบ/แก้ไข)
const TRASH = ['unpublished', 'deleted', 'rejected'], KEEP_DAYS = 30, DAY = 86_400_000;
const TRASH_LABEL = { unpublished: ['หยุดเผยแพร่', 'c-off'], deleted: ['ลบแล้ว', 'c-del'], rejected: ['ไม่ผ่าน', 'c-fix'] };

export async function initAdminNews() {
  await loadUnits();
  if (!bound) { bound = true; bind(); }
  await Promise.all([loadQueue(), loadPublished(), loadTrash(), initAiPanel(), mountTopicAdmin(() => { topicOptions($('#anTopicF'), true); renderTopicPick($('#anTopics'), editing?.topic_ids); loadPublished(); })]);
  topicOptions($('#anTopicF'), true); renderTopicPick($('#anTopics'), editing?.topic_ids);
  if ([...published, ...queue].some((n) => !hasTopic(n))) topicAi(true);   // ข่าวที่ยังไม่มีหมวด → AI จัดให้เอง (เงียบ ๆ)
}

async function loadQueue() {
  const { data, error } = await sb.from('news').select('id,title,tag,body,image_path,file_path,file_name,unit_id,created_at,comments_closed,ai_generated,source_url,source_title,source_file_url,gallery,author:profiles!news_author_id_fkey(full_name)').eq('status', 'pending').order('created_at');
  if (error) { $('#anQueue').innerHTML = `<p class="empty">โหลดข่าวรอตรวจไม่สำเร็จ: ${esc(errText(error))}</p>`; return; }
  queue = data;
  $('#anQueueCount').textContent = queue.length ? `(${queue.length})` : '';
  $('#anQueue').innerHTML = queue.length ? queue.map((n) => `<div class="li"><div class="l"><b>${esc(n.title)}</b>`
    + `<span class="small muted">${from(n)} · ${esc(n.tag)} · ${esc(thaiDate(n.created_at))}</span></div>`
    + (n.ai_generated ? '<span class="chip c-sub">AI</span>' : '')
    + `<button type="button" class="btn btn-p btn-sm" data-review="${n.id}">ตรวจ</button></div>`).join('')
    : '<p class="empty">ไม่มีข่าวรอตรวจ</p>';
  if (reviewing && reviewFrom === 'queue' && !queue.some((n) => n.id === reviewing.id)) closeReview();
}

const from = (n) => (n.ai_generated ? 'ช่อง AI · บทความวิชาการ CCPE' : `${esc(n.author?.full_name || '-')} · รพ.สต. ${esc(unitName(n.unit_id))}`);

/* ---------- กล่องตรวจ = กล่องแก้ไข: กด "ตรวจ" → ข่าวขึ้นในฟอร์ม แก้ได้ทุกช่อง แล้วกดอนุมัติ/บันทึก/ขอแก้ไข/ไม่ผ่าน ---------- */
/** เปิดข่าวในกล่องตรวจ · src = 'queue' (ข่าวรอตรวจ) หรือ 'published' (ข่าวที่เผยแพร่แล้ว: ทำแบบทดสอบ/แก้ไข · บันทึกแล้วยังเผยแพร่อยู่) */
function openReview(id, src = 'queue') {
  reviewing = (src === 'published' ? published : queue).find((n) => n.id === id); if (!reviewing) return;
  reviewFrom = src;
  const n = reviewing, el = $('#anReview'), pub = src === 'published';
  el.hidden = false;
  $('#aqHead').textContent = pub ? 'แบบทดสอบ/แก้ไขข่าวที่เผยแพร่แล้ว' : 'ตรวจ/แก้ไขข่าวรอตรวจ';
  $('#aqFrom').textContent = pub ? 'เผยแพร่แล้ว' : n.ai_generated ? 'ช่อง AI' : 'รพ.สต.';
  $('#aqInfo').innerHTML = (pub ? `<p class="small muted">เผยแพร่เมื่อ ${esc(thaiDate(n.published_at))} · บันทึกแล้วข่าวยังเผยแพร่อยู่ (แบบทดสอบขึ้นท้ายข่าวทันที)</p>` : `<p class="small muted">ส่งโดย ${from(n)} · ${esc(thaiDate(n.created_at))}</p>`)
    + (n.ai_generated ? '<p class="small ai-warn">ข่าวนี้เขียนโดย AI — ตรวจตัวเลข ชื่อยา และขนาดยาเทียบกับบทความต้นฉบับก่อนเผยแพร่</p>' : '')
    + (n.file_path ? `<div>${fileLink(n)}</div>` : n.source_file_url ? `<div>${extFileLink(n.source_file_url, 'ดาวน์โหลดบทความฉบับเต็ม (PDF)')}</div>` : '')
    + (n.source_url ? `<p class="small">อ้างอิง: <a href="${esc(n.source_url)}" target="_blank" rel="noopener">${esc(n.source_title || n.source_url)}</a></p>` : '');
  $('#aqTitle').value = n.title; $('#aqBody').value = n.body; $('#aqClosed').checked = !!n.comments_closed; $('#anComment').value = '';
  aqKit.edit(n); openQuizTools(n);   // ข่าวที่มี PDF ต้นฉบับ: แบบทดสอบสำหรับผู้อ่าน
  $('#anComment').closest('.field').hidden = pub;
  if (pub) {
    $('#aqBtns').innerHTML = '<button type="button" class="btn btn-p" data-decide="save">บันทึก (ข่าวยังเผยแพร่อยู่)</button>'
      + '<button type="button" class="btn btn-o btn-sm" data-decide="close">ปิด</button><span class="small" id="anDecideMsg" aria-live="polite"></span>';
    $('#aqQuizFold').open = true;
    renderQueueSel(); el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  $('#aqBtns').innerHTML = '<button type="button" class="btn btn-ok" data-decide="published">อนุมัติ &amp; เผยแพร่</button>'
    + '<button type="button" class="btn btn-o" data-decide="save">บันทึก (ยังไม่เผยแพร่)</button>'
    + (n.ai_generated ? '<button type="button" class="btn btn-no" data-decide="rejected">ไม่ใช้ข่าวนี้</button>'
      : '<button type="button" class="btn btn-warn" data-decide="fix">ขอแก้ไข</button><button type="button" class="btn btn-no" data-decide="rejected">ไม่ผ่าน</button>')
    + '<button type="button" class="btn btn-o btn-sm" data-decide="close">ปิด</button><span class="small" id="anDecideMsg" aria-live="polite"></span>';
  renderQueueSel();
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function closeReview() { reviewing = null; reviewFrom = 'queue'; closeQuizTools(); $('#anReview').hidden = true; $('#aqForm').reset(); aqKit?.reset(); renderQueueSel(); }
const renderQueueSel = () => document.querySelectorAll('#anQueue [data-review]').forEach((b) => { const on = b.dataset.review === reviewing?.id; b.textContent = on ? 'กำลังตรวจ' : 'ตรวจ'; b.closest('.li').classList.toggle('sel', on); });

/** บันทึกการแก้ไขในกล่องตรวจ + เปลี่ยนสถานะ (status = null → บันทึกอย่างเดียว ยังรอตรวจ) */
async function decide(status, btn) {
  if (status === 'close') return closeReview();
  const n = reviewing, m = $('#anDecideMsg'), say = (t) => { m.style.color = 'var(--error)'; m.textContent = t; };
  const title = $('#aqTitle').value.trim(), body = $('#aqBody').value.trim(), comment = $('#anComment').value.trim();
  if (!title || !body) { say('กรุณากรอกหัวข้อและเนื้อหาข่าว'); return; }
  if (status === 'fix' && !comment || status === 'rejected' && !comment && !n.ai_generated) { say('กรุณาใส่ความเห็นให้ผู้ส่งทราบว่าต้องแก้อะไร'); $('#anComment').focus(); return; }
  const keepQuiz = status === 'save' || status === 'published', qp = keepQuiz && quizProblem();
  if (qp) { say(qp); $('#aqQuizFold').open = true; return; }
  busy(btn, true, 'กำลังบันทึก…'); m.textContent = '';
  let up = null;
  try {
    if (keepQuiz) await saveQuiz(n.id);   // ก่อนบันทึกข่าว: ถ้าบันทึกแบบทดสอบไม่ได้ ข่าวยังไม่เปลี่ยน
    up = await aqKit.upload(auth.profile.id);
    const row = { title, tag: $('#aqTag').value, body, comments_closed: $('#aqClosed').checked, ...up.fields };
    if (status !== 'save') Object.assign(row, { status, review_comment: comment || null });
    const { error } = await sb.from('news').update(row).eq('id', n.id);
    if (error) throw error;
    removeNewsFiles(n, up.fields);
  } catch (err) { up?.undo(); busy(btn, false); say(errText(err)); return; }
  busy(btn, false);
  if (reviewFrom === 'published') {   // ข่าวที่เผยแพร่แล้ว: ยังเผยแพร่อยู่ · กล่องเปิดค้างไว้ แก้ต่อได้
    toast('บันทึกแล้ว · ข่าวยังเผยแพร่อยู่'); await loadPublished(); refreshHome(); openReview(n.id, 'published'); return;
  }
  toast({ save: 'บันทึกการแก้ไขแล้ว (ยังรอตรวจ)', published: 'เผยแพร่ข่าวแล้ว', fix: 'ส่งกลับให้แก้ไขแล้ว', rejected: n.ai_generated ? 'ไม่ใช้ข่าวนี้แล้ว' : 'บันทึกว่าไม่ผ่านแล้ว' }[status]);
  if (status === 'save') { await loadQueue(); openReview(n.id); return; }   // ยังอยู่ในกล่องตรวจ กดอนุมัติต่อได้
  closeReview(); loadQueue(); refreshAdminBadges();
  if (status === 'published') { loadPublished(); refreshHome(); }
  if (status === 'rejected') loadTrash();
}

async function loadPublished() {
  const { data, error } = await sb.from('news').select('id,title,tag,body,image_path,gallery,file_path,file_name,comments_closed,view_count,published_at,created_at,unit_id,ai_generated,source_url,source_title,source_file_url,topic_ids').eq('status', 'published').order('published_at', { ascending: false });
  if (error) { $('#anList').innerHTML = `<p class="empty">โหลดข่าวไม่สำเร็จ: ${esc(errText(error))}</p>`; return; }
  published = data;
  renderPublished();
}

/* รายการข่าวที่เผยแพร่: ค้นหา (หัวข้อ/เนื้อหา) · หมวด · จัดเรียง · วันที่เผยแพร่ — ยังไม่ค้น/กรอง = 3 ข่าวล่าสุด (ดูทั้งหมด = เลื่อนดูได้) */
const SHOW_LATEST = 3;
let pubOpen = false;
const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function renderPublished() {
  const q = $('#anSearch').value.trim().toLowerCase(), day = $('#anDate').value, tag = $('#anTagF').value, sort = $('#anSort').value, topic = $('#anTopicF').value || 'all';
  const filtered = published.filter((n) => (!q || `${n.title} ${n.body || ''}`.toLowerCase().includes(q)) && (tag === 'all' || n.tag === tag) && topicMatch(n, topic)
    && (!day || (n.published_at && localDay(n.published_at) === day)));
  const t = (n) => Date.parse(n.published_at || n.created_at) || 0;
  filtered.sort(sort === 'old' ? (a, b) => t(a) - t(b) : sort === 'az' ? (a, b) => a.title.localeCompare(b.title, 'th') : sort === 'za' ? (a, b) => b.title.localeCompare(a.title, 'th')
    : sort === 'views' ? (a, b) => (b.view_count || 0) - (a.view_count || 0) || t(b) - t(a) : (a, b) => t(b) - t(a));
  const finding = !!(q || day || tag !== 'all' || topic !== 'all' || sort !== 'new'), all = pubOpen || finding;
  const rows = all ? filtered : filtered.slice(0, SHOW_LATEST);
  $('#anCount').textContent = `(${published.length})`;
  $('#anExpand').hidden = finding || published.length <= SHOW_LATEST;
  $('#anExpand').textContent = pubOpen ? 'ย่อ (แสดง 3 ข่าวล่าสุด)' : `ดูทั้งหมด (${published.length})`;
  $('#anExpand').setAttribute('aria-expanded', String(pubOpen));
  $('#anFindClear').hidden = !finding;
  $('#anList').classList.toggle('an-scroll', all);
  $('#anFound').textContent = finding ? `พบ ${filtered.length} ข่าว` : '';
  $('#anList').innerHTML = rows.length ? rows.map((n) => `<div class="newsrow"><div class="thumb2">${n.image_path ? `<img src="${esc(publicImageUrl(n.image_path))}" alt="" loading="lazy">` : ''}</div>`
    + `<div class="l"><b>${esc(n.title)}</b>${hasTopic(n) ? `<span class="row-btns">${topicChips(n.topic_ids)}</span>` : ''}<span class="small muted">${esc(n.tag)} · ${esc(thaiDate(n.published_at))} · ${n.view_count.toLocaleString('th-TH')} ผู้เข้าชม${n.unit_id != null ? ' · จาก รพ.สต. ' + esc(unitName(n.unit_id)) : ''}${n.comments_closed ? ' · ปิดความคิดเห็น' : ''}</span></div>`
    + `<div class="row-btns"><a class="btn btn-o btn-sm" href="#/news/${n.id}">ดู</a>${n.source_file_url ? `<button type="button" class="btn btn-o btn-sm" data-quiz="${n.id}">แบบทดสอบ</button>` : ''}<button type="button" class="btn btn-o btn-sm" data-edit="${n.id}">แก้ไข</button><button type="button" class="btn btn-o btn-sm" data-unpub="${n.id}">หยุดเผยแพร่</button><button type="button" class="btn btn-no btn-sm" data-del="${n.id}">ลบ</button></div></div>`).join('')
    : `<p class="empty">${published.length ? 'ไม่พบข่าวที่ตรงกับคำค้น/วันที่' : 'ยังไม่มีข่าวที่เผยแพร่'}</p>`;
}

/* ---------- ข่าวที่หยุดเผยแพร่ (ถังข่าว): หยุดเผยแพร่ / ลบ / ไม่ผ่าน → เรียกคืนได้ 30 วัน ---------- */
async function loadTrash() {
  const cut = new Date(Date.now() - KEEP_DAYS * DAY).toISOString();
  const old = await sb.from('news').select('id,image_path,file_path,gallery').in('status', TRASH).lt('trashed_at', cut);
  if (old.data?.length) {   // ครบ 30 วัน → ลบถาวร
    const { error } = await sb.from('news').delete().in('id', old.data.map((n) => n.id));
    if (!error) old.data.forEach((n) => removeNewsFiles(n));
  }
  const { data, error } = await sb.from('news').select('id,title,tag,status,prev_status,trashed_at,updated_at,image_path,file_path,gallery,unit_id').in('status', TRASH).order('trashed_at', { ascending: false });
  if (error) { $('#anTrash').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  trash = data;
  $('#anTrashCount').textContent = `(${trash.length})`;
  $('#anTrash').innerHTML = trash.length ? trash.map((n) => {
    const [label, cls] = TRASH_LABEL[n.status];
    const left = Math.max(0, KEEP_DAYS - Math.floor((Date.now() - new Date(n.trashed_at || n.updated_at)) / DAY));
    return `<div class="li"><div class="l"><b>${esc(n.title)}</b><span class="small muted">${esc(n.tag)}${n.unit_id != null ? ' · จาก รพ.สต. ' + esc(unitName(n.unit_id)) : ''} · ลบถาวรในอีก ${left} วัน</span></div>`
      + `<div class="row-btns" style="align-items:center"><span class="chip ${cls}">${label}</span>`
      + `<button type="button" class="btn btn-o btn-sm" data-restore="${n.id}">${n.status === 'rejected' ? 'เรียกคืนไปรอตรวจ' : 'เรียกคืน (เผยแพร่อีกครั้ง)'}</button>`
      + `<button type="button" class="btn btn-no btn-sm" data-purge="${n.id}">ลบถาวร</button></div></div>`;
  }).join('') : '<p class="empty">ไม่มีข่าวที่หยุดเผยแพร่</p>';
}

async function setNewsStatus(id, status, msg) {
  const { error } = await sb.from('news').update({ status }).eq('id', id);
  if (error) { toast(errText(error), 'err'); return false; }
  toast(msg); if (editing?.id === id) resetForm();
  await Promise.all([loadPublished(), loadTrash(), loadQueue()]); refreshHome(); refreshAdminBadges();
  return true;
}

function resetForm() {
  editing = null; $('#anForm').reset(); anKit?.reset(); $('#anMsg').textContent = ''; renderTopicPick($('#anTopics'), []);
  $('#anFormTitle').textContent = 'เขียนข่าว (เผยแพร่ทันที)'; $('#anSubmit').textContent = 'เผยแพร่ข่าว'; $('#anCancel').hidden = true;
}
function refreshHome() { loadNews(true).then(renderSlides).catch(() => {}); }

function editNews(n) {
  editing = n; $('#anTitle').value = n.title; $('#anBody').value = n.body; $('#anClosed').checked = !!n.comments_closed; anKit.edit(n); renderTopicPick($('#anTopics'), n.topic_ids);
  $('#anFormTitle').textContent = 'แก้ไขข่าว';
  $('#anSubmit').textContent = 'บันทึกการแก้ไข'; $('#anCancel').hidden = false;
  $('#anForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let anKit = null, aqKit = null;

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build';

/** อ่านข้อความจาก PDF (จำกัดไม่เกิน 6 หน้าแรก) */
async function extractPdfText(buffer, maxPages = 6) {
  try {
    const pdfjs = await import(`${PDFJS}/pdf.min.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`;
    const doc = await pdfjs.getDocument({ data: buffer }).promise;
    const num = Math.min(doc.numPages, maxPages), pages = [];
    for (let i = 1; i <= num; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const txt = (tc.items || []).map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
      if (txt) pages.push(`[หน้า ${i}]: ${txt}`);
    }
    return pages.join('\n\n');
  } catch (err) {
    console.warn('extractPdfText error:', err);
    return '';
  }
}

/** ค้นหาและดึงข้อความจากไฟล์แนบหรือบทความต้นฉบับของข่าว */
async function getNewsDocText(prefix) {
  const current = prefix === 'aq' ? reviewing : editing;

  // 1. ตรวจไฟล์ที่ผู้ใช้เพิ่งเลือกในฟอร์มปัจจุบัน
  const fileInput = $(`#${prefix}File`);
  const localFile = fileInput?.files?.[0];
  if (localFile) {
    if (localFile.type === 'application/pdf' || /\.pdf$/i.test(localFile.name)) {
      const buf = await localFile.arrayBuffer();
      const text = await extractPdfText(buf);
      if (text) return { text, source: `ไฟล์แนบ ${localFile.name}` };
    } else if (/\.(txt|md)$/i.test(localFile.name) || localFile.type.startsWith('text/')) {
      const text = (await localFile.text()).trim();
      if (text) return { text, source: `ไฟล์แนบ ${localFile.name}` };
    }
  }

  // 2. ถ้ากำลังตรวจหรือแก้ไขข่าวเดิมที่มีอยู่แล้ว
  if (current?.id) {
    // 2a. ลองดึงจากตาราง news_sources (ข้อความที่ระบบถอดจาก PDF บทความ CCPE ไว้แล้ว)
    try {
      const { data } = await sb.from('news_sources').select('body').eq('news_id', current.id).maybeSingle();
      if (data?.body && data.body.trim()) return { text: data.body.trim(), source: 'บทความต้นฉบับ' };
    } catch (e) {
      console.warn('load news_sources', e);
    }
  }

  // 2b. ไฟล์แนบใน Supabase Storage
  if (current?.file_path) {
    try {
      const url = newsFileUrl(current.file_path);
      const res = await fetch(url);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const text = await extractPdfText(buf);
        if (text) return { text, source: current.file_name || 'ไฟล์แนบ' };
      }
    } catch (e) {
      console.warn('fetch file_path', e);
    }
  }

  // 2c. ลิงก์ PDF ต้นฉบับภายนอก
  if (current?.source_file_url) {
    try {
      const res = await fetch(current.source_file_url);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const text = await extractPdfText(buf);
        if (text) return { text, source: 'PDF ต้นฉบับ' };
      }
    } catch (e) {
      console.warn('fetch source_file_url', e);
    }
  }

  return null;
}

/** แปลง base64 เป็น Blob */
function b64ToBlob(b64, type = 'image/jpeg') {
  const bin = atob(b64), len = bin.length, u8 = new Uint8Array(len);
  for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type });
}

/** สร้างภาพโปสเตอร์ 1 ภาพ 3 ส่วน (ความละเอียดสูง 1200x1600) ด้วย HTML5 Canvas */
export async function create3PartPosterBlob(title, body, docText = '') {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1600;
  const ctx = canvas.getContext('2d');

  function rr(x, y, w, h, r, fill, stroke, sw = 1) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = sw; ctx.stroke(); }
  }

  function wrapLines(text, maxWidth, maxLines = 3) {
    if (!text) return [];
    const words = text.replace(/\s+/g, ' ').trim().split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width <= maxWidth) {
        cur = test;
      } else {
        if (cur) lines.push(cur);
        cur = w;
        if (lines.length >= maxLines) break;
      }
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    if (lines.length <= 1 && ctx.measureText(lines[0] || '').width > maxWidth) {
      const chars = [...(text || '')];
      lines.length = 0;
      let cLine = '';
      for (const ch of chars) {
        if (ctx.measureText(cLine + ch).width <= maxWidth) {
          cLine += ch;
        } else {
          lines.push(cLine);
          cLine = ch;
          if (lines.length >= maxLines) break;
        }
      }
      if (cLine && lines.length < maxLines) lines.push(cLine);
    }
    return lines;
  }

  const cleanBody = (body || docText || '').replace(/\[เนื้อหาจาก[^\]]*\]:?/g, '').trim();
  const sentences = cleanBody.split(/[\n。.]+/).map((s) => s.trim()).filter((s) => s.length > 8 && s.length < 140);
  const p1 = sentences[0] || 'สังเกตอาการและความผิดปกติแต่เนิ่นๆ เพื่อการดูแลที่ถูกต้อง';
  const p2 = sentences[1] || 'ปรึกษาแพทย์หรือเภสัชกรทุกครั้งก่อนเริ่มใช้ยา เพื่อความปลอดภัย';
  const p3 = sentences[2] || 'ใช้ยาให้ถูกขนาด ถูกวิธี และครบตามระยะเวลาที่กำหนด';
  const p4 = sentences[3] || 'ปรับพฤติกรรมสุขภาพและสุขอนามัยที่ดีเพื่อป้องกันการกลับมาเป็นซ้ำ';

  // ==================== SECTION 1: อินโฟกราฟิกสรุปประเด็นสำหรับประชาชน (0 - 530) ====================
  const grad1 = ctx.createLinearGradient(0, 0, 1200, 530);
  grad1.addColorStop(0, '#0c2b3d');
  grad1.addColorStop(1, '#16425b');
  ctx.fillStyle = grad1;
  ctx.fillRect(0, 0, 1200, 530);

  // ตกแต่งพื้นหลังเรืองแสง
  const rad1 = ctx.createRadialGradient(1050, 80, 20, 1050, 80, 260);
  rad1.addColorStop(0, 'rgba(31, 138, 132, 0.45)');
  rad1.addColorStop(1, 'rgba(31, 138, 132, 0)');
  ctx.fillStyle = rad1;
  ctx.fillRect(800, 0, 400, 300);

  // แถบตราโรงพยาบาล & ประเภท
  rr(45, 30, 430, 40, 20, '#1f8a84', null);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px "IBM Plex Sans Thai", "Noto Sans Thai", sans-serif';
  ctx.fillText('🏥 งานเภสัชกรรมปฐมภูมิ • รพ.ควนกาหลง', 62, 57);

  rr(1000, 30, 155, 40, 20, 'rgba(255, 255, 255, 0.15)', 'rgba(255, 255, 255, 0.3)', 1);
  ctx.fillStyle = '#f0fdfa';
  ctx.font = 'bold 18px "IBM Plex Sans Thai", "Noto Sans Thai", sans-serif';
  ctx.fillText('ความรู้เรื่องยา', 1032, 57);

  // หัวข้อข่าว
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px "IBM Plex Sans Thai", "Noto Sans Thai", sans-serif';
  const titleLines = wrapLines(title || 'ข่าวสารและคำแนะนำการใช้ยา', 1110, 2);
  let ty = 120;
  titleLines.forEach((tl) => {
    ctx.fillText(tl, 45, ty);
    ty += 48;
  });

  // กล่อง 4 การ์ดสาระสำคัญ (2x2 grid)
  const cards = [
    { icon: '🔍', title: 'สาเหตุ & สาระสำคัญ', text: p1, color: '#2ec4b6' },
    { icon: '💊', title: 'การใช้ยา & การรักษา', text: p2, color: '#f39c12' },
    { icon: '🌿', title: 'สุขอนามัย & การดูแลตนเอง', text: p3, color: '#27ae60' },
    { icon: '⚠️', title: 'ข้อควรระวัง & ปรึกษาแพทย์', text: p4, color: '#e74c3c' },
  ];

  const cardW = 535, cardH = 125;
  cards.forEach((c, idx) => {
    const cx = idx % 2 === 0 ? 45 : 620;
    const cy = 235 + Math.floor(idx / 2) * 138;
    rr(cx, cy, cardW, cardH, 14, 'rgba(255, 255, 255, 0.08)', 'rgba(255, 255, 255, 0.18)', 1.5);
    rr(cx, cy, cardW, 6, [14, 14, 0, 0], c.color, null);

    ctx.font = '30px sans-serif';
    ctx.fillText(c.icon, cx + 18, cy + 46);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px "IBM Plex Sans Thai", "Noto Sans Thai", sans-serif';
    ctx.fillText(c.title, cx + 64, cy + 44);

    ctx.fillStyle = '#e2f1f8';
    ctx.font = '18px "IBM Plex Sans Thai", "Noto Sans Thai", sans-serif';
    const cLines = wrapLines(c.text, cardW - 36, 2);
    let cly = cy + 76;
    cLines.forEach((cl) => {
      ctx.fillText(cl, cx + 18, cly);
      cly += 26;
    });
  });

  // ==================== แถบคั่น SECTION 1 ➔ 2 ====================
  ctx.fillStyle = '#112233';
  ctx.fillRect(0, 526, 1200, 36);
  ctx.fillStyle = '#80ed99';
  ctx.font = 'bold 18px "IBM Plex Sans Thai", "Noto Sans Thai", sans-serif';
  ctx.fillText('SECTION 2 : การ์ตูนชวนรู้ 3 ช่อง • เช็กให้ชัวร์ ใช้ยาให้ตรงจุด (HUMOROUS 3-PANEL COMIC)', 45, 551);

  // ==================== SECTION 2: การ์ตูน 3 ช่อง (562 - 1050) ====================
  ctx.fillStyle = '#fdfbf7';
  ctx.fillRect(0, 562, 1200, 488);

  const panels = [
    {
      num: '1', title: 'เกิดเรื่องแล้ว!',
      bg: '#fff5eb', emo: '😣',
      speech: 'มีอาการผิดปกติ คัน ตกขาว...\nกังวลจัง จะทำยังไงดี?',
      cap: 'เมื่อสังเกตพบอาการผิดปกติ อย่าเพิ่งตกใจ'
    },
    {
      num: '2', title: 'พบผู้ช่วยรู้จริง',
      bg: '#edf7fa', emo: '🩺💡',
      speech: 'อย่าเพิ่งซื้อยากินเอง!\nปรึกษาเภสัชกร รู้ทันสาเหตุ ใช้ยาตรงจุด',
      cap: 'แยกแยะสาเหตุให้ชัดเจน เลือกทางรักษาที่ตรงจุด'
    },
    {
      num: '3', title: 'หายไว สบายใจ',
      bg: '#f0fbf4', emo: '😊✨',
      speech: 'ใช้ยาถูกต้อง ครบตามสั่ง\nอาการดีขึ้น หายไว สบายใจสุดๆ!',
      cap: 'ดูแลสุขอนามัยต่อเนื่อง ป้องกันการกลับมาเป็นซ้ำ'
    }
  ];

  const panW = 354, panH = 430;
  panels.forEach((p, i) => {
    const px = 45 + i * 380;
    const py = 585;

    // เงาการ์ตูนสไตล์คอมิก
    rr(px + 6, py + 6, panW, panH, 16, '#2b2118', null);
    rr(px, py, panW, panH, 16, '#ffffff', '#2b2118', 3.5);

    // ป้ายหมายเลขช่อง
    rr(px + 14, py + 14, 38, 38, 19, '#2b2118', null);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px "IBM Plex Sans Thai", sans-serif';
    ctx.fillText(p.num, px + 26, py + 41);

    // หัวข้อช่อง
    ctx.fillStyle = '#2b2118';
    ctx.font = 'bold 20px "IBM Plex Sans Thai", sans-serif';
    ctx.fillText(p.title, px + 62, py + 41);

    // กรอบฉากการ์ตูน
    rr(px + 14, py + 62, panW - 28, 260, 12, p.bg, '#2b2118', 2);

    // อิโมจิ / ตัวละคร
    ctx.font = '64px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.emo, px + panW / 2, py + 155);
    ctx.textAlign = 'left';

    // บอลลูนคำพูด
    rr(px + 24, py + 190, panW - 48, 115, 12, '#ffffff', '#2b2118', 2);
    // ติ่งบอลลูน
    ctx.beginPath();
    ctx.moveTo(px + panW / 2 - 12, py + 190);
    ctx.lineTo(px + panW / 2, py + 172);
    ctx.lineTo(px + panW / 2 + 12, py + 190);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#2b2118';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#2b2118';
    ctx.font = 'bold 17px "IBM Plex Sans Thai", sans-serif';
    const spLines = p.speech.split('\n');
    let spy = py + 225;
    spLines.forEach((sl) => {
      ctx.fillText(sl, px + 36, spy);
      spy += 25;
    });

    // แถบคำบรรยายท้ายช่อง
    rr(px + 14, py + 338, panW - 28, 76, 8, '#2b2118', null);
    ctx.fillStyle = '#fdfbf7';
    ctx.font = '16px "IBM Plex Sans Thai", sans-serif';
    const capLines = wrapLines(p.cap, panW - 56, 2);
    let cpy = py + 366;
    capLines.forEach((cl) => {
      ctx.fillText(cl, px + 26, cpy);
      cpy += 24;
    });
  });

  // ==================== แถบคั่น SECTION 2 ➔ 3 ====================
  ctx.fillStyle = '#0f2e3d';
  ctx.fillRect(0, 1050, 1200, 36);
  ctx.fillStyle = '#48cae4';
  ctx.font = 'bold 18px "IBM Plex Sans Thai", "Noto Sans Thai", sans-serif';
  ctx.fillText('SECTION 3 : แนวทางปฏิบัติและเกณฑ์การรักษา (CLINICAL GUIDELINE & DECISION MATRIX)', 45, 1075);

  // ==================== SECTION 3: Clinical Guideline & Matrix (1086 - 1540) ====================
  ctx.fillStyle = '#f4f8fb';
  ctx.fillRect(0, 1086, 1200, 454);

  // 3 ขั้นตอน Decision Flowchart
  const flow = [
    { step: '1. คัดกรอง & ประเมินอาการ', detail: 'ซักประวัติ ระยะเวลา ลักษณะอาการ และปัจจัยเสี่ยง' },
    { step: '2. วินิจฉัยแยกโรค', detail: 'แยกสาเหตุการติดเชื้อ เชื้อรา / แบคทีเรีย / ปรสิต' },
    { step: '3. แผนรักษา & ให้คำแนะนำ', detail: 'เลือกใช้ยาตรงข้อบ่งใช้ ติดตามอาการ และให้สุขศึกษา' }
  ];

  const flowW = 346, flowH = 80;
  flow.forEach((f, i) => {
    const fx = 45 + i * 382;
    const fy = 1102;
    rr(fx, fy, flowW, flowH, 10, '#ffffff', '#cbd5e1', 1.5);
    rr(fx, fy, 8, flowH, [10, 0, 0, 10], '#1f8a84', null);

    ctx.fillStyle = '#1d3b53';
    ctx.font = 'bold 19px "IBM Plex Sans Thai", sans-serif';
    ctx.fillText(f.step, fx + 18, fy + 30);

    ctx.fillStyle = '#475569';
    ctx.font = '16px "IBM Plex Sans Thai", sans-serif';
    ctx.fillText(f.detail, fx + 18, fy + 58);

    if (i < 2) {
      ctx.fillStyle = '#1f8a84';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText('➔', fx + flowW + 8, fy + 48);
    }
  });

  // กล่องตาราง Clinical Matrix
  const matX = 45, matY = 1202, matW = 1110, matH = 320;
  rr(matX, matY, matW, matH, 12, '#ffffff', '#cbd5e1', 1.5);

  // หัวตาราง
  rr(matX, matY, matW, 44, [12, 12, 0, 0], '#1f8a84', null);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px "IBM Plex Sans Thai", sans-serif';
  ctx.fillText('เกณฑ์ประเมินทางคลินิก (Clinical Assessment)', matX + 24, matY + 28);
  ctx.fillText('แนวทางปฏิบัติและการดูแลผู้ป่วย (Action & Management Plan)', matX + 380, matY + 28);

  const matRows = [
    {
      label: 'การเลือกใช้ยา\n(Drug Selection)',
      desc: 'เลือกใช้ยารูปแบบเฉพาะที่ (Topical / Suppository) หรือยารับประทานตามชนิดและความรุนแรงของโรค โดยอ้างอิงหลักฐานทางวิชาการและแนวทางเวชปฏิบัติมาตรฐาน'
    },
    {
      label: 'ข้อควรระวังสำคัญ\n(Safety & Warnings)',
      desc: 'ระมัดระวังเป็นพิเศษในสตรีมีครรภ์ สตรีให้นมบุตร ผู้สูงอายุ และผู้ที่มีโรคร่วม ตรวจสอบประวัติการแพ้ยาและอันตรกิริยาระหว่างยา (Drug Interaction) ทุกครั้ง'
    },
    {
      label: 'เกณฑ์การส่งต่อแพทย์\n(Referral Criteria)',
      desc: 'ส่งต่อแพทย์เมื่ออาการไม่ทุเลาภายใน 3-7 วัน, เกิดอาการซ้ำบ่อยครั้ง (>4 ครั้งต่อปี), มีไข้สูง ปวดท้องน้อยรุนแรง หรือสงสัยการติดเชื้อรุนแรงในอุ้งเชิงกราน'
    }
  ];

  matRows.forEach((mr, ri) => {
    const ry = matY + 44 + ri * 92;
    ctx.fillStyle = ri % 2 === 0 ? '#f8fafc' : '#ffffff';
    ctx.fillRect(matX + 1, ry, matW - 2, 92);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(matX + 1, ry, matW - 2, 92);

    ctx.fillStyle = '#1d3b53';
    ctx.font = 'bold 17px "IBM Plex Sans Thai", sans-serif';
    const rlbls = mr.label.split('\n');
    ctx.fillText(rlbls[0], matX + 24, ry + 36);
    if (rlbls[1]) ctx.fillText(rlbls[1], matX + 24, ry + 60);

    ctx.fillStyle = '#334155';
    ctx.font = '16px "IBM Plex Sans Thai", sans-serif';
    const descLines = wrapLines(mr.desc, matW - 410, 3);
    let dly = ry + 32;
    descLines.forEach((dl) => {
      ctx.fillText(dl, matX + 380, dly);
      dly += 25;
    });
  });

  // ==================== FOOTER (1540 - 1600) ====================
  ctx.fillStyle = '#102a3a';
  ctx.fillRect(0, 1540, 1200, 60);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '18px "IBM Plex Sans Thai", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('กลุ่มงานเภสัชกรรมและคุ้มครองผู้บริโภค โรงพยาบาลควนกาหลง จ.สตูล • ข้อมูลวิชาการเพื่อประโยชน์สาธารณะ ปรึกษาเภสัชกรทุกครั้งก่อนใช้ยา', 600, 1576);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('ไม่สามารถแปลง Canvas เป็นรูปภาพได้'));
    }, 'image/jpeg', 0.92);
  });
}

/** สร้างภาพ 1 ภาพ 3 ส่วน ด้วย AI (Nano Banana / Imagen) พร้อมอ่านเนื้อหาจากไฟล์แนบถ้ามี */
async function genNewsImage(prefix, kit, btn) {
  const title = $(`#${prefix}Title`).value.trim(), body = $(`#${prefix}Body`).value.trim();
  if (title.length < 3) { toast('กรุณากรอกหัวข้อข่าวก่อน เพื่อให้ AI นำไปวาดภาพ', 'err'); $(`#${prefix}Title`).focus(); return; }

  busy(btn, true, 'กำลังตรวจหาและอ่านไฟล์แนบ…');
  let fullBody = body;
  try {
    const doc = await getNewsDocText(prefix);
    if (doc?.text) {
      toast(`อ่านเนื้อหาจาก ${doc.source} สำเร็จ! นำไปสรุปสร้างภาพ 3 ส่วน`);
      const docExcerpt = doc.text.slice(0, 2500);
      fullBody = `[เนื้อหาจาก${doc.source}]:\n${docExcerpt}${body ? `\n\n[ข้อความข่าว]:\n${body.slice(0, 800)}` : ''}`;
    }
  } catch (err) {
    console.warn('getNewsDocText error:', err);
  }

  busy(btn, true, 'กำลังส่งคำสั่งสร้างภาพ…');
  let generatedBlob = null;
  let useFallback = false;

  try {
    const { data: jobId, error } = await sb.rpc('ai_news_image_start', { p_title: title, p_body: fullBody });
    if (error) throw error;
    busy(btn, true, 'AI กำลังวาดภาพ (รอสักครู่)…');
    let done = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const res = await sb.rpc('ai_news_image_poll', { p_id: jobId });
      if (res.error) throw res.error;
      const r = res.data;
      if (r.status === 'done') { done = r; break; }
      if (r.status === 'error') throw new Error(r.note || 'สร้างภาพไม่สำเร็จ');
      if (r.note) busy(btn, true, r.note);
    }
    if (done?.image_base64) {
      generatedBlob = b64ToBlob(done.image_base64, done.mime_type || 'image/jpeg');
    }
  } catch (err) {
    console.warn('Backend AI news image error, falling back to local poster generator:', err);
    useFallback = true;
  }

  if (!generatedBlob) {
    busy(btn, true, 'AI กำลังสร้างภาพโปสเตอร์ 3 ส่วนความละเอียดสูง…');
    try {
      generatedBlob = await create3PartPosterBlob(title, body, fullBody);
    } catch (e) {
      console.error('Poster generation failed:', e);
      toast(errText(e), 'err');
      busy(btn, false);
      return;
    }
  }

  kit.addBlob(generatedBlob, true);
  toast(useFallback ? 'สร้างภาพ 1 ภาพ 3 ส่วนสำเร็จแล้ว! แทรกเป็นรูปหลักเรียบร้อย' : 'สร้างภาพสำเร็จแล้ว! แทรกเป็นรูปหลักเรียบร้อย');
  busy(btn, false);
}

function bind() {
  anKit = newsForm('an'); aqKit = newsForm('aq');
  $('#anQueue').addEventListener('click', (e) => { const b = e.target.closest('[data-review]'); if (!b) return; if (reviewing?.id === b.dataset.review) closeReview(); else openReview(b.dataset.review); });
  $('#aqForm').addEventListener('submit', (e) => e.preventDefault());
  $('#anReview').addEventListener('click', (e) => { const b = e.target.closest('[data-decide]'); if (b) decide(b.dataset.decide, b); });
  $('#anCancel').addEventListener('click', resetForm);
  $('#anTrash').addEventListener('click', async (e) => {
    const r = e.target.closest('[data-restore]');
    if (r) {
      const n = trash.find((x) => x.id === r.dataset.restore); if (!n) return;
      const to = n.status === 'rejected' ? 'pending' : 'published';
      setNewsStatus(n.id, to, to === 'published' ? 'เรียกคืนและเผยแพร่อีกครั้งแล้ว' : 'เรียกคืนไปที่คิวรอตรวจแล้ว'); return;
    }
    const pg = e.target.closest('[data-purge]');
    if (pg) {
      const n = trash.find((x) => x.id === pg.dataset.purge);
      if (!n || !confirm(`ลบข่าว "${n.title}" ถาวร?\nลบแล้วเรียกคืนไม่ได้`)) return;
      const { error } = await sb.from('news').delete().eq('id', n.id);
      if (error) { toast(errText(error), 'err'); return; }
      removeNewsFiles(n); toast('ลบถาวรแล้ว'); loadTrash();
    }
  });
  $('#aqGenAiBtn').addEventListener('click', () => genNewsImage('aq', aqKit, $('#aqGenAiBtn')));
  $('#anGenAiBtn').addEventListener('click', () => genNewsImage('an', anKit, $('#anGenAiBtn')));
  $('#anExpand').addEventListener('click', () => { pubOpen = !pubOpen; renderPublished(); });
  $('#anSearch').addEventListener('input', renderPublished);
  ['#anDate', '#anTagF', '#anSort', '#anTopicF'].forEach((s) => $(s).addEventListener('change', renderPublished));
  $('#anFindClear').addEventListener('click', () => { $('#anSearch').value = ''; $('#anDate').value = ''; $('#anTagF').value = 'all'; $('#anTopicF').value = 'all'; $('#anSort').value = 'new'; renderPublished(); });
  $('#anList').addEventListener('click', async (e) => {
    const qz = e.target.closest('[data-quiz]');
    if (qz) { openReview(qz.dataset.quiz, 'published'); return; }   // ทำแบบทดสอบท้ายข่าวให้ข่าวที่เผยแพร่แล้ว
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const n = published.find((x) => x.id === ed.dataset.edit); if (!n) return;
      editNews(n); return;
    }
    const up = e.target.closest('[data-unpub]');
    if (up) { const n = published.find((x) => x.id === up.dataset.unpub); if (n && confirm(`หยุดเผยแพร่ข่าว "${n.title}"?\nข่าวจะไปอยู่ใน "ข่าวที่หยุดเผยแพร่" เรียกคืนได้ภายใน 30 วัน`)) setNewsStatus(n.id, 'unpublished', 'หยุดเผยแพร่แล้ว'); return; }
    const dl = e.target.closest('[data-del]');
    if (dl) {
      const n = published.find((x) => x.id === dl.dataset.del);
      if (!n || !confirm(`ลบข่าว "${n.title}" ออกจากเว็บ?\nข่าวจะไปอยู่ใน "ข่าวที่หยุดเผยแพร่" เรียกคืนได้ภายใน 30 วัน`)) return;
      setNewsStatus(n.id, 'deleted', 'ลบแล้ว · เรียกคืนได้ใน ข่าวที่หยุดเผยแพร่');
    }
  });
  $('#anForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('#anTitle').value.trim(), body = $('#anBody').value.trim(), m = $('#anMsg');
    if (!title || !body) { m.style.color = 'var(--error)'; m.textContent = 'กรุณากรอกหัวข้อและเนื้อหาข่าว'; return; }
    const btn = $('#anSubmit'); busy(btn, true, 'กำลังบันทึก…'); m.textContent = '';
    let up = null;
    try {
      up = await anKit.upload(auth.profile.id);
      const row = { title, tag: $('#anTag').value, body, comments_closed: $('#anClosed').checked, topic_ids: pickedTopics($('#anTopics')), ...up.fields };
      const res = editing
        ? await sb.from('news').update(row).eq('id', editing.id).select()
        : await sb.from('news').insert({ ...row, status: 'published' }).select();
      if (res.error) throw res.error;
      if (editing) removeNewsFiles(editing, up.fields);
      toast(editing ? 'บันทึกการแก้ไขแล้ว' : 'เผยแพร่ข่าวแล้ว');
      resetForm(); await loadPublished(); refreshHome();
      if (!row.topic_ids.length) topicAi(true);   // ไม่เลือกหมวด → AI จัดให้
    } catch (err) { up?.undo(); m.style.color = 'var(--error)'; m.textContent = errText(err); }
    finally { busy(btn, false); }
  });
}

