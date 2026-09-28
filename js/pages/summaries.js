// สรุปผลงานเยี่ยมบ้าน (ขั้น 23) — ภาพ A4 one-page summary ราย รพ.สต. × ปีงบ
//   หน้าหลัก › ผลการดำเนินงาน: แถวภาพสรุปเลื่อนซ้าย-ขวา ตาม รพ.สต./ปีงบที่เลือก → renderSummaryRow(unit, year)
//   #/summary/<id>: หน้าอ่านแบบข่าว (ภาพเต็ม + รายละเอียด + PDF แนบ) → showSummary(id)
//   หน้าเยี่ยมบ้าน (เจ้าหน้าที่/ผู้ดูแล): เพิ่ม/แก้/ลบ แบบฟอร์มข่าว → mountSummaries(slot, unit)
import { sb, publicImageUrl } from '../supabase.js?v=4.4';
import { $, esc, thaiDate, toast, errText, busy, fiscalYearOf } from '../util.js?v=4.4';
import { auth } from '../auth.js?v=4.4';
import { loadUnits, loadYears, unitName } from '../data.js?v=4.4';
import { A4, imagePicker, uploadPublicImage, uploadNewsFile, removeFiles, extOf } from '../upload.js?v=4.4';
import { bindPosterNav, paras } from './delivery.js?v=4.4';
import { fileLink } from './news-form.js?v=4.4';

const CUR_FY = fiscalYearOf();
const COLS = 'id,unit_id,fiscal_year,title,body,image_path,file_path,file_name,created_at,updated_at';
const HINT_IMG = 'ภาพสรุป 1 หน้า (เช่น อินโฟกราฟิกจาก Canva) · ระบบย่อไม่เกินขนาด A4 อัตโนมัติ';
const HINT_PDF = 'ผู้ชมดาวน์โหลดไฟล์นี้ได้ (ไม่บังคับ)';
const label = (s) => `รพ.สต.${unitName(s.unit_id)} · ปีงบประมาณ ${s.fiscal_year}`;

/* ======================= หน้าหลัก ======================= */
let rowBound = false, rowSeq = 0;

/** แถวภาพสรุปใต้ผลการดำเนินงาน · unit = 'all' หรือเลข รพ.สต. */
export async function renderSummaryRow(unit, year) {
  const row = $('#trkSums'), seq = ++rowSeq;
  if (!rowBound) { rowBound = true; bindPosterNav(row); }
  row.innerHTML = '<div class="skeleton poster-skel"></div>';
  await loadUnits();
  let q = sb.from('visit_summaries').select('id,unit_id,fiscal_year,title,image_path').eq('fiscal_year', year);
  if (unit !== 'all') q = q.eq('unit_id', unit);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (seq !== rowSeq) return;   // ผู้ใช้เปลี่ยนแท็บระหว่างโหลด
  const list = error ? [] : data;
  row.innerHTML = list.length ? list.map((s) => `<a class="poster" href="#/summary/${s.id}">`
    + `<img src="${esc(publicImageUrl(s.image_path))}" alt="${esc(s.title)}" loading="lazy"><span>${esc(s.title)}<em class="small muted"> ${esc(label(s))}</em></span></a>`).join('')
    : `<p class="empty">ยังไม่มีสรุปผลงานเยี่ยมบ้าน${unit === 'all' ? '' : 'ของ รพ.สต.' + esc(unitName(unit))} ปีงบ ${year}</p>`;
  row.parentNode.querySelectorAll('[data-poster-nav]').forEach((b) => { b.hidden = list.length < 2; });
}

/* ======================= หน้าอ่าน #/summary/<id> ======================= */
export async function showSummary(id) {
  $('#smTitle').textContent = 'กำลังโหลด…';
  $('#smTag').textContent = ''; $('#smDate').textContent = ''; $('#smBody').innerHTML = ''; $('#smCover').innerHTML = ''; $('#smFile').hidden = true;
  await loadUnits();
  const { data: s, error } = await sb.from('visit_summaries').select(COLS).eq('id', +id || 0).maybeSingle();
  if (error || !s) { $('#smTitle').textContent = 'ไม่พบสรุปผลงานนี้'; $('#smBody').innerHTML = '<p class="muted">อาจถูกลบไปแล้ว</p>'; return; }
  document.title = s.title + ' · Primary Care Pharmacy Services';
  $('#smTag').textContent = label(s);
  $('#smTitle').textContent = s.title;
  $('#smDate').textContent = thaiDate(s.created_at);
  const url = publicImageUrl(s.image_path);
  $('#smCover').innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener" title="เปิดภาพขนาดเต็ม"><img src="${esc(url)}" alt="${esc(s.title)}"></a>`;
  $('#smBody').innerHTML = paras(s.body);
  $('#smFile').innerHTML = s.file_path ? fileLink(s) : ''; $('#smFile').hidden = !s.file_path;
}

/* ======================= เพิ่ม/แก้/ลบ (หน้าเยี่ยมบ้าน) ======================= */
let S = null;   // { unit, list, editing, img }

const FORM = `
  <div class="panel vs-panel">
    <h2 id="vsFormTitle">เพิ่มสรุปผลงานเยี่ยมบ้าน</h2>
    <p class="small muted">แสดงที่หน้าหลัก › ผลการดำเนินงาน ทันทีที่บันทึก · <b>ห้ามมีชื่อ ใบหน้า หรือข้อมูลที่ระบุตัวผู้ป่วยในภาพ</b></p>
    <form id="vsForm" class="form-grid" novalidate>
      <div class="field"><label for="vsTitle">หัวข้อ <span class="req">*</span></label><input id="vsTitle" class="input" maxlength="200" placeholder="เช่น สรุปผลการเยี่ยมบ้าน ไตรมาส 1"></div>
      <div class="field"><label for="vsYear">ปีงบประมาณ</label><select id="vsYear" class="input"></select></div>
      <div class="field full"><label for="vsImage">ภาพสรุป (A4) <span class="req">*</span></label><input id="vsImage" class="input" type="file" accept="image/*"><span class="small muted" id="vsImageNote">${HINT_IMG}</span><div class="img-preview" id="vsImagePreview" hidden><img alt="ตัวอย่างภาพสรุป"></div></div>
      <div class="field full"><label for="vsBody">รายละเอียด (ถ้ามี)</label><textarea id="vsBody" rows="4" maxlength="5000"></textarea></div>
      <div class="field full"><label for="vsFile">ไฟล์ PDF แนบ</label><input id="vsFile" class="input" type="file" accept="application/pdf,.pdf"><span class="small muted" id="vsFileNote">${HINT_PDF}</span></div>
      <div class="full row-btns" style="align-items:center"><button class="btn btn-p btn-sm" type="submit" id="vsSubmit">เผยแพร่สรุปผลงาน</button><button class="btn btn-o btn-sm" type="button" id="vsCancel" hidden>ยกเลิกการแก้ไข</button><span class="small" id="vsMsg" aria-live="polite"></span></div>
    </form>
    <h3 class="vs-list-h">สรุปผลงานของ รพ.สต.<span id="vsUnitName"></span></h3>
    <div class="list" id="vsList"></div>
  </div>`;

/** ฟอร์ม + รายการสรุปผลงานของ unit ใน slot (เจ้าหน้าที่ = หน่วยตัวเอง, ผู้ดูแล = หน่วยที่เลือก) */
export async function mountSummaries(slot, unit) {
  if (!S || !slot.contains($('#vsForm'))) {
    document.querySelectorAll('[data-sum-slot]').forEach((s) => { if (s !== slot) s.innerHTML = ''; });   // id ในหน้าต้องไม่ซ้ำ
    slot.innerHTML = FORM;
    S = { unit, list: [], editing: null, img: imagePicker($('#vsImage'), $('#vsImagePreview'), $('#vsImageNote'), { fit: A4 }) };
    const years = await loadYears();
    $('#vsYear').innerHTML = [...new Set([...years, CUR_FY])].sort((a, b) => b - a).map((y) => `<option value="${y}">ปีงบประมาณ ${y}</option>`).join('');
    $('#vsYear').value = String(CUR_FY);
    $('#vsForm').addEventListener('submit', save);
    $('#vsCancel').addEventListener('click', reset);
    $('#vsFile').addEventListener('change', checkPdf);
    $('#vsList').addEventListener('click', onList);
  }
  if (S.unit !== unit) reset();
  S.unit = unit;
  await loadUnits();
  $('#vsUnitName').textContent = unitName(unit);
  await load();
}

function checkPdf() {
  const f = $('#vsFile').files[0], note = $('#vsFileNote');
  note.classList.remove('err-text');
  if (!f) { note.textContent = HINT_PDF; return; }
  if (!(f.type === 'application/pdf' || extOf(f.name) === 'pdf')) { $('#vsFile').value = ''; note.textContent = 'กรุณาเลือกไฟล์ PDF'; note.classList.add('err-text'); return; }
  if (f.size > 5 * 1024 * 1024) { $('#vsFile').value = ''; note.textContent = `ไฟล์ใหญ่เกิน 5 MB (${(f.size / 1048576).toFixed(1)} MB)`; note.classList.add('err-text'); return; }
  note.textContent = `จะแนบ: ${f.name}`;
}

function reset() {
  if (!S) return;
  S.editing = null; $('#vsForm').reset(); S.img.reset(); $('#vsYear').value = String(CUR_FY);
  $('#vsImageNote').textContent = HINT_IMG; $('#vsFileNote').textContent = HINT_PDF; $('#vsMsg').textContent = '';
  $('#vsFormTitle').textContent = 'เพิ่มสรุปผลงานเยี่ยมบ้าน'; $('#vsSubmit').textContent = 'เผยแพร่สรุปผลงาน'; $('#vsCancel').hidden = true;
}

async function load() {
  $('#vsList').innerHTML = '<div class="skeleton"></div>';
  const { data, error } = await sb.from('visit_summaries').select(COLS).eq('unit_id', S.unit).order('fiscal_year', { ascending: false }).order('created_at', { ascending: false });
  if (error) { $('#vsList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  S.list = data;
  $('#vsList').innerHTML = data.length ? data.map((s) => `<div class="da-poster"><img src="${esc(publicImageUrl(s.image_path))}" alt="">`
    + `<div class="l"><b>${esc(s.title)}</b><span class="small muted">ปีงบประมาณ ${s.fiscal_year} · ${esc(thaiDate(s.created_at))}${s.file_path ? ' · มี PDF' : ''}</span></div>`
    + `<div class="row-btns"><a class="btn btn-o btn-sm" href="#/summary/${s.id}">ดู</a><button type="button" class="btn btn-o btn-sm" data-edit="${s.id}">แก้ไข</button><button type="button" class="btn btn-no btn-sm" data-del="${s.id}">ลบ</button></div></div>`).join('')
    : '<p class="empty">ยังไม่มีสรุปผลงาน · เพิ่มได้จากฟอร์มด้านบน</p>';
}

async function onList(e) {
  const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
  if (ed) {
    const s = S.list.find((x) => x.id === +ed.dataset.edit); if (!s) return;
    S.editing = s;
    $('#vsTitle').value = s.title; $('#vsYear').value = String(s.fiscal_year); $('#vsBody').value = s.body || ''; $('#vsFile').value = '';
    S.img.showExisting(publicImageUrl(s.image_path), 'ภาพเดิม · เลือกภาพใหม่เพื่อเปลี่ยน');
    $('#vsFileNote').textContent = s.file_path ? `ไฟล์เดิม: ${s.file_name || 'PDF'} · เลือกไฟล์ใหม่เพื่อแทนที่` : HINT_PDF;
    $('#vsFormTitle').textContent = 'แก้ไขสรุปผลงาน'; $('#vsSubmit').textContent = 'บันทึกการแก้ไข'; $('#vsCancel').hidden = false;
    $('#vsForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (del) {
    const s = S.list.find((x) => x.id === +del.dataset.del);
    if (!s || !confirm(`ลบสรุปผลงาน "${s.title}"? หน้าหลักจะไม่แสดงอีก`)) return;
    const { error } = await sb.from('visit_summaries').delete().eq('id', s.id);
    if (error) { toast(errText(error), 'err'); return; }
    removeFiles('public-images', [s.image_path]); if (s.file_path) removeFiles('news-files', [s.file_path]);
    if (S.editing?.id === s.id) reset();
    toast('ลบสรุปผลงานแล้ว'); load();
  }
}

async function save(e) {
  e.preventDefault();
  const msg = $('#vsMsg'), title = $('#vsTitle').value.trim(), old = S.editing;
  msg.style.color = 'var(--error)';
  if (!title) { msg.textContent = 'กรุณาใส่หัวข้อ'; return; }
  const blob = await S.img.ready();
  if (!blob && !old) { msg.textContent = 'กรุณาเลือกภาพสรุป'; return; }
  msg.textContent = '';
  const btn = $('#vsSubmit'); busy(btn, true, 'กำลังบันทึก…');
  const done = [];
  try {
    const row = { unit_id: S.unit, fiscal_year: +$('#vsYear').value, title, body: $('#vsBody').value.trim(), updated_at: new Date().toISOString() };
    if (blob) { row.image_path = await uploadPublicImage(blob, `summaries/${S.unit}`); done.push(['public-images', row.image_path]); }
    const f = $('#vsFile').files[0];
    if (f) { row.file_path = await uploadNewsFile(f, auth.profile.id); row.file_name = f.name.slice(0, 200); done.push(['news-files', row.file_path]); }
    const { error } = old ? await sb.from('visit_summaries').update(row).eq('id', old.id) : await sb.from('visit_summaries').insert(row);
    if (error) throw error;
    if (old && row.image_path) removeFiles('public-images', [old.image_path]);
    if (old?.file_path && row.file_path) removeFiles('news-files', [old.file_path]);
    busy(btn, false);
    toast(old ? 'บันทึกการแก้ไขแล้ว' : 'เผยแพร่สรุปผลงานแล้ว — แสดงที่หน้าหลัก › ผลการดำเนินงาน');
    reset(); load();
  } catch (err) {
    busy(btn, false);
    done.forEach(([b, p]) => removeFiles(b, [p]));
    msg.textContent = errText(err);
  }
}
