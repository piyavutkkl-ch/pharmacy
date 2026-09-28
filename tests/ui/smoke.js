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
    await p.click('[data-panel-link="news"]'); await p.waitForTimeout(300);
    check('ข่าว: การ์ดข่าวแสดง (เฉพาะที่เผยแพร่)', await count(p, '#newsGrid .news-card') === 3, String(await count(p, '#newsGrid .news-card')));
    await p.click('[data-panel-link="dose"]'); await p.waitForTimeout(300);
    await p.fill('#doseWeight', '20'); await p.waitForTimeout(150);
    check('คำนวณโดสยา: แสดงผลเป็นมิลลิกรัม', (await text(p, '#doseResult')).includes('มก.'));
    await p.click('[data-panel-link="tracking"]'); await p.waitForTimeout(300);
    check('ผลการดำเนินงาน: ตัวเลขแสดง', (await text(p, '#trkVisits')).trim() !== '');
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
    await p.click('#ptList [data-pt]'); await p.waitForTimeout(300);
    const logs = await calls(p, (c) => c.rpc === 'log_patient_access');
    check('เจ้าหน้าที่: เปิดรายชื่อ + เปิดดูผู้ป่วย ถูกบันทึก (PDPA)', logs.some((c) => c.args.p_unit === 2 && !c.args.p_patient) && logs.some((c) => c.args.p_patient));
    check('เจ้าหน้าที่: มีข้อความแจ้งว่าการเข้าถึงถูกบันทึก', (await text(p, '.pdpa-note')).includes('PDPA'));
    await go(p, '#/staff/docs');
    check('เจ้าหน้าที่: เอกสารเห็นเฉพาะทุกหน่วย + หน่วยตัวเอง', await count(p, '#sdList .li') === 2, String(await count(p, '#sdList .li')));
    await go(p, '#/staff/messages');
    await p.click('#staffInboxSlot [data-conv]'); await p.waitForTimeout(400);
    await p.fill('#staffInboxSlot .ib-input', 'ตอบกลับจากเจ้าหน้าที่'); await p.click('#staffInboxSlot .ib-form button'); await p.waitForTimeout(400);
    check('เจ้าหน้าที่: ตอบแชทประชาชนได้', (await calls(p, (c) => c.table === 'messages' && c.op === 'insert')).length === 1);
    await p.close();

    /* ================= ผู้ดูแล ================= */
    p = await open('admin', '#/admin');
    for (const tab of ['news', 'review', 'messages', 'visits', 'docs', 'feedback', 'settings/dose', 'settings/contacts', 'settings/staff', 'settings/audit']) {
      await go(p, '#/admin/' + tab); await p.waitForTimeout(250);
      const view = tab.split('/')[0];
      const shown = await p.$eval(`[data-admin-view="${view}"]`, (e) => !e.hidden && e.innerText.trim().length > 0).catch(() => false);
      check(`ผู้ดูแล: เมนู ${tab} เปิดได้`, shown && (await text(p, '#adminViewTitle')));
    }
    await go(p, '#/admin/news');
    await p.click('#anQueue [data-review]'); await p.waitForTimeout(200);
    await p.click('[data-decide="published"]'); await p.waitForTimeout(400);
    check('ผู้ดูแล: อนุมัติข่าวรอตรวจ → เผยแพร่', await p.evaluate(() => window.__db.news.every((n) => n.status !== 'pending')));
    await go(p, '#/admin/review');
    await p.click('#rvUnits [data-u="3"]'); await p.waitForTimeout(200);
    await p.click('#rvBody [data-open]'); await p.waitForTimeout(150);
    await p.click('.crit-editbox [data-set="approved"]'); await p.waitForTimeout(400);
    check('ผู้ดูแล: ตรวจประเมิน ให้ผ่านได้', await p.evaluate(() => window.__db.item_status.some((s) => s.unit_id === 3 && s.status === 'approved')));
    await go(p, '#/admin/settings/staff');
    await p.fill('#rfEmail', 'New.Staff@Gmail.com'); await p.fill('#rfName', 'เจ้าหน้าที่ใหม่'); await p.selectOption('#rfUnit', '4');
    await p.click('#rfSubmit'); await p.waitForTimeout(400);
    check('ผู้ดูแล: เพิ่มบัญชีเจ้าหน้าที่ (อีเมลเป็นตัวเล็ก)', await p.evaluate(() => window.__db.staff_roster.some((r) => r.email === 'new.staff@gmail.com')));
    await go(p, '#/admin/visits');
    await p.click('#avUnits [data-u="2"]'); await p.waitForTimeout(300);
    await p.click('#ptList [data-pt]'); await p.waitForTimeout(300);
    await p.click('[data-act="edit-patient"]'); await p.fill('#pfHnU', 'HN-777'); await p.click('#ptForm [type=submit]'); await p.waitForTimeout(400);
    await go(p, '#/admin/settings/audit'); await p.waitForTimeout(300);
    const auText = await text(p, '#auList');
    check('ผู้ดูแล: ประวัติการเข้าถึงแสดงการเปิดดู + การแก้ไข พร้อมชื่อผู้ใช้', auText.includes('เปิดดูข้อมูลผู้ป่วย') && auText.includes('แก้ไขข้อมูลผู้ป่วย') && auText.includes('HN รพ.สต.') && await count(p, '#auList .audit-row') >= 3, auText.slice(0, 200));
    await p.selectOption('#auAction', 'read'); await p.click('#auShow'); await p.waitForTimeout(300);
    check('ผู้ดูแล: กรองเฉพาะการเปิดดูได้', await p.$$eval('#auList .chip', (x) => x.length > 0 && x.every((c) => c.classList.contains('c-sub'))));
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 3000 }), p.click('#auCsv')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    check('ผู้ดูแล: ดาวน์โหลด CSV ประวัติการเข้าถึง (เปิดใน Excel ภาษาไทยได้)', dl.suggestedFilename().endsWith('.csv') && csv.startsWith('\ufeff"วันเวลา"') && csv.includes('เปิดดูข้อมูลผู้ป่วย'), dl.suggestedFilename() + ' ' + JSON.stringify(csv.slice(0, 160)));
    await p.fill('#auSearch', 'ไม่มีชื่อนี้แน่นอน'); await p.click('#auShow'); await p.waitForTimeout(300);
    check('ผู้ดูแล: ค้นไม่พบ → แสดงสถานะว่าง', await count(p, '#auList .empty') === 1);
    await go(p, '#/admin/settings/dose');
    await p.fill('#dfName', 'ยาทดสอบ'); await p.fill('#dfMin', '10'); await p.fill('#dfMax', '5'); await p.click('#dfSubmit'); await p.waitForTimeout(150);
    check('ผู้ดูแล: ขนาดยาผิดถูกเตือน', (await text(p, '#dfMsg')).length > 0);
    await p.close();

    /* ================= มือถือ / แท็บเล็ต ================= */
    for (const [role, hash, name] of [[null, '', 'home'], ['citizen', '#/me', 'me'], ['staff', '#/staff/visits', 'staff-visits'], ['staff', '#/staff/messages', 'staff-messages'], ['admin', '#/admin/review', 'admin-review'], ['admin', '#/admin/settings/staff', 'admin-roster'], ['admin', '#/admin/settings/audit', 'admin-audit']]) {
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
