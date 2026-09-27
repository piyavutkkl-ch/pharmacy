// เอกสารดาวน์โหลด (bucket ส่วนตัว "documents" ≤ 5 MB)
//   ผู้ดูแล: อัปโหลด / แก้ไขรายละเอียด / เปลี่ยนไฟล์ (เลขรุ่น +1) / ลบ   → initAdminDocs()
//   เจ้าหน้าที่: ดาวน์โหลดเอกสาร "ทุก รพ.สต." + ของหน่วยตัวเอง            → initStaffDocs()
// ที่เก็บไฟล์: all/<ชื่อสุ่ม>.<ext> (ทุกหน่วย) หรือ <unit>/<ชื่อสุ่ม>.<ext> — RLS ของ storage อ่านตามโฟลเดอร์นี้
import { sb } from '../supabase.js?v=4.3.1';
import { $, esc, thaiDate, toast, errText, busy } from '../util.js?v=4.3.1';
import { loadUnits, unitName } from '../data.js?v=4.3.1';
import { extOf } from '../upload.js?v=4.3.1';

const CATS = ['แบบฟอร์ม', 'คู่มือ / แนวทาง', 'หนังสือสั่งการ / ประกาศ', 'อื่น ๆ'];
const TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', csv: 'text/csv', txt: 'text/plain' };
const MAX = 5 * 1024 * 1024;
const COLS = 'id,title,category,for_unit,note,file_path,file_name,file_size,content_type,version,updated_at';

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

/** ดาวน์โหลดด้วยลิงก์ชั่วคราว 5 นาที (ตั้งชื่อไฟล์ตามต้นฉบับ) */
async function download(d) {
  const { data, error } = await sb.storage.from('documents').createSignedUrl(d.file_path, 300, { download: d.file_name });
  if (error) { toast('เปิดไฟล์ไม่สำเร็จ: ' + errText(error), 'err'); return; }
  const a = document.createElement('a');
  a.href = data.signedUrl; a.rel = 'noopener'; a.target = '_blank';
  document.body.append(a); a.click(); a.remove();
}

const docRow = (d, actions) => `<div class="li"><div class="l"><b>${esc(d.title)}</b>`
  + `<span class="small muted">${esc(d.category)} · ${d.for_unit == null ? 'ทุก รพ.สต.' : 'รพ.สต. ' + esc(unitName(d.for_unit))}`
  + ` · ${esc(d.file_name)} (${size(d.file_size || 0)})${d.version > 1 ? ' · ฉบับที่ ' + d.version : ''} · ปรับปรุง ${esc(thaiDate(d.updated_at))}</span>`
  + (d.note ? `<span class="small">${esc(d.note)}</span>` : '') + `</div><div class="actions">${actions}</div></div>`;

/* ======================= ผู้ดูแล ======================= */
let docs = [], editing = null, adminBound = false;

export async function initAdminDocs() {
  const units = await loadUnits();
  if (!adminBound) {
    adminBound = true;
    $('#adFor').innerHTML = '<option value="">ทุก รพ.สต.</option>' + units.map((u) => `<option value="${u.id}">เฉพาะ รพ.สต. ${esc(u.name)}</option>`).join('');
    $('#adForm').addEventListener('submit', saveDoc);
    $('#adCancel').addEventListener('click', resetDocForm);
    $('#adFile').addEventListener('change', () => {
      const f = $('#adFile').files[0];
      try { if (f) checkFile(f); msg(''); } catch (e) { msg(e.message); $('#adFile').value = ''; }
    });
    $('#adList').addEventListener('click', onAdminList);
  }
  await reloadDocs();
}

async function reloadDocs() {
  $('#adList').innerHTML = '<div class="skeleton"></div>';
  const { data, error } = await sb.from('documents').select(COLS).order('updated_at', { ascending: false });
  if (error) { $('#adList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  docs = data;
  $('#adCount').textContent = `(${docs.length})`;
  $('#adList').innerHTML = docs.length ? docs.map((d) => docRow(d,
    `<button type="button" class="btn btn-o btn-sm" data-dl="${d.id}">ดาวน์โหลด</button>`
    + `<button type="button" class="btn btn-o btn-sm" data-edit="${d.id}">แก้ไข</button>`
    + `<button type="button" class="btn btn-no btn-sm" data-del="${d.id}">ลบ</button>`)).join('')
    : '<p class="empty">ยังไม่มีเอกสาร · อัปโหลดได้จากแบบฟอร์มด้านบน</p>';
}

function msg(text, ok) { const m = $('#adMsg'); m.style.color = ok ? 'var(--success)' : 'var(--error)'; m.textContent = text; }

function resetDocForm() {
  editing = null;
  $('#adForm').reset();
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
  const forUnit = $('#adFor').value === '' ? null : +$('#adFor').value;
  if (!title) { msg('กรุณาใส่ชื่อเอกสาร'); $('#adTitle').focus(); return; }
  if (!editing && !f) { msg('กรุณาเลือกไฟล์'); return; }
  const row = { title, category: $('#adCat').value, for_unit: forUnit, note: $('#adNote').value.trim() || null };
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
  if (b.dataset.dl) return download(d);
  if (b.dataset.edit) return startEdit(d);
  if (!confirm(`ลบเอกสาร "${d.title}"? เจ้าหน้าที่จะดาวน์โหลดไม่ได้อีก`)) return;
  const { error } = await sb.from('documents').delete().eq('id', d.id);
  if (error) { toast(errText(error), 'err'); return; }
  await sb.storage.from('documents').remove([d.file_path]);
  if (editing?.id === d.id) resetDocForm();
  toast('ลบเอกสารแล้ว');
  reloadDocs();
}

/* ======================= เจ้าหน้าที่ ======================= */
let staffDocs = [], cat = 'all', staffBound = false;

export async function initStaffDocs() {
  await loadUnits();
  if (!staffBound) {
    staffBound = true;
    $('#sdCats').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { cat = b.dataset.c; renderStaff(); } });
    $('#sdList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-dl]'); if (!b) return;
      const d = staffDocs.find((x) => x.id === b.dataset.dl); if (d) download(d);
    });
  }
  $('#sdList').innerHTML = '<div class="skeleton"></div>';
  const { data, error } = await sb.from('documents').select(COLS).order('category').order('title');   // RLS กรองให้เห็นเฉพาะที่มีสิทธิ์
  if (error) { $('#sdList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  staffDocs = data;
  renderStaff();
}

function renderStaff() {
  const n = (c) => staffDocs.filter((d) => c === 'all' || d.category === c).length;
  $('#sdCats').innerHTML = ['all', ...CATS].filter((c) => c === 'all' || n(c))
    .map((c) => `<button type="button" data-c="${esc(c)}" aria-current="${cat === c}">${c === 'all' ? 'ทั้งหมด' : esc(c)} (${n(c)})</button>`).join('');
  const list = staffDocs.filter((d) => cat === 'all' || d.category === cat);
  $('#sdList').innerHTML = list.length
    ? list.map((d) => docRow(d, `<button type="button" class="btn btn-p btn-sm" data-dl="${d.id}">ดาวน์โหลด</button>`)).join('')
    : '<p class="empty">ยังไม่มีเอกสารให้ดาวน์โหลด</p>';
}
