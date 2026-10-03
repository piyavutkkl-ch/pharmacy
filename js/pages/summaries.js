// สรุปผลงานเยี่ยมบ้าน (ขั้น 23) — ภาพ A4 one-page summary ราย รพ.สต. × ปีงบ
//   หน้าหลัก › ผลการดำเนินงาน: กรอบโปสเตอร์ 10:7 สลับภาพสรุป ตาม รพ.สต./ปีงบที่เลือก → loadSummaryList + renderSummaryPoster
//   #/summary/<id>: หน้าอ่านแบบข่าว (ภาพเต็ม + รายละเอียด + PDF แนบ) → showSummary(id)
//   หน้าเยี่ยมบ้าน (เจ้าหน้าที่/ผู้ดูแล): เพิ่ม/แก้/ลบ → mountSummaries(slot, unit) · เลือก รพ.สต. ได้ (ค่าเริ่มต้น = หน่วยตัวเอง)
//     หลายภาพ (ภาพแรก = image_path · ที่เหลือ = gallery ≤ 6 · กด × ลบ) · ไม่มีช่อง PDF แล้ว (ไฟล์เดิมยังแสดง)
import { sb, publicImageUrl } from '../supabase.js?v=4.4';
import { $, esc, thaiDate, toast, errText, busy, fiscalYearOf } from '../util.js?v=4.4';
import { auth } from '../auth.js?v=4.4';
import { loadUnits, loadYears, unitName } from '../data.js?v=4.4';
import { uploadPublicImage, removeFiles } from '../upload.js?v=4.4';
import { paras } from './delivery.js?v=4.4';
import { fileLink, imageList } from './news-form.js?v=4.4';
import { smartCover } from '../lightbox.js?v=4.4';

const CUR_FY = fiscalYearOf();
const COLS = 'id,unit_id,fiscal_year,title,body,image_path,gallery,file_path,file_name,author_id,created_at,updated_at,summary_date,participant_ids,participant_names';
const MAX_IMGS = 7;   // ภาพแรก + gallery ไม่เกิน 6 (visit_summaries_gallery_check)
const imgsOf = (s) => [s.image_path, ...(s.gallery || [])].filter(Boolean);
const HINT_IMG = `ภาพสรุป 1 หน้า (เช่น อินโฟกราฟิกจาก Canva) · เลือกได้หลายภาพ ไม่เกิน ${MAX_IMGS} ภาพ · ย่อไม่เกิน A4 อัตโนมัติ · ภาพแรกเป็นภาพหลัก`;
const label = (s) => `รพ.สต.${unitName(s.unit_id)} · ปีงบประมาณ ${s.fiscal_year}`;
const dateOf = (s) => thaiDate(s.summary_date || s.created_at);   // วันที่ของผลงาน (ก่อนมีช่องนี้ = วันที่บันทึก)
const peopleOf = (s) => (s.participant_names || []).join(', ');
const todayIso = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

/* ======================= หน้าหลัก ======================= */

/** รายการสรุปผลงานเยี่ยมบ้านตาม รพ.สต./ปีงบ (ใช้กับกรอบโปสเตอร์ 10:7) · unit = 'all' หรือเลข รพ.สต. · null = ผู้ใช้เปลี่ยนแท็บระหว่างโหลด */
let rowSeq = 0;
export async function loadSummaryList(unit, year) {
  const seq = ++rowSeq;
  await loadUnits();
  let q = sb.from('visit_summaries').select('id,unit_id,fiscal_year,title,image_path,gallery,summary_date,created_at').eq('fiscal_year', year);
  if (unit !== 'all') q = q.eq('unit_id', unit);
  const { data, error } = await q.order('summary_date', { ascending: false }).order('created_at', { ascending: false });
  if (seq !== rowSeq) return null;
  return error ? [] : data;
}

/** กรอบโปสเตอร์ 10:7 ในผลการดำเนินงาน: แสดงภาพสรุปผลงานเยี่ยมบ้าน (หลายภาพ = สลับทุก 5 วินาที · กดเพื่อเปิดอ่าน) · ไม่มีภาพ = ภาพประกอบเดิม */
let posterTimer = null;
export function renderSummaryPoster(box, list, fallback) {
  clearInterval(posterTimer); posterTimer = null;
  const slides = (list || []).flatMap((s) => imgsOf(s).map((image_path) => ({ ...s, image_path })));   // ทุกภาพของทุกสรุป
  if (!slides.length) { box.classList.remove('sum-poster'); box.innerHTML = fallback; return; }
  list = slides;
  box.classList.add('sum-poster');
  box.innerHTML = list.map((s, i) => `<a class="sp-slide${i ? '' : ' on'}" href="#/summary/${s.id}" aria-label="${esc(s.title)} — ${esc(label(s))} · ${esc(dateOf(s))}"${i ? ' tabindex="-1"' : ''}>`
    + `<span class="sp-bg" style="background-image:url('${esc(publicImageUrl(s.image_path))}')"></span><img src="${esc(publicImageUrl(s.image_path))}" alt="${esc(s.title)}" loading="lazy">`
    + `<span class="sp-date num">${esc(dateOf(s))}</span></a>`).join('')
    + (list.length > 1 ? `<span class="sp-count num" aria-live="polite">1/${list.length}</span>` : '');
  if (list.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let i = 0;
  posterTimer = setInterval(() => {
    if (!box.isConnected || box.closest('[hidden]')) { clearInterval(posterTimer); return; }
    const slides = box.querySelectorAll('.sp-slide');
    slides[i].classList.remove('on'); slides[i].tabIndex = -1;
    i = (i + 1) % slides.length;
    slides[i].classList.add('on'); slides[i].removeAttribute('tabindex');
    box.querySelector('.sp-count').textContent = `${i + 1}/${slides.length}`;
  }, 5000);
}

/* ======================= หน้าอ่าน #/summary/<id> ======================= */
export async function showSummary(id) {
  $('#smTitle').textContent = 'กำลังโหลด…';
  $('#smTag').textContent = ''; $('#smDate').textContent = ''; $('#smPeople').hidden = true; $('#smBody').innerHTML = ''; $('#smCover').innerHTML = ''; $('#smCover').className = 'cover'; $('#smFile').hidden = true; $('#smGallery').innerHTML = ''; $('#smGallery').hidden = true;
  await loadUnits();
  const { data: s, error } = await sb.from('visit_summaries').select(COLS).eq('id', +id || 0).maybeSingle();
  if (error || !s) { $('#smTitle').textContent = 'ไม่พบสรุปผลงานนี้'; $('#smBody').innerHTML = '<p class="muted">อาจถูกลบไปแล้ว</p>'; return; }
  document.title = s.title + ' · Primary Care Pharmacy Services';
  $('#smTag').textContent = label(s);
  $('#smTitle').textContent = s.title;
  $('#smDate').textContent = 'วันที่ ' + dateOf(s);
  if (peopleOf(s)) { $('#smPeople').textContent = 'เจ้าหน้าที่ที่ร่วมลง: ' + peopleOf(s); $('#smPeople').hidden = false; }
  const url = publicImageUrl(s.image_path);
  smartCover($('#smCover'), url, s.title);
  const gal = (s.gallery || []).filter(Boolean);   // ภาพเพิ่ม (ใกล้ A4 = ไม่ครอบตัด · กดขยายได้)
  if (gal.length) {
    $('#smGallery').innerHTML = gal.map(() => '<div class="cover"></div>').join(''); $('#smGallery').hidden = false;
    $('#smGallery').querySelectorAll('.cover').forEach((box, i) => smartCover(box, publicImageUrl(gal[i]), `${s.title} — ภาพที่ ${i + 2}`));
  }
  $('#smBody').innerHTML = paras(s.body);
  $('#smFile').innerHTML = s.file_path ? fileLink(s) : ''; $('#smFile').hidden = !s.file_path;
}

/* ======================= เพิ่ม/แก้/ลบ (หน้าเยี่ยมบ้าน) ======================= */
let S = null;   // { unit, list, editing, img }

const FORM = `
  <div class="panel vs-panel">
    <h2 id="vsFormTitle">เพิ่มสรุปผลงานเยี่ยมบ้าน one page summary</h2>
    <p class="small muted">แสดงที่หน้าหลัก › ผลการดำเนินงาน ทันทีที่บันทึก · <b>ห้ามมีชื่อ ใบหน้า หรือข้อมูลที่ระบุตัวผู้ป่วยในภาพ</b></p>
    <form id="vsForm" class="form-grid" novalidate>
      <div class="field"><label for="vsTitle">หัวข้อ <span class="req">*</span></label><input id="vsTitle" class="input" maxlength="200" placeholder="เช่น สรุปผลการเยี่ยมบ้าน ไตรมาส 1"></div>
      <div class="field"><label for="vsUnit">รพ.สต. <span class="req">*</span></label><select id="vsUnit" class="input"></select></div>
      <div class="field"><label for="vsDate">วันที่ <span class="req">*</span></label><input id="vsDate" class="input" type="date"><span class="small muted" id="vsDateTh"></span></div>
      <div class="field"><label for="vsYear">ปีงบประมาณ</label><select id="vsYear" class="input"></select></div>
      <div class="field full"><label for="vsPeopleQ">เจ้าหน้าที่ที่ร่วมลง (เลือกได้หลายคน)</label><input id="vsPeopleQ" class="input" type="search" maxlength="60" placeholder="ค้นหาชื่อ"><div class="crit-pick vs-people" id="vsPeople" role="group" aria-label="เจ้าหน้าที่ที่ร่วมลง"></div><span class="small vs-people-n" id="vsPeopleN" aria-live="polite"></span></div>
      <div class="field full"><label for="vsImage">ภาพสรุป (A4) <span class="req">*</span></label><input id="vsImage" class="input" type="file" accept="image/*" multiple><span class="small muted" id="vsImageNote">${HINT_IMG}</span><div class="img-list" id="vsImagePreview" hidden></div></div>
      <div class="field full"><label for="vsBody">รายละเอียด (ถ้ามี)</label><textarea id="vsBody" rows="4" maxlength="5000"></textarea></div>
      <div class="full row-btns" style="align-items:center"><button class="btn btn-p btn-sm" type="submit" id="vsSubmit">เผยแพร่สรุปผลงาน</button><button class="btn btn-o btn-sm" type="button" id="vsCancel" hidden>ยกเลิกการแก้ไข</button><span class="small" id="vsMsg" aria-live="polite"></span></div>
    </form>
    <h3 class="vs-list-h" id="vsListTitle">สรุปผลงาน</h3>
    <div class="list" id="vsList"></div>
  </div>`;

/** ฟอร์ม + รายการสรุปผลงานใน slot · unit = หน่วยที่ดูอยู่ (เจ้าหน้าที่ = หน่วยตัวเอง · ผู้ดูแล = หน่วยที่เลือก หรือ 'all' = ทุกหน่วย) */
export async function mountSummaries(slot, unit) {
  const units = await loadUnits();
  if (!S || !slot.contains($('#vsForm'))) {
    document.querySelectorAll('[data-sum-slot]').forEach((s) => { if (s !== slot) s.innerHTML = ''; });   // id ในหน้าต้องไม่ซ้ำ
    slot.innerHTML = FORM;
    S = { unit, list: [], editing: null, people: null, picked: new Set(), img: imageList($('#vsImage'), $('#vsImagePreview'), $('#vsImageNote'), { max: MAX_IMGS, hint: HINT_IMG }) };
    const years = await loadYears();
    $('#vsYear').innerHTML = [...new Set([...years, CUR_FY])].sort((a, b) => b - a).map((y) => `<option value="${y}">ปีงบประมาณ ${y}</option>`).join('');
    $('#vsUnit').innerHTML = units.map((u) => `<option value="${u.id}">รพ.สต.${esc(u.name)}</option>`).join('');
    $('#vsForm').addEventListener('submit', save);
    $('#vsCancel').addEventListener('click', reset);
    $('#vsList').addEventListener('click', onList);
    $('#vsDate').addEventListener('change', onDate);
    $('#vsPeopleQ').addEventListener('input', renderPeople);
    $('#vsPeople').addEventListener('change', (e) => {
      const id = e.target.value; if (!id) return;
      if (e.target.checked) S.picked.add(id); else S.picked.delete(id);
      peopleCount();
    });
    const { data: ppl, error: pErr } = await sb.rpc('staff_directory');
    S.people = pErr ? [] : ppl;
  }
  S.unit = unit;
  reset();
  $('#vsListTitle').textContent = unit === 'all' ? 'สรุปผลงานทุก รพ.สต.' : `สรุปผลงานของ รพ.สต.${unitName(unit)}`;
  await load();
}
/** หน่วยตั้งต้นของฟอร์ม: หน่วยที่ดูอยู่ → หน่วยของบัญชีตัวเอง → หน่วยแรก */
const defaultUnit = () => (S.unit !== 'all' && S.unit != null ? S.unit : auth.profile?.unit_id ?? +$('#vsUnit option')?.value);

function reset() {
  if (!S) return;
  S.editing = null; $('#vsForm').reset(); S.img.set([]); $('#vsYear').value = String(CUR_FY); $('#vsUnit').value = String(defaultUnit());
  $('#vsDate').value = todayIso(); onDate();
  S.picked = new Set(auth.profile ? [auth.profile.id] : []); renderPeople();   // ค่าเริ่มต้น = ตัวเองร่วมลง
  $('#vsMsg').textContent = '';
  $('#vsFormTitle').textContent = 'เพิ่มสรุปผลงานเยี่ยมบ้าน one page summary'; $('#vsSubmit').textContent = 'เผยแพร่สรุปผลงาน'; $('#vsCancel').hidden = true;
}

/** วันที่ → แสดงแบบไทย + ปีงบประมาณตามวันที่ (เริ่ม 1 ต.ค.) */
function onDate() {
  const v = $('#vsDate').value;
  $('#vsDateTh').textContent = v ? thaiDate(v) : '';
  if (!v) return;
  const fy = fiscalYearOf(new Date(v)), sel = $('#vsYear');
  if (![...sel.options].some((o) => +o.value === fy)) sel.insertAdjacentHTML('afterbegin', `<option value="${fy}">ปีงบประมาณ ${fy}</option>`);
  sel.value = String(fy);
}
/** รายชื่อผู้ดูแล + เจ้าหน้าที่ (staff_directory) แยกกลุ่มตามหน่วย · ค้นหาชื่อได้ · จำที่เลือกไว้ */
function renderPeople() {
  if (!S?.people) return;
  const q = $('#vsPeopleQ').value.trim().toLowerCase();
  const list = S.people.filter((p) => !q || p.full_name.toLowerCase().includes(q));
  const group = (p) => (p.role === 'admin' ? 'ผู้ดูแล (โรงพยาบาล)' : `รพ.สต.${unitName(p.unit_id)}`);
  let last = null;
  $('#vsPeople').innerHTML = list.map((p) => {
    const g = group(p), head = g !== last ? `<p class="crit-pick-h">${esc(g)}</p>` : '';
    last = g;
    return head + `<label class="crit-opt"><input type="checkbox" value="${esc(p.id)}"${S.picked.has(p.id) ? ' checked' : ''}><span>${esc(p.full_name)}</span></label>`;
  }).join('') || `<p class="empty">${S.people.length ? 'ไม่พบชื่อที่ค้นหา' : 'ยังไม่มีรายชื่อเจ้าหน้าที่'}</p>`;
  peopleCount();
}
function peopleCount() {
  const names = (S.people || []).filter((p) => S.picked.has(p.id)).map((p) => p.full_name);
  $('#vsPeopleN').textContent = names.length ? `ร่วมลง ${names.length} คน: ${names.join(', ')}` : '';
}

async function load() {
  $('#vsList').innerHTML = '<div class="skeleton"></div>';
  const order = (q) => q.order('fiscal_year', { ascending: false }).order('summary_date', { ascending: false }).order('created_at', { ascending: false });
  const base = sb.from('visit_summaries').select(COLS);
  const [a, mine] = await Promise.all([   // หน่วยที่ดูอยู่ + ที่ตัวเองเพิ่มให้หน่วยอื่น
    order(S.unit === 'all' ? base : base.eq('unit_id', S.unit)),
    S.unit === 'all' || !auth.profile ? Promise.resolve({ data: [] }) : order(sb.from('visit_summaries').select(COLS).eq('author_id', auth.profile.id)),
  ]);
  if (a.error) { $('#vsList').innerHTML = `<p class="empty">${esc(errText(a.error))}</p>`; return; }
  const seen = new Set(), data = [...a.data, ...(mine.data || [])].filter((x) => !seen.has(x.id) && seen.add(x.id));
  S.list = data;
  $('#vsList').innerHTML = data.length ? data.map((s) => `<div class="da-poster"><img src="${esc(publicImageUrl(s.image_path))}" alt="">`
    + `<div class="l"><b>${esc(s.title)}</b><span class="small muted">วันที่ ${esc(dateOf(s))} · รพ.สต.${esc(unitName(s.unit_id))} · ปีงบประมาณ ${s.fiscal_year} · ${imgsOf(s).length} ภาพ${s.file_path ? ' · มี PDF' : ''}</span>`
    + (peopleOf(s) ? `<span class="small muted">ผู้ร่วมลง: ${esc(peopleOf(s))}</span>` : '') + '</div>'
    + `<div class="row-btns"><a class="btn btn-o btn-sm" href="#/summary/${s.id}">ดู</a><button type="button" class="btn btn-o btn-sm" data-edit="${s.id}">แก้ไข</button><button type="button" class="btn btn-no btn-sm" data-del="${s.id}">ลบ</button></div></div>`).join('')
    : '<p class="empty">ยังไม่มีสรุปผลงาน · เพิ่มได้จากฟอร์มด้านบน</p>';
}

async function onList(e) {
  const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
  if (ed) {
    const s = S.list.find((x) => x.id === +ed.dataset.edit); if (!s) return;
    S.editing = s;
    $('#vsTitle').value = s.title; $('#vsUnit').value = String(s.unit_id); $('#vsBody').value = s.body || '';
    $('#vsDate').value = s.summary_date || String(s.created_at).slice(0, 10); onDate(); $('#vsYear').value = String(s.fiscal_year);
    S.picked = new Set(s.participant_ids || []); $('#vsPeopleQ').value = ''; renderPeople();
    S.img.set(imgsOf(s));
    $('#vsFormTitle').textContent = 'แก้ไขสรุปผลงาน'; $('#vsSubmit').textContent = 'บันทึกการแก้ไข'; $('#vsCancel').hidden = false;
    $('#vsForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (del) {
    const s = S.list.find((x) => x.id === +del.dataset.del);
    if (!s || !confirm(`ลบสรุปผลงาน "${s.title}"? หน้าหลักจะไม่แสดงอีก`)) return;
    const { error } = await sb.from('visit_summaries').delete().eq('id', s.id);
    if (error) { toast(errText(error), 'err'); return; }
    removeFiles('public-images', imgsOf(s)); if (s.file_path) removeFiles('news-files', [s.file_path]);
    if (S.editing?.id === s.id) reset();
    toast('ลบสรุปผลงานแล้ว'); load();
  }
}

async function save(e) {
  e.preventDefault();
  const msg = $('#vsMsg'), title = $('#vsTitle').value.trim(), old = S.editing, unitId = +$('#vsUnit').value;
  msg.style.color = 'var(--error)';
  if (!title) { msg.textContent = 'กรุณาใส่หัวข้อ'; return; }
  if (!unitId) { msg.textContent = 'กรุณาเลือก รพ.สต.'; return; }
  if (!$('#vsDate').value) { msg.textContent = 'กรุณาใส่วันที่'; return; }
  await S.img.ready();
  if (!S.img.items().length) { msg.textContent = 'กรุณาเลือกภาพสรุปอย่างน้อย 1 ภาพ'; return; }
  msg.textContent = '';
  const btn = $('#vsSubmit'); busy(btn, true, 'กำลังบันทึก…');
  const done = [];
  // เจ้าหน้าที่: รูปอยู่โฟลเดอร์หน่วยตัวเองเสมอ (สิทธิ์ storage) แม้สรุปเป็นของหน่วยอื่น · ผู้ดูแล: โฟลเดอร์ของหน่วยที่เลือก
  const folder = `summaries/${auth.profile.role === 'staff' ? auth.profile.unit_id : unitId}`;
  try {
    const paths = [];
    for (const x of S.img.items()) {
      if (x.path) { paths.push(x.path); continue; }
      const p = await uploadPublicImage(x.blob, folder); done.push(p); paths.push(p);
    }
    const row = { unit_id: unitId, fiscal_year: +$('#vsYear').value, title, body: $('#vsBody').value.trim(), image_path: paths[0], gallery: paths.slice(1),
      summary_date: $('#vsDate').value, participant_ids: [...S.picked], updated_at: new Date().toISOString() };
    const { error } = old ? await sb.from('visit_summaries').update(row).eq('id', old.id) : await sb.from('visit_summaries').insert(row);
    if (error) throw error;
    if (old) { const gone = imgsOf(old).filter((p) => !paths.includes(p)); if (gone.length) removeFiles('public-images', gone); }   // ภาพที่กด × ออก
    busy(btn, false);
    toast(old ? 'บันทึกการแก้ไขแล้ว' : 'เผยแพร่สรุปผลงานแล้ว — แสดงที่หน้าหลัก › ผลการดำเนินงาน');
    reset(); load();
  } catch (err) {
    busy(btn, false);
    if (done.length) removeFiles('public-images', done);
    msg.textContent = errText(err);
  }
}
