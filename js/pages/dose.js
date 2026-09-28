// เครื่องคำนวณขนาดยาตามน้ำหนักตัว (รายการยามาจากตาราง dose_drugs — ผู้ดูแลแก้ได้)
import { sb } from '../supabase.js?v=4.4';
import { $, esc } from '../util.js?v=4.4';

let drugs = null, bound = false;

/** ให้โหลดรายการยาใหม่ครั้งถัดไป (เรียกหลังผู้ดูแลแก้รายการยา) */
export function resetDose() { drugs = null; }

export async function initDose() {
  if (drugs) return;
  const sel = $('#doseDrug');
  sel.innerHTML = '<option>กำลังโหลด…</option>';
  const { data, error } = await sb.from('dose_drugs').select('*').eq('active', true).order('sort');
  drugs = error ? [] : data;
  sel.innerHTML = drugs.length ? drugs.map((d, i) => `<option value="${i}">${esc(d.name)}</option>`).join('') : '<option value="">ยังไม่มีรายการยา</option>';
  fillConc(); toggleRenal(); render();
  if (bound) return;
  bound = true;
  ['doseWeight', 'doseHeight', 'doseAge', 'doseCr'].forEach((id) => $('#' + id).addEventListener('input', render));
  ['doseConc', 'doseRenal', 'doseSex'].forEach((id) => $('#' + id).addEventListener('change', render));
  sel.addEventListener('change', () => { fillConc(); render(); });
  $('#doseRenalAdjust').addEventListener('change', () => { toggleRenal(); render(); });
}

function drug() { return drugs?.[+$('#doseDrug').value || 0]; }
function fillConc() {
  const d = drug();
  $('#doseConc').innerHTML = (d?.concs || []).map((c, i) => `<option value="${i}">${esc(c.label)}</option>`).join('');
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
const rng = (a, b, dp) => (a.toFixed(dp) === b.toFixed(dp) ? a.toFixed(dp) : `${a.toFixed(dp)}–${b.toFixed(dp)}`);
const fig = (n, t) => `<div class="fig"><div class="n num">${n}</div><div class="t">${t}</div></div>`;

function render() {
  const out = $('#doseResult');
  const w = +$('#doseWeight').value, d = drug();
  if (!(w > 0) || !d) { out.innerHTML = '<p class="small muted">กรอกน้ำหนักตัวและเลือกรายการยาเพื่อคำนวณ</p>'; return; }
  const c = (d.concs || [])[+$('#doseConc').value || 0];
  /** ขนาดยาของข้อบ่งใช้ i สำหรับน้ำหนัก w */
  const doseOf = (i) => {
    let minMg, maxMg, label;
    if (i.per !== 'day') {
      minMg = w * i.min; maxMg = w * i.max;
      if (i.cap) { minMg = Math.min(minMg, i.cap); maxMg = Math.min(maxMg, i.cap); }
      label = 'ต่อครั้ง';
    } else {
      const dayMin = w * i.min, dayMax = w * i.max, n = i.times || 1;
      minMg = dayMin / n; maxMg = dayMax / n;
      label = `ต่อครั้ง (แบ่งจากขนาดรวม ${dayMin.toFixed(0)}–${dayMax.toFixed(0)} มก./วัน)`;
    }
    let vol = '';
    if (c?.mgPer5ml) vol = fig(`${rng(minMg / c.mgPer5ml * 5, maxMg / c.mgPer5ml * 5, 1)} มล.`, `ปริมาณยา (${esc(c.label)}) ${label}`);
    else if (c?.mgPerMl) vol = fig(`${rng(minMg / c.mgPerMl, maxMg / c.mgPerMl, 2)} มล.`, `ปริมาณยา (${esc(c.label)}) ${label}`);
    else if (c?.mgPerTab) vol = fig(`${rng(minMg / c.mgPerTab, maxMg / c.mgPerTab, 2)} เม็ด/แคปซูล`, `จาก ${esc(c.label)} ${label}`);
    return fig(`${rng(minMg, maxMg, 0)} มก.`, `ขนาดยา ${label}`) + vol
      + `<p class="small muted">ความถี่: ${esc(i.freq || '-')}</p>`
      + (i.renal ? `<p class="small" style="color:var(--warning)"><b>ขนาดยาในโรคไต:</b> ${esc(i.renal)}</p>` : '');
  };
  const inds = indsOf(d);

  const h = +$('#doseHeight').value;
  const bmi = h > 0 ? fig((w / Math.pow(h / 100, 2)).toFixed(1), `BMI (น้ำหนัก ${w} กก. ส่วนสูง ${h.toFixed(0)} ซม.)`) : '';

  let renal = 'normal', crclNote = '';
  if ($('#doseRenalAdjust').checked) {
    const age = +$('#doseAge').value, cr = +$('#doseCr').value;
    if (age > 0 && cr > 0) {
      let crcl = ((140 - age) * w) / (72 * cr);
      if ($('#doseSex').value === 'f') crcl *= 0.85;
      $('#doseCrClOut').value = crcl.toFixed(1) + ' มล./นาที';
      renal = crcl >= 60 ? 'normal' : crcl >= 30 ? 'mild' : crcl >= 10 ? 'moderate' : 'severe';
      crclNote = `<p class="small muted">คำนวณจาก Cockcroft-Gault: CrCl ≈ ${crcl.toFixed(1)} มล./นาที</p>`;
    } else $('#doseCrClOut').value = '';
  } else renal = $('#doseRenal').value;

  const labels = { mild: 'ไตเสื่อมเล็กน้อย–ปานกลาง (CrCl 30–60 มล./นาที)', moderate: 'ไตเสื่อมปานกลาง–รุนแรง (CrCl 10–30 มล./นาที)', severe: 'ไตเสื่อมรุนแรง / ฟอกไต (CrCl <10 มล./นาที)' };
  let alert = '';
  if (renal !== 'normal') {
    alert = `<div class="alert"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>`
      + `<div><b>ขนาดยาในโรคไต — ${esc(labels[renal])}</b><div class="small">${inds.some((i) => i.renal) ? 'ดูคำแนะนำ "ขนาดยาในโรคไต" ของแต่ละข้อบ่งใช้ด้านล่าง' : 'ยานี้ยังไม่มีคำแนะนำการปรับขนาดยาในโรคไตในระบบ กรุณาปรึกษาเภสัชกรก่อนใช้'}</div>${crclNote}</div></div>`;
  } else if (crclNote) alert = '<p class="small muted">การทำงานของไตปกติ (CrCl ≥ 60 มล./นาที) — ไม่จำเป็นต้องปรับขนาดยา</p>';

  const title = (i, k) => `ข้อบ่งใช้${inds.length > 1 ? ' ' + (k + 1) : ''}: ${esc(i.name || '-')}`;
  out.innerHTML = alert
    + (inds.length > SHOW_OPEN ? `<p class="small muted">ยานี้มี ${inds.length} ข้อบ่งใช้ · แสดง ${SHOW_OPEN} ข้อแรก ที่เหลือกดเพื่อดูขนาดยา</p>` : '')
    + '<div class="ind-results">' + inds.map((i, k) => (k < SHOW_OPEN
      ? `<section class="ind-result"><h4>${title(i, k)}</h4>${doseOf(i)}</section>`
      : `<details class="ind-result"><summary>${title(i, k)}</summary>${doseOf(i)}</details>`)).join('') + '</div>'
    + bmi
    + '<p class="small muted">ตัวเลขนี้เป็นการประมาณตามช่วงขนาดยาทั่วไป โปรดตรวจสอบกับเอกสารกำกับยา/แนวทางการรักษาและดุลยพินิจทางคลินิกก่อนใช้จริงเสมอ</p>';
}
