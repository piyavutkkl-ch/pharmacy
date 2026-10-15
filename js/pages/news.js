// ข่าวประชาสัมพันธ์: สไลด์หน้าแรก, รายการข่าว, หน้าอ่านข่าว (ถูกใจ / ความคิดเห็น / ผู้เข้าชม)
import { sb, publicImageUrl } from '../supabase.js?v=4.4';
import { $, esc, thaiDate, art, toast, errText, busy, deviceToken, fiscalYearOf } from '../util.js?v=4.4';
import { auth } from '../auth.js?v=4.4';
import { fileLink, extFileLink } from './news-form.js?v=4.4';
import { imageCarousel } from '../lightbox.js?v=4.4';
import { renderReaderQuiz } from './news-quiz.js?v=4.4';
import { loadTopics, topicOptions, topicMatch, topicChips } from './news-topics.js?v=4.4';

let news = null;          // cache ข่าวที่เผยแพร่แล้ว
const ANON_MAX = 15;      // ไม่ได้ login: ความคิดเห็นยาวได้ไม่เกิน 15 ตัวอักษร (ตรงกับ comment_news_anon ในฐานข้อมูล)
const chars = (t) => [...t].length;   // นับแบบเดียวกับ char_length ของ Postgres

let loading = null;

export function loadNews(force = false) {
  if (news && !force) return Promise.resolve(news);
  if (loading) return loading;
  loading = sb.from('news')
    .select('id,title,tag,body,image_path,published_at,comments_closed,view_count')
    .eq('status', 'published').order('published_at', { ascending: false }).limit(30)
    .then(({ data, error }) => {
      loading = null;
      if (error) { news = []; throw error; }
      news = data || [];
      return news;
    });
  return loading;
}

function cover(n) {
  return n.image_path
    ? `<img src="${esc(publicImageUrl(n.image_path))}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block">`
    : art(n.tag);
}

/* ---------- สไลด์ข่าวเด่น ---------- */
let cur = 0, timer = null, paused = false;
const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** สไลด์หน้าแรก: สลับข่าวแต่ละประเภท (ข่าว/ประชาสัมพันธ์/ความรู้) กับช่องอื่นของเว็บ (ผลการดำเนินงาน · จัดส่งยาถึงบ้าน · ข้อมูลยา) */
const FEATURES = [
  { href: '#/tracking', tag: 'ผลการดำเนินงาน', title: 'ผลการดำเนินงานเภสัชกรรมปฐมภูมิ', d: () => `เยี่ยมบ้าน DRPs และผลงาน รพ.สต. · ปีงบประมาณ ${fiscalYearOf()}`, art: 'รายงาน' },
  { href: '#/delivery', tag: 'บริการ', title: 'บริการจัดส่งยาถึงบ้าน · Health Rider', d: () => 'ผลการจัดส่งยาและบริการ Health Rider รายตำบล', art: 'visit' },
  { href: '#/dose', tag: 'ข้อมูลยา', title: 'ข้อมูลยา / คำนวณขนาดยา / คำนวณสารน้ำ', d: () => 'รายการยา รพ.สต. · บัญชียาหลักแห่งชาติ · เครื่องคำนวณ', art: '' },
];
export function mixSlides(list) {
  const by = ['ข่าว', 'ประชาสัมพันธ์', 'ความรู้'].map((t) => list.filter((n) => n.tag === t));
  const other = list.filter((n) => !['ข่าว', 'ประชาสัมพันธ์', 'ความรู้'].includes(n.tag));
  const news = [];
  for (let i = 0; news.length < 6 && i < 6; i++) by.forEach((g) => { if (g[i] && news.length < 6) news.push(g[i]); });
  other.forEach((n) => { if (news.length < 6) news.push(n); });
  const out = [];
  news.forEach((n, i) => { out.push({ news: n }); if (i % 2 === 0 && FEATURES[i / 2]) out.push({ feat: FEATURES[i / 2] }); });
  FEATURES.slice(Math.ceil(news.length / 2)).forEach((f) => out.push({ feat: f }));
  return out;
}
export function renderSlides(list) {
  const slides = $('#slides'), dots = $('#dots');
  const all = mixSlides(list || []);
  if (!(list || []).length) all.unshift({ empty: true });
  const label = (x) => (x.news ? x.news.title : x.feat ? x.feat.title : 'ยังไม่มีข่าวประชาสัมพันธ์');
  slides.innerHTML = all.map((x, i) => {
    const aria = `aria-roledescription="slide" aria-label="${i + 1} จาก ${all.length}: ${esc(label(x))}"`;
    if (x.empty) return `<div class="slide" ${aria}><div class="art">${art('')}</div><div class="cap"><span class="tag">ข่าว</span><b>ยังไม่มีข่าวประชาสัมพันธ์</b><span class="d">ข่าวที่ผู้ดูแลเผยแพร่จะแสดงที่นี่</span></div></div>`;
    if (x.feat) return `<a class="slide slide-feat" href="${x.feat.href}" ${aria}><div class="art">${art(x.feat.art)}</div><div class="cap"><span class="tag">${esc(x.feat.tag)}</span><b>${esc(x.feat.title)}</b><span class="d">${esc(x.feat.d())}</span></div></a>`;
    const n = x.news;
    return `<a class="slide" href="#/news/${n.id}" ${aria}><div class="art">${cover(n)}</div><div class="cap"><span class="tag">${esc(n.tag)}</span><b>${esc(n.title)}</b><span class="d num">${esc(thaiDate(n.published_at))}</span></div></a>`;
  }).join('');
  dots.innerHTML = all.map((_, i) => `<button type="button" data-dot="${i}" aria-label="สไลด์ที่ ${i + 1}"></button>`).join('');
  if (cur >= all.length) cur = 0;
  mark();
}
function count() { return $('#slides').querySelectorAll('.slide').length; }
function go(i) { const n = count(); if (!n) return; cur = (i + n) % n; $('#slides').scrollTo({ left: cur * $('#slides').clientWidth }); mark(); }
function mark() { document.querySelectorAll('#dots button').forEach((d, i) => d.setAttribute('aria-current', i === cur ? 'true' : 'false')); }
export function startAuto() { if (reduce || timer) return; timer = setInterval(() => { if (!paused && !document.hidden) go(cur + 1); }, 5000); }
export function stopAuto() { clearInterval(timer); timer = null; }

export function bindSlider() {
  const slides = $('#slides'), sl = $('#slider');
  let st;
  slides.addEventListener('scroll', () => { clearTimeout(st); st = setTimeout(() => { cur = Math.round(slides.scrollLeft / slides.clientWidth); mark(); }, 60); });
  $('#prev').addEventListener('click', () => { go(cur - 1); stopAuto(); startAuto(); });
  $('#next').addEventListener('click', () => { go(cur + 1); stopAuto(); startAuto(); });
  $('#dots').addEventListener('click', (e) => { const b = e.target.closest('[data-dot]'); if (b) { go(+b.dataset.dot); stopAuto(); startAuto(); } });
  ['mouseenter', 'focusin'].forEach((ev) => sl.addEventListener(ev, () => { paused = true; }));
  ['mouseleave', 'focusout'].forEach((ev) => sl.addEventListener(ev, () => { paused = false; }));
}

/* ---------- รายการข่าวหน้าแรก: 6 ข่าวล่าสุด ปัด/กด ‹ › ซ้าย-ขวา · ปุ่ม "ดูข่าวทั้งหมด" → #/news/all ---------- */
const HOME_NEWS = 6;
let gridBound = false;
function gridArrows() {
  const g = $('#newsGrid'), max = g.scrollWidth - g.clientWidth;
  $('#newsPrev').disabled = g.scrollLeft <= 4;
  $('#newsNext').disabled = g.scrollLeft >= max - 4;
}
function gridStep(dir) {
  const g = $('#newsGrid'), card = g.querySelector('.news-card');
  g.scrollBy({ left: dir * (card ? card.getBoundingClientRect().width + 16 : g.clientWidth), behavior: reduce ? 'auto' : 'smooth' });
}
export function renderNewsGrid(list) {
  if (!gridBound) {
    gridBound = true;
    $('#newsPrev').addEventListener('click', () => gridStep(-1));
    $('#newsNext').addEventListener('click', () => gridStep(1));
    let st; $('#newsGrid').addEventListener('scroll', () => { clearTimeout(st); st = setTimeout(gridArrows, 60); });
    window.addEventListener('resize', gridArrows);
  }
  const top = list.slice(0, HOME_NEWS);
  $('#newsGrid').innerHTML = top.length
    ? top.map((n) => `<a class="news-card" href="#/news/${n.id}"><div class="thumb">${cover(n)}</div>`
      + `<div class="body"><span class="tag">${esc(n.tag)}</span><h3>${esc(n.title)}</h3><span class="d num">${esc(thaiDate(n.published_at))}</span></div></a>`).join('')
    : '<p class="empty" style="grid-column:1/-1">ยังไม่มีข่าวประชาสัมพันธ์</p>';
  $('#newsGrid').scrollLeft = 0;
  $('#newsAllLink').hidden = !list.length;
  requestAnimationFrame(gridArrows);
}

/* ---------- หน้าข่าวทั้งหมด (#/news/all): เรียงแนวตั้ง + ค้นหา (หัวข้อ/เนื้อหา) · หมวด · จัดเรียง ---------- */
let all = null, allBound = false;
const plain = (t) => String(t || '').replace(/\s+/g, ' ').trim();
export async function showAllNews() {
  if (!allBound) {
    allBound = true;
    $('#nlSearch').addEventListener('input', renderAllNews);
    ['#nlTag', '#nlSort', '#nlTopic'].forEach((s) => $(s).addEventListener('change', renderAllNews));
  }
  $('#nlList').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  const [{ data, error }] = await Promise.all([sb.from('news').select('id,title,tag,body,image_path,published_at,view_count,topic_ids')
    .eq('status', 'published').order('published_at', { ascending: false }).limit(1000), loadTopics(true)]);
  topicOptions($('#nlTopic'));
  if (error) { $('#nlList').innerHTML = `<p class="empty">โหลดข่าวไม่สำเร็จ: ${esc(errText(error))}</p>`; toast(errText(error), 'err'); return; }
  all = data || [];
  renderAllNews();
}
function renderAllNews() {
  if (!all) return;
  const q = $('#nlSearch').value.trim().toLowerCase(), tag = $('#nlTag').value, sort = $('#nlSort').value, topic = $('#nlTopic').value || 'all';
  const t = (n) => Date.parse(n.published_at) || 0;
  const list = all.filter((n) => (tag === 'all' || n.tag === tag) && topicMatch(n, topic) && (!q || `${n.title} ${n.body || ''}`.toLowerCase().includes(q)))
    .sort(sort === 'old' ? (a, b) => t(a) - t(b) : sort === 'az' ? (a, b) => a.title.localeCompare(b.title, 'th') : sort === 'views' ? (a, b) => (b.view_count || 0) - (a.view_count || 0) || t(b) - t(a) : (a, b) => t(b) - t(a));
  $('#nlCount').textContent = `(${all.length})`;
  $('#nlFound').textContent = q || tag !== 'all' || topic !== 'all' ? `พบ ${list.length} ข่าว` : '';
  $('#nlList').innerHTML = list.length ? list.map((n) => `<a class="newsrow" href="#/news/${n.id}"><div class="thumb2 big">${cover(n)}</div>`
    + `<div class="l"><b>${esc(n.title)}</b>${(n.topic_ids || []).length ? `<span class="row-btns">${topicChips(n.topic_ids)}</span>` : ''}<span class="small muted">${esc(n.tag)} · ${esc(thaiDate(n.published_at))} · ${(n.view_count || 0).toLocaleString('th-TH')} ผู้เข้าชม</span>`
    + `<span class="small nl-ex">${esc(plain(n.body).slice(0, 200))}</span></div></a>`).join('')
    : `<p class="empty">${all.length ? 'ไม่พบข่าวที่ค้นหา' : 'ยังไม่มีข่าวประชาสัมพันธ์'}</p>`;
}

/* ---------- หน้าอ่านข่าว ---------- */
let current = null;
const viewed = new Set();

export async function showArticle(id) {
  current = null;
  $('#arTitle').textContent = 'กำลังโหลด…';
  $('#arTag').textContent = ''; $('#arDate').textContent = ''; $('#arBody').innerHTML = ''; $('#arCover').innerHTML = ''; $('#arCover').className = 'cover'; $('#arCover').removeAttribute('style'); $('#arFile').hidden = true;
  $('#arSource').hidden = true; $('#arAi').hidden = true;
  $('#arComments').innerHTML = ''; $('#arCommentMsg').textContent = ''; $('#arShareMsg').textContent = '';
  const { data: n, error } = await sb.from('news')
    .select('id,title,tag,body,image_path,file_path,file_name,published_at,comments_closed,view_count,ai_generated,source_url,source_title,source_file_url,gallery').eq('id', id).maybeSingle();
  if (error || !n) { $('#arTitle').textContent = 'ไม่พบข่าวนี้'; $('#arBody').innerHTML = '<p class="muted">ข่าวอาจถูกลบหรือยังไม่เผยแพร่</p>'; return; }
  current = n;
  document.title = n.title + ' · Primary Care Pharmacy Services';
  $('#arTag').textContent = n.tag;
  $('#arTitle').textContent = n.title;
  $('#arDate').textContent = thaiDate(n.published_at);
  const imgs = [n.image_path, ...(n.gallery || [])].filter(Boolean);   // หลายภาพ (เช่น ข่าวช่อง AI) = เลื่อนซ้าย-ขวา · ภาพเดียว = ใกล้เคียง A4 ไม่ครอบตัด · กดขยายได้
  if (imgs.length) imageCarousel($('#arCover'), imgs.map(publicImageUrl), n.title);
  else $('#arCover').innerHTML = cover(n);
  $('#arBody').innerHTML = String(n.body || '').split(/\n{1,}/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');
  $('#arFile').innerHTML = n.file_path ? fileLink(n) : n.source_file_url ? extFileLink(n.source_file_url, 'ดาวน์โหลดบทความฉบับเต็ม (PDF)') : ''; $('#arFile').hidden = !n.file_path && !n.source_file_url;
  $('#arAi').hidden = !n.ai_generated;
  renderReaderQuiz($('#arQuiz'), n.id).catch(() => {});   // แบบทดสอบท้ายข่าว (ผู้ดูแลตั้ง · ถ้ามี)
  if (n.source_url) {
    $('#arSource').innerHTML = `อ้างอิง: <a href="${esc(n.source_url)}" target="_blank" rel="noopener">${esc(n.source_title || 'บทความต้นฉบับ')}</a>`
      + (n.ai_generated ? ' · ศูนย์การศึกษาต่อเนื่องทางเภสัชศาสตร์ สภาเภสัชกรรม' : '');
    $('#arSource').hidden = false;
  }
  if (!viewed.has(n.id)) { viewed.add(n.id); sb.rpc('bump_news_view', { p_news: n.id }).then(() => {}); n.view_count += 1; }
  $('#arViewCount').textContent = n.view_count.toLocaleString('th-TH') + ' ผู้เข้าชม';
  renderCommentState();
  loadLikes();
  loadComments();
}

export function renderCommentState() {
  if (!current) return;
  const signedIn = !!auth.session;
  $('#arCommentsClosed').hidden = !current.comments_closed;
  $('#arCommentLogin').hidden = current.comments_closed || signedIn;   // ไม่ login: แจ้งว่าพิมพ์ได้ 15 ตัวอักษร
  $('#arCommentForm').hidden = current.comments_closed;
}

async function loadLikes() {
  if (!current) return;
  const id = current.id;
  const { data } = await sb.rpc('news_like_state', { p_news: id, p_token: auth.session ? null : deviceToken() });
  const st = (Array.isArray(data) ? data[0] : data) || { total: 0, mine: false };
  const mine = !!st.mine;
  if (current?.id !== id) return;
  $('#arLikeCount').textContent = st.total || 0;
  $('#arLikeBtn').classList.toggle('liked', mine);
  $('#arLikeBtn').setAttribute('aria-pressed', mine ? 'true' : 'false');
}

async function loadComments() {
  if (!current) return;
  const id = current.id;
  const { data, error } = await sb.from('news_comments').select('id,author_name,body,created_at').eq('news_id', id).order('created_at', { ascending: false }).limit(200);
  if (current?.id !== id) return;
  const list = error ? [] : data;
  $('#arCommentCount').textContent = list.length;
  $('#arComments').innerHTML = list.length
    ? list.map((c) => `<div class="li"><div class="l"><b>${esc(c.author_name || 'ผู้ใช้')}</b><span class="small">${esc(c.body)}</span><span class="small muted">${esc(thaiDate(c.created_at))}</span></div>`
      + (auth.profile?.role === 'admin' ? `<button type="button" class="btn btn-no btn-sm" data-del-comment="${c.id}">ลบ</button>` : '') + '</div>').join('')
    : '<p class="small muted">ยังไม่มีความคิดเห็น</p>';
}

export function bindArticle() {
  $('#arLikeBtn').addEventListener('click', async () => {
    if (!current) return;
    const btn = $('#arLikeBtn'); const liked = btn.classList.contains('liked');
    btn.disabled = true;
    const q = !auth.session ? sb.rpc('like_news_anon', { p_news: current.id, p_token: deviceToken(), p_on: !liked })   // ไม่ต้อง login
      : liked
      ? sb.from('news_likes').delete().eq('news_id', current.id).eq('user_id', auth.session.user.id)
      : sb.from('news_likes').insert({ news_id: current.id });
    const { error } = await q;
    btn.disabled = false;
    if (error) toast(errText(error), 'err');
    loadLikes();
  });
  $('#arComments').addEventListener('click', async (e) => {   // ผู้ดูแลลบความคิดเห็นไม่เหมาะสม
    const b = e.target.closest('[data-del-comment]'); if (!b || !confirm('ลบความคิดเห็นนี้?')) return;
    busy(b, true, '…');
    const { error } = await sb.from('news_comments').delete().eq('id', +b.dataset.delComment);
    busy(b, false);
    if (error) { toast(errText(error), 'err'); return; }
    toast('ลบความคิดเห็นแล้ว'); loadComments();
  });
  $('#arCommentText').addEventListener('input', () => {   // ไม่ login: นับตัวอักษร + เตือนเมื่อเกิน 15
    if (auth.session) return;
    const n = chars($('#arCommentText').value.trim()), m = $('#arCommentMsg');
    m.classList.toggle('err-text', n > ANON_MAX);
    m.innerHTML = n > ANON_MAX ? `เกิน ${ANON_MAX} ตัวอักษร — กรุณา<a href="#/login">เข้าสู่ระบบ</a>เพื่อเขียนแสดงความเห็นมากขึ้น` : (n ? `${n}/${ANON_MAX} ตัวอักษร` : '');
  });
  $('#arShareBtn').addEventListener('click', () => {
    const url = location.href;
    if (navigator.share) navigator.share({ title: current?.title || document.title, url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => { $('#arShareMsg').textContent = 'คัดลอกลิงก์แล้ว'; });
    else $('#arShareMsg').textContent = url;
  });
  $('#arCommentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = $('#arCommentText'), text = inp.value.trim(), msg = $('#arCommentMsg');
    if (!text || !current) return;
    if (!auth.session && chars(text) > ANON_MAX) {
      msg.innerHTML = `กรุณา<a href="#/login">เข้าสู่ระบบ</a>เพื่อเขียนแสดงความเห็นมากขึ้น (ตอนนี้ ${chars(text)} ตัวอักษร · ไม่ได้เข้าสู่ระบบ พิมพ์ได้ไม่เกิน ${ANON_MAX})`;
      msg.classList.add('err-text'); return;
    }
    msg.classList.remove('err-text');
    const btn = e.target.querySelector('button');
    busy(btn, true, 'กำลังส่ง…');
    const { error } = auth.session
      ? await sb.from('news_comments').insert({ news_id: current.id, body: text })
      : await sb.rpc('comment_news_anon', { p_news: current.id, p_body: text, p_token: deviceToken() });
    busy(btn, false);
    if (error) { msg.textContent = errText(error); msg.classList.add('err-text'); return; }
    inp.value = ''; $('#arCommentMsg').textContent = '';
    loadComments();
  });
}
