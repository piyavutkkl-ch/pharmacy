// ชุดทดสอบ Audit (ระยะที่ 1 · ไม่แก้โค้ด Production): ฟังก์ชันคำนวณบริสุทธิ์ใน js/pages/dose.js
//   - kidney(): Cockcroft-Gault / CKD-EPI 2021 / Bedside Schwartz
//   - strengthOf(): ความแรงของยา รพ.สต. (ข้อมูลเชิงโครงสร้าง หรืออ่านจากชื่อยา)
// ค่าคาดหวังมาจากการคำนวณอิสระตามสมการต้นฉบับ (ref* ด้านล่าง) ไม่ใช้ผลของระบบเป็นค่ามาตรฐาน
// ใช้: node audit/dose/unit.mjs [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/pages/dose.js'), 'utf8');
// โหลดโมดูลจริงโดยตัด import (DOM/Supabase) ออก — ฟังก์ชันที่ทดสอบไม่ใช้ของเหล่านั้น
const body = SRC.replace(/^import .*$/gm, '').replace(/^export (?=(async )?function|const)/gm, '');
const mod = new Function('$', 'esc', 'toast', 'errText', 'sb', 'isAdmin', 'estimateWeight', 'renderGrowth', 'initFluid', 'initDdi', 'resetDdi',
  `${body}\nreturn { kidney, strengthOf };`)(() => null, (s) => String(s), () => {}, (e) => String(e), null, () => false, () => null, () => {}, () => {}, () => {}, () => {});

/* ---------- สมการอ้างอิง (เขียนแยกจากโค้ดระบบ) ---------- */
// Cockcroft DW, Gault MH. Nephron 1976;16:31-41 — CrCl (mL/min) = (140-age) × wt(kg) / (72 × SCr mg/dL) × 0.85 (หญิง)
const refCG = (age, wt, scr, female) => ((140 - age) * wt / (72 * scr)) * (female ? 0.85 : 1);
// Devine BJ. Drug Intell Clin Pharm 1974;8:650 — IBW = 50 (ชาย) / 45.5 (หญิง) + 2.3 × (นิ้วที่เกิน 60)
const refIBW = (hcm, female) => (female ? 45.5 : 50) + 2.3 * (hcm / 2.54 - 60);
// AdjBW = IBW + 0.4 × (TBW − IBW) (ตามที่ MDCalc "Creatinine Clearance (Cockcroft-Gault Equation)" อธิบาย)
const refAdj = (ibw, w) => ibw + 0.4 * (w - ibw);
// Inker LA et al. NEJM 2021;385:1737-49 — CKD-EPI 2021 (race-free)
const refCKD = (age, scr, female) => {
  const k = female ? 0.7 : 0.9, a = female ? -0.241 : -0.302;
  return 142 * Math.min(scr / k, 1) ** a * Math.max(scr / k, 1) ** -1.2 * 0.9938 ** age * (female ? 1.012 : 1);
};
// Schwartz GJ et al. JASN 2009;20:629-37 — Bedside: eGFR = 0.413 × height(cm) / SCr(mg/dL)
const refSchwartz = (h, scr) => 0.413 * h / scr;

const results = [];
const near = (a, b, tol = 0.05) => a != null && Math.abs(a - b) <= tol;
function t(id, fn, input, expected, unit, ref, why, actual, ok, risk, note = '') {
  results.push({ id, fn, input, expected, unit, ref, why, actual, status: ok === null ? 'UNVERIFIED' : ok ? 'PASS' : 'FAIL', risk, note });
}
const K = (o) => mod.kidney(o);

/* ===== 3.1 Cockcroft-Gault ===== */
{ const r = K({ method: 'crcl', age: 60, w: 72, h: 0, cr: 1.0, female: false });
  t('CG-01', 'kidney(crcl)', 'ชาย 60 ปี 72 กก. SCr 1.0 (ไม่ใส่ส่วนสูง)', 80, 'mL/min', 'Cockcroft-Gault 1976', '(140−60)×72/(72×1.0)=80 คำนวณมือได้', r.v, near(r.v, 80), 'High'); }
{ const r = K({ method: 'crcl', age: 60, w: 72, h: 0, cr: 1.0, female: true });
  t('CG-02', 'kidney(crcl)', 'หญิง 60 ปี 72 กก. SCr 1.0', 68, 'mL/min', 'Cockcroft-Gault 1976 (×0.85)', '80×0.85=68', r.v, near(r.v, 68), 'High'); }
{ const h = 175, w = 70, ibw = refIBW(h, false), exp = refCG(45, Math.min(ibw, w), 1.2, false), r = K({ method: 'crcl', age: 45, w, h, cr: 1.2, female: false });
  t('CG-03', 'kidney(crcl)', 'ชาย 45 ปี 70 กก. 175 ซม. (BMI 22.9) SCr 1.2', +exp.toFixed(2), 'mL/min', 'Devine IBW + MDCalc weight rule', 'BMI ปกติ → ใช้ IBW (หรือน้ำหนักจริงถ้าน้อยกว่า)', r.v, near(r.v, exp), 'High'); }
{ const h = 160, w = 95, ibw = refIBW(h, true), exp = refCG(55, refAdj(ibw, w), 1.0, true), r = K({ method: 'crcl', age: 55, w, h, cr: 1.0, female: true });
  t('CG-04', 'kidney(crcl)', 'หญิง 55 ปี 95 กก. 160 ซม. (BMI 37.1) SCr 1.0', +exp.toFixed(2), 'mL/min', 'MDCalc: BMI ≥ 25 → AdjBW', 'AdjBW = IBW + 0.4(TBW−IBW)', r.v, near(r.v, exp), 'High'); }
{ const r = K({ method: 'crcl', age: 70, w: 40, h: 160, cr: 0.8, female: true }), exp = refCG(70, 40, 0.8, true);
  t('CG-05', 'kidney(crcl)', 'หญิง 70 ปี 40 กก. 160 ซม. (BMI 15.6)', +exp.toFixed(2), 'mL/min', 'MDCalc: BMI < 18.5 → น้ำหนักจริง', 'underweight ใช้ TBW', r.v, near(r.v, exp), 'High'); }
{ const r = K({ method: 'crcl', age: 60, w: 70, h: 0, cr: 0, female: false });
  t('CG-06', 'kidney(crcl)', 'SCr = 0', 'ปฏิเสธ (ไม่มีค่า)', '-', 'ความปลอดภัยของข้อมูลนำเข้า', 'หารด้วยศูนย์', r.v ?? r.msg, r.v == null, 'High'); }
{ const r = K({ method: 'crcl', age: 60, w: 70, h: 0, cr: -1, female: false });
  t('CG-07', 'kidney(crcl)', 'SCr ติดลบ', 'ปฏิเสธ', '-', 'ความปลอดภัยของข้อมูลนำเข้า', 'ค่าทางชีวภาพเป็นลบไม่ได้', r.v ?? r.msg, r.v == null, 'High'); }
{ const r = K({ method: 'crcl', age: 60, w: 70, h: 0, cr: NaN, female: false });
  t('CG-08', 'kidney(crcl)', 'SCr = NaN', 'ปฏิเสธ', '-', 'ความปลอดภัยของข้อมูลนำเข้า', 'ข้อมูลผิดรูปแบบ', r.v ?? r.msg, r.v == null, 'High'); }
{ const r = K({ method: 'crcl', age: 0, w: 70, h: 0, cr: 1, female: false });
  t('CG-09', 'kidney(crcl)', 'อายุไม่ได้กรอก (0)', 'ปฏิเสธ + บอกให้กรอกอายุ', '-', 'ข้อมูลไม่ครบ', 'สูตรต้องใช้อายุ', r.v ?? r.msg, r.v == null, 'High'); }
{ const r = K({ method: 'crcl', age: 150, w: 70, h: 0, cr: 1, female: false });
  t('CG-10', 'kidney(crcl)', 'อายุ 150 ปี (ค่าไม่สมเหตุสมผล)', 'ปฏิเสธ (อายุเกินช่วงที่สมการใช้ได้)', '-', 'ความปลอดภัยของข้อมูลนำเข้า', '(140−150) < 0 → CrCl ติดลบ', r.v ?? r.msg, r.v == null, 'High', 'ระบบคืนค่าติดลบ → ถูกจัดเป็น "severe"'); }
{ const r = K({ method: 'crcl', age: 60, w: 70, h: 0, cr: 88, female: false });
  t('CG-11', 'kidney(crcl)', 'SCr = 88 (ผู้ใช้กรอกหน่วย µmol/L ในช่อง mg/dL)', 'ปฏิเสธ/เตือนว่าค่าเกินช่วง mg/dL ที่เป็นไปได้ หรือมีตัวเลือกหน่วย', '-', 'หน่วย SCr: 1 mg/dL = 88.4 µmol/L', 'ค่าที่ไม่สมเหตุสมผลต้องไม่ถูกคำนวณเงียบ ๆ', r.v ?? r.msg, r.v == null, 'High', 'ระบบรับเฉพาะ mg/dL ไม่มีตัวเลือก µmol/L และไม่ตรวจช่วงค่า'); }
{ const r = K({ method: 'crcl', age: 10, w: 30, h: 135, cr: 0.5, female: false });
  t('CG-12', 'kidney(crcl)', 'เด็ก 10 ปี (CrCl Cockcroft-Gault)', 'ไม่ให้ผล CrCl เชิงตัวเลขในเด็ก (หรือบังคับใช้สูตรเด็ก)', '-', 'Cockcroft-Gault พัฒนาจากผู้ใหญ่', 'สูตรผู้ใหญ่ไม่ควรใช้จัดกลุ่มการทำงานของไตในเด็ก', r.v ?? r.msg, r.v == null, 'Medium', 'ระบบคำนวณและนำไปจัดกลุ่มไต พร้อมหมายเหตุเท่านั้น'); }
{ const r = K({ method: 'crcl', age: 60, w: 80, h: 100, cr: 1, female: false }), ibw = refIBW(100, false);
  t('CG-13', 'kidney(crcl)', 'ผู้ใหญ่สูง 100 ซม. 80 กก. (IBW Devine ติดลบ/ต่ำผิดปกติ)', 'ไม่ใช้ IBW ที่ ≤ 0 หรือเตือนว่า IBW ใช้ไม่ได้กับคนสูง < 152 ซม.', '-', 'Devine IBW ไม่ได้ออกแบบสำหรับความสูง < 5 ฟุต', `IBW = ${ibw.toFixed(1)} กก.`, `${r.v?.toFixed(2)} · ${r.note}`, /ส่วนสูงต่ำกว่า 152/.test(r.note || '') ? true : null, 'Medium', 'ต้องให้เภสัชกรกำหนดเกณฑ์ (ไม่มีแหล่งอ้างอิงเดียวที่ยืนยันได้)'); }

/* ===== 3.2 eGFR ===== */
{ const r = K({ method: 'egfr', age: 50, w: 70, h: 0, cr: 1.0, female: false }), exp = refCKD(50, 1.0, false);
  t('EG-01', 'kidney(egfr)', 'ชาย 50 ปี SCr 1.0', +exp.toFixed(2), 'mL/min/1.73m²', 'CKD-EPI 2021 (Inker NEJM 2021)', 'κ=0.9 α=−0.302', r.v, near(r.v, exp), 'High'); }
{ const r = K({ method: 'egfr', age: 65, w: 60, h: 0, cr: 0.6, female: true }), exp = refCKD(65, 0.6, true);
  t('EG-02', 'kidney(egfr)', 'หญิง 65 ปี SCr 0.6 (ต่ำกว่า κ)', +exp.toFixed(2), 'mL/min/1.73m²', 'CKD-EPI 2021', 'ใช้ α=−0.241 ช่วง SCr<κ และ ×1.012', r.v, near(r.v, exp), 'High'); }
{ const r = K({ method: 'egfr', age: 75, w: 60, h: 0, cr: 2.5, female: false }), exp = refCKD(75, 2.5, false);
  t('EG-03', 'kidney(egfr)', 'ชาย 75 ปี SCr 2.5 (เกิน κ)', +exp.toFixed(2), 'mL/min/1.73m²', 'CKD-EPI 2021', 'ใช้เลขชี้กำลัง −1.200', r.v, near(r.v, exp), 'High'); }
{ const r = K({ method: 'egfr', age: 8, w: 25, h: 128, cr: 0.5, female: false }), exp = refSchwartz(128, 0.5);
  t('EG-04', 'kidney(egfr) เด็ก', 'เด็ก 8 ปี 128 ซม. SCr 0.5', +exp.toFixed(2), 'mL/min/1.73m²', 'Bedside Schwartz (Schwartz JASN 2009)', '0.413×128/0.5', r.v, near(r.v, exp), 'High'); }
{ const r = K({ method: 'egfr', age: 8, w: 25, h: 0, cr: 0.5, female: false });
  t('EG-05', 'kidney(egfr) เด็ก', 'เด็กไม่กรอกส่วนสูง', 'ปฏิเสธ + บอกให้กรอกส่วนสูง', '-', 'Bedside Schwartz ต้องใช้ส่วนสูง', 'ข้อมูลไม่ครบ', r.v ?? r.msg, r.v == null, 'High'); }
{ const r = K({ method: 'egfr', age: 0.25, w: 5, h: 60, cr: 0.3, female: false });
  t('EG-06', 'kidney(egfr) ทารก', 'ทารก 3 เดือน (Bedside Schwartz)', 'ไม่ใช้/เตือน: Bedside Schwartz พัฒนาจากเด็ก 1–16 ปี', '-', 'Schwartz 2009 (กลุ่มตัวอย่าง CKiD 1–16 ปี)', 'นอกช่วงที่สมการรองรับ', r.v ?? r.msg, r.v == null, 'Medium', 'ระบบคำนวณให้โดยไม่เตือน'); }
{ const r = K({ method: 'egfr', age: 50, w: 70, h: 0, cr: 1.0, female: false });
  t('EG-07', 'kidney(egfr)', 'ระบุชื่อสูตรในผล', 'note ระบุ CKD-EPI 2021', '-', 'ข้อกำหนด 3.2', 'ต้องบอกแหล่งสูตร', r.note, /CKD-EPI 2021/.test(r.note || ''), 'Low'); }

/* ===== 5 ความแรง/หน่วย (strengthOf) ===== */
const S = (l) => mod.strengthOf(l);
{ const r = S({ name: 'PARACETAMOL 500 MG', unit: 'TAB' });
  t('ST-01', 'strengthOf', 'ชื่อ "PARACETAMOL 500 MG" หน่วย TAB', '500 มก./เม็ด', 'mg/tab', 'อ่านชื่อยา', 'ตัวเลขเดียวในชื่อ', JSON.stringify(r), r?.mg === 500 && r.per === 'tab', 'High'); }
{ const r = S({ name: 'AMOXICILLIN 250 MG/5 ML 60 ML', unit: 'BOT' });
  t('ST-02', 'strengthOf', '"AMOXICILLIN 250 MG/5 ML 60 ML"', '250 มก./5 มล.', 'mg/5mL', 'อ่านชื่อยา', 'รูปแบบยาน้ำ', JSON.stringify(r), r?.mg === 250 && r.per === '5ml', 'High'); }
{ const r = S({ name: 'X 100 MG/ML 15 ML', unit: 'BOT' });
  t('ST-03', 'strengthOf', '"X 100 MG/ML 15 ML"', '100 มก./มล.', 'mg/mL', 'อ่านชื่อยา', '"MG/ML" ไม่มีตัวเลขปริมาตร → 1 มล.', JSON.stringify(r), r?.mg === 100 && r.per === 'ml', 'High', 'ระบบต้องการตัวเลขหลัง MG/ จึงอ่านไม่ได้ (คืน null = ปลอดภัย แต่ใช้ไม่ได้)'); }
{ const r = S({ name: 'CO-TRIMOXAZOLE 400/80 MG', unit: 'TAB' });
  t('ST-04', 'strengthOf', '"CO-TRIMOXAZOLE 400/80 MG" (ไม่มีข้อมูลสารสำคัญเชิงโครงสร้าง)', 'ไม่คืนความแรงเดี่ยว (ต้องมี ingredients) หรือคืนทั้ง 400 และ 80', '-', 'หลักการข้อ 5.1/5.3', 'ยาสูตรผสมต้องแยกสาร', JSON.stringify(r), r == null || !!r?.ings, 'High', 'ระบบอ่านได้ 80 มก./เม็ด (ตัวเลขท้าย) ถ้ายังไม่ได้กรอก ingredients'); }
{ const r = S({ name: 'AMOX-CLAV 875/125 MG', unit: 'TAB' });
  t('ST-05', 'strengthOf', '"AMOX-CLAV 875/125 MG"', 'ไม่คืนความแรงเดี่ยว 125 มก.', '-', 'หลักการข้อ 5.3', 'ตัวเลขท้ายเป็นของ clavulanate', JSON.stringify(r), r == null || !!r?.ings, 'High'); }
{ const r = S({ name: 'LEVOTHYROXINE 50 MCG', unit: 'TAB' });
  t('ST-06', 'strengthOf', '"LEVOTHYROXINE 50 MCG" TAB', '0.05 มก./เม็ด', 'mg/tab', 'อ่านชื่อยา', 'MCG ÷ 1000', JSON.stringify(r), near(r?.mg, 0.05, 1e-9) && r.per === 'tab', 'High'); }
{ const r = S({ name: 'VITAMIN D 20000 IU', unit: 'CAP' });
  t('ST-07', 'strengthOf', '"VITAMIN D 20000 IU"', 'null (หน่วย IU ไม่ใช่ มก.)', '-', 'หลักการข้อ 5.5', 'ไม่ทราบหน่วย = ไม่แสดงผล', JSON.stringify(r), r == null, 'Medium'); }
{ const r = S({ name: 'FERROUS 1 G', unit: 'TAB' });
  t('ST-08', 'strengthOf', '"... 1 G" (กรัม)', '1000 มก./เม็ด หรือ null', '-', 'หน่วย g', 'ไม่ควรอ่านผิดเป็น 1 มก.', JSON.stringify(r), r == null || r.mg === 1000, 'Medium'); }
{ const r = S({ name: 'ORAL SUSP 125 MG/5 ML (หลังผสมน้ำ)', unit: 'BOT' });
  t('ST-09', 'strengthOf', 'ยาผงผสมน้ำ (อ่านจากชื่อ)', '125 มก./5 มล. หลังผสม', 'mg/5mL', 'ฉลากผลิตภัณฑ์', 'ระบบไม่มีฟิลด์ "หลังผสม" แยก', JSON.stringify(r), null, 'Medium', 'UNVERIFIED: ต้องยืนยันว่าฐานข้อมูลยา รพ.สต. เก็บความแรงหลังผสมเสมอ'); }
{ const r = S({ name: 'ANY', unit: 'TAB', strength: { mg: 325, per: 'tab' } });
  t('ST-10', 'strengthOf', 'มีความแรงเชิงโครงสร้าง (strength)', 'ใช้ค่าเชิงโครงสร้าง 325 มก./เม็ด', 'mg/tab', 'หลักการข้อ 5.1', 'โครงสร้างมาก่อนชื่อ', JSON.stringify(r), r?.mg === 325, 'High'); }
{ const r = S({ name: 'CO-TRIMOXAZOLE 400/80 MG', unit: 'TAB', ingredients: [{ name: 'Sulfamethoxazole', mg: 400, per: 'tab' }, { name: 'Trimethoprim', mg: 80, per: 'tab' }] });
  t('ST-11', 'strengthOf', 'ยาสูตรผสมที่กรอก ingredients', 'แยกสาร 400/80', '-', 'หลักการข้อ 5.3', 'ต้องเห็นสารแต่ละตัว', JSON.stringify(r), r?.ings?.length === 2 && r.ings[1].mg === 80, 'High'); }

const out = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2));
for (const r of results) console.log(`${r.status.padEnd(10)} ${r.id.padEnd(6)} [${r.risk}] ${r.input} → ระบบ: ${typeof r.actual === 'number' ? r.actual.toFixed(2) : r.actual} · คาดหวัง: ${r.expected}`);
const c = (s) => results.filter((r) => r.status === s).length;
console.log(`\nunit: PASS ${c('PASS')} · FAIL ${c('FAIL')} · UNVERIFIED ${c('UNVERIFIED')} (ทั้งหมด ${results.length})`);
