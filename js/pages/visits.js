// เจ้าหน้าที่: เยี่ยมบ้าน — ผู้ป่วยของ รพ.สต. ตัวเอง + บันทึกการเยี่ยม (SOAP, รายการยา, DRPs)
// ข้อมูลอ่อนไหว: RLS ให้เห็นเฉพาะ รพ.สต. เดียวกัน + ผู้ดูแล · ทุกการเพิ่ม/แก้/ลบถูกบันทึกใน audit_log (trigger)
// และการเปิดดูบันทึกผ่าน log_patient_access() — ผู้ดูแลดูย้อนหลังที่ ตั้งค่า › ประวัติการเข้าถึง (admin-audit.js)
import { sb } from '../supabase.js?v=4.4';
import { $, esc, thaiDate, initials, toast, errText, busy, fiscalYearOf } from '../util.js?v=4.4';
import { auth } from '../auth.js?v=4.4';
import { loadUnits, unitName } from '../data.js?v=4.4';
import { compressImage, uploadVisitPhoto, removeFiles, fileCard, hydrateSigned, openPrivateFile } from '../upload.js?v=4.4';

export const DRP_CATS = [
  'ได้รับยาที่ไม่จำเป็น (Unnecessary drug therapy)', 'ควรได้รับยาเพิ่มเติม (Needs additional therapy)',
  'ยาไม่ได้ผล/ไม่เหมาะสมกับอาการ (Ineffective drug)', 'ขนาดยาต่ำเกินไป (Dosage too low)', 'ขนาดยาสูงเกินไป (Dosage too high)',
  'เกิดอาการไม่พึงประสงค์จากยา (Adverse drug reaction)', 'ไม่ให้ความร่วมมือในการใช้ยา (Non-adherence)',
];
const COVERAGE = ['บัตรทอง (สปสช.)', 'ข้าราชการ/รัฐวิสาหกิจ', 'ประกันสังคม', 'ประชาชนทั่วไป', 'อื่นๆ'];
const PHONE_RE = /^[0-9][0-9 -]{7,14}$/;
/** วันเกิดแบบ วัน/เดือน/ปี (ค.ศ. หรือ พ.ศ.) เช่น 12/5/1997 → '1997-05-12' · ผิดรูปแบบ = null */
function parseDob(t) {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t.trim()); if (!m) return null;
  let [, d, mo, y] = m.map(Number); if (y > 2400) y -= 543;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
const dmy = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return `${d}/${m}/${y}`; };
const MED_UNITS = ['เม็ด', 'ขวด', 'หลอด', '(ไม่ระบุ)'];
const MAX_PHOTOS = 5;
let keptPhotos = [], newPhotos = [];   // ฟอร์มบันทึกเยี่ยม: รูปเดิมที่ยังเก็บไว้ + รูปใหม่ที่ย่อแล้ว [{ blob, url }]

let unitList = [], patients = [], selected = null, visits = [], mode = 'view', editVisit = null, ptEdit = false, vOpen = false, ws = null, unit = null;
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const maskId = (id) => (id ? `x-xxxx-xxxxx-${id.slice(10, 12)}-${id.slice(12)}` : '–');
const age = (dob) => { if (!dob) return ''; const d = new Date(dob), n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--; return a; };

const WS_HTML = `<div class="visits-stack">
  <div class="panel">
    <div class="panel-head"><h2>ผู้ป่วยในความดูแล <span class="num muted" id="ptCount"></span></h2><button type="button" class="btn btn-p btn-sm" id="ptAddBtn">+ เพิ่มผู้ป่วย</button></div>
    <label for="ptSearch" class="sr-only">ค้นหาผู้ป่วย</label>
    <input id="ptSearch" class="input" type="search" placeholder="ค้นหาชื่อ / HN / เลข 13 หลัก">
    <div class="list" id="ptList"></div>
    <p class="small muted pdpa-note">การเปิดดู เพิ่ม แก้ไข และลบข้อมูลผู้ป่วยถูกบันทึกไว้ตาม PDPA</p>
  </div>
  <div class="panel" id="ptPanel"></div>
</div>`;

/** แสดงหน้าจอเยี่ยมบ้านของ รพ.สต. unitId ลงใน slot (เจ้าหน้าที่ = หน่วยตัวเอง, ผู้ดูแล = เลือกหน่วย หรือ ALL = โรงพยาบาล รวมทุกชื่อ)
 *  สังกัด รพ.สต. = หน่วยที่ดูแล: เปลี่ยนสังกัดแล้วผู้ป่วย + บันทึกเยี่ยมย้ายไปอยู่รายชื่อของหน่วยนั้น (rpc transfer_patient) */
export const ALL = 'all';
export async function mountVisits(slot, unitId, openVisit = null) {
  if (!ws) { ws = document.createElement('div'); ws.innerHTML = WS_HTML; slot.appendChild(ws); bind(); }
  else if (ws.parentNode !== slot) slot.appendChild(ws);
  unitList = await loadUnits();
  if (unit !== unitId) { unit = unitId; selected = null; mode = 'view'; editVisit = null; ptEdit = false; vOpen = false; $('#ptSearch').value = ''; }
  await loadPatients();
  if (openVisit) await showVisit(openVisit);
}
export const initVisits = (openVisit) => mountVisits($('#staffVisitsSlot'), auth.profile.unit_id, openVisit);
/** เปิดบันทึกการเยี่ยมตาม id (ลิงก์จากสรุปผลงาน one page) → เลือกผู้ป่วย + ไฮไลต์บันทึกนั้น */
async function showVisit(id) {
  const { data } = await sb.from('visits').select('id,patient_id').eq('id', id).maybeSingle();
  if (!data || !patients.some((p) => p.id === data.patient_id)) { toast('ไม่พบบันทึกการเยี่ยมนี้ หรือไม่มีสิทธิ์ดู', 'err'); return; }
  await select(data.patient_id);
  const li = document.getElementById('vt-' + id);
  if (li) { li.classList.add('hl'); li.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}

async function loadPatients() {
  $('#ptList').innerHTML = '<div class="skeleton" style="margin-top:8px"></div>';
  let q = sb.from('patients').select('*');
  if (unit !== ALL) q = q.eq('unit_id', unit);
  const { data, error } = await q.order('first_name');
  if (error) { $('#ptList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  patients = data;
  logAccess();
  if (selected) selected = patients.find((p) => p.id === selected.id) || null;
  renderList(); renderPanel();
}

function renderList() {
  const q = $('#ptSearch').value.trim().toLowerCase();
  const list = patients.filter((p) => !q || `${p.first_name} ${p.last_name} ${p.hn_unit || ''} ${p.hn_hospital || ''} ${p.national_id || ''} ${p.phone || ''}`.toLowerCase().includes(q));
  $('#ptCount').textContent = `(${patients.length})`;
  $('#ptList').innerHTML = list.length ? list.map((p) => `<button type="button" class="li-btn${selected?.id === p.id ? ' sel' : ''}" data-pt="${p.id}" aria-expanded="${selected?.id === p.id}">`
    + `<span style="display:flex;align-items:center;gap:10px;min-width:0"><span class="avatar" style="width:34px;height:34px;font-size:12px">${esc(initials(p.first_name + ' ' + p.last_name))}</span>`
    + `<span class="l"><b>${esc(p.first_name)} ${esc(p.last_name)}</b><span class="small muted">${unit === ALL || p.home_unit_id != null ? 'รพ.สต. ' + esc(unitName(unit === ALL ? p.unit_id : p.home_unit_id)) : 'HN รพ.สต. ' + esc(p.hn_unit || '–')}${p.birth_date ? ' · ' + age(p.birth_date) + ' ปี' : ''}</span></span></span></button>`).join('')
    : `<p class="empty">${patients.length ? 'ไม่พบผู้ป่วยที่ค้นหา' : 'ยังไม่มีผู้ป่วย · กด "เพิ่มผู้ป่วย" เพื่อเริ่ม'}</p>`;
}

/** บันทึกการเปิดดู (ไม่รอผล · ไม่ขวางการใช้งานถ้าบันทึกไม่สำเร็จ) */
function logAccess(patientId = null) {
  if (!unit) return;   // ผู้ดูแลยังไม่ได้เลือก รพ.สต.
  if (unit === ALL && !patientId) { [...new Set(patients.map((p) => p.unit_id))].forEach((u) => auditRpc(u, null)); return; }   // รายชื่อรวม = บันทึกทุกหน่วยที่เห็น
  auditRpc(unit === ALL ? patients.find((p) => p.id === patientId)?.unit_id : unit, patientId);
}
function auditRpc(u, patientId) {
  sb.rpc('log_patient_access', { p_unit: u, p_patient: patientId }).then(({ error }) => { if (error) console.warn('audit', error.message); }, () => {});
}

async function select(id) {
  selected = patients.find((p) => p.id === id) || null; mode = 'view'; editVisit = null; ptEdit = false; vOpen = false;
  logAccess(id);
  renderList(); $('#ptPanel').innerHTML = '<div class="skeleton"></div>';
  const { data } = await sb.from('visits').select('*').eq('patient_id', id).order('visit_date', { ascending: false });
  visits = data || [];
  renderPanel();
  $('#ptPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });   // รายชื่ออยู่บน บันทึกอยู่ล่าง → เลื่อนลงให้เห็น
}

/* ---------- แผงขวา: หัวชื่อ · ข้อมูลผู้ป่วย/ฟอร์มแก้ไข (ย่อได้) · ฟอร์มบันทึกเยี่ยม · รายการเยี่ยม
   แต่ละส่วนวาดแยกกัน → เปิดฟอร์มแก้ไขบันทึกเยี่ยมแล้ว ฟอร์มแก้ไขข้อมูลผู้ป่วยยังค้างอยู่ (ข้อมูลที่พิมพ์ไม่หาย) ---------- */
function renderPanel() {
  const el = $('#ptPanel');
  if (mode === 'patient-form') { el.innerHTML = patientForm(null); return; }
  if (!selected) { el.innerHTML = '<p class="empty">เลือกผู้ป่วยจากรายการ หรือกด "เพิ่มผู้ป่วย"</p>'; return; }
  el.innerHTML = '<div class="panel-head"><h2 id="ptName"></h2><div class="row-btns">'
    + '<button type="button" class="btn btn-o btn-sm" data-act="edit-patient">แก้ไขข้อมูล</button><button type="button" class="btn btn-no btn-sm" data-act="del-patient">ลบ</button></div></div>'
    + '<div id="ptInfo"></div>'
    + '<div class="panel-head"><h2>บันทึกการเยี่ยม (<span id="vCount"></span>)</h2><button type="button" class="btn btn-p btn-sm" data-act="add-visit">+ บันทึกการเยี่ยม</button></div>'
    + '<div id="vFormSlot"></div><div class="list" id="vList"></div>';
  renderInfo(); renderVisitForm(); renderVisits();
}
const fullName = (p) => `${p.first_name} ${p.last_name}`;
function renderInfo() {
  const p = selected;
  $('#ptName').textContent = fullName(p);
  if (ptEdit) {
    $('#ptInfo').innerHTML = `<details class="vs-fold pt-fold" id="ptEditFold" open><summary><b>แก้ไขข้อมูล · ${esc(fullName(p))}</b><span class="small muted vs-fold-hint">ย่อไว้ · กดเพื่อแก้ไขต่อ</span></summary>${patientForm(p, true)}</details>`;
    return;
  }
  $('#ptInfo').innerHTML = `<dl class="kv"><dt>เลข 13 หลัก</dt><dd>${esc(maskId(p.national_id))}</dd><dt>วันเกิด</dt><dd>${p.birth_date ? esc(thaiDate(p.birth_date)) + ` (${age(p.birth_date)} ปี)` : '–'}</dd>`
    + `<dt>HN รพ.</dt><dd>${esc(p.hn_hospital || '–')}</dd><dt>สังกัด รพ.สต.</dt><dd>${p.home_unit_id != null ? esc(unitName(p.home_unit_id)) : '–'}</dd>`
    + (p.hn_unit ? `<dt>HN รพ.สต. (เดิม)</dt><dd>${esc(p.hn_unit)}</dd>` : '')
    + `<dt>เบอร์โทร</dt><dd>${esc(p.phone || '–')}</dd><dt>ที่อยู่</dt><dd>${esc(p.address || '–')}</dd><dt>สิทธิ</dt><dd>${esc(p.coverage || '–')}</dd></dl>`;
}
function renderVisitForm() {
  const el = $('#vFormSlot');
  newPhotos.forEach((x) => URL.revokeObjectURL(x.url)); newPhotos = [];
  if (!vOpen) { el.innerHTML = ''; return; }
  el.innerHTML = visitForm(editVisit); fillMeds(editVisit?.med_list || []); syncDrp();
  keptPhotos = [...(editVisit?.photo_paths || [])]; renderPhotos();
}
function renderVisits() {
  const el = $('#vList');
  $('#vCount').textContent = visits.length;
  el.innerHTML = visits.length ? visits.map((v) => {
      const meds = (v.med_list || []).map((m) => `${m.name}${m.how ? ` [${m.how}]` : ''}${m.qty ? ` (${m.qty} ${m.unit || ''})` : ''}`).join(', ');
      const drp = v.drps?.length ? `DRPs ${v.drps.length} ข้อ${v.drp_resolved ? ' · แก้ไขสำเร็จ' : ' · ยังไม่แก้ไข'}` : 'ไม่พบ DRPs';
      return `<div class="li" id="vt-${esc(v.id)}"><div class="l"><b>เยี่ยมวันที่ ${esc(thaiDate(v.visit_date))} <span class="small muted">· ปีงบ ${v.fiscal_year}</span></b>`
        + ([v.bp && `BP ${v.bp}`, v.pulse != null && `ชีพจร ${v.pulse}`, v.dtx && `DTX ${v.dtx}`].filter(Boolean).length ? `<span class="small muted">${esc([v.bp && `BP ${v.bp}`, v.pulse != null && `ชีพจร ${v.pulse}`, v.dtx && `DTX ${v.dtx}`].filter(Boolean).join(' · '))}</span>` : '')
        + (v.subjective ? `<span class="small muted">S: ${esc(v.subjective.slice(0, 80))}</span>` : '')
        + (v.objective ? `<span class="small muted">O: ${esc(v.objective.slice(0, 80))}</span>` : '')
        + (v.assessment ? `<span class="small muted">A: ${esc(v.assessment.slice(0, 80))}</span>` : '')
        + `<span class="small">${esc(drp)}</span>`
        + (meds ? `<span class="small muted">ยาที่เหลือ: ${esc(meds)}</span>` : '')
        + (v.med_excess ? '<span class="small" style="color:var(--warning)">ยาเหลือค้างที่บ้านเกินวันนัด 1 เดือน</span>' : '')
        + (v.med_note ? `<span class="small muted">หมายเหตุยา: ${esc(v.med_note.slice(0, 80))}</span>` : '')
        + (v.photo_paths?.length ? `<div class="fthumbs visit-photos">${v.photo_paths.map((ph, i) => fileCard('visit-photos', ph, `รูป ${i + 1}`)).join('')}</div>` : '')
        + `</div><div class="row-btns"><button type="button" class="btn btn-o btn-sm" data-edit-visit="${v.id}">แก้ไข</button><button type="button" class="btn btn-no btn-sm" data-del-visit="${v.id}">ลบ</button></div></div>`;
    }).join('') : '<p class="empty">ยังไม่มีบันทึกการเยี่ยม</p>';
  hydrateSigned(el);
}

/* ---------- ที่อยู่ผู้ป่วยแยกช่อง (address_parts) + ที่อยู่เต็ม (address) สำหรับแสดง/ค้นหา ---------- */
const ADDR = [['no', 'เลขที่', 30, ''], ['moo', 'หมู่', 10, ''], ['tambon', 'ตำบล', 60, ''], ['amphoe', 'อำเภอ', 60, 'ควนกาหลง'], ['province', 'จังหวัด', 60, 'สตูล'], ['zip', 'รหัสไปรษณีย์', 5, '91130']];
function addrFields(p) {
  const a = p?.address_parts || (p?.address ? { no: p.address } : {});   // ข้อมูลเก่า (ข้อความเดียว) → ใส่ไว้ช่องเลขที่ ไม่หาย
  return '<fieldset class="field full addr-box"><legend>ที่อยู่</legend><div class="addr-grid">'
    + ADDR.map(([k, label, max, def]) => `<div class="field"><label for="pfA_${k}">${label}</label><input id="pfA_${k}" class="input" maxlength="${max}"${k === 'zip' ? ' inputmode="numeric"' : ''} value="${esc(a[k] ?? (p?.address_parts || !p ? def : ''))}"></div>`).join('')
    + '</div></fieldset>';
}
function readAddr() {
  const a = Object.fromEntries(ADDR.map(([k]) => [k, $('#pfA_' + k).value.trim()]));
  if (!a.no && !a.moo && !a.tambon) return { address_parts: null, address: null };   // ไม่กรอกที่อยู่ (อำเภอ/จังหวัดเป็นค่าตั้งต้น)
  const full = [a.no && `เลขที่ ${a.no}`, a.moo && `หมู่ ${a.moo}`, a.tambon && `ต.${a.tambon}`, a.amphoe && `อ.${a.amphoe}`, a.province && `จ.${a.province}`, a.zip].filter(Boolean).join(' ');
  return { address_parts: a, address: full.slice(0, 300) };
}

function patientForm(p, inline = false) {
  const v = (k) => esc(p?.[k] || '');
  return `${inline ? '' : `<h2>${p ? 'แก้ไขข้อมูลผู้ป่วย' : 'เพิ่มผู้ป่วยใหม่'}</h2>`}<form id="ptForm" class="form-grid" novalidate>`
    + `<div class="field"><label for="pfFirst">ชื่อ <span class="req">*</span></label><input id="pfFirst" class="input" maxlength="80" value="${v('first_name')}"></div>`
    + `<div class="field"><label for="pfLast">นามสกุล <span class="req">*</span></label><input id="pfLast" class="input" maxlength="80" value="${v('last_name')}"></div>`
    + `<div class="field"><label for="pfNid">เลขประจำตัวประชาชน 13 หลัก</label><input id="pfNid" class="input" inputmode="numeric" maxlength="17" value="${v('national_id')}"></div>`
    + `<div class="field"><label for="pfDob">วันเกิด</label><input id="pfDob" class="input" inputmode="numeric" maxlength="10" placeholder="เช่น 12/5/1997" aria-describedby="pfDobHint" value="${esc(dmy(p?.birth_date))}"><span class="small muted" id="pfDobHint">วัน/เดือน/ปี ค.ศ. เช่น 12/5/1997 · กรอกปี พ.ศ. ได้ ระบบแปลงให้</span></div>`
    + `<div class="field"><label for="pfHnH">HN โรงพยาบาล</label><input id="pfHnH" class="input" maxlength="30" value="${v('hn_hospital')}"></div>`
    + `<div class="field"><label for="pfHome">สังกัด รพ.สต.${unit === ALL ? ' <span class="req">*</span>' : ''}</label><select id="pfHome" class="input"><option value="">– ไม่ระบุ –</option>${unitList.map((u) => `<option value="${u.id}"${(p ? p.home_unit_id ?? p.unit_id : unit) === u.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select><span class="small muted">เปลี่ยนสังกัด = ย้ายผู้ป่วยและบันทึกเยี่ยมไปอยู่ในรายชื่อของ รพ.สต. นั้น</span></div>`
    + `<div class="field"><label for="pfPhone">เบอร์โทร</label><input id="pfPhone" class="input" type="tel" inputmode="tel" maxlength="20" placeholder="เช่น 0812345678" value="${v('phone')}"></div>`
    + addrFields(p)
    + `<div class="field"><label for="pfCov">สิทธิการรักษา</label><select id="pfCov" class="input"><option value="">– ไม่ระบุ –</option>${COVERAGE.map((c) => `<option${p?.coverage === c ? ' selected' : ''}>${c}</option>`).join('')}</select></div>`
    + '<div class="full row-btns" style="align-items:center"><button class="btn btn-p btn-sm" type="submit">บันทึก</button><button class="btn btn-o btn-sm" type="button" data-act="cancel">ยกเลิก</button><span class="small" id="pfMsg" aria-live="polite"></span></div></form>';
}

function visitForm(v) {
  const val = (k) => esc(v?.[k] ?? '');
  const drps = new Set(v?.drps || []);
  return `<h2>${v ? 'แก้ไขบันทึกการเยี่ยม' : 'บันทึกการเยี่ยมบ้าน'} · ${esc(selected.first_name)} ${esc(selected.last_name)}</h2><form id="vForm" class="form-grid" novalidate>`
    + `<div class="field"><label for="vDate">วันที่เยี่ยม <span class="req">*</span></label><input id="vDate" class="input" type="date" max="${today()}" value="${val('visit_date') || today()}"></div>`
    + `<div class="field"><label for="vAge">อายุ (ปี)</label><input id="vAge" class="input" type="number" inputmode="numeric" min="0" max="130" value="${val('age') || (selected.birth_date ? age(selected.birth_date) : '')}"></div>`
    + `<div class="field"><label for="vWeight">น้ำหนัก (กก.)</label><input id="vWeight" class="input" type="number" inputmode="decimal" step="0.1" min="0" value="${val('weight')}"></div>`
    + `<div class="field"><label for="vBp">ความดัน (BP)</label><input id="vBp" class="input" placeholder="เช่น 130/80" maxlength="20" value="${val('bp')}"></div>`
    + `<div class="field"><label for="vDtx">น้ำตาล (DTX)</label><input id="vDtx" class="input" placeholder="มก./ดล." maxlength="20" value="${val('dtx')}"></div>`
    + `<div class="field"><label for="vPulse">ชีพจร (Pulse · ครั้ง/นาที)</label><input id="vPulse" class="input" type="number" inputmode="numeric" min="20" max="250" placeholder="เช่น 78" value="${val('pulse')}"></div>`
    + `<div class="field full"><label for="vS">S — อาการ/ข้อมูลจากผู้ป่วย</label><textarea id="vS" rows="2" maxlength="4000">${val('subjective')}</textarea></div>`
    + `<div class="field full"><label for="vO">O — ข้อมูลตรวจพบ (Objective data)</label><textarea id="vO" rows="2" maxlength="4000" placeholder="เช่น สภาพทั่วไป อาการแสดง ผลตรวจ การใช้ยาที่สังเกตได้">${val('objective')}</textarea></div>`
    + `<div class="field full"><label for="vA">A — การประเมิน (Assessment)</label><textarea id="vA" rows="2" maxlength="4000" placeholder="เช่น ความร่วมมือในการใช้ยา การควบคุมโรค ปัญหาที่พบโดยสรุป">${val('assessment')}</textarea></div>`
    + '<fieldset class="field full drp-box"><legend>Medication reconciliation</legend><div class="field"><label>รายการยาที่เหลือ</label><div id="vMeds" class="med-rows"></div><div><button type="button" class="btn btn-o btn-sm" data-act="add-med">+ เพิ่มรายการยา</button></div></div>'
    + `<div class="field"><label for="vMedNote">หมายเหตุรายการยาที่เหลือ</label><textarea id="vMedNote" rows="2" maxlength="2000" placeholder="เช่น ยาเก็บในตู้เย็น, ผู้ป่วยแบ่งยาให้ญาติ, ยาเสื่อมสภาพ">${val('med_note')}</textarea></div>`
    + `<label class="small"><input type="checkbox" id="vExcess"${v?.med_excess ? ' checked' : ''}> ยาเหลือค้างที่บ้านเกินวันนัด 1 เดือน</label></fieldset>`
    + `<fieldset class="field full drp-box"><legend>ปัญหาจากการใช้ยา (DRPs)</legend><label class="small"><input type="checkbox" id="vNoDrp"${drps.size ? '' : ' checked'}> ไม่พบ DRPs</label>`
    + `<div id="vDrpList" class="drp-list">${DRP_CATS.map((c, i) => `<label class="small"><input type="checkbox" data-drp="${i}"${drps.has(c) ? ' checked' : ''}> ${esc(c)}</label>`).join('')}</div>`
    + `<textarea id="vDrpDetail" rows="2" maxlength="4000" placeholder="รายละเอียดปัญหาและการแก้ไข">${val('drp_detail')}</textarea>`
    + `<label class="small"><input type="checkbox" id="vDrpResolved"${v?.drp_resolved ? ' checked' : ''}> แก้ไขปัญหาสำเร็จแล้ว</label></fieldset>`
    + `<div class="field full"><label for="vPlan">P — แผนการดูแล</label><textarea id="vPlan" rows="2" maxlength="4000">${val('plan')}</textarea></div>`
    + `<div class="field full"><label for="vPhotos">รูปถ่าย (ไม่เกิน ${MAX_PHOTOS} รูป · ย่อให้อัตโนมัติ)</label><input id="vPhotos" class="input" type="file" accept="image/*" multiple><span class="small muted" id="vPhotoNote">เช่น รูปยาที่เหลือ ฉลากยา สภาพที่เก็บยา · ห้ามถ่ายหน้าผู้ป่วยโดยไม่ได้รับอนุญาต</span><div class="fthumbs" id="vPhotoList"></div></div>`
    + '<div class="full row-btns" style="align-items:center"><button class="btn btn-p btn-sm" type="submit">บันทึก</button><button class="btn btn-o btn-sm" type="button" data-act="cancel">ยกเลิก</button><span class="small" id="vMsg" aria-live="polite"></span></div></form>';
}

/* ---------- รูปถ่ายในฟอร์มบันทึกเยี่ยม ---------- */
function renderPhotos() {
  const list = $('#vPhotoList'); if (!list) return;
  list.innerHTML = keptPhotos.map((p, i) => `<div class="fitem">${fileCard('visit-photos', p, `รูปเดิม ${i + 1}`)}<button type="button" class="btn btn-no btn-sm" data-rmphoto="${esc(p)}">ลบรูป</button></div>`).join('')
    + newPhotos.map((x, i) => `<div class="fitem"><figure class="fthumb"><img src="${x.url}" alt=""><figcaption>รูปใหม่ ${i + 1}</figcaption></figure><button type="button" class="btn btn-no btn-sm" data-rmnew="${i}">ลบรูป</button></div>`).join('');
  const n = keptPhotos.length + newPhotos.length;
  $('#vPhotos').disabled = n >= MAX_PHOTOS;
  $('#vPhotoNote').textContent = n ? `${n}/${MAX_PHOTOS} รูป${n >= MAX_PHOTOS ? ' · ครบแล้ว ลบรูปเดิมก่อนถ้าจะเพิ่ม' : ''}` : 'เช่น รูปยาที่เหลือ ฉลากยา สภาพที่เก็บยา · ห้ามถ่ายหน้าผู้ป่วยโดยไม่ได้รับอนุญาต';
  hydrateSigned(list);
}
async function addPhotos(input) {
  const files = [...input.files]; input.value = '';
  const room = MAX_PHOTOS - keptPhotos.length - newPhotos.length;
  if (files.length > room) toast(`เพิ่มได้อีก ${room} รูป (สูงสุด ${MAX_PHOTOS} รูปต่อครั้งที่เยี่ยม)`, 'err');
  $('#vPhotoNote').textContent = 'กำลังย่อรูป…';
  for (const f of files.slice(0, Math.max(0, room))) {
    try { const blob = await compressImage(f); newPhotos.push({ blob, url: URL.createObjectURL(blob) }); }
    catch (e) { toast(e.message, 'err'); }
  }
  renderPhotos();
}

function medRow(m = {}) {
  return `<div class="med-row"><input class="input med-name" placeholder="ชื่อยา" maxlength="120" value="${esc(m.name || '')}" aria-label="ชื่อยา">`
    + `<input class="input med-how" placeholder="วิธีใช้ เช่น 1 เม็ด เช้า-เย็น หลังอาหาร" maxlength="200" value="${esc(m.how || '')}" aria-label="วิธีใช้">`
    + `<input class="input med-qty" type="number" inputmode="numeric" min="0" step="1" placeholder="จำนวน" value="${esc(m.qty ?? '')}" aria-label="จำนวน">`
    + `<select class="input med-unit" aria-label="หน่วย">${[...MED_UNITS, ...(m.unit && !MED_UNITS.includes(m.unit) ? [m.unit] : [])].map((u) => `<option${m.unit === u ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select>`
    + '<button type="button" class="btn btn-no btn-sm" data-act="rm-med" aria-label="ลบรายการยา">✕</button></div>';
}
function fillMeds(list) { $('#vMeds').innerHTML = (list.length ? list : [{}]).map(medRow).join(''); }
function readMeds() {
  return [...document.querySelectorAll('#vMeds .med-row')].map((r) => ({
    name: r.querySelector('.med-name').value.trim(),
    how: r.querySelector('.med-how').value.trim() || null,
    qty: r.querySelector('.med-qty').value === '' ? null : Math.max(0, Math.round(+r.querySelector('.med-qty').value)),
    unit: r.querySelector('.med-unit').value,
  })).filter((m) => m.name);
}
function syncDrp() {
  const none = $('#vNoDrp').checked;
  document.querySelectorAll('#vDrpList input').forEach((c) => { c.disabled = none; if (none) c.checked = false; });
  $('#vDrpDetail').disabled = none; $('#vDrpResolved').disabled = none;
}

/* ---------- การกระทำ ---------- */
function bind() {
  $('#ptSearch').addEventListener('input', renderList);
  $('#ptList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pt]'); if (!b) return;
    if (selected?.id === b.dataset.pt && mode === 'view') { selected = null; visits = []; renderList(); renderPanel(); return; }   // กดซ้ำ = ย่อข้อมูลผู้ป่วย
    select(b.dataset.pt);
  });
  $('#ptAddBtn').addEventListener('click', () => { mode = 'patient-form'; editVisit = null; ptEdit = false; vOpen = false; renderPanel(); $('#pfFirst').focus(); });
  const panel = $('#ptPanel');
  panel.addEventListener('change', (e) => { if (e.target.id === 'vPhotos') { addPhotos(e.target); return; } if (e.target.id === 'vNoDrp') syncDrp(); if (e.target.dataset?.drp !== undefined && e.target.checked) { $('#vNoDrp').checked = false; syncDrp(); } });
  panel.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const fl = e.target.closest('[data-file]'); if (fl) { openPrivateFile(fl).catch((err) => toast(errText(err), 'err')); return; }
    const rp = e.target.closest('[data-rmphoto]'); if (rp) { keptPhotos = keptPhotos.filter((x) => x !== rp.dataset.rmphoto); renderPhotos(); return; }
    const rn = e.target.closest('[data-rmnew]'); if (rn) { const [x] = newPhotos.splice(+rn.dataset.rmnew, 1); URL.revokeObjectURL(x.url); renderPhotos(); return; }
    if (act === 'cancel') {
      if (e.target.closest('#vForm')) { vOpen = false; editVisit = null; renderVisitForm(); return; }
      if (mode === 'patient-form') { mode = 'view'; renderPanel(); return; }
      ptEdit = false; renderInfo(); return;
    }
    if (act === 'edit-patient') {
      if (!ptEdit) { ptEdit = true; renderInfo(); $('#pfFirst').focus(); return; }
      const f = $('#ptEditFold'); f.open = !f.open;   // กดซ้ำ = ย่อ/ขยายฟอร์มแก้ไข
      if (f.open) $('#pfFirst').focus();
      return;
    }
    if (act === 'add-visit') { openVisitForm(null); return; }
    if (act === 'add-med') { $('#vMeds').insertAdjacentHTML('beforeend', medRow()); $('#vMeds .med-row:last-child .med-name').focus(); return; }
    if (act === 'rm-med') { const r = e.target.closest('.med-row'); if ($('#vMeds').children.length > 1) r.remove(); else r.querySelectorAll('input').forEach((i) => { i.value = ''; }); return; }
    if (act === 'del-patient') {
      if (!confirm(`ลบผู้ป่วย ${selected.first_name} ${selected.last_name} และบันทึกการเยี่ยมทั้งหมด (${visits.length} ครั้ง)?\nลบแล้วกู้คืนไม่ได้`)) return;
      const { error } = await sb.from('patients').delete().eq('id', selected.id);
      if (error) { toast(errText(error), 'err'); return; }
      removeFiles('visit-photos', visits.flatMap((v) => v.photo_paths || []));
      selected = null; toast('ลบผู้ป่วยแล้ว'); loadPatients(); return;
    }
    const ev = e.target.closest('[data-edit-visit]');
    if (ev) { openVisitForm(visits.find((v) => v.id === ev.dataset.editVisit)); return; }
    const dv = e.target.closest('[data-del-visit]');
    if (dv) {
      const v = visits.find((x) => x.id === dv.dataset.delVisit);
      if (!confirm(`ลบบันทึกการเยี่ยมวันที่ ${thaiDate(v.visit_date)}?`)) return;
      const { error } = await sb.from('visits').delete().eq('id', v.id);
      if (error) { toast(errText(error), 'err'); return; }
      removeFiles('visit-photos', v.photo_paths || []);
      if (editVisit?.id === v.id) { vOpen = false; editVisit = null; renderVisitForm(); }
      toast('ลบบันทึกแล้ว'); reloadVisits();
    }
  });
  panel.addEventListener('submit', (e) => { e.preventDefault(); if (e.target.id === 'ptForm') savePatient(e.target); if (e.target.id === 'vForm') saveVisit(e.target); });
}

function openVisitForm(v) {
  vOpen = true; editVisit = v; renderVisitForm();
  $('#vFormSlot').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
/** โหลดรายการเยี่ยมของผู้ป่วยที่เลือกใหม่ (ไม่แตะฟอร์มแก้ไขข้อมูลผู้ป่วยที่เปิดค้างไว้) */
async function reloadVisits() {
  const { data } = await sb.from('visits').select('*').eq('patient_id', selected.id).order('visit_date', { ascending: false });
  visits = data || []; renderVisits();
}

async function savePatient(form) {
  const m = $('#pfMsg'), first = $('#pfFirst').value.trim(), last = $('#pfLast').value.trim();
  const nid = $('#pfNid').value.replace(/\D/g, '');
  const err = (t, el) => { m.style.color = 'var(--error)'; m.textContent = t; el?.setAttribute('aria-invalid', 'true'); el?.focus(); };
  if (!first) return err('กรุณากรอกชื่อ', $('#pfFirst'));
  if (!last) return err('กรุณากรอกนามสกุล', $('#pfLast'));
  if (nid && nid.length !== 13) return err('เลขประจำตัวประชาชนต้องมี 13 หลัก', $('#pfNid'));
  const dobText = $('#pfDob').value.trim(), dob = dobText ? parseDob(dobText) : null;
  if (dobText && !dob) return err('วันเกิดไม่ถูกต้อง — กรอกแบบ วัน/เดือน/ปี เช่น 12/5/1997', $('#pfDob'));
  if (dob && dob > today()) return err('วันเกิดต้องไม่เกินวันนี้', $('#pfDob'));
  const phone = $('#pfPhone').value.trim();
  if (phone && !PHONE_RE.test(phone)) return err('เบอร์โทรไม่ถูกต้อง (ตัวเลข 9–10 หลัก เช่น 0812345678)', $('#pfPhone'));
  const row = { first_name: first, last_name: last, national_id: nid || null, birth_date: dob,
    hn_hospital: $('#pfHnH').value.trim() || null, coverage: $('#pfCov').value || null,
    home_unit_id: $('#pfHome').value === '' ? null : +$('#pfHome').value, phone: phone || null, ...readAddr() };
  const editing = mode !== 'patient-form' && ptEdit && selected, isAdmin = auth.profile.role === 'admin';
  const target = row.home_unit_id, here = editing ? selected.unit_id : (unit === ALL ? target : isAdmin ? target ?? unit : unit);
  if (here == null) return err('กรุณาเลือกสังกัด รพ.สต.', $('#pfHome'));
  const moving = target != null && target !== here;   // สังกัดไม่ตรงกับหน่วยที่ดูแล → ย้ายไปหน่วยนั้น
  if (moving && !isAdmin && !confirm(`ย้าย ${first} ${last} ไปอยู่ในรายชื่อของ รพ.สต. ${unitName(target)}?\nหลังย้าย รพ.สต. นี้จะไม่เห็นข้อมูลและบันทึกเยี่ยมของผู้ป่วยรายนี้อีก`)) return;
  const btn = form.querySelector('[type=submit]'); busy(btn, true, 'กำลังบันทึก…');
  const save = moving ? { ...row, home_unit_id: here } : row;   // บันทึกในหน่วยเดิมก่อน แล้วค่อยย้าย
  const res = editing
    ? await sb.from('patients').update(save).eq('id', selected.id).select().single()
    : await sb.from('patients').insert({ ...save, unit_id: here }).select().single();
  if (res.error) { busy(btn, false); return err(errText(res.error)); }
  if (moving) {
    const { error } = await sb.rpc('transfer_patient', { p_patient: res.data.id, p_unit: target });
    if (error) { busy(btn, false); return err(`บันทึกแล้ว แต่ย้ายสังกัดไม่สำเร็จ: ${errText(error)}`); }
  }
  busy(btn, false);
  toast(moving ? `${editing ? 'บันทึกแล้ว · ' : 'เพิ่มผู้ป่วยแล้ว · '}ย้ายไปอยู่ รพ.สต. ${unitName(target)}` : editing ? 'บันทึกข้อมูลผู้ป่วยแล้ว' : 'เพิ่มผู้ป่วยแล้ว');
  if (editing && !moving) {   // แก้ข้อมูลอย่างเดียว → ย่อฟอร์ม ฟอร์มบันทึกเยี่ยมที่เปิดอยู่ยังค้างไว้
    selected = res.data; patients = patients.map((x) => (x.id === res.data.id ? res.data : x));
    ptEdit = false; renderList(); renderInfo(); return;
  }
  mode = 'view'; editVisit = null;
  await loadPatients();
  if (patients.some((x) => x.id === res.data.id)) select(res.data.id); else { selected = null; renderList(); renderPanel(); }
}

async function saveVisit(form) {
  const m = $('#vMsg'), date = $('#vDate').value;
  if (!date) { m.style.color = 'var(--error)'; m.textContent = 'กรุณาเลือกวันที่เยี่ยม'; return; }
  if (date > today()) { m.style.color = 'var(--error)'; m.textContent = 'วันที่เยี่ยมต้องไม่เกินวันนี้'; return; }
  const none = $('#vNoDrp').checked;
  const drps = none ? [] : [...document.querySelectorAll('#vDrpList input:checked')].map((c) => DRP_CATS[+c.dataset.drp]);
  if (!none && !drps.length) { m.style.color = 'var(--error)'; m.textContent = 'เลือกประเภท DRPs อย่างน้อย 1 ข้อ หรือติ๊ก "ไม่พบ DRPs"'; return; }
  const num = (id) => ($(id).value === '' ? null : +$(id).value);
  const row = { patient_id: selected.id, visit_date: date, age: num('#vAge'), weight: num('#vWeight'), bp: $('#vBp').value.trim() || null,
    dtx: $('#vDtx').value.trim() || null, subjective: $('#vS').value.trim() || null, objective: $('#vO').value.trim() || null, assessment: $('#vA').value.trim() || null, pulse: num('#vPulse'),
    med_list: readMeds(), med_note: $('#vMedNote').value.trim() || null, med_excess: $('#vExcess').checked,
    drps, drp_detail: none ? null : ($('#vDrpDetail').value.trim() || null), drp_resolved: none ? false : $('#vDrpResolved').checked,
    plan: $('#vPlan').value.trim() || null };
  const btn = form.querySelector('[type=submit]'); busy(btn, true, newPhotos.length ? 'กำลังอัปโหลดรูป…' : 'กำลังบันทึก…');
  const uploaded = [];
  let res;
  try {
    for (const x of newPhotos) uploaded.push(await uploadVisitPhoto(x.blob, selected.unit_id, selected.id));
    row.photo_paths = [...keptPhotos, ...uploaded];
    res = editVisit
      ? await sb.from('visits').update(row).eq('id', editVisit.id).select()
      : await sb.from('visits').insert({ ...row, unit_id: selected.unit_id }).select();   // หน่วยของผู้ป่วย (ผู้ดูแลอาจอยู่ช่อง "รวมทุกชื่อ")
    if (res.error) throw res.error;
  } catch (err) {
    removeFiles('visit-photos', uploaded); busy(btn, false);
    m.style.color = 'var(--error)'; m.textContent = errText(err); return;
  }
  busy(btn, false);
  if (editVisit) removeFiles('visit-photos', (editVisit.photo_paths || []).filter((p) => !keptPhotos.includes(p)));
  toast(`บันทึกการเยี่ยมแล้ว (ปีงบ ${fiscalYearOf(date)})`);
  vOpen = false; editVisit = null; renderVisitForm(); reloadVisits();
}
