// Audit (Phase 1 · ไม่แก้ระบบจริง): ทดสอบเครื่องคำนวณขนาดยาแบบ black-box ผ่านหน้าเว็บจริง (Playwright + Supabase จำลอง)
// ใช้:  NODE_PATH=$(npm root -g) node audit/dose/ui.cjs [--json out.json]
// ข้อมูลยาในไฟล์นี้เป็น "ข้อมูลสังเคราะห์เพื่อทดสอบเลขคณิต" (ชื่อ AUDIT-…) ไม่ใช่ข้อมูลทางคลินิก
//   ค่าคาดหวังเชิงตัวเลขคิดจากพารามิเตอร์ที่ใส่เองในไฟล์นี้ (น้ำหนัก × มก./กก. ÷ ความแรง) ไม่ได้อ่านจากโค้ดระบบ
//   ค่าคาดหวังเชิงความปลอดภัย (เช่น ต้องเตือน/ต้องปฏิเสธ) มาจากข้อกำหนดในคำสั่งตรวจสอบ (หัวข้อ 3.x) — ระบุไว้ใน rationale
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.resolve(__dirname, '../..');
const MOCK = fs.readFileSync(path.join(ROOT, 'tests/ui/mock_supabase.js'), 'utf8');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const out = [];
const L = (t) => String(t).split('\n').map((x) => x.trim()).filter(Boolean);
const rec = (c) => { out.push(c); console.log(`${c.result.padEnd(10)} ${c.id.padEnd(6)} [${c.risk}] ${c.title} → ${String(c.actual).slice(0, 160)}`); };
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

(async () => {
  const port = await freePort();
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const BASE = `http://127.0.0.1:${port}/index.html`;
  const exe = ['/opt/pw-browsers/chromium', process.env.PW_CHROMIUM].find((p) => p && fs.existsSync(p) && fs.statSync(p).isFile());
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const errors = [];
  async function open(role, hash = '') {
    const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => d.accept());
    await p.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: MOCK }));
    await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await p.goto(`${BASE}${role ? '?mockrole=' + role : ''}${hash}`);
    await p.waitForTimeout(700);
    return p;
  }
  const text = (p, s) => p.$eval(s, (e) => e.innerText).catch(() => '');

  const p = await open('');
  await p.click('[data-panel-link="dose"]'); await p.waitForTimeout(400);

  /** ตั้งยาสังเคราะห์ 1 ตัว (dose_drugs id 9950) + ยา รพ.สต. สังเคราะห์ที่ผูกไว้ แล้วกรอกข้อมูลผู้ป่วย → คืนข้อความผลคำนวณ */
  async function run({ inds, local, inp = {} }) {
    await p.evaluate(async ({ inds, local }) => {
      const db = window.__db;
      db.dose_drugs = db.dose_drugs.filter((x) => x.id !== 9950);
      db.local_drugs = db.local_drugs.filter((x) => x.id !== 99950);
      db.dose_drugs.push({ id: 9950, name: 'AUDIT-SYN (Auditsyn)', sort: 999, form: 'ยาเม็ด', active: true, ai_draft: false, ai_source: null, concs: [], indications: inds });
      db.local_drugs.push({ id: 99950, code: 'AUD-1', sort: 9999, active: true, category: 'ยาเม็ด/แคปซูล', mono_refs: [], ddi_ids: [], fda_key: null, dose_id: 9950,
        strength: null, ingredients: null, unit: 'TAB', name: 'AUDITSYN 500 MG', ...local });
      const m = await import('./js/pages/dose.js?v=4.4'); m.resetDrugInfo(); await m.initDose();
    }, { inds, local: local || {} });
    const v = await p.$$eval('#doseDrug option', (o) => o.find((x) => x.textContent === 'AUDIT-SYN (Auditsyn)')?.value);
    if (v == null) return { txt: '(ยาสังเคราะห์ไม่ขึ้นในรายการ)', alert: false };
    await p.selectOption('#doseDrug', v);
    const conc = await p.$$eval('#doseConc option', (o) => o.filter((x) => !x.disabled).map((x) => x.value));
    if (conc.length) await p.selectOption('#doseConc', conc[0]);
    const i = { age: '', ageUnit: 'y', w: '', h: '', sex: 'm', renalAuto: false, method: 'crcl', cr: '', renal: 'normal', ...inp };
    await p.fill('#doseAge', String(i.age)); await p.selectOption('#doseAgeUnit', i.ageUnit); await p.selectOption('#doseSex', i.sex);
    await p.fill('#doseHeight', String(i.h));
    if (i.renalAuto) { await p.check('#doseRenalAdjust'); await p.selectOption('#doseRenalMethod', i.method); await p.fill('#doseCr', String(i.cr)); }
    else { await p.uncheck('#doseRenalAdjust'); await p.selectOption('#doseRenal', i.renal); }
    await p.fill('#doseWeight', String(i.w));
    await p.waitForTimeout(150);
    return { fig: (await p.$eval('#doseResult .fig .n', (e) => e.innerText).catch(() => '')).trim(), txt: await text(p, '#doseResult'), alert: await p.$('#doseResult .alert').then((x) => !!x), conc: await text(p, '#doseConc') };
  }
  const T = (id, title, o) => rec({ id, title, ...o });

  // ---------- ขนาดยาตามน้ำหนัก ----------
  { const r = await run({ inds: [{ name: 'syn', per: 'dose', min: 10, max: 15, cap: 1000 }], inp: { w: 20 } });
    T('UI-01', 'ต่อครั้ง 10–15 มก./กก. × 20 กก. · เม็ด 500 มก.', { fn: 'dose.js render/doseCore', input: 'w=20, per=dose, min=10, max=15, cap=1000, AUDITSYN 500 MG TAB',
      expected: '200–300 มก. · 0.40–0.60 เม็ด', unit: 'มก./ครั้ง', ref: 'เลขคณิต: 20×10=200, 20×15=300; 200/500=0.40, 300/500=0.60', rationale: 'ตรวจสูตรพื้นฐานต่อครั้ง',
      actual: L(r.txt).slice(0, 4).join(' | '), result: r.txt.includes('200–300 มก.') && r.txt.includes('0.40–0.60 เม็ด') ? 'PASS' : 'FAIL', risk: 'High' }); }
  { const r = await run({ inds: [{ name: 'syn', per: 'dose', min: 10, max: 15, cap: 1000 }], inp: { w: 100 } });
    T('UI-02', 'ต่อครั้ง: ขนาดสูงสุดต่อครั้ง (cap) ถูกใช้', { fn: 'doseCore (per≠day)', input: 'w=100, 10–15 มก./กก., cap 1000', expected: '1000 มก. (ไม่เกิน cap)', unit: 'มก./ครั้ง',
      ref: '100×10=1000, 100×15=1500 → min(…,1000)', rationale: 'cap ต่อครั้งต้องจำกัดผล (ตรวจตัวเลขหลัก · ข้อความบอกขนาดตามน้ำหนักเดิมแสดงได้)', actual: `ตัวเลขหลัก ${r.fig} | ${L(r.txt).slice(2, 4).join(' | ')}`, result: r.fig === '1000 มก.' ? 'PASS' : 'FAIL', risk: 'High' }); }
  { const r = await run({ inds: [{ name: 'syn', per: 'day', min: 30, max: 30, times: 3, cap: 500 }], inp: { w: 60 } });
    T('UI-03', 'ต่อวัน ÷ 3: ไม่ใช้ขนาดสูงสุดต่อครั้ง (cap)', { fn: 'doseCore (per=day)', input: 'w=60, 30 มก./กก./วัน, แบ่ง 3, cap=500 มก./ครั้ง', expected: '≤ 500 มก./ครั้ง หรือเตือนว่าเกินขนาดสูงสุด', unit: 'มก./ครั้ง',
      ref: '60×30=1800/วัน ÷3 = 600 > cap 500', rationale: 'ข้อกำหนด 3.4: ต้องตรวจขนาดสูงสุดต่อครั้ง/ต่อวัน', actual: `ตัวเลขหลัก ${r.fig} | ${L(r.txt).slice(2, 4).join(' | ')}`,
      result: r.fig === '500 มก.' && /จำกัดที่ขนาดสูงสุด 500 มก\.\/ครั้ง/.test(r.txt) ? 'PASS' : 'FAIL', risk: 'Critical' }); }
  { const r = await run({ inds: [{ name: 'syn', per: 'day', min: 20, max: 20, times: null }], inp: { w: 10 } });
    T('UI-04', 'ต่อวัน แต่ไม่ระบุจำนวนครั้ง (times = null)', { fn: 'doseCore (n = i.times || 1)', input: 'w=10, 20 มก./กก./วัน, times=null', expected: 'ไม่แสดงขนาดยา/แจ้งว่าข้อมูลไม่ครบ', unit: '-',
      ref: 'ข้อกำหนด 3.4 (ความถี่ต้องชัด) · ai_dose_convert (67) สร้างร่าง times=null ได้ + ปุ่ม "ตรวจแล้ว · แสดง" ไม่ตรวจข้อมูล (UI-20)', rationale: 'ระบบสันนิษฐานวันละครั้งเอง → ผู้ใช้อาจให้ขนาดรวมทั้งวันในครั้งเดียว',
      actual: L(r.txt).slice(0, 2).join(' | '), result: r.txt.includes('ต่อวัน (วันละครั้ง)') ? 'FAIL' : 'PASS', risk: 'High' }); }
  { const r = await run({ inds: [{ name: 'syn', per: 'dose', min: 0.01, max: 0.01 }], inp: { w: 3 } });
    T('UI-05', 'ขนาดยาเล็กมาก: 0.01 มก./กก. × 3 กก.', { fn: 'rng(lo,hi,hi<10?1:0)', input: 'w=3, 0.01 มก./กก./ครั้ง', expected: '0.03 มก. (หรือแสดงเป็น mcg) ห้ามเป็น 0.0', unit: 'มก.',
      ref: '3×0.01 = 0.03', rationale: 'ข้อกำหนด 3.5: ห้ามปัดเศษจนเป็นอันตราย', actual: L(r.txt).slice(0, 3).join(' | '), result: /\b0\.0 มก\./.test(r.txt) ? 'FAIL' : 'PASS', risk: 'High' }); }
  for (const [id, w, exp] of [['UI-06a', 0, 'reject'], ['UI-06b', -5, 'reject'], ['UI-06c', 500, 'warn']]) {
    const r = await run({ inds: [{ name: 'syn', per: 'dose', min: 10, max: 15 }], inp: { w } });
    const rejected = r.txt.includes('กรอกน้ำหนักตัว (จำเป็น)');
    T(id, `น้ำหนัก ${w} กก.`, { fn: 'render (w > 0)', input: `w=${w}`, expected: exp === 'reject' ? 'ไม่คำนวณ + ให้กรอกน้ำหนัก' : 'เตือนค่าเกินช่วงที่เป็นไปได้ / ไม่คำนวณ', unit: 'กก.',
      ref: 'ข้อกำหนด 3.4 ค่านอกช่วง', rationale: exp === 'reject' ? 'ค่าต้องไม่ ≤ 0' : 'index.html มี max แต่ JS ไม่ตรวจ', actual: rejected ? 'ไม่คำนวณ' : L(r.txt).slice(0, 3).join(' | '),
      result: exp === 'reject' ? (rejected ? 'PASS' : 'FAIL') : (!rejected && !/เกินช่วง|ไม่สมเหตุ|ตรวจสอบน้ำหนัก/.test(r.txt) ? 'FAIL' : 'PASS'), risk: exp === 'reject' ? 'High' : 'Medium' });
  }
  { const r = await run({ inds: [{ name: 'syn', per: 'dose', min: 50, max: 50 }], inp: { w: 70, age: 40 } });
    T('UI-07', 'ผู้ใหญ่ 40 ปี 70 กก. กับข้อบ่งใช้ มก./กก. ที่ไม่มี cap/ช่วงอายุ', { fn: 'indications schema (01 L668 · ไม่มี age group)', input: 'age=40, w=70, 50 มก./กก./ครั้ง, cap ว่าง',
      expected: 'จำกัดเฉพาะกลุ่มอายุที่ข้อบ่งใช้รองรับ หรือเตือนว่าไม่มีขนาดสูงสุด', unit: 'มก.', ref: '70×50=3500', rationale: 'ข้อกำหนด 3.4: ผู้ใหญ่ห้ามได้ขนาดเด็กต่อ กก. เกินขนาดผู้ใหญ่',
      actual: L(r.txt).slice(0, 2).join(' | '), result: r.txt.includes('3500') && !/สูงสุด|กลุ่มอายุ|ผู้ใหญ่/.test(r.txt.replace(/ผู้ป่วยอายุ.*\n/, '')) ? 'FAIL' : 'PASS', risk: 'High' }); }

  // ---------- ไต (ข้อกำหนด 3.3: ล้มเหลวต้องไม่ถูกตีความว่าปกติ) ----------
  const RI = [{ name: 'syn', per: 'dose', min: 10, max: 10, renal: 'AUDIT: ข้อความโรคไตสังเคราะห์ CrCl < 30 ลดขนาด' }];
  for (const [id, title, inp] of [
    ['UI-08a', 'เปิดคำนวณไต แต่ไม่กรอก Cr', { w: 60, age: 60, renalAuto: true, cr: '' }],
    ['UI-08b', 'เปิดคำนวณไต แต่ไม่กรอกอายุ', { w: 60, age: '', renalAuto: true, cr: 1.2 }],
    ['UI-08c', 'eGFR เด็ก 8 ปี ไม่กรอกส่วนสูง', { w: 25, age: 8, renalAuto: true, method: 'egfr', cr: 0.5 }],
  ]) {
    const r = await run({ inds: RI, inp });
    const doseShown = /\b\d+ มก\./.test(r.txt);
    T(id, title, { fn: 'render: renal="normal" เป็นค่าเริ่ม · kidney() คืน msg', input: JSON.stringify(inp), expected: 'แสดงสถานะ "ประเมินไตไม่ได้" ชัดเจน (alert) · ไม่แสดงผลแบบไตปกติ', unit: '-',
      ref: 'ข้อกำหนด 3.3', rationale: 'ผลคำนวณออกมาเหมือนไตปกติ มีเพียงข้อความเล็กสีจาง', actual: `alert=${r.alert} · ขนาดยาแสดง=${doseShown} · "${L(r.txt).slice(0, 3).join(' | ').slice(0, 140)}"`,
      result: r.alert && /ยังประเมินการทำงานของไตไม่ได้/.test(r.txt) && /ยังไม่ได้ปรับตามการทำงานของไต/.test(r.txt) && !/การทำงานของไตปกติ/.test(r.txt) ? 'PASS' : 'FAIL', risk: 'Critical' });
  }
  { const r = await run({ inds: RI, inp: { w: 60, age: 150, renalAuto: true, cr: 1 } });
    T('UI-09', 'อายุ 150 ปี → CrCl ติดลบ', { fn: 'kidney() CG', input: 'age=150 w=60 Cr=1', expected: 'ปฏิเสธค่าอายุ', unit: 'มล./นาที', ref: '(140−150)×60/72 = −8.3', rationale: 'ค่าติดลบถูกจัดเป็น "ไตเสื่อมรุนแรง"',
      actual: L(r.txt).slice(0, 2).join(' | '), result: /−|-\d/.test(await p.inputValue('#doseCrClOut')) ? 'FAIL' : 'PASS', risk: 'High' }); }
  { const r = await run({ inds: RI, inp: { w: 60, age: 60, renalAuto: true, cr: 88 } });
    const hasUnit = await p.$('#doseCrUnit, [name="crUnit"]').then((x) => !!x);
    T('UI-10', 'Cr = 88 (ค่า µmol/L ที่กรอกในช่อง มก./ดล.)', { fn: 'index.html #doseCr + kidney()', input: 'Cr=88', expected: 'มีตัวเลือกหน่วย µmol/L หรือเตือนว่าเกินช่วง มก./ดล.', unit: 'มก./ดล.',
      ref: '88 µmol/L = 88/88.42 ≈ 1.0 มก./ดล.', rationale: 'รายงานแล็บไทยบางแห่งใช้ µmol/L', actual: `ตัวเลือกหน่วย=${hasUnit} · CrCl=${await p.inputValue('#doseCrClOut')}`,
      result: !hasUnit && !/µmol|ไมโครโมล|เกินช่วง/.test(r.txt) ? 'FAIL' : 'PASS', risk: 'High' }); }
  { const r = await run({ inds: RI, inp: { w: 70, age: 50, renalAuto: true, method: 'egfr', cr: 1 } });
    T('UI-11', 'eGFR ≥ 60 กับยาที่มีคำแนะนำโรคไตเฉพาะยา', { fn: 'render: ข้อความไตปกติ', input: 'ชาย 50 ปี Cr 1.0 (eGFR ≈ 91.7)', expected: 'ข้อความไม่ฟันธงว่า "ไม่จำเป็นต้องปรับขนาดยา" โดยไม่อิงเกณฑ์ของยา', unit: '-',
      ref: 'ไม่มีแหล่งอ้างอิงเกณฑ์รายยาในระบบให้เทียบ', rationale: 'ข้อความเดียวกันทุกยา · ใช้เกณฑ์ eGFR (ต่อ 1.73 ตร.ม.) เท่ากับ CrCl', actual: L(r.txt).slice(0, 2).join(' | '),
      result: 'UNVERIFIED', risk: 'Medium' }); }
  { const r = await run({ inds: RI, inp: { w: 60, renal: 'severe' } });
    T('UI-12', 'เลือกระดับไตเอง = รุนแรง', { fn: 'render (manual renal)', input: 'renal=severe', expected: 'แสดง alert + ข้อความโรคไตของข้อบ่งใช้', unit: '-', ref: 'พฤติกรรมที่ออกแบบไว้',
      rationale: 'ตรวจว่าเส้นทางปกติทำงาน', actual: `alert=${r.alert}`, result: r.alert && r.txt.includes('AUDIT: ข้อความโรคไต') ? 'PASS' : 'FAIL', risk: 'Medium' }); }
  { const r = await run({ inds: RI, inp: { w: 60, renal: 'severe' } });
    T('UI-13', 'ระดับไตรุนแรง: ขนาดยาที่แสดงถูกปรับหรือไม่', { fn: 'render: renal ใช้แค่แสดงข้อความ', input: 'renal=severe, 10 มก./กก. × 60', expected: 'ไม่แสดงตัวเลขขนาดปกติเป็นผลหลัก หรือระบุชัดว่าตัวเลขยังไม่ปรับตามไต', unit: 'มก.',
      ref: 'ข้อกำหนด 3.3', rationale: 'ตัวเลข 600 มก. แสดงเหมือนเดิม คำแนะนำไตเป็นข้อความอิสระ', actual: L(r.txt).filter((x) => /มก\./.test(x)).slice(0, 1).join(''),
      result: /\b600 มก\./.test(r.txt) && !/ยังไม่ปรับ|ก่อนปรับ/.test(r.txt) ? 'FAIL' : 'PASS', risk: 'High' }); }

  // ---------- ความแรง/หน่วย ----------
  { const r = await run({ inds: [{ name: 'syn', unit: 'mcg', per: 'day', min: 10, max: 10, times: 1 }], local: { name: 'AUDITSYN 100 MCG', unit: 'TAB' }, inp: { w: 10 } });
    T('UI-14', 'หน่วย mcg → มก. ก่อนคิดเม็ด', { fn: 'doseCore (k=1/1000)', input: 'w=10, 10 mcg/กก./วัน ×1, เม็ด 100 MCG', expected: '100 mcg · 1.00 เม็ด', unit: 'mcg', ref: '10×10=100 mcg; 0.1 มก./0.1 มก. = 1',
      rationale: 'แปลงหน่วย', actual: L(r.txt).slice(0, 4).join(' | '), result: r.txt.includes('100 mcg') && r.txt.includes('1.00 เม็ด') ? 'PASS' : 'FAIL', risk: 'High' }); }
  { const r = await run({ inds: [{ name: 'syn', per: 'day', min: 8, max: 8, times: 2, basis: 'Trimethoprim' }], local: { name: 'AUDITCOMBO 400/80 MG', unit: 'TAB' }, inp: { w: 20 } });
    T('UI-15', 'ยาสูตรผสมที่มีแค่ชื่อ "400/80 MG" (ไม่มี ingredients)', { fn: 'strengthOf (regex ชื่อ)', input: 'AUDITCOMBO 400/80 MG TAB · basis=Trimethoprim · 8 มก./กก./วัน ÷2 × 20 กก.', expected: 'ไม่คิดจำนวนเม็ด (ความแรงไม่ชัด) จนกว่าจะกรอก ingredients',
      unit: 'เม็ด', ref: 'ข้อกำหนด 3.5: ห้ามพึ่งการอ่านชื่อยา; ยาผสมต้องแยกสาร', rationale: 'ระบบอ่านได้ 80 มก./เม็ด แล้วคิดเม็ดจาก 80 ไม่ว่า basis คือสารใด', actual: `${r.conc.split('\n')[0]} | ${L(r.txt).slice(0, 4).join(' | ')}`,
      result: /เม็ด\/แคปซูล/.test(r.txt) ? 'FAIL' : 'PASS', risk: 'High' }); }
  { const r = await run({ inds: [{ name: 'syn', per: 'day', min: 8, max: 8, times: 2, basis: 'Sulfamethoxazole' }], local: { name: 'AUDITCOMBO 400/80 MG', unit: 'TAB' }, inp: { w: 20 } });
    T('UI-15b', 'ชื่อ "400/80 MG" + basis = สารแรก', { fn: 'strengthOf', input: 'basis=Sulfamethoxazole (400) · 20 กก. × 8 ÷ 2 = 80 มก.', expected: 'ไม่คิดเม็ด หรือคิดจาก 400 → 0.20 เม็ด', unit: 'เม็ด',
      ref: '80/400 = 0.20 (ถ้าคิดจาก 80 จะได้ 1.00 = เกิน 5 เท่า)', rationale: 'ความแรงจากชื่อไม่รู้ว่าเลขไหนเป็นสารใด', actual: L(r.txt).slice(0, 4).join(' | '),
      result: r.txt.includes('1.00 เม็ด') ? 'FAIL' : 'PASS', risk: 'Critical' }); }
  { const r = await run({ inds: [{ name: 'syn', per: 'day', min: 8, max: 8, times: 2 }], local: { name: 'AUDITCOMBO2', unit: 'TAB', ingredients: [{ name: 'Sulfamethoxazole', mg: 400, per: 'tab' }, { name: 'Trimethoprim', mg: 80, per: 'tab' }] }, inp: { w: 20 } });
    T('UI-16', 'ยาสูตรผสมมี ingredients แต่ข้อบ่งใช้ไม่ระบุ basis', { fn: 'doseCore combo', input: 'ingredients 400/80 · no basis', expected: 'เตือน + ไม่คิดจำนวนเม็ด', unit: '-', ref: 'ออกแบบไว้ (66_combo_drugs.sql)',
      rationale: 'เส้นทางปลอดภัย', actual: L(r.txt).slice(0, 3).join(' | '), result: r.txt.includes('ยังไม่ได้ระบุว่าคิดขนาดยาจากสารสำคัญตัวใด') && !r.txt.includes('เม็ด/แคปซูล') ? 'PASS' : 'FAIL', risk: 'High' }); }
  { const r = await run({ inds: [{ name: 'syn', per: 'dose', min: 10, max: 10 }], local: { name: 'AUDITSYRUP', unit: 'BOT', category: 'ยาน้ำรับประทาน' }, inp: { w: 10 } });
    T('UI-17', 'ไม่ทราบความแรง → ไม่ให้ปริมาตร', { fn: 'fillConc/conc', input: 'ยาน้ำไม่มีความแรง', expected: 'ไม่มีผล มล./เม็ด + บอกว่ายังไม่ระบุความแรง', unit: 'มล.', ref: 'ข้อกำหนด 3.5',
      rationale: 'ตรวจเส้นทางปลอดภัย', actual: `${r.conc.replace(/\n/g, ' / ')} | ${L(r.txt).slice(0, 2).join(' | ')}`, result: !/มล\.|เม็ด\/แคปซูล/.test(r.txt.split('ความถี่')[0]) && /ยังไม่ระบุความแรง/.test(r.conc) ? 'PASS' : 'FAIL', risk: 'High' }); }
  { const r = await run({ inds: [{ name: 'syn', per: 'dose', min: 5, max: 5 }], local: { name: 'AUDITSYN 150 MG', unit: 'TAB' }, inp: { w: 10 } });
    T('UI-18', 'จำนวนเม็ดที่แบ่งจริงไม่ได้ (0.33 เม็ด)', { fn: 'doseCore vol (2 ตำแหน่ง)', input: 'w=10, 5 มก./กก., เม็ด 150', expected: 'ปัดเป็นสัดส่วนที่แบ่งได้ (½/¼) หรือเตือน', unit: 'เม็ด', ref: '50/150 = 0.333',
      rationale: 'ไม่มีนโยบายการปัดเม็ดในระบบให้เทียบ — ต้องให้เภสัชกรกำหนด', actual: L(r.txt).slice(0, 4).join(' | '), result: 'UNVERIFIED', risk: 'Medium' }); }
  { const r = await run({ inds: [{ name: 'syn', per: 'day', min: 30, max: 30, times: 1, times_alt: [3] }], inp: { w: 10 } });
    T('UI-19', 'แบ่งให้ได้หลายแบบ (1 หรือ 3 ครั้ง/วัน)', { fn: 'doseOf times_alt', input: 'w=10, 30 มก./กก./วัน, times 1 | 3', expected: 'แบบที่ 1: 300 มก. · แบบที่ 2: 100 มก./ครั้ง', unit: 'มก.', ref: '300/1, 300/3',
      rationale: 'ฟีเจอร์ใหม่', actual: L(r.txt).filter((x) => /แบบที่|มก\./.test(x)).slice(0, 4).join(' | '), result: r.txt.includes('แบบที่ 2') && /\b300 มก\./.test(r.txt) && /\b100 มก\./.test(r.txt) ? 'PASS' : 'FAIL', risk: 'Medium' }); }
  { const r = await run({ inds: [{ name: '<img src=x onerror="window.__xss=1">', per: 'dose', min: 1, max: 1, freq: '<b>x</b>' }], inp: { w: 10 } });
    const x = await p.evaluate(() => !!window.__xss || !!document.querySelector('#doseResult img[src="x"]'));
    T('UI-21', 'XSS ในชื่อข้อบ่งใช้/ความถี่', { fn: 'esc()', input: 'name=<img onerror>', expected: 'แสดงเป็นข้อความ ไม่รันสคริปต์', unit: '-', ref: 'CLAUDE.md XSS', rationale: 'ข้อมูลจาก AI/ผู้ดูแล',
      actual: `xss=${x}`, result: x ? 'FAIL' : 'PASS', risk: 'High' }); }
  { await p.evaluate(async () => { const db = window.__db; db.dose_drugs.push({ id: 9951, name: 'AUDIT-DRAFT (Auditdraft)', sort: 998, active: false, ai_draft: true, concs: [], indications: [{ name: 'd', per: 'dose', min: 1, max: 1 }] });
      db.local_drugs.push({ id: 99951, code: 'AUD-2', sort: 9998, active: true, category: 'ยาเม็ด/แคปซูล', mono_refs: [], ddi_ids: [], dose_id: 9951, unit: 'TAB', name: 'AUDITDRAFT 10 MG' });
      const m = await import('./js/pages/dose.js?v=4.4'); m.resetDrugInfo(); await m.initDose(); });
    const shown = await p.$$eval('#doseDrug option', (o) => o.some((x) => /AUDIT-DRAFT/.test(x.textContent)));
    T('UI-22', 'ร่าง AI (active=false) ไม่ขึ้นในเครื่องคำนวณ', { fn: 'initDose .eq(active,true)', input: 'dose_drugs ai_draft=true active=false', expected: 'ไม่แสดง', unit: '-', ref: '56_dose_ai_drafts.sql',
      rationale: 'ร่างต้องไม่ถึงผู้ใช้', actual: `แสดง=${shown}`, result: shown ? 'FAIL' : 'PASS', risk: 'Critical' }); }
  await p.screenshot({ path: path.join(SHOTS, 'audit-dose-1280.png'), fullPage: false });
  await p.close();

  // ---------- ผู้ดูแล: อนุมัติร่าง AI คลิกเดียว (ไม่ตรวจข้อมูล) ----------
  { const a = await open('admin');
    await a.evaluate(() => { window.__db.dose_drugs.push({ id: 9960, name: 'AUDIT-DRAFT2 (Auditdraft2)', sort: 997, form: 'ยาเม็ด', active: false, ai_draft: true, ai_source: 'AI · ยังไม่ผ่านการตรวจ', concs: [],
      indications: [{ name: 'syn', per: 'day', min: 20, max: 10, times: null }] }); });
    await a.evaluate((h) => { location.hash = h; }, '#/admin/drugs/dose'); await a.waitForTimeout(900);
    await a.evaluate(() => document.querySelectorAll('[data-admin-view="drugs"] .adr-sec').forEach((x) => { x.open = true; }));
    await a.fill('#dfQ', 'AUDIT-DRAFT2').catch(() => {}); await a.waitForTimeout(300);
    const btn = await a.$('#dfList [data-toggle="9960"]');
    if (btn) { await btn.click(); await a.waitForTimeout(500); }
    const row = await a.evaluate(() => window.__db.dose_drugs.find((x) => x.id === 9960));
    const upd = await a.evaluate(() => (window.__calls || []).filter((c) => JSON.stringify(c).includes('dose_drugs') && /update/i.test(JSON.stringify(c))).map((c) => JSON.stringify(c)).slice(-1)[0] || '');
    T('UI-20', 'ผู้ดูแลกด "ตรวจแล้ว · แสดง" กับร่างที่ข้อมูลผิด (min>max, times=null)', { fn: 'admin-settings.js onDrugList', input: 'ร่าง per=day min=20 max=10 times=null',
      expected: 'ปฏิเสธ/บังคับเปิดฟอร์มตรวจ (readInds) ก่อนแสดง · บันทึกผู้อนุมัติ', unit: '-', ref: 'ข้อกำหนด AI pipeline ขั้นอนุมัติ', rationale: 'saveReview ตรวจ readInds แต่ปุ่มในรายการไม่ตรวจ',
      actual: btn ? `มีปุ่มคลิกเดียว · active=${row?.active} ai_draft=${row?.ai_draft} · update: ${upd.slice(0, 120)}` : `ไม่มีปุ่มอนุมัติคลิกเดียว (ต้องผ่านฟอร์มตรวจ) · active=${row?.active} ai_draft=${row?.ai_draft}`, result: btn || row?.active ? 'FAIL' : 'PASS', risk: 'Critical' });
    await a.close(); }

  await browser.close(); server.kill();
  const n = (r) => out.filter((x) => x.result === r).length;
  console.log(`\nui: PASS ${n('PASS')} · FAIL ${n('FAIL')} · UNVERIFIED ${n('UNVERIFIED')} (ทั้งหมด ${out.length}) · page errors ${errors.length}`);
  errors.forEach((e) => console.log('  page error:', e));
  const j = process.argv.indexOf('--json');
  if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify({ cases: out, errors }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
