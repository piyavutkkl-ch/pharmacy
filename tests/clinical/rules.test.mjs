// ทดสอบกฎความปลอดภัยข้อมูลขนาดยา (js/pages/dose-rules.js) — ไม่ใช้เบราว์เซอร์/ฐานข้อมูล
//   กรณีทดสอบจำลองรูปแบบข้อผิดพลาดที่ผลตรวจ audit 22 ต.ค. 2569 พบ (C1–C9) · ตัวเลขเป็นข้อมูลทดสอบ ไม่ใช่ข้อมูลยาที่ใช้งาน
//   ค่าคาดหวังคิดด้วยมือ (เช่น 30 มก./กก. × 45 กก. = 1,350 มก. > 1,000 มก.)
// รัน: node --test tests/clinical/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indRules, drugRules, blockedInds, freqHints, nameAge, quoteDayMax, quoteDoses, topMg } from '../../js/pages/dose-rules.js';

const codes = (xs) => xs.map((x) => x.code);
const fails = (xs) => xs.filter((x) => x.sev === 'fail').map((x) => x.code);
const ok = { name: 'ไข้', per: 'dose', min: 10, max: 15, cap: 500, age_min: 0, age_max: 12, quote: '10 to 15 mg/kg every 4 to 6 hours' };

test('ข้อมูลครบและตรงฉลาก → ไม่มีข้อที่ไม่ผ่าน', () => {
  assert.deepEqual(fails(indRules(ok)), []);
  assert.deepEqual(fails(drugRules([ok, { name: 'ผู้ใหญ่', fixed: true, per: 'dose', min: 500, max: 1000, age_min: 12, quote: '500 to 1000 mg every 4 to 6 hours' }])), []);
});

test('C2: ฉลาก mg/kg/day แต่บันทึกเป็นต่อครั้ง → ไม่ผ่าน', () => {
  const i = { name: 'หอบหืด', per: 'dose', min: 10, max: 36, cap: 300, age_min: 1, age_max: 16, quote: 'usual dose 10-36 mg/kg/day' };
  assert.ok(fails(indRules(i)).includes('per_day'));
  assert.equal(quoteDoses(i.quote, i)[0].kind, 'day');
});

test('C3/C4: เพดานต่อวันอยู่ในช่องต่อครั้ง → ไม่ผ่าน (ทั้งกฎโครงสร้างและเทียบฉลาก)', () => {
  const i = { name: 'ความดันสูง', per: 'day', times: 2, min: 10, max: 65, cap: 3000, age_min: 0, age_max: 12, quote: 'initial 10 mg/kg/day in 2 to 4 doses; maximum of 65 mg/kg or 3 g daily' };
  const f = fails(indRules(i));
  assert.ok(f.includes('capday_req'));
  assert.ok(f.includes('cap_is_day'));
  assert.equal(quoteDayMax(i.quote, i), 3000);
  assert.ok(codes(indRules(i)).includes('wide'));   // 6.5 เท่า = เตือน
});

test('C6: ฉลาก divided doses แต่บันทึกวันละ 1 ครั้ง → ไม่ผ่าน', () => {
  const i = { name: 'ไอกรน', per: 'day', times: 1, min: 40, max: 50, cap_day: 2000, age_min: 0, age_max: 12, freq: 'แบ่งให้เป็นเวลา 5–14 วัน', quote: '40 to 50 mg/kg/day in divided doses' };
  assert.ok(fails(indRules(i)).includes('divided'));
  assert.equal(nameAge('ไอกรน (ให้ 5–14 วัน)'), null);   // ระยะเวลาให้ยา ไม่ใช่อายุ
});

test('ทุก 6 ชั่วโมงแต่บันทึกวันละ 2 ครั้ง → ไม่ผ่าน · ทุก 6–8 ชั่วโมง = วันละ 3–4 ครั้ง', () => {
  const i = { name: 'ติดเชื้อ', per: 'day', times: 2, min: 25, max: 50, cap_day: 2000, age_min: 0, age_max: 12, quote: '25 to 50 mg/kg/day given every 6 hours' };
  assert.ok(fails(indRules(i)).includes('times'));
  assert.deepEqual([...freqHints('every 6 to 8 hours')].sort(), [3, 4]);
  assert.deepEqual([...freqHints('แบ่งให้วันละ 3 มื้อ')], [3]);
  assert.equal(freqHints('as needed'), null);
});

test('C1: ช่วงอายุอยู่แค่ในชื่อ → ไม่ผ่าน · ชื่อ 0–3 เดือน = 0–0.25 ปี', () => {
  const i = { name: 'ทารก 0–3 เดือน', unit: 'mcg', fixed: false, per: 'day', times: 1, min: 10, max: 15, cap_day: 50 };
  assert.ok(fails(indRules(i)).includes('age_req'));
  assert.deepEqual(nameAge('ทารก 0–3 เดือน'), { min: 0, max: 0.25, step: 1 / 12 });
  assert.deepEqual(fails(indRules({ ...i, age_min: 0, age_max: 0.25 })), []);
  assert.ok(fails(indRules({ ...i, age_min: 1, age_max: 5 })).includes('age_name'));
});

test('C7: ช่วงอายุขาดตอน 5–6 ปี → ไม่ผ่าน · ช่วงต่อกัน 2–6 แล้ว 6–12 → ผ่าน', () => {
  const b = { per: 'dose', fixed: true, min: 12.5, max: 25 };
  const gap = drugRules([{ ...b, name: 'ก', age_min: 2, age_max: 5 }, { ...b, name: 'ข', age_min: 6, age_max: 12 }, { ...b, name: 'ค', min: 50, max: 100, age_min: 12 }]);
  assert.ok(gap.some((x) => x.code === 'age_gap' && x.k === 1 && x.sev === 'fail'));
  const fine = drugRules([{ ...b, name: 'ก', age_min: 2, age_max: 6 }, { ...b, name: 'ข', age_min: 6, age_max: 12 }, { ...b, name: 'ค', min: 50, max: 100, age_min: 12 }]);
  assert.ok(!fine.some((x) => x.code === 'age_gap'));
  // ข้อผู้ใหญ่ไม่ระบุอายุ = ไม่ผ่าน (ห้ามเด็กตกไปใช้ขนาดผู้ใหญ่)
  assert.ok(fails(indRules({ ...b, name: 'ผู้ใหญ่', min: 50, max: 100 })).includes('age_req'));
});

test('เด็กห้ามได้ยามากกว่าผู้ใหญ่: 30 มก./กก. × 45 กก. = 1,350 มก. > ผู้ใหญ่ 1,000 มก. → ไม่ผ่าน', () => {
  const adult = { name: 'ผู้ใหญ่', fixed: true, per: 'dose', min: 500, max: 1000, age_min: 12 };
  const child = { name: 'เด็ก', per: 'dose', min: 20, max: 30, cap: 2000, age_min: 2, age_max: 12 };
  const r = drugRules([child, adult]);
  assert.ok(r.some((x) => x.code === 'child_over' && x.k === 0));
  assert.deepEqual(topMg(child, 45), { dose: 1350, day: null });
  assert.ok(!drugRules([{ ...child, cap: 1000 }, adult]).some((x) => x.code === 'child_over'));
  // mcg แปลงเป็น มก. ก่อนเทียบ
  assert.deepEqual(topMg({ unit: 'mcg', fixed: true, per: 'dose', max: 100 }, 0), { dose: 0.1, day: null });
});

test('ขนาดตามน้ำหนักไม่มีเพดาน → ไม่ผ่าน (ต่อครั้ง = cap · ต่อวัน = cap_day) · ครั้งละมากกว่าวันละ → ไม่ผ่าน', () => {
  assert.ok(fails(indRules({ ...ok, cap: undefined })).includes('cap_req'));
  assert.ok(fails(indRules({ name: 'x', per: 'day', times: 3, min: 25, max: 50, age_min: 0, age_max: 12, quote: '25 to 50 mg/kg/day in 3 divided doses' })).includes('capday_req'));
  assert.ok(fails(indRules({ ...ok, cap: 600, cap_day: 500 })).includes('cap_order'));
  assert.ok(codes(indRules({ ...ok, quote: '' })).includes('quote_none'));
});

test('blockedInds: คืนเฉพาะข้อที่ไม่ผ่าน', () => {
  const m = blockedInds([ok, { ...ok, age_min: undefined }]);
  assert.equal(m.has(0), false);
  assert.equal(m.has(1), true);
});

test('อายุใส่ค่าเดียวได้: "ตั้งแต่ 11 ปี" + ช่องถึงว่าง (หรือ ≥ 100) = ไม่จำกัด · ชื่อ "6 ปีขึ้นไป" อ่านได้', () => {
  const fx = { per: 'dose', fixed: true, min: 25, max: 50, cap: 50, quote: 'Child 11 years and older: 25 to 50 mg at bedtime' };
  assert.deepEqual(fails(indRules({ ...fx, name: 'ปัสสาวะรดที่นอน (เด็ก ≥11 ปี)', age_min: 11, age_max: null })), []);
  assert.deepEqual(fails(indRules({ ...fx, name: 'ปัสสาวะรดที่นอน (เด็ก ≥11 ปี)', age_min: 11, age_max: 120 })), []);
  assert.deepEqual(nameAge('ปัสสาวะรดที่นอน (เด็ก 6 ปีขึ้นไป)'), { min: 6, max: null, step: 1 });
  assert.deepEqual(nameAge('enuresis (6+ ปี)'), { min: 6, max: null, step: 1 });
});

test('ช่องอายุไม่ตรงชื่อ → บอกทั้งสองค่า + ค่าที่แก้ให้ (fix) · ช่วงอายุขาดตอน → เสนอต่อช่วงข้อก่อนหน้า', () => {
  const fx = { per: 'dose', fixed: true, min: 25, max: 50, cap: 50 };
  const r = indRules({ ...fx, name: 'ปัสสาวะรดที่นอน (เด็ก ≥11 ปี)', age_min: 6, age_max: null }).find((x) => x.code === 'age_name');
  assert.ok(r && /11 ปีขึ้นไป/.test(r.text) && /6 ปีขึ้นไป/.test(r.text), r?.text);
  assert.deepEqual(r.fix, { age_min: 11, age_max: null });
  const g = drugRules([{ ...fx, name: 'ก', age_min: 6, age_max: 10 }, { ...fx, name: 'ข', age_min: 11 }]).find((x) => x.code === 'age_gap');
  assert.equal(g.k, 1); assert.equal(g.fix.k, 0); assert.equal(g.fix.age_max, 11);
});
