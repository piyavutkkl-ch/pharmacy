// เอกสารดาวน์โหลด (bucket ส่วนตัว "documents" ≤ 5 MB)
//   ผู้ดูแล: อัปโหลด / แก้ไขรายละเอียด / เปลี่ยนไฟล์ (เลขรุ่น +1) / ลบ   → initAdminDocs()
//   หน้า "ดาวน์โหลดเอกสาร" (#/documents · ปุ่มท้ายเว็บ) → initDocs() · RLS กรองให้: ทุกคน = เอกสารที่ผู้ดูแลเลือก "ประชาชนทั่วไป" (is_public · 70_public_docs.sql)
//     + เจ้าหน้าที่ = "ทุก รพ.สต." + ของหน่วยตัวเอง · ผู้ดูแล = ทั้งหมด
// ที่เก็บไฟล์: all/<ชื่อสุ่ม>.<ext> (ทุกหน่วย) หรือ <unit>/<ชื่อสุ่ม>.<ext> — RLS ของ storage อ่านตามโฟลเดอร์นี้
import { sb } from '../supabase.js?v=4.4';
import { $, esc, thaiDate, toast, errText, busy, fiscalYearOf } from '../util.js?v=4.4';
import { loadUnits, unitName, sortItems } from '../data.js?v=4.4';
import { extOf } from '../upload.js?v=4.4';
import { auth } from '../auth.js?v=4.4';

const CATS = ['แบบฟอร์ม', 'คู่มือ / แนวทาง', 'หนังสือสั่งการ / ประกาศ', 'อื่น ๆ'];
const TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', csv: 'text/csv', txt: 'text/plain' };
const MAX = 5 * 1024 * 1024;
const COLS = 'id,title,category,for_unit,note,file_path,file_name,file_size,content_type,version,updated_at,is_public,item_ids';

const size = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const folderOf = (forUnit) => (forUnit == null ? 'all' : String(forUnit));
const rand = () => Math.random().toString(36).slice(2, 8);

function checkFile(f) {
  const ext = extOf(f.name);
  if (!TYPES[ext]) throw new Error('รองรับเฉพาะ PDF, JPG, PNG, CSV, TXT — ไฟล์ Word/Excel ให้บันทึกเป็น PDF ก่อน');
  if (f.size > MAX) throw new Error(`ไฟล์ใหญ่ ${size(f.size)} เกิน 5 MB — ลองบีบอัด PDF ก่อน`);
  return ext;
}

async function uploadDoc(f, forUnit) {
  const ext = checkFile(f);
  const path = `${folderOf(forUnit)}/${Date.now()}-${rand()}.${ext}`;   // ชื่อไฟล์จริงเก็บในตาราง (ภาษาไทยได้)
  const { error } = await sb.storage.from('documents').upload(path, f, { contentType: TYPES[ext], upsert: false });
  if (error) throw error;
  return { file_path: path, file_name: f.name, file_size: f.size, content_type: TYPES[ext] };
}

/** จำนวนดาวน์โหลด (ตาราง document_stats) → d.downloads */
async function withStats(list) {
  const { data } = await sb.from('document_stats').select('doc_id,downloads');
  const m = new Map((data || []).map((r) => [r.doc_id, r.downloads]));
  list.forEach((d) => { d.downloads = m.get(d.id) || 0; });
  return list;
}

/** ค้นหา / กรองประเภท / เรียงลำดับ ตามแถบเครื่องมือ (pre = 'ad' ผู้ดูแล | 'sd' เจ้าหน้าที่) */
function applyTools(list, pre, catOverride) {
  const q = $(`#${pre}Q`).value.trim().toLowerCase(), c = catOverride ?? $(`#${pre}FCat`)?.value ?? 'all';
  const [key, dir] = $(`#${pre}Sort`).value.split('_'), k = dir === 'asc' ? 1 : -1;
  const val = { updated: (d) => d.updated_at, title: (d) => d.title, dl: (d) => d.downloads || 0 }[key];
  return list.filter((d) => (c === 'all' || d.category === c) && (!q || `${d.title} ${d.file_name} ${d.note || ''}`.toLowerCase().includes(q)))
    .sort((a, b) => (key === 'title' ? a.title.localeCompare(b.title, 'th') : val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * k);
}

/** ดาวน์โหลดด้วยลิงก์ชั่วคราว 5 นาที (ตั้งชื่อไฟล์ตามต้นฉบับ) + นับจำนวนดาวน์โหลด · ใช้ในหน้ามาตรฐาน (criteria.js) ด้วย */
export async function download(d, after) {
  const { data, error } = await sb.storage.from('documents').createSignedUrl(d.file_path, 300, { download: d.file_name });
  if (error) { toast('เปิดไฟล์ไม่สำเร็จ: ' + errText(error), 'err'); return; }
  sb.rpc('bump_doc_download', { p_doc: d.id }).then(({ data: n }) => { if (n) { d.downloads = n; after?.(); } }, () => {});
  const a = document.createElement('a');
  a.href = data.signedUrl; a.rel = 'noopener'; a.target = '_blank';
  document.body.append(a); a.click(); a.remove();
}

const docRow = (d, actions) => `<div class="li"><div class="l"><b>${esc(d.title)}</b>`
  + `<span class="small muted">${esc(d.category)} · ${d.is_public ? 'ประชาชนทั่วไป' : d.for_unit == null ? 'เจ้าหน้าที่ทุก รพ.สต.' : 'เจ้าหน้าที่ รพ.สต. ' + esc(unitName(d.for_unit))}`
  + ` · ${esc(d.file_name)} (${size(d.file_size || 0)})${d.version > 1 ? ' · ฉบับที่ ' + d.version : ''} · ปรับปรุง ${esc(thaiDate(d.updated_at))} · ดาวน์โหลด ${(d.downloads || 0).toLocaleString('th-TH')} ครั้ง</span>`
  + (critLabel(d.item_ids) ? `<span class="small">ตรวจประเมินมาตรฐานข้อ ${esc(critLabel(d.item_ids))}</span>` : '')
  + (d.note ? `<span class="small">${esc(d.note)}</span>` : '') + `</div><div class="actions">${actions}</div></div>`;

/* ======================= ผู้ดูแล ======================= */
let docs = [], editing = null, adminBound = false;

export async function initAdminDocs() {
  const units = await loadUnits();
  if (!adminBound) {
    adminBound = true;
    $('#adFor').innerHTML = '<option value="">ทุก รพ.สต.</option>' + units.map((u) => `<option value="${u.id}">เฉพาะ รพ.สต. ${esc(u.name)}</option>`).join('');
    $('#adForm').addEventListener('submit', saveDoc);
    $('#adWho').addEventListener('change', syncWho);
    $('#adCritQ').addEventListener('input', renderCritPick);
    $('#adCrit').addEventListener('change', (e) => {
      const id = +e.target.value; if (!id) return;
      if (e.target.checked) picked.add(id); else picked.delete(id);
      critCount();
    });
    $('#adCancel').addEventListener('click', resetDocForm);
    $('#adFile').addEventListener('change', () => {
      const f = $('#adFile').files[0];
      try { if (f) checkFile(f); msg(''); } catch (e) { msg(e.message); $('#adFile').value = ''; }
    });
    $('#adList').addEventListener('click', onAdminList);
    ['#adQ', '#adFCat', '#adSort'].forEach((s) => $(s).addEventListener(s === '#adQ' ? 'input' : 'change', renderAdminDocs));
  }
  await Promise.all([reloadDocs(), loadCrit()]);
}

/* ข้อมาตรฐาน (ปีงบปัจจุบัน + ข้อของปีก่อนที่ผูกไว้เดิม) → documents.item_ids */
let critItems = [];
const picked = new Set();
const critLabel = (ids) => critItems.filter((it) => ids?.includes(it.id)).map((it) => it.item_no).join(', ');
async function loadCrit() {
  const { data, error } = await sb.from('criteria_items').select('id,topic_no,topic_title,sub_id,item_no,body,sort').eq('fiscal_year', fiscalYearOf()).order('sort');
  if (error) { $('#adCrit').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  critItems = sortItems(data || []);
  renderCritPick();
  renderAdminDocs();
}
function renderCritPick() {
  const q = $('#adCritQ').value.trim().toLowerCase();
  const list = critItems.filter((it) => !q || `${it.item_no} ${it.body} ${it.topic_title}`.toLowerCase().includes(q));
  let last = null;
  $('#adCrit').innerHTML = list.map((it) => {
    const head = it.topic_no !== last ? `<p class="crit-pick-h">${esc(it.topic_title)}</p>` : ''; last = it.topic_no;
    return head + `<label class="crit-opt"><input type="checkbox" value="${it.id}"${picked.has(it.id) ? ' checked' : ''}><span><b>${esc(it.item_no)}</b> ${esc(it.body)}</span></label>`;
  }).join('') || `<p class="empty">${critItems.length ? 'ไม่พบข้อที่ค้นหา' : `ยังไม่มีเกณฑ์มาตรฐานของปีงบ ${fiscalYearOf()}`}</p>`;
  critCount();
}
function critCount() {
  const l = critLabel([...picked]);
  $('#adCritN').textContent = l ? `เลือกแล้ว: ข้อ ${l}` : 'ไม่ระบุ · กดเพื่อเลือก';
}

async function reloadDocs() {
  $('#adList').innerHTML = '<div class="skeleton"></div>';
  const { data, error } = await sb.from('documents').select(COLS).order('updated_at', { ascending: false });
  if (error) { $('#adList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  docs = await withStats(data);
  renderAdminDocs();
}

function renderAdminDocs() {
  const list = applyTools(docs, 'ad');
  $('#adCount').textContent = list.length === docs.length ? `(${docs.length})` : `(${list.length} จาก ${docs.length})`;
  $('#adList').innerHTML = !docs.length ? '<p class="empty">ยังไม่มีเอกสาร · อัปโหลดได้จากแบบฟอร์มด้านบน</p>' : !list.length ? '<p class="empty">ไม่พบเอกสารที่ค้นหา</p>' : list.map((d) => docRow(d,
    `<button type="button" class="btn btn-o btn-sm" data-dl="${d.id}">ดาวน์โหลด</button>`
    + `<button type="button" class="btn btn-o btn-sm" data-edit="${d.id}">แก้ไข</button>`
    + `<button type="button" class="btn btn-no btn-sm" data-del="${d.id}">ลบ</button>`)).join('');
}

/** ประชาชนทั่วไป = เอกสาร "ทุก รพ.สต." เท่านั้น (ฐานข้อมูลไม่แสดงเอกสารเฉพาะหน่วยให้ประชาชน) */
function syncWho() {
  const pub = $('#adWho').value === 'public';
  if (pub) $('#adFor').value = '';
  $('#adFor').disabled = pub;
  $('#adForNote').textContent = pub ? 'ทุกคนดาวน์โหลดได้จากปุ่ม "ดาวน์โหลดเอกสาร" ท้ายเว็บ' : '';
}

function msg(text, ok) { const m = $('#adMsg'); m.style.color = ok ? 'var(--success)' : 'var(--error)'; m.textContent = text; }

function resetDocForm() {
  editing = null;
  $('#adForm').reset();
  syncWho();
  picked.clear(); $('#adCritFold').open = false; renderCritPick();
  $('#adFormTitle').textContent = 'อัปโหลดเอกสาร';
  $('#adFileLabel').innerHTML = 'ไฟล์ <span class="req">*</span>';
  $('#adFileNote').textContent = '';
  $('#adSubmit').textContent = 'อัปโหลด';
  $('#adCancel').hidden = true;
  msg('');
}

function startEdit(d) {
  editing = d;
  $('#adTitle').value = d.title; $('#adCat').value = CATS.includes(d.category) ? d.category : 'อื่น ๆ';
  $('#adFor').value = d.for_unit == null ? '' : String(d.for_unit); $('#adNote').value = d.note || ''; $('#adFile').value = '';
  $('#adWho').value = d.is_public ? 'public' : 'staff'; syncWho();
  picked.clear(); (d.item_ids || []).forEach((id) => picked.add(id)); $('#adCritQ').value = ''; renderCritPick(); $('#adCritFold').open = picked.size > 0;
  $('#adFormTitle').textContent = 'แก้ไขเอกสาร';
  $('#adFileLabel').textContent = 'เปลี่ยนไฟล์ (ถ้ามีฉบับใหม่)';
  $('#adFileNote').textContent = `ไฟล์ปัจจุบัน: ${d.file_name} · ฉบับที่ ${d.version} — เลือกไฟล์ใหม่จะแทนที่และนับเป็นฉบับที่ ${d.version + 1}`;
  $('#adSubmit').textContent = 'บันทึกการแก้ไข';
  $('#adCancel').hidden = false;
  msg('');
  $('#adForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function saveDoc(e) {
  e.preventDefault();
  const title = $('#adTitle').value.trim(), f = $('#adFile').files[0];
  const pub = $('#adWho').value === 'public';
  const forUnit = pub || $('#adFor').value === '' ? null : +$('#adFor').value;
  if (!title) { msg('กรุณาใส่ชื่อเอกสาร'); $('#adTitle').focus(); return; }
  if (!editing && !f) { msg('กรุณาเลือกไฟล์'); return; }
  const row = { title, category: $('#adCat').value, for_unit: forUnit, note: $('#adNote').value.trim() || null, is_public: pub, item_ids: [...picked] };
  const btn = $('#adSubmit'); busy(btn, true, 'กำลังบันทึก…'); msg('');
  let uploaded = null;
  try {
    if (f) { uploaded = await uploadDoc(f, forUnit); Object.assign(row, uploaded); }
    if (!editing) {
      const { error } = await sb.from('documents').insert(row);
      if (error) throw error;
    } else {
      const { id, version, file_path: oldPath, for_unit: oldUnit } = editing;   // เก็บค่าเดิมไว้ก่อนบันทึก
      if (f) row.version = version + 1;
      else if (folderOf(oldUnit) !== folderOf(forUnit)) {        // ย้ายโฟลเดอร์ตามสิทธิ์การมองเห็นใหม่
        const to = `${folderOf(forUnit)}/${oldPath.split('/').pop()}`;
        const { error } = await sb.storage.from('documents').move(oldPath, to);
        if (error) throw error;
        row.file_path = to;
      }
      const { error } = await sb.from('documents').update(row).eq('id', id);
      if (error) {
        if (row.file_path && !f) await sb.storage.from('documents').move(row.file_path, oldPath);   // ย้ายกลับ
        throw error;
      }
      if (f) await sb.storage.from('documents').remove([oldPath]);
    }
    toast(editing ? 'บันทึกการแก้ไขแล้ว' : 'อัปโหลดเอกสารแล้ว');
    resetDocForm();
    await reloadDocs();
  } catch (err) {
    if (uploaded) await sb.storage.from('documents').remove([uploaded.file_path]);   // ไม่ทิ้งไฟล์ค้าง
    msg(err.message && !err.code ? err.message : errText(err));
  } finally { busy(btn, false); }
}

async function onAdminList(e) {
  const b = e.target.closest('button'); if (!b) return;
  const d = docs.find((x) => x.id === (b.dataset.dl || b.dataset.edit || b.dataset.del)); if (!d) return;
  if (b.dataset.dl) return download(d, renderAdminDocs);
  if (b.dataset.edit) return startEdit(d);
  if (!confirm(`ลบเอกสาร "${d.title}"? ผู้ที่เคยดาวน์โหลดได้จะดาวน์โหลดไม่ได้อีก`)) return;
  const { error } = await sb.from('documents').delete().eq('id', d.id);
  if (error) { toast(errText(error), 'err'); return; }
  await sb.storage.from('documents').remove([d.file_path]);
  if (editing?.id === d.id) resetDocForm();
  toast('ลบเอกสารแล้ว');
  reloadDocs();
}

/* ======================= หน้าดาวน์โหลดเอกสาร (ทุกคน) ======================= */
let staffDocs = [], cat = 'all', staffBound = false;

export async function initDocs() {
  await loadUnits();
  if (!staffBound) {
    staffBound = true;
    $('#sdCats').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { cat = b.dataset.c; renderStaff(); } });
    $('#sdList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-dl]'); if (!b) return;
      const d = staffDocs.find((x) => x.id === b.dataset.dl); if (d) download(d, renderStaff);
    });
    ['#sdQ', '#sdSort'].forEach((s) => $(s).addEventListener(s === '#sdQ' ? 'input' : 'change', renderStaff));
  }
  const role = auth.profile?.role;
  $('#sdWho').textContent = role === 'admin' ? 'ผู้ดูแลเห็นเอกสารทั้งหมด · อัปโหลด/แก้ไขที่เมนูผู้ดูแล › เอกสาร'
    : role === 'staff' ? 'เอกสารสำหรับประชาชนทั่วไป และเอกสารสำหรับเจ้าหน้าที่ รพ.สต. ของคุณ'
    : 'เอกสารที่ผู้ดูแลเผยแพร่ให้ประชาชนทั่วไป · เจ้าหน้าที่ รพ.สต. ล็อกอินเพื่อดูเอกสารสำหรับเจ้าหน้าที่';
  $('#sdList').innerHTML = '<div class="skeleton"></div>';
  const { data, error } = await sb.from('documents').select(COLS).order('category').order('title');   // RLS กรองให้เห็นเฉพาะที่มีสิทธิ์
  if (error) { $('#sdList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  staffDocs = await withStats(data);
  renderStaff();
}

function renderStaff() {
  const n = (c) => staffDocs.filter((d) => c === 'all' || d.category === c).length;
  $('#sdCats').innerHTML = ['all', ...CATS].filter((c) => c === 'all' || n(c))
    .map((c) => `<button type="button" data-c="${esc(c)}" aria-current="${cat === c}">${c === 'all' ? 'ทั้งหมด' : esc(c)} (${n(c)})</button>`).join('');
  const list = applyTools(staffDocs, 'sd', cat);
  $('#sdList').innerHTML = list.length
    ? list.map((d) => docRow(d, `<button type="button" class="btn btn-p btn-sm" data-dl="${d.id}">ดาวน์โหลด</button>`)).join('')
    : `<p class="empty">${staffDocs.length ? 'ไม่พบเอกสารที่ค้นหา' : 'ยังไม่มีเอกสารให้ดาวน์โหลด'}</p>`;
}
