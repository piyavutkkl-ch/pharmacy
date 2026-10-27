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
  try {
    const { data: jobId, error } = await sb.rpc('ai_news_image_start', { p_title: title, p_body: fullBody });
    if (error) throw error;
    busy(btn, true, 'AI กำลังวาดภาพ (รอสักครู่)…');
    let done = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const res = await sb.rpc('ai_news_image_poll', { p_id: jobId });
      if (res.error) throw res.error;
      const r = res.data;
      if (r.status === 'done') { done = r; break; }
      if (r.status === 'error') throw new Error(r.note || 'สร้างภาพไม่สำเร็จ');
    }
    if (!done || !done.image_base64) throw new Error('AI ตอบช้าเกินไป กรุณาลองใหม่อีกครั้ง');
    const blob = b64ToBlob(done.image_base64, done.mime_type || 'image/jpeg');
    kit.addBlob(blob, true);
    toast('สร้างภาพสำเร็จแล้ว! แทรกเป็นรูปหลักเรียบร้อย');
  } catch (err) {
    toast(errText(err), 'err');
  } finally {
    busy(btn, false);
  }
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

