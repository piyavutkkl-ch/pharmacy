// ทดสอบตัวแยกหัวข้อหน้า MIMS (js/pages/mims-text.js) กับข้อความแบบ PDF ที่พิมพ์หน้าเว็บ (คอลัมน์แคบ) — ข้อความสมมติทั้งหมด ห้ามใส่ข้อความ MIMS จริงใน repo
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMimsText } from '../../js/pages/mims-text.js';

const PDF = ['Testamolol', 'Generic Medicine Info', 'This information is not country-specific. Please refer to', 'the Thailand prescribing information.', 'Indications and Dosage', 'Oral',
  'Fever and mild pain, Prophylaxis of', 'tension headache', 'Adult: Initially, 500 mg every 6 hours', 'as needed. Max: 4 g daily.', 'Child: 10 mg/kg every 6 hours.',
  'What are the brands available for', 'Testamolol in Thailand?', 'Other Known Brands', 'See More', 'Contraindications', 'Hypersensitivity to', 'testamolol.',
  'Drug Interactions', 'May increase the e!ect of warfarin. Has', 'a"nity for H receptors.', 'Action', 'Pharmacokinetics:', 'Absorption: Rapidly absorbed from the', 'GI tract.',
  'Testabrand', 'Fakemol Plus', 'Mol GPO', '1'].join('\n');

test('PDF หน้า MIMS: ชื่อยา · หัวข้อ · ต่อบรรทัดที่ตัด · ชื่อการค้าที่หลุดท้ายหน้า · ตัดเลขหน้า', () => {
  const p = parseMimsText(PDF);
  assert.equal(p.name, 'Testamolol');
  assert.deepEqual(p.sections.map((s) => s.title), ['Indications and Dosage', 'Contraindications', 'Drug Interactions', 'Action', 'Brands']);
  assert.deepEqual(p.brands, ['Testabrand', 'Fakemol Plus', 'Mol GPO']);
  assert.match(p.sections[0].body, /Fever and mild pain, Prophylaxis of tension headache/);
  assert.match(p.sections[0].body, /every 6 hours as needed\. Max: 4 g daily\./);
  assert.ok(!/\n1$/.test(p.sections[3].body));
});

test('ตัวอักษรรวมที่ PDF อ่านเพี้ยน: e!ect → effect · a"nity → affinity', () => {
  const di = parseMimsText(PDF).sections.find((s) => s.title === 'Drug Interactions').body;
  assert.match(di, /the effect of warfarin/);
  assert.match(di, /affinity for H receptors/);
});

test('การ์ดข้อบ่งใช้: แยกตามกลุ่มผู้ป่วย · ไม่เดาตัวเลข (รอเภสัชกรกรอก)', () => {
  const p = parseMimsText(PDF);
  assert.equal(p.inds.length, 2);
  assert.ok(p.inds.every((i) => i.skip && i.min == null));
});

test('ไม่มีหัวข้อชื่อการค้า → ไม่เดาว่าบรรทัดท้ายเป็นชื่อการค้า', () => {
  const p = parseMimsText(['Testamolol', 'Indications and Dosage', 'Oral', 'Fever', 'Adult: 500 mg.', 'Storage', 'Store below 30°C.', 'Keep Dry'].join('\n'));
  assert.deepEqual(p.brands, []);
  assert.match(p.sections.find((s) => s.title === 'Storage').body, /Keep Dry/);
});
