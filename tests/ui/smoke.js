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
    check('Health Rider: ผลงานอยู่ในช่องบริการจัดส่งยาถึงบ้าน (ข้อความแนะนำ + ตัวเลขรวม + ราย รพ.สต.) · ไม่มีปุ่มเมนูแยก', await visible(p, '[data-panel="delivery"] #hrBlock') && (await text(p, '#hrInfo')).includes('Health Rider') && (await text(p, '#hrFigs')).includes('48') && await count(p, '#hrBars .bar-row') === 2
      && !(await p.$('[data-panel-link="rider"]')) && (await text(p, '[data-panel-link="delivery"]')).includes('บริการจัดส่งยาถึงบ้าน (Health Rider)'));
    await go(p, '#/achievements');
    check('ผลงาน รพ.สต.: การ์ดผลงานแสดง', await count(p, '#achGrid .news-card') >= 2);
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
    await p.click('#profileBtn'); await p.waitForTimeout(300);
    await p.fill('#pdPhone', '0899999999'); await p.selectOption('#pdUnit', '3');
    await p.screenshot({ path: path.join(SHOTS, 'profile-dialog-390.png') });
    await p.click('#pdSave'); await p.waitForTimeout(400);
    check('ข้อมูลส่วนตัว (ประชาชน): เลือก รพ.สต. ใกล้บ้านได้ + ฟอร์มในหน้า "ของฉัน" อัปเดต + แชทเปิดใช้ได้', (await calls(p, (c) => c.table === 'profiles' && c.op === 'update')).pop()?.payload?.home_unit_id === 3
      && (await p.inputValue('#mePhone')) === '0899999999' && !(await p.$eval('#meInput', (e) => e.disabled)));
    await p.close();

    /* ================= แชทแบบไม่ต้องล็อกอิน ================= */
    p = await open(null, '', 390, 844);
    check('หน้าแรก: ปุ่มแชทสอบถามเรื่องยา (ไม่ต้องล็อกอิน)', (await p.getAttribute('#homeChatLink', 'href')) === '#/me');
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
    check('เมนูเจ้าหน้าที่: เรียง ข่าว › ข้อความ › เยี่ยมบ้าน › ผลงาน › มาตรฐาน › เอกสาร › ข้อเสนอแนะ (ไม่มี Health Rider)', (await p.$$eval('.sidenav [data-staff-tab]', (a) => a.map((x) => x.dataset.staffTab).join(','))) === 'news,messages,visits,achievements,criteria,docs,feedback');
    for (const tab of ['news', 'messages', 'visits', 'achievements', 'criteria', 'docs', 'feedback']) {
      await go(p, '#/staff/' + tab); await p.waitForTimeout(250);
      const shown = await p.$eval(`[data-staff-view="${tab}"]`, (e) => !e.hidden && e.innerText.trim().length > 0).catch(() => false);
      check(`เจ้าหน้าที่: เมนู ${tab} เปิดได้`, shown && (await text(p, '#staffViewTitle')));
    }
    await p.click('#profileBtn'); await p.waitForTimeout(200);
    check('ข้อมูลส่วนตัว: กดชื่อบนเมนู → หน้าต่างแก้ไข (เจ้าหน้าที่: ไม่มีช่อง รพ.สต. ใกล้บ้าน)', await p.$eval('#pdDialog', (d) => d.open) && (await p.inputValue('#pdName')) === 'สมศรี ใจดี' && !(await visible(p, '#pdUnitField')) && (await p.getAttribute('#pdEmail', 'readonly')) !== null);
    await p.fill('#pdName', ''); await p.click('#pdSave'); await p.waitForTimeout(150);
    check('ข้อมูลส่วนตัว: ชื่อว่างถูกเตือน', (await text(p, '#pdMsg')).includes('ชื่อ') && await p.$eval('#pdDialog', (d) => d.open));
    await p.fill('#pdName', 'สมศรี ใจดีมาก'); await p.fill('#pdPhone', '081-222-3333'); await p.click('#pdSave'); await p.waitForTimeout(400);
    const pu = (await calls(p, (c) => c.table === 'profiles' && c.op === 'update')).pop()?.payload || {};
    check('ข้อมูลส่วนตัว: บันทึกเฉพาะช่องที่แก้ได้ + ชื่อบนเมนู/คำทักทายเปลี่ยนตาม', pu.full_name === 'สมศรี ใจดีมาก' && pu.phone === '081-222-3333' && !('role' in pu) && !('unit_id' in pu) && !('home_unit_id' in pu)
      && !(await p.$eval('#pdDialog', (d) => d.open)) && (await text(p, '#profileBtn')).includes('ใจดีมาก') && (await text(p, '#staffHello')).includes('ใจดีมาก'), JSON.stringify(pu));
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
    check('เยี่ยมบ้าน: มีฟอร์มสรุปผลงาน one page summary ใต้บันทึกการเยี่ยม (ไม่มีช่อง PDF)', await visible(p, '#staffSumSlot #vsForm') && (await text(p, '#vsFormTitle')).includes('one page summary') && !(await p.$('#vsFile')) && (await text(p, '#vsList')).includes('ยังไม่มีสรุปผลงาน'));
    check('สรุปผลงาน: ช่องเลือก รพ.สต. ขึ้นหน่วยของตัวเองอัตโนมัติ', (await p.inputValue('#vsUnit')) === '2' && await count(p, '#vsUnit option') === 7);
    await p.click('#vsSubmit'); await p.waitForTimeout(150);
    check('สรุปผลงาน: ไม่ใส่หัวข้อ/ภาพ ถูกเตือน', (await text(p, '#vsMsg')).length > 0);
    await p.fill('#vsTitle', 'สรุปเยี่ยมบ้าน ไตรมาส 1'); await p.setInputFiles('#vsImage', [{ name: 'sum.png', mimeType: 'image/png', buffer: PNG }, { name: 'sum2.png', mimeType: 'image/png', buffer: PNG }, { name: 'sum3.png', mimeType: 'image/png', buffer: PNG }]); await p.waitForTimeout(600);
    check('สรุปผลงาน: เลือกหลายภาพแล้วเห็นตัวอย่าง + ปุ่ม × ทุกภาพ', await count(p, '#vsImagePreview .img-item') === 3 && await count(p, '#vsImagePreview .img-x') === 3);
    await p.click('#vsImagePreview [data-rmimg="2"]'); await p.waitForTimeout(150);
    check('สรุปผลงาน: กด × ลบภาพออกได้', await count(p, '#vsImagePreview .img-item') === 2);
    await p.fill('#vsBody', 'เยี่ยม 20 ราย\nแก้ DRPs ได้ 8 ราย');
    await p.click('#vsSubmit'); await p.waitForTimeout(600);
    const vsIns = (await calls(p, (c) => c.table === 'visit_summaries' && c.op === 'insert'))[0]?.payload;
    check('สรุปผลงาน: เผยแพร่ได้ (ภาพหลัก + ภาพเพิ่ม 1 · รูปอยู่ summaries/<หน่วย>/)', vsIns?.unit_id === 2 && vsIns?.image_path?.startsWith('summaries/2/') && vsIns?.gallery?.length === 1 && !('file_path' in vsIns) && await count(p, '#vsList .da-poster') === 1, JSON.stringify(vsIns));
    await p.click('#vsList [data-edit]'); await p.waitForTimeout(150);
    check('สรุปผลงาน: แก้ไขแล้วภาพเดิมขึ้นครบ', await count(p, '#vsImagePreview .img-item') === 2 && (await p.inputValue('#vsUnit')) === '2');
    await p.fill('#vsTitle', 'สรุปเยี่ยมบ้าน ไตรมาส 1 (แก้ไข)'); await p.click('#vsSubmit'); await p.waitForTimeout(400);
    check('สรุปผลงาน: แก้ไขได้ (ไม่ต้องเลือกภาพใหม่) + ปุ่มกลับเป็น "เผยแพร่"', (await calls(p, (c) => c.table === 'visit_summaries' && c.op === 'update')).length === 1 && (await text(p, '#vsList')).includes('(แก้ไข)') && (await text(p, '#vsSubmit')).includes('เผยแพร่'));
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
    await p.screenshot({ path: path.join(SHOTS, 'tracking-poster-1280.png') });
    await p.click('#trackArt .sp-slide.on'); await p.waitForTimeout(400);
    check('สรุปผลงาน: กดเข้าไปเป็นหน้าแบบข่าว (ภาพเต็ม + ภาพเพิ่ม + รายละเอียด)', await visible(p, '[data-view="summary"]') && (await text(p, '#smTitle')).includes('(แก้ไข)') && (await text(p, '#smTag')).includes('ทุ่งนุ้ย') && await count(p, '#smBody p') === 2 && await count(p, '#smGallery .cover') === 1);
    await p.screenshot({ path: path.join(SHOTS, 'summary-1280.png'), fullPage: true });
    await go(p, '#/staff/visits'); await p.waitForTimeout(300);
    await p.click('#vsList [data-del]'); await p.waitForTimeout(400);
    check('สรุปผลงาน: ลบได้', await count(p, '#vsList .da-poster') === 0);
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
    for (const tab of ['news', 'messages', 'review', 'visits', 'rider', 'docs', 'settings/feedback', 'settings/dose', 'settings/contacts', 'settings/staff', 'settings/audit']) {
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
      await p.click('#aiHist summary'); await p.waitForTimeout(150);
      check('ช่อง AI: เปิดแล้วเห็นสถานะล่าสุด + ประวัติ (สำเร็จ/ไม่สำเร็จพร้อมสาเหตุ)', await visible(p, '#aiLog') && (await text(p, '#aiStatus')).includes('สร้างข่าวแล้ว') && await count(p, '#aiLog .li') === 2 && (await text(p, '#aiLog')).includes('quota') && (await text(p, '#aiLog')).includes('รอตรวจ'));
      await p.click('#aiAuto'); await p.waitForTimeout(300);
      check('ช่อง AI: เปิด "เผยแพร่ทันที" ได้ (ถามยืนยันก่อน)', (await calls(p, (c) => c.table === 'site_texts' && c.op === 'upsert'))[0]?.payload?.key === 'ai_news_auto' && (await calls(p, (c) => c.table === 'site_texts' && c.op === 'upsert'))[0]?.payload?.body === 'on');
      await p.click('#aiAuto'); await p.waitForTimeout(300);
      await p.click('#aiNow'); await p.waitForTimeout(500);
      check('ช่อง AI: กด "สร้างข่าวตอนนี้" → ส่งคำสั่ง + แจ้งว่าจะได้ภายใน 1 ชั่วโมง', (await calls(p, (c) => c.table === 'site_texts' && c.op === 'upsert')).some((c) => c.payload.key === 'ai_news_request') && (await text(p, '#aiStatus')).includes('ภายใน 1 ชั่วโมง'));
      check('ช่อง AI: ข่าวจาก AI เข้าคิวรอตรวจพร้อมป้าย AI', (await text(p, '#anQueue')).includes('ช่อง AI') && await count(p, '#anQueue .chip') >= 1);
      await p.click(`#anQueue [data-review="${AI}"]`); await p.waitForTimeout(500);
      check('ช่อง AI: กล่องตรวจแสดงภาพ 3 ภาพ + อ้างอิงบทความ + ลิงก์ PDF ต้นฉบับ + เตือนให้ตรวจตัวเลข + ปุ่มแก้ไข', await count(p, '#anReview .rv-imgs .cover') === 3 && (await p.getAttribute('#anReview p.small a[href*="ccpe"]', 'href') || '').includes('id=1876')
        && (await p.getAttribute('#anReview .file-link', 'href') || '').endsWith('showfile.php?file=1876')
        && (await text(p, '#anReview')).includes('ตรวจตัวเลข') && await visible(p, '#anReview [data-decide="edit"]') && !(await p.$('#anReview [data-decide="fix"]')));
      await p.click('#anReview [data-decide="edit"]'); await p.waitForTimeout(200);
      check('ช่อง AI: แก้ไขข้อความ → ข้อมูลขึ้นในฟอร์มด้านบน', (await p.inputValue('#anTitle')).includes('สแตติน') && (await text(p, '#anFormTitle')).includes('รอตรวจ'));
      check('แก้ข่าว: รูปทั้ง 3 รูปขึ้นในฟอร์ม (รูปหลักมีกรอบ) + ปุ่ม × ทุกรูป', await count(p, '#anImagePreview .img-item') === 3 && await count(p, '#anImagePreview .img-x') === 3
        && (await p.getAttribute('#anImagePreview .img-item.main img', 'src')).includes('infographic') && await p.$eval('#anImagePreview .img-x', (e) => e.getBoundingClientRect().height >= 44));
      await (await p.$('#anImagePreview')).screenshot({ path: path.join(SHOTS, 'admin-news-images.png') });
      await p.click('#anImagePreview [data-rmimg="1"]'); await p.waitForTimeout(150);
      check('แก้ข่าว: กด × ลบรูปที่ 2 ได้', await count(p, '#anImagePreview .img-item') === 2 && !(await p.$('#anImagePreview img[src*="comic"]')));
      await p.setInputFiles('#anImage', [{ name: 'n1.png', mimeType: 'image/png', buffer: PNG }, { name: 'n2.png', mimeType: 'image/png', buffer: PNG }]); await p.waitForTimeout(600);
      check('แก้ข่าว: เลือกหลายรูปเพื่อเพิ่มได้ + แจ้งจำนวน', await count(p, '#anImagePreview .img-item') === 4 && (await text(p, '#anImageNote')).includes('4/7'));
      await p.click('#anImagePreview [data-rmimg="3"]'); await p.waitForTimeout(150);
      await p.click('#anImagePreview [data-mainimg="2"]'); await p.waitForTimeout(150);
      check('แก้ข่าว: ตั้งรูปใหม่เป็นรูปหลักได้', (await p.getAttribute('#anImagePreview .img-item.main img', 'src')).startsWith('blob:'));
      await p.fill('#anBody', 'แก้โดยเภสัชกรแล้ว'); await p.click('#anSubmit'); await p.waitForTimeout(600);
      const ue = (await calls(p, (c) => c.table === 'news' && c.op === 'update')).map((c) => c.payload).find((x) => x.body === 'แก้โดยเภสัชกรแล้ว') || {};
      check('แก้ข่าว: บันทึกรูปหลักใหม่ + ภาพเพิ่มตามลำดับ + ลบไฟล์รูปที่เอาออก', /^news\/.+\.webp$/.test(ue.image_path || '') && JSON.stringify(ue.gallery) === JSON.stringify(['ai/1876/infographic.jpg', 'ai/1876/clinical.jpg'])
        && (await calls(p, (c) => c.remove === 'public-images')).some((c) => c.paths.includes('ai/1876/comic.jpg') && !c.paths.includes('ai/1876/clinical.jpg')), JSON.stringify(ue));
      check('ช่อง AI: บันทึกแล้วยังรอตรวจ + กลับไปที่กล่องตรวจ', (await calls(p, (c) => c.table === 'news' && c.op === 'update')).some((c) => c.payload.body === 'แก้โดยเภสัชกรแล้ว' && !('status' in c.payload)) && await visible(p, '#anReview [data-decide="published"]'));
      await p.click('#anReview [data-decide="published"]'); await p.waitForTimeout(500);
      check('ช่อง AI: อนุมัติแล้วเผยแพร่', (await calls(p, (c) => c.table === 'news' && c.op === 'update')).some((c) => c.payload.status === 'published'));
      await go(p, '#/news/' + AI); await p.waitForTimeout(500);
      const arW = await p.evaluate(() => [document.querySelector('#arBody').getBoundingClientRect().width, document.querySelector('#arBody').parentElement.getBoundingClientRect().width]);
      check('หน้าอ่านข่าว: เนื้อข่าวเต็มความกว้างกรอบข่าว (ไม่เว้นว่างด้านขวา)', Math.abs(arW[0] - arW[1]) <= 2, JSON.stringify(arW));
      check('หน้าอ่านข่าว AI: ป้าย "สรุปโดย AI" + ภาพเพิ่ม 2 ภาพ + อ้างอิงบทความต้นฉบับ + ปุ่มดาวน์โหลด PDF ต้นฉบับ', await visible(p, '#arAi') && await count(p, '#arGallery .cover') === 2 && (await p.getAttribute('#arSource a', 'href')).includes('ccpe.pharmacycouncil.org') && await visible(p, '#arFile .file-link') && (await p.getAttribute('#arFile a', 'href')).endsWith('showfile.php?file=1876') && (await p.getAttribute('#arFile a', 'target')) === '_blank');
      await p.screenshot({ path: path.join(SHOTS, 'ai-news-article-1280.png'), fullPage: true });
      await go(p, '#/admin/news'); await p.waitForTimeout(300);
    }
    check('ข่าว (ผู้ดูแล): กล่องรอตรวจอยู่ใต้กล่องเขียนข่าว', await p.$eval('[data-admin-view="news"]', (v) => [...v.children].findIndex((c) => c.querySelector('#anForm')) < [...v.children].findIndex((c) => c.querySelector('#anQueue'))));
    check('ท้ายเว็บ: ลิงก์ผลงาน/ช่องทางติดต่อ ไม่แสดงในหน้าผู้ดูแล', !(await visible(p, '.footer-cards')));
    check('เมนูผู้ดูแล: ตรวจประเมินอยู่เหนือเอกสาร + ข้อเสนอแนะอยู่ในตั้งค่า', (await p.$$eval('.sidenav [data-admin-tab]', (a) => a.map((x) => x.dataset.adminTab).join(','))) === 'news,messages,visits,rider,review,docs,settings' && await count(p, '#afList .li') > 0);
    await go(p, '#/admin/feedback'); await p.waitForTimeout(250);
    check('ลิงก์เดิม #/admin/feedback ยังเปิดได้ (พาไปตั้งค่า)', (await p.evaluate(() => location.hash)) === '#/admin/settings/feedback');
    await go(p, '#/admin/news');
    await p.click('#anQueue [data-review]'); await p.waitForTimeout(200);
    await p.click('[data-decide="published"]'); await p.waitForTimeout(400);
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
    check('ข่าวที่เผยแพร่: ย่อไว้แสดง 3 ข่าวล่าสุด + ปุ่มดูทั้งหมด (ช่องค้นซ่อน)', await count(p, '#anList .newsrow') === 3 && await visible(p, '#anExpand') && !(await visible(p, '#anFind')) && allN >= 8);
    await p.click('#anExpand'); await p.waitForTimeout(150);
    check('ข่าวที่เผยแพร่: ดูทั้งหมด → ครบทุกข่าว + เลื่อนดูได้ + ช่องค้นหัวข้อ/วันที่', await count(p, '#anList .newsrow') === allN && await visible(p, '#anSearch') && await visible(p, '#anDate') && await p.$eval('#anList', (e) => getComputedStyle(e).overflowY === 'auto'));
    await p.fill('#anSearch', 'ข่าวเก่า'); await p.waitForTimeout(150);
    check('ข่าวที่เผยแพร่: พิมพ์ค้นหัวข้อได้', await count(p, '#anList .newsrow') === 5 && (await text(p, '#anFound')).includes('5'));
    await p.fill('#anDate', '2026-01-03'); await p.waitForTimeout(150);
    check('ข่าวที่เผยแพร่: เลือกวันที่เผยแพร่ได้', await count(p, '#anList .newsrow') === 1 && (await text(p, '#anList')).includes('ข่าวเก่าลำดับ 3'));
    await p.fill('#anSearch', 'ไม่มีข่าวนี้'); await p.waitForTimeout(150);
    check('ข่าวที่เผยแพร่: ไม่พบ → แจ้งว่าไม่พบ', (await text(p, '#anList')).includes('ไม่พบ'));
    await p.click('#anFindClear'); await p.click('#anExpand'); await p.waitForTimeout(150);
    check('ข่าวที่เผยแพร่: กดย่อกลับเหลือ 3 ข่าว', await count(p, '#anList .newsrow') === 3 && !(await visible(p, '#anFind')));
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
    await go(p, '#/admin/visits'); await p.waitForTimeout(400);
    { const all = await p.evaluate(() => window.__db.patients.length);
      check('ผู้ดูแล: เพิ่มสรุปผลงานเยี่ยมบ้านได้ (ฟอร์มเลือก รพ.สต. ได้ทุกหน่วย)', await visible(p, '#adminSumSlot #vsForm') && await count(p, '#adminSumSlot #vsUnit option') === 7 && (await text(p, '#vsListTitle')).includes('ทุก รพ.สต.'));
      check('ผู้ดูแล: เยี่ยมบ้านช่อง "โรงพยาบาลควนกาหลง" รวมทุกชื่อทุก รพ.สต. (ค่าเริ่มต้น)', (await p.getAttribute('#avUnits [data-u="all"]', 'aria-current')) === 'true' && await count(p, '#ptList [data-pt]') === all && all >= 1 && (await text(p, '#ptList')).includes('รพ.สต.')); }
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
    check('ผู้ดูแล: บันทึกข้อความแนะนำ + สถิติการจัดส่ง', (await calls(p, (c) => c.table === 'site_texts' && c.op === 'upsert' && c.payload.key === 'delivery_info')).length === 1 && (await calls(p, (c) => c.table === 'delivery_stats' && c.op === 'upsert'))[0]?.payload?.some((r) => r.unit_id === 2 && r.deliveries === 60));
    await go(p, '#/delivery'); await p.waitForTimeout(500);
    check('หน้าหลัก: โปสเตอร์แสดง + ข้อความใหม่ + สถิติอัปเดต', await count(p, '#dlPosters .poster img') === 1 && (await text(p, '#dlInfo')).includes('บริการใหม่') && (await text(p, '#dlFigs')).includes('117'));
    await p.screenshot({ path: path.join(SHOTS, 'home-delivery-1280.png'), fullPage: true });
    await go(p, '#/admin/rider'); await p.waitForTimeout(400);
    check('ผู้ดูแล: Health Rider กรอกได้ทุก รพ.สต. + ข้อความแนะนำ', await count(p, '#hrStats .da-stat') === 7 && (await p.inputValue('#hrInfoEdit')).includes('Health Rider'));
    await p.click('.hr-import summary');
    await p.fill('#hrPaste', 'รพ.สต.\tครั้ง\tคน\nรพ.สต.ควนบ่อทอง\t10\t4\nกระทูน\t1,200\t300\nไม่มีชื่อนี้\t1\t1'); await p.click('#hrPasteUse'); await p.waitForTimeout(150);
    check('ผู้ดูแล: วางตารางจาก Excel → เติมตัวเลขให้ + แจ้งชื่อที่ไม่พบ', (await p.inputValue('#hrStats [data-u="3"][data-k="trips"]')) === '10' && (await p.inputValue('#hrStats [data-u="1"][data-k="trips"]')) === '1200' && (await text(p, '#hrImportMsg')).includes('ไม่มีชื่อนี้'));
    await p.setInputFiles('#hrFile', { name: 'rider.csv', mimeType: 'text/csv', buffer: Buffer.from('\ufeffรพ.สต.,ครั้ง,คน\nเหนือคลอง,"2,000",90\n') }); await p.waitForTimeout(300);
    check('ผู้ดูแล: นำเข้าไฟล์ .csv ได้', (await p.inputValue('#hrStats [data-u="6"][data-k="trips"]')) === '2000' && (await p.inputValue('#hrStats [data-u="6"][data-k="clients"]')) === '90');
    await p.click('#hrStatSave'); await p.waitForTimeout(300);
    await p.fill('#hrInfoEdit', 'ไรเดอร์สุขภาพ ส่งยาถึงบ้าน'); await p.click('#hrInfoSave'); await p.waitForTimeout(300);
    check('ผู้ดูแล: บันทึกผลงาน Health Rider หลาย รพ.สต. พร้อมกัน', (await calls(p, (c) => c.table === 'rider_stats' && c.op === 'upsert'))[0]?.payload?.length === 5);
    await go(p, '#/rider'); await p.waitForTimeout(500);
    check('ลิงก์ #/rider เดิม: เปิดช่องบริการจัดส่งยาถึงบ้านที่ผลงาน Health Rider', await visible(p, '[data-panel="delivery"] #hrBlock'));
    check('หน้าหลัก Health Rider: ข้อความใหม่ + ผลงานอัปเดต', (await text(p, '#hrInfo')).includes('ไรเดอร์สุขภาพ') && (await text(p, '#hrFigs')).includes('3,258') && await count(p, '#hrBars .bar-row') === 5);
    await p.screenshot({ path: path.join(SHOTS, 'home-rider-1280.png'), fullPage: true });
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
    await p.click(`[data-submit="${i13}"]`); await p.waitForTimeout(600);
    await p.click(`[data-open="${i13}"]`); await p.waitForTimeout(300);
    check('หลักฐาน: ส่งแล้วขึ้น "รอตรวจ" + ภาพย่อไฟล์ที่ส่ง', await visible(p, '.wait-note') && await count(p, '.crit-editbox .fthumb[data-file]') === 2);
    await p.click('[data-withdraw]'); await p.waitForTimeout(500);
    check('หลักฐาน: กดยกเลิกการส่งได้', (await calls(p, (c) => c.rpc === 'withdraw_item_status')).length === 1 && await p.evaluate((id) => window.__db.item_status.find((x) => x.item_id === id && x.unit_id === 2)?.status === 'none', i13));
    await go(p, '#/staff/visits'); await p.click('#ptAddBtn'); await p.waitForTimeout(150);
    check('ผู้ป่วย: มีช่องสังกัด รพ.สต. (ค่าเริ่มต้น = หน่วยตัวเอง) + ที่อยู่ + เบอร์โทร แทน HN รพ.สต.', !(await p.$('#pfHnU')) && (await p.$eval('#pfHome', (e) => e.value)) === '2' && !!(await p.$('#pfA_no')) && (await p.getAttribute('#pfDob', 'placeholder')).includes('12/5/1997'));
    check('ผู้ป่วย: ที่อยู่แยกช่อง เลขที่/หมู่/ตำบล/อำเภอ/จังหวัด/รหัสไปรษณีย์ (ค่าตั้งต้น ควนกาหลง · สตูล · 91130)', (await p.inputValue('#pfA_amphoe')) === 'ควนกาหลง' && (await p.inputValue('#pfA_province')) === 'สตูล' && (await p.inputValue('#pfA_zip')) === '91130' && !!(await p.$('#pfA_moo')) && !!(await p.$('#pfA_tambon')));
    await p.fill('#pfFirst', 'ทดสอบ'); await p.fill('#pfLast', 'วันเกิด'); await p.fill('#pfDob', '12/5/2540'); await p.fill('#pfPhone', '081-111-2222'); await p.fill('#pfA_no', '12/3'); await p.fill('#pfA_moo', '1'); await p.fill('#pfA_tambon', 'ทุ่งนุ้ย');
    await p.click('#ptForm [type=submit]'); await p.waitForTimeout(500);
    const pt = (await calls(p, (c) => c.table === 'patients' && c.op === 'insert'))[0]?.payload || {};
    check('ผู้ป่วย: วันเกิด 12/5/2540 (พ.ศ.) → 1997-05-12 + บันทึกเบอร์/ที่อยู่', pt.birth_date === '1997-05-12' && pt.phone === '081-111-2222' && pt.home_unit_id === 2, JSON.stringify(pt));
    check('ผู้ป่วย: ที่อยู่เก็บแยกช่อง + ประกอบเป็นที่อยู่เต็ม', pt.address === 'เลขที่ 12/3 หมู่ 1 ต.ทุ่งนุ้ย อ.ควนกาหลง จ.สตูล 91130' && pt.address_parts?.zip === '91130' && pt.address_parts?.moo === '1', JSON.stringify(pt.address_parts));
    await p.click('[data-act="add-visit"]'); await p.waitForTimeout(150);
    check('เยี่ยมบ้าน: หน่วยยา เม็ด/ขวด/หลอด/(ไม่ระบุ)', (await p.$$eval('#vMeds .med-unit option', (o) => o.map((x) => x.value).join(','))) === 'เม็ด,ขวด,หลอด,(ไม่ระบุ)');
    await p.fill('#vO', 'ผิวแห้ง ไม่บวม'); await p.fill('#vA', 'ใช้ยาไม่สม่ำเสมอ'); await p.fill('#vMeds .med-name', 'เมทฟอร์มิน'); await p.fill('#vMeds .med-how', '1 เม็ด หลังอาหารเช้า'); await p.fill('#vMedNote', 'เก็บในตู้เย็น'); await p.check('#vNoDrp');
    await p.setInputFiles('#vPhotos', [img, { ...img, name: 'b.png' }]); await p.waitForTimeout(500);
    check('เยี่ยมบ้าน: เลือกรูปแล้วเห็นตัวอย่าง', await count(p, '#vPhotoList .fthumb img') === 2);
    check('เยี่ยมบ้าน: ไม่มีช่อง "ยาพอถึงวันที่" แล้ว', !(await p.$('#vMedUntil')));
    { const vp = p.viewportSize(); await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(150);
      check('เยี่ยมบ้าน (มือถือ): ฟอร์มไม่ล้นจอ', await overflow(p) <= 0); await (await p.$('#vForm')).screenshot({ path: path.join(SHOTS, 'visit-form-390.png') }); await p.setViewportSize(vp); }
    await p.click('#vForm [type=submit]'); await p.waitForTimeout(600);
    const vi = (await calls(p, (c) => c.table === 'visits' && c.op === 'insert'))[0]?.payload || {};
    check('เยี่ยมบ้าน: มีช่อง O — Objective data และบันทึกได้', vi.objective === 'ผิวแห้ง ไม่บวม');
    check('เยี่ยมบ้าน: มีช่อง A — Assessment และบันทึกได้', vi.assessment === 'ใช้ยาไม่สม่ำเสมอ' && (await text(p, '#ptPanel')).includes('A: ใช้ยาไม่สม่ำเสมอ'));
    check('เยี่ยมบ้าน: ใส่วิธีใช้หลังชื่อยาได้ + แสดงในบันทึก', vi.med_list?.[0]?.how === '1 เม็ด หลังอาหารเช้า' && (await text(p, '#ptPanel')).includes('1 เม็ด หลังอาหารเช้า'), JSON.stringify(vi.med_list));
    check('เยี่ยมบ้าน: บันทึกหมายเหตุรายการยา + รูป 2 รูป (ส่วนตัว)', vi.med_note === 'เก็บในตู้เย็น' && vi.photo_paths?.length === 2 && (await calls(p, (c) => c.upload === 'visit-photos')).length === 2, JSON.stringify(vi));
    check('เยี่ยมบ้าน: รูปแสดงในบันทึกการเยี่ยม', await count(p, '#ptPanel .visit-photos img') === 2);
    await p.click('[data-edit-visit]'); await p.waitForTimeout(300);
    await p.setInputFiles('#vPhotos', [img, img, img, img]); await p.waitForTimeout(700);
    check('เยี่ยมบ้าน: จำกัดไม่เกิน 5 รูป', await count(p, '#vPhotoList .fthumb') === 5 && await p.$eval('#vPhotos', (e) => e.disabled));
    await p.click('[data-act="cancel"]'); await p.waitForTimeout(200);
    { const before = await count(p, '#ptList [data-pt]'), pid = await p.evaluate(() => window.__db.patients.find((x) => x.first_name === 'ทดสอบ')?.id);
      await p.click(`#ptList [data-pt="${pid}"]`); await p.waitForTimeout(300);
      await p.click('[data-act="edit-patient"]'); await p.waitForTimeout(150);
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
