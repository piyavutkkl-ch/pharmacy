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
  const go = async (p, hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(450); };
  const text = (p, s) => p.$eval(s, (e) => e.innerText).catch(() => '');
  const count = (p, s) => p.$$eval(s, (x) => x.length).catch(() => 0);
  const visible = (p, s) => p.$eval(s, (e) => !e.hidden && e.offsetParent !== null).catch(() => false);
  const calls = (p, pred) => p.evaluate(() => window.__calls).then((c) => c.filter(pred));
  const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  try {
    /* ================= ผู้เยี่ยมชม (ไม่ login) ================= */
    let p = await open(null);
    check('หน้าแรก: สไลด์ข่าวแสดง', await count(p, '#slides .slide') > 0);
    check('หน้าแรก: เมนูมีปุ่มเข้าสู่ระบบ', (await text(p, '#topNav')).includes('เข้าสู่ระบบ'));
    check('ท้ายเว็บ: ลิงก์ผลงาน/ช่องทางติดต่อ เป็นกล่องมีไอคอน (หน้าหลัก)', await count(p, '.footer-card .fc-ic svg') === 2 && await visible(p, '.footer-cards'));
    check('ท้ายเว็บ: นโยบาย/ข้อตกลง อยู่ใต้ช่องส่งความคิดเห็น', await p.$eval('.footer-legal', (e) => !!e.closest('.footer-col')?.querySelector('#fbForm') && e.querySelectorAll('a[href="privacy.html"],a[href="terms.html"]').length === 2));
    await p.click('[data-panel-link="news"]'); await p.waitForTimeout(300);
    check('ข่าว: การ์ดข่าวแสดง (เฉพาะที่เผยแพร่)', await count(p, '#newsGrid .news-card') === 3, String(await count(p, '#newsGrid .news-card')));
    await p.click('[data-panel-link="dose"]'); await p.waitForTimeout(300);
    await p.fill('#doseWeight', '20'); await p.waitForTimeout(150);
    check('คำนวณโดสยา: แสดงผลเป็นมิลลิกรัม', (await text(p, '#doseResult')).includes('มก.'));
    await p.click('[data-panel-link="tracking"]'); await p.waitForTimeout(300);
    check('ผลการดำเนินงาน: ตัวเลขแสดง', (await text(p, '#trkVisits')).trim() !== '');
    await p.click('[data-panel-link="delivery"]'); await p.waitForTimeout(400);
    check('บริการจัดส่งยาถึงบ้าน: ช่องใต้ผลการดำเนินงาน + ข้อความแนะนำ + สถิติการจัดส่ง', await visible(p, '[data-panel="delivery"]') && (await text(p, '#dlInfo')).includes('จัดส่งยาถึงบ้าน') && (await text(p, '#dlFigs')).includes('105') && await count(p, '#dlBars .bar-row') === 3
      && await p.evaluate(() => { const l = [...document.querySelectorAll('.menu-icons [data-panel-link]')].map((a) => a.dataset.panelLink); return l.indexOf('delivery') === l.indexOf('tracking') + 1; }));
    await go(p, '#/achievements');
    check('ผลงาน รพ.สต.: การ์ดผลงานแสดง', await count(p, '#achGrid .news-card') >= 2);
    await go(p, '#/contact');
    check('ช่องทางติดต่อ: ครบ 7 รพ.สต.', await count(p, '#contactGrid .center') === 7);
    const newsId = await p.evaluate(() => window.__db.news.find((n) => n.status === 'published' && !n.comments_closed).id);
    await go(p, '#/news/' + newsId);
    check('อ่านข่าว: หัวข้อ + ปุ่มถูกใจ + ชวน login ก่อนแสดงความคิดเห็น', (await text(p, '#arTitle')) && await visible(p, '#arLikeBtn') && await visible(p, '#arCommentLogin'));
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
    check('ประชาชน: เลือกปลายทางแชทได้ (ห้องยา + 7 รพ.สต.)', await count(p, '#meTargets [data-t]') === 8);
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
    await p.close();

    /* ================= เจ้าหน้าที่ รพ.สต. ================= */
    p = await open('staff', '#/staff');
    for (const tab of ['news', 'criteria', 'visits', 'messages', 'achievements', 'docs', 'feedback']) {
      await go(p, '#/staff/' + tab); await p.waitForTimeout(250);
      const shown = await p.$eval(`[data-staff-view="${tab}"]`, (e) => !e.hidden && e.innerText.trim().length > 0).catch(() => false);
      check(`เจ้าหน้าที่: เมนู ${tab} เปิดได้`, shown && (await text(p, '#staffViewTitle')));
    }
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
    check('เจ้าหน้าที่: เปิดรายชื่อ + เปิดดูผู้ป่วย ถูกบันทึก (PDPA)', logs.some((c) => c.args.p_unit === 2 && !c.args.p_patient) && logs.some((c) => c.args.p_patient));
    check('เจ้าหน้าที่: มีข้อความแจ้งว่าการเข้าถึงถูกบันทึก', (await text(p, '.pdpa-note')).includes('PDPA'));
    await go(p, '#/staff/docs');
    check('เจ้าหน้าที่: เอกสารเห็นเฉพาะทุกหน่วย + หน่วยตัวเอง', await count(p, '#sdList .li') === 2, String(await count(p, '#sdList .li')));
    await p.click('#sdList [data-dl]'); await p.waitForTimeout(400);
    check('เอกสาร: ดาวน์โหลดแล้วนับจำนวน + แสดงจำนวนครั้ง', (await calls(p, (c) => c.rpc === 'bump_doc_download')).length === 1 && (await text(p, '#sdList')).includes('ดาวน์โหลด 1 ครั้ง'));
    await p.fill('#sdQ', 'ไม่มีเอกสารชื่อนี้'); await p.waitForTimeout(150);
    check('เอกสาร: ค้นหาชื่อ (ไม่พบ → แจ้ง)', (await text(p, '#sdList')).includes('ไม่พบเอกสาร'));
    await p.fill('#sdQ', ''); await p.selectOption('#sdSort', 'title_asc'); await p.waitForTimeout(150);
    const titles = await p.$$eval('#sdList .li b', (b) => b.map((x) => x.textContent));
    check('เอกสาร: เรียงตามชื่อได้', titles.join('|') === [...titles].sort((a, b) => a.localeCompare(b, 'th')).join('|') && titles.length === 2);
    await go(p, '#/staff/messages');
    await p.click('#staffInboxSlot [data-conv]'); await p.waitForTimeout(400);
    await p.fill('#staffInboxSlot .ib-input', 'ตอบกลับจากเจ้าหน้าที่'); await p.click('#staffInboxSlot .ib-form button'); await p.waitForTimeout(400);
    check('เจ้าหน้าที่: ตอบแชทประชาชนได้', (await calls(p, (c) => c.table === 'messages' && c.op === 'insert')).length === 1);
    await p.close();

    /* ================= ผู้ดูแล ================= */
    p = await open('admin', '#/admin');
    for (const tab of ['news', 'messages', 'review', 'visits', 'docs', 'settings/feedback', 'settings/dose', 'settings/contacts', 'settings/staff', 'settings/audit']) {
      await go(p, '#/admin/' + tab); await p.waitForTimeout(250);
      const view = tab.split('/')[0];
      const shown = await p.$eval(`[data-admin-view="${view}"]`, (e) => !e.hidden && e.innerText.trim().length > 0).catch(() => false);
      check(`ผู้ดูแล: เมนู ${tab} เปิดได้`, shown && (await text(p, '#adminViewTitle')));
    }
    check('ข่าว (ผู้ดูแล): กล่องรอตรวจอยู่ใต้กล่องเขียนข่าว', await p.$eval('[data-admin-view="news"]', (v) => [...v.children].findIndex((c) => c.querySelector('#anForm')) < [...v.children].findIndex((c) => c.querySelector('#anQueue'))));
    check('ท้ายเว็บ: ลิงก์ผลงาน/ช่องทางติดต่อ ไม่แสดงในหน้าผู้ดูแล', !(await visible(p, '.footer-cards')));
    check('เมนูผู้ดูแล: ข้อความอยู่เหนือตรวจประเมิน + ข้อเสนอแนะย้ายไปอยู่ในตั้งค่า', (await p.$$eval('.sidenav [data-admin-tab]', (a) => a.map((x) => x.dataset.adminTab).join(','))) === 'news,messages,review,visits,docs,settings' && await count(p, '#afList .li') > 0);
    await go(p, '#/admin/feedback'); await p.waitForTimeout(250);
    check('ลิงก์เดิม #/admin/feedback ยังเปิดได้ (พาไปตั้งค่า)', (await p.evaluate(() => location.hash)) === '#/admin/settings/feedback');
    await go(p, '#/admin/news');
    await p.click('#anQueue [data-review]'); await p.waitForTimeout(200);
    await p.click('[data-decide="published"]'); await p.waitForTimeout(400);
    check('ผู้ดูแล: อนุมัติข่าวรอตรวจ → เผยแพร่', await p.evaluate(() => window.__db.news.every((n) => n.status !== 'pending')));
    const pub0 = await count(p, '#anList [data-unpub]');
    await p.click('#anList [data-unpub]'); await p.waitForTimeout(500);
    check('ข่าว: หยุดเผยแพร่ → ไปอยู่ในถังข่าว', await count(p, '#anList [data-unpub]') === pub0 - 1 && await count(p, '#anTrash [data-restore]') === 1 && (await text(p, '#anTrash')).includes('ลบถาวรในอีก 30 วัน'));
    await p.click('#anTrash [data-restore]'); await p.waitForTimeout(500);
    check('ข่าว: เรียกคืนแล้วกลับมาเผยแพร่', await count(p, '#anList [data-unpub]') === pub0 && await count(p, '#anTrash [data-restore]') === 0);
    await p.click('#anList [data-del]'); await p.waitForTimeout(500);
    await p.click('#anTrash [data-purge]'); await p.waitForTimeout(500);
    check('ข่าว: ลบลงถัง แล้วลบถาวรได้', await count(p, '#anList [data-unpub]') === pub0 - 1 && await count(p, '#anTrash [data-purge]') === 0 && (await calls(p, (c) => c.table === 'news' && c.op === 'delete')).length >= 1);
    await go(p, '#/admin/review');
    await p.click('#rvUnits [data-u="3"]'); await p.waitForTimeout(200);
    await p.click('#rvBody [data-open]'); await p.waitForTimeout(150);
    await p.click('.crit-editbox [data-set="approved"]'); await p.waitForTimeout(400);
    check('ผู้ดูแล: ตรวจประเมิน ให้ผ่านได้', await p.evaluate(() => window.__db.item_status.some((s) => s.unit_id === 3 && s.status === 'approved')));
    await go(p, '#/admin/settings/staff'); await p.waitForTimeout(300);
    check('คำร้องขอสมัครบัญชีเจ้าหน้าที่: แสดงในตั้งค่า › บัญชีเจ้าหน้าที่ + ตัวเลขบนเมนู', await count(p, '#srList .sr-row') === 1 && (await text(p, '#admSetBadge')) === '1');
    await p.selectOption('#srList .sr-unit', '4'); await p.click('[data-sr-approve]'); await p.waitForTimeout(500);
    check('คำร้อง: อนุมัติแล้วเพิ่มเป็นเจ้าหน้าที่ (เลือก รพ.สต. ได้)', await p.evaluate(() => window.__db.staff_roster.some((r) => r.email === 'c2@gmail.com' && r.unit_id === 4)) && await count(p, '#srList .sr-row') === 0);
    await p.fill('#rfEmail', 'New.Staff@Gmail.com'); await p.fill('#rfName', 'เจ้าหน้าที่ใหม่'); await p.selectOption('#rfUnit', '4');
    await p.click('#rfSubmit'); await p.waitForTimeout(400);
    check('ผู้ดูแล: เพิ่มบัญชีเจ้าหน้าที่ (อีเมลเป็นตัวเล็ก)', await p.evaluate(() => window.__db.staff_roster.some((r) => r.email === 'new.staff@gmail.com')));
    await go(p, '#/admin/visits');
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
    await go(p, '#/admin/settings/delivery'); await p.waitForTimeout(300);
    await p.fill('#daTitle', 'ส่งยาถึงบ้าน ปี 2570'); await p.setInputFiles('#daImage', { name: 'poster.png', mimeType: 'image/png', buffer: PNG }); await p.waitForTimeout(400);
    await p.click('#daAdd'); await p.waitForTimeout(500);
    check('ผู้ดูแล: เพิ่มโปสเตอร์ส่งยาถึงบ้าน (ย่อ ≤ A4)', await count(p, '#daList .da-poster') === 1 && (await calls(p, (c) => c.upload === 'public-images' && c.path.startsWith('delivery/'))).length === 1);
    await p.fill('#daInfo', 'บริการใหม่\nโทรนัดได้ที่ รพ.สต.'); await p.click('#daInfoSave'); await p.waitForTimeout(300);
    await p.fill('#daStats [data-u="2"][data-k="deliveries"]', '60'); await p.click('#daStatSave'); await p.waitForTimeout(400);
    check('ผู้ดูแล: บันทึกข้อความแนะนำ + สถิติการจัดส่ง', (await calls(p, (c) => c.table === 'site_texts' && c.op === 'upsert')).length === 1 && (await calls(p, (c) => c.table === 'delivery_stats' && c.op === 'upsert'))[0]?.payload?.some((r) => r.unit_id === 2 && r.deliveries === 60));
    await go(p, '#/delivery'); await p.waitForTimeout(500);
    check('หน้าหลัก: โปสเตอร์แสดง + ข้อความใหม่ + สถิติอัปเดต', await count(p, '#dlPosters .poster img') === 1 && (await text(p, '#dlInfo')).includes('บริการใหม่') && (await text(p, '#dlFigs')).includes('117'));
    await p.screenshot({ path: path.join(SHOTS, 'home-delivery-1280.png'), fullPage: true });
    await go(p, '#/admin/settings/dose');
    await p.fill('#dfName', 'ยาทดสอบ'); await p.fill('#dfInds .i-name', 'ลดไข้'); await p.fill('#dfInds .i-min', '10'); await p.fill('#dfInds .i-max', '5'); await p.click('#dfSubmit'); await p.waitForTimeout(150);
    check('ผู้ดูแล: ขนาดยาผิดถูกเตือน', (await text(p, '#dfMsg')).length > 0);
    await p.fill('#dfInds .i-max', '15');
    for (const [n, a, b] of [['ปวด', 15, 20], ['อักเสบ', 20, 30], ['ข้อที่สี่', 5, 8]]) {
      await p.click('#dfAddInd'); await p.fill('#dfInds .ind-box:last-child .i-name', n); await p.fill('#dfInds .ind-box:last-child .i-min', String(a)); await p.fill('#dfInds .ind-box:last-child .i-max', String(b));
    }
    check('ยา: เพิ่มข้อบ่งใช้ได้ + หัวข้อสรุปขนาดยา (ย่อ/ขยายได้)', await count(p, '#dfInds details.ind-box') === 4 && (await text(p, '#dfInds .ind-box:nth-child(2) .ind-sum')).includes('ปวด'));
    await p.fill('#dfConcs .c-label', 'ยาน้ำ 10 มก./มล.'); await p.fill('#dfConcs .c-mg', '10'); await p.selectOption('#dfConcs .c-type', 'ml');
    await p.click('#dfSubmit'); await p.waitForTimeout(500);
    const dd = await p.evaluate(() => window.__db.dose_drugs.find((d) => d.name === 'ยาทดสอบ'));
    check('ยา: บันทึก 4 ข้อบ่งใช้ + หน่วย มก./มล.', dd?.indications?.length === 4 && dd.concs[0].mgPerMl === 10 && dd.mg_per_kg_min === 10, JSON.stringify(dd));
    await p.fill('#dfQ', 'ยาทดสอบ'); await p.waitForTimeout(150);
    check('รายการยา: ค้นหาชื่อได้', await count(p, '#dfList .li') === 1);
    await p.fill('#dfQ', ''); await p.selectOption('#dfSortBy', 'desc'); await p.waitForTimeout(150);
    const dn = await p.$$eval('#dfList .li b', (b) => b.map((x) => x.childNodes[0].textContent.trim()));
    check('รายการยา: เรียงตามตัวอักษรย้อนกลับได้', dn.join('|') === [...dn].sort((a, b) => b.localeCompare(a, 'th')).join('|') && dn.length > 1);
    await p.selectOption('#dfFForm', 'ครีม'); await p.waitForTimeout(150);
    check('รายการยา: กรองตามรูปแบบยา (ไม่พบ → แจ้ง)', (await text(p, '#dfList')).includes('ไม่พบยา'));
    await go(p, '#/dose'); await p.waitForTimeout(300);
    await p.fill('#doseWeight', '20'); await p.selectOption('#doseDrug', { label: 'ยาทดสอบ' }); await p.waitForTimeout(200);
    check('คำนวณโดส: แสดงพร้อมกัน 3 ข้อบ่งใช้ ที่เหลือย่อไว้ + คิดเป็น มล. จาก มก./มล.', await count(p, '#doseResult section.ind-result') === 3 && await count(p, '#doseResult details.ind-result') === 1 && (await text(p, '#doseResult')).includes('20.00–30.00 มล.'));
    check('คำนวณโดส: รายการยาอยู่ใต้น้ำหนักตัว', await p.evaluate(() => { const w = document.querySelector('#doseWeight').getBoundingClientRect(), d = document.querySelector('#doseDrug').getBoundingClientRect(); return d.top > w.bottom; }));
    await p.close();

    /* ================= งานจาก comment หน้าตัวอย่าง (ข่าว/แชท/เกณฑ์/ผู้ป่วย) ================= */
    const img = { name: 'a.png', mimeType: 'image/png', buffer: PNG }, pdf = { name: 'คู่มือ.pdf', mimeType: 'application/pdf', buffer: PDF };
    p = await open('staff', '#/staff/news');
    check('ข่าว: ประเภทใหม่ ข่าว/ประชาสัมพันธ์/ความรู้', (await p.$$eval('#snTag option', (o) => o.map((x) => x.value).join(','))) === 'ข่าว,ประชาสัมพันธ์,ความรู้');
    check('เมนูเจ้าหน้าที่: กล่องที่ซ้อนกันมีระยะห่าง', await p.$eval('[data-staff-view="news"]', (e) => getComputedStyle(e).rowGap) === '16px');
    await p.setInputFiles('#snImage', img); await p.waitForTimeout(500);
    check('ข่าว: เลือกรูปแล้วแสดงตัวอย่างทันที + ย่อไม่เกิน A4', await visible(p, '#snImagePreview img') && (await text(p, '#snImageNote')).includes('A4'));
    await p.setInputFiles('#snFile', pdf); await p.fill('#snTitle', 'ข่าวมี PDF'); await p.fill('#snBody', 'x'); await p.selectOption('#snTag', 'ความรู้');
    await p.click('#snSubmit'); await p.waitForTimeout(600);
    const ins = (await calls(p, (c) => c.table === 'news' && c.op === 'insert'))[0]?.payload || {};
    check('ข่าว: ส่งพร้อมรูป (WebP) + PDF แนบ', ins.tag === 'ความรู้' && ins.image_path?.endsWith('.webp') && ins.file_path?.endsWith('.pdf') && ins.file_name === 'คู่มือ.pdf', JSON.stringify(ins));
    await go(p, '#/staff/criteria'); await p.waitForTimeout(300);
    await p.click('[data-open="3"]'); await p.waitForTimeout(200);
    await p.setInputFiles('#ev-files', [img, pdf]); await p.waitForTimeout(200);
    check('หลักฐาน: เลือกไฟล์แล้วแสดงตัวอย่าง (รูป + PDF)', await count(p, '#ev-preview .fthumb') === 2 && await count(p, '#ev-preview img') === 1);
    await p.click('[data-submit="3"]'); await p.waitForTimeout(600);
    await p.click('[data-open="3"]'); await p.waitForTimeout(300);
    check('หลักฐาน: ส่งแล้วขึ้น "รอตรวจ" + ภาพย่อไฟล์ที่ส่ง', await visible(p, '.wait-note') && await count(p, '.crit-editbox .fthumb[data-file]') === 2);
    await p.click('[data-withdraw]'); await p.waitForTimeout(500);
    check('หลักฐาน: กดยกเลิกการส่งได้', (await calls(p, (c) => c.rpc === 'withdraw_item_status')).length === 1 && await p.evaluate(() => window.__db.item_status.find((x) => x.item_id === 3 && x.unit_id === 2)?.status === 'none'));
    await go(p, '#/staff/visits'); await p.click('#ptAddBtn'); await p.waitForTimeout(150);
    check('ผู้ป่วย: มีช่องสังกัด รพ.สต. (ค่าเริ่มต้น = หน่วยตัวเอง) + ที่อยู่ + เบอร์โทร แทน HN รพ.สต.', !(await p.$('#pfHnU')) && (await p.$eval('#pfHome', (e) => e.value)) === '2' && !!(await p.$('#pfAddr')) && (await p.getAttribute('#pfDob', 'placeholder')).includes('12/5/1997'));
    await p.fill('#pfFirst', 'ทดสอบ'); await p.fill('#pfLast', 'วันเกิด'); await p.fill('#pfDob', '12/5/2540'); await p.fill('#pfPhone', '081-111-2222'); await p.fill('#pfAddr', 'ม.1');
    await p.click('#ptForm [type=submit]'); await p.waitForTimeout(500);
    const pt = (await calls(p, (c) => c.table === 'patients' && c.op === 'insert'))[0]?.payload || {};
    check('ผู้ป่วย: วันเกิด 12/5/2540 (พ.ศ.) → 1997-05-12 + บันทึกเบอร์/ที่อยู่', pt.birth_date === '1997-05-12' && pt.phone === '081-111-2222' && pt.home_unit_id === 2, JSON.stringify(pt));
    await p.click('[data-act="add-visit"]'); await p.waitForTimeout(150);
    check('เยี่ยมบ้าน: หน่วยยา เม็ด/ขวด/หลอด/(ไม่ระบุ)', (await p.$$eval('#vMeds .med-unit option', (o) => o.map((x) => x.value).join(','))) === 'เม็ด,ขวด,หลอด,(ไม่ระบุ)');
    await p.fill('#vO', 'ผิวแห้ง ไม่บวม'); await p.fill('#vMeds .med-name', 'เมทฟอร์มิน'); await p.fill('#vMedNote', 'เก็บในตู้เย็น'); await p.check('#vNoDrp');
    await p.setInputFiles('#vPhotos', [img, { ...img, name: 'b.png' }]); await p.waitForTimeout(500);
    check('เยี่ยมบ้าน: เลือกรูปแล้วเห็นตัวอย่าง', await count(p, '#vPhotoList .fthumb img') === 2);
    await p.click('#vForm [type=submit]'); await p.waitForTimeout(600);
    const vi = (await calls(p, (c) => c.table === 'visits' && c.op === 'insert'))[0]?.payload || {};
    check('เยี่ยมบ้าน: มีช่อง O — Objective data และบันทึกได้', vi.objective === 'ผิวแห้ง ไม่บวม');
    check('เยี่ยมบ้าน: บันทึกหมายเหตุรายการยา + รูป 2 รูป (ส่วนตัว)', vi.med_note === 'เก็บในตู้เย็น' && vi.photo_paths?.length === 2 && (await calls(p, (c) => c.upload === 'visit-photos')).length === 2, JSON.stringify(vi));
    check('เยี่ยมบ้าน: รูปแสดงในบันทึกการเยี่ยม', await count(p, '#ptPanel .visit-photos img') === 2);
    await p.click('[data-edit-visit]'); await p.waitForTimeout(300);
    await p.setInputFiles('#vPhotos', [img, img, img, img]); await p.waitForTimeout(700);
    check('เยี่ยมบ้าน: จำกัดไม่เกิน 5 รูป', await count(p, '#vPhotoList .fthumb') === 5 && await p.$eval('#vPhotos', (e) => e.disabled));
    await p.click('[data-act="cancel"]'); await p.waitForTimeout(200);
    await go(p, '#/staff/messages'); await p.click('#staffInboxSlot [data-conv]'); await p.waitForTimeout(400);
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
    await p.click('[data-open="3"]'); await p.waitForTimeout(150); await p.click('.crit-editbox [data-set="approved"]'); await p.waitForTimeout(400);
    await p.click('#rv-3 [data-undo]'); await p.waitForTimeout(400);
    check('ตรวจประเมิน: ย้อนกลับการให้ผ่านได้', await p.evaluate(() => window.__db.item_status.find((x) => x.item_id === 3 && x.unit_id === 3)?.status === 'submitted'));
    await p.click('[data-open="4"]'); await p.waitForTimeout(150);
    await p.fill('#rvComment', 'ดูตัวอย่างที่แนบ'); await p.setInputFiles('#rvFiles', pdf); await p.waitForTimeout(150);
    check('ตรวจประเมิน: เลือกไฟล์แนบกลับแล้วเห็นตัวอย่าง', await count(p, '#rvPreview .fthumb') === 1);
    await p.click('.crit-editbox [data-set="fix"]'); await p.waitForTimeout(500);
    const rv = await p.evaluate(() => window.__db.item_status.find((x) => x.item_id === 4 && x.unit_id === 3));
    check('ตรวจประเมิน: ขอแก้ไขพร้อมแนบไฟล์กลับ', rv.status === 'fix' && rv.review_files?.length === 1, JSON.stringify(rv));
    await p.click('#rv-4 [data-undo]'); await p.waitForTimeout(400);
    check('ตรวจประเมิน: ย้อนกลับการขอแก้ไขได้', await p.evaluate(() => window.__db.item_status.find((x) => x.item_id === 4 && x.unit_id === 3)?.status === 'submitted'));
    await p.click('[data-hideyear="1"]'); await p.waitForTimeout(400);
    check('ปีงบ: ซ่อนปีงบได้ (แสดง "ซ่อนอยู่")', (await text(p, '#rvYears')).includes('ซ่อนอยู่') && await visible(p, '[data-hideyear="0"]'));
    await p.click('[data-hideyear="0"]'); await p.waitForTimeout(400);
    check('ปีงบ: มีปุ่มลบปีงบ (ปีปัจจุบัน/ปีถัดไป)', await visible(p, '[data-delyear]'));
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
