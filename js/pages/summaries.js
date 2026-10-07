// สรุปผลงานเยี่ยมบ้าน (ขั้น 23) — ภาพ A4 one-page summary ราย รพ.สต. × ปีงบ
//   หน้าหลัก › ผลการดำเนินงาน: กรอบโปสเตอร์ 10:7 สลับภาพสรุป ตาม รพ.สต./ปีงบที่เลือก → loadSummaryList + renderSummaryPoster
//   #/summary/<id>: หน้าอ่านแบบข่าว (ภาพเต็ม + รายละเอียด + PDF แนบ) → showSummary(id)
//   หน้าเยี่ยมบ้าน (เจ้าหน้าที่/ผู้ดูแล): เพิ่ม/แก้/ลบ → mountSummaries(slot, unit) · เลือก รพ.สต. ได้ (ค่าเริ่มต้น = หน่วยตัวเอง)
//     หลายภาพ (ภาพแรก = image_path · ที่เหลือ = gallery ≤ 6 · กด × ลบ) · ไม่มีช่อง PDF แล้ว (ไฟล์เดิมยังแสดง)
//   เชื่อมโยงรายการเยี่ยม (summary_visits · 39_summary_visits.sql · PDPA): เลือกผู้ป่วย → บันทึกเยี่ยม → หน้าอ่านมีลิงก์ไปบันทึกนั้น
//     (เห็นเฉพาะเจ้าหน้าที่ รพ.สต. ที่ดูแลผู้ป่วย + ผู้ดูแล · ประชาชนไม่เห็น · ทุกครั้งที่แสดงชื่อผู้ป่วยบันทึก log_patient_access)
import { sb, publicImageUrl } from '../supabase.js?v=4.4';
import { $, esc, thaiDate, toast, errText, busy, fiscalYearOf } from '../util.js?v=4.4';
import { auth } from '../auth.js?v=4.4';
import { loadUnits, loadYears, unitName } from '../data.js?v=4.4';
import { uploadPublicImage, removeFiles } from '../upload.js?v=4.4';
import { paras } from './delivery.js?v=4.4';
import { fileLink, imageList } from './news-form.js?v=4.4';
import { smartCover } from '../lightbox.js?v=4.4';

const CUR_FY = fiscalYearOf();
const COLS = 'id,unit_id,fiscal_year,title,body,image_path,gallery,file_path,file_name,author_id,created_at,updated_at,summary_date,participant_ids,participant_names,participant_others,participant_positions';
const MAX_IMGS = 7;   // ภาพแรก + gallery ไม่เกิน 6 (visit_summaries_gallery_check)
const imgsOf = (s) => [s.image_path, ...(s.gallery || [])].filter(Boolean);
const HINT_IMG = `ภาพสรุป 1 หน้า (เช่น อินโฟกราฟิกจาก Canva) · เลือกได้หลายภาพ ไม่เกิน ${MAX_IMGS} ภาพ · ย่อไม่เกิน A4 อัตโนมัติ · ภาพแรกเป็นภาพหลัก`;
const label = (s) => `รพ.สต.${unitName(s.unit_id)} · ปีงบประมาณ ${s.fiscal_year}`;
const dateOf = (s) => thaiDate(s.summary_date || s.created_at);   // วันที่ของผลงาน (ก่อนมีช่องนี้ = วันที่บันทึก)
const peopleOf = (s) => [...(s.participant_names || []), ...(s.participant_others || [])].join(', ');   // ในระบบ + กรอกเอง
/** นับผู้ลงเยี่ยมตามตำแหน่ง + ผู้ป่วยที่เยี่ยม → "เภสัชกร 1 ราย · พยาบาลวิชาชีพ 1 ราย · เยี่ยมผู้ป่วย 5 ราย"
 *  ตำแหน่ง: ผู้ร่วมลงในระบบ = จากบัญชีเจ้าหน้าที่ (positions) · กรอกเอง = ข้อความในวงเล็บท้ายชื่อ "ชื่อ นามสกุล (ตำแหน่ง)" */
const posOf = (txt) => (String(txt).match(/\(([^()]+)\)\s*$/)?.[1] || '').trim();
export function countLine(positions, patients) {
  const m = new Map();
  positions.forEach((p) => { const k = String(p || '').trim() || 'ไม่ระบุตำแหน่ง'; m.set(k, (m.get(k) || 0) + 1); });
  const parts = [...m].sort((a, b) => (a[0] === 'ไม่ระบุตำแหน่ง') - (b[0] === 'ไม่ระบุตำแหน่ง') || b[1] - a[1]).map(([k, n]) => `${k} ${n} ราย`);
  if (patients) parts.push(`เยี่ยมผู้ป่วย ${patients} ราย`);
  return parts.join(' · ');
}
const positionsOf = (s) => [...(s.participant_ids || []).map((_, i) => s.participant_positions?.[i] || ''), ...(s.participant_others || []).map(posOf)];
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
  const { data: nPt } = await sb.rpc('summary_patient_count', { p_summary: s.id });
  const counts = countLine(positionsOf(s), nPt || 0);
  if (peopleOf(s) || counts) {
    $('#smPeople').innerHTML = (counts ? `<b class="sm-counts">ลงเยี่ยม: ${esc(counts)}</b>` : '') + (peopleOf(s) ? `<span>เจ้าหน้าที่ที่ร่วมลง: ${esc(peopleOf(s))}</span>` : '');
    $('#smPeople').hidden = false;
  }
  const url = publicImageUrl(s.image_path);
  smartCover($('#smCover'), url, s.title);
  const gal = (s.gallery || []).filter(Boolean);   // ภาพเพิ่ม (ใกล้ A4 = ไม่ครอบตัด · กดขยายได้)
  if (gal.length) {
    $('#smGallery').innerHTML = gal.map(() => '<div class="cover"></div>').join(''); $('#smGallery').hidden = false;
    $('#smGallery').querySelectorAll('.cover').forEach((box, i) => smartCover(box, publicImageUrl(gal[i]), `${s.title} — ภาพที่ ${i + 2}`));
  }
  $('#smBody').innerHTML = paras(s.body);
  $('#smFile').innerHTML = s.file_path ? fileLink(s) : ''; $('#smFile').hidden = !s.file_path;
  showLinkedVisits(s.id);
}

/* ---------- รายการเยี่ยมที่เชื่อมโยง (PDPA: เฉพาะเจ้าหน้าที่/ผู้ดูแลที่มีสิทธิ์เห็นบันทึกนั้น · RLS กรองให้) ---------- */
const audit = (u, pid = null) => sb.rpc('log_patient_access', { p_unit: u, p_patient: pid }).then(() => {}, () => {});
/** บันทึกเยี่ยมตาม id → [{ id, visit_date, unit_id, patient_id, name }] เรียงวันที่ใหม่ก่อน (เห็นเฉพาะที่มีสิทธิ์) */
async function visitRows(ids) {
  if (!ids.length) return [];
  const { data: vs } = await sb.from('visits').select('id,visit_date,unit_id,patient_id').in('id', ids);
  const pids = [...new Set((vs || []).map((v) => v.patient_id))];
  const { data: ps } = pids.length ? await sb.from('patients').select('id,first_name,last_name').in('id', pids) : { data: [] };
  const nameOf = new Map((ps || []).map((p) => [p.id, `${p.first_name} ${p.last_name}`]));
  return (vs || []).map((v) => ({ ...v, name: nameOf.get(v.patient_id) || 'ผู้ป่วย' }))
    .sort((a, b) => String(b.visit_date).localeCompare(String(a.visit_date)) || a.name.localeCompare(b.name, 'th'));
}
async function showLinkedVisits(id) {
  const box = $('#smVisits'); box.hidden = true; box.innerHTML = '';
  const role = auth.profile?.role;
  if (role !== 'staff' && role !== 'admin') return;   // ประชาชน/ไม่ล็อกอิน: ไม่มีแม้แต่หัวข้อ
  // ชื่อย่อ/ชื่อเต็ม + สิทธิ์เปิดดู ตัดสินที่ฐานข้อมูล (summary_visit_list · 41_summary_visit_access.sql) · บันทึก PDPA ที่ฐานข้อมูล
  const { data: rows, error } = await sb.rpc('summary_visit_list', { p_summary: id });
  if (error || !rows?.length) return;
  box.innerHTML = `<h2>รายการเยี่ยมที่เชื่อมโยง (${rows.length})</h2><p class="small muted">เห็นเฉพาะเจ้าหน้าที่และผู้ดูแล · ผู้ร่วมลง เจ้าหน้าที่ รพ.สต. ที่ดูแล และผู้ดูแล กดดูรายละเอียดได้ (ทำอะไร ติดตามอะไร) · คนอื่นเห็นชื่อย่อ · การเปิดดูถูกบันทึกตาม PDPA</p>`
    + '<div class="list">' + rows.map((r) => {
      const sub = `เยี่ยมวันที่ ${esc(thaiDate(r.visit_date))}${role === 'admin' ? ' · รพ.สต.' + esc(unitName(r.unit_id)) : ''}`;
      return r.can_open
        ? `<button type="button" class="li-btn" data-sv-open="${esc(r.visit_id)}"><span class="l"><b>${esc(r.display_name)}</b><span class="small muted">${sub}</span></span><span aria-hidden="true">›</span></button>`
        : `<div class="li sv-locked"><span class="l"><b>${esc(r.display_name)}</b><span class="small muted">${sub}</span></span><span class="small muted">🔒 เฉพาะผู้ร่วมลง</span></div>`;
    }).join('') + '</div>';
  box.hidden = false;
  box.onclick = (e) => { const b = e.target.closest('[data-sv-open]'); if (b) openVisitDetail(id, b.dataset.svOpen); };
}
/** หน้าต่างรายละเอียดการเยี่ยม 1 ครั้ง (อ่านอย่างเดียว) · ผู้ดูแล/เจ้าหน้าที่ รพ.สต. ที่ดูแล มีลิงก์ไปหน้าเยี่ยมบ้านด้วย */
async function openVisitDetail(summaryId, visitId) {
  const dlg = $('#svDialog');
  if (!dlg.dataset.bound) {
    dlg.dataset.bound = '1';
    $('#svClose').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-sv-go]')) dlg.close(); });
  }
  $('#svTitle').textContent = 'รายละเอียดการเยี่ยม'; $('#svSub').textContent = ''; $('#svBody').innerHTML = '<div class="skeleton"></div>';
  if (!dlg.open) dlg.showModal();
  const { data: v, error } = await sb.rpc('summary_visit_detail', { p_summary: summaryId, p_visit: visitId });
  if (error) { $('#svBody').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  $('#svTitle').textContent = v.name;
  $('#svSub').textContent = `เยี่ยมวันที่ ${thaiDate(v.visit_date)} · รพ.สต.${unitName(v.unit_id)}`;
  const kv = (k, val) => (val == null || val === '' ? '' : `<dt>${k}</dt><dd>${esc(String(val))}</dd>`);
  const meds = (v.med_list || []).map((m) => `${m.name || ''}${m.how ? ` [${m.how}]` : ''}${m.qty ? ` (${m.qty} ${m.unit || ''})` : ''}`).filter((x) => x.trim()).join(', ');
  const drp = v.drps?.length ? `${v.drps.join(', ')}${v.drp_resolved ? ' · แก้ไขสำเร็จ' : ' · ยังไม่แก้ไข'}` : 'ไม่พบ';
  $('#svBody').innerHTML = '<dl class="kv">'
    + kv('อายุ', v.age != null ? v.age + ' ปี' : null) + kv('น้ำหนัก', v.weight != null ? v.weight + ' กก.' : null) + kv('ความดัน', v.bp) + kv('ชีพจร', v.pulse != null ? v.pulse + ' ครั้ง/นาที' : null) + kv('DTX', v.dtx)
    + kv('S', v.subjective) + kv('O', v.objective) + kv('A', v.assessment) + kv('P', v.plan)
    + kv('ยาที่เหลือ', meds) + kv('ยาเหลือค้างที่บ้านเกินวันนัด 1 เดือน', v.med_excess ? 'ใช่' : null) + kv('หมายเหตุยา', v.med_note)
    + kv('DRPs', drp) + kv('รายละเอียด DRPs', v.drp_detail)
    + kv('รูปถ่าย', v.photos ? `${v.photos} รูป${v.own ? '' : ' (ดูได้ในหน้าเยี่ยมบ้านของ รพ.สต. ที่ดูแล)'}` : null) + '</dl>'
    + (v.own ? `<p><a class="btn btn-o btn-sm" data-sv-go href="#/${auth.profile.role}/visits/${esc(visitId)}">เปิดในหน้าเยี่ยมบ้าน</a></p>` : '')
    + '<p class="small muted">ข้อมูลผู้ป่วย · ใช้เพื่อการดูแลเท่านั้น · การเปิดดูถูกบันทึกตาม PDPA</p>';
}

/* ======================= เพิ่ม/แก้/ลบ (หน้าเยี่ยมบ้าน) ======================= */
let S = null;   // { unit, list, editing, img }

const FORM = `
  <div class="panel vs-panel">
    <details class="vs-fold" id="vsFold"><summary><h2 id="vsFormTitle">เพิ่มสรุปผลงานเยี่ยมบ้าน one page summary</h2><span class="small muted vs-fold-hint">กดเพื่อเปิดฟอร์ม</span></summary>
    <p class="small muted">แสดงที่หน้าหลัก › ผลการดำเนินงาน ทันทีที่บันทึก · <b>ห้ามมีชื่อ ใบหน้า หรือข้อมูลที่ระบุตัวผู้ป่วยในภาพ</b></p>
    <form id="vsForm" class="form-grid" novalidate>
      <div class="field"><label for="vsTitle">หัวข้อ <span class="req">*</span></label><input id="vsTitle" class="input" maxlength="200" placeholder="เช่น สรุปผลการเยี่ยมบ้าน ไตรมาส 1"></div>
      <div class="field"><label for="vsUnit">รพ.สต. <span class="req">*</span></label><select id="vsUnit" class="input"></select></div>
      <div class="field"><label for="vsDate">วันที่ <span class="req">*</span></label><input id="vsDate" class="input" type="date"><span class="small muted" id="vsDateTh"></span></div>
      <div class="field"><label for="vsYear">ปีงบประมาณ</label><select id="vsYear" class="input"></select></div>
      <div class="field full"><details class="vs-pfold" id="vsPeopleFold"><summary><span class="lbl-t">เจ้าหน้าที่ที่ร่วมลง (เลือกได้หลายคน)</span><span class="small vs-people-n" id="vsPeopleN" aria-live="polite"></span></summary>
        <div class="unit-tabs vs-ptabs" id="vsPeopleTabs" aria-label="กรองรายชื่อตาม รพ.สต."></div>
        <input id="vsPeopleQ" class="input" type="search" maxlength="60" placeholder="ค้นหาชื่อ" aria-label="ค้นหาชื่อเจ้าหน้าที่"><div class="crit-pick vs-people" id="vsPeople" role="group" aria-label="เจ้าหน้าที่ที่ร่วมลง"></div>
        <div class="vs-other"><p class="small muted">ไม่มีชื่อในรายการ? กรอกเพิ่มเองได้ (ชื่อ นามสกุล ตำแหน่ง)</p>
          <div class="vs-other-row"><input id="vsOFirst" class="input" maxlength="50" placeholder="ชื่อ" aria-label="ชื่อผู้ร่วมลง"><input id="vsOLast" class="input" maxlength="50" placeholder="นามสกุล" aria-label="นามสกุลผู้ร่วมลง"><input id="vsOPos" class="input" maxlength="45" placeholder="ตำแหน่ง เช่น อสม." aria-label="ตำแหน่งผู้ร่วมลง"><button type="button" class="btn btn-o btn-sm" id="vsOAdd">+ เพิ่มชื่อ</button></div>
          <div class="list vs-other-list" id="vsOthers"></div></div></details><span class="small vs-counts" id="vsCounts" aria-live="polite"></span></div>
      <div class="field full"><span class="lbl-t" id="vsVisitL">เชื่อมโยงรายการเยี่ยม</span><p class="small muted vs-hint">ผูกบันทึกการเยี่ยมของผู้ป่วยแต่ละคนใน one page นี้ · เจ้าหน้าที่/ผู้ดูแลกดจากหน้าสรุปไปดูว่าเยี่ยมแล้วทำอะไร ติดตามอะไร (ประชาชนไม่เห็นส่วนนี้)</p>
        <div class="list vs-other-list" id="vsVisits" aria-labelledby="vsVisitL"></div>
        <div><button type="button" class="btn btn-o btn-sm" id="vsVisitBtn" aria-expanded="false" aria-controls="vsVisitPick">+ เชื่อมโยงรายการเยี่ยม</button></div>
        <div class="vs-visit-pick" id="vsVisitPick" hidden><input id="vsVisitQ" class="input" type="search" maxlength="60" placeholder="ค้นหาชื่อผู้ป่วย" aria-label="ค้นหาชื่อผู้ป่วย"><div class="list" id="vsVisitRes"></div></div></div>
      <div class="field full"><label for="vsImage">ภาพสรุป (A4) <span class="req">*</span></label><input id="vsImage" class="input" type="file" accept="image/*" multiple><span class="small muted" id="vsImageNote">${HINT_IMG}</span><div class="img-list" id="vsImagePreview" hidden></div></div>
      <div class="field full"><label for="vsBody">รายละเอียด (ถ้ามี)</label><textarea id="vsBody" rows="4" maxlength="5000"></textarea></div>
      <div class="full row-btns" style="align-items:center"><button class="btn btn-p btn-sm" type="submit" id="vsSubmit">เผยแพร่สรุปผลงาน</button><button class="btn btn-o btn-sm" type="button" id="vsCancel" hidden>ยกเลิกการแก้ไข</button><span class="small" id="vsMsg" aria-live="polite"></span></div>
    </form></details>
  </div>
  <div class="panel vs-panel">
    <h2 class="vs-list-h" id="vsListTitle">สรุปผลงาน</h2>
    <div class="list" id="vsList"></div>
  </div>`;

/** ฟอร์ม + รายการสรุปผลงานใน slot · unit = หน่วยที่ดูอยู่ (เจ้าหน้าที่ = หน่วยตัวเอง · ผู้ดูแล = หน่วยที่เลือก หรือ 'all' = ทุกหน่วย) */
export async function mountSummaries(slot, unit) {
  const units = await loadUnits();
  if (!S || !slot.contains($('#vsForm'))) {
    document.querySelectorAll('[data-sum-slot]').forEach((s) => { if (s !== slot) s.innerHTML = ''; });   // id ในหน้าต้องไม่ซ้ำ
    slot.innerHTML = FORM;
    S = { unit, list: [], editing: null, people: null, picked: new Set(), pickedNames: new Set(), others: [], links: new Map(), linksOrig: new Set(), pts: null, openPt: null, img: imageList($('#vsImage'), $('#vsImagePreview'), $('#vsImageNote'), { max: MAX_IMGS, hint: HINT_IMG }) };
    const years = await loadYears();
    $('#vsYear').innerHTML = [...new Set([...years, CUR_FY])].sort((a, b) => b - a).map((y) => `<option value="${y}">ปีงบประมาณ ${y}</option>`).join('');
    $('#vsUnit').innerHTML = units.map((u) => `<option value="${u.id}">รพ.สต.${esc(u.name)}</option>`).join('');
    $('#vsForm').addEventListener('submit', save);
    $('#vsCancel').addEventListener('click', reset);
    $('#vsList').addEventListener('click', onList);
    $('#vsDate').addEventListener('change', onDate);
    $('#vsPeopleQ').addEventListener('input', renderPeople);
    $('#vsPeopleTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-pt]'); if (!b) return; S.ptab = b.dataset.pt; renderPeople(); });
    $('#vsOAdd').addEventListener('click', addOther);
    $('#vsVisitBtn').addEventListener('click', toggleVisitPick);
    $('#vsVisitQ').addEventListener('input', renderVisitPick);
    $('#vsVisitRes').addEventListener('click', (e) => { const b = e.target.closest('[data-vpt]'); if (b) openPatientVisits(b.dataset.vpt); });
    $('#vsVisitRes').addEventListener('change', (e) => {
      const id = e.target.dataset?.vv; if (!id) return;
      if (e.target.checked) S.links.set(id, JSON.parse(e.target.dataset.row)); else S.links.delete(id);
      renderLinks();
    });
    $('#vsVisits').addEventListener('click', (e) => { const b = e.target.closest('[data-rm-link]'); if (b) { S.links.delete(b.dataset.rmLink); renderLinks(); renderVisitPick(); } });
    ['#vsOFirst', '#vsOLast', '#vsOPos'].forEach((id) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addOther(); } }));
    $('#vsOthers').addEventListener('click', (e) => { const b = e.target.closest('[data-rm-other]'); if (b) { S.others.splice(+b.dataset.rmOther, 1); renderOthers(); } });
    $('#vsPeople').addEventListener('click', (e) => {   // ค้นหาไม่พบ → กรอกชื่อนั้นเป็นชื่อใหม่
      if (!e.target.closest('[data-new-person]')) return;
      const [first, ...rest] = $('#vsPeopleQ').value.trim().split(/\s+/);
      $('#vsOFirst').value = first || ''; $('#vsOLast').value = rest.join(' '); $('#vsOPos').focus();
    });
    $('#vsPeople').addEventListener('change', (e) => {
      const id = e.target.value; if (!id) return;
      const set = id.startsWith('n:') ? S.pickedNames : S.picked, key = id.startsWith('n:') ? id.slice(2) : id;   // n: = ยังไม่เคยเข้าระบบ (เก็บเป็นชื่อ)
      if (e.target.checked) set.add(key); else set.delete(key);
      peopleCount();
    });
  }
  const { data: ppl, error: pErr } = await sb.rpc('staff_directory');   // โหลดใหม่ทุกครั้งที่เปิดหน้า (แก้ชื่อ/ตำแหน่งในบัญชีเจ้าหน้าที่แล้วขึ้นทันที)
  S.people = pErr ? (S.people || []) : ppl;
  S.unit = unit; S.units = units;
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
  S.picked = new Set(auth.profile ? [auth.profile.id] : []); S.pickedNames = new Set(); renderPeople();   // ค่าเริ่มต้น = ตัวเองร่วมลง
  S.others = []; renderOthers();
  S.links = new Map(); S.linksOrig = new Set(); S.openPt = null; renderLinks();
  $('#vsVisitPick').hidden = true; $('#vsVisitBtn').setAttribute('aria-expanded', 'false'); $('#vsVisitQ').value = '';
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
  // แท็บกรอง: ทั้งหมด · ผู้ดูแล (โรงพยาบาล) · ราย รพ.สต. (กดครั้งเดียวเห็นรายชื่อหน่วยนั้น) — เห็นทีละ ~3 ชื่อ เลื่อนดูต่อ
  const tab = S.ptab || 'all', inTab = (p) => tab === 'all' || (tab === 'admin' ? p.role === 'admin' : p.role !== 'admin' && String(p.unit_id) === tab);
  const n = (f) => S.people.filter(f).length;
  $('#vsPeopleTabs').innerHTML = [['all', 'ทั้งหมด', S.people.length], ['admin', 'ผู้ดูแล (โรงพยาบาล)', n((p) => p.role === 'admin')],
    ...(S.units || []).map((u) => [String(u.id), `รพ.สต.${u.name}`, n((p) => p.role !== 'admin' && p.unit_id === u.id)])]
    .map(([k, l, c]) => `<button type="button" data-pt="${k}" aria-current="${tab === k}">${esc(l)} (${c})</button>`).join('');
  const q = $('#vsPeopleQ').value.trim().toLowerCase();
  const list = S.people.filter((p) => inTab(p) && (!q || p.full_name.toLowerCase().includes(q)));
  const group = (p) => (p.role === 'admin' ? 'ผู้ดูแล (โรงพยาบาล)' : `รพ.สต.${unitName(p.unit_id)}`);
  let last = null;
  $('#vsPeople').innerHTML = list.map((p) => {
    const g = group(p), head = g !== last ? `<p class="crit-pick-h">${esc(g)}</p>` : '';
    last = g;
    const on = p.id ? S.picked.has(p.id) : S.pickedNames.has(pendingKey(p));
    return head + `<label class="crit-opt"><input type="checkbox" value="${esc(p.id || 'n:' + pendingKey(p))}"${on ? ' checked' : ''}><span>${esc(p.full_name)}${p.position ? ` <span class="muted small">· ${esc(p.position)}</span>` : ''}${p.joined === false ? ' <span class="muted small">(ยังไม่เคยเข้าสู่ระบบ)</span>' : ''}</span></label>`;
  }).join('') || (q ? `<p class="empty">ไม่พบ "${esc($('#vsPeopleQ').value.trim())}" ในระบบ · <button type="button" class="linklike" data-new-person>กรอกเป็นชื่อใหม่ด้านล่าง</button></p>`
    : '<p class="empty">ยังไม่มีรายชื่อเจ้าหน้าที่ · กรอกชื่อเพิ่มเองด้านล่างได้</p>');
  peopleCount();
}
/** ผู้ร่วมลงที่ไม่มีบัญชีในระบบ: "ชื่อ นามสกุล (ตำแหน่ง)" */
function addOther() {
  const first = $('#vsOFirst').value.trim(), last = $('#vsOLast').value.trim(), pos = $('#vsOPos').value.trim();
  if (!first) { $('#vsOFirst').focus(); toast('กรุณากรอกชื่อ', 'err'); return; }
  if (S.others.length >= 20) { toast('กรอกเพิ่มได้ไม่เกิน 20 คน', 'err'); return; }
  S.others.push(`${first}${last ? ' ' + last : ''}${pos ? ` (${pos})` : ''}`);
  $('#vsOFirst').value = ''; $('#vsOLast').value = ''; $('#vsOPos').value = ''; $('#vsOFirst').focus();
  renderOthers();
}
function renderOthers() {
  $('#vsOthers').innerHTML = S.others.map((n, i) => `<div class="li"><span>${esc(n)}</span><button type="button" class="btn btn-no btn-sm" data-rm-other="${i}" aria-label="ลบ ${esc(n)}">ลบ</button></div>`).join('');
  peopleCount();
}
/* ---------- เชื่อมโยงรายการเยี่ยม: ค้นหาชื่อผู้ป่วย → เลือกบันทึกเยี่ยม (วันที่) ---------- */
async function toggleVisitPick() {
  const box = $('#vsVisitPick'), open = box.hidden;
  box.hidden = !open; $('#vsVisitBtn').setAttribute('aria-expanded', String(open));
  if (!open) return;
  if (!S.pts) {
    $('#vsVisitRes').innerHTML = '<div class="skeleton"></div>';
    const { data, error } = await sb.from('patients').select('id,unit_id,first_name,last_name').order('first_name');
    if (error) { $('#vsVisitRes').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
    S.pts = data;
    [...new Set(data.map((p) => p.unit_id))].forEach((u) => audit(u));   // เห็นรายชื่อผู้ป่วย = บันทึกการเข้าถึง
  }
  renderVisitPick(); $('#vsVisitQ').focus();
}
function renderVisitPick() {
  if (!S.pts || $('#vsVisitPick').hidden) return;
  const q = $('#vsVisitQ').value.trim().toLowerCase();
  const list = S.pts.filter((p) => !q || `${p.first_name} ${p.last_name}`.toLowerCase().includes(q)).slice(0, 30);
  $('#vsVisitRes').innerHTML = list.map((p) => {
    const open = S.openPt?.id === p.id;
    return `<button type="button" class="li-btn${open ? ' sel' : ''}" data-vpt="${esc(p.id)}" aria-expanded="${open}"><span class="l"><b>${esc(p.first_name)} ${esc(p.last_name)}</b>`
      + `${auth.profile?.role === 'admin' ? `<span class="small muted">รพ.สต.${esc(unitName(p.unit_id))}</span>` : ''}</span><span aria-hidden="true">${open ? '▾' : '›'}</span></button>`
      + (open ? `<div class="vs-visit-days">${S.openPt.visits.length ? S.openPt.visits.map((v) => {
        const row = esc(JSON.stringify({ id: v.id, visit_date: v.visit_date, unit_id: v.unit_id, patient_id: p.id, name: `${p.first_name} ${p.last_name}` }));
        return `<label class="crit-opt"><input type="checkbox" data-vv="${esc(v.id)}" data-row="${row}"${S.links.has(v.id) ? ' checked' : ''}><span><b>เยี่ยมวันที่ ${esc(thaiDate(v.visit_date))}</b>${v.assessment || v.subjective ? ` <span class="muted">${esc((v.assessment || v.subjective).slice(0, 60))}</span>` : ''}</span></label>`;
      }).join('') : '<p class="small muted">ยังไม่มีบันทึกการเยี่ยมของผู้ป่วยคนนี้</p>'}</div>` : '');
  }).join('') || `<p class="empty">${S.pts.length ? 'ไม่พบชื่อผู้ป่วยที่ค้นหา' : 'ยังไม่มีผู้ป่วยในรายชื่อเยี่ยมบ้าน'}</p>`;
}
async function openPatientVisits(pid) {
  if (S.openPt?.id === pid) { S.openPt = null; renderVisitPick(); return; }
  const p = S.pts.find((x) => x.id === pid); if (!p) return;
  audit(p.unit_id, p.id);
  const { data } = await sb.from('visits').select('id,visit_date,unit_id,subjective,assessment').eq('patient_id', pid).order('visit_date', { ascending: false });
  S.openPt = { id: pid, visits: data || [] };
  renderVisitPick();
}
function renderLinks() {
  const rows = [...S.links.values()].sort((a, b) => String(b.visit_date).localeCompare(String(a.visit_date)));
  $('#vsVisits').innerHTML = rows.map((r) => `<div class="li"><span><b>${esc(r.name)}</b> <span class="small muted">· เยี่ยมวันที่ ${esc(thaiDate(r.visit_date))}</span></span>`
    + `<button type="button" class="btn btn-no btn-sm" data-rm-link="${esc(r.id)}" aria-label="ยกเลิกเชื่อมโยง ${esc(r.name)}">ลบ</button></div>`).join('');
  $('#vsVisitBtn').textContent = rows.length ? `+ เชื่อมโยงเพิ่ม (ตอนนี้ ${rows.length} รายการ)` : '+ เชื่อมโยงรายการเยี่ยม';
  peopleCount();
}
/** หลังบันทึกสรุป: เพิ่ม/ลบลิงก์ให้ตรงกับที่เลือก */
async function syncLinks(summaryId) {
  const add = [...S.links.keys()].filter((id) => !S.linksOrig.has(id)), del = [...S.linksOrig].filter((id) => !S.links.has(id));
  if (add.length) { const { error } = await sb.from('summary_visits').insert(add.map((visit_id) => ({ summary_id: summaryId, visit_id }))); if (error) throw error; }
  if (del.length) { const { error } = await sb.from('summary_visits').delete().eq('summary_id', summaryId).in('visit_id', del); if (error) throw error; }
}

/** คนในบัญชีเจ้าหน้าที่ที่ยังไม่เคยเข้าระบบ → เก็บเป็นข้อความ "ชื่อ (ตำแหน่ง)" ใน participant_others */
const pendingKey = (p) => (p.position ? `${p.full_name} (${p.position})` : p.full_name);
function peopleCount() {
  const sys = (S.people || []).filter((p) => p.id && S.picked.has(p.id));
  const positions = [...sys.map((p) => p.position || ''), ...[...(S.pickedNames || []), ...(S.others || [])].map(posOf)];
  const nPt = new Set([...(S.links || new Map()).values()].map((r) => r.patient_id)).size;
  const counts = countLine(positions, nPt);
  $('#vsCounts').textContent = counts ? `ลงเยี่ยม: ${counts}` : '';
  const names = [...sys.map((p) => p.full_name), ...(S.pickedNames || []), ...(S.others || [])];
  $('#vsPeopleN').textContent = names.length ? `ร่วมลง ${names.length} คน: ${names.join(', ')}` : '';
}

async function load() {
  $('#vsList').innerHTML = '<div class="skeleton"></div>';
  S.linkCount = new Map();
  const order = (q) => q.order('fiscal_year', { ascending: false }).order('summary_date', { ascending: false }).order('created_at', { ascending: false });
  const base = sb.from('visit_summaries').select(COLS);
  const [a, mine] = await Promise.all([   // หน่วยที่ดูอยู่ + ที่ตัวเองเพิ่มให้หน่วยอื่น
    order(S.unit === 'all' ? base : base.eq('unit_id', S.unit)),
    S.unit === 'all' || !auth.profile ? Promise.resolve({ data: [] }) : order(sb.from('visit_summaries').select(COLS).eq('author_id', auth.profile.id)),
  ]);
  if (a.error) { $('#vsList').innerHTML = `<p class="empty">${esc(errText(a.error))}</p>`; return; }
  const seen = new Set(), data = [...a.data, ...(mine.data || [])].filter((x) => !seen.has(x.id) && seen.add(x.id));
  S.list = data;
  S.ptCount = new Map((await Promise.all(data.map(async (x) => [x.id, (await sb.rpc('summary_patient_count', { p_summary: x.id })).data || 0]))));
  if (data.length) {   // จำนวนรายการเยี่ยมที่เชื่อมโยง (เห็นเฉพาะที่มีสิทธิ์)
    const { data: ls } = await sb.from('summary_visits').select('summary_id').in('summary_id', data.map((x) => x.id));
    (ls || []).forEach((l) => S.linkCount.set(l.summary_id, (S.linkCount.get(l.summary_id) || 0) + 1));
  }
  $('#vsList').innerHTML = data.length ? data.map((s) => `<div class="da-poster"><img src="${esc(publicImageUrl(s.image_path))}" alt="">`
    + `<div class="l"><b>${esc(s.title)}</b><span class="small muted">วันที่ ${esc(dateOf(s))} · รพ.สต.${esc(unitName(s.unit_id))} · ปีงบประมาณ ${s.fiscal_year} · ${imgsOf(s).length} ภาพ${s.file_path ? ' · มี PDF' : ''}${S.linkCount.get(s.id) ? ` · เชื่อมโยง ${S.linkCount.get(s.id)} รายการเยี่ยม` : ''}</span>`
    + (countLine(positionsOf(s), S.ptCount.get(s.id)) ? `<span class="small">ลงเยี่ยม: ${esc(countLine(positionsOf(s), S.ptCount.get(s.id)))}</span>` : '')
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
    const pending = new Set((S.people || []).filter((p) => !p.id).map(pendingKey));   // ชื่อที่เลือกจากรายชื่อตอนยังไม่เข้าระบบ → ติ๊กกลับในรายการ
    S.picked = new Set(s.participant_ids || []); S.pickedNames = new Set((s.participant_others || []).filter((n) => pending.has(n)));
    $('#vsPeopleQ').value = ''; renderPeople();
    S.others = (s.participant_others || []).filter((n) => !S.pickedNames.has(n)); renderOthers();
    S.links = new Map(); S.linksOrig = new Set(); renderLinks();
    sb.from('summary_visits').select('visit_id').eq('summary_id', s.id).then(async ({ data: ls }) => {
      const rows = await visitRows((ls || []).map((l) => l.visit_id));
      if (S.editing?.id !== s.id) return;
      rows.forEach((r) => audit(r.unit_id, r.patient_id));
      S.links = new Map(rows.map((r) => [r.id, r])); S.linksOrig = new Set(S.links.keys()); renderLinks();
    });
    S.img.set(imgsOf(s));
    $('#vsFormTitle').textContent = 'แก้ไขสรุปผลงาน'; $('#vsSubmit').textContent = 'บันทึกการแก้ไข'; $('#vsCancel').hidden = false;
    $('#vsFold').open = true;   // ฟอร์มย่ออยู่ → กดแก้ไขแล้วเปิดให้
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
      summary_date: $('#vsDate').value, participant_ids: [...S.picked], participant_others: [...new Set([...S.pickedNames, ...S.others])], updated_at: new Date().toISOString() };
    const { data: saved, error } = old ? await sb.from('visit_summaries').update(row).eq('id', old.id).select('id') : await sb.from('visit_summaries').insert(row).select('id');
    if (error) throw error;
    const sid = saved?.[0]?.id ?? old?.id;
    if (sid) await syncLinks(sid).catch((err) => toast('บันทึกสรุปแล้ว แต่เชื่อมโยงรายการเยี่ยมไม่สำเร็จ: ' + errText(err), 'err'));
    if (old) { const gone = imgsOf(old).filter((p) => !paths.includes(p)); if (gone.length) removeFiles('public-images', gone); }   // ภาพที่กด × ออก
    busy(btn, false);
    toast(old ? 'บันทึกการแก้ไขแล้ว' : 'เผยแพร่สรุปผลงานแล้ว — แสดงที่หน้าหลัก › ผลการดำเนินงาน');
    reset(); $('#vsFold').open = false; load();   // บันทึกแล้วย่อฟอร์มกลับ
  } catch (err) {
    busy(btn, false);
    if (done.length) removeFiles('public-images', done);
    msg.textContent = errText(err);
  }
}
