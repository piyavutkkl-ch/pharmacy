// ข้อมูลยา / คำนวณขนาดยา — 4 ส่วน (#doseTabs): คำนวณขนาดยา · ข้อมูลยา · คำนวณสารน้ำ (fluid.js) · Drug interaction (ddi.js)
//   คำนวณขนาดยา: อายุ/น้ำหนัก (บังคับ)/ส่วนสูง · รายชื่อยา = ยา รพ.สต. ที่มีข้อมูลคำนวณ (dose_drugs ผูกเอง local_drugs.dose_id หรือจับคู่ชื่อ) · ความแรง = ยา รพ.สต. (local_drugs.strength หรืออ่านจากชื่อ)
//               ไต: CrCl Cockcroft-Gault (MDCalc · ส่วนสูง → IBW/AdjBW) หรือ eGFR CKD-EPI 2021 (เด็ก = Bedside Schwartz) · 60_drug_calc_th.sql
//   ข้อมูลยา: ตัวกรองแหล่งข้อมูล #doseScope (ทั้งหมด / ยา รพ.สต. [ค่าเริ่ม] / บัญชียาหลัก) — รายการยา รพ.สต. อ.ควนกาหลง (local_drugs · 58_local_drugs.sql) · บัญชียาหลักแห่งชาติ 2569 (drug_monographs · 57)
//            ยา รพ.สต. ผูกกับ monograph ผ่าน local_drugs.mono_refs → drug_monographs.ref · ผู้ดูแลแก้ทั้งสองฐานใน ตั้งค่า › ฐานข้อมูลยา (admin-drugs.js)
//            ฉลากยาสหรัฐฯ openFDA (drug_fda_labels · 59_fda_labels.sql) ผ่าน local_drugs.fda_key · ภาษาอังกฤษ
//            ค้นหา/กรองหมวด → เลือกยา → กลุ่มยา รูปแบบยา บัญชี เงื่อนไข คำเตือน คำแนะนำ หมายเหตุ + ขนาดยาจากเครื่องคำนวณ (จับคู่ชื่ออังกฤษ)
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, errText } from '../util.js?v=4.4';
import { isAdmin } from '../auth.js?v=4.4';
import { estimateWeight } from '../growth.js?v=4.4';
import { renderGrowth } from './growth-chart.js?v=4.4';
import { initFluid } from './fluid.js?v=4.4';
import { initDdi, resetDdi } from './ddi.js?v=4.4';

let drugs = null, bound = false;
let monos = null, locals = null, items = null, litems = [], scope = 'local', shown = 40;   // ข้อมูลยา: โหลดเมื่อเปิดส่วนข้อมูลยา

/** ให้โหลดรายการยาใหม่ครั้งถัดไป (เรียกหลังผู้ดูแลแก้รายการยา) */
export function resetDose() { drugs = null; items = null; }
/** ให้โหลดข้อมูลยา (บัญชียาหลัก + ยา รพ.สต.) ใหม่ครั้งถัดไป (เรียกหลังผู้ดูแลแก้ฐานข้อมูลยา) */
export function resetDrugInfo() { monos = null; locals = null; items = null; drugs = null; resetDdi(); }

export async function initDose() {
  if (drugs) return;
  const sel = $('#doseDrug');
  sel.innerHTML = '<option>กำลังโหลด…</option>';
  const { data, error } = await sb.from('dose_drugs').select('*').eq('active', true).order('sort');
  drugs = error ? [] : data; items = null;
  await loadInfo();   // รายการยา รพ.สต. → รายชื่อยาและความแรงในเครื่องคำนวณ
  fillDrugs(); fillConc(); toggleRenal(); render();
  if (!$('#dosePaneInfo').hidden) openInfo();
  if (bound) return;
  bound = true;
  ['doseWeight', 'doseHeight', 'doseAge', 'doseCr'].forEach((id) => $('#' + id).addEventListener('input', render));
  ['doseConc', 'doseRenal', 'doseSex', 'doseRenalMethod', 'doseAgeUnit', 'doseCrUnit'].forEach((id) => $('#' + id).addEventListener('change', render));
  $('#doseEst').addEventListener('click', (e) => { const b = e.target.closest('[data-use-weight]'); if (b) { $('#doseWeight').value = b.dataset.useWeight; render(); } });
  sel.addEventListener('change', () => { fillConc(); render(); });
  $('#doseRenalAdjust').addEventListener('change', () => { toggleRenal(); render(); });
  $('#doseTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-dt]'); if (b) showTab(b.dataset.dt); });
  $('#doseInfoQ').addEventListener('input', () => { shown = 40; renderList(); });
  $('#doseInfoGroup').addEventListener('change', () => { shown = 40; renderList(); });
  $('#doseInfoMore').addEventListener('click', () => { shown += 60; renderList(); });
  $('#doseInfoList').addEventListener('click', (e) => { const b = e.target.closest('[data-mono]'); if (b) openMono((b.dataset.scope === 'local' ? litems : items)[+b.dataset.mono]); });
  $('#doseScope').addEventListener('change', () => { scope = $('#doseScope').value; shown = 40; fillGroups(); renderList(); });
  $('#doseMono').addEventListener('click', (e) => {
    if (e.target.closest('[data-mono-back]')) { closeMono(); return; }
    const ed = e.target.closest('[data-edit-drug]');   // ผู้ดูแล: ไปแก้ข้อมูลนี้ใน ตั้งค่า › ฐานข้อมูลยา
    if (ed) { try { sessionStorage.setItem('pcps_drug_edit', ed.dataset.editDrug); } catch { /* ไม่เป็นไร */ } return; }
    const b = e.target.closest('[data-dose-calc]'); if (!b) return;
    $('#doseDrug').value = b.dataset.doseCalc; fillConc(b.dataset.local); render(); showTab('calc');
    $('#doseWeight').focus();
  });
}

/* ---------- เครื่องคำนวณ: รายชื่อยา + ความแรง ตามรายการยา รพ.สต. ---------- */
/** ยา รพ.สต. ที่ใช้ข้อมูลคำนวณ k (ผูกเอง dose_id หรือจับคู่ชื่อยาอัตโนมัติ) */
const localsOf = (k) => litems.filter((it) => it.dose.includes(k));
/** ชื่อยาที่บอกความแรงหลายสาร เช่น "400/80 MG", "875 MG/125 MG", "200/40 MG/5 ML" → อ่านจากชื่อไม่ได้ ต้องกรอกสารสำคัญทีละตัว (audit F-03) */
const COMBO = /\d(?:\.\d+)?\s*(?:MG|MCG)?\s*[/+]\s*\d+(?:\.\d+)?\s*(?:MG|MCG|G)\b/i;
export const comboName = (name) => COMBO.test(String(name || ''));
/** ความแรงของยา รพ.สต.: สารสำคัญ (ingredients) → กรอกเองใน ตั้งค่า (strength) → อ่านจากชื่อยา เช่น "500 MG" / "400MG/20ML" (ยกเว้นชื่อยาสูตรผสม = null) */
export function strengthOf(l) {
  const ing = (l.ingredients || []).filter((x) => x && +x.mg > 0);   // ยาสูตรผสม (66_combo_drugs.sql): ปริมาณสารสำคัญแต่ละตัวต่อหน่วย
  if (ing.length) return { mg: +ing[0].mg, per: ing[0].per || 'tab', ings: ing.map((x) => ({ name: x.name, mg: +x.mg })) };
  const s = l.strength;
  if (s && +s.mg > 0) return { mg: +s.mg, per: s.per || 'tab' };
  if (comboName(l.name)) return null;   // ไม่เดาว่าเลขไหนเป็นของสารใด
  const name = String(l.name || ''), liquid = /(\d+(?:\.\d+)?)\s*MG\s*\/\s*(\d+(?:\.\d+)?)\s*M/i.exec(name);
  if (liquid) return +liquid[2] === 5 ? { mg: +liquid[1], per: '5ml' } : { mg: +liquid[1] / +liquid[2], per: 'ml' };
  const tab = /(\d+(?:\.\d+)?)\s*(MG|MCG)\b/i.exec(name);
  if (tab && /TAB|CAP/i.test(`${l.unit} ${name}`)) return { mg: tab[2].toUpperCase() === 'MCG' ? +tab[1] / 1000 : +tab[1], per: 'tab' };
  return null;
}
const PER = { tab: 'มก./เม็ด', '5ml': 'มก./5 มล.', ml: 'มก./มล.' };
const concOf = (st, label) => ({ label, ...(st.per === '5ml' ? { mgPer5ml: st.mg } : st.per === 'ml' ? { mgPerMl: st.mg } : { mgPerTab: st.mg }), ...(st.ings?.length > 1 ? { ings: st.ings, per: st.per } : {}) });
const mgText = (st) => (st.ings?.length > 1 ? `${st.ings.map((x) => num(x.mg)).join('/')} ${PER[st.per]} (${st.ings.map((x) => x.name).join(' + ')})` : `${num(st.mg)} ${PER[st.per]}`);
/** สารสำคัญที่ข้อบ่งใช้นี้ใช้คิดขนาดยา (basis) ในยาสูตรผสม */
const basisOf = (ings, basis) => { const b = String(basis || '').trim().toLowerCase(); return b ? ings.find((x) => { const n = x.name.toLowerCase(); return n === b || n.startsWith(b) || b.startsWith(n); }) : null; };
let calcList = [];   // ดัชนียาใน drugs ที่แสดงในเครื่องคำนวณ
function fillDrugs() {
  const sel = $('#doseDrug');
  calcList = drugs.map((d, k) => k).filter((k) => localsOf(k).length);
  if (!calcList.length && !litems.length) calcList = drugs.map((d, k) => k);   // ยังไม่มีรายการยา รพ.สต. = ใช้ทุกตัว
  const waiting = litems.filter((it) => !it.dose.length && /เม็ด|แคปซูล|น้ำรับประทาน|ผง/.test(it.loc.category)).length;
  sel.innerHTML = calcList.length ? calcList.map((k) => `<option value="${k}">${esc(drugs[k].name)}</option>`).join('') : '<option value="">ยังไม่มีรายการยา</option>';
  $('#doseDrugNote').innerHTML = litems.length ? `รายการยาตามยา รพ.สต. ที่มีข้อมูลขนาดยาแล้ว ${calcList.length} รายการ${waiting ? ` · ยารับประทานอีก ${waiting} รายการรอข้อมูลขนาดยา` : ''}`
    + (waiting && isAdmin() ? ' · <a href="#/admin/drugs/ai">ตรวจร่างขนาดยาจาก AI</a>' : '') : '';
}
const inCalc = (k) => calcList.includes(+k);
function drug() { return drugs?.[+$('#doseDrug').value || 0]; }
/** ความแรง = ยา รพ.สต. ที่ผูกกับยานี้ (เลือกรายการ local ได้) · ไม่มีความแรงจากยา รพ.สต. เลย = ใช้ความแรงทั่วไปของข้อมูลคำนวณ */
function fillConc(pick) {
  const k = +$('#doseDrug').value || 0, d = drug();
  const ls = localsOf(k).map((it) => ({ it, st: strengthOf(it.loc) }));
  const known = ls.filter((x) => x.st);
  const opts = known.map((x) => `<option value="l:${litems.indexOf(x.it)}">${esc(x.it.loc.name)} · ${esc(mgText(x.st))}</option>`)
    + ls.filter((x) => !x.st).map((x) => `<option disabled>${esc(x.it.loc.name)} · ${comboName(x.it.loc.name) ? 'ยาสูตรผสม รอผู้ดูแลกรอกสารสำคัญแต่ละตัว' : 'ยังไม่ระบุความแรง'}</option>`).join('');
  const fallback = !known.length ? (d?.concs || []).map((c, i) => `<option value="c:${i}">${esc(c.label)} (ความแรงทั่วไป)</option>`).join('') : '';
  $('#doseConc').innerHTML = (Array.isArray(opts) ? opts.join('') : opts) + fallback;
  if (pick != null && [...$('#doseConc').options].some((o) => o.value === `l:${pick}`)) $('#doseConc').value = `l:${pick}`;
}
function conc() {
  const v = $('#doseConc').value || '', d = drug();
  if (v.startsWith('l:')) {
    const it = litems[+v.slice(2)], st = it && strengthOf(it.loc);
    if (!st) return null;
    const c = concOf(st, `${it.loc.name} ${mgText(st)}`), ing = (it.loc.ingredients || []).find((x) => x.dose_id && x.dose_id === d?.id);
    if (ing && c.ings) c.fixed = ing.name;   // ผูกข้อมูลคำนวณไว้กับสารนี้ = คิดจากสารนี้เสมอ
    return c;
  }
  if (v.startsWith('c:')) return (d?.concs || [])[+v.slice(2)];
  return null;
}
function toggleRenal() {
  const on = $('#doseRenalAdjust').checked;
  $('#doseRenalManualWrap').hidden = on;
  $('#doseRenalCalcWrap').hidden = !on;
}
/** ข้อบ่งใช้ของยา — ยาเก่าที่ยังไม่มี indications ใช้ช่องเดิมเป็นข้อแรก */
const indsOf = (d) => (d.indications?.length ? d.indications
  : [{ name: d.indication, per: d.per, min: d.mg_per_kg_min, max: d.mg_per_kg_max, times: d.dose_freq_per_day, cap: d.max_mg_per_dose, freq: d.freq, renal: d.renal_note }]);
const SHOW_OPEN = 3;   // แสดงพร้อมกันได้ 3 ข้อบ่งใช้ ที่เหลือย่อไว้ กดเพื่อขยาย
/** ตัวเลขไม่ถูกปัดจนเป็น 0: ค่าที่มากกว่า 0 แต่ปัดแล้วเป็น 0 → แสดง 2 หลักนัยสำคัญ (audit F-06) */
const fx = (x, dp) => { const t = x.toFixed(dp); return x > 0 && +t === 0 ? String(+x.toPrecision(2)) : t; };
const rng = (a, b, dp) => (fx(a, dp) === fx(b, dp) ? fx(a, dp) : `${fx(a, dp)}–${fx(b, dp)}`);
/** ทศนิยมของขนาดยา: ≥ 10 ไม่มีทศนิยม · 1–9.9 หนึ่งตำแหน่ง · < 1 ให้ค่าสูงสุดมี 2 หลักนัยสำคัญ (เช่น 0.030 · 0.35) */
const dpOf = (hi) => (!(hi > 0) || hi >= 10 ? 0 : hi >= 1 ? 1 : Math.min(6, 1 - Math.floor(Math.log10(hi))));
const drng = (a, b) => rng(a, b, dpOf(b));
/** ปริมาณที่ตวง/แบ่งจริงไม่ได้ (มล. ทศนิยม 1–2 ตำแหน่ง · เม็ด ทศนิยม 2 ตำแหน่ง ปัดแล้วเป็น 0) */
const tooSmall = (hi, dp) => hi > 0 && +hi.toFixed(dp) === 0;
const fig = (n, t) => `<div class="fig"><div class="n num">${n}</div><div class="t">${t}</div></div>`;

/** ช่วงค่าที่เป็นไปได้ของข้อมูลผู้ป่วย (กันพิมพ์ผิด/ผิดหน่วย · ไม่ใช่เกณฑ์ขนาดยา · audit F-08) · Cr หน่วย มก./ดล. (µmol/L ÷ 88.4) */
export const LIM = { wMin: 0.3, wMax: 300, ageMax: 120, hMin: 20, hMax: 250, crMin: 0.1, crMax: 20 };
export const CR_UMOL = 88.4;
/** การทำงานของไต: CrCl (Cockcroft-Gault ตาม MDCalc · ใส่ส่วนสูง = เลือกน้ำหนัก IBW/AdjBW ตาม BMI) หรือ eGFR (CKD-EPI 2021 · อายุ < 18 ปี = Bedside Schwartz) */
export function kidney({ method, age, w, h, cr, female }) {
  if (!(cr > 0)) return { msg: 'กรอกค่า Serum creatinine' };
  if (cr < LIM.crMin || cr > LIM.crMax) return { msg: `ค่า Serum creatinine นอกช่วงที่เป็นไปได้ (${LIM.crMin}–${LIM.crMax} มก./ดล. หรือ 9–1,768 µmol/L) · ถ้ากรอกเป็น µmol/L ให้เลือกหน่วย µmol/L` };
  if (age > LIM.ageMax) return { msg: `อายุเกินช่วงที่สูตรใช้ได้ (ไม่เกิน ${LIM.ageMax} ปี) · กรุณาตรวจสอบอายุที่กรอก` };
  if (method === 'egfr') {
    if (age > 0 && age < 18) {
      if (!(h > 0)) return { msg: 'เด็กอายุต่ำกว่า 18 ปี ใช้สูตร Bedside Schwartz ต้องกรอกส่วนสูง' };
      const v = (0.413 * h) / cr;
      return { v, name: 'eGFR', unit: 'มล./นาที/1.73 ตร.ม.', note: `Bedside Schwartz (เด็ก): 0.413 × ส่วนสูง ${num(h)} ซม. ÷ Cr ${num(cr)}` };
    }
    if (!(age > 0)) return { msg: 'กรอกอายุเพื่อคำนวณ eGFR' };
    const k = female ? 0.7 : 0.9, a = female ? -0.241 : -0.302, r = cr / k;
    const v = 142 * Math.min(r, 1) ** a * Math.max(r, 1) ** -1.2 * 0.9938 ** age * (female ? 1.012 : 1);
    return { v, name: 'eGFR', unit: 'มล./นาที/1.73 ตร.ม.', note: 'CKD-EPI 2021 (ไม่ใช้ตัวแปรเชื้อชาติ)' };
  }
  if (!(age > 0)) return { msg: 'กรอกอายุเพื่อคำนวณ CrCl' };
  let wt = w, used = 'น้ำหนักจริง (ไม่ได้กรอกส่วนสูง)', extra = '';
  if (h > 0) {
    const ibw = (female ? 45.5 : 50) + 2.3 * (h / 2.54 - 60), bmi = w / (h / 100) ** 2, adj = ibw + 0.4 * (w - ibw);
    extra = ` · น้ำหนักจริง ${num(+w.toFixed(1))} · IBW ${num(+ibw.toFixed(1))} · AdjBW ${num(+adj.toFixed(1))} กก. · BMI ${bmi.toFixed(1)}`;
    if (bmi < 18.5) used = 'น้ำหนักจริง (BMI < 18.5)';
    else if (bmi < 25) { wt = Math.min(ibw, w); used = ibw <= w ? 'IBW (BMI 18.5–24.9)' : 'น้ำหนักจริง (น้อยกว่า IBW)'; }
    else { wt = adj; used = 'AdjBW (BMI ≥ 25)'; }
  }
  const v = ((140 - age) * wt * (female ? 0.85 : 1)) / (72 * cr);
  if (!(v > 0) || !Number.isFinite(v)) return { msg: 'คำนวณ CrCl ไม่ได้จากข้อมูลที่กรอก · กรุณาตรวจสอบอายุ/น้ำหนัก/ส่วนสูง' };
  return { v, name: 'CrCl', unit: 'มล./นาที', note: `Cockcroft-Gault ใช้${used}${extra}${age < 18 ? ' · สูตรนี้ใช้กับผู้ใหญ่ (≥ 18 ปี) เด็กให้ใช้ eGFR' : ''}` };
}

/** อายุจากช่องอายุ + หน่วย (ปี/เดือน) → { years, months } หรือ null */
function ageOf() {
  const v = +$('#doseAge').value;
  if (!(v > 0) && $('#doseAge').value !== '0') return null;
  return $('#doseAgeUnit').value === 'm' ? { years: v / 12, months: v } : { years: v, months: v * 12 };
}
/** ไม่ทราบน้ำหนักเด็ก → ประมาณจากเกณฑ์ WHO 2006 (กรมอนามัย) ตามส่วนสูงหรืออายุ */
function renderEst() {
  const a = ageOf(), h = +$('#doseHeight').value, box = $('#doseEst');
  if (!a && !(h > 0)) { box.innerHTML = ''; return; }
  if (a && a.years > 5 + 1e-9) { box.innerHTML = '<p class="small muted">ประมาณน้ำหนักจากเกณฑ์ได้เฉพาะเด็กอายุ 0–5 ปี (WHO 2006 ที่กรมอนามัยใช้)</p>'; return; }
  const e = estimateWeight({ months: a ? a.months : null, height: h, sex: $('#doseSex').value });
  if (!e) { box.innerHTML = a || h <= 120 ? '<p class="small muted">อายุ/ส่วนสูงนี้อยู่นอกช่วงของเกณฑ์น้ำหนัก (อายุ 0–5 ปี · ส่วนสูง 45–120 ซม.)</p>' : ''; return; }
  const by = e.by === 'อายุ' ? `อายุ ${num(e.x)} เดือน` : `${e.by} ${num(e.x)} ซม.`;
  box.innerHTML = `<div class="dose-est-box"><span class="small">ไม่ได้ชั่งน้ำหนัก? น้ำหนักตามเกณฑ์ (WHO · กรมอนามัย) ของเด็ก${$('#doseSex').value === 'f' ? 'หญิง' : 'ชาย'} ${by}: `
    + `<b>${num(e.mid.toFixed(1))} กก.</b> <span class="muted">(ช่วงปกติ ${num(e.lo)}–${num(e.hi)} กก.)</span></span>`
    + `<button type="button" class="btn btn-o btn-sm" data-use-weight="${e.mid.toFixed(1)}">ใช้น้ำหนักนี้</button></div>`;
}

function render() {
  renderEst();
  const ga = ageOf();   // กราฟการเจริญเติบโต (กรมอนามัย) + จุดแดงของเด็กคนนี้
  renderGrowth($('#doseGrowth'), { months: ga ? ga.months : null, w: +$('#doseWeight').value, h: +$('#doseHeight').value, sex: $('#doseSex').value });
  const out = $('#doseResult');
  const w = +$('#doseWeight').value, d = drug();
  labelDose();
  if (!d) { out.innerHTML = '<p class="small muted">ยังไม่มีรายการยาที่มีข้อมูลขนาดยา</p>'; return; }
  if (!(w > 0)) { out.innerHTML = '<p class="small muted">กรอกน้ำหนักตัว (จำเป็น) และเลือกรายการยาเพื่อคำนวณ · อายุและส่วนสูงไม่บังคับ</p>'; return; }
  {   // ค่านอกช่วงที่เป็นไปได้ → ไม่คำนวณ ให้ตรวจการกรอกก่อน (audit F-08)
    const hh = +$('#doseHeight').value, ga0 = ageOf();
    const bad = w < LIM.wMin || w > LIM.wMax ? `น้ำหนัก ${num(w)} กก. อยู่นอกช่วงที่เป็นไปได้ (${LIM.wMin}–${LIM.wMax} กก.) · กรุณาตรวจสอบน้ำหนักที่กรอก`
      : ga0 && ga0.years > LIM.ageMax ? `อายุอยู่นอกช่วงที่เป็นไปได้ (0–${LIM.ageMax} ปี) · กรุณาตรวจสอบอายุและหน่วย (ปี/เดือน)`
      : hh > 0 && (hh < LIM.hMin || hh > LIM.hMax) ? `ส่วนสูง ${num(hh)} ซม. อยู่นอกช่วงที่เป็นไปได้ (${LIM.hMin}–${LIM.hMax} ซม.) · กรุณาตรวจสอบส่วนสูงที่กรอก` : '';
    if (bad) { out.innerHTML = `<p class="small fx-warn" data-input-range>${esc(bad)}</p>`; return; }
  }
  const c = conc();
  /** ขนาดยาของข้อบ่งใช้ i สำหรับน้ำหนัก w */
  //   หน่วย mcg (เช่น levothyroxine): คิดเป็น mcg แล้วแปลงเป็น มก. (÷1000) ก่อนเทียบกับความแรงของยา (มก./เม็ด · มก./มล.)
  //   แบ่งให้ได้หลายแบบ (times + times_alt เช่น วันละ 1 หรือ 3 ครั้ง) → แสดงผลแยกทีละแบบ
  const doseOf = (i) => {
    const ts = [i.times, ...(i.times_alt || [])].map(Number).filter((n) => n >= 1);
    const tail = `<p class="small muted">ความถี่: ${esc(i.freq || '-')}</p>`
      + (i.ref?.label ? `<p class="small muted">ที่มา: ${/^https:\/\//.test(i.ref.url || '') ? `<a href="${esc(i.ref.url)}" target="_blank" rel="noopener">${esc(i.ref.label)}</a>` : esc(i.ref.label)}${i.quote ? ` · <span lang="en">“${esc(i.quote)}”</span>` : ''}</p>` : '')
      + (i.renal ? `<p class="small" style="color:var(--warning)"><b>ขนาดยาในโรคไต:</b> ${esc(i.renal)}</p>` : '')
      + (renal === 'unknown' ? '<p class="small fx-warn">ขนาดยานี้ยังไม่ได้ปรับตามการทำงานของไต (ยังประเมินไตไม่ได้)</p>' : '')
      + (renal !== 'normal' && renal !== 'unknown' ? `<p class="small fx-warn" data-renal-unadjusted>ตัวเลขด้านบนเป็นขนาดปกติ ยังไม่ได้ปรับตามการทำงานของไต · ${i.renal ? 'ปรับตาม "ขนาดยาในโรคไต" ด้านบน' : 'ยังไม่มีคำแนะนำในระบบ ปรึกษาเภสัชกรก่อนใช้'}</p>` : '');
    // ช่วงอายุของข้อบ่งใช้ (age_min/age_max ปี · audit F-09): อายุผู้ป่วยนอกช่วง = ไม่แสดงขนาดยา · ไม่ได้กรอกอายุ = เตือนให้กรอก
    const aMin = i.age_min != null ? +i.age_min : null, aMax = i.age_max != null ? +i.age_max : null;
    const aTxt = aMin != null && aMax != null ? `อายุ ${num(aMin)}–${num(aMax)} ปี` : aMin != null ? `อายุตั้งแต่ ${num(aMin)} ปี` : aMax != null ? `อายุไม่เกิน ${num(aMax)} ปี` : '';
    let agePre = '';
    if (aTxt && age > 0 && ((aMin != null && age < aMin) || (aMax != null && age > aMax))) {
      return `<div class="alert" data-age-out>${warnIcon}<div><b>ข้อบ่งใช้นี้ใช้กับ${aTxt}</b><div class="small">ผู้ป่วยอายุ ${num(+age.toFixed(2))} ปี อยู่นอกช่วง จึงไม่แสดงขนาดยาของข้อบ่งใช้นี้</div></div></div>` + tail;
    }
    if (aTxt && !(age > 0)) agePre = `<p class="small fx-warn" data-age-need>ข้อบ่งใช้นี้ใช้กับ${aTxt} · กรุณากรอกอายุเพื่อตรวจว่าตรงช่วงอายุ</p>`;
    else if (aTxt) agePre = `<p class="small muted">ใช้กับ${aTxt}</p>`;
    if (i.per === 'day' && !ts.length) {   // ขนาดต่อวันแต่ไม่บอกจำนวนครั้ง → ไม่เดาว่าวันละครั้ง (audit F-07)
      const U = i.unit === 'mcg' ? 'mcg' : 'มก.';
      return `<div class="alert" data-dose-incomplete>${warnIcon}<div><b>ข้อมูลขนาดยาไม่ครบ</b>`
        + `<div class="small">เป็นขนาดต่อวัน แต่ไม่ได้ระบุว่าแบ่งให้วันละกี่ครั้ง จึงยังคำนวณขนาดต่อครั้งและจำนวนเม็ด/มล. ไม่ได้</div>`
        + `<div class="small">ขนาดรวมตามน้ำหนัก ${drng(w * i.min, w * i.max)} ${U}/วัน (ยังไม่ทราบว่าให้ครั้งเดียวหรือแบ่งให้) · แจ้งผู้ดูแลให้เพิ่มจำนวนครั้งในข้อมูลคำนวณขนาดยา</div></div></div>` + tail;
    }
    const noMax = !(+i.cap > 0) && !(+i.cap_day > 0) ? '<p class="small fx-warn" data-no-max>ข้อบ่งใช้นี้ยังไม่มีขนาดสูงสุดในข้อมูล · ตรวจสอบไม่ให้เกินขนาดสูงสุดตามเอกสารกำกับยา (โดยเฉพาะผู้ใหญ่/เด็กโต)</p>' : '';
    if (i.per === 'day' && ts.length > 1) return agePre + ts.map((n, k) => `<div class="dose-opt"><p class="small"><b>แบบที่ ${k + 1}: แบ่งให้วันละ ${n} ครั้ง</b></p>${doseCore({ ...i, times: n })}</div>`).join('') + noMax + tail;
    return agePre + doseCore(i) + noMax + tail;
  };
  const doseCore = (i) => {
    const mcg = i.unit === 'mcg', U = mcg ? 'mcg' : 'มก.', k = mcg ? 1 / 1000 : 1;
    let lo, hi, label, n = 1, dayCapNote = '';
    if (i.per !== 'day') {
      lo = w * i.min; hi = w * i.max;
      label = 'ต่อครั้ง';
      if (+i.cap_day > 0) dayCapNote = `<p class="small muted">รวมทั้งวันไม่เกิน ${num(+i.cap_day)} ${U}/วัน</p>`;
    } else {
      let dayMin = w * i.min, dayMax = w * i.max;
      if (+i.cap_day > 0 && dayMax > +i.cap_day) {   // ขนาดสูงสุดต่อวัน (audit F-09)
        dayCapNote = `<p class="small fx-warn" data-capped-day>จำกัดที่ขนาดสูงสุด ${num(+i.cap_day)} ${U}/วัน · ขนาดตามน้ำหนักคือ ${drng(dayMin, dayMax)} ${U}/วัน</p>`;
        dayMin = Math.min(dayMin, +i.cap_day); dayMax = +i.cap_day;
      }
      n = i.times || 1;
      lo = dayMin / n; hi = dayMax / n;
      label = n > 1 ? `ต่อครั้ง (แบ่งจากขนาดรวม ${drng(dayMin, dayMax)} ${U}/วัน)` : 'ต่อวัน (วันละครั้ง)';
    }
    // ขนาดสูงสุดต่อครั้ง (cap · หน่วยเดียวกับขนาดยา) ใช้ทั้งแบบต่อครั้งและแบบต่อวันที่แบ่งให้ · ถูกจำกัด = บอกขนาดตามน้ำหนักเดิม (audit F-02)
    let capNote = '';
    if (+i.cap > 0 && hi > +i.cap) {
      const cap = +i.cap, rawLo = lo, rawHi = hi;
      lo = Math.min(lo, cap); hi = cap;
      capNote = `<p class="small fx-warn" data-capped>จำกัดที่ขนาดสูงสุด ${num(cap)} ${U}/ครั้ง · ขนาดตามน้ำหนักคือ ${drng(rawLo, rawHi)} ${U}/ครั้ง`
        + `${i.per === 'day' && n > 1 ? ` · รวมได้ไม่เกิน ${num(+(cap * n).toFixed(3))} ${U}/วัน` : ''}</p>`;
    }
    const minMg = lo * k, maxMg = hi * k;
    // ยาสูตรผสม: คิดจำนวนเม็ด/มล. จากปริมาณของสารสำคัญที่ใช้คิดขนาดยา (basis) + บอกปริมาณสารสำคัญทุกตัวที่ได้รับ
    let cc = c, combo = '', basisName = i.basis ? ` · คิดจาก ${i.basis}` : '';
    if (c?.ings) {
      const ing = c.fixed ? c.ings.find((x) => x.name === c.fixed) : basisOf(c.ings, i.basis);
      if (ing && !i.basis) basisName = ` · คิดจาก ${ing.name}`;
      if (ing) {
        cc = concOf({ mg: ing.mg, per: c.per }, `${c.label} · คิดจาก ${ing.name} ${num(ing.mg)} ${PER[c.per]}`);
        const uLo = minMg / ing.mg, uHi = maxMg / ing.mg;
        combo = `<p class="small">ได้รับสารสำคัญ: ${c.ings.map((x) => `${esc(x.name)} ${drng(uLo * x.mg, uHi * x.mg)} มก.`).join(' · ')}</p>`;
      } else {
        cc = null;
        combo = `<p class="small fx-warn">ยาสูตรผสม (${esc(c.ings.map((x) => x.name).join(' + '))}): ข้อบ่งใช้นี้ยังไม่ได้ระบุว่าคิดขนาดยาจากสารสำคัญตัวใด จึงยังไม่คิดจำนวนเม็ด/มล. · ผู้ดูแลระบุได้ในข้อมูลคำนวณขนาดยา (ช่อง "คิดจากสารสำคัญ")</p>`;
      }
    }
    let vol = '', tiny = false;
    if (cc?.mgPer5ml) { const a = minMg / cc.mgPer5ml * 5, b = maxMg / cc.mgPer5ml * 5; tiny = tooSmall(b, 1); vol = fig(`${rng(a, b, 1)} มล.`, `ปริมาณยา (${esc(cc.label)}) ${label}`); }
    else if (cc?.mgPerMl) { const a = minMg / cc.mgPerMl, b = maxMg / cc.mgPerMl; tiny = tooSmall(b, 2); vol = fig(`${rng(a, b, 2)} มล.`, `ปริมาณยา (${esc(cc.label)}) ${label}`); }
    else if (cc?.mgPerTab) { const a = minMg / cc.mgPerTab, b = maxMg / cc.mgPerTab; tiny = tooSmall(b, 2); vol = fig(`${rng(a, b, 2)} เม็ด/แคปซูล`, `จาก ${esc(cc.label)} ${label}`); }
    if (tiny) vol += '<p class="small fx-warn" data-too-small>ปริมาณน้อยเกินกว่าจะตวง/แบ่งจากความแรงนี้ได้ · ใช้ยาความแรงที่เหมาะกว่า หรือปรึกษาเภสัชกร</p>';
    const unadj = renal !== 'normal' ? ' · ขนาดปกติ ยังไม่ปรับตามไต' : '';   // audit F-10: ไตเสื่อม/ประเมินไม่ได้ → ตัวเลขยังไม่ได้ปรับ
    return fig(`${drng(lo, hi)} ${U}`, `ขนาดยา${esc(basisName)} ${label}${mcg ? ` (= ${drng(minMg, maxMg)} มก.)` : ''}${unadj}`) + capNote + dayCapNote + vol + combo;
  };
  const inds = indsOf(d);

  const h = +$('#doseHeight').value, ag = ageOf(), age = ag ? ag.years : 0;
  const bmi = h > 0 ? fig((w / Math.pow(h / 100, 2)).toFixed(1), `BMI (น้ำหนัก ${w} กก. ส่วนสูง ${h.toFixed(0)} ซม.)`) : '';

  // สถานะไต: normal | mild | moderate | severe | unknown (เปิดคำนวณไตแต่คำนวณไม่ได้ — ห้ามถือว่าไตปกติ · audit F-01)
  let renal = 'normal', crclNote = '', renalWhy = '';
  const method = $('#doseRenalMethod').value;
  $('#doseCrClLbl').textContent = method === 'egfr' ? 'eGFR' : 'CrCl (Cockcroft-Gault)';
  if ($('#doseRenalAdjust').checked) {
    const crIn = +$('#doseCr').value, umol = $('#doseCrUnit').value === 'umol', cr = umol ? crIn / CR_UMOL : crIn;
    const k = kidney({ method, age, w, h, cr, female: $('#doseSex').value === 'f' });
    if (umol && k.note) k.note = `Cr ${num(crIn)} µmol/L = ${cr.toFixed(2)} มก./ดล. · ${k.note}`;
    if (k.v != null && Number.isFinite(k.v)) {
      $('#doseCrClOut').value = `${k.v.toFixed(1)} ${k.unit}`;
      renal = k.v >= 60 ? 'normal' : k.v >= 30 ? 'mild' : k.v >= 10 ? 'moderate' : 'severe';
      crclNote = `<p class="small muted">${k.name} ≈ ${k.v.toFixed(1)} ${k.unit} · ${esc(k.note)}</p>`;
    } else { $('#doseCrClOut').value = ''; renal = 'unknown'; renalWhy = k.msg || 'ข้อมูลไม่พอสำหรับคำนวณ'; }
  } else renal = $('#doseRenal').value;

  const labels = { mild: 'ไตเสื่อมเล็กน้อย–ปานกลาง (30–60 มล./นาที)', moderate: 'ไตเสื่อมปานกลาง–รุนแรง (10–30 มล./นาที)', severe: 'ไตเสื่อมรุนแรง / ฟอกไต (<10 มล./นาที)' };
  let alert = '';
  const warnIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>';
  if (renal === 'unknown') {
    alert = `<div class="alert" data-renal="unknown">${warnIcon}<div><b>ยังประเมินการทำงานของไตไม่ได้</b>`
      + `<div class="small">เหตุผล: ${esc(renalWhy)}</div>`
      + `<div class="small">ขนาดยาด้านล่างเป็นขนาดปกติ <b>ยังไม่ได้ปรับตามการทำงานของไต</b> · กรอกข้อมูลให้ครบ หรือเอาเครื่องหมายออกจากช่อง "ปรับขนาดยาตามการทำงานของไต" แล้วเลือกระดับไตเอง</div></div></div>`;
  } else if (renal !== 'normal') {
    alert = `<div class="alert">${warnIcon}`
      + `<div><b>ขนาดยาในโรคไต — ${esc(labels[renal])}</b><div class="small">${inds.some((i) => i.renal) ? 'ดูคำแนะนำ "ขนาดยาในโรคไต" ของแต่ละข้อบ่งใช้ด้านล่าง' : 'ยานี้ยังไม่มีคำแนะนำการปรับขนาดยาในโรคไตในระบบ กรุณาปรึกษาเภสัชกรก่อนใช้'}</div>${crclNote}</div></div>`;
  } else if (crclNote) alert = /≈/.test(crclNote) ? `<p class="small muted">การทำงานของไตปกติ (≥ 60) — ไม่จำเป็นต้องปรับขนาดยา</p>${crclNote}` : crclNote;

  const title = (i, k) => `ข้อบ่งใช้${inds.length > 1 ? ' ' + (k + 1) : ''}: ${esc(i.name || '-')}`;
  out.innerHTML = (age > 0 ? `<p class="small muted">ผู้ป่วยอายุ ${$('#doseAgeUnit').value === 'm' ? `${num(ag.months)} เดือน` : `${num(age)} ปี`} · น้ำหนัก ${num(w)} กก.${h > 0 ? ` · ส่วนสูง ${num(h)} ซม.` : ''}</p>` : '') + alert
    + (inds.length > SHOW_OPEN ? `<p class="small muted">ยานี้มี ${inds.length} ข้อบ่งใช้ · แสดง ${SHOW_OPEN} ข้อแรก ที่เหลือกดเพื่อดูขนาดยา</p>` : '')
    + '<div class="ind-results">' + inds.map((i, k) => (k < SHOW_OPEN
      ? `<section class="ind-result"><h4>${title(i, k)}</h4>${doseOf(i)}</section>`
      : `<details class="ind-result"><summary>${title(i, k)}</summary>${doseOf(i)}</details>`)).join('') + '</div>'
    + bmi
    + (d.ai_source ? `<p class="small muted">ที่มาขนาดยา: ${esc(d.ai_source.replace(' · ยังไม่ผ่านการตรวจ', ''))} · ผู้ดูแลตรวจแล้ว</p>` : '')
    + '<p class="small muted">ตัวเลขนี้เป็นการประมาณตามช่วงขนาดยาทั่วไป โปรดตรวจสอบกับเอกสารกำกับยา/แนวทางการรักษาและดุลยพินิจทางคลินิกก่อนใช้จริงเสมอ</p>';
}

/* ---------- ส่วน "ข้อมูลยา" (บัญชียาหลักแห่งชาติ) ---------- */
const NLEM_PDF = 'https://ratchakitcha.soc.go.th/documents/111371.pdf';
const ACCT = { b: 'บัญชียาพื้นฐาน', s: 'บัญชียาทางเลือก', ex: 'บัญชียาเฉพาะโรค', R1: 'บัญชียาสำหรับโครงการพิเศษของหน่วยงานของรัฐ', R2: 'บัญชียาพิเศษที่กำหนดแนวทางการใช้ยา' };
const ABBR = 'cap = capsule · DPI = dry powder inhaler · EC = enteric coated · hosp = เภสัชตำรับโรงพยาบาล · inj = injection · IM = intramuscular · IU = International unit · '
  + 'mcg = microgram · MDI = metered dose inhaler · mEq = milliequivalent · mixt = mixture · oint = ointment · pwdr = powder · sol = solution · SR = ยาออกฤทธิ์นาน · '
  + 'supp = suppository · susp = suspension · syr = syrup · tab = tablet · U = unit';

function showTab(t) {
  $('#doseTabs').querySelectorAll('[data-dt]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.dt === t)));
  $('#dosePaneCalc').hidden = t !== 'calc';
  $('#dosePaneInfo').hidden = t !== 'info';
  $('#dosePaneFluid').hidden = t !== 'fluid';
  $('#dosePaneDdi').hidden = t !== 'ddi';
  if (t === 'info') openInfo();
  if (t === 'fluid') initFluid();
  if (t === 'ddi') initDdi();
}
/** ชื่ออังกฤษของยาในเครื่องคำนวณ เช่น "พาราเซตามอล (Paracetamol)" → "paracetamol" */
export const latinOf = (name) => { const m = String(name).match(/\(([^()]*[A-Za-z][^()]*)\)/); return (m ? m[1] : /[A-Za-z]/.test(name) ? name : '').trim().toLowerCase(); };
/** ชื่อยาในบัญชี → ชื่อสำหรับจับคู่: "Paracetamol (Acetaminophen)" → ["paracetamol", "acetaminophen"] */
export const keysOf = (name) => String(name).toLowerCase().split(/[()]/).map((x) => x.trim()).filter(Boolean);
export const sameDrug = (key, dk) => !!dk && (key === dk || (key.startsWith(dk + ' ') && !key.includes('+')));

async function openInfo() {
  if (!items) {
    $('#doseInfoN').textContent = '';
    $('#doseInfoList').innerHTML = '<div class="skeleton"></div><div class="skeleton" style="width:70%;margin-top:10px"></div>';
    if (!await loadInfo()) { $('#doseInfoList').innerHTML = '<p class="empty">โหลดข้อมูลยาไม่สำเร็จ กรุณาลองใหม่</p>'; return; }
  }
  fillGroups(); renderList();
}
/** โหลดบัญชียาหลัก (ย่อ) + ยา รพ.สต. แล้วจับคู่กับข้อมูลคำนวณขนาดยา (drugs) */
async function loadInfo() {
  if (items) return true;
  try {
    if (!monos) {
      const all = [];
      for (let from = 0; ; from += 1000) {   // Supabase ส่งได้ครั้งละ ≤ 1000 แถว
        const { data, error } = await sb.from('drug_monographs').select('id,ref,name,group_no,group_name,sub_code,sub_name,forms,sort').order('sort').range(from, from + 999);
        if (error) throw error;
        all.push(...data);
        if (data.length < 1000) break;
      }
      monos = all;
    }
    if (!locals) {
      const { data, error } = await sb.from('local_drugs').select('*').eq('active', true).order('sort').order('id');
      if (error) throw error;
      locals = data;
    }
  } catch (err) { toast(errText(err), 'err'); return false; }
  // บัญชียาหลัก: รวมรายการชื่อเดียวกัน (ยาเดียวอยู่หลายกลุ่มยา) + ผูกยาในเครื่องคำนวณ
  const byName = new Map();
  for (const m of monos) {
    const k = m.name.toLowerCase();
    if (!byName.has(k)) byName.set(k, { name: m.name, rows: [], calc: [] });
    byName.get(k).rows.push(m);
  }
  items = [...byName.values()];
  (drugs || []).forEach((d, k) => {
    const dk = latinOf(d.name);
    const hit = items.filter((it) => it.rows.length && keysOf(it.name).some((key) => sameDrug(key, dk)));
    if (hit.length) hit.forEach((it) => { it.calc.push(k); it.th = (it.th || '') + ' ' + d.name; });
    else items.push({ name: d.name, rows: [], calc: [k] });
  });
  items.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  items.forEach((it) => { it.q = [it.name, it.th, ...it.rows.flatMap((r) => [r.sub_name, r.group_name])].join(' ').toLowerCase(); });
  // ยา รพ.สต.: monograph ที่ผูกไว้ (ref) + ข้อมูลคำนวณ (ผูกเอง dose_id หรือจับคู่จากชื่อยาในบัญชียาหลัก)
  const byRef = new Map(monos.map((m) => [m.ref, m]));
  litems = locals.map((l) => {
    const rows = (l.mono_refs || []).map((r) => byRef.get(r)).filter(Boolean);
    const names = [...new Set(rows.map((r) => r.name))];
    const nat = items.filter((it) => names.includes(it.name));
    const own = (drugs || []).findIndex((d) => d.id === l.dose_id);
    // ยาสูตรผสม: ข้อมูลคำนวณรายสาร (ingredients[].dose_id) → ยานี้ขึ้นในเครื่องคำนวณของสารนั้นด้วย
    const ingDose = (l.ingredients || []).map((x) => (drugs || []).findIndex((d) => d.id === x.dose_id)).filter((k) => k >= 0);
    const dose = own >= 0 || ingDose.length ? [...new Set([...(own >= 0 ? [own] : []), ...ingDose])] : [...new Set(nat.flatMap((it) => it.calc))];
    return { name: l.name, loc: l, rows, names, calc: dose, dose, q: [l.name, l.code, l.category, ...names, ...nat.map((it) => it.th || '')].join(' ').toLowerCase() };
  });
  return true;
}
/** ตัวกรองหมวด: l:<หมวดยา รพ.สต.> · n:<เลขกลุ่มยาในบัญชียาหลัก> — ตามแหล่งข้อมูลที่เลือก */
function fillGroups() {
  const lc = [...new Set(litems.map((it) => it.loc.category))].map((c) => [`l:${c}`, c]);
  const ng = [...new Map(monos.map((m) => [m.group_no, m.group_name]))].sort((a, b) => a[0] - b[0]).map(([n, g]) => [`n:${n}`, `กลุ่มยา ${n} ${g}`]);
  const opt = (o) => o.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
  $('#doseInfoGroupLbl').textContent = { local: 'หมวดยา', nlem: 'กลุ่มยา' }[scope] || 'หมวด / กลุ่มยา';
  $('#doseInfoGroup').innerHTML = '<option value="all">ทั้งหมด</option>' + (scope === 'local' ? opt(lc) : scope === 'nlem' ? opt(ng)
    : `<optgroup label="ยา รพ.สต.">${opt(lc)}</optgroup><optgroup label="บัญชียาหลักแห่งชาติ">${opt(ng)}</optgroup>`);
}
const acctChips = (forms) => [...new Set((forms || []).map((f) => f.acct).filter(Boolean))]
  .map((a) => `<span class="chip c-role" title="${esc(ACCT[a] || a)}">${esc(a)}</span>`).join('');

function renderList() {
  const box = $('#doseInfoList');
  if (!items) return;
  const q = $('#doseInfoQ').value.trim().toLowerCase(), g = $('#doseInfoGroup').value;
  const hit = (it) => !q || it.q.includes(q);
  const lList = scope === 'nlem' || g.startsWith('n:') ? [] : litems.filter((it) => hit(it) && (g === 'all' || it.loc.category === g.slice(2)));
  const nList = scope === 'local' || g.startsWith('l:') ? [] : items.filter((it) => hit(it) && (g === 'all' || it.rows.some((r) => `n:${r.group_no}` === g)));
  const total = lList.length + nList.length;   // ยา รพ.สต. แสดงครบ · บัญชียาหลักทีละ 40
  $('#doseInfoN').textContent = total ? `พบ ${total} รายการ · กดชื่อยาเพื่อดูข้อมูล` : '';
  const chipsOf = (it) => (it.rows.length ? acctChips(it.rows.flatMap((x) => x.forms)) : '') + (it.calc.some(inCalc) ? '<span class="chip c-on">คำนวณขนาดยาได้</span>' : '');
  let cat = null;
  const lHtml = lList.map((it) => {
    const l = it.loc, head = l.category !== cat ? `<h3 class="di-cat">${scope === 'all' ? 'ยา รพ.สต. · ' : ''}${esc(l.category)}</h3>` : '';
    cat = l.category;
    const pack = [l.code && `รหัส ${l.code}`, (l.pack_size || l.unit) && `บรรจุ ${[l.pack_size, l.unit].filter(Boolean).join(' ')}`].filter(Boolean).join(' · ');
    return head + `<button type="button" class="di-item" data-scope="local" data-mono="${litems.indexOf(it)}"><span class="di-nm">${esc(l.name)}</span>`
      + `<span class="di-sub small muted">${esc(pack)}${it.names.length ? ` · ${esc(it.names.join(', '))}` : ''}</span>`
      + `<span class="di-chips">${chipsOf(it) || '<span class="chip c-off">ยังไม่มีข้อมูลยา</span>'}</span></button>`;
  }).join('');
  const nHtml = nList.slice(0, shown).map((it) => {
    const r = it.rows[0];
    const where = r ? `${esc(r.sub_code)} ${esc(r.sub_name || r.group_name)}${it.rows.length > 1 ? ` · และอีก ${it.rows.length - 1} กลุ่ม` : ''}` : 'ยาในเครื่องคำนวณขนาดยา';
    return `<button type="button" class="di-item" data-scope="nlem" data-mono="${items.indexOf(it)}"><span class="di-nm">${esc(it.name)}</span>`
      + `<span class="di-sub small muted">${where}</span><span class="di-chips">${chipsOf(it)}</span></button>`;
  }).join('');
  const none = scope === 'local' ? !litems.length : scope === 'nlem' ? !items.length : !litems.length && !items.length;
  box.innerHTML = none ? '<p class="empty">ยังไม่มีข้อมูลยา</p>' : !total ? '<p class="empty">ไม่พบยาที่ค้นหา</p>'
    : lHtml + (scope === 'all' && nList.length ? '<h3 class="di-cat">บัญชียาหลักแห่งชาติ</h3>' : '') + nHtml;
  $('#doseInfoMore').hidden = nList.length <= shown;
  if (nList.length > shown) $('#doseInfoMore').textContent = `แสดงเพิ่ม (เหลืออีก ${nList.length - shown} รายการ)`;
}

const para = (lines) => (lines.length === 1 ? `<p>${esc(lines[0])}</p>` : `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`);
async function openMono(it) {
  if (!it) return;
  const box = $('#doseMono');
  $('#doseInfoPick').hidden = true; box.hidden = false;
  box.innerHTML = '<div class="skeleton"></div><div class="skeleton" style="width:60%;margin-top:10px"></div>';
  let rows = [];
  if (it.rows.length) {
    const { data, error } = await sb.from('drug_monographs').select('*').in('id', it.rows.map((r) => r.id)).order('sort');
    if (error) { toast(errText(error), 'err'); closeMono(); return; }
    rows = data;
  }
  // ฉลากยาสหรัฐฯ (openFDA · drug_fda_labels): ของยา รพ.สต. นั้น หรือของยา รพ.สต. ที่ผูกกับชื่อยานี้ในบัญชียาหลัก
  const fkeys = [...new Set(it.loc ? [it.loc.fda_key] : litems.filter((x) => x.names.includes(it.name)).map((x) => x.loc.fda_key))].filter(Boolean);
  let fda = [];
  if (fkeys.length) {
    const { data, error } = await sb.from('drug_fda_labels').select('*').in('key', fkeys);
    if (!error) fda = data;
  }
  // รายการที่เนื้อหาเหมือนกัน (ยาเดียวกันอยู่หลายกลุ่มยา) แสดงรวมกล่องเดียว
  const cards = [];
  for (const r of rows) {
    const sig = JSON.stringify([r.forms, r.sections, r.flags]);
    const c = cards.find((x) => x.sig === sig);
    if (c) c.rows.push(r); else cards.push({ sig, rows: [r] });
  }
  const flags = [...new Set(rows.flatMap((r) => r.flags || []))], l0 = it.loc;
  const ks = it.calc.filter(inCalc), li = l0 ? litems.indexOf(it) : '';
  const dose = ks.map((k) => drugs[k]).filter(Boolean).map((d, n) => `<div class="mono-dose"><b>${esc(d.name)}</b>`
    + (d.concs?.length ? `<div class="small muted">ความแรงที่มี: ${d.concs.map((c) => esc(c.label)).join(' · ')}</div>` : '')
    + `<ul>${indsOf(d).map((x) => `<li><b>${esc(x.name || 'ข้อบ่งใช้')}</b>: ${esc(doseText(x))}${x.freq ? ` · ${esc(x.freq)}` : ''}`
      + (x.renal ? `<div class="small di-renal"><b>ขนาดยาในโรคไต:</b> ${esc(x.renal)}</div>` : '') + '</li>').join('')}</ul>`
    + `<button type="button" class="btn btn-p di-calc" data-dose-calc="${ks[n]}" data-local="${li}">คำนวณขนาดยานี้ตามน้ำหนักตัว</button></div>`).join('');
  const l = it.loc;
  const local = l ? '<section class="mono-card mono-local"><div class="mono-sec"><h4>รายการยา รพ.สต. อ.ควนกาหลง</h4><dl class="mono-dl">'
    + [['รหัสยาใน รพ.', l.code], ['หมวดยา', l.category], ['ขนาดบรรจุ', l.pack_size], ['หน่วย', l.unit]].filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')
    + '</dl></div>' + (l.note ? `<div class="mono-sec"><h4>หมายเหตุ</h4>${para(String(l.note).split(/\n+/).filter(Boolean))}</div>` : '')
    + (it.names.length ? `<p class="small muted">ข้อมูลยาตามบัญชียาหลักแห่งชาติ: ${esc(it.names.join(', '))}</p>` : '<p class="small muted">ยังไม่ได้ผูกกับข้อมูลยาในบัญชียาหลักแห่งชาติ</p>') + editLink(`local:${l.id}`) + '</section>' : '';
  box.innerHTML = '<button type="button" class="btn btn-o di-back" data-mono-back>‹ กลับไปรายการยา</button>'
    + `<h3 class="mono-name">${esc(it.name)}</h3>` + local
    + (flags.length ? `<div class="di-chips">${flags.map((f) => `<span class="chip c-fix">${esc(f)}</span>`).join('')}</div>` : '')
    + cards.map(({ rows: rs }) => {
      const r = rs[0];
      return '<section class="mono-card">'
        + `<div class="mono-sec"><h4>กลุ่มยา</h4><ul>${rs.map((x) => `<li>กลุ่มยา ${x.group_no} ${esc(x.group_name)} › ${esc(x.sub_code)} ${esc(x.sub_name)}</li>`).join('')}</ul></div>`
        + `<div class="mono-sec"><h4>รูปแบบยา / บัญชี</h4><ul>${(r.forms || []).map((f) => `<li>${esc(f.form || '-')} ${f.acct ? `<span class="chip c-role">${esc(f.acct)}</span> <span class="small muted">${esc(ACCT[f.acct] || '')}</span>` : ''}</li>`).join('')}</ul></div>`
        + (r.sections || []).map((x) => `<div class="mono-sec"><h4>${esc(x.title)}</h4>${para(x.body || [])}</div>`).join('')
        + `<p class="small muted">ที่มา: บัญชียาหลักแห่งชาติ พ.ศ. ๒๕๖๙ · <a href="${NLEM_PDF}#page=${+r.page || 1}" target="_blank" rel="noopener">ราชกิจจานุเบกษา (PDF หน้า ${+r.page || '-'})</a></p>` + editLink(`mono:${r.id}`)
        + '</section>';
    }).join('')
    + fda.map(fdaCard).join('')
    + (dose ? `<section class="mono-card"><div class="mono-sec"><h4>ขนาดยา (จากเครื่องคำนวณขนาดยาของเว็บนี้)</h4>${dose}</div></section>`
      : fda.length ? '' : '<p class="small muted">บัญชียาหลักแห่งชาติระบุขนาดยาเฉพาะบางรายการ (อยู่ในเงื่อนไข/หมายเหตุ) · ขนาดยา อาการไม่พึงประสงค์ และยาตีกัน โปรดดูเอกสารกำกับยา</p>')
    + (rows.length || l ? '' : '<p class="small muted">ยานี้ยังไม่มีข้อมูลในบัญชียาหลักแห่งชาติที่บันทึกไว้</p>')
    + (rows.length ? `<details class="mono-abbr"><summary>คำย่อ</summary><p class="small">บัญชี: ${Object.entries(ACCT).map(([k, v]) => `${k} = ${v}`).join(' · ')}</p><p class="small">${ABBR}</p></details>` : '');
  box.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
/** ใต้ผลคำนวณ: "ขนาดยาและวิธีใช้" จากฉลากยา openFDA ของยา รพ.สต. ที่ผูกกับยาที่เลือก (ไทยจาก AI + ต้นฉบับอังกฤษพับไว้) */
const labelRows = new Map();
async function labelDose() {
  const box = $('#doseLabel'), k = +$('#doseDrug').value || 0;
  const keys = drugs?.[k] ? [...new Set(localsOf(k).map((it) => it.loc.fda_key).filter(Boolean))] : [];
  box.dataset.k = String(k);
  if (!keys.length) { box.innerHTML = ''; return; }
  const need = keys.filter((x) => !labelRows.has(x));
  if (need.length) {
    const { data } = await sb.from('drug_fda_labels').select('id,key,title,generic,set_id,effective,sections,sections_th,th_reviewed').in('key', need);
    need.forEach((x) => labelRows.set(x, (data || []).find((r) => r.key === x) || null));
  }
  if (box.dataset.k !== String(k)) return;   // ผู้ใช้เปลี่ยนยาระหว่างโหลด
  const parts = keys.map((x) => labelRows.get(x)).filter(Boolean).map((f) => {
    const th = f.sections_th?.find((x) => x.title === 'ขนาดยาและวิธีใช้'), en = f.sections?.find((x) => x.title === 'ขนาดยาและวิธีใช้')?.body;
    if (!th && !en) return '';
    const enHtml = en ? `<div lang="en">${fdaBody(en)}</div>` : '';
    return `<details class="mono-fold" open><summary>ขนาดยาและวิธีใช้ · ${esc(f.title || f.generic)}</summary>`
      + (th ? `<ul>${(th.body || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${enHtml ? `<details class="mono-en"><summary>ต้นฉบับภาษาอังกฤษ</summary>${enHtml}</details>` : ''}` : enHtml)
      + `<p class="small muted">${th ? (f.th_reviewed ? 'ภาษาไทย · ผู้ดูแลตรวจแล้ว' : 'แปลและเรียบเรียงโดย AI · โปรดตรวจกับต้นฉบับ') : 'ภาษาอังกฤษตามต้นฉบับ (AI กำลังทยอยแปล)'} · ที่มา: ฉลากยาสหรัฐฯ openFDA`
      + `${f.set_id ? ` · <a href="https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${encodeURIComponent(f.set_id)}" target="_blank" rel="noopener">ฉลากเต็ม (DailyMed)</a>` : ''} · ขนาดยาในสหรัฐฯ อาจต่างจากประเทศไทย</p></details>`;
  }).filter(Boolean);
  box.innerHTML = parts.length ? `<section class="panel"><h3 class="dose-label-h">ข้อมูลขนาดยาจากฉลากยา</h3>${parts.join('')}</section>` : '';
}

/** ผู้ดูแล: ลิงก์ไปแก้ข้อมูลส่วนนี้ใน ตั้งค่า › ฐานข้อมูลยา (เปิดฟอร์มของรายการนั้นให้เลย) */
const EDIT_TAB = { local: 'local', mono: 'nlem', fda: 'fda', ddi: 'ddi' };
const editLink = (key) => (isAdmin() ? `<a class="btn btn-o btn-sm mono-edit" href="#/admin/drugs/${EDIT_TAB[key.split(':')[0]] || 'local'}" data-edit-drug="${esc(key)}">แก้ไขข้อมูลนี้</a>` : '');
/** ข้อความในฉลาก openFDA: ขึ้นต้นด้วย • หลายข้อ → รายการ */
const fdaBody = (t) => { const p = String(t).split(/\s*•\s*/).map((x) => x.trim()).filter(Boolean); return p.length > 1 ? `<ul>${p.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p>${esc(t)}</p>`; };
const FDA_OPEN = new Set(['คำเตือนกรอบดำ', 'ข้อบ่งใช้', 'ขนาดยาและวิธีใช้', 'ข้อห้ามใช้']);
// เรียงหัวข้อให้อ่านง่าย: เรื่องที่ต้องรู้ก่อนใช้ยาขึ้นก่อน
const FDA_ORDER = ['คำเตือนกรอบดำ', 'ข้อบ่งใช้', 'ขนาดยาและวิธีใช้', 'ข้อห้ามใช้', 'คำเตือนและข้อควรระวัง', 'Drug interaction', 'อาการไม่พึงประสงค์', 'การใช้ในหญิงตั้งครรภ์/ให้นมบุตร เด็ก ผู้สูงอายุ', 'กลไกการออกฤทธิ์', 'เภสัชจลนศาสตร์', 'การได้รับยาเกินขนาด', 'การเก็บรักษา'];
const fdaRank = (t) => { const i = FDA_ORDER.indexOf(t); return i < 0 ? 99 : i; };
function fdaCard(f) {
  const e = /^\d{8}$/.test(f.effective || '') ? `${+f.effective.slice(6, 8)}/${+f.effective.slice(4, 6)}/${+f.effective.slice(0, 4) + 543}` : '';
  const th = f.sections_th?.length ? f.sections_th : null;
  const en = new Map((f.sections || []).map((x) => [x.title, x.body]));
  const titles = [...new Set([...(th || []).map((x) => x.title), ...en.keys()])].sort((a, b) => fdaRank(a) - fdaRank(b));
  return '<section class="mono-card mono-fda"><div class="mono-sec"><h4>ข้อมูลจากฉลากยาสหรัฐอเมริกา (openFDA)</h4>'
    + `<p class="small muted">${esc(f.title || f.generic)} · ${th ? (f.th_reviewed ? 'แปลเป็นภาษาไทย · ผู้ดูแลตรวจแล้ว' : 'แปลและเรียบเรียงเป็นภาษาไทยโดย AI · โปรดตรวจกับต้นฉบับก่อนใช้') : 'ภาษาอังกฤษตามต้นฉบับ'} · ขนาดยาและข้อบ่งใช้ในสหรัฐฯ อาจต่างจากประเทศไทย</p></div>`
    + titles.map((t) => {
      const tx = th?.find((x) => x.title === t), body = en.get(t);
      const enHtml = body ? `<div lang="en">${fdaBody(body)}</div>` : '';
      return `<details class="mono-fold"${FDA_OPEN.has(t) ? ' open' : ''}><summary>${esc(t)}</summary>`
        + (tx ? `<ul>${(tx.body || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${enHtml ? `<details class="mono-en"><summary>ต้นฉบับภาษาอังกฤษ</summary>${enHtml}</details>` : ''}` : enHtml)
        + '</details>';
    }).join('')
    + `<p class="small muted">ที่มา: openFDA${e ? ` · ฉลากปรับปรุง ${e}` : ''}${f.set_id ? ` · <a href="https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${encodeURIComponent(f.set_id)}" target="_blank" rel="noopener">อ่านฉลากเต็ม (DailyMed)</a>` : ''}</p>${editLink(`fda:${f.id}`)}</section>`;
}
function closeMono() {
  $('#doseMono').hidden = true; $('#doseInfoPick').hidden = false;
}
const num = (n) => (n == null || n === '' ? '' : String(+n));
/** ข้อความขนาดยาของข้อบ่งใช้ เช่น "10–15 มก./กก./ครั้ง · สูงสุด 500 มก./ครั้ง" */
function doseText(i) {
  if (!(+i.min > 0 || +i.max > 0)) return '-';
  const r = num(i.min) === num(i.max) || !+i.max ? num(i.min || i.max) : `${num(i.min)}–${num(i.max)}`;
  return i.per === 'day'
    ? `${r} ${i.unit === 'mcg' ? 'mcg' : 'มก.'}/กก./วัน${i.basis ? ` (คิดจาก ${i.basis})` : ''}${i.times ? ` แบ่งให้วันละ ${[i.times, ...(i.times_alt || [])].map(num).join(' หรือ ')} ครั้ง` : ''}`
    : `${r} ${i.unit === 'mcg' ? 'mcg' : 'มก.'}/กก./ครั้ง${i.basis ? ` (คิดจาก ${i.basis})` : ''}${i.cap ? ` · สูงสุด ${num(i.cap)} ${i.unit === 'mcg' ? 'mcg' : 'มก.'}/ครั้ง` : ''}`;
}
