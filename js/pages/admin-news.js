// ผู้ดูแล › ข่าว: ตรวจข่าวจากเจ้าหน้าที่ (อนุมัติ/ขอแก้/ไม่ผ่าน) + เขียนข่าวเอง + จัดการข่าวที่เผยแพร่
import { sb, publicImageUrl } from '../supabase.js?v=4.4';
import { $, esc, thaiDate, toast, errText, busy } from '../util.js?v=4.4';
import { auth } from '../auth.js?v=4.4';
import { loadUnits, unitName } from '../data.js?v=4.4';
import { newsForm, removeNewsFiles, fileLink } from './news-form.js?v=4.4';
import { loadNews, renderSlides } from './news.js?v=4.4';
import { refreshAdminBadges } from './admin.js?v=4.4';

let queue = [], published = [], trash = [], reviewing = null, editing = null, bound = false;
const TRASH = ['unpublished', 'deleted', 'rejected'], KEEP_DAYS = 30, DAY = 86_400_000;
const TRASH_LABEL = { unpublished: ['หยุดเผยแพร่', 'c-off'], deleted: ['ลบแล้ว', 'c-del'], rejected: ['ไม่ผ่าน', 'c-fix'] };

export async function initAdminNews() {
  await loadUnits();
  if (!bound) { bound = true; bind(); }
  await Promise.all([loadQueue(), loadPublished(), loadTrash()]);
}

async function loadQueue() {
  const { data, error } = await sb.from('news').select('id,title,tag,body,image_path,file_path,file_name,unit_id,created_at,author:profiles!news_author_id_fkey(full_name)').eq('status', 'pending').order('created_at');
  if (error) { $('#anQueue').innerHTML = `<p class="empty">โหลดข่าวรอตรวจไม่สำเร็จ: ${esc(errText(error))}</p>`; return; }
  queue = data;
  $('#anQueueCount').textContent = queue.length ? `(${queue.length})` : '';
  $('#anQueue').innerHTML = queue.length ? queue.map((n) => `<div class="li"><div class="l"><b>${esc(n.title)}</b>`
    + `<span class="small muted">${esc(n.author?.full_name || '-')} · รพ.สต. ${esc(unitName(n.unit_id))} · ${esc(n.tag)} · ${esc(thaiDate(n.created_at))}</span></div>`
    + `<button type="button" class="btn btn-p btn-sm" data-review="${n.id}">ตรวจ</button></div>`).join('')
    : '<p class="empty">ไม่มีข่าวรอตรวจ</p>';
  if (reviewing && !queue.some((n) => n.id === reviewing.id)) closeReview();
}

function openReview(id) {
  reviewing = queue.find((n) => n.id === id); if (!reviewing) return;
  const n = reviewing, el = $('#anReview');
  el.hidden = false;
  el.innerHTML = `<div class="panel-head"><h2>${esc(n.title)}</h2><span class="tag">${esc(n.tag)}</span></div>`
    + `<p class="small muted">ส่งโดย ${esc(n.author?.full_name || '-')} · รพ.สต. ${esc(unitName(n.unit_id))}</p>`
    + (n.image_path ? `<div class="cover" style="max-width:480px"><img src="${esc(publicImageUrl(n.image_path))}" alt="" style="width:100%;height:100%;object-fit:cover"></div>` : '')
    + `<div class="article-body" style="font-size:15px">${String(n.body).split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join('')}</div>`
    + (n.file_path ? `<div>${fileLink(n)}</div>` : '')
    + '<label for="anComment" class="small" style="font-weight:600">ความเห็นถึงผู้ส่ง (จำเป็นเมื่อขอแก้ไขหรือไม่ผ่าน)</label><textarea id="anComment" rows="2" maxlength="1000"></textarea>'
    + '<div class="row-btns" style="align-items:center"><button type="button" class="btn btn-ok" data-decide="published">อนุมัติ &amp; เผยแพร่</button>'
    + '<button type="button" class="btn btn-warn" data-decide="fix">ขอแก้ไข</button><button type="button" class="btn btn-no" data-decide="rejected">ไม่ผ่าน</button>'
    + '<button type="button" class="btn btn-o btn-sm" data-decide="close">ปิด</button><span class="small" id="anDecideMsg" aria-live="polite"></span></div>';
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function closeReview() { reviewing = null; $('#anReview').hidden = true; $('#anReview').innerHTML = ''; }

async function decide(status, btn) {
  if (status === 'close') return closeReview();
  const comment = $('#anComment').value.trim();
  if (status !== 'published' && !comment) { $('#anDecideMsg').style.color = 'var(--error)'; $('#anDecideMsg').textContent = 'กรุณาใส่ความเห็นให้ผู้ส่งทราบว่าต้องแก้อะไร'; $('#anComment').focus(); return; }
  busy(btn, true, 'กำลังบันทึก…');
  const { error } = await sb.from('news').update({ status, review_comment: comment || null }).eq('id', reviewing.id);
  busy(btn, false);
  if (error) { toast(errText(error), 'err'); return; }
  toast({ published: 'เผยแพร่ข่าวแล้ว', fix: 'ส่งกลับให้แก้ไขแล้ว', rejected: 'บันทึกว่าไม่ผ่านแล้ว' }[status]);
  closeReview(); loadQueue(); refreshAdminBadges();
  if (status === 'published') { loadPublished(); refreshHome(); }
  if (status === 'rejected') loadTrash();
}

async function loadPublished() {
  const { data, error } = await sb.from('news').select('id,title,tag,body,image_path,file_path,file_name,comments_closed,view_count,published_at,unit_id').eq('status', 'published').order('published_at', { ascending: false });
  if (error) { $('#anList').innerHTML = `<p class="empty">โหลดข่าวไม่สำเร็จ: ${esc(errText(error))}</p>`; return; }
  published = data;
  $('#anCount').textContent = `(${published.length})`;
  $('#anList').innerHTML = published.length ? published.map((n) => `<div class="newsrow"><div class="thumb2">${n.image_path ? `<img src="${esc(publicImageUrl(n.image_path))}" alt="" loading="lazy">` : ''}</div>`
    + `<div class="l"><b>${esc(n.title)}</b><span class="small muted">${esc(n.tag)} · ${esc(thaiDate(n.published_at))} · ${n.view_count.toLocaleString('th-TH')} ผู้เข้าชม${n.unit_id != null ? ' · จาก รพ.สต. ' + esc(unitName(n.unit_id)) : ''}${n.comments_closed ? ' · ปิดความคิดเห็น' : ''}</span></div>`
    + `<div class="row-btns"><a class="btn btn-o btn-sm" href="#/news/${n.id}">ดู</a><button type="button" class="btn btn-o btn-sm" data-edit="${n.id}">แก้ไข</button><button type="button" class="btn btn-o btn-sm" data-unpub="${n.id}">หยุดเผยแพร่</button><button type="button" class="btn btn-no btn-sm" data-del="${n.id}">ลบ</button></div></div>`).join('')
    : '<p class="empty">ยังไม่มีข่าวที่เผยแพร่</p>';
}

/* ---------- ข่าวที่หยุดเผยแพร่ (ถังข่าว): หยุดเผยแพร่ / ลบ / ไม่ผ่าน → เรียกคืนได้ 30 วัน ---------- */
async function loadTrash() {
  const cut = new Date(Date.now() - KEEP_DAYS * DAY).toISOString();
  const old = await sb.from('news').select('id,image_path,file_path').in('status', TRASH).lt('trashed_at', cut);
  if (old.data?.length) {   // ครบ 30 วัน → ลบถาวร
    const { error } = await sb.from('news').delete().in('id', old.data.map((n) => n.id));
    if (!error) old.data.forEach((n) => removeNewsFiles(n));
  }
  const { data, error } = await sb.from('news').select('id,title,tag,status,prev_status,trashed_at,updated_at,image_path,file_path,unit_id').in('status', TRASH).order('trashed_at', { ascending: false });
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
  editing = null; $('#anForm').reset(); anKit?.reset(); $('#anMsg').textContent = '';
  $('#anFormTitle').textContent = 'เขียนข่าว (เผยแพร่ทันที)'; $('#anSubmit').textContent = 'เผยแพร่ข่าว'; $('#anCancel').hidden = true;
}
function refreshHome() { loadNews(true).then(renderSlides).catch(() => {}); }

let anKit = null;
function bind() {
  anKit = newsForm('an');
  $('#anQueue').addEventListener('click', (e) => { const b = e.target.closest('[data-review]'); if (b) openReview(b.dataset.review); });
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
  $('#anList').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const n = published.find((x) => x.id === ed.dataset.edit); if (!n) return;
      editing = n; $('#anTitle').value = n.title; $('#anBody').value = n.body; $('#anClosed').checked = n.comments_closed; anKit.edit(n);
      $('#anFormTitle').textContent = 'แก้ไขข่าว'; $('#anSubmit').textContent = 'บันทึกการแก้ไข'; $('#anCancel').hidden = false;
      $('#anForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
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
      const row = { title, tag: $('#anTag').value, body, comments_closed: $('#anClosed').checked, ...up.fields };
      const res = editing
        ? await sb.from('news').update(row).eq('id', editing.id).select()
        : await sb.from('news').insert({ ...row, status: 'published' }).select();
      if (res.error) throw res.error;
      if (editing) removeNewsFiles(editing, up.fields);
      toast(editing ? 'บันทึกการแก้ไขแล้ว' : 'เผยแพร่ข่าวแล้ว');
      resetForm(); loadPublished(); refreshHome();
    } catch (err) { up?.undo(); m.style.color = 'var(--error)'; m.textContent = errText(err); }
    finally { busy(btn, false); }
  });
}

