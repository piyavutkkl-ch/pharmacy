// ทดสอบหน้าเว็บอัตโนมัติ (Playwright + Supabase จำลอง) — รันก่อนขึ้นเว็บทุกครั้ง
// ใช้:  node tests/ui/smoke.js         (ภาพหน้าจอเก็บที่ tests/ui/shots/ ไว้ตรวจด้วยตา)
// ครอบคลุม: ทุกหน้า × ทุกบทบาท โหลดได้ไม่มี error · งานหลัก (ส่งข่าว, อนุมัติ, แชท, บันทึกโปรไฟล์ ฯลฯ) · จอมือถือ/แท็บเล็ตไม่ล้นจอ
// เพิ่มหน้า/ฟีเจอร์ใหม่ → เพิ่มการทดสอบในไฟล์นี้ด้วยเสมอ
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.resolve(__dirname, '../..');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock_supabase.js'), 'utf8');
const SHOTS = path.join(__dirname, 'shots');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
/** PNG สีพื้นขนาด w×h (ทดสอบการแสดงรูปตามสัดส่วน) */
function makePng(w, h) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 200)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', require('zlib').deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const SIZED = { a4p: makePng(620, 877), a4l: makePng(877, 620), tall: makePng(300, 1500) };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ' → ' + detail}`); };
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

(async () => {
  const port = await freePort();
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const BASE = `http://127.0.0.1:${port}/index.html`;
  const exe = ['/opt/pw-browsers/chromium', process.env.PW_CHROMIUM].find((p) => p && fs.existsSync(p) && fs.statSync(p).isFile());
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const errors = [];

  async function open(role, hash = '', w = 1280, h = 900) {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    const tag = `[${role || 'anon'} ${hash || '#/'} ${w}]`;
    p.on('pageerror', (e) => errors.push(`${tag} ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_|net::/.test(m.text())) errors.push(`${tag} console: ${m.text()}`); });
    p.on('dialog', (d) => d.accept());
    p.on('popup', (pp) => pp.close().catch(() => {}));
    await p.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: MOCK }));
    await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await p.route(/https:\/\/(img|signed)\.test\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    await p.goto(`${BASE}${role ? '?mockrole=' + role : ''}${hash}`);
    await p.waitForTimeout(700);
    return p;
  }
  // ผู้ดูแล › ข้อมูลยา: ฐานข้อมูลแยกแท็บ — ทดสอบหลายส่วนต่อเนื่องในหน้าเดียวให้เปิดทุกส่วนไว้
  const dbAll = (p) => p.evaluate(() => document.querySelectorAll('[data-admin-view="drugs"] .adr-sec').forEach((x) => { x.open = true; }));   // ข้อมูลยา: ขยายทุกส่วน
  const go = async (p, hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(450); };
  const text = (p, s) => p.$eval(s, (e) => e.innerText).catch(() => '');
  const count = (p, s) => p.$$eval(s, (x) => x.length).catch(() => 0);
  const visible = (p, s) => p.$eval(s, (e) => !e.hidden && e.offsetParent !== null).catch(() => false);
  const calls = (p, pred) => p.evaluate(() => window.__calls).then((c) => c.filter(pred));
  // id ข้อเกณฑ์ของปีงบล่าสุด (seed ใส่สถานะไว้ที่ปีงบปัจจุบัน — ไม่ผูกกับปีที่รันทดสอบ)
  const itemId = (p, no) => p.evaluate((n) => window.__db.criteria_items.filter((i) => i.item_no === n).sort((a, b) => b.fiscal_year - a.fiscal_year)[0].id, no);
  const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  try {
    /* ================= ผู้เยี่ยมชม (ไม่ login) ================= */
    let p = await open(null);
    check('หน้าแรก: สไลด์ข่าวแสดง', await count(p, '#slides .slide') > 0);
    { const tags = await p.$$eval('#slides .slide .tag', (x) => x.map((e) => e.textContent));
      check('หน้าแรก: สไลด์สลับข่าว/ประชาสัมพันธ์/ความรู้ กับผลงาน รพ.สต. ที่โพสต์ไว้ (ไม่ใช่กล่องช่องอื่น)', tags.includes('ผลงาน รพ.สต.') && await count(p, '#slides a.slide-ach[href^="#/achievement/"]') >= 1 && !(await count(p, '#slides .slide-feat')) && tags[0] !== tags[1] && await count(p, '#dots button') === tags.length, tags.join('|')); }
    check('หน้าแรก: เมนูมีปุ่มเข้าสู่ระบบ', (await text(p, '#topNav')).includes('เข้าสู่ระบบ'));
    {
      const before = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const wasDark = await p.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
      await p.click('#themeBtn'); await p.waitForTimeout(150);
      const after = await p.evaluate(() => ({ t: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor, saved: localStorage.getItem('pcps_theme') }));
      check('โหมดมืด/สว่าง: ปุ่มขวาบนสลับสีทั้งหน้า + จำค่าไว้', after.t === (wasDark ? 'light' : 'dark') && after.saved === after.t && after.bg !== before, JSON.stringify(after));
      await p.reload(); await p.waitForTimeout(300);
      check('โหมดมืด/สว่าง: เปิดหน้าใหม่ยังเป็นโหมดที่เลือก', (await p.evaluate(() => document.documentElement.dataset.theme)) === after.t && (await p.getAttribute('#themeBtn', 'aria-label')).includes(after.t === 'dark' ? 'สว่าง' : 'มืด'));
      await p.click('#themeBtn'); await p.waitForTimeout(100);
    }
    check('ท้ายเว็บ: ดาวน์โหลดเอกสาร/ช่องทางติดต่อ เป็นกล่องมีไอคอน (หน้าหลัก)', await count(p, '.footer-card .fc-ic svg') === 2 && await visible(p, '.footer-cards')
      && (await text(p, '[data-fc="docs"]')).trim() === 'ดาวน์โหลดเอกสาร' && (await p.getAttribute('[data-fc="docs"]', 'href')) === '#/documents' && await visible(p, '[data-fc="contact"]'));
    check('ท้ายเว็บ: นโยบาย/ข้อตกลง อยู่ใต้ช่องส่งความคิดเห็น', await p.$eval('.footer-legal', (e) => !!e.closest('.footer-col')?.querySelector('#fbForm') && e.querySelectorAll('a[href="privacy.html"],a[href="terms.html"]').length === 2));
    await p.click('[data-panel-link="news"]'); await p.waitForTimeout(300);
    check('ข่าว: การ์ดข่าวแสดง (เฉพาะที่เผยแพร่)', await count(p, '#newsGrid .news-card') === 3, String(await count(p, '#newsGrid .news-card')));
    await p.click('[data-panel-link="dose"]'); await p.waitForTimeout(300);
    await p.fill('#doseWeight', '20'); await p.waitForTimeout(150);
    check('คำนวณโดสยา: แสดงผลเป็นมิลลิกรัม', (await text(p, '#doseResult')).includes('มก.'));
    check('คำนวณ: เรียง อายุ → น้ำหนัก (บังคับ) → ส่วนสูง', await p.$$eval('.dose-pt .field input', (els) => els.map((e) => e.id).join(',')) === 'doseAge,doseWeight,doseHeight' && await p.$eval('#doseWeight', (e) => e.required));
    { const opts = await p.$$eval('#doseDrug option', (o) => o.map((x) => x.textContent));
      check('คำนวณ: รายชื่อยาตามยา รพ.สต. (เฉพาะที่มีข้อมูลขนาดยา)', opts.length >= 3 && opts.some((x) => x.includes('Paracetamol')) && !opts.some((x) => x.includes('ORS')) && (await text(p, '#doseDrugNote')).includes('ยา รพ.สต.'), opts.join('|')); }
    await p.selectOption('#doseDrug', { label: 'พาราเซตามอล (Paracetamol)' }); await p.waitForTimeout(100);
    { const co = await p.$$eval('#doseConc option', (o) => o.map((x) => `${x.textContent}${x.disabled ? '[x]' : ''}`));
      check('คำนวณ: ความแรงตามยา รพ.สต. ที่ผูกไว้ (อ่านจากชื่อยา · ยาน้ำที่ไม่มีความแรงบอกให้ระบุ)', co.some((x) => x.includes('PARACETAMOL 325 MG') && x.includes('325 มก./เม็ด')) && co.some((x) => x.includes('500 MG') && x.includes('500 มก./เม็ด')) && co.some((x) => x.includes('SYRUP') && x.includes('ยังไม่ระบุความแรง[x]')), co.join('|')); }
    await p.selectOption('#doseConc', { index: 1 }); await p.waitForTimeout(100);
    check('คำนวณ: คิดเป็นจำนวนเม็ดจากความแรงของยา รพ.สต.', (await text(p, '#doseResult')).includes('เม็ด/แคปซูล') && (await text(p, '#doseResult')).includes('PARACETAMOL'));
    await p.fill('#doseWeight', ''); await p.fill('#doseAge', '12'); await p.selectOption('#doseAgeUnit', 'm'); await p.selectOption('#doseSex', 'm'); await p.waitForTimeout(100);
    check('คำนวณ: ไม่ได้ชั่งน้ำหนัก → ประมาณจากเกณฑ์ WHO (กรมอนามัย) ตามอายุ + บอกให้กรอกน้ำหนัก', (await text(p, '#doseEst')).includes('ช่วงปกติ 7.7–12 กก.') && (await text(p, '#doseResult')).includes('น้ำหนักตัว (จำเป็น)'), await text(p, '#doseEst'));
    await p.click('#doseEst [data-use-weight]'); await p.waitForTimeout(100);
    check('คำนวณ: กด "ใช้น้ำหนักนี้" → ใส่น้ำหนักแล้วคำนวณ', +(await p.inputValue('#doseWeight')) > 9 && (await text(p, '#doseResult')).includes('อายุ 12 เดือน'));
    { const g = await p.evaluate(() => { const i = document.querySelector('#doseGrowth img'), d = document.querySelector('#doseGrowth .gc-dot'), w = document.querySelector('#doseGrowth .gc-wrap').getBoundingClientRect(), r = d.getBoundingClientRect();
        return { src: i?.getAttribute('src'), x: (r.left + r.width / 2 - w.left) / w.width, y: (r.top + r.height / 2 - w.top) / w.height, cap: document.querySelector('#doseGrowth figcaption').innerText, hidden: document.querySelector('#doseGrowth').hidden }; });
      const wgt = +(await p.inputValue('#doseWeight'));
      const exp = await p.evaluate(async (wg) => { const { GROWTH_CHARTS: C } = await import('./js/growth-charts.js?v=4.4'); const s = C.find((c) => c.id === 'm-wfa').segs[0]; return { x: s.ax * 12 + s.bx, y: s.ay * wg + s.by }; }, wgt);
      check('กราฟเด็ก: อายุ 12 เดือน + น้ำหนัก → กราฟน้ำหนักตามอายุ (ชาย) + จุดแดงตรงตำแหน่ง', !g.hidden && g.src === 'assets/growth/m-wfa.jpg' && Math.abs(g.x - exp.x) < 0.01 && Math.abs(g.y - exp.y) < 0.01 && g.cap.includes('กรมอนามัย'), JSON.stringify({ g, exp })); }
    await p.fill('#doseHeight', '95'); await p.fill('#doseAge', '3'); await p.selectOption('#doseAgeUnit', 'y'); await p.selectOption('#doseSex', 'f'); await p.waitForTimeout(100);
    { const tabs = await p.$$eval('#doseGrowth .gc-tabs button', (b) => b.map((x) => x.dataset.gc).join());
      await p.click('#doseGrowth [data-gc="wfh"]'); await p.waitForTimeout(150);
      check('กราฟเด็ก: มีน้ำหนัก+ส่วนสูง+อายุ 3 ปี → เลือกได้ 3 กราฟ · กดน้ำหนักตามส่วนสูง (หญิง 2–5 ปี)', tabs === 'wfa,hfa,wfh' && (await p.getAttribute('#doseGrowth img', 'src')) === 'assets/growth/f-wfh.jpg', tabs); }
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(150);
    check('กราฟเด็ก (390px): ไม่ล้นจอ', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector('#doseGrowth').getBoundingClientRect().right <= innerWidth));
    await p.$eval('#doseGrowth', (e) => e.scrollIntoView()); await p.screenshot({ path: path.join(SHOTS, 'dose-growth-390.png') });
    await p.setViewportSize({ width: 1280, height: 900 }); await p.waitForTimeout(100);
    check('คำนวณ: ใส่ส่วนสูง → ประมาณจากน้ำหนักตามส่วนสูง', (await text(p, '#doseEst')).includes('ส่วนสูง 95 ซม.') && (await text(p, '#doseEst')).includes('11.7–16.7'), await text(p, '#doseEst'));
    await p.fill('#doseAge', '8'); await p.waitForTimeout(100);
    check('คำนวณ: อายุเกิน 5 ปี → แจ้งว่าเกณฑ์ใช้ได้ 0–5 ปี', (await text(p, '#doseEst')).includes('0–5 ปี'));
    check('กราฟเด็ก: อายุ 8 ปี → กราฟ 6–19 ปี (ส่วนสูงตามอายุ / น้ำหนักตามส่วนสูง)', (await p.$$eval('#doseGrowth .gc-tabs button', (b) => b.map((x) => x.dataset.gc).join())) === 'hfa619,wfh619');
    await p.fill('#doseAge', '60'); await p.fill('#doseWeight', '60'); await p.fill('#doseHeight', '160'); await p.check('#doseRenalAdjust'); await p.fill('#doseCr', '1'); await p.waitForTimeout(100);
    check('กราฟเด็ก: ผู้ใหญ่ (60 ปี) → ไม่แสดงกราฟ', await p.$eval('#doseGrowth', (e) => e.hidden));
    { // ขนาดยาหน่วยไมโครกรัม (65_dose_mcg.sql): levothyroxine mcg/กก. → แปลงเป็น มก. ก่อนคิดจำนวนเม็ด (เม็ด 100 MCG)
      const saved = await p.evaluate(() => ({ age: document.querySelector('#doseAge').value, w: document.querySelector('#doseWeight').value, h: document.querySelector('#doseHeight').value, cr: document.querySelector('#doseCr').value, ren: document.querySelector('#doseRenalAdjust').checked, drug: document.querySelector('#doseDrug').value }));
      await p.evaluate(async () => {
        const db = window.__db, base = db.dose_drugs.find((x) => x.active);
        db.dose_drugs.push({ ...base, id: 9902, name: 'Levothyroxine sodium', active: true, ai_draft: false, form: 'ยาเม็ด', ai_source: null,
          indications: [{ name: 'ภาวะพร่องไทรอยด์แต่กำเนิด', unit: 'mcg', per: 'day', min: 10, max: 15, times: 1 }], concs: [] });
        db.local_drugs.find((x) => /THYROXINE/i.test(x.name)).dose_id = 9902;
        const m = await import('./js/pages/dose.js?v=4.4'); m.resetDrugInfo(); await m.initDose();
      });
      await p.uncheck('#doseRenalAdjust'); await p.fill('#doseAge', ''); await p.fill('#doseWeight', '10');
      const v = await p.$$eval('#doseDrug option', (o) => o.find((x) => /Levothyroxine/.test(x.textContent))?.value);
      await p.selectOption('#doseDrug', v); await p.waitForTimeout(400);
      const t = await text(p, '#doseResult');
      check('ขนาดยาหน่วย mcg: 10–15 mcg/กก./วัน × 10 กก. = 100–150 mcg → เม็ด 100 MCG 1–1.5 เม็ด', t.includes('100–150 mcg') && t.includes('1.00–1.50 เม็ด'), t.slice(0, 300));
      // ยาสูตรผสม (66_combo_drugs.sql): co-trimoxazole เม็ด 400/80 · คิดจาก Trimethoprim 8–12 มก./กก./วัน แบ่ง 2 ครั้ง
      await p.evaluate(async () => {
        const db = window.__db, base = db.dose_drugs.find((x) => x.active);
        db.dose_drugs.push({ ...base, id: 9903, name: 'Co-trimoxazole', active: true, ai_draft: false, form: 'ยาเม็ด', ai_source: null, concs: [],
          indications: [{ name: 'ติดเชื้อทางเดินปัสสาวะ', basis: 'Trimethoprim', per: 'day', min: 8, max: 12, times: 2 }, { name: 'ยังไม่ระบุสารที่ใช้คิด', per: 'day', min: 8, max: 12, times: 2 }] });
        db.local_drugs.find((x) => x.code === '1010280').dose_id = 9903;
        const m = await import('./js/pages/dose.js?v=4.4'); m.resetDrugInfo(); await m.initDose();
      });
      await p.fill('#doseWeight', '20');
      { const v2 = await p.$$eval('#doseDrug option', (o) => o.find((x) => x.textContent === 'Co-trimoxazole')?.value);
        await p.selectOption('#doseDrug', v2); await p.waitForTimeout(400);
        const t2 = await text(p, '#doseResult'), opt = await text(p, '#doseConc');
        check('ยาสูตรผสม: ความแรงแสดงสารสำคัญทุกตัว (400/80 มก./เม็ด)', opt.includes('400/80') && opt.includes('Sulfamethoxazole + Trimethoprim'), opt);
        check('ยาสูตรผสม: คิดจาก Trimethoprim → 80–120 มก./ครั้ง = 1–1.5 เม็ด + ได้รับ SMX 400–600 · TMP 80–120 มก.', t2.includes('คิดจาก Trimethoprim') && t2.includes('80–120 มก.') && t2.includes('1.00–1.50 เม็ด') && t2.includes('Sulfamethoxazole 400–600 มก.') && t2.includes('Trimethoprim 80–120 มก.'), t2.slice(0, 600));
        check('ยาสูตรผสม: ข้อบ่งใช้ที่ยังไม่ระบุสารที่ใช้คิด → เตือน ไม่คิดจำนวนเม็ด (กันคิดผิด 5 เท่า)', t2.includes('ยังไม่ได้ระบุว่าคิดขนาดยาจากสารสำคัญตัวใด')); }
      // ผูกข้อมูลคำนวณไว้กับสาร (ingredients[].dose_id) → คิดจากสารนั้นเลย ไม่ต้องระบุในข้อบ่งใช้
      await p.evaluate(async () => {
        const db = window.__db, l = db.local_drugs.find((x) => x.code === '1010280');
        db.dose_drugs.push({ ...db.dose_drugs.find((x) => x.id === 9903), id: 9904, name: 'Trimethoprim (ทดสอบ)', indications: [{ name: 'ติดเชื้อ', per: 'day', min: 8, max: 12, times: 2 }] });
        l.dose_id = null; l.ingredients = l.ingredients.map((x) => (x.name === 'Trimethoprim' ? { ...x, dose_id: 9904 } : x));
        const m = await import('./js/pages/dose.js?v=4.4'); m.resetDrugInfo(); await m.initDose();
      });
      { const v3 = await p.$$eval('#doseDrug option', (o) => o.find((x) => x.textContent === 'Trimethoprim (ทดสอบ)')?.value);
        await p.selectOption('#doseDrug', v3); await p.waitForTimeout(400);
        const t3 = await text(p, '#doseResult');
        check('ยาสูตรผสม: ข้อมูลคำนวณผูกกับสาร Trimethoprim → ยา co-trimoxazole ขึ้นในเครื่องคำนวณ + คิดจาก TMP 1–1.5 เม็ด', t3.includes('คิดจาก Trimethoprim') && t3.includes('1.00–1.50 เม็ด') && t3.includes('Sulfamethoxazole 400–600 มก.'), t3.slice(0, 500)); }
      await p.evaluate(() => { const db = window.__db, l = db.local_drugs.find((x) => x.code === '1010280'); l.ingredients = l.ingredients.map(({ dose_id, ...x }) => x); db.dose_drugs = db.dose_drugs.filter((x) => x.id !== 9904); });
      await p.evaluate(async () => { const db = window.__db; db.dose_drugs = db.dose_drugs.filter((x) => x.id !== 9903); db.local_drugs.find((x) => x.code === '1010280').dose_id = null; });
      await p.fill('#doseWeight', '10'); await p.selectOption('#doseDrug', v); await p.waitForTimeout(300);
      check('ใต้ผลคำนวณ: ขนาดยาและวิธีใช้จากฉลากยา (openFDA) ของยาที่เลือก', (await text(p, '#doseLabel')).includes('ขนาดยาและวิธีใช้') && (await text(p, '#doseLabel')).includes('openFDA'), await text(p, '#doseLabel'));
      await p.evaluate(async () => { const db = window.__db; db.dose_drugs = db.dose_drugs.filter((x) => x.id !== 9902); db.local_drugs.find((x) => /THYROXINE/i.test(x.name)).dose_id = null; const m = await import('./js/pages/dose.js?v=4.4'); m.resetDrugInfo(); await m.initDose(); });
      await p.fill('#doseAge', saved.age); await p.fill('#doseWeight', saved.w); await p.fill('#doseHeight', saved.h);
      if (saved.ren) { await p.check('#doseRenalAdjust'); await p.fill('#doseCr', saved.cr); }
      await p.selectOption('#doseDrug', saved.drug); await p.waitForTimeout(200); }
    { const t = await text(p, '#doseResult');
      check('ไต: CrCl Cockcroft-Gault ตาม MDCalc (ใส่ส่วนสูง → BMI ปกติใช้ IBW)', (await p.inputValue('#doseCrClOut')).startsWith('49.') && t.includes('IBW (BMI 18.5–24.9)') && t.includes('ไตเสื่อมเล็กน้อย'), `${await p.inputValue('#doseCrClOut')} ${t.slice(0, 200)}`); }
    await p.selectOption('#doseRenalMethod', 'egfr'); await p.waitForTimeout(100);
    check('ไต: เลือก eGFR (CKD-EPI 2021)', (await p.inputValue('#doseCrClOut')).startsWith('64.') && (await text(p, '#doseCrClLbl')) === 'eGFR' && (await text(p, '#doseResult')).includes('CKD-EPI 2021'), await p.inputValue('#doseCrClOut'));
    await p.fill('#doseHeight', ''); await p.selectOption('#doseRenalMethod', 'crcl'); await p.waitForTimeout(100);
    check('ไต: ไม่ใส่ส่วนสูง → CrCl ใช้น้ำหนักจริง', (await p.inputValue('#doseCrClOut')).startsWith('56.') && (await text(p, '#doseResult')).includes('น้ำหนักจริง'), await p.inputValue('#doseCrClOut'));
    await p.fill('#doseCr', ''); await p.uncheck('#doseRenalAdjust'); await p.fill('#doseAge', ''); await p.fill('#doseWeight', '20'); await p.selectOption('#doseSex', 'm');
    // คำนวณสารน้ำ
    await p.click('#doseTabs [data-dt="fluid"]'); await p.waitForTimeout(200);
    { const t = await text(p, '#fxOut');
      check('สารน้ำ: D5-N/2 1000 มล. → D10 วิธีที่ 1 ดูดออก/เติม 111 มล. · วิธีที่ 2 เติม 125 มล. รวม 1125 มล. + ภาพขั้นตอน', await visible(p, '#dosePaneFluid') && !(await visible(p, '#dosePaneCalc')) && t.includes('ดูดออก 111 มล.') && t.includes('เติม 125 มล.') && t.includes('1125 มล.') && await count(p, '#fxOut .fx-step svg') === 7, t.slice(0, 300)); }
    check('สารน้ำ: ตารางเตรียมน้ำเกลือที่ใช้บ่อยท้ายช่อง (วิธีที่ 1: 7 แถว · วิธีที่ 2: 5 แถว)', await count(p, '#fxTable table') === 2 && await count(p, '#fxTable tbody tr') === 12 && (await text(p, '#fxTable')).includes('10%D - N/2'));
    await p.selectOption('#fxN2', '0.9'); await p.waitForTimeout(100);
    check('สารน้ำ: ปรับ NaCl ด้วย (N/2 → S) → ดูดออก 333 · เติม 50%D 133 + 3% NaCl 200 มล.', (await text(p, '#fxOut')).includes('ดูดออก 333 มล.') && (await text(p, '#fxOut')).includes('เติม 133 มล.') && (await text(p, '#fxOut')).includes('เติม 200 มล.'), await text(p, '#fxOut'));
    await p.selectOption('#fxD1', '0'); await p.fill('#fxD2', '7.5'); await p.selectOption('#fxN2', '0.225'); await p.waitForTimeout(100);
    check('สารน้ำ: เกลือน้อยกว่าถุงเดิม (0%D-N/2 1000 → 7.5%D-N/4) → ดูดออก 500 · เติม 50%D 150 + น้ำกลั่น 350 มล. (ไม่ใช่ 3% NaCl ติดลบ)', await p.evaluate(() => { const t = document.querySelector('#fxOut').innerText; return ['ดูดออก 500 มล.', 'เติม 150 มล.', 'เติม 350 มล.', 'น้ำกลั่น', 'Dextrose 7.5%', 'NaCl 0.225%'].every((x) => t.includes(x)) && !/-\d+ มล/.test(t); }), await text(p, '#fxOut'));
    await p.selectOption('#fxD1', '5'); await p.fill('#fxD2', '10');
    await p.selectOption('#fxN2', 'same'); await p.fill('#fxD2', '15'); await p.waitForTimeout(100);
    check('สารน้ำ: Dextrose > 12.5% เตือนให้ทาง central line', (await text(p, '#fxOut')).includes('central line'));
    await p.fill('#fxD2', '10');
    // Drug interaction: เทียบยา รพ.สต. เป็นคอลัมน์ + แจ้งเตือนคู่ interaction (DDInter)
    await p.click('#doseTabs [data-dt="ddi"]'); await p.waitForTimeout(500);
    { const pick = await p.evaluate(() => { const db = window.__db, pr = db.ddi_pairs.find((x) => x.level === 'Major' && x.description);
        const la = db.local_drugs.find((l) => l.active && (l.ddi_ids || []).includes(pr.a)), lb = db.local_drugs.find((l) => l.active && (l.ddi_ids || []).includes(pr.b));
        return { a: la.id, b: lb.id, an: db.ddi_drugs.find((d) => d.id === pr.a).name, bn: db.ddi_drugs.find((d) => d.id === pr.b).name }; });
      check('Drug interaction: เริ่มที่ 1 คอลัมน์ + ปุ่มเพิ่มยา · เลือกได้เฉพาะยา รพ.สต.', await visible(p, '#dosePaneDdi') && await count(p, '#ddiCols .ddi-col') === 1 && await visible(p, '[data-ddi-add]') && await count(p, '#ddiSel0 option') > 30 && (await text(p, '#ddiAlerts')).includes('อย่างน้อย 2 ตัว'));
      await p.selectOption('#ddiSel0', String(pick.a)); await p.waitForTimeout(400);
      check('Drug interaction: เลือกยา → ภาพเส้นทางยา (ให้ยา→ตับ/เอนไซม์→ออกฤทธิ์→ขับออก) + ชื่อยา', await count(p, '#ddiBody0 ol.ddi-path') === 1 && (await text(p, '#ddiBody0')).includes(pick.an) && (await p.$eval('#ddiBody0 ol.ddi-path', (x) => x.getAttribute('aria-label'))).includes('ตับ'));
      check('Drug interaction: กล่องตับบอกว่าเปลี่ยนเป็นรูปที่ออกฤทธิ์/ไม่ออกฤทธิ์', /ออกฤทธิ์|ขับออกในรูปเดิม|แร่ธาตุ|ไม่ถูกดูดซึม|ยังไม่มีข้อมูลรูปที่ได้/.test(await text(p, '#ddiBody0 .ddi-b2 .ddi-met')), await text(p, '#ddiBody0 .ddi-b2'));
      await p.click('[data-ddi-add]'); await p.waitForTimeout(200); await p.selectOption('#ddiSel1', String(pick.b)); await p.waitForTimeout(500);
      const t = await text(p, '#ddiAlerts');
      check('Drug interaction: เลือกยาตัวที่ 2 → แจ้งเตือนคู่ interaction ด้านบน (ระดับรุนแรงขึ้นก่อน)', await count(p, '#ddiAlerts .ddi-alert') >= 1 && t.includes('Major') && t.includes(pick.an) && t.includes(pick.bn) && (await p.$eval('#ddiAlerts .ddi-alert', (e) => e.className)).includes('ddi-major'), t.slice(0, 200));
      await p.click('#ddiAlerts .ddi-alert-btn'); await p.waitForTimeout(150);
      check('Drug interaction: กดคู่ยา → ภาพตำแหน่งที่เกิด + เกิดอะไรขึ้น/ควรทำอย่างไร + ที่มา DDInter', await count(p, '#ddiAlerts .ddi-pic') === 1 && (await text(p, '#ddiAlerts')).includes('ควรทำอย่างไร') && await count(p, '#ddiAlerts a[href*="ddinter.scbdd.com"]') === 1);
      check('Drug interaction: ข้อความในภาพคู่ยาพอดีกล่อง (ไม่ล้น/ไม่ถูกตัด)', await p.$$eval('#ddiAlerts .pp-drug, #ddiAlerts .pp-site', (els) => els.length === 3 && els.every((e) => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1)));
      check('Drug interaction: 2 คอลัมน์ ส่วนต่าง ๆ อยู่ระดับเดียวกัน (ชื่อยา · ภาพเส้นทางยา · ข้อมูล)', await p.evaluate(() => ['.ddi-name', '.ddi-path', '.ddi-text'].every((c) => { const t = [...document.querySelectorAll(`#ddiCols ${c}`)].map((e) => Math.round(e.getBoundingClientRect().top)); return t.length === 2 && Math.abs(t[0] - t[1]) <= 1; })), JSON.stringify(await p.evaluate(() => ['.ddi-name', '.ddi-path', '.ddi-text'].map((c) => [...document.querySelectorAll(`#ddiCols ${c}`)].map((e) => Math.round(e.getBoundingClientRect().top))))));
      await p.click('[data-ddi-add]'); await p.waitForTimeout(150);
      check('Drug interaction: เพิ่มได้หลายคอลัมน์ · ลบคอลัมน์ได้', await count(p, '#ddiCols .ddi-col') === 3 && await count(p, '[data-ddi-del]') === 3);
      await p.click('[data-ddi-del="2"]'); await p.waitForTimeout(150);
      check('Drug interaction: ลบแล้วเหลือ 2 คอลัมน์ แจ้งเตือนยังอยู่', await count(p, '#ddiCols .ddi-col') === 2 && await count(p, '#ddiAlerts .ddi-alert') >= 1); }
    await p.click('#doseTabs [data-dt="calc"]');
    check('ข้อมูลยา/คำนวณขนาดยา: ชื่อเมนูและหัวข้อใหม่ + แยก 2 ส่วน (เริ่มที่คำนวณ)', (await text(p, '[data-panel-link="dose"]')).includes('ข้อมูลยา') && (await text(p, '[data-panel="dose"] h2')).includes('ข้อมูลยา / คำนวณขนาดยา')
      && await count(p, '#doseTabs [data-dt]') === 4 && await visible(p, '#dosePaneCalc') && !(await visible(p, '#dosePaneInfo')));
    await p.click('#doseTabs [data-dt="info"]'); await p.waitForTimeout(400);
    { const nLocal = await p.evaluate(() => window.__db.local_drugs.filter((d) => d.active).length);
      check('ข้อมูลยา: เริ่มที่รายการยา รพ.สต. (ครบทุกรายการ แยกหมวด) · ซ่อนส่วนคำนวณ', await visible(p, '#dosePaneInfo') && !(await visible(p, '#dosePaneCalc')) && nLocal >= 100 && await count(p, '#doseInfoList .di-item') === nLocal && await count(p, '#doseInfoList .di-cat') >= 5 && (await p.inputValue('#doseScope')) === 'local' && await p.$eval('#doseScope', (s) => s.closest('.form-grid') === document.querySelector('#doseInfoQ').closest('.form-grid')) && !(await visible(p, '#doseInfoMore')), String(nLocal)); }
    check('ข้อมูลยา: ช่องค้นหากว้างกว่าตัวกรอง (จอกว้าง)', await p.evaluate(() => document.querySelector('#doseInfoQ').getBoundingClientRect().width > 1.5 * document.querySelector('#doseScope').getBoundingClientRect().width));
    await p.fill('#doseInfoQ', 'paracetamol'); await p.waitForTimeout(100);
    check('ข้อมูลยา รพ.สต.: ค้นหา → ยาทุกขนาด + ชื่อในบัญชียาหลัก + คำนวณขนาดยาได้', await count(p, '#doseInfoList .di-item') === 3 && (await text(p, '#doseInfoList')).includes('Paracetamol (Acetaminophen)') && (await text(p, '#doseInfoList')).includes('คำนวณขนาดยาได้'));
    await p.fill('#doseInfoQ', 'PARACETAMOL 500'); await p.waitForTimeout(100); await p.click('#doseInfoList .di-item'); await p.waitForTimeout(300);
    { const t = await text(p, '#doseMono');
      check('ข้อมูลยา รพ.สต.: เลือกยา → รหัสยา/หมวด/ขนาดบรรจุ + monograph บัญชียาหลัก + ขนาดยา', t.includes('1050042') && t.includes('ยาเม็ด/แคปซูล') && t.includes('Analgesics and antipyretics') && t.includes('มก./กก./ครั้ง') && t.includes('ราชกิจจานุเบกษา'), t.slice(0, 300)); }
    check('ข้อมูลยา รพ.สต.: รวมข้อมูลฉลากยาสหรัฐฯ (openFDA) หัวข้อไทย + เนื้อหาอังกฤษ + ลิงก์ DailyMed', await visible(p, '#doseMono .mono-fda') && (await text(p, '#doseMono .mono-fda')).includes('ขนาดยาและวิธีใช้') && (await p.$eval('#doseMono .mono-fda', (e) => e.textContent)).includes('acetaminophen') && await count(p, '#doseMono .mono-fda details[open]') >= 2 && await count(p, '#doseMono .mono-fda a[href*="dailymed"]') === 1);
    await p.click('[data-mono-back]'); await p.selectOption('#doseInfoGroup', 'l:ยาสมุนไพร'); await p.fill('#doseInfoQ', ''); await p.waitForTimeout(100);
    check('ข้อมูลยา รพ.สต.: กรองหมวด · ยาที่ยังไม่ผูกข้อมูลยาบอกชัด', await count(p, '#doseInfoList .di-item') === 10 && (await text(p, '#doseInfoList')).includes('ยังไม่มีข้อมูลยา'));
    await p.selectOption('#doseScope', 'all'); await p.waitForTimeout(150);
    { const nLocal = await p.evaluate(() => window.__db.local_drugs.filter((d) => d.active).length);
      check('ข้อมูลยา: แหล่งข้อมูล "ทั้งหมด" → ยา รพ.สต. ครบ + บัญชียาหลัก 40 แรก (ตัวกรองหมวดรวมสองแหล่ง)', await count(p, '#doseInfoList .di-item') === nLocal + 40 && await count(p, '#doseInfoList [data-scope="local"]') === nLocal && await visible(p, '#doseInfoMore') && await count(p, '#doseInfoGroup optgroup') === 2 && (await p.inputValue('#doseInfoGroup')) === 'all'); }
    await p.selectOption('#doseScope', 'nlem'); await p.waitForTimeout(150);
    check('ข้อมูลยา: บัญชียาหลักแห่งชาติทั้งหมด (ทีละ 40 + แสดงเพิ่ม · ตัวกรองเป็นกลุ่มยา)', await count(p, '#doseInfoList .di-item') === 40 && await visible(p, '#doseInfoMore') && (await text(p, '#doseInfoGroupLbl')) === 'กลุ่มยา' && (await p.inputValue('#doseInfoGroup')) === 'all', await text(p, '#doseInfoN'));
    check('ข้อมูลยา: โหลดรายการทีละ ≤1000 แถว (ครบเกิน 900 ยา)', (await calls(p, (c) => c.table === 'drug_monographs')).some((c) => c.range) && Number((await text(p, '#doseInfoN')).match(/\d+/)?.[0]) > 750);
    await p.selectOption('#doseInfoGroup', 'n:1'); await p.fill('#doseInfoQ', 'domperidone'); await p.waitForTimeout(150);
    check('ข้อมูลยา: กรองกลุ่มยา + ค้นหาชื่อยา', await count(p, '#doseInfoList .di-item') === 1 && (await text(p, '#doseInfoList')).includes('Domperidone') && (await text(p, '#doseInfoList')).includes('และอีก 1 กลุ่ม'));
    await p.click('#doseInfoList .di-item'); await p.waitForTimeout(300);
    { const t = await text(p, '#doseMono');
      check('ข้อมูลยา: เลือกยา → monograph (กลุ่มยาทุกกลุ่ม · รูปแบบยา/บัญชี · คำเตือน · ที่มา)', await visible(p, '#doseMono') && !(await visible(p, '#doseInfoPick')) && t.includes('Gastro-intestinal system') && t.includes('Central nervous system') && t.includes('บัญชียาพื้นฐาน') && t.includes('prolonged QT') && t.includes('คำเตือนและข้อควรระวัง') && t.includes('ราชกิจจานุเบกษา'), t.slice(0, 300)); }
    await p.click('[data-mono-back]'); await p.waitForTimeout(100);
    check('ข้อมูลยา: ปุ่มกลับ → รายการเดิม (คำค้นยังอยู่)', await visible(p, '#doseInfoPick') && (await p.inputValue('#doseInfoQ')) === 'domperidone');
    await p.selectOption('#doseInfoGroup', 'all'); await p.fill('#doseInfoQ', 'ไม่มียานี้แน่นอน'); await p.waitForTimeout(100);
    check('ข้อมูลยา: ไม่พบ → แจ้ง', (await text(p, '#doseInfoList')).includes('ไม่พบยา'));
    await p.fill('#doseInfoQ', 'พาราเซตามอล'); await p.waitForTimeout(100);
    check('ข้อมูลยา: ค้นชื่อไทยของยาในเครื่องคำนวณ → พบยาในบัญชี (จับคู่ชื่ออังกฤษ)', await count(p, '#doseInfoList .di-item') === 1 && (await text(p, '#doseInfoList')).includes('Paracetamol (Acetaminophen)') && (await text(p, '#doseInfoList')).includes('คำนวณขนาดยาได้'));
    await p.click('#doseInfoList .di-item'); await p.waitForTimeout(300);
    check('ข้อมูลยา: monograph มีขนาดยาจากเครื่องคำนวณ', (await text(p, '#doseMono')).includes('มก./กก./ครั้ง') && (await text(p, '#doseMono')).includes('Analgesics and antipyretics'));
    await p.click('#doseMono [data-dose-calc]'); await p.waitForTimeout(150);
    check('ข้อมูลยา: ปุ่ม "คำนวณขนาดยานี้" → ส่วนคำนวณพร้อมเลือกยานั้น', await visible(p, '#dosePaneCalc') && !(await visible(p, '#dosePaneInfo')) && (await p.$eval('#doseDrug', (s) => s.selectedOptions[0].textContent)).includes('Paracetamol') && (await text(p, '#doseResult')).includes('มก.'));
    await p.click('#doseTabs [data-dt="info"]'); await p.click('[data-mono-back]'); await p.fill('#doseInfoQ', ''); await p.selectOption('#doseScope', 'local'); await p.click('#doseTabs [data-dt="calc"]');
    await p.click('[data-panel-link="tracking"]'); await p.waitForTimeout(300);
    check('ผลการดำเนินงาน: ตัวเลขแสดง', (await text(p, '#trkVisits')).trim() !== '');
    await p.click('[data-panel-link="delivery"]'); await p.waitForTimeout(400);
    check('บริการจัดส่งยาถึงบ้าน: ช่องใต้ผลการดำเนินงาน + ข้อความแนะนำ + สถิติการจัดส่ง', await visible(p, '[data-panel="delivery"]') && (await text(p, '#dlInfo')).includes('จัดส่งยาถึงบ้าน') && (await text(p, '#dlFigs')).includes('105') && await count(p, '#dlBars .bar-row') === 3
      && await p.evaluate(() => { const l = [...document.querySelectorAll('.menu-icons [data-panel-link]')].map((a) => a.dataset.panelLink); return l.indexOf('delivery') === l.indexOf('tracking') + 1; }));
    check('Health Rider: ผลงานอยู่ในช่องบริการจัดส่งยาถึงบ้าน (ข้อความแนะนำ + ตัวเลขรวม + ราย รพ.สต.) · ไม่มีปุ่มเมนูแยก', await visible(p, '[data-panel="delivery"] #hrBlock') && (await text(p, '#hrInfo')).includes('Health Rider') && (await text(p, '#hrFigs')).includes('48') && await count(p, '#hrBars .bar-row') === 2
      && !(await p.$('[data-panel-link="rider"]')) && (await text(p, '[data-panel-link="delivery"]')).includes('บริการจัดส่งยาถึงบ้าน (Health Rider)'));
    await go(p, '#/achievements');
    check('ผลงาน รพ.สต.: การ์ดผลงานแสดง (ลิงก์เดิมยังเปิดได้)', await count(p, '#achGrid .news-card') >= 2);
    await go(p, '#/tracking'); await p.waitForTimeout(400);
    check('อันดับผลการประเมินเกณฑ์มาตรฐาน: อยู่ในช่องผลการดำเนินงาน ใต้ "ผลงานด้านเภสัชกรรมปฐมภูมิ" (ไม่อยู่ในช่องผลงานแล้ว)',
      await visible(p, '[data-panel="tracking"] #lbPodium') && await count(p, '[data-panel="achievements"] #lbPodium') === 0 && await count(p, '#lbYearTabs button') > 0
      && await p.evaluate(() => { const a = document.getElementById('trkSums').closest('.panel'), b = document.getElementById('lbPodium').closest('.panel'); return a.nextElementSibling === b; }));
    await p.click('[data-fc="docs"]'); await p.waitForTimeout(500);
    check('ดาวน์โหลดเอกสาร (ไม่ล็อกอิน): ปุ่มท้ายเว็บ → หน้าเอกสาร เห็นเฉพาะที่ผู้ดูแลเลือก "ประชาชนทั่วไป"', (await p.evaluate(() => location.hash)) === '#/documents' && await visible(p, '[data-panel="documents"]')
      && await count(p, '#sdList .li') === 1 && (await text(p, '#sdList')).includes('แผ่นพับการใช้ยาอย่างปลอดภัย') && (await text(p, '#sdWho')).includes('ประชาชนทั่วไป'), String(await count(p, '#sdList .li')));
    await p.click('#sdList [data-dl]'); await p.waitForTimeout(400);
    check('ดาวน์โหลดเอกสาร (ไม่ล็อกอิน): กดดาวน์โหลด → ลิงก์ชั่วคราว + นับจำนวน', (await calls(p, (c) => c.signed === 'documents' && c.path === 'all/1-d.pdf')).length === 1 && (await calls(p, (c) => c.rpc === 'bump_doc_download')).length === 1);
    await go(p, '#/contact');
    check('ช่องทางติดต่อ: ครบ 7 รพ.สต.', await count(p, '#contactGrid .center') === 7);
    const newsId = await p.evaluate(() => window.__db.news.find((n) => n.status === 'published' && !n.comments_closed).id);
    await go(p, '#/news/' + newsId);
    check('อ่านข่าว: หัวข้อ + ปุ่มถูกใจ + ช่องความคิดเห็น (ไม่ login แจ้งว่าพิมพ์ได้ 15 ตัวอักษร)', (await text(p, '#arTitle')) && await visible(p, '#arLikeBtn') && await visible(p, '#arCommentForm') && (await text(p, '#arCommentLogin')).includes('15 ตัวอักษร'));
    {
      const before = +(await text(p, '#arLikeCount'));
      await p.click('#arLikeBtn'); await p.waitForTimeout(300);
      const lk = (await calls(p, (c) => c.rpc === 'like_news_anon'))[0]?.args;
      check('ถูกใจ: กดได้โดยไม่ต้องเข้าสู่ระบบ (ยอด +1 + ปุ่มเป็นถูกใจแล้ว)', lk?.p_on === true && /^[0-9a-f-]{36}$/.test(lk?.p_token) && +(await text(p, '#arLikeCount')) === before + 1 && (await p.getAttribute('#arLikeBtn', 'aria-pressed')) === 'true');
      await p.click('#arLikeBtn'); await p.waitForTimeout(300);
      check('ถูกใจ: กดอีกครั้งยกเลิกได้ (เครื่องเดิม)', (await calls(p, (c) => c.rpc === 'like_news_anon')).some((c) => c.args.p_on === false && c.args.p_token === lk?.p_token) && +(await text(p, '#arLikeCount')) === before);
      await p.fill('#arCommentText', 'ข้อความนี้ยาวเกินสิบห้าตัวอักษรแน่นอน'); await p.waitForTimeout(100);
      check('ความคิดเห็น (ไม่ login): พิมพ์เกิน 15 ตัวอักษร → เตือนให้เข้าสู่ระบบ', (await text(p, '#arCommentMsg')).includes('กรุณาเข้าสู่ระบบเพื่อเขียนแสดงความเห็นมากขึ้น'));
      await p.click('#arCommentForm button'); await p.waitForTimeout(200);
      check('ความคิดเห็น (ไม่ login): ยาวเกินส่งไม่ได้', (await calls(p, (c) => c.rpc === 'comment_news_anon')).length === 0 && (await text(p, '#arCommentMsg')).includes('เข้าสู่ระบบ'));
      await p.fill('#arCommentText', 'ดีมากครับ'); await p.click('#arCommentForm button'); await p.waitForTimeout(400);
      check('ความคิดเห็น (ไม่ login): ไม่เกิน 15 ตัวอักษรส่งได้ แสดงชื่อ "ผู้เยี่ยมชม"', (await calls(p, (c) => c.rpc === 'comment_news_anon')).length === 1 && (await text(p, '#arComments')).includes('ผู้เยี่ยมชม') && (await text(p, '#arComments')).includes('ดีมากครับ'));
    }
    await p.route(/img\.test\/.*(a4p|a4l|tall)/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: SIZED[r.request().url().match(/(a4p|a4l|tall)/)[1]] }));
    for (const [kind, want] of [['a4p', 'fit'], ['a4l', 'fit'], ['tall', 'crop-tall']]) {
      await p.evaluate(([id, k]) => { window.__db.news.find((n) => n.id === id).image_path = `news/x/${k}.png`; }, [newsId, kind]);
      await go(p, '#/'); await go(p, '#/news/' + newsId); await p.waitForTimeout(300);
      const st = await p.$eval('#arCover', (b) => { const r = b.getBoundingClientRect(), i = b.querySelector('img'); return { cls: b.className, ar: r.width / r.height, fit: getComputedStyle(i).objectFit }; });
      check(`อ่านข่าว: รูป ${kind} → ${want === 'fit' ? 'แสดงทั้งภาพไม่ครอบตัด' : 'ครอบตัดเป็นกรอบ A4'}`, st.cls.includes(want) && (want === 'fit' ? st.fit === 'contain' && Math.abs(st.ar - (kind === 'a4p' ? 620 / 877 : 877 / 620)) < 0.03 : st.fit === 'cover' && Math.abs(st.ar - 1 / Math.SQRT2) < 0.03), JSON.stringify(st));
    }
    await p.click('#arCover .zoom-btn'); await p.waitForTimeout(200);
    check('อ่านข่าว: ปุ่ม "ขยายภาพ" เปิดภาพเต็มจอ', await p.$eval('dialog.lightbox', (d) => d.open && d.querySelector('img').src.includes('tall')));
    await p.click('dialog.lightbox .lb-body img'); await p.waitForTimeout(100);
    check('ภาพเต็มจอ: กดที่ภาพสลับเป็นขนาดจริง (ภาพยาวไม่ถูกตัด)', await p.$eval('dialog.lightbox img', (i) => i.classList.length >= 0 && i.getBoundingClientRect().height >= 1400));
    await p.screenshot({ path: path.join(SHOTS, 'lightbox-1280.png') });
    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    check('ภาพเต็มจอ: กด Esc ปิดได้', !(await p.$eval('dialog.lightbox', (d) => d.open)));
    await go(p, '#/admin');
    check('ยังไม่ login เข้าหน้าผู้ดูแล → ไปหน้าเข้าสู่ระบบ', await visible(p, '[data-view="login"]'));
    await p.click('#googleBtn'); await p.waitForTimeout(200);
    check('ปุ่ม Google เรียกเข้าสู่ระบบด้วย Google เท่านั้น', (await calls(p, (c) => c.oauth)).some((c) => c.oauth.provider === 'google'));
    await p.click('#srLoginBtn'); await p.waitForTimeout(200);
    check('หน้าเข้าสู่ระบบ: ปุ่มขอสิทธิ์เจ้าหน้าที่ → login แล้วพาไปหน้าคำขอ', (await calls(p, (c) => c.oauth)).length === 2 && (await p.evaluate(() => sessionStorage.getItem('pcps_after_login'))) === '#/me/request');
    await p.screenshot({ path: path.join(SHOTS, 'public-login.png') });
    await p.close();

    /* ================= ประชาชน ================= */
    p = await open('citizen', '#/me');
    check('ประชาชน: หน้า "ของฉัน" แสดงข้อมูลส่วนตัว', (await p.$eval('#mePhone', (e) => e.value)) !== '');
    check('ประชาชน: ปลายทางแชทเลือก รพ.สต. เท่านั้น (ไม่มีปุ่มห้องยา) · ห้องยาเดิมอยู่ในรายการเฉพาะคนที่เคยคุย', await count(p, '#meUnitPick option') === 9 && await count(p, '#meUnitPick option[value="h"]') === 1 && !(await p.$('#meTargets button')));
    await p.selectOption('#meUnitPick', '3'); await p.waitForTimeout(300);
    check('ประชาชน: เลือก รพ.สต. จากรายการ → เปิดห้องของหน่วยนั้น', (await text(p, '#meChatTitle')).includes('รพ.สต.') && await p.$eval('.me-pick', (e) => e.classList.contains('on')));
    await p.selectOption('#meUnitPick', 'h'); await p.waitForTimeout(300);
    check('ประชาชน: ห้องยา รพ. เดิม อ่านข้อความเก่าได้', (await text(p, '#meChatTitle')).includes('ห้องยา') && await count(p, '#meLog .bubble') >= 1);
    await p.fill('#meInput', 'ถามต่อ'); await p.click('#meSend'); await p.waitForTimeout(300);
    check('ประชาชน: ห้องยา รพ. ปิดรับข้อความใหม่ (แนะนำให้เลือก รพ.สต.)', (await text(p, '#meChatHint')).includes('ปิดรับ') && (await calls(p, (c) => c.table === 'messages' && c.op === 'insert')).length === 0);
    await p.selectOption('#meUnitPick', '2'); await p.waitForTimeout(300);
    check('ประชาชน: เห็นข้อความเดิมในห้องแชท', await count(p, '#meLog .bubble') >= 1);
    await p.fill('#meInput', 'ทดสอบถามเรื่องยา'); await p.click('#meSend'); await p.waitForTimeout(400);
    check('ประชาชน: ส่งข้อความได้', (await calls(p, (c) => c.table === 'messages' && c.op === 'insert')).length === 1);
    await p.fill('#mePhone', '12'); await p.click('#meSave'); await p.waitForTimeout(150);
    check('ประชาชน: เบอร์ผิดรูปแบบถูกเตือน', (await text(p, '#meMsg')).includes('เบอร์'));
    await p.fill('#mePhone', '0899999999'); await p.click('#meSave'); await p.waitForTimeout(300);
    check('ประชาชน: บันทึกข้อมูลส่วนตัวได้', (await calls(p, (c) => c.table === 'profiles' && c.op === 'update')).length === 1);
    await go(p, '#/admin');
    check('ประชาชนเข้าหน้าผู้ดูแลไม่ได้', (await text(p, '#msgTitle')).includes('ไม่มีสิทธิ์'));
    await go(p, '#/me/request'); await p.waitForTimeout(300);
    check('ขอสิทธิ์เจ้าหน้าที่: เปิดฟอร์มจากลิงก์ (ชื่อ/เบอร์เติมจากโปรไฟล์)', await visible(p, '#srForm') && (await p.$eval('#srName', (e) => e.value)) !== '' && (await p.$eval('#srPhone', (e) => e.value)) !== '');
    await p.fill('#srPos', 'จพ.เภสัชกรรม'); await p.click('#srSubmit'); await p.waitForTimeout(400);
    check('ขอสิทธิ์เจ้าหน้าที่: ส่งคำขอแล้วเห็นสถานะ "รออนุมัติ" + ยกเลิกได้', (await calls(p, (c) => c.table === 'staff_requests' && c.op === 'insert')).length === 1 && (await text(p, '#srState')).includes('รออนุมัติ') && await visible(p, '[data-sr-withdraw]'));
    await p.click('[data-sr-withdraw]'); await p.waitForTimeout(400);
    check('ขอสิทธิ์เจ้าหน้าที่: ยกเลิกคำขอได้', (await text(p, '#srState')).trim() === '' && await visible(p, '#srOpen'));
    await p.close();
    p = await open('citizen2', '#/me');
    check('ประชาชนที่ยังไม่กรอกเบอร์: ช่องแชทปิดไว้', await p.$eval('#meInput', (e) => e.disabled));
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(200);
    check('ข้อมูลส่วนตัว (มือถือ): ปุ่มรูปคน ≥ 44px บนเมนู + ไม่ล้นจอ', await visible(p, '#profileBtn') && await p.$eval('#profileBtn', (e) => e.getBoundingClientRect().height >= 44) && await overflow(p) <= 0);
    check('ประชาชน: ชื่อบนแถบเมนู = ลิงก์ไปหน้าเมนูของประชาชน (#/me) · หัวหน้ามีรูปวงกลมหน้าชื่อ', (await p.getAttribute('#profileBtn', 'href')) === '#/me' && await visible(p, '#meAvatar') && !(await p.$eval('#meHello', (e) => e.disabled)));
    await p.click('#meHello'); await p.waitForTimeout(300);
    check('ประชาชน: กดชื่อที่หัวหน้า → หน้าต่างแก้ข้อมูลส่วนตัว', await p.$eval('#pdDialog', (d) => d.open));
    await p.fill('#pdPhone', '0899999999'); await p.selectOption('#pdUnit', '3');
    await p.screenshot({ path: path.join(SHOTS, 'profile-dialog-390.png') });
    await p.click('#pdSave'); await p.waitForTimeout(400);
    check('ข้อมูลส่วนตัว (ประชาชน): เลือก รพ.สต. ใกล้บ้านได้ + ฟอร์มในหน้า "ของฉัน" อัปเดต + แชทเปิดใช้ได้', (await calls(p, (c) => c.table === 'profiles' && c.op === 'update')).pop()?.payload?.home_unit_id === 3
      && (await p.inputValue('#mePhone')) === '0899999999' && !(await p.$eval('#meInput', (e) => e.disabled)));
    await p.close();

    /* ================= แชทแบบไม่ต้องล็อกอิน ================= */
    p = await open(null, '', 390, 844);
    check('หน้าแรก: ปุ่มแชทสอบถามเรื่องยา = ปุ่มกลมด้านบนข้างปุ่มโหมดมืด/สว่าง (ไม่ต้องล็อกอิน)', (await p.getAttribute('#homeChatLink', 'href')) === '#/me' && await p.$eval('#homeChatLink', (a) => a.closest('header') && a.nextElementSibling?.id === 'themeBtn' && getComputedStyle(a).borderRadius !== '0px' && a.getBoundingClientRect().width >= 44 && a.getBoundingClientRect().right <= innerWidth));
    { const q = await open('admin', '#/'); await q.waitForTimeout(400);
      check('หน้าแรก (ผู้ดูแล): ปุ่มแชทสอบถามเรื่องยา → หน้าข้อความของผู้ดูแล', (await q.getAttribute('#homeChatLink', 'href')) === '#/admin/messages');
      await q.click('#homeChatLink'); await q.waitForTimeout(500);
      check('หน้าแรก (ผู้ดูแล): กดแล้วเปิดกล่องข้อความ', (await q.evaluate(() => location.hash)) === '#/admin/messages' && await visible(q, '[data-admin-view="messages"]'));
      await q.close(); }
    { const q = await open('staff', '#/'); await q.waitForTimeout(400);
      check('หน้าแรก (เจ้าหน้าที่): ปุ่มแชทสอบถามเรื่องยา → หน้าข้อความของเจ้าหน้าที่', (await q.getAttribute('#homeChatLink', 'href')) === '#/staff/messages');
      await q.close(); }
    await go(p, '#/me'); await p.waitForTimeout(400);
    check('แชทไม่ล็อกอิน: เปิดได้ + ช่องชื่อเล่น + ซ่อนข้อมูลส่วนตัว/ปุ่มแนบรูป', await visible(p, '#meGuest') && await visible(p, '#meGuestName') && !(await visible(p, '#meForm')) && !(await visible(p, '#meAttach')) && !(await visible(p, '#srPanel')) && await overflow(p) <= 0);
    await p.fill('#meInput', 'สวัสดีค่ะ'); await p.click('#meSend'); await p.waitForTimeout(200);
    check('แชทไม่ล็อกอิน: ต้องเลือก รพ.สต. ก่อน (ไม่มีห้องยา รพ.)', (await text(p, '#meChatHint')).includes('เลือก รพ.สต.') && !(await p.$('#meUnitPick option[value="h"]')) && (await calls(p, (c) => c.rpc === 'guest_chat_send')).length === 0);
    await p.selectOption('#meUnitPick', '2'); await p.waitForTimeout(300);
    await p.click('#meSend'); await p.waitForTimeout(200);
    check('แชทไม่ล็อกอิน: ต้องใส่ชื่อเล่นก่อน', (await text(p, '#meChatHint')).includes('ชื่อเล่น') && (await calls(p, (c) => c.rpc === 'guest_chat_send')).length === 0);
    await p.fill('#meGuestName', 'ลุงมา'); await p.fill('#meInput', 'ยาความดันกินก่อนหรือหลังอาหารครับ'); await p.waitForTimeout(100);
    check('แชทไม่ล็อกอิน: พิมพ์เกิน 15 ตัวอักษร → เตือนให้เข้าสู่ระบบ', (await text(p, '#meChatHint')).includes('เข้าสู่ระบบ') && await count(p, '#meChatHint a[href="#/login"]') === 1);
    await p.click('#meSend'); await p.waitForTimeout(200);
    check('แชทไม่ล็อกอิน: ข้อความยาวไม่ถูกส่ง', (await calls(p, (c) => c.rpc === 'guest_chat_send')).length === 0);
    await p.fill('#meInput', 'ยากินตอนไหน'); await p.click('#meSend'); await p.waitForTimeout(400);
    const gs = (await calls(p, (c) => c.rpc === 'guest_chat_send'))[0]?.args || {};
    check('แชทไม่ล็อกอิน: ส่งข้อความสั้นได้ (ชื่อเล่น + รหัสเครื่อง) + ขึ้นในห้อง', gs.p_name === 'ลุงมา' && /^[0-9a-f-]{36}$/.test(gs.p_token || '') && (await text(p, '#meLog')).includes('ยากินตอนไหน') && (await p.evaluate(() => localStorage.getItem('pcps_guest_name'))) === 'ลุงมา', JSON.stringify(gs));
    await p.evaluate(() => { const c = window.__db.conversations.find((x) => x.guest_name === 'ลุงมา'); window.__db.messages.push({ id: 99901, conversation_id: c.id, sender_role: 'staff', sender_name: 'เภสัชกร', body: 'หลังอาหารเช้าครับ', created_at: new Date().toISOString() }); c.unread_citizen = 1; });
    await go(p, '#/'); await go(p, '#/me'); await p.waitForTimeout(400);
    check('แชทไม่ล็อกอิน: กลับมาเครื่องเดิมเห็นห้องเดิม + คำตอบเจ้าหน้าที่', (await text(p, '#meLog')).includes('หลังอาหารเช้าครับ') && (await p.inputValue('#meGuestName')) === 'ลุงมา');
    await p.screenshot({ path: path.join(SHOTS, 'guest-chat-390.png'), fullPage: true });
    await p.evaluate(() => { const c = window.__db.conversations.find((x) => x.guest_name === 'ลุงมา'); for (let i = 0; i < 19; i++) window.__db.messages.push({ id: 99910 + i, conversation_id: c.id, sender_role: 'citizen', sender_name: 'ลุงมา', body: 'x', created_at: new Date().toISOString() }); });
    await p.fill('#meInput', 'อีกข้อครับ'); await p.click('#meSend'); await p.waitForTimeout(300);
    check('แชทไม่ล็อกอิน: ครบ 20 ข้อความต่อวัน → แจ้งให้เข้าสู่ระบบ', (await text(p, '#meChatHint')).includes('เข้าสู่ระบบ') && (await text(p, '#meChatHint')).includes('20'));
    await p.close();

    /* ================= เจ้าหน้าที่ รพ.สต. ================= */
    p = await open('staff', '#/staff');
    check('เมนูเจ้าหน้าที่: เรียง ข่าว › ข้อความ › เยี่ยมบ้าน › ผลงาน › มาตรฐาน › ข้อเสนอแนะ (เอกสาร = ปุ่มท้ายเว็บ · ไม่มี Health Rider)', (await p.$$eval('.sidenav [data-staff-tab]', (a) => a.map((x) => x.dataset.staffTab).join(','))) === 'news,messages,visits,achievements,criteria,feedback');
    check('เจ้าหน้าที่ล็อกอิน: ปุ่ม "ดาวน์โหลดเอกสาร" ท้ายเว็บยังแสดง (ช่องทางติดต่อซ่อน)', await visible(p, '[data-fc="docs"]') && !(await visible(p, '[data-fc="contact"]')));
    for (const tab of ['news', 'messages', 'visits', 'achievements', 'criteria', 'feedback']) {
      await go(p, '#/staff/' + tab); await p.waitForTimeout(250);
      const shown = await p.$eval(`[data-staff-view="${tab}"]`, (e) => !e.hidden && e.innerText.trim().length > 0).catch(() => false);
      check(`เจ้าหน้าที่: เมนู ${tab} เปิดได้`, shown && (await text(p, '#staffViewTitle')));
    }
    check('เจ้าหน้าที่: ชื่อบนแถบเมนู = ลิงก์ไประบบเจ้าหน้าที่ (ไม่เปิดหน้าต่างแก้ข้อมูล)', (await p.getAttribute('#profileBtn', 'href')) === '#/staff' && (await p.getAttribute('#profileBtn', 'aria-label')).includes('ระบบเจ้าหน้าที่'));
    check('เจ้าหน้าที่: รูปวงกลมหน้าชื่อ (ไม่มีรูป = ตัวอักษรย่อ) ด้านบนซ้าย', await visible(p, '#staffAvatar') && (await text(p, '#staffAvatar')).trim().length > 0
      && await p.evaluate(() => { const a = document.getElementById('staffAvatar').getBoundingClientRect(), h = document.getElementById('staffHello').getBoundingClientRect(); return a.right <= h.left + 1 && Math.round(a.width) === Math.round(a.height); }));
    await p.click('#staffAvatar'); await p.waitForTimeout(200);
    check('ข้อมูลส่วนตัว: กดรูปวงกลม → หน้าต่างแก้ไข (เจ้าหน้าที่: ไม่มีช่อง รพ.สต. ใกล้บ้าน)', await p.$eval('#pdDialog', (d) => d.open) && (await p.inputValue('#pdName')) === 'สมศรี ใจดี' && !(await visible(p, '#pdUnitField')) && (await p.getAttribute('#pdEmail', 'readonly')) !== null);
    await p.fill('#pdName', ''); await p.click('#pdSave'); await p.waitForTimeout(150);
    check('ข้อมูลส่วนตัว: ชื่อว่างถูกเตือน', (await text(p, '#pdMsg')).includes('ชื่อ') && await p.$eval('#pdDialog', (d) => d.open));
    await p.fill('#pdName', 'สมศรี ใจดีมาก'); await p.fill('#pdPhone', '081-222-3333'); await p.click('#pdSave'); await p.waitForTimeout(400);
    const pu = (await calls(p, (c) => c.table === 'profiles' && c.op === 'update')).pop()?.payload || {};
    check('ข้อมูลส่วนตัว: บันทึกเฉพาะช่องที่แก้ได้ + ชื่อบนเมนู/คำทักทายเปลี่ยนตาม', pu.full_name === 'สมศรี ใจดีมาก' && pu.phone === '081-222-3333' && !('role' in pu) && !('unit_id' in pu) && !('home_unit_id' in pu)
      && !(await p.$eval('#pdDialog', (d) => d.open)) && (await text(p, '#profileBtn')).includes('ใจดีมาก') && (await text(p, '#staffHello')).includes('ใจดีมาก'), JSON.stringify(pu));
    await p.click('#staffHello'); await p.waitForTimeout(200);
    check('ข้อมูลส่วนตัว: กดชื่อที่หัวหน้า → หน้าต่างแก้ไขเหมือนกัน', await p.$eval('#pdDialog', (d) => d.open) && !(await visible(p, '#pdPhotoDel')));
    await p.setInputFiles('#pdPhoto', { name: 'me.png', mimeType: 'image/png', buffer: PNG }); await p.waitForTimeout(800);
    { const up = (await calls(p, (c) => c.table === 'profiles' && c.op === 'update')).pop()?.payload || {};
      check('รูปประจำตัว: อัปโหลดไปโฟลเดอร์ของตัวเอง + บันทึก avatar_path + รูปขึ้นที่หัวหน้า/แถบเมนู/หน้าต่าง', /^avatars\/[^/]+\/.+\.webp$/.test(up.avatar_path || '') && (await calls(p, (c) => c.upload === 'public-images' && /^avatars\//.test(c.path || ''))).length === 1
        && await count(p, '#staffAvatar img') === 1 && await count(p, '#profileBtn img') === 1 && await count(p, '#pdDialog .pd-av img') === 1 && await visible(p, '#pdPhotoDel'), JSON.stringify(up)); }
    await p.click('#pdPhotoDel'); await p.waitForTimeout(400);
    check('รูปประจำตัว: ลบรูปได้ (กลับเป็นตัวอักษรย่อ)', (await calls(p, (c) => c.table === 'profiles' && c.op === 'update')).pop()?.payload?.avatar_path === null && await count(p, '#staffAvatar img') === 0);
    await p.click('#pdClose');
    await go(p, '#/staff/news');
    await p.click('#snSubmit'); await p.waitForTimeout(100);
    check('เจ้าหน้าที่: ส่งข่าวว่างถูกเตือน', (await text(p, '#snMsg')).length > 0);
    await p.fill('#snTitle', 'ข่าวทดสอบจาก รพ.สต.'); await p.fill('#snBody', 'เนื้อหา'); await p.click('#snSubmit'); await p.waitForTimeout(400);
    check('เจ้าหน้าที่: ส่งข่าวเข้าคิวตรวจ', (await calls(p, (c) => c.table === 'news' && c.op === 'insert')).length === 1);
    await go(p, '#/staff/visits');
    check('เจ้าหน้าที่: เห็นเฉพาะผู้ป่วยของหน่วยตัวเอง', await count(p, '#ptList [data-pt]') === 1);
    check('เยี่ยมบ้าน: รายชื่อผู้ป่วยอยู่บน บันทึกการเยี่ยมอยู่ล่าง (ไม่ซ้อนซ้ายขวา)', await p.evaluate(() => document.querySelector('#ptPanel').getBoundingClientRect().top > document.querySelector('#ptList').getBoundingClientRect().bottom));
    await p.click('#ptList [data-pt]'); await p.waitForTimeout(300);
    const logs = await calls(p, (c) => c.rpc === 'log_patient_access');
    await p.click('#ptList [data-pt]'); await p.waitForTimeout(200);
    await p.click('#ptListFold > summary'); await p.waitForTimeout(100);
    check('เยี่ยมบ้าน: รายชื่อผู้ป่วยย่อได้ (ปุ่มเพิ่มผู้ป่วยยังอยู่)', !(await p.isVisible('#ptList')) && !(await p.isVisible('#ptSearch')) && await visible(p, '#ptAddBtn') && (await p.textContent('#ptListFold > summary')).includes('ผู้ป่วยในความดูแล'));
    await (await p.$('.pt-listpanel')).screenshot({ path: path.join(SHOTS, 'staff-visits-list-folded.png') });
    await p.click('#ptListFold > summary'); await p.waitForTimeout(100);
    check('เยี่ยมบ้าน: กดอีกครั้งรายชื่อกลับมา', await p.isVisible('#ptList'));
    check('เยี่ยมบ้าน: กดชื่อผู้ป่วยซ้ำ = ย่อข้อมูลผู้ป่วยลง', (await text(p, '#ptPanel')).includes('เลือกผู้ป่วย') && (await p.getAttribute('#ptList [data-pt]', 'aria-expanded')) === 'false');
    await p.click('#ptList [data-pt]'); await p.waitForTimeout(300);
    check('เจ้าหน้าที่: เปิดรายชื่อ + เปิดดูผู้ป่วย ถูกบันทึก (PDPA)', logs.some((c) => c.args.p_unit === 2 && !c.args.p_patient) && logs.some((c) => c.args.p_patient));
    check('เจ้าหน้าที่: มีข้อความแจ้งว่าการเข้าถึงถูกบันทึก', (await text(p, '.pdpa-note')).includes('PDPA'));
    check('เยี่ยมบ้าน: แยกช่อง "รายชื่อผู้ป่วยเยี่ยมบ้าน" กับ "One page summary" (หน้ารายชื่อไม่มีฟอร์มสรุป)', (await p.getAttribute('#vtStaffSwitch [data-vt="list"]', 'aria-current')) === 'page' && !(await p.isVisible('#staffSumSlot')) && !(await p.isVisible('#vsFold')));
    await p.click('#vtStaffSwitch [data-vt="summary"]'); await p.waitForTimeout(500);
    check('เยี่ยมบ้าน › One page summary: ฟอร์ม + รายการสรุปอยู่ในช่องนี้ (ไม่มีรายชื่อผู้ป่วย)', (await p.getAttribute('#vtStaffSwitch [data-vt="summary"]', 'aria-current')) === 'page' && !(await p.isVisible('#ptList')) && await p.evaluate(() => location.hash === '#/staff/visits/summary'));
    await p.waitForSelector('#vsFold', { state: 'attached' });
    check('สรุปผลงาน: ฟอร์มย่อไว้เป็นค่าเริ่มต้น (เห็นแค่หัวข้อ)', !(await p.$eval('#vsFold', (d) => d.open)) && !(await p.isVisible('#vsForm')) && await p.isVisible('#vsFormTitle'));
    await p.click('#vsFold > summary'); await p.waitForTimeout(150);
    check('สรุปผลงาน: กล่องแนบรายชื่อเยี่ยมบ้าน อยู่บนกล่องแนบรายชื่อเจ้าหน้าที่ (ติ๊กเปิด/ปิด · เจ้าหน้าที่ติ๊กไว้ก่อน)', await p.evaluate(() => document.querySelector('#vsVisitOn').getBoundingClientRect().top < document.querySelector('#vsPeopleOn').getBoundingClientRect().top) && !(await p.isChecked('#vsVisitOn')) && await p.isChecked('#vsPeopleOn') && !(await p.isVisible('#vsVisitBtn')) && await p.isVisible('#vsPeopleFold'));
    check('เยี่ยมบ้าน: มีฟอร์มสรุปผลงาน one page summary (ไม่มีช่อง PDF)', await visible(p, '#staffSumSlot #vsForm') && (await text(p, '#vsFormTitle')).includes('one page summary') && !(await p.$('#vsFile')) && (await text(p, '#vsList')).includes('ยังไม่มีสรุปผลงาน'));
    check('สรุปผลงาน: รายการสรุปอยู่อีกกล่อง แยกจากฟอร์ม (ย่อฟอร์มแล้วรายการไม่ย่อตาม)', await p.evaluate(() => document.querySelector('#vsList').closest('.panel') !== document.querySelector('#vsFold').closest('.panel')) && await visible(p, '#vsList'));
    check('สรุปผลงาน: ช่องเลือก รพ.สต. ขึ้นหน่วยของตัวเองอัตโนมัติ', (await p.inputValue('#vsUnit')) === '2' && await count(p, '#vsUnit option') === 7);
    await p.click('#vsSubmit'); await p.waitForTimeout(150);
    check('สรุปผลงาน: ไม่ใส่หัวข้อ/ภาพ ถูกเตือน', (await text(p, '#vsMsg')).length > 0);
    await p.fill('#vsTitle', 'สรุปเยี่ยมบ้าน ไตรมาส 1'); await p.setInputFiles('#vsImage', [{ name: 'sum.png', mimeType: 'image/png', buffer: PNG }, { name: 'sum2.png', mimeType: 'image/png', buffer: PNG }, { name: 'sum3.png', mimeType: 'image/png', buffer: PNG }]); await p.waitForTimeout(600);
    check('สรุปผลงาน: เลือกหลายภาพแล้วเห็นตัวอย่าง + ปุ่ม × ทุกภาพ', await count(p, '#vsImagePreview .img-item') === 3 && await count(p, '#vsImagePreview .img-x') === 3);
    await p.click('#vsImagePreview [data-rmimg="2"]'); await p.waitForTimeout(150);
    check('สรุปผลงาน: กด × ลบภาพออกได้', await count(p, '#vsImagePreview .img-item') === 2);
    await p.fill('#vsBody', 'เยี่ยม 20 ราย\nแก้ DRPs ได้ 8 ราย');
    const today = await p.inputValue('#vsDate');
    check('สรุปผลงาน: ช่องวันที่ (ค่าเริ่มต้น = วันนี้ · แสดงแบบไทย)', /^\d{4}-\d{2}-\d{2}$/.test(today) && /25\d\d/.test(await text(p, '#vsDateTh')));
    await p.fill('#vsDate', '2026-09-15'); await p.dispatchEvent('#vsDate', 'change');
    check('สรุปผลงาน: เลือกวันที่แล้วปีงบประมาณเปลี่ยนตาม (ก่อน 1 ต.ค. = ปีงบเดิม)', (await p.inputValue('#vsYear')) === '2569');
    await p.fill('#vsDate', today); await p.dispatchEvent('#vsDate', 'change');
    check('ผู้ร่วมลง: ย่อไว้ (เห็นสรุปจำนวนที่เลือก) กดแล้วขยาย', !(await p.$eval('#vsPeopleFold', (d) => d.open)) && (await text(p, '#vsPeopleN')).includes('1 คน'));
    await p.click('#vsPeopleFold > summary'); await p.waitForTimeout(150);
    await p.click('#vsPeopleTabs [data-pt="2"]'); await p.waitForTimeout(100);
    check('ผู้ร่วมลง: แท็บแยก รพ.สต. กดครั้งเดียวเห็นรายชื่อหน่วยนั้น', (await text(p, '#vsPeople')).includes('สมศรี') && !(await text(p, '#vsPeople')).includes('ภก.ผู้ดูแล') && await count(p, '#vsPeopleTabs [data-pt]') === 9);
    check('ผู้ร่วมลง: กล่องรายชื่อสูงพอเห็น ~5 ชื่อ แล้วเลื่อนดูต่อ', await p.$eval('#vsPeople', (e) => { const h = parseFloat(getComputedStyle(e).maxHeight); return h >= 250 && h <= 300; }));
    await p.click('#vsPeopleTabs [data-pt="all"]'); await p.waitForTimeout(100);
    const me = await p.evaluate(() => window.__db.profiles.find((x) => x.email === 's2@gmail.com').id), adm = await p.evaluate(() => window.__db.profiles.find((x) => x.role === 'admin').id);
    check('สรุปผลงาน: เลือกผู้ร่วมลงจากรายชื่อผู้ดูแล + เจ้าหน้าที่ (ตัวเองติ๊กไว้แล้ว · ไม่มีประชาชน)', (await text(p, '#vsPeople')).includes('ผู้ดูแล (โรงพยาบาล)') && await p.isChecked(`#vsPeople input[value="${me}"]`)
      && await p.evaluate(() => [...document.querySelectorAll('#vsPeople input')].every((i) => i.value.startsWith('n:') || ['staff', 'admin'].includes(window.__db.profiles.find((x) => x.id === i.value)?.role))));
    check('สรุปผลงาน: รายชื่อมีคนที่ผู้ดูแลเพิ่มแล้วแต่ยังไม่เคยเข้าสู่ระบบ + ใช้ชื่อในบัญชีเจ้าหน้าที่', (await text(p, '#vsPeople')).includes('พี่วิ ยังไม่เข้าระบบ') && (await text(p, '#vsPeople')).includes('(ยังไม่เคยเข้าสู่ระบบ)') && (await text(p, '#vsPeople')).includes('ภก.ผู้ดูแล ระบบ'));
    await p.check('#vsPeople input[value="n:พี่วิ ยังไม่เข้าระบบ (พยาบาลวิชาชีพ)"]');
    await p.check(`#vsPeople input[value="${adm}"]`);
    check('สรุปผลงาน: เลือกได้หลายคน + แสดงจำนวน', (await text(p, '#vsPeopleN')).includes('3 คน') && (await text(p, '#vsPeopleN')).includes('พี่วิ'));
    await p.fill('#vsPeopleQ', 'สมหญิง ทดสอบ'); await p.waitForTimeout(100);
    check('สรุปผลงาน: ค้นหาไม่พบชื่อ → บอกให้กรอกเป็นชื่อใหม่', (await text(p, '#vsPeople')).includes('ไม่พบ') && await count(p, '#vsPeople [data-new-person]') === 1);
    await p.click('#vsPeople [data-new-person]');
    check('สรุปผลงาน: กดแล้วเติมชื่อ/นามสกุลจากคำค้นให้', (await p.inputValue('#vsOFirst')) === 'สมหญิง' && (await p.inputValue('#vsOLast')) === 'ทดสอบ');
    await p.fill('#vsOPos', 'อสม.'); await p.click('#vsOAdd');
    await p.fill('#vsOFirst', 'ลบทิ้ง'); await p.press('#vsOFirst', 'Enter');
    await p.click('#vsOthers [data-rm-other="1"]'); await p.fill('#vsPeopleQ', ''); await p.waitForTimeout(100);
    check('สรุปผลงาน: กรอกชื่อ นามสกุล ตำแหน่ง เพิ่มเองได้ (ลบได้) + นับรวม', await count(p, '#vsOthers .li') === 1 && (await text(p, '#vsOthers')).includes('สมหญิง ทดสอบ (อสม.)') && (await text(p, '#vsPeopleN')).includes('4 คน'));
    { const q = await open('staff', '#/staff/visits/summary', 390, 844); await q.waitForTimeout(400);
      await q.click('#vsFold > summary'); await q.click('#vsPeopleFold > summary'); await q.waitForTimeout(150);
      await (await q.$('#vsPeopleFold')).screenshot({ path: path.join(SHOTS, 'summary-people-tabs-390.png') });
      await (await q.$('.vs-other')).screenshot({ path: path.join(SHOTS, 'summary-people-390.png') });
      check('สรุปผลงาน 390px: ช่องกรอกชื่อเองไม่ล้นจอ', await overflow(q) <= 0); await q.close(); }
    await p.check('#vsVisitOn'); await p.waitForTimeout(100);
    await p.click('#vsVisitBtn'); await p.waitForTimeout(300);
    check('เชื่อมโยงรายการเยี่ยม: กดแล้วค้นหาชื่อผู้ป่วยได้ (รายชื่อผู้ป่วยของหน่วย)', await visible(p, '#vsVisitPick') && (await text(p, '#vsVisitRes')).includes('ประยูร'));
    await p.fill('#vsVisitQ', 'ประยูร'); await p.click('#vsVisitRes [data-vpt]'); await p.waitForTimeout(300);
    check('เชื่อมโยงรายการเยี่ยม: เลือกชื่อแล้วเห็นวันที่เยี่ยมแต่ละครั้ง + บันทึกการเข้าถึง (PDPA)', (await text(p, '#vsVisitRes')).includes('เยี่ยมวันที่') && (await calls(p, (c) => c.rpc === 'log_patient_access' && c.args.p_patient)).length >= 1);
    await p.check('#vsVisitRes [data-vv]'); await p.waitForTimeout(100);
    check('สรุปผลงาน: นับผู้ลงเยี่ยมตามตำแหน่ง + ผู้ป่วยที่เยี่ยม (จากรายชื่อที่แนบ)', (await text(p, '#vsCounts')).includes('พยาบาลวิชาชีพ 2 ราย') && (await text(p, '#vsCounts')).includes('เภสัชกร 1 ราย') && (await text(p, '#vsCounts')).includes('อสม. 1 ราย') && (await text(p, '#vsCounts')).includes('เยี่ยมผู้ป่วย 1 ราย'), await text(p, '#vsCounts'));
    check('เชื่อมโยงรายการเยี่ยม: เลือกแล้วขึ้นในรายการ (ชื่อ · วันที่เยี่ยม) ลบได้', (await text(p, '#vsVisits')).includes('ประยูร') && (await text(p, '#vsVisits')).includes('เยี่ยมวันที่') && await count(p, '#vsVisits [data-rm-link]') === 1);
    const linkedVisit = await p.getAttribute('#vsVisitRes [data-vv]', 'data-vv');
    let achN0 = 0;
    check('สรุปผลงาน: ช่องบันทึกเป็นผลงานตามมาตรฐานข้อ (ติ๊กเปิด)', !(await p.isVisible('#vsCrit')));
    await p.check('#vsCritOn'); await p.waitForTimeout(400);
    check('สรุปผลงาน: ติ๊กกล่องมาตรฐาน → เลื่อนไปข้อ 4.5.1 ทันที (ไฮไลต์)', await p.evaluate(() => { const el = document.querySelector('#vsCrit .crit-opt.hl'), box = document.querySelector('#vsCrit'); if (!el) return false; const r = el.getBoundingClientRect(), b = box.getBoundingClientRect(); return el.textContent.includes('4.5.1') && r.top >= b.top - 1 && r.bottom <= b.bottom + 1 && box.scrollTop > 0; }));
    const critId = await p.getAttribute('#vsCrit input[type=checkbox]', 'value');
    await p.check(`#vsCrit input[value="${critId}"]`); await p.waitForTimeout(100);
    check('สรุปผลงาน: เลือกข้อมาตรฐานได้ + บอกข้อที่เลือก', (await text(p, '#vsCritN')).includes('เลือกแล้ว: ข้อ'));
    await p.click('#vsSubmit'); await p.waitForTimeout(800);
    { const a = (await calls(p, (c) => c.table === 'achievements' && c.op === 'insert')).pop()?.payload || {};
      const link = (await calls(p, (c) => c.table === 'visit_summaries' && c.op === 'update')).pop()?.payload || {};
      achN0 = (await calls(p, (c) => c.table === 'achievements' && c.op === 'insert')).length;
      check('สรุปผลงาน: บันทึกเป็นผลงานของ รพ.สต. นั้นในข้อที่เลือก (ภาพเดียวกัน) + จำผลงานไว้ในสรุป', a.unit_id === 2 && (a.item_ids || []).map(String).includes(critId) && String(a.image_path || '').startsWith('summaries/2/') && !!link.achievement_id, JSON.stringify(a) + JSON.stringify(link)); }
    check('เชื่อมโยงรายการเยี่ยม: บันทึกลิงก์กับสรุป + รายการบอกจำนวน', (await calls(p, (c) => c.table === 'summary_visits' && c.op === 'insert')).length === 1 && (await text(p, '#vsList')).includes('เชื่อมโยง 1 รายการเยี่ยม'));
    const vsIns = (await calls(p, (c) => c.table === 'visit_summaries' && c.op === 'insert'))[0]?.payload;
    check('สรุปผลงาน: บันทึกวันที่ + ผู้ร่วมลง 2 คน + รายการแสดงวันที่และชื่อ', vsIns?.summary_date === today && vsIns?.participant_ids?.length === 2 && vsIns.participant_ids.includes(adm) && vsIns.participant_others?.join('|') === 'พี่วิ ยังไม่เข้าระบบ (พยาบาลวิชาชีพ)|สมหญิง ทดสอบ (อสม.)' && (await text(p, '#vsList')).includes('วันที่ ') && (await text(p, '#vsList')).includes('ผู้ร่วมลง:'), JSON.stringify(vsIns));
    check('สรุปผลงาน: เผยแพร่ได้ (ภาพหลัก + ภาพเพิ่ม 1 · รูปอยู่ summaries/<หน่วย>/)', vsIns?.unit_id === 2 && vsIns?.image_path?.startsWith('summaries/2/') && vsIns?.gallery?.length === 1 && !('file_path' in vsIns) && await count(p, '#vsList .da-poster') === 1, JSON.stringify(vsIns));
    await p.click('#vsList [data-edit]'); await p.waitForTimeout(150);
    check('สรุปผลงาน: แก้ไขแล้วภาพเดิมขึ้นครบ', await count(p, '#vsImagePreview .img-item') === 2 && (await p.inputValue('#vsUnit')) === '2');
    await p.fill('#vsTitle', 'สรุปเยี่ยมบ้าน ไตรมาส 1 (แก้ไข)'); await p.click('#vsSubmit'); await p.waitForTimeout(400);
    check('สรุปผลงาน: แก้ไขแล้วแก้ผลงานเดิม (ไม่สร้างผลงานซ้ำ) + ข้อที่เลือกยังอยู่', (await calls(p, (c) => c.table === 'achievements' && c.op === 'insert')).length === achN0 && (await calls(p, (c) => c.table === 'achievements' && c.op === 'update')).some((c) => c.payload?.title === 'สรุปเยี่ยมบ้าน ไตรมาส 1 (แก้ไข)'));
    check('สรุปผลงาน: แก้ไขได้ (ไม่ต้องเลือกภาพใหม่) + ปุ่มกลับเป็น "เผยแพร่"', (await calls(p, (c) => c.table === 'visit_summaries' && c.op === 'update' && c.payload?.title)).length === 1 && (await text(p, '#vsList')).includes('(แก้ไข)') && (await p.textContent('#vsSubmit')).includes('เผยแพร่'));
    check('สรุปผลงาน: บันทึกแล้วฟอร์มย่อกลับ', !(await p.$eval('#vsFold', (d) => d.open)));
    await p.click('#vsFold > summary'); await p.waitForTimeout(150);
    await p.fill('#vsTitle', 'สรุปให้หน่วยอื่น'); await p.selectOption('#vsUnit', '3'); await p.setInputFiles('#vsImage', { name: 'o.png', mimeType: 'image/png', buffer: PNG }); await p.waitForTimeout(400);
    await p.click('#vsSubmit'); await p.waitForTimeout(500);
    { const o = (await calls(p, (c) => c.table === 'visit_summaries' && c.op === 'insert'))[1]?.payload || {};
      check('สรุปผลงาน: เลือก รพ.สต. อื่นได้ (รูปยังอยู่โฟลเดอร์หน่วยตัวเอง) + ยังเห็นในรายการของฉัน', o.unit_id === 3 && o.image_path?.startsWith('summaries/2/') && (await text(p, '#vsList')).includes('สรุปให้หน่วยอื่น'), JSON.stringify(o)); }
    await p.evaluate(() => { const r = window.__db.visit_summaries; const i = r.findIndex((x) => x.title === 'สรุปให้หน่วยอื่น'); if (i >= 0) r.splice(i, 1); });
    await go(p, '#/tracking'); await p.waitForTimeout(500);
    check('ผลการดำเนินงาน: แถวล่าง "ผลงานด้านเภสัชกรรมปฐมภูมิ" แสดงผลงานจากเมนูผลงานของเจ้าหน้าที่', (await text(p, '[data-panel="tracking"]')).includes('ผลงานด้านเภสัชกรรมปฐมภูมิ') && (await text(p, '#trkSums')).includes('ตู้เย็นเก็บยาได้มาตรฐาน') && await count(p, '#trkSums .ach-poster') >= 2);
    await p.click('#trkUnitTabs [data-u="3"]'); await p.waitForTimeout(400);
    check('ผลการดำเนินงาน: ผลงานกรองตาม รพ.สต. ที่เลือก', (await text(p, '#trkSums')).includes('FEFO') && !(await text(p, '#trkSums')).includes('ตู้เย็นเก็บยา'));
    await p.click('#trkUnitTabs [data-u="all"]'); await p.waitForTimeout(400);
    { const r = await p.$eval('#trackArt', (e) => { const b = e.getBoundingClientRect(); return { ratio: b.width / b.height, poster: e.classList.contains('sum-poster'), img: !!e.querySelector('.sp-slide.on img'), href: e.querySelector('.sp-slide')?.getAttribute('href') || '' }; });
      check('ผลการดำเนินงาน: กรอบโปสเตอร์ 10:7 แสดงภาพสรุปผลงานเยี่ยมบ้าน (กดไปหน้าอ่านได้)', r.poster && r.img && Math.abs(r.ratio - 10 / 7) < 0.05 && r.href.startsWith('#/summary/'), JSON.stringify(r)); }
    check('ผลการดำเนินงาน: โปสเตอร์สรุปผลงานแสดงวันที่', /25\d\d/.test(await text(p, '#trackArt .sp-slide.on .sp-date')));
    await p.screenshot({ path: path.join(SHOTS, 'tracking-poster-1280.png') });
    { const n0 = await text(p, '#trackArt .sp-count'), tot = n0.split('/')[1];
      await p.click('#trackArt .sp-next'); await p.waitForTimeout(150);
      const n1 = await text(p, '#trackArt .sp-count');
      await p.click('#trackArt .sp-prev'); await p.waitForTimeout(150);
      check('ผลการดำเนินงาน: โปสเตอร์สรุปผลงานกด ‹ › เลือกดูภาพได้เอง (ปุ่มสูง ≥ 44px)', n0 === `1/${tot}` && n1 === `2/${tot}` && (await text(p, '#trackArt .sp-count')) === `1/${tot}` && await p.$eval('#trackArt .sp-next', (b) => b.getBoundingClientRect().height >= 44), `${n0} ${n1}`); }
    await p.click('#trackArt .sp-slide.on'); await p.waitForTimeout(400);
    check('สรุปผลงาน: กดเข้าไปเป็นหน้าแบบข่าว (ภาพเต็ม + ภาพเพิ่ม + รายละเอียด)', await visible(p, '[data-view="summary"]') && (await text(p, '#smTitle')).includes('(แก้ไข)') && (await text(p, '#smTag')).includes('ทุ่งนุ้ย') && await count(p, '#smBody p') === 2 && await count(p, '#smCover .car-slide .cover') === 2);
    check('สรุปผลงาน: หลายภาพแสดงแบบเลื่อนซ้าย-ขวา (ปุ่ม ‹ › + ตัวนับ 1/2) ไม่เรียงยาวลงมา', (await text(p, '#smCover .car-n')) === '1/2' && await p.$eval('#smCover .car-track', (t) => t.scrollWidth > t.clientWidth && t.getBoundingClientRect().height < 1200) && await p.isDisabled('#smCover .prev'));
    check('สรุปผลงาน: ภาพหลักอยู่กลาง ภาพถัดไปโผล่ด้านขวาแบบจาง/เบลอ', await p.$eval('#smCover', (c) => { const [a, b] = c.querySelectorAll('.car-slide'), t = c.querySelector('.car-track').getBoundingClientRect(), r = b.getBoundingClientRect(); return a.classList.contains('on') && !b.classList.contains('on') && +getComputedStyle(b).opacity < 0.6 && getComputedStyle(b).filter.includes('blur') && r.left < t.right && r.right > t.right; }));
    await p.click('#smCover .next'); await p.waitForTimeout(700);
    check('สรุปผลงาน: กด › ไปภาพถัดไป (ตัวนับ 2/2 · ปุ่ม › หาย)', (await text(p, '#smCover .car-n')) === '2/2' && await p.$eval('#smCover .car-track', (t) => t.scrollLeft > 10) && await p.isDisabled('#smCover .next'));
    await p.click('#smCover .prev'); await p.waitForTimeout(700);
    check('สรุปผลงาน: กด ‹ กลับภาพแรก', (await text(p, '#smCover .car-n')) === '1/2');
    check('สรุปผลงาน: หน้าอ่านแสดงจำนวนผู้ลงเยี่ยมตามตำแหน่ง + เยี่ยมผู้ป่วย n ราย', (await text(p, '#smPeople')).includes('ลงเยี่ยม:') && (await text(p, '#smPeople')).includes('เภสัชกร 1 ราย') && (await text(p, '#smPeople')).includes('เยี่ยมผู้ป่วย 1 ราย'), await text(p, '#smPeople'));
    check('สรุปผลงาน: หน้าอ่านแสดงวันที่ + เจ้าหน้าที่ที่ร่วมลง', (await text(p, '#smDate')).startsWith('วันที่ ') && (await text(p, '#smPeople')).includes('เจ้าหน้าที่ที่ร่วมลง:') && await visible(p, '#smPeople'));
    check('สรุปผลงาน: เจ้าหน้าที่เห็น "รายการเยี่ยมที่เชื่อมโยง" (ชื่อเต็ม · วันที่เยี่ยม · กดดูได้)', await visible(p, '#smVisits') && (await text(p, '#smVisits')).includes('ประยูร ทดสอบ') && await count(p, `#smVisits [data-sv-open="${linkedVisit}"]`) === 1);
    await p.screenshot({ path: path.join(SHOTS, 'summary-1280.png'), fullPage: true });
    { const q = await open(null, `#/summary/${await p.evaluate(() => location.hash.split('/')[2])}`); await q.waitForTimeout(600);
      check('สรุปผลงาน: ประชาชน/ไม่ล็อกอินไม่เห็นรายการเยี่ยม (PDPA)', !(await visible(q, '#smVisits')) && !(await text(q, '[data-view="summary"]')).includes('ประยูร')); await q.close(); }
    { const q = await open('staff3', '#/'); await q.waitForTimeout(300);   // เจ้าหน้าที่ต่าง รพ.สต. ไม่ได้อยู่ในรายชื่อผู้ร่วมลง
      const sid = await q.evaluate(() => { const d = window.__db, v = d.visits.find((x) => x.unit_id === 2), s3 = d.profiles.find((x) => x.email === 's3@gmail.com');
        const s = { id: 9901, unit_id: 2, fiscal_year: 2570, title: 'สรุปทดสอบสิทธิ์', body: '', image_path: 'summaries/2/x.webp', gallery: [], summary_date: v.visit_date, participant_ids: [], participant_names: [], participant_others: [], created_at: new Date().toISOString() };
        d.visit_summaries.push(s); (d.summary_visits ||= []).push({ summary_id: 9901, visit_id: v.id }); window.__s3 = s3.id; return s.id; });
      await q.evaluate((h) => { location.hash = h; }, `#/summary/${sid}`); await q.waitForTimeout(700);
      check('สรุปผลงาน: เจ้าหน้าที่ รพ.สต. อื่นเห็นรายการแต่ชื่อจริง**** ไม่แสดงนามสกุล + กดดูไม่ได้', (await text(q, '#smVisits')).includes('ประยูร****') && !(await text(q, '#smVisits')).includes('ทดสอบ') && await count(q, '#smVisits [data-sv-open]') === 0 && (await text(q, '#smVisits')).includes('เฉพาะผู้ร่วมลง'));
      await q.evaluate(() => { window.__db.visit_summaries.find((x) => x.id === 9901).participant_ids.push(window.__s3); location.hash = '#/'; }); await q.waitForTimeout(300);
      await q.evaluate(() => { location.hash = '#/summary/9901'; }); await q.waitForTimeout(700);
      await q.click('#smVisits [data-sv-open]'); await q.waitForTimeout(400);
      check('สรุปผลงาน: ถูกแนบเป็นผู้ร่วมลงแล้ว → เห็นชื่อเต็ม + เปิดรายละเอียดได้ (ไม่มีลิงก์หน้าเยี่ยมบ้านของหน่วยอื่น)', (await text(q, '#svTitle')).includes('ประยูร ทดสอบ') && (await text(q, '#svBody')).includes('S') && await count(q, '#svBody [data-sv-go]') === 0);
      await q.close(); }
    await p.click('#smVisits [data-sv-open]'); await p.waitForTimeout(400);
    check('สรุปผลงาน: กดชื่อ → หน้าต่างรายละเอียดการเยี่ยม (S/O/A/P · DRPs) + ลิงก์ไปหน้าเยี่ยมบ้าน (หน่วยตัวเอง)', await p.$eval('#svDialog', (d) => d.open) && (await text(p, '#svBody')).includes('DRPs') && (await p.getAttribute('#svBody [data-sv-go]', 'href')) === `#/staff/visits/${linkedVisit}`);
    await p.screenshot({ path: path.join(SHOTS, 'summary-visit-dialog-1280.png') });
    await p.click('#svBody [data-sv-go]'); await p.waitForTimeout(900);
    check('สรุปผลงาน: กดลิงก์ → ไปหน้าเยี่ยมบ้าน เปิดผู้ป่วย + ไฮไลต์บันทึกการเยี่ยมนั้น', (await text(p, '#ptPanel')).includes('ประยูร') && await count(p, `#vt-${linkedVisit}.hl`) === 1);
    await go(p, '#/staff/visits/summary'); await p.waitForTimeout(400);
    await p.click('#vsList [data-del]'); await p.waitForTimeout(400);
    check('สรุปผลงาน: ลบได้', await count(p, '#vsList .da-poster') === 0);
    await go(p, '#/staff/docs'); await p.waitForTimeout(400);
    check('เจ้าหน้าที่: ลิงก์เมนูเอกสารเดิม → หน้าดาวน์โหลดเอกสาร · เห็นทุกหน่วย + หน่วยตัวเอง + ของประชาชน', (await p.evaluate(() => location.hash)) === '#/documents' && await count(p, '#sdList .li') === 3 && (await text(p, '#sdWho')).includes('เจ้าหน้าที่'), String(await count(p, '#sdList .li')));
    await p.click('#sdList [data-dl]'); await p.waitForTimeout(400);
    check('เอกสาร: ดาวน์โหลดแล้วนับจำนวน + แสดงจำนวนครั้ง', (await calls(p, (c) => c.rpc === 'bump_doc_download')).length === 1 && (await text(p, '#sdList')).includes('ดาวน์โหลด 1 ครั้ง'));
    await p.fill('#sdQ', 'ไม่มีเอกสารชื่อนี้'); await p.waitForTimeout(150);
    check('เอกสาร: ค้นหาชื่อ (ไม่พบ → แจ้ง)', (await text(p, '#sdList')).includes('ไม่พบเอกสาร'));
    await p.fill('#sdQ', ''); await p.selectOption('#sdSort', 'title_asc'); await p.waitForTimeout(150);
    const titles = await p.$$eval('#sdList .li b', (b) => b.map((x) => x.textContent));
    check('เอกสาร: เรียงตามชื่อได้', titles.join('|') === [...titles].sort((a, b) => a.localeCompare(b, 'th')).join('|') && titles.length === 3);
    await go(p, '#/staff/messages');
    await p.click('#staffInboxSlot [data-conv]'); await p.waitForTimeout(400);
    await p.fill('#staffInboxSlot .ib-input', 'ตอบกลับจากเจ้าหน้าที่'); await p.click('#staffInboxSlot .ib-form button'); await p.waitForTimeout(400);
    check('เจ้าหน้าที่: ตอบแชทประชาชนได้', (await calls(p, (c) => c.table === 'messages' && c.op === 'insert')).length === 1);
    const gConv = await p.evaluate(() => window.__db.conversations.find((c) => c.guest_name === 'ป้าแดง')?.id);
    const gRow = await text(p, `#staffInboxSlot [data-conv="${gConv}"]`);
    check('เจ้าหน้าที่: เห็นแชทผู้ไม่ได้ล็อกอิน (ชื่อเล่น + ป้าย)', gRow.includes('ป้าแดง') && gRow.includes('ผู้ไม่ได้ล็อกอิน'), gRow);
    await p.click(`#staffInboxSlot [data-conv="${gConv}"]`); await p.waitForTimeout(400);
    check('เจ้าหน้าที่: ห้องผู้ไม่ได้ล็อกอิน ตอบได้แต่ส่งรูปไม่ได้', (await text(p, '#staffInboxSlot .ib-head')).includes('ผู้ไม่ได้ล็อกอิน') && await p.$eval('#staffInboxSlot .ib-file', (e) => e.disabled) && !(await p.$eval('#staffInboxSlot .ib-input', (e) => e.disabled)));
    await go(p, '#/staff/messages/admin'); await p.waitForTimeout(400);
    check('เจ้าหน้าที่: แท็บ "คุยกับผู้ดูแล" เปิดห้องของหน่วยตัวเอง (ซ่อนกล่องประชาชน)', await visible(p, '#staffUnitChatSlot .uc-form') && !(await visible(p, '#staffInboxSlot')) && (await text(p, '#staffUnitChatSlot .uc-log')).includes('ยังไม่มีข้อความ'));
    await p.fill('#staffUnitChatSlot .uc-input', 'ขอยาพาราเพิ่ม 2 กล่องครับ'); await p.click('#staffUnitChatSlot .uc-send'); await p.waitForTimeout(400);
    const S2ID = await p.evaluate(() => window.__db.profiles.find((x) => x.email === 's2@gmail.com').id);
    check('เจ้าหน้าที่: ส่งข้อความถึงผู้ดูแลได้ (ห้องส่วนตัวของตัวเอง)', (await calls(p, (c) => c.table === 'unit_messages' && c.op === 'insert'))[0]?.payload?.unit_id === 2 && await count(p, '#staffUnitChatSlot .bubble.me') === 1);
    await p.evaluate(() => window.__emit('unit_messages', { id: 900, unit_id: 2, staff_id: window.__db.profiles.find((x) => x.email === 's2@gmail.com').id, sender_id: 'x', sender_role: 'admin', sender_name: 'ภก.ผู้ดูแล ระบบ', body: 'รับทราบครับ พรุ่งนี้ส่งให้', created_at: new Date().toISOString() }));
    await p.waitForTimeout(400);
    check('เจ้าหน้าที่: คำตอบผู้ดูแลเข้ามาแบบ real-time + ล้างตัวเลขยังไม่อ่าน', (await text(p, '#staffUnitChatSlot .uc-log')).includes('พรุ่งนี้ส่งให้') && (await text(p, '#staffUnitChatSlot .uc-log')).includes('(ผู้ดูแล)')
      && (await calls(p, (c) => c.rpc === 'mark_staff_thread_read')).filter((c) => c.args.p_staff === S2ID).length >= 2);
    await go(p, '#/staff/messages'); await p.waitForTimeout(300);
    check('เจ้าหน้าที่: กลับไปกล่องข้อความประชาชนได้ + ปิดห้องผู้ดูแล', await visible(p, '#staffInboxSlot') && (await calls(p, (c) => c.unsubscribe === 'unitchat-' + S2ID)).length >= 1);
    await p.close();

    /* ================= ผู้ดูแล ================= */
    p = await open('admin', '#/admin');
    for (const tab of ['news', 'messages', 'review', 'visits', 'rider', 'docs', 'settings/feedback', 'drugs/dose', 'drugs/db', 'rider/delivery', 'settings/contacts', 'settings/staff', 'settings/audit']) {
      await go(p, '#/admin/' + tab); await p.waitForTimeout(250);
      const view = tab.split('/')[0];
      const shown = await p.$eval(`[data-admin-view="${view}"]`, (e) => !e.hidden && e.innerText.trim().length > 0).catch(() => false);
      check(`ผู้ดูแล: เมนู ${tab} เปิดได้`, shown && (await text(p, '#adminViewTitle')));
    }
    {
      const cn = await p.evaluate(() => { const c = window.__db.news_comments.find((x) => window.__db.news.some((n) => n.id === x.news_id && n.status === 'published')); return c && c.news_id; });
      await go(p, '#/news/' + cn); await p.waitForTimeout(400);
      const n0 = await count(p, '#arComments [data-del-comment]');
      await p.click('#arComments [data-del-comment]'); await p.waitForTimeout(400);
      check('ผู้ดูแล: ลบความคิดเห็นไม่เหมาะสมในหน้าอ่านข่าวได้', n0 >= 1 && (await calls(p, (c) => c.table === 'news_comments' && c.op === 'delete')).length === 1 && await count(p, '#arComments [data-del-comment]') === n0 - 1);
    }
    await go(p, '#/admin/messages'); await p.waitForTimeout(400);
    check('ผู้ดูแล: แถบเมนูบนใช้คำว่า "ระบบผู้ดูแล"', (await text(p, '#topNav')).includes('ระบบผู้ดูแล') && !(await text(p, '#topNav')).includes('ผู้ดูแลระบบ'));
    check('ผู้ดูแล: เมนูข้อความมีแท็บ "คุยกับ รพ.สต." + ตัวเลขยังไม่อ่าน', (await text(p, '#ucAdminSwitch [data-uc="admin"] [data-uc-badge]')).trim() === '1');
    check('ผู้ดูแล: ข้อความจากประชาชนเลือกดูตาม รพ.สต. (เปิดหน่วยที่มีข้อความค้างก่อน) · ห้องยาเดิมเป็นแท็บท้าย', (await p.getAttribute('#amTargets [data-t="2"]', 'aria-current')) === 'true'
      && (await p.$$eval('#amTargets [data-t]', (b) => b.map((x) => x.dataset.t))).at(-1) === '' && await count(p, '#amTargets [data-t]') === 8);
    await p.click('#adminInboxSlot [data-conv="00000000-0000-0000-0000-0000000c0001"]'); await p.waitForTimeout(400);
    await p.fill('#adminInboxSlot .ib-input', 'ผู้ดูแลช่วยตอบครับ'); await p.click('#adminInboxSlot .ib-send'); await p.waitForTimeout(400);
    check('ผู้ดูแล: เข้าไปช่วยตอบในห้องของ รพ.สต. ได้ (ไม่ล้างตัวเลขของหน่วย)', (await calls(p, (c) => c.table === 'messages' && c.op === 'insert')).some((c) => c.payload.body === 'ผู้ดูแลช่วยตอบครับ') && !(await calls(p, (c) => c.rpc === 'mark_conversation_read')).length);
    await p.click('#amTargets [data-t=""]'); await p.waitForTimeout(400);
    await p.click('#adminInboxSlot [data-conv]'); await p.waitForTimeout(400);
    await p.click('#adminInboxSlot [data-trash]'); await p.waitForTimeout(400);
    check('แชท: ลบห้องสนทนาลงถังขยะได้ (ออกจากรายชื่อ + ถังขยะนับ 1)', (await calls(p, (c) => c.rpc === 'trash_conversation' && c.args.p_trash === true)).length === 1
      && await count(p, '#adminInboxSlot .ib-list [data-conv]') === 0 && (await text(p, '#adminInboxSlot .ib-trash-btn')).includes('(1)'));
    await p.click('#adminInboxSlot .ib-trash-btn'); await p.waitForTimeout(300);
    check('แชท: ถังขยะแสดงห้องที่ลบ + วันที่เหลือก่อนลบถาวร', (await text(p, '#adminInboxSlot .ib-list')).includes('ลบถาวรในอีก 30 วัน'));
    await p.click('#adminInboxSlot [data-conv]'); await p.waitForTimeout(400);
    check('แชท: ห้องในถังอ่านได้อย่างเดียว + มีปุ่มกู้คืน/ลบถาวร', await p.$eval('#adminInboxSlot .ib-input', (e) => e.disabled) && await visible(p, '#adminInboxSlot [data-restore]') && await visible(p, '#adminInboxSlot [data-purge]'));
    await p.click('#adminInboxSlot [data-restore]'); await p.waitForTimeout(400);
    await p.click('#adminInboxSlot .ib-trash-btn'); await p.waitForTimeout(300);
    check('แชท: กู้คืนแล้วกลับเข้ากล่องข้อความ', (await calls(p, (c) => c.rpc === 'trash_conversation' && c.args.p_trash === false)).length === 1 && await count(p, '#adminInboxSlot .ib-list [data-conv]') === 1);
    await p.evaluate(() => { const c = window.__db.conversations.find((x) => x.target_unit == null); c.trashed_at = new Date(Date.now() - 31 * 86400000).toISOString(); });
    { const q = await open('admin', '#/admin/achievements'); await q.waitForTimeout(600);
      check('ผู้ดูแล: เมนู "ผลงาน" แสดงผลงานทุก รพ.สต. (ไม่มีแถบเลือกหน่วยด้านบน) + ช่องเลือก รพ.สต. ในฟอร์ม', await visible(q, '[data-admin-tab="achievements"]') && !(await q.$('#aaUnits')) && await visible(q, '#adminAchSlot #saUnit')
        && (await text(q, '#saList')).includes('FEFO') && (await text(q, '#saList')).includes('ตู้เย็นเก็บยา') && (await text(q, '#saListTitle')).includes('ทุกแห่ง'));
      await q.fill('#saTitle', 'ผลงานที่ผู้ดูแลเพิ่ม'); await q.click('#saSubmit'); await q.waitForTimeout(300);
      check('ผู้ดูแล › ผลงาน: ต้องเลือก รพ.สต. ก่อนบันทึก', (await text(q, '#saMsg')).includes('เลือก รพ.สต.'));
      await q.selectOption('#saUnit', '3'); await q.setInputFiles('#saImage', { name: 'a.png', mimeType: 'image/png', buffer: PNG }); await q.click('#saSubmit'); await q.waitForTimeout(800);
      const ins = (await calls(q, (c) => c.table === 'achievements' && c.op === 'insert'))[0]?.payload || {};
      check('ผู้ดูแล › ผลงาน: เพิ่มผลงานให้ รพ.สต. ที่เลือก (รูปอยู่โฟลเดอร์หน่วยนั้น)', ins.unit_id === 3 && ins.image_path?.startsWith('achievements/3/') && (await text(q, '#saList')).includes('ผลงานที่ผู้ดูแลเพิ่ม'), JSON.stringify(ins));
      const aid = await q.evaluate(() => window.__db.achievements.find((a) => a.title === 'ผลงานที่ผู้ดูแลเพิ่ม').id);
      await q.click(`[data-edit="${aid}"]`); await q.waitForTimeout(200);
      check('ผู้ดูแล › ผลงาน: กดแก้ไขแล้วช่อง รพ.สต. ขึ้นหน่วยเดิม', (await q.inputValue('#saUnit')) === '3');
      await q.selectOption('#saUnit', '5'); await q.click('#saSubmit'); await q.waitForTimeout(700);
      const up = (await calls(q, (c) => c.table === 'achievements' && c.op === 'update')).pop()?.payload || {};
      check('ผู้ดูแล › ผลงาน: เปลี่ยน รพ.สต. ที่ทำผลงานภายหลังได้', up.unit_id === 5 && await q.evaluate((id) => window.__db.achievements.find((a) => a.id === id).unit_id === 5, aid), JSON.stringify(up));
      await q.setViewportSize({ width: 390, height: 844 }); await q.waitForTimeout(200);
      check('ผู้ดูแล › ผลงาน 390px: ไม่ล้นจอ', await overflow(q) <= 0);
      await q.screenshot({ path: path.join(SHOTS, 'admin-ach-390.png') });
      await q.close(); }
    await go(p, '#/admin/news'); await go(p, '#/admin/messages'); await p.waitForTimeout(500);
    check('แชท: ห้องในถังเกิน 30 วัน ผู้ดูแลเปิดหน้าแล้วลบถาวรให้เอง', (await calls(p, (c) => c.table === 'conversations' && c.op === 'delete')).length === 1 && !(await p.evaluate(() => window.__db.conversations.some((x) => x.target_unit == null))));
    await go(p, '#/admin/messages/units'); await p.waitForTimeout(400);
    const S3ID = await p.evaluate(() => window.__db.profiles.find((x) => x.email === 's3@gmail.com').id);
    check('ผู้ดูแล: แถบเลือก รพ.สต. ครบ 7 ด้านบน · เปิดหน่วยที่มีข้อความค้างก่อน (ตัวเลข)', await count(p, '#adminUnitChatSlot .uc-units [data-unit]') === 7 && (await p.getAttribute('#adminUnitChatSlot .uc-units [data-unit="3"]', 'aria-current')) === 'true'
      && (await text(p, '#adminUnitChatSlot .uc-units [data-unit="3"]')).includes('1') && !(await visible(p, '#amCitizen')));
    check('ผู้ดูแล: ซ้ายเป็นรายชื่อเจ้าหน้าที่ของ รพ.สต. นั้น (แยกรายคน)', await count(p, '#adminUnitChatSlot .uc-list [data-staff]') === 1 && (await text(p, '#adminUnitChatSlot .uc-list')).includes('วิชัย ขยัน'));
    await p.click('#adminUnitChatSlot .uc-units [data-unit="2"]'); await p.waitForTimeout(300);
    check('ผู้ดูแล: เปลี่ยน รพ.สต. → รายชื่อเจ้าหน้าที่หน่วยนั้น', (await text(p, '#adminUnitChatSlot .uc-list')).includes('สมศรี ใจดี') && !(await text(p, '#adminUnitChatSlot .uc-list')).includes('วิชัย'));
    await p.click('#adminUnitChatSlot .uc-units [data-unit="3"]'); await p.waitForTimeout(300);
    await p.click(`#adminUnitChatSlot [data-staff="${S3ID}"]`); await p.waitForTimeout(400);
    check('ผู้ดูแล: เปิดห้องเจ้าหน้าที่ เห็นข้อความ + ล้างตัวเลขฝั่งผู้ดูแล', (await text(p, '#adminUnitChatSlot .uc-log')).includes('แบบฟอร์มรายงานยาเหลือใช้') && (await text(p, '#adminUnitChatSlot .uc-head')).includes('วิชัย ขยัน') && (await calls(p, (c) => c.rpc === 'mark_staff_thread_read' && c.args.p_staff === S3ID)).length >= 1);
    await p.fill('#adminUnitChatSlot .uc-input', 'อัปโหลดไว้ในเมนูเอกสารแล้วครับ'); await p.click('#adminUnitChatSlot .uc-send'); await p.waitForTimeout(400);
    check('ผู้ดูแล: ตอบเจ้าหน้าที่รายคนได้', (await calls(p, (c) => c.table === 'unit_messages' && c.op === 'insert'))[0]?.payload?.staff_id === S3ID && await count(p, '#adminUnitChatSlot .bubble.me') === 1);
    await p.screenshot({ path: path.join(SHOTS, 'admin-unitchat-1280.png'), fullPage: true });
    {
      await go(p, '#/admin/news'); await p.waitForTimeout(500);
      const AI = '00000000-0000-0000-0000-0000000a1001';
      const hist0 = await p.evaluate(() => ({ open: document.querySelector('#aiHist').open, n: document.querySelector('#aiLogCount').textContent }));
      await (await p.$('.ai-panel')).screenshot({ path: path.join(SHOTS, 'admin-ai-panel.png') });
      check('ช่อง AI: ประวัติย่อไว้เป็นค่าเริ่มต้น (บอกจำนวนครั้ง) กดเปิดได้', !hist0.open && hist0.n.includes('2'), JSON.stringify(hist0));
      check('ข่าว (ผู้ดูแล): ข่าวรอตรวจรวมอยู่ในกล่อง AI ด้านบน + ช่อง AI ย่อไว้ (กดเปิดได้)', await p.$eval('#anQueue', (q) => !!q.closest('.ai-panel')) && !(await p.$eval('#aiFold', (d) => d.open)) && !(await p.isVisible('#aiNow')) && await visible(p, '#anQueue')
        && await p.$eval('[data-admin-view="news"]', (v) => [...v.children].findIndex((c) => c.querySelector('#anQueue')) < [...v.children].findIndex((c) => c.querySelector('#anForm'))));
      await p.click('#aiFold > summary'); await p.waitForTimeout(150);
      await p.click('#aiHist summary'); await p.waitForTimeout(150);
      check('ช่อง AI: เปิดแล้วเห็นสถานะล่าสุด + ประวัติ (สำเร็จ/ไม่สำเร็จพร้อมสาเหตุ)', await visible(p, '#aiLog') && (await text(p, '#aiStatus')).includes('สร้างข่าวแล้ว') && await count(p, '#aiLog .li') === 2 && (await text(p, '#aiLog')).includes('quota') && (await text(p, '#aiLog')).includes('รอตรวจ'));
      await p.click('#aiAuto'); await p.waitForTimeout(300);
      check('ช่อง AI: เปิด "เผยแพร่ทันที" ได้ (ถามยืนยันก่อน)', (await calls(p, (c) => c.table === 'site_texts' && c.op === 'upsert'))[0]?.payload?.key === 'ai_news_auto' && (await calls(p, (c) => c.table === 'site_texts' && c.op === 'upsert'))[0]?.payload?.body === 'on');
      await p.click('#aiAuto'); await p.waitForTimeout(300);
      await p.click('#aiNow'); await p.waitForTimeout(500);
      check('ช่อง AI: กด "สร้างข่าวตอนนี้" → ส่งคำสั่ง + แจ้งว่าจะได้ภายใน 1 ชั่วโมง', (await calls(p, (c) => c.table === 'site_texts' && c.op === 'upsert')).some((c) => c.payload.key === 'ai_news_request') && (await text(p, '#aiStatus')).includes('ภายใน 1 ชั่วโมง'));
      check('ช่อง AI: ข่าวจาก AI เข้าคิวรอตรวจพร้อมป้าย AI', (await text(p, '#anQueue')).includes('ช่อง AI') && await count(p, '#anQueue .chip') >= 1);
      await p.click(`#anQueue [data-review="${AI}"]`); await p.waitForTimeout(500);
      check('ช่อง AI: กด "ตรวจ" → ข่าวขึ้นในกล่องตรวจ/แก้ไขกล่องเดียว (หัวข้อ เนื้อหา ภาพ 3 ภาพ) + อ้างอิงบทความ + ลิงก์ PDF ต้นฉบับ + เตือนให้ตรวจตัวเลข', (await p.inputValue('#aqTitle')).includes('สแตติน') && (await p.inputValue('#aqBody')).length > 20
        && (await p.getAttribute('#aqInfo p.small a[href*="ccpe"]', 'href') || '').includes('id=1876') && (await p.getAttribute('#aqInfo .file-link', 'href') || '').endsWith('showfile.php?file=1876')
        && (await text(p, '#aqInfo')).includes('ตรวจตัวเลข') && !(await p.$('#anReview [data-decide="fix"]')) && !(await p.$('#anReview [data-decide="edit"]')));
      check('กล่องตรวจ: มีปุ่ม อนุมัติ · บันทึก · ไม่ใช้ข่าวนี้ · ปิด อยู่ในกล่อง AI', await visible(p, '#anReview [data-decide="published"]') && await visible(p, '#anReview [data-decide="save"]') && await visible(p, '#anReview [data-decide="rejected"]') && await visible(p, '#anReview [data-decide="close"]') && await p.$eval('#anReview', (r) => !!r.closest('.ai-panel')));
      check('กล่องตรวจข่าว AI: มี "แบบทดสอบสำหรับผู้อ่าน" (ย่อไว้) + โหลดคำถามที่บันทึกไว้ (กล่องข้อความ + ฉบับที่จะเผยแพร่ ติ๊ก ✓ ข้อที่ถูก)', await visible(p, '#aqTools') && !(await p.$eval('#aqQuizFold', (d) => d.open))
        && (await p.textContent('#aqQuizN')).includes('1/1') && await count(p, '#aqQuiz .aq-q') === 1 && (await p.inputValue('#aqQ0')).includes('ช่วยให้แผลหายเร็วขึ้น (ถูก)')
        && await count(p, '#aqQuiz [data-i="0"][data-f="opt"]') === 4 && await p.isChecked('#aqQuiz [data-i="0"][data-f="ok"][data-k="0"]'));
      check('กล่องตรวจข่าว AI: บอกว่ามีข้อความจาก PDF ในระบบแล้ว (AI ตรวจได้เร็ว)', (await text(p, '#aqSrc')).includes('12 หน้า'));
      check('กล่องตรวจข่าว AI: เอาส่วน "ตรวจกับความเข้าใจของฉัน" ออกแล้ว', !(await p.$('#aqCheckFold')) && !(await p.$('#aqNotes')));
      await p.click('#aqQuizFold > summary'); await p.click('#aqQuizAdd'); await p.waitForTimeout(100);
      await p.fill('#aqQ1', 'ควรบดยาเม็ดมาทาแผลเองไหม\nก. บดได้ไม่ผิด (ถูก)');
      check('แบบทดสอบ: 1 กล่องข้อความ = 1 ข้อ → ขึ้นฉบับที่จะเผยแพร่ (คำถาม + ตัวเลือก + ติ๊ก ✓ ข้อที่ถูก)', (await p.inputValue('#aqQuiz [data-i="1"][data-f="q"]')) === 'ควรบดยาเม็ดมาทาแผลเองไหม'
        && (await p.inputValue('#aqQuiz [data-i="1"][data-f="opt"][data-k="0"]')) === 'บดได้ไม่ผิด' && await p.isChecked('#aqQuiz [data-i="1"][data-f="ok"][data-k="0"]'));
      await p.click('#aqQuizAdd'); await p.fill('#aqQ2', 'คำถามที่ยังไม่เสร็จ'); await p.waitForTimeout(100);
      check('แบบทดสอบ: กล่องที่ยังไม่มีตัวเลือก → บอกว่าขาดอะไร', (await text(p, '#aqQuiz .aq-q:nth-child(3) .aq-ai')).includes('ยังไม่มีตัวเลือก'));
      await p.click('#anReview [data-decide="save"]'); await p.waitForTimeout(300);
      check('แบบทดสอบ: ข้อที่ยังไม่ครบ → บันทึกไม่ได้ + บอกข้อที่ต้องแก้', (await text(p, '#anDecideMsg')).includes('ข้อ 2') && !(await calls(p, (c) => c.table === 'news_quiz' && c.op === 'insert')).length);
      await p.fill('#aqQ2', '1. แผลแบบใดที่บทความศึกษา\nก. แผลเบาหวาน (ถูก)\nข. แผลไฟไหม้\nค. แผลผ่าตัด\n\n2. ควรทายาวันละกี่ครั้ง\nก) วันละครั้ง\nข) ตามแพทย์สั่ง (ถูก)');
      await p.dispatchEvent('#aqQ2', 'change'); await p.waitForTimeout(150);
      check('แบบทดสอบ: วางหลายข้อในกล่องเดียว → แยกเป็นกล่องละข้อให้เอง', await count(p, '#aqQuiz .aq-q') === 4 && (await p.inputValue('#aqQuiz [data-i="2"][data-f="opt"][data-k="0"]')) === 'แผลเบาหวาน'
        && (await p.inputValue('#aqQuiz [data-i="2"][data-f="opt"][data-k="2"]')) === 'แผลผ่าตัด' && (await p.inputValue('#aqQuiz [data-i="3"][data-f="q"]')) === 'ควรทายาวันละกี่ครั้ง' && await p.isChecked('#aqQuiz [data-i="3"][data-f="ok"][data-k="1"]'));
      await (await p.$('#aqQuizFold')).screenshot({ path: path.join(SHOTS, 'admin-news-quiz-boxes.png') });
      await p.click('#aqQuiz [data-rmq="3"]'); await p.click('#aqQuiz [data-rmq="2"]'); await p.waitForTimeout(100);
      await p.click('#aqQuizBtn'); await p.waitForTimeout(3600);
      { const qa = (await calls(p, (x) => x.rpc === 'ai_news_quiz_start'))[0]?.args || {};
        check('แบบทดสอบ: AI ตรวจเฉลยของผู้ดูแลกับ PDF + ลองตอบ → ข้อที่ไม่ตรงขึ้นเตือนพร้อมเหตุผล', qa.p_items?.length === 2 && qa.p_items[1].a === 'บดได้ไม่ผิด' && qa.p_items[0].w.length === 3
          && await count(p, '#aqQuiz .aq-ai .aq-ok') === 1 && await count(p, '#aqQuiz .aq-ai .aq-bad') === 1 && (await text(p, '#aqQuiz')).includes('AI ลองตอบจาก PDF') && (await text(p, '#aqQuiz .aq-q:nth-child(2) .aq-ai')).includes('เหตุผล:') && (await text(p, '#aqQuizOut')).includes('1 ข้อ'), JSON.stringify(qa)); }
      check('แบบทดสอบ: AI เรียบเรียงตัวเลือก/เฉลยที่ตรง PDF + เติมตัวเลือกให้ครบ ในฉบับที่จะเผยแพร่ (กล่องข้อความเดิมไม่เปลี่ยน · เฉลยที่ไม่ตรงไม่ถูกแก้)',
        (await p.inputValue('#aqQuiz [data-i="0"][data-f="opt"][data-k="0"]')) === 'ช่วยให้แผลหายเร็วขึ้น (เรียบเรียงแล้ว)' && (await p.inputValue('#aqQuiz [data-i="0"][data-f="opt"][data-k="1"]')) === 'ลดไขมันในเลือดได้ทันที (เรียบเรียง)'
        && (await p.inputValue('#aqQuiz [data-i="1"][data-f="opt"][data-k="0"]')) === 'บดได้ไม่ผิด' && (await p.inputValue('#aqQuiz [data-i="1"][data-f="opt"][data-k="1"]')) === 'ตัวเลือก ก' && (await p.inputValue('#aqQ1')).includes('บดได้ไม่ผิด (ถูก)'));
      await p.fill('#aqQuiz [data-i="1"][data-f="opt"][data-k="0"]', 'ไม่ควร ให้ใช้ยาตามแพทย์สั่ง');
      await p.check('#aqQuiz [data-i="1"][data-f="ok"][data-k="1"]'); await p.check('#aqQuiz [data-i="1"][data-f="ok"][data-k="0"]');
      check('แบบทดสอบ: แก้ในฉบับที่จะเผยแพร่ได้ + ติ๊ก ✓ เปลี่ยนข้อที่ถูกได้ (ผลตรวจ AI ยังอยู่)', await p.isChecked('#aqQuiz [data-i="1"][data-f="ok"][data-k="0"]') && !(await p.isChecked('#aqQuiz [data-i="1"][data-f="ok"][data-k="1"]')) && await count(p, '#aqQuiz .aq-ai .aq-bad') === 1);
      await (await p.$('#aqQuizFold')).screenshot({ path: path.join(SHOTS, 'admin-news-quiz.png') });
      check('แก้ข่าว: รูปทั้ง 3 รูปขึ้นในฟอร์ม (รูปหลักมีกรอบ) + ปุ่ม × ทุกรูป', await count(p, '#aqImagePreview .img-item') === 3 && await count(p, '#aqImagePreview .img-x') === 3
        && (await p.getAttribute('#aqImagePreview .img-item.main img', 'src')).includes('infographic') && await p.$eval('#aqImagePreview .img-x', (e) => e.getBoundingClientRect().height >= 44));
      await (await p.$('#aqImagePreview')).screenshot({ path: path.join(SHOTS, 'admin-news-images.png') });
      await p.click('#aqImagePreview [data-rmimg="1"]'); await p.waitForTimeout(150);
      check('แก้ข่าว: กด × ลบรูปที่ 2 ได้', await count(p, '#aqImagePreview .img-item') === 2 && !(await p.$('#aqImagePreview img[src*="comic"]')));
      await p.setInputFiles('#aqImage', [{ name: 'n1.png', mimeType: 'image/png', buffer: PNG }, { name: 'n2.png', mimeType: 'image/png', buffer: PNG }]); await p.waitForTimeout(600);
      check('แก้ข่าว: เลือกหลายรูปเพื่อเพิ่มได้ + แจ้งจำนวน', await count(p, '#aqImagePreview .img-item') === 4 && (await text(p, '#aqImageNote')).includes('4/7'));
      await p.click('#aqImagePreview [data-rmimg="3"]'); await p.waitForTimeout(150);
      await p.click('#aqImagePreview [data-mainimg="2"]'); await p.waitForTimeout(150);
      check('แก้ข่าว: ตั้งรูปใหม่เป็นรูปหลักได้', (await p.getAttribute('#aqImagePreview .img-item.main img', 'src')).startsWith('blob:'));
      await (await p.$('.ai-panel')).screenshot({ path: path.join(SHOTS, 'admin-news-review-box.png') });
      await p.fill('#aqBody', 'แก้โดยเภสัชกรแล้ว'); await p.click('#anReview [data-decide="save"]'); await p.waitForTimeout(600);
      const ue = (await calls(p, (c) => c.table === 'news' && c.op === 'update')).map((c) => c.payload).find((x) => x.body === 'แก้โดยเภสัชกรแล้ว') || {};
      check('แก้ข่าว: บันทึกรูปหลักใหม่ + ภาพเพิ่มตามลำดับ + ลบไฟล์รูปที่เอาออก', /^news\/.+\.webp$/.test(ue.image_path || '') && JSON.stringify(ue.gallery) === JSON.stringify(['ai/1876/infographic.jpg', 'ai/1876/clinical.jpg'])
        && (await calls(p, (c) => c.remove === 'public-images')).some((c) => c.paths.includes('ai/1876/comic.jpg') && !c.paths.includes('ai/1876/clinical.jpg')), JSON.stringify(ue));
      check('แบบทดสอบ: บันทึกพร้อมข่าว 2 ข้อ (คำถาม/คำตอบ/ตัวเลือกผิด/หน้า)', await p.evaluate((id) => { const q = window.__db.news_quiz.filter((x) => x.news_id === id).sort((a, b) => a.sort - b.sort); return q.length === 2 && q[1].answer === 'ไม่ควร ให้ใช้ยาตามแพทย์สั่ง' && q[1].choices.length === 3 && q[1].page === 3; }, AI));
      check('ช่อง AI: บันทึกแล้วยังรอตรวจ + กลับไปที่กล่องตรวจ', (await calls(p, (c) => c.table === 'news' && c.op === 'update')).some((c) => c.payload.body === 'แก้โดยเภสัชกรแล้ว' && !('status' in c.payload)) && await visible(p, '#anReview [data-decide="published"]'));
      await p.click('#anReview [data-decide="published"]'); await p.waitForTimeout(500);
      check('ช่อง AI: อนุมัติแล้วเผยแพร่', (await calls(p, (c) => c.table === 'news' && c.op === 'update')).some((c) => c.payload.status === 'published'));
      await go(p, '#/news/' + AI); await p.waitForTimeout(500);
      const arW = await p.evaluate(() => [document.querySelector('#arBody').getBoundingClientRect().width, document.querySelector('#arBody').parentElement.getBoundingClientRect().width]);
      check('หน้าอ่านข่าว: เนื้อข่าวเต็มความกว้างกรอบข่าว (ไม่เว้นว่างด้านขวา)', Math.abs(arW[0] - arW[1]) <= 2, JSON.stringify(arW));
      check('หน้าอ่านข่าว AI: ป้าย "สรุปโดย AI" + ภาพเพิ่ม 2 ภาพ + อ้างอิงบทความต้นฉบับ + ปุ่มดาวน์โหลด PDF ต้นฉบับ', await visible(p, '#arAi') && await count(p, '#arCover .car-slide .cover') === 3 && (await text(p, '#arCover .car-n')) === '1/3' && (await p.getAttribute('#arSource a', 'href')).includes('ccpe.pharmacycouncil.org') && await visible(p, '#arFile .file-link') && (await p.getAttribute('#arFile a', 'href')).endsWith('showfile.php?file=1876') && (await p.getAttribute('#arFile a', 'target')) === '_blank');
      await p.screenshot({ path: path.join(SHOTS, 'ai-news-article-1280.png'), fullPage: true });
      check('หน้าอ่านข่าว: แบบทดสอบท้ายข่าว 2 ข้อ (ตัวเลือก 4 ตัว)', await visible(p, '#arQuiz') && await count(p, '#arQuiz .rq') === 2 && await count(p, '#arQuiz .rq:first-of-type .rq-opt') === 4);
      await p.click('#arQuiz .rq[data-q="0"] .rq-opt:text-is("ช่วยให้แผลหายเร็วขึ้น (เรียบเรียงแล้ว)")'); await p.waitForTimeout(100);
      await p.click('#arQuiz .rq[data-q="1"] .rq-opt:text-is("ตัวเลือก ก")'); await p.waitForTimeout(100);
      check('หน้าอ่านข่าว: กดตอบแล้วรู้ผลทันที (ถูก/ผิด + เฉลย + คำอธิบาย + หน้า) + คะแนนรวม', (await text(p, '#arQuiz .rq[data-q="0"] .rq-res')).includes('ถูกต้อง') && (await text(p, '#arQuiz .rq[data-q="1"] .rq-res')).includes('ไม่ควร ให้ใช้ยาตามแพทย์สั่ง')
        && await count(p, '#arQuiz .rq-opt.right') === 2 && await count(p, '#arQuiz .rq-opt.wrong') === 1 && (await text(p, '#arQuiz .rq-score')).includes('1 จาก 2'));
      await (await p.$('#arQuiz')).screenshot({ path: path.join(SHOTS, 'news-reader-quiz.png') });
      await p.click('#arCover .next'); await p.waitForTimeout(700);
      check('หน้าอ่านข่าว: หลายภาพกด › เลื่อนไปภาพถัดไป + ปุ่มขยายภาพยังใช้ได้', (await text(p, '#arCover .car-n')) === '2/3');
      await p.click('#arCover .car-slide:nth-child(3)'); await p.waitForTimeout(700);
      check('หน้าอ่านข่าว: กดภาพข้าง ๆ = เลื่อนภาพนั้นมากลาง (ยังไม่เปิดภาพเต็มจอ)', (await text(p, '#arCover .car-n')) === '3/3' && !(await p.$eval('dialog.lightbox', (d) => d.open).catch(() => false)));
      await (await p.$('#arCover')).screenshot({ path: path.join(SHOTS, 'news-carousel-1280.png') });
      await p.setViewportSize({ width: 390, height: 844 }); await go(p, '#/'); await go(p, '#/news/' + AI); await p.waitForTimeout(700);
      await p.screenshot({ path: path.join(SHOTS, 'news-carousel-390.png') });
      check('หน้าอ่านข่าว 390px: กรอบเลื่อนภาพไม่ล้นจอ + ปุ่มสูง ≥ 44px', await overflow(p) <= 0 && await p.$eval('#arCover .next', (b) => b.getBoundingClientRect().height >= 44));
      await p.setViewportSize({ width: 1280, height: 900 });
      await go(p, '#/admin/news'); await p.waitForTimeout(300);
      await p.click(`#anList [data-quiz="${AI}"]`); await p.waitForTimeout(400);
      check('ข่าวที่เผยแพร่แล้ว (มี PDF ต้นฉบับ): ปุ่ม "แบบทดสอบ" → กล่องตรวจ (แบบทดสอบเปิดไว้ · โหลดข้อที่บันทึก · มีแค่ปุ่มบันทึก ไม่มีอนุมัติ/ความเห็นถึงผู้ส่ง)', await visible(p, '#anReview') && (await text(p, '#aqHead')).includes('เผยแพร่แล้ว')
        && await p.$eval('#aqQuizFold', (d) => d.open) && await count(p, '#aqQuiz .aq-q') === 2 && !(await p.$('#anReview [data-decide="published"]')) && !(await p.isVisible('#anComment')));
      check('ข่าวที่ไม่มี PDF ต้นฉบับ: ไม่มีปุ่มแบบทดสอบ', await count(p, '#anList [data-quiz]') === 1);
      await p.click('#aqQuizAdd'); await p.fill('#aqQ2', 'ข้อใหม่หลังเผยแพร่\nก. ถูกต้อง (ถูก)\nข. ไม่ถูก');
      await p.click('#anReview [data-decide="save"]'); await p.waitForTimeout(700);
      check('ข่าวที่เผยแพร่แล้ว: บันทึกแบบทดสอบเพิ่มได้ (3 ข้อ) + ข่าวยังเผยแพร่อยู่ + กล่องยังเปิดแก้ต่อได้', await p.evaluate((id) => window.__db.news_quiz.filter((x) => x.news_id === id).length === 3 && window.__db.news.find((n) => n.id === id).status === 'published', AI)
        && await visible(p, '#anReview') && (await text(p, '#aqHead')).includes('เผยแพร่แล้ว') && await count(p, '#aqQuiz .aq-q') === 3);
      await (await p.$('.ai-panel')).screenshot({ path: path.join(SHOTS, 'admin-news-published-quiz.png') });
      await p.click('#anReview [data-decide="close"]'); await p.waitForTimeout(150);
      check('ข่าวที่เผยแพร่แล้ว: ปิดกล่องได้', !(await visible(p, '#anReview')));
    }
    check('ท้ายเว็บ: หน้าผู้ดูแลแสดงเฉพาะปุ่มดาวน์โหลดเอกสาร', await visible(p, '[data-fc="docs"]') && !(await visible(p, '[data-fc="contact"]')));
    await go(p, '#/admin/docs'); await p.waitForTimeout(500);
    check('เอกสาร (ผู้ดูแล): รายการบอกผู้ที่ดาวน์โหลดได้ + ข้อมาตรฐานที่ผูก', (await text(p, '#adList')).includes('ประชาชนทั่วไป') && (await text(p, '#adList')).includes('ตรวจประเมินมาตรฐานข้อ') && (await text(p, '#adList')).includes('เจ้าหน้าที่ทุก รพ.สต.'));
    await p.selectOption('#adFor', '2'); await p.selectOption('#adWho', 'public');
    check('เอกสาร (ผู้ดูแล): เลือก "ประชาชนทั่วไป" → สำหรับ = ทุก รพ.สต. (ล็อก)', (await p.inputValue('#adFor')) === '' && await p.$eval('#adFor', (e) => e.disabled));
    await p.fill('#adTitle', 'คู่มือทดสอบ');
    await p.click('#adCritFold summary'); await p.waitForTimeout(100);
    await p.fill('#adCritQ', '1.2'); await p.waitForTimeout(100);
    await p.check('#adCrit input[type=checkbox] >> nth=0');
    check('เอกสาร (ผู้ดูแล): กล่องเลือกข้อตรวจประเมินมาตรฐาน', (await text(p, '#adCritN')).includes('1.2'));
    await p.setInputFiles('#adFile', { name: 'guide.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
    await p.click('#adSubmit'); await p.waitForTimeout(500);
    { const ins = (await calls(p, (c) => c.table === 'documents' && c.op === 'insert')).pop()?.payload || {};
      check('เอกสาร (ผู้ดูแล): บันทึก is_public + for_unit null + item_ids', ins.is_public === true && ins.for_unit === null && ins.item_ids?.length === 1, JSON.stringify(ins)); }
    await p.selectOption('#adWho', 'staff');
    check('เอกสาร (ผู้ดูแล): กลับเป็นเจ้าหน้าที่ → เลือก รพ.สต. ได้อีก', !(await p.$eval('#adFor', (e) => e.disabled)));
    check('เมนูผู้ดูแล: ตรวจประเมินอยู่เหนือเอกสาร + ข้อเสนอแนะอยู่ในตั้งค่า', (await p.$$eval('.sidenav [data-admin-tab]', (a) => a.map((x) => x.dataset.adminTab).join(','))) === 'news,messages,visits,achievements,rider,review,docs,drugs,settings' && await count(p, '#afList .li') > 0);
    await go(p, '#/admin/feedback'); await p.waitForTimeout(250);
    check('ลิงก์เดิม #/admin/feedback ยังเปิดได้ (พาไปตั้งค่า)', (await p.evaluate(() => location.hash)) === '#/admin/settings/feedback');
    await go(p, '#/admin/news');
    await p.click('#anQueue [data-review]'); await p.waitForTimeout(200);
    check('ข่าวจาก รพ.สต.: กล่องตรวจมีปุ่มขอแก้ไข/ไม่ผ่าน + แก้ข้อความได้', await visible(p, '#anReview [data-decide="fix"]') && (await p.inputValue('#aqTitle')).length > 0);
    await p.click('#anQueue [data-review]'); await p.waitForTimeout(150);
    check('ข่าวรอตรวจ: กด "ตรวจ" ซ้ำ = ปิดกล่องตรวจ', !(await visible(p, '#anReview')));
    await p.click('#anQueue [data-review]'); await p.waitForTimeout(200);
    await p.fill('#aqTitle', 'หัวข้อที่ผู้ดูแลแก้'); await p.click('[data-decide="published"]'); await p.waitForTimeout(400);
    check('ข่าวรอตรวจ: แก้หัวข้อแล้วกดอนุมัติ → บันทึกข้อความที่แก้พร้อมเผยแพร่', (await calls(p, (c) => c.table === 'news' && c.op === 'update')).some((c) => c.payload.title === 'หัวข้อที่ผู้ดูแลแก้' && c.payload.status === 'published'));
    check('ผู้ดูแล: อนุมัติข่าวรอตรวจ → เผยแพร่', await p.evaluate(() => window.__db.news.every((n) => n.status !== 'pending')));
    const pubN = async (pg) => +((await text(pg, '#anCount')).replace(/\D/g, '') || 0);   // จำนวนข่าวเผยแพร่ทั้งหมด (รายการย่อแสดงแค่ 3)
    const pub0 = await pubN(p);
    await p.click('#anList [data-unpub]'); await p.waitForTimeout(500);
    check('ข่าว: หยุดเผยแพร่ → ไปอยู่ในถังข่าว', await pubN(p) === pub0 - 1 && await count(p, '#anTrash [data-restore]') === 1 && (await text(p, '#anTrash')).includes('ลบถาวรในอีก 30 วัน'));
    await p.click('#anTrash [data-restore]'); await p.waitForTimeout(500);
    check('ข่าว: เรียกคืนแล้วกลับมาเผยแพร่', await pubN(p) === pub0 && await count(p, '#anTrash [data-restore]') === 0);
    await p.click('#anList [data-del]'); await p.waitForTimeout(500);
    await p.click('#anTrash [data-purge]'); await p.waitForTimeout(500);
    check('ข่าว: ลบลงถัง แล้วลบถาวรได้', await pubN(p) === pub0 - 1 && await count(p, '#anTrash [data-purge]') === 0 && (await calls(p, (c) => c.table === 'news' && c.op === 'delete')).length >= 1);
    await p.evaluate(() => { for (let i = 1; i <= 5; i++) window.__db.news.push({ id: `00000000-0000-0000-0000-00000000f00${i}`, title: `ข่าวเก่าลำดับ ${i}`, tag: 'ข่าว', body: 'x', status: 'published', view_count: 0, comments_closed: false, gallery: [], published_at: new Date(Date.UTC(2026, 0, i, 3)).toISOString(), created_at: new Date(Date.UTC(2026, 0, i, 3)).toISOString() }); });
    await go(p, '#/admin/messages'); await go(p, '#/admin/news'); await p.waitForTimeout(300);
    const allN = await pubN(p);
    check('ข่าวที่เผยแพร่: ย่อไว้แสดง 3 ข่าวล่าสุด + ปุ่มดูทั้งหมด + ช่องค้นหา/หมวด/จัดเรียง/วันที่ เห็นตลอด', await count(p, '#anList .newsrow') === 3 && await visible(p, '#anExpand') && await visible(p, '#anSearch') && await visible(p, '#anSort') && await visible(p, '#anTagF') && allN >= 8);
    await p.selectOption('#anSort', 'az'); await p.waitForTimeout(150);
    { const ts = await p.$$eval('#anList .newsrow .l b', (b) => b.map((x) => x.textContent));
      check('ข่าวที่เผยแพร่: จัดเรียงตามตัวอักษร → แสดงทุกข่าวเรียง ก→ฮ', ts.length === allN && ts.join('|') === [...ts].sort((a, b) => a.localeCompare(b, 'th')).join('|')); }
    await p.selectOption('#anSort', 'old'); await p.waitForTimeout(150);
    check('ข่าวที่เผยแพร่: จัดเรียงวันที่เผยแพร่ เก่า → ใหม่', (await p.textContent('#anList .newsrow .l b')).includes('ข่าวเก่าลำดับ 1'));
    await p.selectOption('#anTagF', 'ความรู้'); await p.waitForTimeout(150);
    check('ข่าวที่เผยแพร่: กรองหมวด', (await p.$$eval('#anList .newsrow .small', (s) => s.every((x) => x.textContent.startsWith('ความรู้')))) && !(await text(p, '#anList')).includes('ข่าวเก่าลำดับ'));
    await p.click('#anFindClear'); await p.waitForTimeout(150);
    await p.click('#anExpand'); await p.waitForTimeout(150);
    check('ข่าวที่เผยแพร่: ดูทั้งหมด → ครบทุกข่าว + เลื่อนดูได้', await count(p, '#anList .newsrow') === allN && await p.$eval('#anList', (e) => getComputedStyle(e).overflowY === 'auto'));
    await p.fill('#anSearch', 'ข่าวเก่า'); await p.waitForTimeout(150);
    check('ข่าวที่เผยแพร่: พิมพ์ค้นหัวข้อได้', await count(p, '#anList .newsrow') === 5 && (await text(p, '#anFound')).includes('5'));
    await p.fill('#anDate', '2026-01-03'); await p.waitForTimeout(150);
    check('ข่าวที่เผยแพร่: เลือกวันที่เผยแพร่ได้', await count(p, '#anList .newsrow') === 1 && (await text(p, '#anList')).includes('ข่าวเก่าลำดับ 3'));
    await p.fill('#anSearch', 'ไม่มีข่าวนี้'); await p.waitForTimeout(150);
    check('ข่าวที่เผยแพร่: ไม่พบ → แจ้งว่าไม่พบ', (await text(p, '#anList')).includes('ไม่พบ'));
    await p.click('#anFindClear'); await p.click('#anExpand'); await p.waitForTimeout(150);
    check('ข่าวที่เผยแพร่: กดย่อกลับเหลือ 3 ข่าว', await count(p, '#anList .newsrow') === 3);
    // หมวดหมู่ข่าวตามเนื้อหา (54_news_topics.sql): ชุดแรกตั้งให้ · เพิ่ม/ลบได้ · AI จัดหมวดข่าวที่ยังไม่มีหมวดเอง (รวมข่าวเก่า) · กรองได้
    await go(p, '#/admin/messages'); await go(p, '#/admin/news'); await p.waitForTimeout(6500);
    check('หมวดข่าว: ชุดแรกตั้งให้แล้ว (เช่น โรคเรื้อรัง · ยาเด็ก)', await count(p, '#ntList .nt-item') >= 5 && (await text(p, '#ntList')).includes('โรคเรื้อรัง'));
    check('หมวดข่าว: เปิดหน้าแล้ว AI จัดหมวดข่าวที่ยังไม่มีหมวดเอง (รวมข่าวเก่า)', (await calls(p, (c) => c.rpc === 'ai_news_topics_start')).length >= 1 && await p.evaluate(() => window.__db.news.filter((n) => n.status === 'published').every((n) => (n.topic_ids || []).length >= 1)) && (await text(p, '#ntMsg')).includes('AI จัดหมวดแล้ว'), await text(p, '#ntMsg'));
    check('หมวดข่าว: รายการข่าวมีป้ายหมวด', await count(p, '#anList .nt-chip') >= 1);
    await p.setViewportSize({ width: 390, height: 900 }); await p.waitForTimeout(200);
    await (await p.$('#ntPanel')).screenshot({ path: path.join(SHOTS, 'admin-news-topics-390.png') });
    check('หมวดข่าว 390px: ไม่ล้นจอ', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await p.setViewportSize({ width: 1280, height: 900 }); await p.waitForTimeout(200);
    await p.fill('#ntName', 'หมวดทดสอบใหม่'); await p.click('#ntAdd'); await p.waitForTimeout(400);
    check('หมวดข่าว: เพิ่มหมวดได้ (ขึ้นในตัวกรอง + ฟอร์มแก้ไข)', (await text(p, '#ntList')).includes('หมวดทดสอบใหม่') && (await p.$$eval('#anTopicF option', (o) => o.map((x) => x.textContent))).includes('หมวดทดสอบใหม่') && (await text(p, '#anTopics')).includes('หมวดทดสอบใหม่'));
    { const tid = await p.evaluate(() => window.__db.news_topics.find((t) => t.name === 'หมวดทดสอบใหม่').id);
      await p.click(`[data-del-topic="${tid}"]`); await p.waitForTimeout(400);
      check('หมวดข่าว: ลบหมวดได้', !(await text(p, '#ntList')).includes('หมวดทดสอบใหม่')); }
    { const first = await p.evaluate(() => window.__db.news_topics[0]);
      await p.selectOption('#anTopicF', String(first.id)); await p.waitForTimeout(200);
      check('หมวดข่าว: กรองข่าวตามหมวดเนื้อหา', (await p.$$eval('#anList .newsrow', (r) => r.length)) >= 1 && (await p.$$eval('#anList .newsrow', (rs, nm) => rs.every((r) => r.textContent.includes(nm)), first.name)));
      await p.click('#anFindClear'); await p.waitForTimeout(150);
      await p.click('#anList [data-edit]'); await p.waitForTimeout(200);
      await p.evaluate(() => document.querySelectorAll('#anTopics input:checked').forEach((x) => { x.checked = false; }));
      const boxes = await p.$$('#anTopics input');
      for (const b of boxes.slice(0, 4)) await b.click();   // ข้อที่ 4 ถูกปฏิเสธ
      check('หมวดข่าว: ฟอร์มแก้ไขเลือกหมวดได้ไม่เกิน 3', (await p.$$eval('#anTopics input:checked', (x) => x.length)) === 3);
      await p.click('#anSubmit'); await p.waitForTimeout(500);
      const up = (await calls(p, (c) => c.table === 'news' && c.op === 'update')).pop()?.payload || {};
      check('หมวดข่าว: บันทึกหมวดที่เลือก (topic_ids)', (up.topic_ids || []).length === 3, JSON.stringify(up.topic_ids)); }
    await go(p, '#/news/all'); await p.waitForTimeout(600);
    check('ข่าวทั้งหมด: กรองตามหมวดเนื้อหา + ป้ายหมวด', (await p.$$eval('#nlTopic option', (o) => o.length)) >= 6 && await count(p, '#nlList .nt-chip') >= 1);
    // หน้าแรก › ข่าวประชาสัมพันธ์: 6 ข่าวล่าสุด กดซ้าย-ขวา + ดูข่าวทั้งหมด (หน้าแยก เรียงแนวตั้ง + ค้นหา)
    await go(p, '#/news'); await p.waitForTimeout(500);
    check('หน้าแรก ข่าว: 6 กล่องพร้อมกัน 3 บน 3 ล่าง + ดูข่าวทั้งหมด', await count(p, '#newsGrid .news-card') === Math.min(6, allN) && await visible(p, '#newsAllLink') && await p.$$eval('#newsGrid .news-card', (c) => new Set(c.map((e) => Math.round(e.offsetTop / 20))).size === 2 && new Set(c.map((e) => Math.round(e.getBoundingClientRect().left))).size === 3), JSON.stringify(await p.$$eval('#newsGrid .news-card', (c) => c.map((e) => [Math.round(e.getBoundingClientRect().left), Math.round(e.getBoundingClientRect().top)]))) + ' allN=' + allN + ' w=' + await p.evaluate(() => innerWidth));
    { const ids = await p.$$eval('#newsGrid .news-card', (c) => c.map((e) => e.getAttribute('href')));
      const orders = new Set();
      for (let k = 0; k < 6; k++) orders.add(await p.evaluate(async () => { const m = await import(`./js/pages/news.js?v=4.4`); return m.shuffled([1, 2, 3, 4, 5, 6, 7, 8]).slice(0, 6).join(','); }));
      check('หน้าแรก ข่าว: สุ่มข่าวทุกครั้งที่เปิดเว็บ (ไม่ซ้ำกันในหน้า)', new Set(ids).size === ids.length && orders.size > 1, [...orders].join(' | ')); }
    { const first = await p.$$eval('#newsGrid .news-card', (c) => c.map((e) => e.getAttribute('href')).join());
      const ok0 = await visible(p, '#newsPrev') && await visible(p, '#newsNext') && (await text(p, '#newsPage')).includes('ชุดที่ 1 จาก 2');
      await p.click('#newsNext'); await p.waitForTimeout(200);
      const second = await p.$$eval('#newsGrid .news-card', (c) => c.map((e) => e.getAttribute('href')));
      check('หน้าแรก ข่าว: ปุ่ม › ด้านขวา → ดูข่าวชุดถัดไป (ไม่ซ้ำชุดแรก)', ok0 && second.length === allN - 6 && !second.some((h) => first.split(',').includes(h)) && (await text(p, '#newsPage')).includes('ชุดที่ 2 จาก 2'), JSON.stringify({ ok0, second, page: await text(p, '#newsPage') }));
      await p.click('#newsPrev'); await p.waitForTimeout(200);
      check('หน้าแรก ข่าว: ปุ่ม ‹ ด้านซ้าย → กลับชุดก่อนหน้า', (await p.$$eval('#newsGrid .news-card', (c) => c.map((e) => e.getAttribute('href')).join())) === first); }
    await p.click('#newsAllLink'); await p.waitForTimeout(600);
    check('ดูข่าวทั้งหมด: หน้าแยก ข่าวเรียงแนวตั้งครบทุกข่าว', await visible(p, '[data-view="allnews"]') && await count(p, '#nlList .newsrow') === allN && (await text(p, '#nlCount')).includes(String(allN)));
    await p.fill('#nlSearch', 'ข่าวเก่าลำดับ 4'); await p.waitForTimeout(150);
    check('ดูข่าวทั้งหมด: รูปตัวอย่างแต่ละข่าวใหญ่ (≥ 200 px ที่จอคอม)', await p.$eval('#nlList .newsrow .thumb2', (t) => t.getBoundingClientRect().width >= 200), String(await p.$eval('#nlList .newsrow .thumb2', (t) => t.getBoundingClientRect().width)));
    check('ดูข่าวทั้งหมด: ค้นหาข่าวได้', await count(p, '#nlList .newsrow') === 1 && (await text(p, '#nlFound')).includes('1'));
    await p.fill('#nlSearch', 'ไม่มีข่าวแบบนี้'); await p.waitForTimeout(150);
    check('ดูข่าวทั้งหมด: ไม่พบ → แจ้ง', (await text(p, '#nlList')).includes('ไม่พบข่าว'));
    await p.fill('#nlSearch', ''); await p.selectOption('#nlSort', 'old'); await p.waitForTimeout(150);
    check('ดูข่าวทั้งหมด: จัดเรียงเก่า → ใหม่', (await p.textContent('#nlList .newsrow b')).includes('ข่าวเก่าลำดับ 1'));
    await p.setViewportSize({ width: 390, height: 844 }); await go(p, '#/news'); await p.waitForTimeout(500);
    check('หน้าแรก ข่าว (390px): 2 คอลัมน์ ไม่มี scroll แนวนอนทั้งหน้า', await count(p, '#newsGrid .news-card') >= 4 && await p.$$eval('#newsGrid .news-card', (c) => new Set(c.map((e) => Math.round(e.getBoundingClientRect().left))).size === 2) && await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), JSON.stringify(await p.evaluate(() => ({ n: document.querySelectorAll('#newsGrid .news-card').length, sw: document.documentElement.scrollWidth, iw: innerWidth, wide: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && e.offsetParent && !e.closest('#newsGrid')).slice(0, 6).map((e) => e.tagName + '#' + e.id + '.' + e.className) }))));
    check('หน้าแรก ข่าว (390px): ปุ่ม ‹ › ไม่ล้นจอ + สูง ≥ 44px', await p.$$eval('#newsPrev, #newsNext', (b) => b.every((x) => x.getBoundingClientRect().left >= 0 && x.getBoundingClientRect().right <= innerWidth && x.getBoundingClientRect().height >= 44)));
    await p.screenshot({ path: path.join(SHOTS, 'home-news-strip-390.png') });
    await go(p, '#/dose'); await p.waitForTimeout(400); await p.click('#doseTabs [data-dt="info"]'); await p.waitForTimeout(400);
    check('ข้อมูลยา (390px): รายการยา ไม่มี scroll แนวนอน', await count(p, '#doseInfoList .di-item') > 0 && await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await p.screenshot({ path: path.join(SHOTS, 'dose-info-390.png') });
    await p.fill('#doseInfoQ', 'amoxicillin dry'); await p.waitForTimeout(100); await p.click('#doseInfoList .di-item'); await p.waitForTimeout(300);
    check('ข้อมูลยา (390px): monograph ไม่มี scroll แนวนอน + ปุ่มสูง ≥ 44px', await visible(p, '#doseMono .mono-card') && await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1) && (await p.$eval('[data-mono-back]', (b) => b.getBoundingClientRect().height)) >= 44);
    await p.screenshot({ path: path.join(SHOTS, 'dose-mono-390.png'), fullPage: true });
    await p.click('[data-mono-back]'); await p.fill('#doseInfoQ', ''); await p.click('#doseTabs [data-dt="calc"]');
    await p.fill('#doseAge', '2'); await p.fill('#doseWeight', ''); await p.waitForTimeout(100);
    check('คำนวณขนาดยา (390px): ไม่มี scroll แนวนอน', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await p.locator('#dosePaneCalc').screenshot({ path: path.join(SHOTS, 'dose-calc-390.png') });
    await p.click('#doseTabs [data-dt="ddi"]'); await p.waitForTimeout(500);
    await p.selectOption('#ddiSel0', { index: 3 }); await p.click('[data-ddi-add]'); await p.selectOption('#ddiSel1', { index: 8 }); await p.waitForTimeout(500);
    check('Drug interaction (390px): คอลัมน์เลื่อนในกล่อง ไม่มี scroll แนวนอนทั้งหน้า', await count(p, '#ddiCols .ddi-col') >= 2 && await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      JSON.stringify(await p.evaluate(() => ({ n: document.querySelectorAll('#ddiCols .ddi-col').length, sw: document.documentElement.scrollWidth, wide: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && e.offsetParent && !e.closest('#ddiCols') && !e.closest('#slides') && !e.closest('#newsGrid')).slice(0, 6).map((e) => `${e.tagName}#${e.id}.${e.className} ${Math.round(e.getBoundingClientRect().right)}`) }))));
    await p.locator('#dosePaneDdi').screenshot({ path: path.join(SHOTS, 'dose-ddi-390.png') });
    await p.click('#doseTabs [data-dt="calc"]');
    await p.fill('#doseAge', ''); await p.click('#doseTabs [data-dt="fluid"]'); await p.waitForTimeout(200);
    check('คำนวณสารน้ำ (390px): ไม่มี scroll แนวนอน (ตารางเลื่อนในกล่อง)', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await p.locator('#dosePaneFluid').screenshot({ path: path.join(SHOTS, 'dose-fluid-390.png') });
    await p.click('#doseTabs [data-dt="calc"]');
    await go(p, '#/news/all'); await p.waitForTimeout(500);
    check('ดูข่าวทั้งหมด (390px): ไม่มี scroll แนวนอน', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await p.screenshot({ path: path.join(SHOTS, 'news-all-390.png') });
    await p.setViewportSize({ width: 1280, height: 900 }); await go(p, '#/news'); await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(SHOTS, 'home-news-strip-1280.png') });
    await go(p, '#/admin/review');
    await p.click('#rvUnits [data-u="3"]'); await p.waitForTimeout(200);
    await p.click('#rvBody [data-open]'); await p.waitForTimeout(150);
    await p.click('.crit-editbox [data-set="approved"]'); await p.waitForTimeout(400);
    check('ผู้ดูแล: ตรวจประเมิน ให้ผ่านได้', await p.evaluate(() => window.__db.item_status.some((s) => s.unit_id === 3 && s.status === 'approved')));
    await go(p, '#/admin/settings/staff'); await p.waitForTimeout(300);
    check('คำร้องขอสมัครบัญชีเจ้าหน้าที่: แสดงในตั้งค่า › บัญชีเจ้าหน้าที่ + ตัวเลขบนเมนู', await count(p, '#srList .sr-row') === 1 && (await text(p, '#admSetBadge')) === '1');
    await p.selectOption('#srList .sr-unit', '4'); await p.click('[data-sr-approve]'); await p.waitForTimeout(500);
    check('คำร้อง: อนุมัติแล้วเพิ่มเป็นเจ้าหน้าที่ (เลือก รพ.สต. ได้)', await p.evaluate(() => window.__db.staff_roster.some((r) => r.email === 'c2@gmail.com' && r.unit_id === 4)) && await count(p, '#srList .sr-row') === 0);
    await p.fill('#rfEmail', 'New.Staff@Gmail.com'); await p.fill('#rfName', 'เจ้าหน้าที่ใหม่'); await p.selectOption('#rfUnit', '4'); await p.fill('#rfPos', 'เภสัชกร');
    await p.click('#rfSubmit'); await p.waitForTimeout(400);
    check('ผู้ดูแล: บัญชีเจ้าหน้าที่มีช่องตำแหน่ง (ใช้นับผู้ลงเยี่ยม)', await p.evaluate(() => window.__db.staff_roster.find((r) => r.email === 'new.staff@gmail.com')?.position === 'เภสัชกร'));
    check('ผู้ดูแล: เพิ่มบัญชีเจ้าหน้าที่ (อีเมลเป็นตัวเล็ก)', await p.evaluate(() => window.__db.staff_roster.some((r) => r.email === 'new.staff@gmail.com')));
    { const me = await p.evaluate(() => window.__db.staff_roster.find((r) => r.role === 'admin').email);
      await p.click(`[data-edit="${me}"]`); await p.waitForTimeout(150);
      await p.fill('#rfName', 'ภก.ชื่อใหม่ ทดสอบ'); await p.fill('#rfPos', 'เภสัชกรชำนาญการ'); await p.click('#rfSubmit'); await p.waitForTimeout(700);
      check('บัญชีเจ้าหน้าที่: แก้ชื่อ/ตำแหน่งของตัวเอง → หัวหน้า (สวัสดี …) + ตำแหน่ง + แถบเมนูเปลี่ยนทันที', (await text(p, '#adminHello')).includes('ภก.ชื่อใหม่ ทดสอบ') && (await text(p, '#adminSub')).includes('เภสัชกรชำนาญการ') && (await text(p, '#profileBtn')).includes('ภก.ชื่อใหม่ ทดสอบ'));
      const s2 = await p.evaluate(() => window.__db.staff_roster.find((r) => r.email === 's2@gmail.com').email);
      await p.click(`[data-edit="${s2}"]`); await p.waitForTimeout(150); await p.fill('#rfPos', 'พยาบาลวิชาชีพชำนาญการ'); await p.click('#rfSubmit'); await p.waitForTimeout(500);
      await go(p, '#/admin/visits/summary'); await p.waitForTimeout(600);
      check('บัญชีเจ้าหน้าที่: แก้ตำแหน่งแล้ว รายชื่อผู้ร่วมลงในฟอร์มสรุปผลงานขึ้นตำแหน่งใหม่ทันที', (await p.textContent('#vsPeople')).includes('พยาบาลวิชาชีพชำนาญการ') && (await p.textContent('#vsPeople')).includes('ภก.ชื่อใหม่ ทดสอบ'));
      await go(p, '#/admin/settings/staff'); await p.waitForTimeout(400); }
    await go(p, '#/admin/visits/summary'); await p.waitForTimeout(400);
    { const all = await p.evaluate(() => window.__db.patients.length);
      check('ผู้ดูแล: เพิ่มสรุปผลงานเยี่ยมบ้านได้ (ฟอร์มเลือก รพ.สต. ได้ทุกหน่วย)', await visible(p, '#adminSumSlot #vsFold') && await count(p, '#adminSumSlot #vsUnit option') === 7 && (await text(p, '#vsListTitle')).includes('ทุก รพ.สต.'));
      if (!(await p.$eval('#vsFold', (d) => d.open))) { await p.click('#vsFold > summary'); await p.waitForTimeout(150); }
      await p.fill('#vsTitle', 'สรุป รพ.สต.ควนกาหลง'); await p.selectOption('#vsUnit', '0'); await p.setInputFiles('#vsImage', { name: 'k.png', mimeType: 'image/png', buffer: PNG }); await p.waitForTimeout(400);
      await p.click('#vsSubmit'); await p.waitForTimeout(500);
      { const o = (await calls(p, (c) => c.table === 'visit_summaries' && c.op === 'insert')).pop()?.payload || {};
        check('ผู้ดูแล: สรุปผลงานเลือก "รพ.สต.ควนกาหลง" (รหัส 0) บันทึกได้', o.unit_id === 0 && o.title === 'สรุป รพ.สต.ควนกาหลง' && !(await text(p, '#vsMsg')).includes('กรุณาเลือก'), JSON.stringify(o) + (await text(p, '#vsMsg'))); }
      await p.evaluate(() => { const r = window.__db.visit_summaries; const i = r.findIndex((x) => x.title === 'สรุป รพ.สต.ควนกาหลง'); if (i >= 0) r.splice(i, 1); });
      await p.click('#vtAdminSwitch [data-vt="list"]'); await p.waitForTimeout(500);
      check('ผู้ดูแล: เยี่ยมบ้านช่อง "โรงพยาบาลควนกาหลง" รวมทุกชื่อทุก รพ.สต. (ค่าเริ่มต้น)', (await p.getAttribute('#avUnits [data-u="all"]', 'aria-current')) === 'true' && await count(p, '#ptList [data-pt]') === all && all >= 1 && (await text(p, '#ptList')).includes('รพ.สต.')); }
    await p.click('#ptList [data-pt]'); await p.waitForTimeout(300);   // ช่องรวมทุกชื่อ: บันทึกการเยี่ยมใหม่ได้ (เดิม error smallint "all")
    await p.click('[data-act="add-visit"]'); await p.waitForTimeout(200);
    await p.check('#vNoDrp'); await p.click('#vForm [type=submit]'); await p.waitForTimeout(600);
    { const vi = (await calls(p, (c) => c.table === 'visits' && c.op === 'insert')).pop()?.payload || {};
      check('ผู้ดูแล › เยี่ยมบ้าน ช่องรวมทุกชื่อ: บันทึกการเยี่ยมได้ (ใช้ รพ.สต. ของผู้ป่วย ไม่ใช่ "all")', Number.isInteger(vi.unit_id) && !(await text(p, '#ptPanel')).includes('invalid input'), JSON.stringify(vi)); }
    await p.click('#avUnits [data-u="2"]'); await p.waitForTimeout(300);
    await p.click('#ptList [data-pt]'); await p.waitForTimeout(300);
    await p.click('[data-act="edit-patient"]'); await p.fill('#pfPhone', '0899999999'); await p.click('#ptForm [type=submit]'); await p.waitForTimeout(400);
    await go(p, '#/admin/settings/audit'); await p.waitForTimeout(300);
    const auText = await text(p, '#auList');
    check('ผู้ดูแล: ประวัติการเข้าถึงแสดงการเปิดดู + การแก้ไข พร้อมชื่อผู้ใช้', auText.includes('เปิดดูข้อมูลผู้ป่วย') && auText.includes('แก้ไขข้อมูลผู้ป่วย') && auText.includes('เบอร์โทร') && await count(p, '#auList .audit-row') >= 3, auText.slice(0, 200));
    await p.selectOption('#auAction', 'read'); await p.click('#auShow'); await p.waitForTimeout(300);
    check('ผู้ดูแล: กรองเฉพาะการเปิดดูได้', await p.$$eval('#auList .chip', (x) => x.length > 0 && x.every((c) => c.classList.contains('c-sub'))));
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 3000 }), p.click('#auCsv')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    check('ผู้ดูแล: ดาวน์โหลด CSV ประวัติการเข้าถึง (เปิดใน Excel ภาษาไทยได้)', dl.suggestedFilename().endsWith('.csv') && csv.startsWith('\ufeff"วันเวลา"') && csv.includes('เปิดดูข้อมูลผู้ป่วย'), dl.suggestedFilename() + ' ' + JSON.stringify(csv.slice(0, 160)));
    await p.fill('#auSearch', 'ไม่มีชื่อนี้แน่นอน'); await p.click('#auShow'); await p.waitForTimeout(300);
    check('ผู้ดูแล: ค้นไม่พบ → แสดงสถานะว่าง', await count(p, '#auList .empty') === 1);
    await go(p, '#/admin/rider/delivery'); await p.waitForTimeout(300);
    await p.fill('#daTitle', 'ส่งยาถึงบ้าน ปี 2570'); await p.setInputFiles('#daImage', { name: 'poster.png', mimeType: 'image/png', buffer: PNG }); await p.waitForTimeout(400);
    await p.click('#daAdd'); await p.waitForTimeout(500);
    check('ผู้ดูแล: เพิ่มโปสเตอร์ส่งยาถึงบ้าน (ย่อ ≤ A4)', await count(p, '#daList .da-poster') === 1 && (await calls(p, (c) => c.upload === 'public-images' && c.path.startsWith('delivery/'))).length === 1);
    await p.fill('#daInfo', 'บริการใหม่\nโทรนัดได้ที่ รพ.สต.'); await p.click('#daInfoSave'); await p.waitForTimeout(300);
    await p.fill('#daStats [data-u="2"][data-k="deliveries"]', '60'); await p.click('#daStatSave'); await p.waitForTimeout(400);
    check('ผู้ดูแล: บันทึกข้อความแนะนำ + สถิติการจัดส่ง', (await calls(p, (c) => c.table === 'site_texts' && c.op === 'upsert' && c.payload.key === 'delivery_info')).length === 1 && (await calls(p, (c) => c.table === 'delivery_stats' && c.op === 'upsert'))[0]?.payload?.some((r) => r.unit_id === 2 && r.deliveries === 60));
    await go(p, '#/delivery'); await p.waitForTimeout(500);
    check('หน้าหลัก: โปสเตอร์แสดง + ข้อความใหม่ + สถิติอัปเดต', await count(p, '#dlPosters .poster img') === 1 && (await text(p, '#dlInfo')).includes('บริการใหม่') && (await text(p, '#dlFigs')).includes('117'));
    await p.screenshot({ path: path.join(SHOTS, 'home-delivery-1280.png'), fullPage: true });
    await go(p, '#/admin/rider'); await p.waitForTimeout(400);
    check('ผู้ดูแล: Health Rider แยกตามตำบล (หัวข้อตามไฟล์ประวัติการจัดส่งยา) + ข้อความแนะนำ', await count(p, '#hrStats .hr-trow') === 0 && (await text(p, '#hrStats')).includes('นำเข้าไฟล์') && (await p.inputValue('#hrInfoEdit')).includes('Health Rider'));
    { const H = 'ลำดับ,บริการขนส่ง,สถานะ,HN,ชื่อผู้ใช้บริการ,วันเวลาที่สร้างออเดอร์,ค่าจัดส่ง,ที่อยู่จัดส่งยา';
      const r = (i, svc, st, hn, d, fee, tam) => [i, svc, st, hn, 'ชื่อสมมติ' + i, `วันที่ ${d} เวลา 9:00 น.`, fee, `"ตำบล ${tam} อำเภอ ตัวอย่าง"`].join(',');
      const csv = ['ประวัติรายการจัดส่งยา', H, r(1, 'rider', 'สำเร็จ', '000000001', '01/09/2569', 0, 'ควนกาหลง'), r(2, 'rider', 'สำเร็จ', '000000001', '02/09/2569', 0, 'ควนกาหลง'),
        r(3, 'rider', 'ยกเลิก', '000000002', '03/09/2569', 65, 'ทุ่งนุ้ย'), r(4, 'post (Flash Express)', 'สำเร็จ', '000000003', '04/09/2569', 55, 'ทุ่งนุ้ย'),
        r(5, 'rider', 'สำเร็จ', '000000004', '05/10/2569', 65, 'อุใดเจริญ')].join('\n');
      await p.setInputFiles('#hrFile', { name: 'history.csv', mimeType: 'text/csv', buffer: Buffer.from('\uFEFF' + csv) }); await p.waitForTimeout(500);
      const v = async (t, k) => p.inputValue(`#hrStats [data-tambon="${t}"] [data-k="${k}"]`);
      check('นำเข้าไฟล์ประวัติการจัดส่งยา: นับเฉพาะ rider แยกปีงบ × ตำบล (สำเร็จ 2 · คน 1 · ส่งฟรี 2 · ยกเลิก 1)', (await text(p, '#hrImportMsg')).includes('2569') && (await text(p, '#hrImportMsg')).includes('2570') && await visible(p, '#hrSaveAll')
        && (await p.inputValue('#hrYear')) === '2570' && (await v('อุใดเจริญ', 'delivered')) === '1' && (await text(p, '#hrStats')).includes('ส่งฟรี'), await text(p, '#hrImportMsg'));
      await p.selectOption('#hrYear', '2569'); await p.waitForTimeout(400);
      check('นำเข้าไฟล์: ปีงบ 2569 ต.ควนกาหลง สำเร็จ 2 ผู้รับบริการ 1 ส่งฟรี 2 · ต.ทุ่งนุ้ย ยกเลิก 1 (ไปรษณีย์ไม่นับ)', (await v('ควนกาหลง', 'delivered')) === '2' && (await v('ควนกาหลง', 'clients')) === '1' && (await v('ควนกาหลง', 'free')) === '2' && (await v('ทุ่งนุ้ย', 'cancelled')) === '1' && (await v('ทุ่งนุ้ย', 'delivered')) === '0'); }
    await p.click('#hrSaveAll'); await p.waitForTimeout(400);
    { const up = (await calls(p, (c) => c.table === 'rider_tambon_stats' && c.op === 'upsert')).pop()?.payload || [];
      check('บันทึกทุกปีงบจากไฟล์: เก็บเฉพาะตัวเลขรวม (ไม่มีชื่อ/HN)', up.length === 3 && !/ชื่อสมมติ|000000001/.test(JSON.stringify(up)), JSON.stringify(up)); }
    await p.fill('#hrNewTambon', 'ตำบล กระทูน'); await p.click('#hrAddTambon'); await p.waitForTimeout(100);
    check('เพิ่มตำบลเองได้ (ตัดคำว่า "ตำบล")', await count(p, '#hrStats [data-tambon="กระทูน"]') === 1);
    await p.fill('#hrInfoEdit', 'ไรเดอร์สุขภาพ ส่งยาถึงบ้าน'); await p.click('#hrInfoSave'); await p.waitForTimeout(300);
    await go(p, '#/rider'); await p.waitForTimeout(500);
    check('ลิงก์ #/rider เดิม: เปิดช่องบริการจัดส่งยาถึงบ้านที่ผลงาน Health Rider', await visible(p, '[data-panel="delivery"] #hrBlock'));
    check('หน้าหลัก Health Rider: ข้อความใหม่ + ผลงานแยกตามตำบล', (await text(p, '#hrInfo')).includes('ไรเดอร์สุขภาพ') && (await text(p, '#hrFigs')).includes('ตำบลที่ให้บริการ') && (await text(p, '#hrBars')).includes('ต.อุใดเจริญ'), await text(p, '#hrFigs'));
    await p.screenshot({ path: path.join(SHOTS, 'home-rider-1280.png'), fullPage: true });
    // ผู้ดูแล › ตั้งค่า › จัดส่งยาถึงบ้าน: สรุปจากไฟล์ประวัติการจัดส่งยา (อ่านในเครื่อง · เก็บเฉพาะตัวเลขสรุป) + ปุ่ม AI
    { const head = 'ลำดับ,รหัสโรงพยาบาล,โรงพยาบาล,บริการขนส่ง,น้ำหนัก (กรัม),ขนาด (กว้าง x ยาว x สูง),สถานะ,รายละเอียดการขนส่ง,สถานะเดิม,เวลาที่อัปเดตสถานะ,เลขที่การจัดส่ง,ชื่อผู้ขับ,เบอร์โทรผู้ขับ,เลขออเดอร์,HN,VN,ชื่อผู้ใช้บริการ,หมายเลขบัตรประชาชน,เบอร์โทร,วันเวลาที่ลงทะเบียน,วันเวลาที่สร้างออเดอร์,ประเภทสิทธิการรักษา,รายละเอียดสิทธิการรักษา,ค่าจัดส่ง,วัน-เวลา จัดส่งพัสดุสำเร็จ,ที่อยู่จัดส่งยา,แพทย์/เจ้าหน้าที่,บริการ';
      const row = (i, svc, st, hn, mo, tam, rights, fee, done) => [i, '99999', 'โรงพยาบาลตัวอย่าง', svc, '-', '-', st, st, '-', '-', 'DX' + i, '-', '-', 'ORD' + i, hn, '690000000' + i, 'ชื่อสมมติ ทดสอบ' + i, '1100000000' + String(i).padStart(3, '0'), '0800000000',
        `วันที่ 01/${mo}/2569 เวลา 9:00 น.`, `วันที่ 01/${mo}/2569 เวลา 9:10 น.`, rights.startsWith('CSH') ? 'NON UC' : 'UC', rights, fee, done ? `วันที่ 01/${mo}/2569 เวลา 15:10 น.` : '-',
        `"บ้านเลขที่ 1 หมู่ 1 ตำบล ${tam} อำเภอ ตัวอย่าง จังหวัด สตูล รหัสไปรษณีย์ 91130"`, 'หมอสมมติ', 'hosxp'].join(',');
      const csv = ['ประวัติรายการจัดส่งยา วันที่ 01 พฤษภาคม 2569 - 30 มิถุนายน 2569', head,
        row(1, 'rider', 'สำเร็จ', '000000001', '05', 'ควนกาหลง', 'UCS : ผู้สูงอายุ', 0, true), row(2, 'rider', 'สำเร็จ', '000000002', '05', 'ควนกาหลง', 'UCS : ผู้สูงอายุ', 0, true),
        row(3, 'post (Flash Express (Mobilyst))', 'สำเร็จ', '000000001', '06', 'ทุ่งนุ้ย', 'CSH : ชำระเงินเอง', 55, true), row(4, 'rider', 'ยกเลิก', '000000003', '06', 'อุใดเจริญ', 'UCS : ผู้พิการ', 65, false)].join('\n');
      await go(p, '#/admin/rider/delivery'); await p.waitForTimeout(500);
      const up0 = (await calls(p, (c) => c.upload)).length;
      await p.setInputFiles('#drFile', { name: 'history.csv', mimeType: 'text/csv', buffer: Buffer.from('\uFEFF' + csv) }); await p.waitForTimeout(500);
      check('จัดส่งยา Excel: อ่านไฟล์ในเครื่อง → ตัวอย่างสรุป (สำเร็จ 3 · ผู้ป่วย 2 คน · ยกเลิก 1)', await visible(p, '#drPreviewWrap') && (await text(p, '#drPreview')).includes('สำเร็จ 3') && (await text(p, '#drPreview')).includes('ยกเลิก 1') && (await p.$$eval('#drPreview .fig .n', (f) => f.map((x) => x.textContent))).slice(0, 2).join('|') === '3|2', await text(p, '#drPreview'));
      check('จัดส่งยา Excel: แยกตามเดือน/ตำบล/ช่องทาง/สิทธิ', (await text(p, '#drPreview')).includes('ไรเดอร์') && (await text(p, '#drPreview')).includes('พ.ค. 69') && (await text(p, '#drPreview')).includes('ทุ่งนุ้ย') && (await text(p, '#drPreview')).includes('Flash Express') && (await text(p, '#drPreview')).includes('ผู้สูงอายุ'));
      await p.click('#drSave'); await p.waitForTimeout(500);
      const ins = (await calls(p, (c) => c.table === 'delivery_reports' && c.op === 'insert')).pop()?.payload || {};
      const raw = JSON.stringify(ins);
      check('จัดส่งยา Excel: บันทึกเฉพาะตัวเลขสรุป (ไม่มีชื่อ/เลขบัตร/HN/เบอร์/ที่อยู่ · ไม่อัปโหลดไฟล์)', ins.summary?.ok === 3 && ins.summary?.patients === 2 && ins.period_from === '2026-05-01' && !/ชื่อสมมติ|1100000000|000000001|0800000000|บ้านเลขที่|หมอสมมติ|\d{9,}/.test(raw) && (await calls(p, (c) => c.upload)).length === up0, raw);
      check('จัดส่งยา Excel: รายการที่บันทึก + ปุ่มให้ AI สรุป', (await text(p, '#drList')).includes('สำเร็จ 3 ครั้ง') && await count(p, '#drList [data-ai]') === 1);
      await p.click('#drList [data-ai]'); await p.waitForTimeout(6500);
      check('จัดส่งยา Excel: กดให้ AI สรุป → มีข้อความสรุป', (await text(p, '#drList')).includes('มีสรุปจาก AI แล้ว'));
      await go(p, '#/delivery'); await p.waitForTimeout(700);
      check('หน้าจัดส่งยา: แสดงสรุปจากประวัติการจัดส่งยา + ข้อความจาก AI', await visible(p, '#drPanel') && (await text(p, '#drView')).includes('จัดส่งยาสำเร็จ') && (await text(p, '#drView')).includes('สรุปโดย AI') && !(await text(p, '#drView')).includes('ชื่อสมมติ'));
      await p.setViewportSize({ width: 390, height: 900 }); await p.waitForTimeout(200);
      check('หน้าจัดส่งยา 390px: สรุปไม่ล้นจอ', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await (await p.$('#drPanel')).screenshot({ path: path.join(SHOTS, 'delivery-report-390.png') });
      await p.setViewportSize({ width: 1280, height: 900 }); }
    await go(p, '#/admin/drugs/dose');
    await p.fill('#dfName', 'ยาทดสอบ'); await p.fill('#dfInds .i-name', 'ลดไข้'); await p.fill('#dfInds .i-min', '10'); await p.fill('#dfInds .i-max', '5'); await p.click('#dfSubmit'); await p.waitForTimeout(150);
    check('ผู้ดูแล: ขนาดยาผิดถูกเตือน', (await text(p, '#dfMsg')).length > 0);
    await p.fill('#dfInds .i-max', '15');
    for (const [n, a, b] of [['ปวด', 15, 20], ['อักเสบ', 20, 30], ['ข้อที่สี่', 5, 8]]) {
      await p.click('#dfAddInd'); await p.fill('#dfInds .ind-box:last-child .i-name', n); await p.fill('#dfInds .ind-box:last-child .i-min', String(a)); await p.fill('#dfInds .ind-box:last-child .i-max', String(b));
    }
    check('ยา: เพิ่มข้อบ่งใช้ได้ + หัวข้อสรุปขนาดยา (ย่อ/ขยายได้)', await count(p, '#dfInds details.ind-box') === 4 && (await text(p, '#dfInds .ind-box:nth-child(2) .ind-sum')).includes('ปวด'));
    { const last = '#dfInds .ind-box:last-child', mm = () => p.$eval(last, (b) => [b.querySelector('.i-min').getBoundingClientRect().top, b.querySelector('.i-max').getBoundingClientRect().top]);
      const [a1, b1] = await mm();
      await p.selectOption(`${last} .i-per`, 'day'); await p.waitForTimeout(80);
      const [a2, b2] = await mm();
      await p.selectOption(`${last} .i-per`, 'dose'); await p.waitForTimeout(80);
      const [a3, b3] = await mm();
      check('ข้อบ่งใช้: ขนาดต่ำสุดอยู่คู่ขนาดสูงสุดเสมอ (สลับต่อครั้ง/ต่อวัน ไม่เลื่อนขึ้น)', a1 === b1 && a2 === b2 && a3 === b3, JSON.stringify([a1, b1, a2, b2, a3, b3]));
      await p.selectOption(`${last} .i-per`, 'day'); await p.fill(`${last} .i-times`, '1, 3'); await p.waitForTimeout(80);
      check('ข้อบ่งใช้: แบ่งให้ได้หลายแบบ (เช่น วันละ 1 หรือ 3 ครั้ง) · หัวข้อสรุปบอกครบ', (await text(p, `${last} .ind-sum`)).includes('แบ่ง 1 หรือ 3 ครั้ง')); }
    await p.fill('#dfConcs .c-label', 'ยาน้ำ 10 มก./มล.'); await p.fill('#dfConcs .c-mg', '10'); await p.selectOption('#dfConcs .c-type', 'ml');
    await p.click('#dfSubmit'); await p.waitForTimeout(500);
    const dd = await p.evaluate(() => window.__db.dose_drugs.find((d) => d.name === 'ยาทดสอบ'));
    check('ยา: บันทึก 4 ข้อบ่งใช้ + หน่วย มก./มล.', dd?.indications?.length === 4 && dd.concs[0].mgPerMl === 10 && dd.mg_per_kg_min === 10, JSON.stringify(dd));
    check('ยา: บันทึกการแบ่งให้หลายแบบ (times = แบบที่ 1 · times_alt = แบบอื่น)', dd?.indications?.[3]?.times === 1 && JSON.stringify(dd.indications[3].times_alt) === '[3]' && !('times_alt' in dd.indications[0]), JSON.stringify(dd?.indications?.[3]));
    { const q = await open(null, '#/');
      await q.evaluate(() => { const d = window.__db.dose_drugs.find((x) => /Amoxicillin/.test(x.name)); d.indications = [{ name: 'ติดเชื้อ', per: 'day', min: 25, max: 50, times: 1, times_alt: [3] }]; });
      await q.click('[data-panel-link="dose"]'); await q.waitForTimeout(400);
      await q.fill('#doseWeight', '20'); await q.selectOption('#doseDrug', { label: 'อะม็อกซีซิลลิน (Amoxicillin)' }); await q.waitForTimeout(200);
      const r = await text(q, '#doseResult');
      check('คำนวณ: ยาที่แบ่งให้ได้หลายแบบ แสดงผลแยกทีละแบบ (วันละ 1 ครั้ง = 500–1,000 มก. · วันละ 3 ครั้ง ≈ 167–333 มก./ครั้ง)', r.includes('แบบที่ 1: แบ่งให้วันละ 1 ครั้ง') && r.includes('แบบที่ 2: แบ่งให้วันละ 3 ครั้ง') && /500\s*–\s*1,?000/.test(r) && /16[67]\s*–\s*333/.test(r), r.slice(0, 400));
      await q.close(); }
    await p.fill('#dfQ', 'ยาทดสอบ'); await p.waitForTimeout(150);
    check('รายการยา: ค้นหาชื่อได้', await count(p, '#dfList .li') === 1);
    await p.fill('#dfQ', ''); await p.selectOption('#dfSortBy', 'desc'); await p.waitForTimeout(150);
    const dn = await p.$$eval('#dfList .li b', (b) => b.map((x) => x.childNodes[0].textContent.trim()));
    check('รายการยา: เรียงตามตัวอักษรย้อนกลับได้', dn.join('|') === [...dn].sort((a, b) => b.localeCompare(a, 'th')).join('|') && dn.length > 1);
    await p.selectOption('#dfFForm', 'ครีม'); await p.waitForTimeout(150);
    check('รายการยา: กรองตามรูปแบบยา (ไม่พบ → แจ้ง)', (await text(p, '#dfList')).includes('ไม่พบยา'));
    // ช่วยกรอกจากฐานข้อมูลยา (50_ai_dose.sql): RxNorm + ฉลาก openFDA → AI ร่าง · ใส่ลงฟอร์มเท่านั้น ไม่บันทึกเอง
    await p.fill('#dfName', 'ยาไทยล้วน'); await p.click('#dfHelpBtn'); await p.waitForTimeout(200);
    check('ช่วยกรอกยา: ไม่มีชื่อภาษาอังกฤษ → บอกให้ใส่ชื่อสามัญภาษาอังกฤษ (ไม่เรียกฐานข้อมูล)', (await text(p, '#dfHelpOut')).includes('ภาษาอังกฤษ') && (await calls(p, (c) => c.rpc === 'ai_dose_start')).length === 0);
    await p.fill('#dfName', 'ยาที่ไม่มี (Notfoundium)'); await p.click('#dfHelpBtn'); await p.waitForTimeout(3500);
    check('ช่วยกรอกยา: ไม่พบในฐานข้อมูล → แจ้งให้ตรวจตัวสะกด', (await text(p, '#dfHelpOut')).includes('ไม่พบยานี้'));
    const savesBefore = (await calls(p, (c) => c.table === 'dose_drugs' && c.op !== 'select')).length;
    await p.fill('#dfName', 'พาราเซตามอล (Paracetamol)'); await p.click('#dfHelpBtn'); await p.waitForTimeout(3500);
    check('ช่วยกรอกยา: ชื่อไทย (อังกฤษ) → ค้นด้วยชื่อที่ฐานข้อมูลสหรัฐฯ ใช้ (acetaminophen)', (await calls(p, (c) => c.rpc === 'ai_dose_start')).pop()?.args?.p_name === 'acetaminophen');
    check('ช่วยกรอกยา: ความแรงจาก RxNorm (ยาทาไม่เอา) + ขนาดยาที่ AI ร่างพร้อมข้อความอ้างอิงฉลาก + คำเตือนให้ตรวจ', await count(p, '#dfHelpConcs input') === 3 && (await text(p, '#dfHelpConcs')).includes('ยาน้ำ 120 มก./5 มล.') && await count(p, '#dfHelpInds input') === 2 && (await text(p, '#dfHelpInds')).includes('10 to 15 mg/kg') && (await text(p, '#dfHelpOut')).includes('ต้องตรวจ'));
    await p.check('#dfHelpConcs input[value="0"]'); await p.check('#dfHelpConcs input[value="1"]'); await p.click('[data-help="conc"]'); await p.waitForTimeout(150);
    { const rows = await p.$$eval('#dfConcs .med-row', (rs) => rs.map((r) => [r.querySelector('.c-label').value, r.querySelector('.c-mg').value, r.querySelector('.c-type').value].join('|')));
      check('ช่วยกรอกยา: ใส่ความแรงที่เลือกลงฟอร์ม (แทนแถวว่าง · หน่วยถูกต้อง) + รูปแบบยาน้ำ', rows.join(',') === 'ยาน้ำ 120 มก./5 มล.|120|liquid,ยาน้ำ 100 มก./มล.|100|ml' && (await p.inputValue('#dfForm2')) === 'ยาน้ำ', rows.join(',')); }
    await p.click('[data-help="ind"]'); await p.waitForTimeout(150);
    check('ช่วยกรอกยา: ใส่ข้อบ่งใช้ที่ AI ร่างลงฟอร์ม (แทนกล่องว่าง · ต่อวันแบ่ง 4 ครั้ง)', await count(p, '#dfInds .ind-box') === 2 && (await p.inputValue('#dfInds .ind-box:nth-child(1) .i-min')) === '10' && (await p.inputValue('#dfInds .ind-box:nth-child(2) .i-per')) === 'day' && (await p.inputValue('#dfInds .ind-box:nth-child(2) .i-times')) === '4');
    check('ช่วยกรอกยา: ระบบไม่บันทึกรายการยาเอง (ผู้ดูแลตรวจแล้วกดบันทึกเอง)', (await calls(p, (c) => c.table === 'dose_drugs' && c.op !== 'select')).length === savesBefore);
    await p.setViewportSize({ width: 390, height: 900 }); await p.waitForTimeout(200);
    check('ช่วยกรอกยา: มือถือ 390px ไม่มี scroll แนวนอน', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await p.locator('#dfHelpOut').screenshot({ path: path.join(SHOTS, 'admin-dose-help-390.png') });
    await p.setViewportSize({ width: 1280, height: 900 });
    // เพิ่มหลายรายการ: วางรายชื่อยายาว ๆ → คิว → เปิดทีละตัวในฟอร์ม + ช่วยกรอกให้ → บันทึกแล้วไปตัวถัดไป (ไม่บันทึกเอง)
    await go(p, '#/admin/drugs/ai'); await p.waitForTimeout(400);
    check('ผู้ดูแล › ข้อมูลยา: แท็บ "ร่างขนาดยาจาก AI · เพิ่มหลายรายการ" อยู่หน้าแท็บคำนวณขนาดยา · แท็บคำนวณขนาดยาเพิ่มทีละตัว', (await p.$$eval('[data-admin-view="drugs"] .adr-sec', (a) => a.map((x) => x.dataset.adrSec).join())) === 'ai,dose,local,nlem,fda,ddi' && await p.$eval('[data-adr-sec="ai"]', (d) => d.open) && await visible(p, '#dfReview') && await visible(p, '#dfBulk') && await p.$eval('#dfReview', (r) => r.closest('[data-adr-sec]').dataset.adrSec === 'ai') && await p.$eval('#dfForm', (r) => r.closest('[data-adr-sec]').dataset.adrSec === 'dose'));
    if (!(await p.$eval('#dfBulkFold', (d) => d.open))) await p.click('#dfBulkFold > summary');
    await p.fill('#dfBulk', '1. ไดเฟนไฮดรามีน (Diphenhydramine)\n- ไอบูโพรเฟน (Ibuprofen)\nเซทิริซีน (Cetirizine)\n\nไดเฟนไฮดรามีน (Diphenhydramine)');
    const saves0 = (await calls(p, (c) => c.table === 'dose_drugs' && c.op !== 'select')).length;
    await p.click('#dfBulkMake'); await p.waitForTimeout(3800);
    check('เพิ่มหลายรายการ: วางรายชื่อ → คิว 3 ตัว (ตัดเลขข้อ/ซ้ำ · ยาที่มีแล้วข้าม) + เปิดตัวแรกในฟอร์มพร้อมช่วยกรอก', await count(p, '#dfBulkList .li') === 3 && (await text(p, '#dfBulkList')).includes('มีในรายการยาแล้ว') && (await p.inputValue('#dfName')) === 'ไดเฟนไฮดรามีน (Diphenhydramine)' && (await calls(p, (c) => c.rpc === 'ai_dose_start')).pop()?.args?.p_name === 'diphenhydramine' && (await text(p, '#dfBulkN')).includes('รอเพิ่ม 2'), JSON.stringify({ n: await count(p, '#dfBulkList .li'), list: await text(p, '#dfBulkList'), name: await p.inputValue('#dfName'), rpc: (await calls(p, (c) => c.rpc === 'ai_dose_start')).pop()?.args, nn: await text(p, '#dfBulkN') }));
    check('เพิ่มหลายรายการ: ยังไม่บันทึกยาเอง', (await calls(p, (c) => c.table === 'dose_drugs' && c.op !== 'select')).length === saves0);
    await p.fill('#dfInds .i-name', 'ลดไข้'); await p.fill('#dfInds .i-min', '5'); await p.fill('#dfInds .i-max', '10');
    await p.click('#dfSubmit'); await p.waitForTimeout(3800);
    check('เพิ่มหลายรายการ: บันทึกแล้ว → ตัวนั้นเพิ่มแล้ว + เปิดยาตัวถัดไปเอง', (await text(p, '#dfBulkList')).includes('✓ เพิ่มแล้ว') && (await p.inputValue('#dfName')) === 'เซทิริซีน (Cetirizine)' && (await text(p, '#dfBulkN')).includes('เพิ่มแล้ว 1'));
    await go(p, '#/admin/drugs/ai'); await p.waitForTimeout(300);
    await p.click('#dfBulkList [data-bulk-skip]'); await p.waitForTimeout(200);
    check('เพิ่มหลายรายการ: ข้ามได้ + จำรายการไว้ในเครื่อง', (await text(p, '#dfBulkN')).includes('รอเพิ่ม 0') && await p.evaluate(() => JSON.parse(localStorage.getItem('pcps_dose_queue') || '[]').length === 3));
    await p.evaluate(() => localStorage.removeItem('pcps_dose_queue'));
    // ให้ AI ดึงข้อมูลยาเก็บเป็นร่างทั้งหมด (56_dose_ai_drafts.sql): ร่างซ่อนจากเครื่องคำนวณจนผู้ดูแลกด "ตรวจแล้ว · แสดง"
    await go(p, '#/admin/drugs/ai'); await p.waitForTimeout(400);
    if (!(await p.$eval('#dfBulkFold', (d) => d.open))) await p.click('#dfBulkFold > summary');
    await p.fill('#dfBulk', 'ลอราทาดีน (Loratadine)\nยาที่ไม่มี (Notfoundium)\nยาไทยล้วนไม่มีชื่ออังกฤษ');
    const ins0 = (await calls(p, (c) => c.table === 'dose_drugs' && c.op === 'insert')).length;
    await p.click('#dfBulkAi'); await p.waitForTimeout(9000);
    { const ins = (await calls(p, (c) => c.table === 'dose_drugs' && c.op === 'insert')).slice(ins0).map((c) => c.payload);
      const d = ins[0] || {};
      check('AI เก็บเป็นร่างทั้งหมด: บันทึกยาที่ดึงข้อมูลได้เป็นร่างซ่อนไว้ (ขนาดยา + ความแรงยากิน + ที่มา)', ins.length === 1 && d.name === 'ลอราทาดีน (Loratadine)' && d.active === false && d.ai_draft === true && d.indications?.length === 2 && d.concs?.length === 3 && d.indications.every((i) => i.quote && /^https:\/\/dailymed\.nlm\.nih\.gov\//.test(i.ref?.url || '')) && /openFDA/.test(d.ai_source), JSON.stringify(ins));
      check('AI เก็บเป็นร่าง: ยาที่ดึงไม่ได้/ไม่มีชื่ออังกฤษ → แจ้งให้กรอกเอง', (await text(p, '#dfBulkList')).includes('เก็บเป็นร่างแล้ว') && (await text(p, '#dfBulkList')).includes('ไม่มีชื่อภาษาอังกฤษ') && (await text(p, '#dfBulkMsg')).includes('เก็บเป็นร่างแล้ว 1 ยา'), await text(p, '#dfBulkMsg')); }
    await go(p, '#/admin/drugs/dose'); await p.waitForTimeout(400);
    await p.selectOption('#dfFForm', 'all'); await p.fill('#dfQ', ''); await p.waitForTimeout(150);
    check('รายการยา: ร่างจาก AI มีป้าย "AI ร่าง · รอตรวจ" + ปุ่มตรวจแล้ว · แสดง', (await text(p, '#dfList')).includes('AI ร่าง · รอตรวจ') && (await text(p, '#dfList')).includes('ตรวจแล้ว · แสดง'));
    { const id = await p.evaluate(() => window.__db.dose_drugs.find((x) => x.ai_draft)?.id);
      await p.click(`#dfList [data-toggle="${id}"]`); await p.waitForTimeout(400);
      const up = (await calls(p, (c) => c.table === 'dose_drugs' && c.op === 'update')).pop()?.payload || {};
      check('ร่างจาก AI: กดตรวจแล้ว · แสดง → แสดงในเครื่องคำนวณ (ai_draft = false)', up.active === true && up.ai_draft === false, JSON.stringify(up)); }
    // ร่างที่ระบบทำเอง (63_ai_auto.sql) → กล่องที่กรอกไว้แล้วด้านบน · แก้ได้ในกล่อง → "ตรวจแล้ว · ใช้คำนวณ"
    await p.evaluate(() => {
      const db = window.__db.dose_drugs;
      db.push({ ...db[0], id: 9901, name: 'Amoxicillin', form: 'ยาน้ำ', active: false, ai_draft: true, ai_source: 'AI ร่างจากฉลากยา openFDA Amoxil · ยังไม่ผ่านการตรวจ',
        indications: [{ name: 'ติดเชื้อหู', per: 'day', min: 25, max: 45, times: 2, quote: '25 mg/kg/day in divided doses', ref: { label: 'ฉลากยาสหรัฐฯ (US FDA) Amoxil ฉบับ 1/1/2025', url: 'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=abc' } }], concs: [{ label: 'ยาน้ำ 250 มก./5 มล.', mgPer5ml: 250 }] });
      const l = window.__db.local_drugs.find((x) => !x.dose_id && /เม็ด/.test(x.category));
      Object.assign(l, { dose_ai_status: 'none', dose_ai_note: 'ฉลากยาไม่มีขนาดยาแบบ มก./กก.' });
    });
    await go(p, '#/admin/drugs/db'); await dbAll(p); await go(p, '#/admin/drugs/ai'); await p.waitForTimeout(600);
    { const card = '#dfReview form[data-rv="9901"]';
      check('ร่างจาก AI: ข้อบ่งใช้ที่ AI กรอกมีข้อความจากฉลาก + อ้างอิงพร้อมลิงก์ (ตัวอักษรเล็ก)', (await text(p, `${card} .ai-src`)).includes('25 mg/kg/day') && (await p.getAttribute(`${card} .ai-src a`, 'href'))?.startsWith('https://dailymed.nlm.nih.gov/') && await p.$eval(`${card} .ai-src p`, (e) => parseFloat(getComputedStyle(e).fontSize) <= 13));
      check('ร่างจาก AI รอตรวจ: แสดงเป็นกล่องที่กรอกไว้แล้ว (ชื่อ/ขนาดยา/ความแรง/ข้อความจากฉลาก)', await visible(p, card) && (await p.inputValue(`${card} .r-name`)) === 'Amoxicillin' && (await p.inputValue(`${card} .i-min`)) === '25' && (await p.inputValue(`${card} .c-label`)) === 'ยาน้ำ 250 มก./5 มล.' && (await text(p, card)).includes('25 mg/kg/day') && (await text(p, '#dfRvCount')).includes('1'), await text(p, '#dfReview'));
      check('ร่างจาก AI: บอกความคืบหน้า + ยาที่ฉลากไม่มีขนาดยาตามน้ำหนัก', (await text(p, '#dfRvStatus')).includes('ระบบกำลังร่างให้') && (await text(p, '#dfRvStatus')).includes('ฉลากยาไม่มีขนาดยาตามน้ำหนักตัว 1 ยา'), await text(p, '#dfRvStatus'));
      check('ส่วนที่ย่อ/ขยายได้มีลูกศรสามเหลี่ยม (▸ ย่อ / หมุนเมื่อเปิด)', await p.$eval('.df-rv > summary', (el) => getComputedStyle(el, '::before').content.includes('▸') && getComputedStyle(el, '::before').transform !== 'none'));
      await p.fill(`${card} .i-min`, '30');
      await p.click(`${card} [type=submit]`); await p.waitForTimeout(500);
      const up = (await calls(p, (c) => c.table === 'dose_drugs' && c.op === 'update')).pop()?.payload || {};
      check('ร่างจาก AI: แก้ในกล่อง → ตรวจแล้ว · ใช้คำนวณ (บันทึกค่าที่แก้ + แสดงในเครื่องคำนวณ)', up.active === true && up.ai_draft === false && up.indications?.[0]?.min === 30 && up.mg_per_kg_min === 30 && up.indications?.[0]?.quote === '25 mg/kg/day in divided doses' && !(await p.$(card)), JSON.stringify(up)); }
    await p.evaluate(() => localStorage.removeItem('pcps_dose_queue'));
    // ยาที่เพิ่มเองต้องผูกกับยา รพ.สต. ก่อนจึงขึ้นในเครื่องคำนวณ (เลือก "ข้อมูลคำนวณขนาดยา" ในฟอร์มยา รพ.สต.)
    await go(p, '#/admin/drugs/db'); await dbAll(p); await p.waitForTimeout(600);
    { const id = await p.evaluate(() => window.__db.local_drugs.find((x) => x.code === '1200110')?.id);
      await p.click(`[data-ld-edit="${id}"]`); await p.waitForTimeout(100); await p.selectOption('#ldIngs .r-dose', { label: 'ยาทดสอบ' }); await p.click('#ldSubmit'); await p.waitForTimeout(300);
      check('ยา รพ.สต.: ผูกกับข้อมูลคำนวณขนาดยาเอง (dose_id)', (await calls(p, (c) => c.table === 'local_drugs' && c.op === 'update')).pop()?.payload?.dose_id === await p.evaluate(() => window.__db.dose_drugs.find((d) => d.name === 'ยาทดสอบ')?.id)); }
    { const id = await p.evaluate(() => window.__db.local_drugs.find((x) => x.code === '1050060')?.id);
      await p.click(`[data-ld-edit="${id}"]`); await p.waitForTimeout(100);
      check('ยา รพ.สต.: ช่องความแรงว่าง → บอกว่าอ่านจากชื่อยาไม่ได้', (await text(p, '#ldStrHint')).includes('อ่านจากชื่อยาไม่ได้'));
      await p.fill('#ldIngs .r-mg', '120'); await p.selectOption('#ldIngs .r-u', 'mg|5ml'); await p.click('#ldSubmit'); await p.waitForTimeout(300);
      const up = (await calls(p, (c) => c.table === 'local_drugs' && c.op === 'update')).pop()?.payload || {};
      check('ยา รพ.สต.: กรอกความแรงยาน้ำ (120 มก./5 มล.)', up.strength?.mg === 120 && up.strength?.per === '5ml', JSON.stringify(up.strength)); }
    await go(p, '#/dose'); await p.waitForTimeout(300);
    await p.selectOption('#doseDrug', { label: 'พาราเซตามอล (Paracetamol)' }); await p.waitForTimeout(100);
    check('คำนวณ: ยาน้ำที่กรอกความแรงแล้วเลือกได้', (await p.$$eval('#doseConc option', (o) => o.map((x) => x.textContent))).some((x) => x.includes('SYRUP') && x.includes('120 มก./5 มล.')));
    await p.fill('#doseWeight', '20'); await p.selectOption('#doseDrug', { label: 'ยาทดสอบ' }); await p.waitForTimeout(200);
    check('คำนวณโดส: แสดงพร้อมกัน 3 ข้อบ่งใช้ ที่เหลือย่อไว้ + คิดเป็น มล. จาก มก./มล.', await count(p, '#doseResult section.ind-result') === 3 && await count(p, '#doseResult details.ind-result') === 1 && (await text(p, '#doseResult')).includes('20.00–30.00 มล.'));
    check('คำนวณโดส: รายการยาอยู่ใต้น้ำหนักตัว', await p.evaluate(() => { const w = document.querySelector('#doseWeight').getBoundingClientRect(), d = document.querySelector('#doseDrug').getBoundingClientRect(); return d.top > w.bottom; }));
    // ตั้งค่า › ฐานข้อมูลยา: รายการยา รพ.สต. (local_drugs) + บัญชียาหลักแห่งชาติ (drug_monographs) — ผู้ดูแลเพิ่ม/แก้/ลบได้
    await go(p, '#/admin/drugs/db'); await dbAll(p); await p.waitForTimeout(600);
    check('ฐานข้อมูลยา: รายการยา รพ.สต. ครบ + บัญชียาหลัก (ทีละ 30)', await count(p, '#ldList .li') === await p.evaluate(() => window.__db.local_drugs.length) && await count(p, '#dmList .li') === 30 && await visible(p, '#dmMore'));
    await p.selectOption('#ldFilter', 'unlinked'); await p.waitForTimeout(100);
    check('ฐานข้อมูลยา: กรองยาที่ยังไม่ผูกข้อมูลยา', await count(p, '#ldList .li') === 12 && (await text(p, '#ldList')).includes('ยังไม่ผูกข้อมูลยา'));
    await p.selectOption('#ldFilter', 'all');
    await p.fill('#ldName', 'OMEPRAZOLE 20 MG ทดสอบ'); await p.fill('#ldCode', '9999991'); await p.fill('#ldCat', 'ยาเม็ด/แคปซูล'); await p.fill('#ldPack', '100'); await p.fill('#ldUnit', 'CAP');
    await p.fill('#ldLinkQ', 'omepraz'); await p.waitForTimeout(100);
    await p.click('#ldLinkOut [data-link="Omeprazole"]'); await p.waitForTimeout(100);
    check('ฐานข้อมูลยา: ค้นหาแล้วกดผูกกับข้อมูลยาในบัญชียาหลัก', (await text(p, '#ldLinks')).includes('Omeprazole'));
    await p.click('#ldSubmit'); await p.waitForTimeout(400);
    { const ins = (await calls(p, (c) => c.table === 'local_drugs' && c.op === 'insert')).pop()?.payload || {};
      check('ฐานข้อมูลยา: เพิ่มยา รพ.สต. พร้อมผูกข้อมูลยา (ref)', ins.name === 'OMEPRAZOLE 20 MG ทดสอบ' && ins.code === '9999991' && ins.mono_refs?.length >= 1 && ins.mono_refs.every((r) => r.startsWith('2569:')) && (await text(p, '#ldList')).includes('OMEPRAZOLE 20 MG ทดสอบ'), JSON.stringify(ins)); }
    { const id = await p.evaluate(() => window.__db.local_drugs.find((x) => x.code === '9999991')?.id);
      await p.click(`[data-ld-edit="${id}"]`); await p.waitForTimeout(100);
      check('ฐานข้อมูลยา: แก้ไขเปิดค่าเดิม + ข้อมูลยาที่ผูกไว้', (await p.inputValue('#ldName')) === 'OMEPRAZOLE 20 MG ทดสอบ' && (await text(p, '#ldLinks')).includes('Omeprazole') && await visible(p, '#ldCancel'));
      await p.fill('#ldNote', 'เก็บให้พ้นแสง'); await p.click('#ldSubmit'); await p.waitForTimeout(400);
      check('ฐานข้อมูลยา: บันทึกการแก้ไขยา รพ.สต.', (await calls(p, (c) => c.table === 'local_drugs' && c.op === 'update')).pop()?.payload?.note === 'เก็บให้พ้นแสง');
      await go(p, '#/dose'); await p.waitForTimeout(300); await p.click('#doseTabs [data-dt="info"]'); await p.waitForTimeout(400);
      await p.fill('#doseInfoQ', 'ทดสอบ'); await p.waitForTimeout(100);
      check('ฐานข้อมูลยา: ยาที่เพิ่มขึ้นหน้าข้อมูลยาทันที (ไม่ต้องรีเฟรช)', (await text(p, '#doseInfoList')).includes('OMEPRAZOLE 20 MG ทดสอบ') && (await text(p, '#doseInfoList')).includes('Omeprazole'));
      await p.fill('#doseInfoQ', ''); await p.click('#doseTabs [data-dt="calc"]');
      await go(p, '#/admin/drugs/db'); await dbAll(p); await p.waitForTimeout(500);
      await p.click(`[data-ld-del="${id}"]`); await p.waitForTimeout(400);
      check('ฐานข้อมูลยา: ลบยา รพ.สต.', (await calls(p, (c) => c.table === 'local_drugs' && c.op === 'delete')).length === 1 && !(await text(p, '#ldList')).includes('OMEPRAZOLE 20 MG ทดสอบ')); }
    await p.fill('#dmQ', 'domperidone'); await p.waitForTimeout(100);
    { const id = await p.$eval('#dmList [data-dm-edit]', (b) => b.dataset.dmEdit);
      await p.click(`[data-dm-edit="${id}"]`); await p.waitForTimeout(100);
      check('บัญชียาหลัก: แก้ไขเปิดฟอร์ม (รูปแบบยา | บัญชี · หัวข้อ ##)', await visible(p, '#dmForm') && (await p.inputValue('#dmForms')).includes('| b') && (await p.inputValue('#dmSections')).includes('## คำเตือนและข้อควรระวัง'));
      await p.fill('#dmSections', (await p.inputValue('#dmSections')) + '\n## หมายเหตุ รพ.\nทดสอบแก้ไข'); await p.click('#dmSubmit'); await p.waitForTimeout(400);
      const up = (await calls(p, (c) => c.table === 'drug_monographs' && c.op === 'update')).pop()?.payload || {};
      check('บัญชียาหลัก: บันทึกการแก้ไข (หัวข้อใหม่ต่อท้าย)', up.sections?.at(-1)?.title === 'หมายเหตุ รพ.' && up.sections.at(-1).body[0] === 'ทดสอบแก้ไข' && up.sections[0].title === 'คำเตือนและข้อควรระวัง', JSON.stringify(up.sections)); }
    await p.click('#dmNew'); await p.fill('#dmName', 'Testdrugine'); await p.fill('#dmGroupNo', '4'); await p.fill('#dmGroup', 'Central nervous system'); await p.fill('#dmSubCode', '4.6');
    await p.fill('#dmForms', 'tab | b'); await p.fill('#dmSections', '## เงื่อนไข\nใช้ทดสอบ'); await p.click('#dmSubmit'); await p.waitForTimeout(400);
    { const ins = (await calls(p, (c) => c.table === 'drug_monographs' && c.op === 'insert')).pop()?.payload || {};
      check('บัญชียาหลัก: เพิ่มข้อมูลยาใหม่', ins.name === 'Testdrugine' && ins.ref?.startsWith('custom:') && ins.forms?.[0]?.acct === 'b' && ins.sections?.[0]?.title === 'เงื่อนไข', JSON.stringify(ins));
      await p.fill('#dmQ', 'testdrugine'); await p.waitForTimeout(100);
      await p.click('#dmList [data-dm-del]'); await p.waitForTimeout(400);
      check('บัญชียาหลัก: ลบข้อมูลยา', (await calls(p, (c) => c.table === 'drug_monographs' && c.op === 'delete')).length === 1 && (await text(p, '#dmList')).includes('ไม่พบ')); }
    // ฉลากยาสหรัฐฯ (openFDA): ดึงในเบราว์เซอร์ (จำลองคำตอบ api.fda.gov) → เลือกฉลากที่ครบ (ไม่เอาโฮมีโอพาธีย์) → บันทึก · แก้ · ผูก · ลบ
    await p.route('https://api.fda.gov/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ results: [
      { set_id: 'h1', effective_time: '20250101', openfda: { generic_name: ['LORATADINE'], brand_name: ['Lorata HPUS'], product_type: ['HUMAN OTC DRUG'] }, indications_and_usage: ['homeopathic'], dosage_and_administration: ['x'], warnings: ['x'], adverse_reactions: ['x'], drug_interactions: ['x'], overdosage: ['x'] },
      { set_id: 'abc-123', effective_time: '20260301', openfda: { generic_name: ['LORATADINE'], brand_name: ['Claritin'], product_type: ['HUMAN OTC DRUG'] }, indications_and_usage: ['Uses • temporarily relieves runny nose • itchy eyes'], dosage_and_administration: ['Directions adults: 1 tablet daily'], do_not_use: ['Do not use if allergic'], storage_and_handling: ['store at 20-25°C'] },
    ] }) }));
    await p.fill('#faGeneric', 'Loratadine'); await p.selectOption('#faRoute', 'ORAL'); await p.click('#faFetch'); await p.waitForTimeout(500);
    { const up = (await calls(p, (c) => c.table === 'drug_fda_labels' && c.op === 'upsert')).pop()?.payload || {};
      check('openFDA: ดึงฉลาก → เลือกฉลากจริง (ไม่ใช่โฮมีโอพาธีย์) + หัวข้อไทย + บันทึก', up.key === 'loratadine|ORAL' && up.title === 'Claritin' && up.set_id === 'abc-123' && up.sections?.[0]?.title === 'ข้อบ่งใช้' && up.sections[0].body.includes('temporarily relieves') && up.sections.some((x) => x.title === 'ข้อห้ามใช้') && (await text(p, '#faMsg')).includes('บันทึกฉลาก'), JSON.stringify(up).slice(0, 300)); }
    await p.fill('#faQ', 'claritin'); await p.waitForTimeout(100);
    check('openFDA: ฉลากใหม่อยู่ในรายการ + ตัวเลือกผูกในฟอร์มยา รพ.สต.', await count(p, '#faList .li') === 1 && await p.$eval('#ldFda', (s) => [...s.options].some((o) => o.value === 'loratadine|ORAL')));
    await p.click('#faList [data-fa-edit]'); await p.waitForTimeout(100);
    check('openFDA: แก้ไขเปิดหัวข้อเป็น ## ข้อความ', await visible(p, '#faForm') && (await p.inputValue('#faSections')).includes('## ข้อบ่งใช้'));
    await p.fill('#faName', 'Claritin (ทดสอบแก้)'); await p.click('#faSave'); await p.waitForTimeout(300);
    check('openFDA: บันทึกการแก้ไขฉลาก', (await calls(p, (c) => c.table === 'drug_fda_labels' && c.op === 'update')).pop()?.payload?.title === 'Claritin (ทดสอบแก้)');
    { const id = await p.evaluate(() => window.__db.local_drugs.find((x) => x.code === '1700170')?.id);
      await p.click(`[data-ld-edit="${id}"]`); await p.waitForTimeout(100); await p.selectOption('#ldFda', 'loratadine|ORAL'); await p.click('#ldSubmit'); await p.waitForTimeout(300);
      check('openFDA: ผูกฉลากกับยา รพ.สต.', (await calls(p, (c) => c.table === 'local_drugs' && c.op === 'update')).pop()?.payload?.fda_key === 'loratadine|ORAL'); }
    await p.click('#faList [data-fa-del]'); await p.waitForTimeout(300);
    check('openFDA: ลบฉลาก', (await calls(p, (c) => c.table === 'drug_fda_labels' && c.op === 'delete')).length === 1);
    await p.unroute('https://api.fda.gov/**');
    // DailyMed (69_dailymed.sql): ค้นผ่านฐานข้อมูล → เลือกฉลาก → นำเข้าผ่าน openFDA ด้วย set_id
    await p.route('https://api.fda.gov/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ results: [
      { set_id: 'aaaa1111-2222-3333-4444-555566667777', effective_time: '20261001', openfda: { generic_name: ['LORATADINE'], brand_name: ['Loratadine Test'], route: ['ORAL'] }, indications_and_usage: ['Uses: temporarily relieves allergy symptoms'], dosage_and_administration: ['adults: 10 mg once daily'] }] }) }));
    await p.fill('#dmdQ', 'loratadine'); await p.click('#dmdGo'); await p.waitForTimeout(1500);
    check('DailyMed: ค้นแล้วแสดงรายการฉลาก + ลิงก์เปิดใน DailyMed', await count(p, '#dmdOut .li') === 1 && (await p.getAttribute('#dmdOut a', 'href')).startsWith('https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=aaaa1111') && (await calls(p, (c) => c.rpc === 'dailymed_search')).pop()?.args?.p_q === 'loratadine');
    await p.click('#dmdOut [data-dmd-imp]'); await p.waitForTimeout(500);
    { const up = (await calls(p, (c) => c.table === 'drug_fda_labels' && c.op === 'upsert')).pop()?.payload || {};
      check('DailyMed: นำเข้าฉลากที่เลือก (openFDA ด้วย set_id) → บันทึกเป็นฉลากยา', up.set_id === 'aaaa1111-2222-3333-4444-555566667777' && up.key === 'loratadine|ORAL|loratadine test' && up.sections?.length >= 2 && (await text(p, '#dmdMsg')).includes('นำเข้าฉลาก'), JSON.stringify({ key: up.key, n: up.sections?.length, msg: await text(p, '#dmdMsg') })); }
    await p.unroute('https://api.fda.gov/**');
    // ฉลาก openFDA ภาษาไทย (AI แปล · 60_drug_calc_th.sql) → หน้าข้อมูลยาแสดงไทย ซ่อนอังกฤษ · ผู้ดูแลแก้ข้อความไทย = ตรวจแล้ว
    await p.fill('#faQ', 'amlodipine'); await p.waitForTimeout(100);
    await p.click('#faList [data-fa-th]'); await p.waitForTimeout(6500);
    check('openFDA: ให้ AI แปลไทยทีละฉลาก', (await calls(p, (c) => c.rpc === 'ai_fda_th_start')).length === 1 && (await text(p, '#faList')).includes('ภาษาไทย (AI แปล)'), await text(p, '#faList'));
    await go(p, '#/dose'); await p.waitForTimeout(300); await p.click('#doseTabs [data-dt="info"]'); await p.waitForTimeout(400);
    await p.fill('#doseInfoQ', 'amlodipine'); await p.waitForTimeout(100); await p.click('#doseInfoList .di-item'); await p.waitForTimeout(400);
    { const fda = '#doseMono .mono-fda';
      check('ข้อมูลยา: ฉลาก openFDA แสดงภาษาไทย (AI) + ต้นฉบับอังกฤษซ่อนไว้ให้กดดู + เรียงหัวข้อสำคัญก่อน', (await text(p, fda)).includes('(ภาษาไทย) ข้อบ่งใช้') && (await text(p, fda)).includes('แปลและเรียบเรียงเป็นภาษาไทยโดย AI') && await count(p, `${fda} details.mono-en`) >= 5 && await count(p, `${fda} details.mono-en[open]`) === 0
        && (await p.$$eval(`${fda} .mono-fold > summary`, (x) => x.map((e) => e.textContent))).slice(0, 2).join('|') === 'ข้อบ่งใช้|ขนาดยาและวิธีใช้' && (await text(p, fda)).includes('Drug interaction'));
      check('ข้อมูลยา: ผู้ดูแลเห็นปุ่ม "แก้ไขข้อมูลนี้" ทุกส่วน', await count(p, '#doseMono [data-edit-drug]') >= 3);
      await p.click(`${fda} [data-edit-drug]`); await p.waitForTimeout(900);
      check('ข้อมูลยา: กด "แก้ไขข้อมูลนี้" → ไปแท็บฐานข้อมูลฉลากยา และเปิดฟอร์มฉลากนั้น', (await p.evaluate(() => location.hash)) === '#/admin/drugs/fda' && await visible(p, '#faForm') && (await p.inputValue('#faSectionsTh')).includes('## ข้อบ่งใช้'), await p.evaluate(() => location.hash)); }
    await p.fill('#faSectionsTh', '## ข้อบ่งใช้\n- รักษาความดันโลหิตสูง\n## ขนาดยาและวิธีใช้\nเริ่ม 5 มก. วันละครั้ง'); await p.click('#faSave'); await p.waitForTimeout(300);
    { const up = (await calls(p, (c) => c.table === 'drug_fda_labels' && c.op === 'update')).pop()?.payload || {};
      check('openFDA: ผู้ดูแลแก้ข้อความไทย → ตรวจแล้ว', up.th_reviewed === true && up.sections_th?.[0]?.body?.[0] === 'รักษาความดันโลหิตสูง' && up.sections_th[1].body[0] === 'เริ่ม 5 มก. วันละครั้ง', JSON.stringify(up.sections_th)); }
    // Drug interaction (ผู้ดูแล): AI แปลไทย · แก้ไข (= ตรวจแล้ว) · ยา รพ.สต. ผูกยาใน DDInter
    await go(p, '#/admin/drugs/db'); await dbAll(p); await p.waitForTimeout(700);
    await go(p, '#/admin/drugs/local'); await p.waitForTimeout(300);
    { const secs = await p.$$eval('[data-admin-view="drugs"] .adr-sec', (a) => a.map((x) => `${x.dataset.adrSec}:${x.querySelector(':scope > summary').textContent.trim()}`));
      check('ผู้ดูแล › ข้อมูลยา: ทุกส่วนเรียงแนวตั้ง (ไม่ใช่แท็บ) · ฐานข้อมูลแต่ละส่วนแยก 2 กล่อง (บน = เพิ่ม/แก้ไข · ล่าง = รายการที่บันทึกแล้ว)', await count(p, '#adrTabs') === 0 && secs.length === 6 && secs.some((t) => t.startsWith('local:ฐานข้อมูลบัญชียา รพ.สต.')) && secs.some((t) => t.startsWith('ddi:ฐานข้อมูลอันตรกิริยา'))
        && await p.$$eval('[data-db-part]', (x) => x.every((e) => e.querySelectorAll(':scope > .panel').length === 2 && /บันทึกแล้ว/.test(e.querySelectorAll(':scope > .panel')[1].querySelector('h2').textContent) && !e.querySelectorAll(':scope > .panel')[0].querySelector('.list:not(#dmdOut)'))), JSON.stringify(secs));
      const tops = await p.$$eval('[data-admin-view="drugs"] .adr-sec', (a) => a.map((x) => x.getBoundingClientRect().top));
      check('ผู้ดูแล › ข้อมูลยา: ส่วนต่าง ๆ อยู่ใต้กันลงมา', tops.every((t, i) => !i || t > tops[i - 1])); }
    await p.waitForTimeout(600);   // รอเลื่อนหน้า (smooth scroll) เสร็จก่อนกด
    await p.click('[data-adr-sec="local"] > summary'); await p.waitForTimeout(100);
    check('ผู้ดูแล › ข้อมูลยา: กดหัวข้อเพื่อย่อส่วนนั้นได้', !(await p.$eval('[data-adr-sec="local"]', (d) => d.open)));
    await p.click('#adrCloseAll'); await p.waitForTimeout(100);
    check('ผู้ดูแล › ข้อมูลยา: ปุ่มย่อทุกส่วน', await p.$$eval('.adr-sec', (a) => a.every((x) => !x.open)));
    await p.click('#adrOpenAll'); await p.waitForTimeout(100);
    check('ผู้ดูแล › ข้อมูลยา: ปุ่มขยายทุกส่วน', await p.$$eval('.adr-sec', (a) => a.every((x) => x.open)));
    await go(p, '#/admin/drugs/ddi'); await p.waitForTimeout(300);
    check('ผู้ดูแล › ข้อมูลยา: ลิงก์เดิม #/admin/drugs/ddi เปิดส่วนอันตรกิริยา', await p.$eval('[data-adr-sec="ddi"]', (d) => d.open) && await visible(p, '#ddList'));
    // เลือกยาด้านบน → ทุกฐานข้อมูลแสดงเฉพาะยานั้น
    await p.fill('#adrQ', 'AMOXICILLIN 500 MG'); await p.waitForTimeout(300);
    { const ids = await p.evaluate(() => window.__db.local_drugs.find((x) => x.name === 'AMOXICILLIN 500 MG').ddi_ids);
      const pairs = await p.$$eval('#ddList .li b', (b) => b.map((x) => x.textContent));
      const ddiName = await p.evaluate((id) => window.__db.ddi_drugs.find((x) => x.id === id)?.name, ids[0]);
      check('เลือกยาด้านบน: บัญชียา รพ.สต. เหลือยาตัวเดียว + ส่วนอื่นเปิดเอง', await count(p, '#ldList .li') === 1 && (await text(p, '#ldList')).includes('AMOXICILLIN 500 MG') && await p.$$eval('.adr-sec', (a) => a.every((x) => x.open)) && (await text(p, '#adrInfo')).includes('AMOXICILLIN'));
      check('เลือกยาด้านบน: บัญชียาหลัก/ฉลากยา/ข้อมูลคำนวณ เหลือเฉพาะของยานี้ตัวเดียว', await count(p, '#dmList .li') === 1 && (await text(p, '#dmList')).includes('Amoxicillin') && await count(p, '#faList .li') === 1 && (await text(p, '#faList')).toLowerCase().includes('amoxicillin')
        && await count(p, '#dfList .li') === 1 && (await text(p, '#dfList')).includes('Amoxicillin'), `${await count(p, '#dmList .li')}/${await count(p, '#faList .li')}/${await count(p, '#dfList .li')}`);
      check('เลือกยาด้านบน: อันตรกิริยาแสดงเฉพาะคู่ที่มียานี้ + หัวข้อบอกจำนวนที่พบ', pairs.length > 0 && pairs.every((t) => t.includes(ddiName)) && (await text(p, '[data-adr-n="local"]')).includes('พบ 1') && (await text(p, '[data-adr-n="dose"]')).includes('พบ 1'), ddiName); }
    await p.click('#adrClear'); await p.waitForTimeout(200);
    check('เลือกยาด้านบน: กดล้าง → แสดงทุกรายการเหมือนเดิม', await count(p, '#ldList .li') > 10 && await count(p, '#dfList .li') > 1 && (await p.inputValue('#adrQ')) === '' && (await text(p, '[data-adr-n="local"]')).trim() === '');
    await go(p, '#/admin/drugs/db'); await dbAll(p);
    check('ผู้ดูแล › ฐานข้อมูลยา: บอกว่าระบบแปลไทยให้เองต่อเนื่อง (ฉลาก/คู่ยา)', (await p.textContent('[data-view=admin]')).includes('ระบบแปลให้เองต่อเนื่องทีละฉลาก') && (await p.textContent('[data-view=admin]')).includes('ระบบแปลให้เองต่อเนื่องทีละคู่'));
    check('Drug interaction (ผู้ดูแล): รายการคู่ยา เรียงรุนแรงก่อน', await count(p, '#ddList .li') === 30 && (await text(p, '#ddList .li')).includes('Major') && (await text(p, '#ddCount')).includes('คู่'));
    await p.selectOption('#ddLevel', 'Major'); await p.waitForTimeout(100);
    await p.click('#ddList [data-dd-th]'); await p.waitForTimeout(6500);
    check('Drug interaction: ให้ AI แปลไทยทีละคู่', (await calls(p, (c) => c.rpc === 'ai_ddi_th_start')).length === 1 && (await text(p, '#ddList')).includes('ภาษาไทย (AI แปล)'));
    await p.click('#ddList [data-dd-edit]'); await p.waitForTimeout(100);
    check('Drug interaction: แก้ไขเปิดข้อความไทย/อังกฤษ', await visible(p, '#ddForm') && (await p.inputValue('#ddDescTh')).includes('(ภาษาไทย)') && (await p.inputValue('#ddDesc')).length > 10);
    await p.fill('#ddDescTh', 'ยาสองตัวนี้ทำให้ระดับยาในเลือดสูงขึ้น'); await p.click('#ddSave'); await p.waitForTimeout(300);
    { const up = (await calls(p, (c) => c.table === 'ddi_pairs' && c.op === 'update')).pop()?.payload || {};
      check('Drug interaction: บันทึกข้อความไทย = ตรวจแล้ว', up.description_th === 'ยาสองตัวนี้ทำให้ระดับยาในเลือดสูงขึ้น' && up.th_reviewed === true); }
    { const id = await p.evaluate(() => window.__db.local_drugs.find((x) => x.code === '1010280')?.id);
      await p.click(`[data-ld-edit="${id}"]`); await p.waitForTimeout(100);
      { const rows = await p.$$eval('#ldIngs .ld-ing-row', (r) => r.map((x) => `${x.querySelector('.r-n').value}|${x.querySelector('.r-mg').value}|${x.querySelector('.r-u').value}`));
        check('ยา รพ.สต.: ยาสูตรผสมกรอกแยกรายสาร (ชื่อ · ความแรง · หน่วย · ข้อมูลคำนวณ) + เตือนให้ทวนสอบข้อมูลที่ระบบใส่ให้', rows.join() === 'Sulfamethoxazole|400|mg|tab,Trimethoprim|80|mg|tab' && await count(p, '#ldIngs .r-dose') === 2 && await visible(p, '#ldIngWarn'), rows.join()); }
      await p.selectOption('#ldIngs .ld-ing-row:nth-child(2) .r-dose', { label: 'ยาทดสอบ' });
      check('ยา รพ.สต.: ช่องยาใน DDInter แสดงยาผสมครบ (Co-trimoxazole = 2 ตัว)', (await p.inputValue('#ldDdi')).split(',').length === 2, await p.inputValue('#ldDdi'));
      await p.fill('#ldDdi', 'Sulfamethoxazole'); await p.click('#ldSubmit'); await p.waitForTimeout(300);
      const up = (await calls(p, (c) => c.table === 'local_drugs' && c.op === 'update')).pop()?.payload || {};
      check('ยา รพ.สต.: บันทึกสารสำคัญรายตัว + ข้อมูลคำนวณของ Trimethoprim (ทวนสอบแล้ว = ไม่มีป้ายระบบใส่ให้)', up.ingredients?.length === 2 && up.ingredients[1].dose_id === await p.evaluate(() => window.__db.dose_drugs.find((d) => d.name === 'ยาทดสอบ')?.id) && !up.ingredients[0].dose_id && !JSON.stringify(up.ingredients).includes('auto') && up.dose_id === null, JSON.stringify(up.ingredients));
      check('ยา รพ.สต.: แก้ยาใน DDInter → บันทึกเป็นรหัส', up.ddi_ids?.length === 1 && /^DDInter\d+$/.test(up.ddi_ids[0]), JSON.stringify(up.ddi_ids)); }
    await go(p, '#/admin/settings/dose'); await p.waitForTimeout(400);
    check('ผู้ดูแล: เมนูข้อมูลยาแยกจากตั้งค่า (ลิงก์เดิมพาไปเมนูใหม่)', (await p.evaluate(() => location.hash)) === '#/admin/drugs/dose' && await p.$eval('[data-adr-sec="dose"]', (d) => d.open) && await visible(p, '#dfForm') && await count(p, '#asTabs [data-sub="dose"]') === 0 && await count(p, '.sidenav [data-admin-tab="drugs"]') === 1);
    await go(p, '#/admin/settings/delivery'); await p.waitForTimeout(400);
    check('ผู้ดูแล: จัดส่งยาถึงบ้านย้ายไปรวมกับ Health Rider', (await p.evaluate(() => location.hash)) === '#/admin/rider/delivery' && await visible(p, '[data-rider-sub="delivery"]') && !(await visible(p, '[data-rider-sub="rider"]')) && await count(p, '#arTabs [data-sub]') === 2);
    // ยา รพ.สต. ที่ยังไม่มีข้อมูลคำนวณ → ให้ AI ร่างขนาดยาจากฉลาก openFDA (ใช้ชื่อสามัญสหรัฐฯ) → ร่างซ่อนจนตรวจ
    await go(p, '#/admin/drugs/ai'); await p.waitForTimeout(400);
    await p.click('#dfFromRpst'); await p.waitForTimeout(700); await p.click('#dfBulkStop'); await p.waitForTimeout(6000);
    { const q = await p.evaluate(() => JSON.parse(localStorage.getItem('pcps_dose_queue') || '[]'));
      const first = (await calls(p, (c) => c.rpc === 'ai_dose_start')).pop()?.args?.p_name;
      check('ขนาดยาจาก openFDA: ยารับประทาน รพ.สต. ที่ยังไม่มีข้อมูล เข้าคิว + ค้นด้วยชื่อสหรัฐฯ (เช่น albuterol)', q.length >= 20 && q.some((x) => x.name === 'Salbutamol sulfate' && x.q === 'albuterol sulfate') && !q.some((x) => /Paracetamol/.test(x.name)) && first === 'albendazole', JSON.stringify({ n: q.length, first })); }
    await p.evaluate(() => localStorage.removeItem('pcps_dose_queue'));
    await go(p, '#/admin/drugs/db'); await dbAll(p); await p.waitForTimeout(500);
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(150);
    check('ฐานข้อมูลยา (390px): ไม่มี scroll แนวนอน', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await p.screenshot({ path: path.join(SHOTS, 'admin-drugs-390.png') });
    await p.close();

    /* ================= งานจาก comment หน้าตัวอย่าง (ข่าว/แชท/เกณฑ์/ผู้ป่วย) ================= */
    const img = { name: 'a.png', mimeType: 'image/png', buffer: PNG }, pdf = { name: 'คู่มือ.pdf', mimeType: 'application/pdf', buffer: PDF };
    p = await open('staff', '#/staff/news');
    check('ข่าว: ประเภทใหม่ ข่าว/ประชาสัมพันธ์/ความรู้', (await p.$$eval('#snTag option', (o) => o.map((x) => x.value).join(','))) === 'ข่าว,ประชาสัมพันธ์,ความรู้');
    check('เมนูเจ้าหน้าที่: กล่องที่ซ้อนกันมีระยะห่าง', await p.$eval('[data-staff-view="news"]', (e) => getComputedStyle(e).rowGap) === '16px');
    await p.setInputFiles('#snImage', img); await p.waitForTimeout(500);
    await (await p.$('#snForm')).screenshot({ path: path.join(SHOTS, 'staff-news-images.png') });
    check('ข่าว: เลือกรูปแล้วแสดงตัวอย่างทันที + ย่อไม่เกิน A4 + ปุ่ม × ลบรูป', await visible(p, '#snImagePreview img') && (await text(p, '#snImageNote')).includes('A4') && await visible(p, '#snImagePreview .img-x'));
    await p.setInputFiles('#snFile', pdf); await p.fill('#snTitle', 'ข่าวมี PDF'); await p.fill('#snBody', 'x'); await p.selectOption('#snTag', 'ความรู้');
    await p.click('#snSubmit'); await p.waitForTimeout(600);
    const ins = (await calls(p, (c) => c.table === 'news' && c.op === 'insert'))[0]?.payload || {};
    check('ข่าว: ส่งพร้อมรูป (WebP) + PDF แนบ', ins.tag === 'ความรู้' && ins.image_path?.endsWith('.webp') && ins.file_path?.endsWith('.pdf') && ins.file_name === 'คู่มือ.pdf', JSON.stringify(ins));
    await go(p, '#/staff/criteria'); await p.waitForTimeout(300);
    const i13 = await itemId(p, '1.3');
    await p.click(`[data-open="${i13}"]`); await p.waitForTimeout(200);
    await p.setInputFiles('#ev-files', [img, pdf]); await p.waitForTimeout(200);
    check('หลักฐาน: เลือกไฟล์แล้วแสดงตัวอย่าง (รูป + PDF)', await count(p, '#ev-preview .fthumb') === 2 && await count(p, '#ev-preview img') === 1);
    await p.evaluate(() => window.__db.achievements.push({ id: '00000000-0000-0000-0000-0000000ac001', unit_id: 2, title: 'ผลงานมีรูป', image_path: 'achievements/2/x.webp', created_at: new Date().toISOString() }));
    await p.click('[data-ach-pick]'); await p.waitForTimeout(300);
    check('หลักฐาน: เลือกรูปจาก "ผลงาน" ที่นำเสนอแล้วได้ (เฉพาะผลงานที่มีรูปของหน่วยตัวเอง)', await count(p, '#ev-ach [data-ach-opt]') === 1 && (await text(p, '#ev-ach')).includes('ผลงานมีรูป'));
    await p.click('#ev-ach [data-ach-opt]'); await p.waitForTimeout(100);
    check('หลักฐาน: กดเลือกแล้วขึ้นเลือกแล้ว + จำนวน', (await p.getAttribute('#ev-ach [data-ach-opt]', 'aria-pressed')) === 'true' && (await text(p, '#ev-ach-n')).includes('1 รูป'));
    await p.click(`[data-submit="${i13}"]`); await p.waitForTimeout(800);
    await p.click(`[data-open="${i13}"]`); await p.waitForTimeout(300);
    check('หลักฐาน: ส่งแล้วขึ้น "รอตรวจ" + ภาพย่อไฟล์ที่ส่ง (รวมรูปจากผลงาน)', await visible(p, '.wait-note') && await count(p, '.crit-editbox .fthumb[data-file]') === 3 && (await calls(p, (c) => c.upload === 'evidence')).length === 3);
    await p.click('[data-withdraw]'); await p.waitForTimeout(500);
    check('หลักฐาน: กดยกเลิกการส่งได้', (await calls(p, (c) => c.rpc === 'withdraw_item_status')).length === 1 && await p.evaluate((id) => window.__db.item_status.find((x) => x.item_id === id && x.unit_id === 2)?.status === 'none', i13));
    check('มาตรฐาน: ผลงานที่ผูกข้อนี้ขึ้นเป็นหลักฐาน (ป้าย "ผลงาน 1" + การ์ดผลงาน · ไม่ต้องส่งตรวจ)', (await text(p, `#ci-${i13}`)).includes('ผลงาน 1') && (await text(p, '.crit-editbox')).includes('ผลงาน: ตู้เย็นเก็บยาได้มาตรฐาน') && (await text(p, '.crit-editbox')).includes('ไม่ต้องส่งตรวจ'));
    check('เมนูเจ้าหน้าที่: ไม่มีเมนูเอกสาร (ย้ายไปปุ่มท้ายเว็บ)', !(await p.$('[data-staff-tab="docs"]')));
    { const first = await p.evaluate(() => window.__db.documents.find((d) => d.is_public)?.item_ids?.[0]);
      await p.click(`[data-open="${first}"]`); await p.waitForTimeout(300);
      check('มาตรฐาน: เอกสารที่ผู้ดูแลผูกกับข้อขึ้นให้ดาวน์โหลดในข้อนั้น', (await text(p, '.crit-editbox .ci-docs')).includes('แผ่นพับการใช้ยาอย่างปลอดภัย'));
      await p.click('.ci-docs [data-docdl]'); await p.waitForTimeout(300);
      check('มาตรฐาน: กดเอกสาร → ดาวน์โหลด', (await calls(p, (c) => c.signed === 'documents' && c.path === 'all/1-d.pdf')).length >= 1);
      await p.click('.crit-editbox [data-close]'); await p.waitForTimeout(150); }
    const i11 = await itemId(p, '1.1'), i21 = await itemId(p, '2.1.1');
    await go(p, '#/staff/achievements'); await p.waitForTimeout(400);
    check('ผลงาน: กล่อง "สอดคล้องกับมาตรฐานข้อ" ย่อได้ (ค่าเริ่มต้นย่อ · หัวบอกว่ายังไม่ได้เลือก)', !(await p.isVisible('#saCrit')) && (await p.textContent('#saCritN')).includes('ยังไม่ได้เลือก'));
    await p.click('#saCritFold > summary'); await p.waitForTimeout(100);
    check('ผลงาน: กล่องเลือกข้อมาตรฐานปีงบปัจจุบัน (ข้อ + รายละเอียด)', await count(p, '#saCrit .crit-opt') > 3 && (await text(p, '#saCrit')).includes('1.1'));
    check('ผลงาน: รายการผลงานบอกข้อมาตรฐานที่ผูกไว้', (await text(p, '#saList')).includes('มาตรฐานข้อ 1.3'));
    check('ผลงาน: รายการบอกสถานะ AI (ยังไม่วิเคราะห์ + ปุ่มให้ AI วิเคราะห์)', (await text(p, '#saList .newsrow')).includes('AI ยังไม่วิเคราะห์') && await count(p, '#saList [data-ai-run]') >= 1);
    const nAll = await count(p, '#saCrit .crit-opt');
    await p.fill('#saCritQ', '1.1'); await p.waitForTimeout(100);
    check('ผลงาน: ค้นหาข้อมาตรฐานได้', (await p.$$eval('#saCrit .crit-opt', (l) => l.map((x) => x.textContent))).every((t) => t.includes('1.1')) && await count(p, '#saCrit .crit-opt') < nAll);
    await p.check(`#saCrit input[value="${i11}"]`); await p.fill('#saCritQ', ''); await p.waitForTimeout(100);
    await p.check(`#saCrit input[value="${i21}"]`);
    check('ผลงาน: เลือกได้มากกว่า 1 ข้อ (ค้นหาแล้วยังจำที่เลือก)', (await text(p, '#saCritN')).includes('1.1') && (await text(p, '#saCritN')).includes('2.1.1'));
    await (await p.$('#saForm')).screenshot({ path: path.join(SHOTS, 'staff-ach-criteria.png') });
    const isW = (c) => c.table === 'item_status' && ['insert', 'update', 'upsert', 'delete'].includes(c.op), isW0 = (await calls(p, isW)).length;
    check('AI แนะนำ: บอกให้ใส่รายละเอียดก่อน + ใช้เวลาสักครู่', (await text(p, '#saAi')).includes('รายละเอียด') && (await text(p, '#saAi')).includes('สักครู่'));
    await p.click('#saAiBtn'); await p.waitForTimeout(200);
    check('AI แนะนำ: ยังไม่พิมพ์รายละเอียด → เตือน ไม่ส่งไป AI', (await text(p, '#saAiOut')).includes('กรุณาพิมพ์ "รายละเอียด"') && !(await calls(p, (c) => c.rpc === 'ai_match_start')).length);
    await p.uncheck(`#saCrit input[value="${i11}"]`);
    const b11 = await p.evaluate((id) => window.__db.criteria_items.find((i) => i.id === id).body, i11);
    await p.fill('#saTitle', 'ผลงานผูกมาตรฐาน'); await p.fill('#saBody', 'รพ.สต. ' + b11);
    await p.click('#saAiBtn'); await p.waitForTimeout(300);
    check('AI แนะนำ: ระหว่างรอแสดง "กำลังวิเคราะห์ … สักครู่"', (await text(p, '#saAiOut')).includes('สักครู่') && (await p.$eval('#saAiBtn', (b) => b.disabled)));
    await p.waitForTimeout(3500);
    check('AI แนะนำ: ได้ผลแล้วแสดงข้อที่ตรง + เหตุผล + ติ๊กให้อัตโนมัติ', (await text(p, '#saAiOut')).includes('AI แนะนำ') && (await text(p, '#saAiOut')).includes('ข้อ 1.1') && await p.isChecked(`#saCrit input[value="${i11}"]`));
    await (await p.$('#saForm')).screenshot({ path: path.join(SHOTS, 'staff-ach-ai.png') });
    await p.click('#saSubmit'); await p.waitForTimeout(800);
    check('ผลงาน: บันทึกแล้วกล่องมาตรฐานย่อกลับ', !(await p.$eval('#saCritFold', (d) => d.open)));
    const ai = (await calls(p, (c) => c.table === 'achievements' && c.op === 'insert'))[0]?.payload || {};
    check('ผลงาน: บันทึกข้อมาตรฐานที่เลือก (item_ids) + ไม่ส่งตรวจ (ไม่แตะ item_status)', ai.item_ids?.includes(i11) && ai.item_ids.includes(i21) && (await calls(p, isW)).length === isW0, JSON.stringify(ai));
    check('AI แนะนำ: ผลในฟอร์มผูกกับผลงานที่บันทึก → รายการขึ้น "AI: ตรงกับข้อ 1.1"', (await calls(p, (c) => c.rpc === 'ai_match_link')).length === 1 && (await text(p, '#saList')).includes('AI: ตรงกับข้อ 1.1'));
    const seedRow = await p.evaluate(() => [...document.querySelectorAll('#saList .newsrow')].findIndex((r) => r.textContent.includes('ตู้เย็นเก็บยา')));
    await p.click(`#saList .newsrow:nth-child(${seedRow + 1}) [data-ai-run]`); await p.waitForTimeout(400);
    check('AI ในรายการ: กดให้วิเคราะห์ → ด้านขวาขึ้น "AI กำลังวิเคราะห์…"', (await text(p, `#saList .newsrow:nth-child(${seedRow + 1}) .ai-st`)).includes('กำลังวิเคราะห์'));
    { const q = await open(null, '#/tracking'); await q.waitForTimeout(700);
      await q.click('#trkSums a.ach-poster:has-text("ตู้เย็นเก็บยา")'); await q.waitForTimeout(600);
      check('ผลงาน: กดจากแถวผลงาน → หน้าอ่านแบบข่าว (ชื่อ · รพ.สต. · วันที่ · รายละเอียด · ข้อมาตรฐานที่สอดคล้อง)', await visible(q, '[data-view="achievement"]') && (await text(q, '#acTitle')).includes('ตู้เย็นเก็บยา') && (await text(q, '#acTag')).includes('รพ.สต.') && (await text(q, '#acBody')).includes('2–8') && (await text(q, '#acCrit')).includes('ข้อ 1.3'));
      await q.screenshot({ path: path.join(SHOTS, 'achievement-1280.png'), fullPage: true });
      await q.close(); }
    { const q = await open('staff', '#/staff/achievements'); await q.waitForTimeout(500);
      const aid = await q.evaluate(() => window.__db.achievements.find((a) => a.title.includes('ตู้เย็นเก็บยา')).id);
      await q.click(`[data-hide="${aid}"]`); await q.waitForTimeout(400);
      check('ผลงาน: ระงับการแสดงได้ (ยังไม่ลบ · มีป้าย + ปุ่มแสดงอีกครั้ง)', await q.evaluate((id) => window.__db.achievements.find((a) => a.id === id)?.hidden === true, aid) && (await text(q, '#saList')).includes('ระงับการแสดง') && (await text(q, `[data-hide="${aid}"]`)).includes('แสดงอีกครั้ง'));
      await go(q, '#/tracking'); await q.waitForTimeout(600);
      check('ผลงาน: ที่ระงับไว้ไม่ขึ้นหน้าหลัก (ผลการดำเนินงาน)', !(await text(q, '#trkSums')).includes('ตู้เย็นเก็บยา'));
      await q.close(); }
    // ผลการดำเนินงาน: กดตัวเลข → DRPs แยกชนิด (ทุกคน · ตัวเลขรวม) / รายการเยี่ยม (เจ้าหน้าที่/ผู้ดูแลเท่านั้น)
    const visitFy = await p.evaluate(() => window.__db.visits.find((v) => (v.drps || []).length)?.fiscal_year);
    { const q = await open(null, '#/tracking'); await q.waitForTimeout(700);
      await q.click(`#trkYearTabs [data-y="${visitFy}"]`); await q.waitForTimeout(400);
      await q.click('#trkDrpsBtn'); await q.waitForTimeout(400);
      const rows = await q.$$eval('#trkDetail .drp-row', (rs) => rs.map((r) => +(r.textContent.match(/พบ (\d+)/) || [])[1]));
      check('ผลการดำเนินงาน: กด DRPs → แยกชนิด พบ/แก้ไขสำเร็จ เรียงมากไปน้อย (ไม่มีชื่อผู้ป่วย)', rows.length >= 1 && rows.join() === [...rows].sort((a, b) => b - a).join() && (await text(q, '#trkDetail')).includes('แก้ไขสำเร็จ') && !(await text(q, '#trkDetail')).includes('ประยูร'), JSON.stringify(rows));
      await q.setViewportSize({ width: 390, height: 900 }); await q.waitForTimeout(200);
      await (await q.$('#trkDetail')).screenshot({ path: path.join(SHOTS, 'tracking-drps-390.png') });
      check('ผลการดำเนินงาน: DRPs แยกชนิด 390px ไม่ล้นจอ', await overflow(q) <= 0);
      await q.setViewportSize({ width: 1280, height: 900 });
      await q.click('#trkVisitsBtn'); await q.waitForTimeout(400);
      check('ผลการดำเนินงาน: ประชาชนกดจำนวนการเยี่ยม → ไม่เห็นรายชื่อ (ให้เข้าสู่ระบบ)', (await text(q, '#trkDetail')).includes('เฉพาะเจ้าหน้าที่') && !(await q.$('#trkDetail .trk-visits')));
      await q.close(); }
    { const q = await open('staff', '#/tracking'); await q.waitForTimeout(700);
      await q.click(`#trkYearTabs [data-y="${visitFy}"]`); await q.waitForTimeout(400);
      const before = (await calls(q, (c) => c.rpc === 'log_patient_access')).length;
      await q.click('#trkVisitsBtn'); await q.waitForTimeout(500);
      check('ผลการดำเนินงาน: เจ้าหน้าที่กดจำนวนการเยี่ยม → เห็นรายการเยี่ยม (ชื่อ · วันที่) ของหน่วยตัวเอง + ลิงก์ไปบันทึก + บันทึกการเปิดดู (PDPA)', await count(q, '#trkDetail .trk-visits a.li') >= 1 && (await text(q, '#trkDetail')).includes('ประยูร') && (await q.getAttribute('#trkDetail .trk-visits a.li', 'href')).startsWith('#/staff/visits/') && (await calls(q, (c) => c.rpc === 'log_patient_access')).length > before && (await q.$$eval('#trkDetail .trk-visits .small', (s) => s.every((x) => x.textContent.includes('ทุ่งนุ้ย')))));
      await q.click('#trkVisitsBtn'); await q.waitForTimeout(200);
      check('ผลการดำเนินงาน: กดซ้ำ = ปิดรายละเอียด', !(await q.isVisible('#trkDetail')));
      await q.close(); }
    { const q = await open('staff', '#/staff/achievements', 390, 844); await q.waitForTimeout(300);
      await (await q.$('#saList')).screenshot({ path: path.join(SHOTS, 'staff-ach-list-390.png') });
      check('ผลงาน 390px: สถานะ AI ไม่ล้นจอ', await overflow(q) <= 0); await q.close(); }
    await p.waitForTimeout(6500);
    check('AI ในรายการ: รอสักครู่แล้วสถานะเปลี่ยนเป็นผลวิเคราะห์เอง (ไม่ต้องรีเฟรช)', !(await text(p, `#saList .newsrow:nth-child(${seedRow + 1}) .ai-st`)).includes('กำลังวิเคราะห์') && (await text(p, `#saList .newsrow:nth-child(${seedRow + 1}) .ai-st`)).includes('AI'));
    await go(p, '#/staff/criteria'); await p.waitForTimeout(400);
    await p.click(`[data-open="${i11}"]`); await p.waitForTimeout(200);
    check('มาตรฐาน: ผลงานที่เพิ่งเลือกแนบในข้อ 1.1 อัตโนมัติ + สถานะเดิมไม่เปลี่ยน', (await text(p, '.crit-editbox')).includes('ผลงาน: ผลงานผูกมาตรฐาน') && (await text(p, `#ci-${i11}`)).includes('ผ่านแล้ว'));
    { const q = await open('staff', '#/staff/criteria', 390, 844);
      await q.click(`[data-open="${i13}"]`); await q.waitForTimeout(300);
      await (await q.$(`#topic-1`)).screenshot({ path: path.join(SHOTS, 'staff-criteria-linked-390.png') });
      check('มาตรฐาน 390px: ป้ายผลงาน + การ์ดผลงานไม่ล้นจอ', await overflow(q) <= 0);
      await q.close(); }
    await go(p, '#/staff/visits'); await p.click('#ptAddBtn'); await p.waitForTimeout(150);
    check('ผู้ป่วย: มีช่องสังกัด รพ.สต. (ค่าเริ่มต้น = หน่วยตัวเอง) + ที่อยู่ + เบอร์โทร แทน HN รพ.สต.', !(await p.$('#pfHnU')) && (await p.$eval('#pfHome', (e) => e.value)) === '2' && !!(await p.$('#pfA_no')) && (await p.getAttribute('#pfDob', 'placeholder')).includes('12/5/1997'));
    check('ผู้ป่วย: ที่อยู่แยกช่อง เลขที่/หมู่/ตำบล/อำเภอ/จังหวัด/รหัสไปรษณีย์ (ค่าตั้งต้น ควนกาหลง · สตูล · 91130)', (await p.inputValue('#pfA_amphoe')) === 'ควนกาหลง' && (await p.inputValue('#pfA_province')) === 'สตูล' && (await p.inputValue('#pfA_zip')) === '91130' && !!(await p.$('#pfA_moo')) && !!(await p.$('#pfA_tambon')));
    await p.fill('#pfFirst', 'ทดสอบ'); await p.fill('#pfLast', 'วันเกิด'); await p.fill('#pfDob', '12/5/2540'); await p.fill('#pfPhone', '081-111-2222'); await p.fill('#pfA_no', '12/3'); await p.fill('#pfA_moo', '1'); await p.fill('#pfA_tambon', 'ทุ่งนุ้ย');
    check('ผู้ป่วย: 2 กล่อง วันเกิด + อายุ · กรอกวันเกิดแล้วอายุคำนวณให้', (await p.inputValue('#pfAge')) === String(await p.evaluate(() => { const n = new Date(); let a = n.getFullYear() - 1997; if (n < new Date(n.getFullYear(), 4, 12)) a--; return a; })), await p.inputValue('#pfAge'));
    check('ผู้ป่วย: ไม่ทราบวันเกิด → อายุที่กรอกนับเพิ่มตามปีที่ผ่านไป', await p.evaluate(async () => { const m = await import('./js/pages/visits.js?v=4.4'); const y = new Date().getFullYear() - 2020 - (new Date() < new Date(new Date().getFullYear(), 0, 1) ? 1 : 0); return m.ageOf({ age_years: 30, age_at: '2020-01-01' }) === 30 + y && m.ageOf({ birth_date: null, age_years: null }) === ''; }));
    await p.click('#ptForm [type=submit]'); await p.waitForTimeout(500);
    const pt = (await calls(p, (c) => c.table === 'patients' && c.op === 'insert'))[0]?.payload || {};
    check('ผู้ป่วย: มีวันเกิด → ไม่เก็บอายุซ้ำ (age_years ว่าง)', pt.age_years === null && pt.age_at === null, JSON.stringify(pt));
    check('ผู้ป่วย: วันเกิด 12/5/2540 (พ.ศ.) → 1997-05-12 + บันทึกเบอร์/ที่อยู่', pt.birth_date === '1997-05-12' && pt.phone === '081-111-2222' && pt.home_unit_id === 2, JSON.stringify(pt));
    check('ผู้ป่วย: ที่อยู่เก็บแยกช่อง + ประกอบเป็นที่อยู่เต็ม', pt.address === 'เลขที่ 12/3 หมู่ 1 ต.ทุ่งนุ้ย อ.ควนกาหลง จ.สตูล 91130' && pt.address_parts?.zip === '91130' && pt.address_parts?.moo === '1', JSON.stringify(pt.address_parts));
    await p.click('[data-act="add-visit"]'); await p.waitForTimeout(150);
    check('เยี่ยมบ้าน: หน่วยยา เม็ด/ขวด/หลอด/(ไม่ระบุ)', (await p.$$eval('#vMeds .med-unit option', (o) => o.map((x) => x.value).join(','))) === 'เม็ด,ขวด,หลอด,(ไม่ระบุ)');
    check('เยี่ยมบ้าน: ไม่มีช่อง Medication reconciliation / นัดครั้งถัดไป · มีช่องชีพจร · ป้าย "ยาเหลือค้างที่บ้านเกินวันนัด 1 เดือน" (ติ๊กเอง)', !(await p.$('#vRecon')) && !(await p.$('#vNext')) && await visible(p, '#vPulse') && (await text(p, '#vForm')).includes('ยาเหลือค้างที่บ้านเกินวันนัด 1 เดือน'));
    check('เยี่ยมบ้าน: Medication reconciliation อยู่ใต้ O (Objective) ก่อน A (Assessment)', await p.evaluate(() => { const o = document.querySelector('#vO').closest('.field'), m = document.querySelector('#vMeds').closest('fieldset'), a = document.querySelector('#vA').closest('.field'); return o.nextElementSibling === m && m.nextElementSibling === a; }));
    await p.fill('#vPulse', '78'); await p.check('#vExcess');
    await p.fill('#vO', 'ผิวแห้ง ไม่บวม'); await p.fill('#vA', 'ใช้ยาไม่สม่ำเสมอ'); await p.fill('#vMeds .med-name', 'เมทฟอร์มิน'); await p.fill('#vMeds .med-how', '1 เม็ด หลังอาหารเช้า'); await p.fill('#vMedNote', 'เก็บในตู้เย็น'); await p.check('#vNoDrp');
    await p.setInputFiles('#vPhotos', [img, { ...img, name: 'b.png' }]); await p.waitForTimeout(500);
    check('เยี่ยมบ้าน: เลือกรูปแล้วเห็นตัวอย่าง', await count(p, '#vPhotoList .fthumb img') === 2);
    check('เยี่ยมบ้าน: ไม่มีช่อง "ยาพอถึงวันที่" แล้ว', !(await p.$('#vMedUntil')));
    { const vp = p.viewportSize(); await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(150);
      check('เยี่ยมบ้าน (มือถือ): ฟอร์มไม่ล้นจอ', await overflow(p) <= 0); await (await p.$('#vForm')).screenshot({ path: path.join(SHOTS, 'visit-form-390.png') }); await p.setViewportSize(vp); }
    await p.click('#vForm [type=submit]'); await p.waitForTimeout(600);
    const vi = (await calls(p, (c) => c.table === 'visits' && c.op === 'insert'))[0]?.payload || {};
    check('เยี่ยมบ้าน: มีช่อง O — Objective data และบันทึกได้', vi.objective === 'ผิวแห้ง ไม่บวม');
    check('เยี่ยมบ้าน: บันทึกชีพจร + ติ๊กยาเหลือค้างเกินวันนัดเอง (ไม่ส่งช่องที่เอาออก)', vi.pulse === 78 && vi.med_excess === true && !('med_reconcile' in vi) && !('next_appt' in vi) && (await text(p, '#ptPanel')).includes('ชีพจร 78') && (await text(p, '#ptPanel')).includes('เกินวันนัด 1 เดือน'), JSON.stringify(vi));
    check('เยี่ยมบ้าน: มีช่อง A — Assessment และบันทึกได้', vi.assessment === 'ใช้ยาไม่สม่ำเสมอ' && (await text(p, '#ptPanel')).includes('A: ใช้ยาไม่สม่ำเสมอ'));
    check('เยี่ยมบ้าน: ใส่วิธีใช้หลังชื่อยาได้ + แสดงในบันทึก', vi.med_list?.[0]?.how === '1 เม็ด หลังอาหารเช้า' && (await text(p, '#ptPanel')).includes('1 เม็ด หลังอาหารเช้า'), JSON.stringify(vi.med_list));
    check('เยี่ยมบ้าน: บันทึกหมายเหตุรายการยา + รูป 2 รูป (ส่วนตัว)', vi.med_note === 'เก็บในตู้เย็น' && vi.photo_paths?.length === 2 && (await calls(p, (c) => c.upload === 'visit-photos')).length === 2, JSON.stringify(vi));
    check('เยี่ยมบ้าน: รูปแสดงในบันทึกการเยี่ยม', await count(p, '#ptPanel .visit-photos img') === 2);
    await p.click('[data-edit-visit]'); await p.waitForTimeout(300);
    await p.setInputFiles('#vPhotos', [img, img, img, img]); await p.waitForTimeout(700);
    check('เยี่ยมบ้าน: จำกัดไม่เกิน 5 รูป', await count(p, '#vPhotoList .fthumb') === 5 && await p.$eval('#vPhotos', (e) => e.disabled));
    await p.click('[data-act="cancel"]'); await p.waitForTimeout(200);
    { const before = await count(p, '#ptList [data-pt]'), pid = await p.evaluate(() => window.__db.patients.find((x) => x.first_name === 'ทดสอบ')?.id);
      if ((await p.getAttribute(`#ptList [data-pt="${pid}"]`, 'aria-expanded')) !== 'true') { await p.click(`#ptList [data-pt="${pid}"]`); await p.waitForTimeout(300); }   // กดซ้ำ = ย่อ
      await p.click('[data-act="edit-patient"]'); await p.waitForTimeout(150);
      await p.fill('#pfPhone', '0812223333');
      await p.click('[data-edit-visit]'); await p.waitForTimeout(200);
      check('ผู้ป่วย: กดแก้ไขบันทึกเยี่ยมแล้ว ฟอร์มแก้ไขข้อมูลผู้ป่วยยังค้างอยู่ (ข้อมูลที่พิมพ์ไม่หาย)', await visible(p, '#vForm') && await p.isVisible('#pfPhone') && (await p.inputValue('#pfPhone')) === '0812223333');
      await p.click('#ptEditFold > summary'); await p.waitForTimeout(100);
      check('ผู้ป่วย: ย่อฟอร์มแก้ไขข้อมูลเหลือชื่อสั้น ๆ (ฟอร์มบันทึกเยี่ยมยังเปิดอยู่)', !(await p.isVisible('#pfFirst')) && (await p.textContent('#ptEditFold > summary')).includes('ทดสอบ วันเกิด') && await visible(p, '#vForm'));
      await p.click('#ptEditFold > summary'); await p.waitForTimeout(100);
      await p.click('[data-act="edit-patient"]'); await p.waitForTimeout(100);
      check('ผู้ป่วย: กด "แก้ไขข้อมูล" ซ้ำ = ย่อฟอร์มแก้ไขลง (กดอีกครั้งขยาย · ข้อมูลไม่หาย)', !(await p.$eval('#ptEditFold', (d) => d.open)) && (await p.inputValue('#pfPhone')) === '0812223333');
      await p.click('[data-act="edit-patient"]'); await p.waitForTimeout(100);
      check('ผู้ป่วย: กด "แก้ไขข้อมูล" อีกครั้ง = ขยายฟอร์มกลับ', await p.$eval('#ptEditFold', (d) => d.open) && await p.isVisible('#pfFirst'));
      await p.click('#vForm [data-act="cancel"]'); await p.waitForTimeout(100);
      check('ผู้ป่วย: ปิดฟอร์มบันทึกเยี่ยมแล้ว ฟอร์มแก้ไขข้อมูลผู้ป่วยยังอยู่', !(await p.$('#vForm')) && (await p.inputValue('#pfPhone')) === '0812223333');
      check('ผู้ป่วย: แก้ไขแล้วที่อยู่เดิมขึ้นในช่องย่อย', (await p.inputValue('#pfA_tambon')) === 'ทุ่งนุ้ย' && (await p.inputValue('#pfA_no')) === '12/3');
      await p.selectOption('#pfHome', '3'); await p.click('#ptForm [type=submit]'); await p.waitForTimeout(500);
      const tr = (await calls(p, (c) => c.rpc === 'transfer_patient'))[0]?.args || {};
      check('ผู้ป่วย: เปลี่ยนสังกัด → ย้ายไปอยู่รายชื่อของ รพ.สต. นั้น (หายจากหน่วยเดิม)', tr.p_patient === pid && tr.p_unit === 3 && await count(p, '#ptList [data-pt]') === before - 1
        && await p.evaluate((id) => { const x = window.__db.patients.find((y) => y.id === id); return x.unit_id === 3 && window.__db.visits.filter((v) => v.patient_id === id).every((v) => v.unit_id === 3); }, pid), JSON.stringify(tr)); }
    await go(p, '#/staff/messages'); await p.click('#staffInboxSlot [data-conv="00000000-0000-0000-0000-0000000c0001"]'); await p.waitForTimeout(400);
    await p.setInputFiles('#staffInboxSlot .ib-file', img); await p.waitForTimeout(400);
    check('แชทเจ้าหน้าที่: เลือกรูปแล้วเห็นตัวอย่างก่อนส่ง', await visible(p, '#staffInboxSlot .chat-pick img'));
    await p.click('#staffInboxSlot .ib-send'); await p.waitForTimeout(500);
    check('แชทเจ้าหน้าที่: ส่งรูปได้ (ไม่ต้องพิมพ์ข้อความ) + แสดงในห้อง', (await calls(p, (c) => c.upload === 'chat-images')).length === 1 && await count(p, '#staffInboxSlot .bubble .chat-img img') === 1);
    await p.screenshot({ path: path.join(SHOTS, 'staff-chat-image-1280.png') });
    await p.close();

    p = await open('citizen', '#/me');
    await p.setInputFiles('#meFile', img); await p.waitForTimeout(400); await p.fill('#meInput', 'ยานี้กินตอนไหน'); await p.click('#meSend'); await p.waitForTimeout(500);
    const mi = (await calls(p, (c) => c.table === 'messages' && c.op === 'insert'))[0]?.payload || {};
    check('แชทประชาชน: ส่งรูปพร้อมข้อความได้', mi.body === 'ยานี้กินตอนไหน' && /^[0-9a-f-]{36}\/.+\.webp$/.test(mi.image_path || ''), JSON.stringify(mi));
    check('แชทประชาชน: รูปแสดงในห้องแชท', await count(p, '#meLog .chat-img img') === 1);
    await p.screenshot({ path: path.join(SHOTS, 'citizen-chat-image-390.png') });
    await p.close();

    p = await open('admin', '#/admin/review');
    await p.click('#rvUnits [data-u="3"]'); await p.waitForTimeout(250);
    const [r3, r4] = [await itemId(p, '1.3'), await itemId(p, '2.1.1')];
    await p.click(`[data-open="${r3}"]`); await p.waitForTimeout(150); await p.click('.crit-editbox [data-set="approved"]'); await p.waitForTimeout(400);
    await p.click(`#rv-${r3} [data-undo]`); await p.waitForTimeout(400);
    check('ตรวจประเมิน: ย้อนกลับการให้ผ่านได้', await p.evaluate((id) => window.__db.item_status.find((x) => x.item_id === id && x.unit_id === 3)?.status === 'submitted', r3));
    await p.click(`[data-open="${r4}"]`); await p.waitForTimeout(150);
    await p.fill('#rvComment', 'ดูตัวอย่างที่แนบ'); await p.setInputFiles('#rvFiles', pdf); await p.waitForTimeout(150);
    check('ตรวจประเมิน: เลือกไฟล์แนบกลับแล้วเห็นตัวอย่าง', await count(p, '#rvPreview .fthumb') === 1);
    await p.click('.crit-editbox [data-set="fix"]'); await p.waitForTimeout(500);
    const rv = await p.evaluate((id) => window.__db.item_status.find((x) => x.item_id === id && x.unit_id === 3), r4);
    check('ตรวจประเมิน: ขอแก้ไขพร้อมแนบไฟล์กลับ', rv.status === 'fix' && rv.review_files?.length === 1, JSON.stringify(rv));
    await p.click(`#rv-${r4} [data-undo]`); await p.waitForTimeout(400);
    check('ตรวจประเมิน: ย้อนกลับการขอแก้ไขได้', await p.evaluate((id) => window.__db.item_status.find((x) => x.item_id === id && x.unit_id === 3)?.status === 'submitted', r4));
    { const st = (id) => p.evaluate((i) => window.__db.item_status.find((x) => x.item_id === i && x.unit_id === 3), id);
      { await p.click('#rvUnits [data-u="2"]'); await p.waitForTimeout(200);
        const [a11, a12] = [await itemId(p, '1.1'), await itemId(p, '1.2')];
        check('ตรวจประเมิน: ข้อ "ผ่านแล้ว"/"ต้องแก้ไข" ก็ยกเลิกคำขอตรวจได้ · ข้อที่ยังไม่ส่งไม่มีปุ่ม', await visible(p, `#rv-${a11} [data-trash]`) && await visible(p, `#rv-${a12} [data-trash]`) && await count(p, '#rvBody .crit-item [data-trash]') === 2);
        await p.click(`[data-open="${a12}"]`); await p.waitForTimeout(150);
        check('ตรวจประเมิน: ปุ่มยกเลิกคำขอตรวจอยู่ในกล่องตรวจด้วย', await visible(p, '.crit-editbox [data-trash]'));
        await p.click('.crit-editbox [data-trash]'); await p.waitForTimeout(400);
        check('ตรวจประเมิน: ยกเลิกข้อ "ต้องแก้ไข" → ถังขยะ ปุ่มกู้คืนบอกสถานะเดิม', (await text(p, '#rvTrash')).includes('กู้คืน (ต้องแก้ไข)'));
        await p.click('#rvTrash [data-restore]'); await p.waitForTimeout(400);
        check('ตรวจประเมิน: กู้คืน → กลับเป็น "ต้องแก้ไข"', await p.evaluate((i) => window.__db.item_status.find((x) => x.item_id === i && x.unit_id === 2)?.status === 'fix', a12));
        await p.click('#rvUnits [data-u="3"]'); await p.waitForTimeout(200); }
      check('ตรวจประเมิน: รายการรอตรวจมีปุ่ม "ยกเลิกคำขอตรวจ" + ถังขยะด้านล่าง (ว่าง)', await visible(p, `#rv-${r4} [data-trash]`) && (await text(p, '#rvTrash')).includes('ไม่มีรายการ'));
      await p.click(`#rv-${r4} [data-trash]`); await p.waitForTimeout(400);
      let s4 = await st(r4);
      check('ตรวจประเมิน: ยกเลิกคำขอตรวจ → ย้ายไปถังขยะ (สถานะยังไม่ส่ง · รายละเอียด/ไฟล์ยังอยู่ · บอกวันที่เหลือ 30 วัน)', s4.status === 'none' && !!s4.trashed_at && s4.evidence_paths?.length === 1 && (await text(p, '#rvTrash')).includes('2.1.1') && (await text(p, '#rvTrash')).includes('อีก 30 วัน') && (await text(p, `#rv-${r4}`)).includes('ยังไม่ส่ง'), JSON.stringify(s4));
      await p.screenshot({ path: path.join(SHOTS, 'admin-review-trash-1280.png'), fullPage: true });
      { const q = await open('staff3', '#/staff/criteria'); await q.waitForTimeout(400);   // คนละหน้า = ฐานข้อมูลจำลองคนละชุด → ตั้งสถานะในถังเอง
        await q.evaluate((i) => Object.assign(window.__db.item_status.find((x) => x.item_id === i && x.unit_id === 3), { status: 'none', trashed_status: 'submitted', trashed_at: new Date().toISOString() }), r4);
        await go(q, '#/'); await go(q, '#/staff/criteria');
        await q.evaluate(() => { document.getElementById('topic-2').open = true; });
        await q.click(`[data-open="${r4}"]`); await q.waitForTimeout(200);
        check('เจ้าหน้าที่: เห็นว่าผู้ดูแลยกเลิกคำขอตรวจ + ส่งใหม่ได้', (await text(q, '.crit-editbox')).includes('ผู้ดูแลยกเลิกคำขอตรวจนี้แล้ว') && await visible(q, '#ev-detail'));
        await q.close(); }
      await p.click(`#rvTrash [data-restore="${s4.id}"]`); await p.waitForTimeout(400);
      s4 = await st(r4);
      check('ตรวจประเมิน: กู้คืนจากถังขยะ → กลับไปรอตรวจ', s4.status === 'submitted' && !s4.trashed_at && (await text(p, '#rvTrash')).includes('ไม่มีรายการ'), JSON.stringify(s4));
      await p.click(`#rv-${r4} [data-trash]`); await p.waitForTimeout(400);
      await p.click(`#rvTrash [data-purge="${s4.id}"]`); await p.waitForTimeout(400);
      s4 = await st(r4);
      check('ตรวจประเมิน: ลบถาวรจากถังขยะ → ล้างรายละเอียด/ไฟล์ + ลบไฟล์ใน storage', s4.status === 'none' && !s4.trashed_at && !s4.detail && !s4.evidence_paths.length && (await calls(p, (c) => c.remove === 'evidence' && c.paths.some((x) => x.includes('/3/2.1.1/')))).length === 1, JSON.stringify(s4));
      await p.click(`#rv-${r3} [data-trash]`); await p.waitForTimeout(400);
      await p.evaluate((i) => { window.__db.item_status.find((x) => x.item_id === i && x.unit_id === 3).trashed_at = new Date(Date.now() - 31 * 86400000).toISOString(); }, r3);
      await p.click('#rvYears [aria-current="true"]'); await p.waitForTimeout(500);
      const s3 = await st(r3);
      check('ตรวจประเมิน: ถังขยะครบ 30 วัน → ลบถาวรให้เอง', !s3.trashed_at && !s3.detail && !s3.evidence_paths.length && (await text(p, '#rvTrash')).includes('ไม่มีรายการ'), JSON.stringify(s3)); }
    await p.click('[data-hideyear="1"]'); await p.waitForTimeout(400);
    check('ปีงบ: ซ่อนปีงบได้ (แสดง "ซ่อนอยู่")', (await text(p, '#rvYears')).includes('ซ่อนอยู่') && await visible(p, '[data-hideyear="0"]'));
    await p.click('[data-hideyear="0"]'); await p.waitForTimeout(400);
    check('ปีงบ: มีปุ่มลบปีงบ (ปีปัจจุบัน/ปีถัดไป)', await visible(p, '[data-delyear]'));
    await p.click('#rvUnits [data-u="2"]'); await p.waitForTimeout(250);
    const r13 = await itemId(p, '1.3');
    await p.click(`[data-open="${r13}"]`); await p.waitForTimeout(200);
    check('ตรวจประเมิน: ผู้ดูแลเห็นผลงานที่ รพ.สต. ผูกกับข้อมาตรฐานเป็นหลักฐาน', (await text(p, `#rv-${r13}`)).includes('ผลงาน 1') && (await text(p, '.crit-editbox')).includes('ผลงาน: ตู้เย็นเก็บยาได้มาตรฐาน'));
    await p.click('#rvUnits [data-u="crit"]'); await p.waitForTimeout(300);
    const t0 = await p.$eval('.topic-title', (e) => e.value);
    await p.fill('.topic-title', t0 + ' (แก้)'); await p.click('#critSave'); await p.waitForTimeout(500);
    check('แก้เกณฑ์: แก้ชื่อข้อใหญ่ได้', (await calls(p, (c) => c.table === 'criteria_items' && c.op === 'update' && c.payload?.topic_title)).length === 1);
    await p.fill('.add-sub .new-sub', 'หัวข้อย่อยใหม่'); await p.fill('.add-sub .new-sub-item', 'ข้อใหม่'); await p.click('[data-addsub]'); await p.waitForTimeout(500);
    await p.fill('#ntTitle', 'ข้อใหญ่ใหม่'); await p.fill('#ntItem', 'ข้อแรก'); await p.click('[data-addtopic]'); await p.waitForTimeout(500);
    const ci = (await calls(p, (c) => c.table === 'criteria_items' && c.op === 'insert')).map((c) => c.payload);
    check('แก้เกณฑ์: เพิ่มหัวข้อย่อย + เพิ่มข้อใหญ่ได้', ci.length === 2 && ci[1].topic_title.endsWith('ข้อใหญ่ใหม่') && ci[1].item_no.endsWith('.1.1'), JSON.stringify(ci));
    await p.click('[data-delsub]'); await p.waitForTimeout(500);
    check('แก้เกณฑ์: ลบหัวข้อย่อยได้', (await calls(p, (c) => c.table === 'criteria_items' && c.op === 'delete')).length === 1);
    await p.setInputFiles('.sub-edit [data-addsample]', pdf); await p.waitForTimeout(600);
    check('แก้เกณฑ์: แนบไฟล์ตัวอย่างหลักฐานได้', (await calls(p, (c) => c.upload === 'criteria-samples')).length === 1 && (await calls(p, (c) => c.table === 'criteria_items' && c.op === 'update' && c.payload?.evidence_samples)).length === 1 && await count(p, '.samples-edit .fthumb') >= 1);
    await p.screenshot({ path: path.join(SHOTS, 'admin-criteria-editor-1280.png'), fullPage: true });
    await go(p, '#/admin/news');
    await p.fill('#anTitle', 'ข่าวผู้ดูแลมี PDF'); await p.fill('#anBody', 'x'); await p.setInputFiles('#anFile', pdf); await p.click('#anSubmit'); await p.waitForTimeout(600);
    const nid = await p.evaluate(() => window.__db.news.find((n) => n.title === 'ข่าวผู้ดูแลมี PDF')?.id);
    await go(p, '#/news/' + nid); await p.waitForTimeout(300);
    check('อ่านข่าว: มีปุ่มดาวน์โหลด PDF แนบ', await visible(p, '#arFile .file-link') && (await text(p, '#arFile')).includes('คู่มือ.pdf'));
    await p.close();

    /* ================= มือถือ / แท็บเล็ต ================= */
    for (const [role, hash, name] of [[null, '', 'home'], ['citizen', '#/me', 'me'], ['staff', '#/staff/visits', 'staff-visits'], ['staff', '#/staff/messages', 'staff-messages'], ['admin', '#/admin/review', 'admin-review'], ['admin', '#/admin/settings/staff', 'admin-roster'], ['admin', '#/admin/settings/audit', 'admin-audit'], ['staff', '#/staff/news', 'staff-news'], ['staff', '#/staff/criteria', 'staff-criteria']]) {
      for (const w of [390, 768]) {
        p = await open(role, hash, w, 900);
        const ov = await overflow(p);
        check(`จอ ${w}px ${name}: ไม่ล้นจอด้านข้าง`, ov <= 0, `ล้น ${ov}px`);
        await p.screenshot({ path: path.join(SHOTS, `${name}-${w}.png`) });
        await p.close();
      }
    }
    p = await open('admin', '#/admin/news', 1280, 900);
    await p.screenshot({ path: path.join(SHOTS, 'admin-news-1280.png'), fullPage: true });
    await p.close();
    p = await open('admin', '#/admin/settings/audit', 1280, 900);
    await p.screenshot({ path: path.join(SHOTS, 'admin-audit-1280.png'), fullPage: true });
    await p.close();

    /* ================= หน้าตัวอย่างสำหรับ comment (tools/preview/build.py → Claude Artifact) ================= */
    execFileSync('python3', [path.join(ROOT, 'tools/preview/build.py'), path.join(ROOT, '_preview')]);
    for (const w of [390, 1280]) {
      p = await browser.newPage({ viewport: { width: w, height: 900 } });
      const tag = `[preview ${w}]`;
      p.on('pageerror', (e) => errors.push(`${tag} ${e.message}`));
      p.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_|net::/.test(m.text())) errors.push(`${tag} console: ${m.text()}`); });
      await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      const ext = []; p.on('request', (r) => { if (!/^http:\/\/127\.0\.0\.1|fonts\.(googleapis|gstatic)\.com|^data:/.test(r.url())) ext.push(r.url()); });
      await p.goto(`http://127.0.0.1:${port}/_preview/local.html`); await p.waitForTimeout(800);
      check(`หน้าตัวอย่าง ${w}px: หน้าแรกโหลดด้วยข้อมูลสมมติ`, await count(p, '#slides .slide') > 0 && (await text(p, '#pvBar')).includes('หน้าตัวอย่าง'));
      await p.click('[data-pv-role="admin"]'); await p.waitForTimeout(900);
      check(`หน้าตัวอย่าง ${w}px: สลับเป็นผู้ดูแลได้`, await visible(p, '[data-view="admin"]') && (await text(p, '#pvRoute')).startsWith('#/admin'));
      await go(p, '#/admin/visits'); await p.click('#avUnits [data-u="2"]'); await p.waitForTimeout(300);
      await p.click('#ptList [data-pt]'); await p.waitForTimeout(300); await p.click('[data-act="del-patient"]'); await p.waitForTimeout(400);
      check(`หน้าตัวอย่าง ${w}px: ปุ่มที่ต้องยืนยันใช้ได้ (confirm อัตโนมัติ)`, await count(p, '#ptList [data-pt]') === 0);
      const html = await p.content();
      check(`หน้าตัวอย่าง ${w}px: ไม่มีชื่อ/เบอร์จริง + ไม่เรียกเซิร์ฟเวอร์ภายนอก`, !/ควนกาหลง|สตูล|ทุ่งนุ้ย|074-752-081/.test(html) && ext.length === 0, ext.slice(0, 3).join(' '));
      check(`หน้าตัวอย่าง ${w}px: ไม่ล้นจอด้านข้าง`, await overflow(p) <= 0);
      await p.click('[data-pv-role=""]'); await p.waitForTimeout(900);
      check(`หน้าตัวอย่าง ${w}px: กลับเป็นผู้เยี่ยมชมได้`, (await text(p, '#topNav')).includes('เข้าสู่ระบบ'));
      await p.screenshot({ path: path.join(SHOTS, `preview-${w}.png`) });
      await p.close();
    }
  } catch (e) {
    check('สคริปต์ทดสอบทำงานจนจบ', false, e.message.split('\n')[0]);
  }
  check('ไม่มี JavaScript error ระหว่างทดสอบ', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  server.kill();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nUI: ${results.length - failed.length} passed, ${failed.length} failed · ภาพหน้าจอ: tests/ui/shots/`);
  process.exit(failed.length ? 1 : 0);
})();
