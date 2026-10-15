// ข้อมูลยา / คำนวณขนาดยา — 2 ส่วน (#doseTabs)
//   คำนวณขนาดยา: ตามน้ำหนักตัว (รายการยาจากตาราง dose_drugs — ผู้ดูแลแก้ได้)
//   ข้อมูลยา: monograph จากบัญชียาหลักแห่งชาติ พ.ศ. 2569 (ตาราง drug_monographs · 57_drug_monographs.sql · tools/nlem/)
//            ค้นหา/กรองกลุ่มยา → เลือกยา → กลุ่มยา รูปแบบยา บัญชี เงื่อนไข คำเตือน คำแนะนำ หมายเหตุ + ขนาดยาจากเครื่องคำนวณ (จับคู่ชื่ออังกฤษ)
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, errText } from '../util.js?v=4.4';

let drugs = null, bound = false;
let monos = null, items = null, shown = 40;   // ข้อมูลยา: รายการย่อจาก drug_monographs (โหลดเมื่อเปิดส่วนข้อมูลยา)

/** ให้โหลดรายการยาใหม่ครั้งถัดไป (เรียกหลังผู้ดูแลแก้รายการยา) */
export function resetDose() { drugs = null; items = null; }

export async function initDose() {
  if (drugs) return;
  const sel = $('#doseDrug');
  sel.innerHTML = '<option>กำลังโหลด…</option>';
  const { data, error } = await sb.from('dose_drugs').select('*').eq('active', true).order('sort');
  drugs = error ? [] : data; items = null;
  sel.innerHTML = drugs.length ? drugs.map((d, i) => `<option value="${i}">${esc(d.name)}</option>`).join('') : '<option value="">ยังไม่มีรายการยา</option>';
  fillConc(); toggleRenal(); render();
  if (!$('#dosePaneInfo').hidden) openInfo();
  if (bound) return;
  bound = true;
  ['doseWeight', 'doseHeight', 'doseAge', 'doseCr'].forEach((id) => $('#' + id).addEventListener('input', render));
  ['doseConc', 'doseRenal', 'doseSex'].forEach((id) => $('#' + id).addEventListener('change', render));
  sel.addEventListener('change', () => { fillConc(); render(); });
  $('#doseRenalAdjust').addEventListener('change', () => { toggleRenal(); render(); });
  $('#doseTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-dt]'); if (b) showTab(b.dataset.dt); });
  $('#doseInfoQ').addEventListener('input', () => { shown = 40; renderList(); });
  $('#doseInfoGroup').addEventListener('change', () => { shown = 40; renderList(); });
  $('#doseInfoMore').addEventListener('click', () => { shown += 60; renderList(); });
  $('#doseInfoList').addEventListener('click', (e) => { const b = e.target.closest('[data-mono]'); if (b) openMono(+b.dataset.mono); });
  $('#doseMono').addEventListener('click', (e) => {
    if (e.target.closest('[data-mono-back]')) { closeMono(); return; }
    const b = e.target.closest('[data-dose-calc]'); if (!b) return;
    $('#doseDrug').value = b.dataset.doseCalc; fillConc(); render(); showTab('calc');
    $('#doseWeight').focus();
  });
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
  if (t === 'info') openInfo();
}
/** ชื่ออังกฤษของยาในเครื่องคำนวณ เช่น "พาราเซตามอล (Paracetamol)" → "paracetamol" */
const latinOf = (name) => { const m = String(name).match(/\(([^()]*[A-Za-z][^()]*)\)/); return (m ? m[1] : /[A-Za-z]/.test(name) ? name : '').trim().toLowerCase(); };
/** ชื่อยาในบัญชี → ชื่อสำหรับจับคู่: "Paracetamol (Acetaminophen)" → ["paracetamol", "acetaminophen"] */
const keysOf = (name) => String(name).toLowerCase().split(/[()]/).map((x) => x.trim()).filter(Boolean);
const sameDrug = (key, dk) => !!dk && (key === dk || (key.startsWith(dk + ' ') && !key.includes('+')));

async function openInfo() {
  if (items) { renderList(); return; }
  $('#doseInfoN').textContent = '';
  $('#doseInfoList').innerHTML = '<div class="skeleton"></div><div class="skeleton" style="width:70%;margin-top:10px"></div>';
  if (!monos) {
    const all = [];
    for (let from = 0; ; from += 1000) {   // Supabase ส่งได้ครั้งละ ≤ 1000 แถว
      const { data, error } = await sb.from('drug_monographs').select('id,name,group_no,group_name,sub_code,sub_name,forms,sort').order('sort').range(from, from + 999);
      if (error) { $('#doseInfoList').innerHTML = '<p class="empty">โหลดข้อมูลยาไม่สำเร็จ กรุณาลองใหม่</p>'; toast(errText(error), 'err'); return; }
      all.push(...data);
      if (data.length < 1000) break;
    }
    monos = all;
  }
  // รวมรายการชื่อเดียวกัน (ยาเดียวอยู่หลายกลุ่มยา) + ผูกยาในเครื่องคำนวณ
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
  const groups = new Map(monos.map((m) => [m.group_no, m.group_name]));
  $('#doseInfoGroup').innerHTML = '<option value="all">ทุกกลุ่มยา</option>'
    + [...groups].sort((a, b) => a[0] - b[0]).map(([n, g]) => `<option value="${n}">กลุ่มยา ${n} ${esc(g)}</option>`).join('');
  renderList();
}
const acctChips = (forms) => [...new Set((forms || []).map((f) => f.acct).filter(Boolean))]
  .map((a) => `<span class="chip c-role" title="${esc(ACCT[a] || a)}">${esc(a)}</span>`).join('');

function renderList() {
  const box = $('#doseInfoList');
  if (!items) return;
  const q = $('#doseInfoQ').value.trim().toLowerCase(), g = $('#doseInfoGroup').value;
  const list = items.filter((it) => (!q || it.q.includes(q)) && (g === 'all' || it.rows.some((r) => String(r.group_no) === g)));
  $('#doseInfoN').textContent = list.length ? `พบ ${list.length} รายการ · กดชื่อยาเพื่อดูข้อมูล` : '';
  box.innerHTML = !items.length ? '<p class="empty">ยังไม่มีข้อมูลยา</p>' : !list.length ? '<p class="empty">ไม่พบยาที่ค้นหา</p>'
    : list.slice(0, shown).map((it) => {
      const r = it.rows[0];
      const where = r ? `${esc(r.sub_code)} ${esc(r.sub_name || r.group_name)}${it.rows.length > 1 ? ` · และอีก ${it.rows.length - 1} กลุ่ม` : ''}` : 'ยาในเครื่องคำนวณขนาดยา';
      return `<button type="button" class="di-item" data-mono="${items.indexOf(it)}"><span class="di-nm">${esc(it.name)}</span>`
        + `<span class="di-sub small muted">${where}</span><span class="di-chips">${it.rows.length ? acctChips(it.rows.flatMap((x) => x.forms)) : ''}`
        + `${it.calc.length ? '<span class="chip c-on">คำนวณขนาดยาได้</span>' : ''}</span></button>`;
    }).join('');
  $('#doseInfoMore').hidden = list.length <= shown;
  if (list.length > shown) $('#doseInfoMore').textContent = `แสดงเพิ่ม (เหลืออีก ${list.length - shown} รายการ)`;
}

const para = (lines) => (lines.length === 1 ? `<p>${esc(lines[0])}</p>` : `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`);
async function openMono(i) {
  const it = items?.[i]; if (!it) return;
  const box = $('#doseMono');
  $('#doseInfoPick').hidden = true; box.hidden = false;
  box.innerHTML = '<div class="skeleton"></div><div class="skeleton" style="width:60%;margin-top:10px"></div>';
  let rows = [];
  if (it.rows.length) {
    const { data, error } = await sb.from('drug_monographs').select('*').in('id', it.rows.map((r) => r.id)).order('sort');
    if (error) { toast(errText(error), 'err'); closeMono(); return; }
    rows = data;
  }
  // รายการที่เนื้อหาเหมือนกัน (ยาเดียวกันอยู่หลายกลุ่มยา) แสดงรวมกล่องเดียว
  const cards = [];
  for (const r of rows) {
    const sig = JSON.stringify([r.forms, r.sections, r.flags]);
    const c = cards.find((x) => x.sig === sig);
    if (c) c.rows.push(r); else cards.push({ sig, rows: [r] });
  }
  const flags = [...new Set(rows.flatMap((r) => r.flags || []))];
  const dose = it.calc.map((k) => drugs[k]).filter(Boolean).map((d, n) => `<div class="mono-dose"><b>${esc(d.name)}</b>`
    + (d.concs?.length ? `<div class="small muted">ความแรงที่มี: ${d.concs.map((c) => esc(c.label)).join(' · ')}</div>` : '')
    + `<ul>${indsOf(d).map((x) => `<li><b>${esc(x.name || 'ข้อบ่งใช้')}</b>: ${esc(doseText(x))}${x.freq ? ` · ${esc(x.freq)}` : ''}`
      + (x.renal ? `<div class="small di-renal"><b>ขนาดยาในโรคไต:</b> ${esc(x.renal)}</div>` : '') + '</li>').join('')}</ul>`
    + `<button type="button" class="btn btn-p di-calc" data-dose-calc="${it.calc[n]}">คำนวณขนาดยานี้ตามน้ำหนักตัว</button></div>`).join('');
  box.innerHTML = '<button type="button" class="btn btn-o di-back" data-mono-back>‹ กลับไปรายการยา</button>'
    + `<h3 class="mono-name">${esc(it.name)}</h3>`
    + (flags.length ? `<div class="di-chips">${flags.map((f) => `<span class="chip c-fix">${esc(f)}</span>`).join('')}</div>` : '')
    + cards.map(({ rows: rs }) => {
      const r = rs[0];
      return '<section class="mono-card">'
        + `<div class="mono-sec"><h4>กลุ่มยา</h4><ul>${rs.map((x) => `<li>กลุ่มยา ${x.group_no} ${esc(x.group_name)} › ${esc(x.sub_code)} ${esc(x.sub_name)}</li>`).join('')}</ul></div>`
        + `<div class="mono-sec"><h4>รูปแบบยา / บัญชี</h4><ul>${(r.forms || []).map((f) => `<li>${esc(f.form || '-')} ${f.acct ? `<span class="chip c-role">${esc(f.acct)}</span> <span class="small muted">${esc(ACCT[f.acct] || '')}</span>` : ''}</li>`).join('')}</ul></div>`
        + (r.sections || []).map((x) => `<div class="mono-sec"><h4>${esc(x.title)}</h4>${para(x.body || [])}</div>`).join('')
        + `<p class="small muted">ที่มา: บัญชียาหลักแห่งชาติ พ.ศ. ๒๕๖๙ · <a href="${NLEM_PDF}#page=${+r.page || 1}" target="_blank" rel="noopener">ราชกิจจานุเบกษา (PDF หน้า ${+r.page || '-'})</a></p>`
        + '</section>';
    }).join('')
    + (dose ? `<section class="mono-card"><div class="mono-sec"><h4>ขนาดยา (จากเครื่องคำนวณขนาดยาของเว็บนี้)</h4>${dose}</div></section>`
      : '<p class="small muted">บัญชียาหลักแห่งชาติระบุขนาดยาเฉพาะบางรายการ (อยู่ในเงื่อนไข/หมายเหตุ) · ขนาดยา อาการไม่พึงประสงค์ และยาตีกัน โปรดดูเอกสารกำกับยา</p>')
    + (rows.length ? '' : '<p class="small muted">ยานี้ยังไม่มีข้อมูลในบัญชียาหลักแห่งชาติที่บันทึกไว้</p>')
    + (rows.length ? `<details class="mono-abbr"><summary>คำย่อ</summary><p class="small">บัญชี: ${Object.entries(ACCT).map(([k, v]) => `${k} = ${v}`).join(' · ')}</p><p class="small">${ABBR}</p></details>` : '');
  box.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
    ? `${r} มก./กก./วัน${i.times ? ` แบ่งให้วันละ ${num(i.times)} ครั้ง` : ''}`
    : `${r} มก./กก./ครั้ง${i.cap ? ` · สูงสุด ${num(i.cap)} มก./ครั้ง` : ''}`;
}
