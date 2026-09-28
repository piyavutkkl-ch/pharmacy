// จุดเริ่มต้นของแอป: เส้นทางหน้า (hash router), แถบเมนูด้านบน, ฟอร์มท้ายเว็บ
//
// เส้นทาง (URL หลัง #):
//   #/                 หน้าแรก            #/news | #/dose | #/tracking | #/achievements | #/contact  (หน้าแรก + เปิดหัวข้อนั้น)
//   #/news/<id>        อ่านข่าว           #/login            เข้าสู่ระบบ
//   #/me[/request]     ประชาชน: ข้อมูลส่วนตัว + แชทถามเจ้าหน้าที่ + ขอสิทธิ์เจ้าหน้าที่ (/request = เปิดฟอร์มคำขอ)
//   #/staff[/news|criteria|visits|messages|achievements|docs|feedback]                 เจ้าหน้าที่ รพ.สต.
//   #/admin[/news|review|messages|visits|docs|feedback|settings[/dose|contacts|staff]]  ผู้ดูแล (โรงพยาบาล)
import { sb } from './supabase.js?v=4.4';
import { $, $$, esc, toast, errText, busy } from './util.js?v=4.4';
import { auth, initAuth, onAuth, signIn, signOut, ROLE_LABEL, ROLE_HOME, takePostLoginRedirect } from './auth.js?v=4.4';
import { loadNews, renderSlides, renderNewsGrid, bindSlider, startAuto, stopAuto, showArticle, bindArticle, renderCommentState } from './pages/news.js?v=4.4';
import { initDose } from './pages/dose.js?v=4.4';
import { initTracking, initAchievements, initContacts } from './pages/stats.js?v=4.4';
import { showAdmin } from './pages/admin.js?v=4.4';
import { bindMoreSheets } from './nav.js?v=4.4';
import { initDelivery } from './pages/delivery.js?v=4.4';
import { showMe, leaveMe } from './pages/me.js?v=4.4';
import { startChatWatch, stopChatWatch, unmountInbox } from './pages/chat.js?v=4.4';
import { showStaff } from './pages/staff.js?v=4.4';

const HOME_PANELS = ['news', 'dose', 'tracking', 'delivery', 'achievements', 'contact'];

function showView(name) {
  $$('[data-view]').forEach((v) => { v.hidden = v.dataset.view !== name; });
  $('.footer-cards').hidden = name !== 'home';   // ลิงก์ผลงาน/ช่องทางติดต่อ แสดงเฉพาะหน้าหลัก
  document.body.classList.toggle('has-bottomnav', ['staff', 'admin'].includes(name));   // มือถือ: เมนูล่างจอ
  if (name === 'home') startAuto(); else stopAuto();
}

function message(title, body) {
  $('#msgTitle').textContent = title;
  $('#msgBody').innerHTML = body;
  showView('message');
}

function openPanel(id) {
  HOME_PANELS.forEach((p) => {
    const el = document.querySelector(`[data-panel="${p}"]`);
    const on = p === id;
    el.hidden = !on;
    if (on) { el.classList.remove('reveal'); void el.offsetWidth; el.classList.add('reveal'); }
  });
  $$('[data-panel-link]').forEach((a) => a.setAttribute('aria-expanded', a.dataset.panelLink === id ? 'true' : 'false'));
  if (!id) return;
  ({ news: () => loadNews().then(renderNewsGrid).catch(() => renderNewsGrid([])), dose: initDose, tracking: initTracking, delivery: initDelivery,
    achievements: initAchievements, contact: initContacts })[id]?.();
  const el = document.querySelector(`[data-panel="${id}"]`);
  requestAnimationFrame(() => el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
}

function requireRole(roles) {
  if (!auth.ready) return false;
  if (!auth.session) { sessionStorage.setItem('pcps_after_login', '1'); location.hash = '#/login'; return false; }
  if (!auth.profile) { message('โหลดข้อมูลบัญชีไม่สำเร็จ', esc(errText(auth.error)) || 'ลองรีเฟรชหน้าอีกครั้ง'); return false; }
  if (!roles.includes(auth.profile.role)) {
    message('ไม่มีสิทธิ์เข้าหน้านี้', `บัญชีของคุณเป็น <b>${esc(ROLE_LABEL[auth.profile.role])}</b> · หากเป็นเจ้าหน้าที่ กรุณาติดต่อผู้ดูแลให้ลงทะเบียนอีเมล ${esc(auth.profile.email)}`);
    return false;
  }
  return true;
}

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [a, b] = parts;
  document.title = 'Primary Care Pharmacy Services · โรงพยาบาลควนกาหลง';
  setNavCurrent(a || 'home');
  if (a !== 'me') leaveMe();                                 // ปิดห้องแชทที่เปิดค้างเมื่อออกจากหน้า
  if (b !== 'messages') unmountInbox();

  if (!a || HOME_PANELS.includes(a) && !b) {
    showView('home');
    openPanel(a || null);
    if (!a) window.scrollTo(0, 0);
    return;
  }
  window.scrollTo(0, 0);
  if (a === 'news' && b) { showView('article'); showArticle(b); return; }
  if (a === 'login') {
    if (auth.session && auth.profile) { location.replace(ROLE_HOME[auth.profile.role] || '#/'); return; }
    showView('login'); return;
  }
  if (!auth.ready) { showView('message'); $('#msgTitle').textContent = 'กำลังโหลด…'; $('#msgBody').textContent = ''; return; }
  if (a === 'me') {
    if (requireRole(['citizen', 'staff', 'admin'])) {
      if (auth.profile.role !== 'citizen') { location.replace(ROLE_HOME[auth.profile.role]); return; }   // เจ้าหน้าที่ใช้เมนู "ข้อความ" ในหน้างานแทน
      showView('me'); showMe(b === 'request');
    }
    return;
  }
  if (a === 'staff') { if (requireRole(['staff'])) { showView('staff'); showStaff(b); } return; }
  if (a === 'admin') { if (requireRole(['admin'])) { showView('admin'); showAdmin(b, parts[2]); } return; }
  message('ไม่พบหน้านี้', 'ลิงก์อาจไม่ถูกต้อง');
}

/* ---------- แถบเมนูด้านบน ---------- */
function renderNav() {
  const nav = $('#topNav');
  if (auth.session && auth.profile) {
    const p = auth.profile;
    const appLink = { admin: 'ผู้ดูแลระบบ', staff: 'ระบบเจ้าหน้าที่', citizen: 'ของฉัน' }[p.role];
    nav.innerHTML = `<a href="#/" data-route="home">หน้าหลัก</a><a href="${ROLE_HOME[p.role]}" data-route="${ROLE_HOME[p.role].slice(2)}">${appLink}${p.role === 'citizen' ? ' <span id="navMsgBadge" class="badge num"></span>' : ''}</a>`
      + `<span class="who-chip" title="${esc(p.email)}">${esc(p.full_name || p.email)}</span><a href="#" id="logoutLink">ออกจากระบบ</a>`;
    $('#logoutLink').addEventListener('click', (e) => { e.preventDefault(); signOut(); });
  } else {
    nav.innerHTML = '<a href="#/" data-route="home">หน้าหลัก</a><a href="#/login" class="cta" data-route="login">เข้าสู่ระบบ</a>';
  }
  setNavCurrent((location.hash.replace(/^#\/?/, '').split('/')[0]) || 'home');
}
function setNavCurrent(r) {
  $$('#topNav a[data-route]').forEach((a) => { if (a.dataset.route === r) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
}

/* ---------- ท้ายเว็บ: ความคิดเห็น + ตัวนับผู้เข้าชม ---------- */
function bindFooter() {
  $('#fbForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = $('#fbInput'), text = inp.value.trim(), m = $('#fbMsg');
    if (!text) return;
    if (!auth.session) { m.innerHTML = '<a href="#/login">เข้าสู่ระบบด้วย Google</a> ก่อนส่งความคิดเห็น'; return; }
    const btn = e.target.querySelector('button');
    busy(btn, true, '…');
    const { error } = await sb.from('feedback').insert({ body: text });
    busy(btn, false);
    if (error) { m.style.color = 'var(--error)'; m.textContent = errText(error); return; }
    inp.value = ''; m.style.color = 'var(--success)'; m.textContent = 'ส่งแล้ว ขอบคุณครับ';
  });
  let first = false;
  try { first = !sessionStorage.getItem('pcps_viewed'); sessionStorage.setItem('pcps_viewed', '1'); } catch {}
  (first ? sb.rpc('bump_home_views') : sb.from('site_stats').select('count').eq('key', 'home_views').single().then((r) => ({ data: r.data?.count })))
    .then(({ data }) => { if (data != null) $('#viewCount').textContent = 'เข้าชมเว็บไซต์ ' + Number(data).toLocaleString('th-TH') + ' ครั้ง'; });
}

/* ---------- เริ่มทำงาน ---------- */
function showAuthErrorFromUrl() {
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.includes('error') ? location.hash.slice(1) : '');
  const err = q.get('error_description') || h.get('error_description');
  if (err) { toast('เข้าสู่ระบบไม่สำเร็จ: ' + err, 'err'); history.replaceState(null, '', location.pathname + '#/login'); }
}

// เตือนเมื่อหน้า HTML กับไฟล์ JS คนละรุ่น (เบราว์เซอร์จำไฟล์เก่าไว้)
function checkVersion() {
  const js = new URL(import.meta.url).searchParams.get('v');
  const html = document.querySelector('meta[name="app-version"]')?.content;
  if (js && html && js !== html) toast('มีการอัปเดตเว็บ — กรุณากด Ctrl+Shift+R (มือถือ: ปิดแล้วเปิดใหม่)', 'err');
}

async function boot() {
  checkVersion();
  showAuthErrorFromUrl();
  bindSlider(); bindArticle(); bindFooter(); bindMoreSheets();
  $('#googleBtn').addEventListener('click', async () => {
    const btn = $('#googleBtn'); busy(btn, true, 'กำลังไปที่ Google…');
    const { error } = await signIn();
    if (error) { busy(btn, false); $('#loginMsg').textContent = errText(error); }
  });
  $('#srLoginBtn').addEventListener('click', async () => {   // ขอสิทธิ์เจ้าหน้าที่: login ก่อน แล้วไปกรอกคำขอที่หน้า "ของฉัน"
    if (auth.profile) { location.hash = auth.profile.role === 'citizen' ? '#/me/request' : ROLE_HOME[auth.profile.role]; return; }
    const btn = $('#srLoginBtn'); busy(btn, true, 'กำลังไปที่ Google…');
    const { error } = await signIn('#/me/request');
    if (error) { busy(btn, false); $('#loginMsg').textContent = errText(error); }
  });
  window.addEventListener('hashchange', route);
  route();                                     // แสดงหน้าสาธารณะทันที ไม่ต้องรอ login
  loadNews().then((list) => { renderSlides(list); }).catch(() => renderSlides([]));

  onAuth(() => {
    renderNav();
    stopChatWatch();
    if (auth.profile) startChatWatch();                      // ตัวเลขข้อความใหม่แบบ real-time
    renderCommentState();
    if (location.search.includes('code=')) history.replaceState(null, '', location.pathname + location.hash);
    const dest = takePostLoginRedirect();
    if (dest && location.hash !== dest) location.hash = dest; else route();
  });
  try { await initAuth(); }
  catch (e) { toast('เชื่อมต่อระบบไม่สำเร็จ: ' + errText(e), 'err'); }
}

boot();
