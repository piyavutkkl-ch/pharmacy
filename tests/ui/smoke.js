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
    check('ท้ายเว็บ: ลิงก์ผลงาน/ช่องทางติดต่อ ไม่แสดงในหน้าผู้ดูแล', !(await visible(p, '.footer-cards')));
    check('เมนูผู้ดูแล: ตรวจประเมินอยู่เหนือเอกสาร + ข้อเสนอแนะอยู่ในตั้งค่า', (await p.$$eval('.sidenav [data-admin-tab]', (a) => a.map((x) => x.dataset.adminTab).join(','))) === 'news,messages,visits,achievements,rider,review,docs,settings' && await count(p, '#afList .li') > 0);
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
    check('หน้าแรก ข่าว: แสดงข่าวล่าสุด (ไม่เกิน 6) เรียงแนวนอน + ปุ่ม ‹ › + ดูข่าวทั้งหมด', await count(p, '#newsGrid .news-card') >= 4 && await count(p, '#newsGrid .news-card') <= 6 && await visible(p, '#newsAllLink') && (await p.$eval('#newsPrev', (b) => b.disabled)) && !(await p.$eval('#newsNext', (b) => b.disabled)) && await p.$eval('#newsGrid', (g) => g.scrollWidth > g.clientWidth + 10), JSON.stringify(await p.evaluate(() => { const g = document.querySelector('#newsGrid'); return { n: g.querySelectorAll('.news-card').length, sw: g.scrollWidth, cw: g.clientWidth, prev: document.querySelector('#newsPrev').disabled, next: document.querySelector('#newsNext').disabled, link: !document.querySelector('#newsAllLink').hidden }; })));
    await p.click('#newsNext'); await p.waitForTimeout(700);
    check('หน้าแรก ข่าว: กด › เลื่อนไปข่าวถัดไป (ปุ่ม ‹ ใช้ได้)', await p.$eval('#newsGrid', (g) => g.scrollLeft > 50) && !(await p.$eval('#newsPrev', (b) => b.disabled)));
    await p.click('#newsAllLink'); await p.waitForTimeout(600);
    check('ดูข่าวทั้งหมด: หน้าแยก ข่าวเรียงแนวตั้งครบทุกข่าว', await visible(p, '[data-view="allnews"]') && await count(p, '#nlList .newsrow') === allN && (await text(p, '#nlCount')).includes(String(allN)));
    await p.fill('#nlSearch', 'ข่าวเก่าลำดับ 4'); await p.waitForTimeout(150);
    check('ดูข่าวทั้งหมด: ค้นหาข่าวได้', await count(p, '#nlList .newsrow') === 1 && (await text(p, '#nlFound')).includes('1'));
    await p.fill('#nlSearch', 'ไม่มีข่าวแบบนี้'); await p.waitForTimeout(150);
    check('ดูข่าวทั้งหมด: ไม่พบ → แจ้ง', (await text(p, '#nlList')).includes('ไม่พบข่าว'));
    await p.fill('#nlSearch', ''); await p.selectOption('#nlSort', 'old'); await p.waitForTimeout(150);
    check('ดูข่าวทั้งหมด: จัดเรียงเก่า → ใหม่', (await p.textContent('#nlList .newsrow b')).includes('ข่าวเก่าลำดับ 1'));
    await p.setViewportSize({ width: 390, height: 844 }); await go(p, '#/news'); await p.waitForTimeout(500);
    check('หน้าแรก ข่าว (390px): ปัดซ้าย-ขวาได้ ไม่มี scroll แนวนอนทั้งหน้า', await count(p, '#newsGrid .news-card') >= 4 && await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), JSON.stringify(await p.evaluate(() => ({ n: document.querySelectorAll('#newsGrid .news-card').length, sw: document.documentElement.scrollWidth, iw: innerWidth, wide: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && e.offsetParent && !e.closest('#newsGrid')).slice(0, 6).map((e) => e.tagName + '#' + e.id + '.' + e.className) }))));
    await p.screenshot({ path: path.join(SHOTS, 'home-news-strip-390.png') });
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
      await go(p, '#/admin/settings/delivery'); await p.waitForTimeout(500);
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
    await go(p, '#/admin/settings/dose'); await p.waitForTimeout(400);
    await p.click('#dfBulkFold > summary'); await p.waitForTimeout(100);
    await p.fill('#dfBulk', '1. ไดเฟนไฮดรามีน (Diphenhydramine)\n- ไอบูโพรเฟน (Ibuprofen)\nเซทิริซีน (Cetirizine)\n\nไดเฟนไฮดรามีน (Diphenhydramine)');
    const saves0 = (await calls(p, (c) => c.table === 'dose_drugs' && c.op !== 'select')).length;
    await p.click('#dfBulkMake'); await p.waitForTimeout(3800);
    check('เพิ่มหลายรายการ: วางรายชื่อ → คิว 3 ตัว (ตัดเลขข้อ/ซ้ำ · ยาที่มีแล้วข้าม) + เปิดตัวแรกในฟอร์มพร้อมช่วยกรอก', await count(p, '#dfBulkList .li') === 3 && (await text(p, '#dfBulkList')).includes('มีในรายการยาแล้ว') && (await p.inputValue('#dfName')) === 'ไดเฟนไฮดรามีน (Diphenhydramine)' && (await calls(p, (c) => c.rpc === 'ai_dose_start')).pop()?.args?.p_name === 'diphenhydramine' && (await text(p, '#dfBulkN')).includes('รอเพิ่ม 2'), JSON.stringify({ n: await count(p, '#dfBulkList .li'), list: await text(p, '#dfBulkList'), name: await p.inputValue('#dfName'), rpc: (await calls(p, (c) => c.rpc === 'ai_dose_start')).pop()?.args, nn: await text(p, '#dfBulkN') }));
    check('เพิ่มหลายรายการ: ยังไม่บันทึกยาเอง', (await calls(p, (c) => c.table === 'dose_drugs' && c.op !== 'select')).length === saves0);
    await p.fill('#dfInds .i-name', 'ลดไข้'); await p.fill('#dfInds .i-min', '5'); await p.fill('#dfInds .i-max', '10');
    await p.click('#dfSubmit'); await p.waitForTimeout(3800);
    check('เพิ่มหลายรายการ: บันทึกแล้ว → ตัวนั้นเพิ่มแล้ว + เปิดยาตัวถัดไปเอง', (await text(p, '#dfBulkList')).includes('✓ เพิ่มแล้ว') && (await p.inputValue('#dfName')) === 'เซทิริซีน (Cetirizine)' && (await text(p, '#dfBulkN')).includes('เพิ่มแล้ว 1'));
    await p.click('#dfBulkList [data-bulk-skip]'); await p.waitForTimeout(200);
    check('เพิ่มหลายรายการ: ข้ามได้ + จำรายการไว้ในเครื่อง', (await text(p, '#dfBulkN')).includes('รอเพิ่ม 0') && await p.evaluate(() => JSON.parse(localStorage.getItem('pcps_dose_queue') || '[]').length === 3));
    await p.evaluate(() => localStorage.removeItem('pcps_dose_queue'));
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
    check('เมนูเจ้าหน้าที่: "ดาวน์โหลดเอกสาร"', (await text(p, '[data-staff-tab="docs"]')).trim() === 'ดาวน์โหลดเอกสาร');
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
    await p.click('#ptForm [type=submit]'); await p.waitForTimeout(500);
    const pt = (await calls(p, (c) => c.table === 'patients' && c.op === 'insert'))[0]?.payload || {};
    check('ผู้ป่วย: วันเกิด 12/5/2540 (พ.ศ.) → 1997-05-12 + บันทึกเบอร์/ที่อยู่', pt.birth_date === '1997-05-12' && pt.phone === '081-111-2222' && pt.home_unit_id === 2, JSON.stringify(pt));
    check('ผู้ป่วย: ที่อยู่เก็บแยกช่อง + ประกอบเป็นที่อยู่เต็ม', pt.address === 'เลขที่ 12/3 หมู่ 1 ต.ทุ่งนุ้ย อ.ควนกาหลง จ.สตูล 91130' && pt.address_parts?.zip === '91130' && pt.address_parts?.moo === '1', JSON.stringify(pt.address_parts));
    await p.click('[data-act="add-visit"]'); await p.waitForTimeout(150);
    check('เยี่ยมบ้าน: หน่วยยา เม็ด/ขวด/หลอด/(ไม่ระบุ)', (await p.$$eval('#vMeds .med-unit option', (o) => o.map((x) => x.value).join(','))) === 'เม็ด,ขวด,หลอด,(ไม่ระบุ)');
    check('เยี่ยมบ้าน: ไม่มีช่อง Medication reconciliation / นัดครั้งถัดไป · มีช่องชีพจร · ป้าย "ยาเหลือค้างที่บ้านเกินวันนัด 1 เดือน" (ติ๊กเอง)', !(await p.$('#vRecon')) && !(await p.$('#vNext')) && await visible(p, '#vPulse') && (await text(p, '#vForm')).includes('ยาเหลือค้างที่บ้านเกินวันนัด 1 เดือน'));
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
