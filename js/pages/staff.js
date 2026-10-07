// เจ้าหน้าที่ รพ.สต.: โครงหน้า + ข่าว (ส่งตรวจ) + ผลงาน (เผยแพร่ทันที) + ข้อเสนอแนะ
// มาตรฐาน → criteria.js · เยี่ยมบ้าน → visits.js · ข้อความ → chat.js · เอกสาร → docs.js · Health Rider → rider.js
import { sb, publicImageUrl } from '../supabase.js?v=4.4';
import { $, $$, esc, thaiDate, toast, errText, busy, fiscalYearOf } from '../util.js?v=4.4';
import { sortItems, loadUnits, unitName } from '../data.js?v=4.4';
import { auth } from '../auth.js?v=4.4';
import { uploadPublicImage, removeFiles } from '../upload.js?v=4.4';
import { newsForm, removeNewsFiles } from './news-form.js?v=4.4';
import { initCriteria } from './criteria.js?v=4.4';
import { initVisits } from './visits.js?v=4.4';
import { mountSummaries } from './summaries.js?v=4.4';
import { initStaffDocs } from './docs.js?v=4.4';
import { mountInbox, unmountInbox } from './chat.js?v=4.4';
import { mountUnitChat, unmountUnitChat } from './unitchat.js?v=4.4';
import { setCurrent } from '../nav.js?v=4.4';

export const STAFF_TABS = {   // เรียงตามเมนู: ข่าว › ข้อความ › เยี่ยมบ้าน › ผลงาน › มาตรฐาน › เอกสาร › ข้อเสนอแนะ (Health Rider ผู้ดูแลกรอกให้)
  news: 'ข่าวประชาสัมพันธ์',
  messages: 'ข้อความ',
  visits: 'เยี่ยมบ้าน',
  achievements: 'ผลงานมาตรฐานความปลอดภัยด้านยา ในรพ.สต.',
  criteria: 'ประเมินมาตรฐานด้านยา รพ.สต.',
  docs: 'ดาวน์โหลดเอกสาร',
  feedback: 'ข้อเสนอแนะถึงทีมพัฒนา',
};
let bound = false;

export function showStaff(tab, sub) {
  if (!STAFF_TABS[tab]) tab = 'news';
  const p = auth.profile;
  $('#staffHello').textContent = 'สวัสดี ' + (p.full_name || '');
  $('#staffUnit').textContent = (p.position ? p.position + ' · ' : '') + 'รพ.สต. ' + (p.unit?.name || '');
  $('#staffViewTitle').textContent = STAFF_TABS[tab];
  setCurrent('data-staff-tab', tab);
  $$('[data-staff-view]').forEach((v) => { v.hidden = v.dataset.staffView !== tab; });
  if (!bound) { bound = true; bindNews(); bindFeedback(); }
  ({ news: loadNews, achievements: () => mountAch($('#staffAchSlot'), auth.profile.unit_id), criteria: initCriteria, visits: () => { initVisits(sub); mountSummaries($('#staffSumSlot'), auth.profile.unit_id); }, messages: () => showMessages(sub), docs: initStaffDocs, feedback: loadFeedback })[tab]();
  refreshBadges();
}

/** ข้อความ: จากประชาชน (#/staff/messages) หรือ คุยกับผู้ดูแล (#/staff/messages/admin) */
function showMessages(sub) {
  const admin = sub === 'admin';
  $$('#ucStaffSwitch [data-uc]').forEach((a) => { if ((a.dataset.uc === 'admin') === admin) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $('#staffInboxSlot').hidden = admin; $('#staffUnitChatSlot').hidden = !admin;
  if (admin) { unmountInbox(); mountUnitChat($('#staffUnitChatSlot'), auth.profile.unit_id); }
  else { unmountUnitChat(); mountInbox($('#staffInboxSlot'), auth.profile.unit_id); }
}

/** ตัวเลขบนเมนู: ข่าว/หลักฐานที่ผู้ดูแลขอให้แก้ */
export async function refreshBadges() {
  const u = auth.profile?.unit_id;
  const [n, c] = await Promise.all([
    sb.from('news').select('id', { count: 'exact', head: true }).eq('author_id', auth.profile.id).eq('status', 'fix'),
    sb.from('item_status').select('id', { count: 'exact', head: true }).eq('unit_id', u).eq('status', 'fix'),
  ]);
  $('#stfNewsBadge').textContent = n.count ? String(n.count) : '';
  $('#stfCritBadge').textContent = c.count ? String(c.count) : '';
}

const STATUS = {
  pending: ['รอตรวจ', 'c-rev'], fix: ['ต้องแก้ไข', 'c-fix'], rejected: ['ไม่ผ่าน', 'c-off'], published: ['เผยแพร่แล้ว', 'c-ok'], unpublished: ['หยุดเผยแพร่', 'c-off'], deleted: ['ผู้ดูแลลบแล้ว', 'c-off'],
};

/* ---------------- ข่าว ---------------- */
let myNews = [], editingNews = null;

async function loadNews() {
  $('#snList').innerHTML = '<div class="skeleton"></div>';
  const { data, error } = await sb.from('news').select('id,title,tag,body,image_path,gallery,file_path,file_name,status,review_comment,created_at,updated_at')
    .eq('author_id', auth.profile.id).order('created_at', { ascending: false });
  if (error) { $('#snList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  myNews = data;
  $('#snList').innerHTML = data.length ? data.map((n) => {
    const [label, cls] = STATUS[n.status] || [n.status, 'c-off'];
    const canEdit = n.status === 'pending' || n.status === 'fix';
    return `<div class="li"><div class="l"><b>${esc(n.title)}</b><span class="small muted">${esc(n.tag)} · ส่งเมื่อ ${esc(thaiDate(n.created_at))}</span>`
      + (n.review_comment && n.status !== 'published' ? `<span class="small" style="color:var(--warning)">ความเห็นผู้ดูแล: ${esc(n.review_comment)}</span>` : '')
      + `</div><div class="row-btns" style="align-items:center"><span class="chip ${cls}">${label}</span>`
      + (canEdit ? `<button type="button" class="btn btn-o btn-sm" data-edit="${n.id}">แก้ไข</button>` : '')
      + (n.status !== 'published' ? `<button type="button" class="btn btn-no btn-sm" data-del="${n.id}">ลบ</button>` : '')
      + (n.status === 'published' ? `<a class="btn btn-o btn-sm" href="#/news/${n.id}">ดูข่าว</a>` : '')
      + '</div></div>';
  }).join('') : '<p class="empty">ยังไม่มีข่าวที่ส่ง</p>';
}

function resetNews() {
  editingNews = null; $('#snForm').reset(); snKit?.reset();
  $('#snFormTitle').textContent = 'ส่งข่าวประชาสัมพันธ์'; $('#snSubmit').textContent = 'ส่งให้ผู้ดูแลตรวจ'; $('#snCancel').hidden = true; $('#snMsg').textContent = '';
}

let snKit = null;
function bindNews() {
  snKit = newsForm('sn');
  $('#snCancel').addEventListener('click', resetNews);
  $('#snList').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const n = myNews.find((x) => x.id === ed.dataset.edit); if (!n) return;
      editingNews = n;
      $('#snTitle').value = n.title; $('#snBody').value = n.body; snKit.edit(n);
      $('#snFormTitle').textContent = 'แก้ไขข่าว'; $('#snSubmit').textContent = 'ส่งตรวจอีกครั้ง'; $('#snCancel').hidden = false;
      $('#snForm').scrollIntoView({ behavior: 'smooth' }); return;
    }
    const dl = e.target.closest('[data-del]');
    if (dl) {
      const n = myNews.find((x) => x.id === dl.dataset.del); if (!n || !confirm(`ลบข่าว "${n.title}"?`)) return;
      dl.disabled = true;
      const { error } = await sb.from('news').delete().eq('id', n.id);
      if (error) { dl.disabled = false; toast(errText(error), 'err'); return; }
      removeNewsFiles(n);
      if (editingNews?.id === n.id) resetNews();
      toast('ลบข่าวแล้ว'); loadNews(); refreshBadges();
    }
  });
  $('#snForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('#snTitle').value.trim(), body = $('#snBody').value.trim(), m = $('#snMsg');
    if (!title || !body) { m.style.color = 'var(--error)'; m.textContent = 'กรุณากรอกหัวข้อและเนื้อหาข่าว'; return; }
    const btn = $('#snSubmit'); busy(btn, true, 'กำลังส่ง…'); m.textContent = '';
    let up = null;
    try {
      up = await snKit.upload(auth.profile.id);
      const row = { title, tag: $('#snTag').value, body, ...up.fields };
      const res = editingNews
        ? await sb.from('news').update(row).eq('id', editingNews.id).select()
        : await sb.from('news').insert(row).select();
      if (res.error) throw res.error;
      if (editingNews) removeNewsFiles(editingNews, up.fields);
      toast(editingNews ? 'ส่งตรวจอีกครั้งแล้ว' : 'ส่งข่าวให้ผู้ดูแลตรวจแล้ว');
      resetNews(); loadNews(); refreshBadges();
    } catch (err) { up?.undo(); m.style.color = 'var(--error)'; m.textContent = errText(err); }
    finally { busy(btn, false); }
  });
}

/* ---------------- ผลงาน ---------------- */
let unitAch = [], editingAch = null, achUnit = null, achBound = false;

/** หน้าผลงานลงใน slot — เจ้าหน้าที่: unit = หน่วยตัวเอง · ผู้ดูแล: unit = 'all' (ทุกหน่วย + ช่องเลือก/เปลี่ยน รพ.สต. ในฟอร์ม) */
const ALL_UNITS = 'all';
export async function mountAch(slot, unit) {
  const units = await loadUnits();
  $('#saUnitWrap').hidden = unit !== ALL_UNITS;
  $('#saUnit').innerHTML = '<option value="">— เลือก รพ.สต. —</option>' + units.map((u) => `<option value="${u.id}">รพ.สต.${esc(u.name)}</option>`).join('');
  const ws = $('#achWs');
  if (ws.parentNode !== slot) slot.appendChild(ws);
  if (!achBound) { achBound = true; bindAch(); }
  if (achUnit !== unit) { achUnit = unit; resetAch(); }
  $('#saListTitle').textContent = unit === ALL_UNITS ? 'ผลงานของ รพ.สต. ทุกแห่ง' : `ผลงานของ รพ.สต.${unitName(unit)}`;
  return loadAch();
}

async function loadAch() {
  $('#saList').innerHTML = '<div class="skeleton"></div>';
  const q = sb.from('achievements').select('id,unit_id,title,body,image_path,item_ids,hidden,created_at');
  const [{ data, error }] = await Promise.all([
    (achUnit === ALL_UNITS ? q : q.eq('unit_id', achUnit)).order('created_at', { ascending: false }),
    loadCritPick(),
  ]);
  if (error) { $('#saList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  unitAch = data;
  aiOf = new Map();
  if (data.length) {
    const { data: ms } = await sb.from('ai_matches').select('id,achievement_id,status,matches,note,created_at').in('achievement_id', data.map((a) => a.id)).order('created_at', { ascending: false });
    (ms || []).forEach((m) => { if (!aiOf.has(m.achievement_id)) aiOf.set(m.achievement_id, m); });
  }
  renderAchList();
}
function renderAchList() {
  $('#saList').innerHTML = unitAch.length ? unitAch.map((a) => `<div class="newsrow"><div class="thumb2">${a.image_path ? `<img src="${esc(publicImageUrl(a.image_path))}" alt="" loading="lazy">` : ''}</div>`
    + `<div class="l"><b>${esc(a.title)}${a.hidden ? ' <span class="chip c-off">ระงับการแสดง</span>' : ''}</b><span class="small muted">${achUnit === ALL_UNITS ? 'รพ.สต.' + esc(unitName(a.unit_id)) + ' · ' : ''}${esc(thaiDate(a.created_at))}${critLabel(a.item_ids) ? ' · มาตรฐานข้อ ' + esc(critLabel(a.item_ids)) : ''}</span></div>`
    + aiStatus(a)
    + `<div class="row-btns"><a class="btn btn-o btn-sm" href="#/achievement/${esc(a.id)}">ดู</a><button type="button" class="btn btn-o btn-sm" data-edit="${a.id}">แก้ไข</button>`
    + `<button type="button" class="btn btn-o btn-sm" data-hide="${a.id}" aria-pressed="${!!a.hidden}">${a.hidden ? 'แสดงอีกครั้ง' : 'ระงับการแสดง'}</button><button type="button" class="btn btn-no btn-sm" data-del="${a.id}">ลบ</button></div></div>`).join('')
    : '<p class="empty">ยังไม่มีผลงาน</p>';
  clearTimeout(aiTimer);
  if ([...aiOf.values()].some((m) => m.status === 'pending')) aiTimer = setTimeout(pollAchAi, 3000);
}

/* ---- AI แนะนำข้อมาตรฐาน (37_ai_match.sql · Gemini ผ่านฐานข้อมูล ไม่มีคีย์ในหน้าเว็บ): เริ่ม → รอผลสักครู่ ---- */
let aiOf = new Map(), aiTimer = 0, formAi = null;   // aiOf: ผลงาน → ผลวิเคราะห์ล่าสุด · formAi: ผลในฟอร์ม { id, text } → ผูกกับผลงานตอนบันทึก
const SPIN = '<span class="spin" aria-hidden="true"></span>';
const achText = (title, body) => [String(title || '').trim(), String(body || '').trim()].filter(Boolean).join('\n');
const aiNos = (m) => m.matches.map((x) => x.item_no).join(', ');
function aiStatus(a) {
  const m = aiOf.get(a.id), run = (t) => `<button type="button" class="btn btn-o btn-sm" data-ai-run="${a.id}">${t}</button>`;
  let h;
  if (!m) h = `<span class="chip c-off">AI ยังไม่วิเคราะห์</span>${run('ให้ AI วิเคราะห์')}`;
  else if (m.status === 'pending') h = `<span class="chip c-rev">${SPIN}AI กำลังวิเคราะห์…</span>`;
  else if (m.status === 'error') h = `<span class="chip c-fix" title="${esc(m.note || '')}">AI วิเคราะห์ไม่สำเร็จ</span>${run('ลองใหม่')}`;
  else if (!m.matches.length) h = '<span class="chip c-off">AI: ไม่พบข้อที่ตรงชัดเจน</span>';
  else {
    const missing = m.matches.filter((x) => !(a.item_ids || []).includes(x.item_id));
    h = `<span class="chip c-ok" title="${esc(m.matches.map((x) => `ข้อ ${x.item_no}: ${x.reason}`).join('\n'))}">AI: ตรงกับข้อ ${esc(aiNos(m))}</span>`
      + (missing.length ? `<button type="button" class="btn btn-p btn-sm" data-ai-apply="${a.id}">แนบตามที่ AI แนะนำ</button>` : '<span class="small muted">แนบครบแล้ว</span>');
  }
  return `<div class="ai-st" aria-live="polite">${h}</div>`;
}
async function pollAi(id) {
  const { data, error } = await sb.rpc('ai_match_poll', { p_id: id });
  if (error) throw error;
  return data;
}
async function pollAchAi() {
  if ($('#achWs').closest('[hidden]')) return;   // ออกจากหน้าแล้ว (เจ้าหน้าที่/ผู้ดูแล) — หยุดรอ
  for (const [aid, m] of aiOf) if (m.status === 'pending') { try { aiOf.set(aid, { ...m, ...await pollAi(m.id) }); } catch { /* ลองรอบหน้า */ } }
  renderAchList();
}
async function runFormAi() {
  const body = $('#saBody').value.trim(), out = $('#saAiOut'), btn = $('#saAiBtn');
  if (body.length < 10) { out.innerHTML = '<p class="small ai-err">กรุณาพิมพ์ "รายละเอียด" ผลงานด้านบนก่อน (อย่างน้อย 10 ตัวอักษร) แล้วจึงกดให้ AI วิเคราะห์</p>'; $('#saBody').focus(); return; }
  const text = achText($('#saTitle').value, body);
  busy(btn, true, 'AI กำลังวิเคราะห์…');
  out.innerHTML = `<p class="small muted">${SPIN}AI กำลังเทียบกับหัวข้อมาตรฐานทุกข้อ กรุณารอสักครู่ (ประมาณ 10–30 วินาที)</p>`;
  try {
    const { data: id, error } = await sb.rpc('ai_match_start', { p_text: text });
    if (error) throw error;
    formAi = { id, text };
    let r = await pollAi(id);
    for (let i = 0; r.status === 'pending' && i < 48; i++) { await new Promise((ok) => setTimeout(ok, 2500)); r = await pollAi(id); }
    if (formAi?.id === id) showFormAi(r);
  } catch (err) { out.innerHTML = `<p class="small ai-err">${esc(errText(err))}</p>`; }
  finally { busy(btn, false); }
}
function showFormAi(r) {
  const out = $('#saAiOut');
  if (r.status === 'pending') { out.innerHTML = '<p class="small muted">AI ยังวิเคราะห์ไม่เสร็จ · บันทึกผลงานได้เลย ผลจะขึ้นในรายการผลงานด้านล่าง</p>'; return; }
  if (r.status === 'error') { out.innerHTML = `<p class="small ai-err">${esc(r.note || 'AI วิเคราะห์ไม่สำเร็จ')}</p>`; return; }
  if (!r.matches.length) { out.innerHTML = '<p class="small">AI ไม่พบข้อมาตรฐานที่ตรงกับรายละเอียดนี้ชัดเจน · เลือกเองได้จากรายการด้านล่าง</p>'; return; }
  r.matches.forEach((m) => critPicked.add(m.item_id));
  $('#saCritQ').value = ''; renderCritPick(); $('#saCritFold').open = true;   // เปิดรายการให้เห็นข้อที่ AI ติ๊ก
  out.innerHTML = `<p class="small"><b>AI แนะนำ ${r.matches.length} ข้อ — ติ๊กให้แล้วในรายการด้านล่าง</b> ตรวจดู/แก้ได้ก่อนกดบันทึก</p><ul class="ai-list">`
    + r.matches.map((m) => `<li><b>ข้อ ${esc(m.item_no)}</b> ${esc(m.reason)}</li>`).join('') + '</ul>';
}
/** หลังบันทึก: ผูกผลวิเคราะห์ในฟอร์ม หรือให้ AI วิเคราะห์ผลงานนี้ (ถ้าข้อความใหม่/เปลี่ยน) → สถานะขึ้นในรายการ */
async function aiAfterSave(saved, before) {
  const text = achText(saved.title, saved.body);
  try {
    if (formAi && formAi.text === text) await sb.rpc('ai_match_link', { p_id: formAi.id, p_achievement: saved.id });
    else if (text.length >= 10 && (!before || text !== achText(before.title, before.body))) await sb.rpc('ai_match_start', { p_text: text, p_achievement: saved.id });
  } catch { /* AI ไม่พร้อม/ครบโควตา — ผลงานบันทึกแล้ว กด "ให้ AI วิเคราะห์" ในรายการภายหลังได้ */ }
}

/* ผลงาน ↔ ข้อมาตรฐานปีงบปัจจุบัน (achievements.item_ids) — แนบเป็นหลักฐานของข้อนั้นอัตโนมัติ ไม่ต้องส่งตรวจ */
let critItems = null;
const critPicked = new Set();   // id ข้อที่เลือก (รวมข้อของปีงบก่อนที่ผูกไว้เดิม — เก็บไว้ตามเดิม)
const critLabel = (ids) => (critItems || []).filter((it) => ids?.includes(it.id)).map((it) => it.item_no).join(', ');
async function loadCritPick() {
  if (!critItems) {
    $('#saCrit').innerHTML = '<div class="skeleton"></div>';
    const { data, error } = await sb.from('criteria_items').select('id,topic_no,topic_title,sub_id,item_no,body,sort').eq('fiscal_year', fiscalYearOf()).order('sort');
    if (error) { $('#saCrit').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
    critItems = sortItems(data);
  }
  renderCritPick();
}
function renderCritPick() {
  if (!critItems) return;
  const q = $('#saCritQ').value.trim().toLowerCase();
  const list = critItems.filter((it) => !q || `${it.item_no} ${it.body} ${it.topic_title}`.toLowerCase().includes(q));
  let lastTopic = null;
  $('#saCrit').innerHTML = list.map((it) => {
    const head = it.topic_no !== lastTopic ? `<p class="crit-pick-h">${esc(it.topic_title)}</p>` : '';
    lastTopic = it.topic_no;
    return head + `<label class="crit-opt"><input type="checkbox" value="${it.id}"${critPicked.has(it.id) ? ' checked' : ''}><span><b>${esc(it.item_no)}</b> ${esc(it.body)}</span></label>`;
  }).join('') || `<p class="empty">${critItems.length ? 'ไม่พบข้อที่ค้นหา' : `ยังไม่มีเกณฑ์มาตรฐานของปีงบ ${fiscalYearOf()}`}</p>`;
  critCount();
}
function critCount() {
  const l = critLabel([...critPicked]);
  $('#saCritN').textContent = l ? `เลือกแล้ว: ข้อ ${l}` : 'ยังไม่ได้เลือก · กดเพื่อเลือก';
}

function resetAch() {
  editingAch = null; $('#saForm').reset(); $('#saImageNote').textContent = '';
  critPicked.clear(); renderCritPick(); formAi = null; $('#saAiOut').innerHTML = ''; $('#saCritFold').open = false;
  $('#saFormTitle').textContent = 'เพิ่มผลงาน'; $('#saSubmit').textContent = 'เผยแพร่ผลงาน'; $('#saCancel').hidden = true; $('#saMsg').textContent = '';
}

function bindAch() {
  $('#saCancel').addEventListener('click', resetAch);
  $('#saCritQ').addEventListener('input', renderCritPick);
  $('#saAiBtn').addEventListener('click', runFormAi);
  $('#saCrit').addEventListener('change', (e) => {
    const id = +e.target.value; if (!id) return;
    if (e.target.checked) critPicked.add(id); else critPicked.delete(id);
    critCount();
  });
  $('#saList').addEventListener('click', async (e) => {
    const hd = e.target.closest('[data-hide]');
    if (hd) {   // ระงับการแสดงบนหน้าสาธารณะ (ยังไม่ลบ · เปิดแสดงอีกครั้งได้)
      const a = unitAch.find((x) => x.id === hd.dataset.hide); if (!a) return;
      busy(hd, true, 'กำลังบันทึก…');
      const { error } = await sb.from('achievements').update({ hidden: !a.hidden }).eq('id', a.id);
      if (error) { busy(hd, false); toast(errText(error), 'err'); return; }
      a.hidden = !a.hidden; toast(a.hidden ? 'ระงับการแสดงแล้ว — หน้าหลักจะไม่แสดงผลงานนี้ (ยังไม่ลบ)' : 'แสดงผลงานอีกครั้งแล้ว'); renderAchList(); return;
    }
    const ar = e.target.closest('[data-ai-run]');
    if (ar) {
      const a = unitAch.find((x) => x.id === ar.dataset.aiRun); if (!a) return;
      busy(ar, true, 'กำลังส่ง…');
      const { data: id, error } = await sb.rpc('ai_match_start', { p_text: achText(a.title, a.body), p_achievement: a.id });
      if (error) { busy(ar, false); toast(errText(error), 'err'); return; }
      aiOf.set(a.id, { id, achievement_id: a.id, status: 'pending', matches: [] }); renderAchList(); return;
    }
    const ap = e.target.closest('[data-ai-apply]');
    if (ap) {
      const a = unitAch.find((x) => x.id === ap.dataset.aiApply), m = a && aiOf.get(a.id); if (!m) return;
      busy(ap, true, 'กำลังแนบ…');
      const ids = [...new Set([...(a.item_ids || []), ...m.matches.map((x) => x.item_id)])];
      const { error } = await sb.from('achievements').update({ item_ids: ids }).eq('id', a.id);
      if (error) { busy(ap, false); toast(errText(error), 'err'); return; }
      a.item_ids = ids; toast(`แนบเป็นหลักฐานมาตรฐานข้อ ${aiNos(m)} แล้ว`); renderAchList(); return;
    }
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const a = unitAch.find((x) => x.id === ed.dataset.edit); if (!a) return;
      editingAch = a; $('#saTitle').value = a.title; $('#saBody').value = a.body || ''; $('#saUnit').value = String(a.unit_id ?? '');
      critPicked.clear(); (a.item_ids || []).forEach((id) => critPicked.add(id)); $('#saCritQ').value = ''; renderCritPick();
      formAi = null; $('#saAiOut').innerHTML = '';
      $('#saImageNote').textContent = a.image_path ? 'มีรูปเดิมอยู่แล้ว · เลือกรูปใหม่เพื่อเปลี่ยน' : '';
      $('#saFormTitle').textContent = 'แก้ไขผลงาน'; $('#saSubmit').textContent = 'บันทึกการแก้ไข'; $('#saCancel').hidden = false;
      $('#saForm').scrollIntoView({ behavior: 'smooth' }); return;
    }
    const dl = e.target.closest('[data-del]');
    if (dl) {
      const a = unitAch.find((x) => x.id === dl.dataset.del); if (!a || !confirm(`ลบผลงาน "${a.title}" ออกจากหน้าหลัก?`)) return;
      dl.disabled = true;
      const { error } = await sb.from('achievements').delete().eq('id', a.id);
      if (error) { dl.disabled = false; toast(errText(error), 'err'); return; }
      removeFiles('public-images', a.image_path ? [a.image_path] : []);
      if (editingAch?.id === a.id) resetAch();
      toast('ลบผลงานแล้ว'); loadAch();
    }
  });
  $('#saForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('#saTitle').value.trim(), m = $('#saMsg');
    if (!title) { m.style.color = 'var(--error)'; m.textContent = 'กรุณากรอกชื่อผลงาน'; return; }
    const btn = $('#saSubmit'); busy(btn, true, 'กำลังบันทึก…'); m.textContent = '';
    try {
      const file = $('#saImage').files[0];
      const unit = achUnit === ALL_UNITS ? +$('#saUnit').value : achUnit;   // ผู้ดูแล: หน่วยที่เลือกในฟอร์ม (เปลี่ยนภายหลังได้)
      if (!unit) throw new Error('กรุณาเลือก รพ.สต. ที่ทำผลงานนี้');
      const row = { title, body: $('#saBody').value.trim() || null, item_ids: [...critPicked], ...(achUnit === ALL_UNITS ? { unit_id: unit } : {}) };
      if (file) row.image_path = await uploadPublicImage(file, `achievements/${unit}`);
      const res = editingAch
        ? await sb.from('achievements').update(row).eq('id', editingAch.id).select()
        : await sb.from('achievements').insert({ ...row, unit_id: unit }).select();
      if (res.error) throw res.error;
      if (res.data?.[0]) await aiAfterSave(res.data[0], editingAch);
      if (file && editingAch?.image_path) removeFiles('public-images', [editingAch.image_path]);
      const linked = critLabel(row.item_ids);
      toast((editingAch ? 'บันทึกการแก้ไขแล้ว' : 'เผยแพร่ผลงานแล้ว') + (linked ? ` · แนบเป็นหลักฐานมาตรฐานข้อ ${linked}` : ''));
      resetAch(); loadAch();
    } catch (err) { m.style.color = 'var(--error)'; m.textContent = errText(err); }
    finally { busy(btn, false); }
  });
}

/* ---------------- ข้อเสนอแนะ ---------------- */
async function loadFeedback() {
  const { data } = await sb.from('feedback').select('id,body,created_at').eq('author_id', auth.profile.id).order('created_at', { ascending: false });
  $('#sfList').innerHTML = data?.length
    ? data.map((f) => `<div class="li"><div class="l"><b>${esc(f.body)}</b><span class="small muted">ส่งเมื่อ ${esc(thaiDate(f.created_at))}</span></div></div>`).join('')
    : '<p class="empty">ยังไม่มีข้อเสนอแนะที่ส่ง</p>';
}
function bindFeedback() {
  $('#sfForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = $('#sfText').value.trim(); if (!t) return;
    const btn = e.target.querySelector('button'); busy(btn, true, 'กำลังส่ง…');
    const { error } = await sb.from('feedback').insert({ body: t });
    busy(btn, false);
    if (error) { $('#sfMsg').textContent = errText(error); return; }
    $('#sfText').value = ''; toast('ส่งข้อเสนอแนะแล้ว ขอบคุณครับ'); loadFeedback();
  });
}

// แก้ชื่อในหน้าต่างข้อมูลส่วนตัว → คำทักทายหัวหน้าเปลี่ยนตาม
window.addEventListener('pcps:profile', () => {
  const p = auth.profile; if (!p) return;
  $('#staffHello').textContent = 'สวัสดี ' + (p.full_name || '');
  $('#staffUnit').textContent = (p.position ? p.position + ' · ' : '') + 'รพ.สต. ' + (p.unit?.name || '');
});
