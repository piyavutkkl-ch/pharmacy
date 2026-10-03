// เจ้าหน้าที่ รพ.สต.: โครงหน้า + ข่าว (ส่งตรวจ) + ผลงาน (เผยแพร่ทันที) + ข้อเสนอแนะ
// มาตรฐาน → criteria.js · เยี่ยมบ้าน → visits.js · ข้อความ → chat.js · เอกสาร → docs.js · Health Rider → rider.js
import { sb, publicImageUrl } from '../supabase.js?v=4.4';
import { $, $$, esc, thaiDate, toast, errText, busy } from '../util.js?v=4.4';
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
  docs: 'เอกสารดาวน์โหลด',
  feedback: 'ข้อเสนอแนะถึงทีมพัฒนา',
};
let bound = false;

export function showStaff(tab, sub) {
  if (!STAFF_TABS[tab]) tab = 'news';
  const p = auth.profile;
  $('#staffHello').textContent = 'สวัสดี ' + (p.full_name || '');
  $('#staffUnit').textContent = 'รพ.สต. ' + (p.unit?.name || '');
  $('#staffViewTitle').textContent = STAFF_TABS[tab];
  setCurrent('data-staff-tab', tab);
  $$('[data-staff-view]').forEach((v) => { v.hidden = v.dataset.staffView !== tab; });
  if (!bound) { bound = true; bindNews(); bindAch(); bindFeedback(); }
  ({ news: loadNews, achievements: loadAch, criteria: initCriteria, visits: () => { initVisits(); mountSummaries($('#staffSumSlot'), auth.profile.unit_id); }, messages: () => showMessages(sub), docs: initStaffDocs, feedback: loadFeedback })[tab]();
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
let unitAch = [], editingAch = null;

async function loadAch() {
  $('#saList').innerHTML = '<div class="skeleton"></div>';
  const { data, error } = await sb.from('achievements').select('id,title,body,image_path,created_at').eq('unit_id', auth.profile.unit_id).order('created_at', { ascending: false });
  if (error) { $('#saList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  unitAch = data;
  $('#saList').innerHTML = data.length ? data.map((a) => `<div class="newsrow"><div class="thumb2">${a.image_path ? `<img src="${esc(publicImageUrl(a.image_path))}" alt="" loading="lazy">` : ''}</div>`
    + `<div class="l"><b>${esc(a.title)}</b><span class="small muted">${esc(thaiDate(a.created_at))}</span></div>`
    + `<div class="row-btns"><button type="button" class="btn btn-o btn-sm" data-edit="${a.id}">แก้ไข</button><button type="button" class="btn btn-no btn-sm" data-del="${a.id}">ลบ</button></div></div>`).join('')
    : '<p class="empty">ยังไม่มีผลงาน</p>';
}

function resetAch() {
  editingAch = null; $('#saForm').reset(); $('#saImageNote').textContent = '';
  $('#saFormTitle').textContent = 'เพิ่มผลงาน'; $('#saSubmit').textContent = 'เผยแพร่ผลงาน'; $('#saCancel').hidden = true; $('#saMsg').textContent = '';
}

function bindAch() {
  $('#saCancel').addEventListener('click', resetAch);
  $('#saList').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const a = unitAch.find((x) => x.id === ed.dataset.edit); if (!a) return;
      editingAch = a; $('#saTitle').value = a.title; $('#saBody').value = a.body || '';
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
      const row = { title, body: $('#saBody').value.trim() || null };
      if (file) row.image_path = await uploadPublicImage(file, `achievements/${auth.profile.unit_id}`);
      const res = editingAch
        ? await sb.from('achievements').update(row).eq('id', editingAch.id).select()
        : await sb.from('achievements').insert({ ...row, unit_id: auth.profile.unit_id }).select();
      if (res.error) throw res.error;
      if (file && editingAch?.image_path) removeFiles('public-images', [editingAch.image_path]);
      toast(editingAch ? 'บันทึกการแก้ไขแล้ว' : 'เผยแพร่ผลงานแล้ว');
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
window.addEventListener('pcps:profile', () => { $('#staffHello').textContent = 'สวัสดี ' + (auth.profile?.full_name || ''); });
