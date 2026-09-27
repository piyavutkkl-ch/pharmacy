// เจ้าหน้าที่: เยี่ยมบ้าน — ผู้ป่วยของ รพ.สต. ตัวเอง + บันทึกการเยี่ยม (SOAP, รายการยา, DRPs)
// ข้อมูลอ่อนไหว: RLS ให้เห็นเฉพาะ รพ.สต. เดียวกัน + ผู้ดูแล · ทุกการเพิ่ม/แก้/ลบถูกบันทึกใน audit_log
import { sb } from '../supabase.js?v=4.3';
import { $, esc, thaiDate, initials, toast, errText, busy, fiscalYearOf } from '../util.js?v=4.3';
import { auth } from '../auth.js?v=4.3';

export const DRP_CATS = [
  'ได้รับยาที่ไม่จำเป็น (Unnecessary drug therapy)', 'ควรได้รับยาเพิ่มเติม (Needs additional therapy)',
  'ยาไม่ได้ผล/ไม่เหมาะสมกับอาการ (Ineffective drug)', 'ขนาดยาต่ำเกินไป (Dosage too low)', 'ขนาดยาสูงเกินไป (Dosage too high)',
  'เกิดอาการไม่พึงประสงค์จากยา (Adverse drug reaction)', 'ไม่ให้ความร่วมมือในการใช้ยา (Non-adherence)',
];
const COVERAGE = ['บัตรทอง (สปสช.)', 'ข้าราชการ/รัฐวิสาหกิจ', 'ประกันสังคม', 'ประชาชนทั่วไป', 'อื่นๆ'];
const MED_UNITS = ['เม็ด', 'แคปซูล', 'ซอง', 'ขวด', 'แผง', 'มล.', 'หลอด', 'อื่นๆ'];

let patients = [], selected = null, visits = [], mode = 'view', editVisit = null, ws = null, unit = null;
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const maskId = (id) => (id ? `x-xxxx-xxxxx-${id.slice(10, 12)}-${id.slice(12)}` : '–');
const age = (dob) => { if (!dob) return ''; const d = new Date(dob), n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--; return a; };

const WS_HTML = `<div class="split">
  <div class="panel">
    <div class="panel-head"><h2>ผู้ป่วยในความดูแล <span class="num muted" id="ptCount"></span></h2><button type="button" class="btn btn-p btn-sm" id="ptAddBtn">+ เพิ่มผู้ป่วย</button></div>
    <label for="ptSearch" class="sr-only">ค้นหาผู้ป่วย</label>
    <input id="ptSearch" class="input" type="search" placeholder="ค้นหาชื่อ / HN / เลข 13 หลัก">
    <div class="list" id="ptList"></div>
  </div>
  <div class="panel" id="ptPanel"></div>
</div>`;

/** แสดงหน้าจอเยี่ยมบ้านของ รพ.สต. unitId ลงใน slot (เจ้าหน้าที่ = หน่วยตัวเอง, ผู้ดูแล = เลือกหน่วย) */
export async function mountVisits(slot, unitId) {
  if (!ws) { ws = document.createElement('div'); ws.innerHTML = WS_HTML; slot.appendChild(ws); bind(); }
  else if (ws.parentNode !== slot) slot.appendChild(ws);
  if (unit !== unitId) { unit = unitId; selected = null; mode = 'view'; editVisit = null; $('#ptSearch').value = ''; }
  await loadPatients();
}
export const initVisits = () => mountVisits($('#staffVisitsSlot'), auth.profile.unit_id);

async function loadPatients() {
  $('#ptList').innerHTML = '<div class="skeleton" style="margin-top:8px"></div>';
  const { data, error } = await sb.from('patients').select('*').eq('unit_id', unit).order('first_name');
  if (error) { $('#ptList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  patients = data;
  if (selected) selected = patients.find((p) => p.id === selected.id) || null;
  renderList(); renderPanel();
}

function renderList() {
  const q = $('#ptSearch').value.trim().toLowerCase();
  const list = patients.filter((p) => !q || `${p.first_name} ${p.last_name} ${p.hn_unit || ''} ${p.hn_hospital || ''} ${p.national_id || ''}`.toLowerCase().includes(q));
  $('#ptCount').textContent = `(${patients.length})`;
  $('#ptList').innerHTML = list.length ? list.map((p) => `<button type="button" class="li-btn${selected?.id === p.id ? ' sel' : ''}" data-pt="${p.id}">`
    + `<span style="display:flex;align-items:center;gap:10px;min-width:0"><span class="avatar" style="width:34px;height:34px;font-size:12px">${esc(initials(p.first_name + ' ' + p.last_name))}</span>`
    + `<span class="l"><b>${esc(p.first_name)} ${esc(p.last_name)}</b><span class="small muted">HN รพ.สต. ${esc(p.hn_unit || '–')}${p.birth_date ? ' · ' + age(p.birth_date) + ' ปี' : ''}</span></span></span></button>`).join('')
    : `<p class="empty">${patients.length ? 'ไม่พบผู้ป่วยที่ค้นหา' : 'ยังไม่มีผู้ป่วย · กด "เพิ่มผู้ป่วย" เพื่อเริ่ม'}</p>`;
}

async function select(id) {
  selected = patients.find((p) => p.id === id) || null; mode = 'view'; editVisit = null;
  renderList(); $('#ptPanel').innerHTML = '<div class="skeleton"></div>';
  const { data } = await sb.from('visits').select('*').eq('patient_id', id).order('visit_date', { ascending: false });
  visits = data || [];
  renderPanel();
  if (matchMedia('(max-width:819px)').matches) $('#ptPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- แผงขวา ---------- */
function renderPanel() {
  const el = $('#ptPanel');
  if (mode === 'patient-form') { el.innerHTML = patientForm(mode === 'patient-form' && editVisit === 'edit-patient' ? selected : null); return; }
  if (mode === 'visit-form') { el.innerHTML = visitForm(editVisit); fillMeds(editVisit?.med_list || []); syncDrp(); return; }
  if (!selected) { el.innerHTML = '<p class="empty">เลือกผู้ป่วยจากรายการ หรือกด "เพิ่มผู้ป่วย"</p>'; return; }
  const p = selected;
  el.innerHTML = `<div class="panel-head"><h2>${esc(p.first_name)} ${esc(p.last_name)}</h2><div class="row-btns">`
    + '<button type="button" class="btn btn-o btn-sm" data-act="edit-patient">แก้ไขข้อมูล</button><button type="button" class="btn btn-no btn-sm" data-act="del-patient">ลบ</button></div></div>'
    + `<dl class="kv"><dt>เลข 13 หลัก</dt><dd>${esc(maskId(p.national_id))}</dd><dt>วันเกิด</dt><dd>${p.birth_date ? esc(thaiDate(p.birth_date)) + ` (${age(p.birth_date)} ปี)` : '–'}</dd>`
    + `<dt>HN รพ.</dt><dd>${esc(p.hn_hospital || '–')}</dd><dt>HN รพ.สต.</dt><dd>${esc(p.hn_unit || '–')}</dd><dt>สิทธิ</dt><dd>${esc(p.coverage || '–')}</dd></dl>`
    + `<div class="panel-head"><h2>บันทึกการเยี่ยม (${visits.length})</h2><button type="button" class="btn btn-p btn-sm" data-act="add-visit">+ บันทึกการเยี่ยม</button></div>`
    + '<div class="list">' + (visits.length ? visits.map((v) => {
      const meds = (v.med_list || []).map((m) => `${m.name}${m.qty ? ` (${m.qty} ${m.unit || ''})` : ''}`).join(', ');
      const drp = v.drps?.length ? `DRPs ${v.drps.length} ข้อ${v.drp_resolved ? ' · แก้ไขสำเร็จ' : ' · ยังไม่แก้ไข'}` : 'ไม่พบ DRPs';
      return `<div class="li"><div class="l"><b>เยี่ยมวันที่ ${esc(thaiDate(v.visit_date))} <span class="small muted">· ปีงบ ${v.fiscal_year}</span></b>`
        + (v.subjective ? `<span class="small muted">S: ${esc(v.subjective.slice(0, 80))}</span>` : '')
        + `<span class="small">${esc(drp)}</span>`
        + (meds ? `<span class="small muted">ยาที่เหลือ: ${esc(meds)}</span>` : '')
        + (v.med_excess ? '<span class="small" style="color:var(--warning)">ยาเหลือค้างที่บ้านเกิน 1 เดือน</span>' : '')
        + (v.next_appt ? `<span class="small muted">นัดครั้งถัดไป ${esc(thaiDate(v.next_appt))}</span>` : '')
        + `</div><div class="row-btns"><button type="button" class="btn btn-o btn-sm" data-edit-visit="${v.id}">แก้ไข</button><button type="button" class="btn btn-no btn-sm" data-del-visit="${v.id}">ลบ</button></div></div>`;
    }).join('') : '<p class="empty">ยังไม่มีบันทึกการเยี่ยม</p>') + '</div>';
}

function patientForm(p) {
  const v = (k) => esc(p?.[k] || '');
  return `<h2>${p ? 'แก้ไขข้อมูลผู้ป่วย' : 'เพิ่มผู้ป่วยใหม่'}</h2><form id="ptForm" class="form-grid" novalidate>`
    + `<div class="field"><label for="pfFirst">ชื่อ <span class="req">*</span></label><input id="pfFirst" class="input" maxlength="80" value="${v('first_name')}"></div>`
    + `<div class="field"><label for="pfLast">นามสกุล <span class="req">*</span></label><input id="pfLast" class="input" maxlength="80" value="${v('last_name')}"></div>`
    + `<div class="field"><label for="pfNid">เลขประจำตัวประชาชน 13 หลัก</label><input id="pfNid" class="input" inputmode="numeric" maxlength="17" value="${v('national_id')}"></div>`
    + `<div class="field"><label for="pfDob">วันเกิด</label><input id="pfDob" class="input" type="date" max="${today()}" value="${v('birth_date')}"></div>`
    + `<div class="field"><label for="pfHnH">HN โรงพยาบาล</label><input id="pfHnH" class="input" maxlength="30" value="${v('hn_hospital')}"></div>`
    + `<div class="field"><label for="pfHnU">HN รพ.สต.</label><input id="pfHnU" class="input" maxlength="30" value="${v('hn_unit')}"></div>`
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
    + `<div class="field"><label for="vNext">นัดครั้งถัดไป</label><input id="vNext" class="input" type="date" value="${val('next_appt')}"></div>`
    + `<div class="field full"><label for="vS">S — อาการ/ข้อมูลจากผู้ป่วย</label><textarea id="vS" rows="2" maxlength="4000">${val('subjective')}</textarea></div>`
    + `<div class="field full"><label for="vRecon">Medication reconciliation</label><textarea id="vRecon" rows="2" maxlength="4000">${val('med_reconcile')}</textarea></div>`
    + '<div class="field full"><label>รายการยาที่เหลือ</label><div id="vMeds" class="med-rows"></div><div><button type="button" class="btn btn-o btn-sm" data-act="add-med">+ เพิ่มรายการยา</button></div></div>'
    + `<div class="field"><label for="vMedUntil">ยาพอถึงวันที่</label><input id="vMedUntil" class="input" type="date" value="${val('med_until')}"></div>`
    + `<label class="small full"><input type="checkbox" id="vExcess"${v?.med_excess ? ' checked' : ''}> ยาเหลือค้างที่บ้านเกิน 1 เดือน</label>`
    + `<fieldset class="field full drp-box"><legend>A — ปัญหาจากการใช้ยา (DRPs)</legend><label class="small"><input type="checkbox" id="vNoDrp"${drps.size ? '' : ' checked'}> ไม่พบ DRPs</label>`
    + `<div id="vDrpList" class="drp-list">${DRP_CATS.map((c, i) => `<label class="small"><input type="checkbox" data-drp="${i}"${drps.has(c) ? ' checked' : ''}> ${esc(c)}</label>`).join('')}</div>`
    + `<textarea id="vDrpDetail" rows="2" maxlength="4000" placeholder="รายละเอียดปัญหาและการแก้ไข">${val('drp_detail')}</textarea>`
    + `<label class="small"><input type="checkbox" id="vDrpResolved"${v?.drp_resolved ? ' checked' : ''}> แก้ไขปัญหาสำเร็จแล้ว</label></fieldset>`
    + `<div class="field full"><label for="vPlan">P — แผนการดูแล</label><textarea id="vPlan" rows="2" maxlength="4000">${val('plan')}</textarea></div>`
    + '<div class="full row-btns" style="align-items:center"><button class="btn btn-p btn-sm" type="submit">บันทึก</button><button class="btn btn-o btn-sm" type="button" data-act="cancel">ยกเลิก</button><span class="small" id="vMsg" aria-live="polite"></span></div></form>';
}

function medRow(m = {}) {
  return `<div class="med-row"><input class="input med-name" placeholder="ชื่อยา" maxlength="120" value="${esc(m.name || '')}" aria-label="ชื่อยา">`
    + `<input class="input med-qty" type="number" inputmode="numeric" min="0" step="1" placeholder="จำนวน" value="${esc(m.qty ?? '')}" aria-label="จำนวน">`
    + `<select class="input med-unit" aria-label="หน่วย">${MED_UNITS.map((u) => `<option${m.unit === u ? ' selected' : ''}>${u}</option>`).join('')}</select>`
    + '<button type="button" class="btn btn-no btn-sm" data-act="rm-med" aria-label="ลบรายการยา">✕</button></div>';
}
function fillMeds(list) { $('#vMeds').innerHTML = (list.length ? list : [{}]).map(medRow).join(''); }
function readMeds() {
  return [...document.querySelectorAll('#vMeds .med-row')].map((r) => ({
    name: r.querySelector('.med-name').value.trim(),
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
  $('#ptList').addEventListener('click', (e) => { const b = e.target.closest('[data-pt]'); if (b) select(b.dataset.pt); });
  $('#ptAddBtn').addEventListener('click', () => { mode = 'patient-form'; editVisit = null; renderPanel(); $('#pfFirst').focus(); });
  const panel = $('#ptPanel');
  panel.addEventListener('change', (e) => { if (e.target.id === 'vNoDrp') syncDrp(); if (e.target.dataset?.drp !== undefined && e.target.checked) { $('#vNoDrp').checked = false; syncDrp(); } });
  panel.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') { mode = 'view'; editVisit = null; renderPanel(); return; }
    if (act === 'edit-patient') { mode = 'patient-form'; editVisit = 'edit-patient'; renderPanel(); return; }
    if (act === 'add-visit') { mode = 'visit-form'; editVisit = null; renderPanel(); return; }
    if (act === 'add-med') { $('#vMeds').insertAdjacentHTML('beforeend', medRow()); $('#vMeds .med-row:last-child .med-name').focus(); return; }
    if (act === 'rm-med') { const r = e.target.closest('.med-row'); if ($('#vMeds').children.length > 1) r.remove(); else r.querySelectorAll('input').forEach((i) => { i.value = ''; }); return; }
    if (act === 'del-patient') {
      if (!confirm(`ลบผู้ป่วย ${selected.first_name} ${selected.last_name} และบันทึกการเยี่ยมทั้งหมด (${visits.length} ครั้ง)?\nลบแล้วกู้คืนไม่ได้`)) return;
      const { error } = await sb.from('patients').delete().eq('id', selected.id);
      if (error) { toast(errText(error), 'err'); return; }
      selected = null; toast('ลบผู้ป่วยแล้ว'); loadPatients(); return;
    }
    const ev = e.target.closest('[data-edit-visit]');
    if (ev) { mode = 'visit-form'; editVisit = visits.find((v) => v.id === ev.dataset.editVisit); renderPanel(); return; }
    const dv = e.target.closest('[data-del-visit]');
    if (dv) {
      const v = visits.find((x) => x.id === dv.dataset.delVisit);
      if (!confirm(`ลบบันทึกการเยี่ยมวันที่ ${thaiDate(v.visit_date)}?`)) return;
      const { error } = await sb.from('visits').delete().eq('id', v.id);
      if (error) { toast(errText(error), 'err'); return; }
      toast('ลบบันทึกแล้ว'); select(selected.id);
    }
  });
  panel.addEventListener('submit', (e) => { e.preventDefault(); if (e.target.id === 'ptForm') savePatient(e.target); if (e.target.id === 'vForm') saveVisit(e.target); });
}

async function savePatient(form) {
  const m = $('#pfMsg'), first = $('#pfFirst').value.trim(), last = $('#pfLast').value.trim();
  const nid = $('#pfNid').value.replace(/\D/g, '');
  const err = (t, el) => { m.style.color = 'var(--error)'; m.textContent = t; el?.setAttribute('aria-invalid', 'true'); el?.focus(); };
  if (!first) return err('กรุณากรอกชื่อ', $('#pfFirst'));
  if (!last) return err('กรุณากรอกนามสกุล', $('#pfLast'));
  if (nid && nid.length !== 13) return err('เลขประจำตัวประชาชนต้องมี 13 หลัก', $('#pfNid'));
  const row = { first_name: first, last_name: last, national_id: nid || null, birth_date: $('#pfDob').value || null,
    hn_hospital: $('#pfHnH').value.trim() || null, hn_unit: $('#pfHnU').value.trim() || null, coverage: $('#pfCov').value || null };
  const btn = form.querySelector('[type=submit]'); busy(btn, true, 'กำลังบันทึก…');
  const editing = editVisit === 'edit-patient' && selected;
  const res = editing
    ? await sb.from('patients').update(row).eq('id', selected.id).select().single()
    : await sb.from('patients').insert({ ...row, unit_id: unit }).select().single();
  busy(btn, false);
  if (res.error) return err(errText(res.error));
  toast(editing ? 'บันทึกข้อมูลผู้ป่วยแล้ว' : 'เพิ่มผู้ป่วยแล้ว');
  mode = 'view'; editVisit = null;
  await loadPatients(); select(res.data.id);
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
    dtx: $('#vDtx').value.trim() || null, subjective: $('#vS').value.trim() || null, med_reconcile: $('#vRecon').value.trim() || null,
    med_list: readMeds(), med_excess: $('#vExcess').checked, med_until: $('#vMedUntil').value || null, next_appt: $('#vNext').value || null,
    drps, drp_detail: none ? null : ($('#vDrpDetail').value.trim() || null), drp_resolved: none ? false : $('#vDrpResolved').checked,
    plan: $('#vPlan').value.trim() || null };
  const btn = form.querySelector('[type=submit]'); busy(btn, true, 'กำลังบันทึก…');
  const res = editVisit
    ? await sb.from('visits').update(row).eq('id', editVisit.id).select()
    : await sb.from('visits').insert({ ...row, unit_id: unit }).select();
  busy(btn, false);
  if (res.error) { m.style.color = 'var(--error)'; m.textContent = errText(res.error); return; }
  toast(`บันทึกการเยี่ยมแล้ว (ปีงบ ${fiscalYearOf(date)})`);
  mode = 'view'; editVisit = null; select(selected.id);
}
