// บริการจัดส่งยาถึงบ้าน (ขั้น 21 + 104)
//   หน้าหลัก #/delivery: ฟีดโพสต์เลื่อนซ้าย-ขวา (หัวข้อ · รูปหลายรูป · เนื้อหา · แนบลิงก์/ตัวอย่าง YouTube Shorts & Facebook Reels · กดดูรายละเอียด) + ข้อความแนะนำบริการ (ข้อความต้อนรับ) → initDelivery()
//   ผู้ดูแล › จัดส่งยาถึงบ้าน: ฟอร์มโพสต์ประชาสัมพันธ์ + ข้อความแนะนำบริการ → initDeliveryAdmin()
import { sb, publicImageUrl } from '../supabase.js?v=4.4';
import { $, esc, toast, errText, busy, thaiDate } from '../util.js?v=4.4';
import { uploadPublicImage, removeFiles } from '../upload.js?v=4.4';
import { imageList } from './news-form.js?v=4.4';
import { imageCarousel } from '../lightbox.js?v=4.4';

/* ---------- แถวโปสเตอร์ / ฟีดเลื่อนซ้าย-ขวา (ใช้ร่วมกับผลงาน) ---------- */
/** ปุ่ม ‹ › ข้างแถวเลื่อนซ้าย-ขวา (อยู่ใน .poster-wrap เดียวกัน) */
export function bindPosterNav(row) {
  row.parentNode.querySelectorAll('[data-poster-nav]').forEach((b) => b.addEventListener('click', () => {
    row.scrollBy({ left: (b.dataset.posterNav === 'next' ? 1 : -1) * row.clientWidth * 0.8, behavior: 'smooth' });
  }));
}
/** โปสเตอร์ [{title,image_path,tag?}] → แถวเลื่อนซ้าย-ขวา · กดเปิดภาพเต็ม */
export function renderPosterRow(row, list, alt) {
  row.innerHTML = list.length ? list.map((x) => `<a class="poster" href="${esc(publicImageUrl(x.image_path))}" target="_blank" rel="noopener">`
    + `<img src="${esc(publicImageUrl(x.image_path))}" alt="${esc(x.title || alt)}" loading="lazy">`
    + (x.title || x.tag ? `<span>${esc(x.title || '')}${x.tag ? `<em class="small muted"> ${esc(x.tag)}</em>` : ''}</span>` : '') + '</a>').join('')
    : '<p class="empty">ยังไม่มีโปสเตอร์</p>';
  row.parentNode.querySelectorAll('[data-poster-nav]').forEach((b) => { b.hidden = list.length < 2; });
}
export const paras = (t) => String(t || '').split(/\n+/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');

/* ---------- ตรวจจับลิงก์และตัวอย่างวิดีโอ (YouTube Shorts / YouTube / Facebook Reels) ---------- */
const SAFE_HTTPS = /^https:\/\/[^\s]+$/i;
const LINK_IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const PLAY_IC = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

/** แยกลิงก์ https:// → ประเภทสื่อ (youtube-short / youtube / fb-reel / fb-video / link) */
export function parseMediaLink(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!SAFE_HTTPS.test(url)) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\.|^m\./i, '').toLowerCase();
  // YouTube Shorts / Watch / youtu.be
  if (host === 'youtube.com' || host === 'youtu.be') {
    let id = null, isShort = false;
    if (host === 'youtu.be') {
      id = u.pathname.replace(/^\/+/, '').split('/')[0];
    } else if (/^\/shorts\/([A-Za-z0-9_-]{6,})/.test(u.pathname)) {
      id = u.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{6,})/)[1];
      isShort = true;
    } else if (/^\/embed\/([A-Za-z0-9_-]{6,})/.test(u.pathname)) {
      id = u.pathname.match(/^\/embed\/([A-Za-z0-9_-]{6,})/)[1];
    } else if (u.searchParams.get('v')) {
      id = u.searchParams.get('v');
    }
    if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id)) {
      return {
        kind: isShort ? 'youtube-short' : 'youtube',
        badge: isShort ? 'YouTube Shorts' : 'YouTube',
        vertical: isShort,
        url,
        id,
        embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
        thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      };
    }
  }
  // Facebook Reels / Video / fb.watch
  if (host === 'facebook.com' || host === 'fb.watch' || host === 'web.facebook.com') {
    const isReel = /\/reel\/|\/reels\//i.test(u.pathname);
    const isVid = isReel || /\/videos\/|\/watch/i.test(u.pathname) || host === 'fb.watch';
    if (isVid) {
      return {
        kind: isReel ? 'fb-reel' : 'fb-video',
        badge: isReel ? 'Facebook Reels' : 'Facebook Video',
        vertical: isReel,
        url,
        embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false&width=${isReel ? 320 : 560}`,
        thumb: null,
      };
    }
  }
  return { kind: 'link', badge: host, vertical: false, url, embedUrl: null, thumb: null };
}

function normLinks(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const m = parseMediaLink(item.url);
    if (!m) continue;
    const label = String(item.label || '').trim().slice(0, 200) || defaultLinkLabel(m);
    out.push({ url: m.url, label, media: m });
  }
  return out;
}

function defaultLinkLabel(m) {
  if (m.kind === 'youtube-short') return 'ดูคลิป YouTube Shorts';
  if (m.kind === 'youtube') return 'ดูวิดีโอ YouTube';
  if (m.kind === 'fb-reel') return 'ดูคลิป Facebook Reels';
  if (m.kind === 'fb-video') return 'ดูวิดีโอ Facebook';
  return m.badge || 'เปิดลิงก์';
}

/* ======================= หน้าหลัก (#/delivery) ======================= */
let dlBound = false, pubPosts = [];

export async function initDelivery() {
  if (!dlBound) {
    dlBound = true;
    bindPosterNav($('#dlPosters'));
    $('#dlPosters').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-dl-open]');
      if (!btn) return;
      const post = pubPosts.find((p) => p.id === +btn.dataset.dlOpen);
      if (post) openPostDialog(post);
    });
    const dlg = $('#dlPostDialog');
    $('#dlPostDlgClose')?.addEventListener('click', () => dlg.close());
    dlg?.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg?.addEventListener('close', () => { $('#dlPostDlgBody').innerHTML = ''; });   // หยุดวิดีโอเมื่อปิดหน้าต่าง
  }
  $('#dlPosters').innerHTML = '<div class="skeleton poster-skel"></div>';
  const [p, t] = await Promise.all([
    sb.from('delivery_posts').select('id,title,body,image_path,gallery,links,sort,created_at').order('sort').order('created_at', { ascending: false }),
    sb.from('site_texts').select('body').eq('key', 'delivery_info').maybeSingle(),
  ]);
  pubPosts = p.data || [];
  renderPostFeed($('#dlPosters'), pubPosts);
  $('#dlInfo').innerHTML = paras(t.data?.body) || '<p class="muted">ยังไม่มีข้อมูลบริการ</p>';
}

function renderPostFeed(row, list) {
  if (!list.length) {
    row.innerHTML = '<p class="empty">ยังไม่มีโพสต์ประชาสัมพันธ์บริการจัดส่งยาถึงบ้าน</p>';
    row.parentNode.querySelectorAll('[data-poster-nav]').forEach((b) => { b.hidden = true; });
    return;
  }
  row.innerHTML = list.map((x) => {
    const imgs = [x.image_path, ...(Array.isArray(x.gallery) ? x.gallery : [])].filter(Boolean);
    const links = normLinks(x.links);
    const video = links.find((l) => l.media.embedUrl);
    let mediaHtml = '';
    if (imgs.length) {
      mediaHtml = `<button type="button" class="dl-post-media" data-dl-open="${x.id}" aria-label="ดูรายละเอียด ${esc(x.title)}">`
        + `<img src="${esc(publicImageUrl(imgs[0]))}" alt="${esc(x.title)}" loading="lazy">`
        + (imgs.length > 1 ? `<span class="dl-media-tag right">+${imgs.length - 1} รูป</span>` : '')
        + (video ? `<span class="dl-media-tag left">${PLAY_IC} ${esc(video.media.badge)}</span>` : '')
        + `</button>`;
    } else if (video?.media.thumb) {
      mediaHtml = `<button type="button" class="dl-post-media is-video" data-dl-open="${x.id}" aria-label="ดูวิดีโอ ${esc(x.title)}">`
        + `<img src="${esc(video.media.thumb)}" alt="${esc(x.title)}" loading="lazy">`
        + `<span class="dl-play-badge">${PLAY_IC}</span>`
        + `<span class="dl-media-tag left">${esc(video.media.badge)}</span>`
        + `</button>`;
    } else if (video) {
      mediaHtml = `<button type="button" class="dl-post-media is-fb" data-dl-open="${x.id}" aria-label="ดูวิดีโอ ${esc(x.title)}">`
        + `<span class="dl-play-badge">${PLAY_IC}</span>`
        + `<span class="dl-fb-label">${esc(video.media.badge)}</span>`
        + `</button>`;
    }
    const excerpt = String(x.body || '').trim();
    const linkChips = links.length ? `<div class="dl-post-links">`
      + links.slice(0, 2).map((l) => `<a class="dl-link-chip" href="${esc(l.url)}" target="_blank" rel="noopener">${l.media.embedUrl ? PLAY_IC : LINK_IC}<span>${esc(l.label)}</span></a>`).join('')
      + (links.length > 2 ? `<span class="small muted">+${links.length - 2} ลิงก์</span>` : '')
      + `</div>` : '';
    return `<article class="dl-post-card" data-dl-post="${x.id}">`
      + mediaHtml
      + `<div class="dl-post-body">`
      + `<h3>${esc(x.title)}</h3>`
      + (excerpt ? `<p class="dl-post-excerpt">${esc(excerpt)}</p>` : '')
      + linkChips
      + `</div>`
      + `<div class="dl-post-foot">`
      + `<span class="small muted">${x.created_at ? esc(thaiDate(x.created_at)) : ''}</span>`
      + `<button type="button" class="btn btn-o btn-sm" data-dl-open="${x.id}">ดูรายละเอียด ›</button>`
      + `</div></article>`;
  }).join('');
  row.parentNode.querySelectorAll('[data-poster-nav]').forEach((b) => { b.hidden = list.length < 2; });
}

function openPostDialog(post) {
  const dlg = $('#dlPostDialog');
  $('#dlPostDlgTitle').textContent = post.title || 'รายละเอียดโพสต์';
  const imgs = [post.image_path, ...(Array.isArray(post.gallery) ? post.gallery : [])].filter(Boolean).map(publicImageUrl);
  const links = normLinks(post.links);
  const videos = links.filter((l) => l.media.embedUrl);
  const body = $('#dlPostDlgBody');

  const videosHtml = videos.length ? `<div class="dl-embeds">`
    + videos.map((v) => `<div class="dl-embed-card">`
      + `<div class="dl-embed ${v.media.vertical ? 'vertical' : 'wide'}">`
      + `<iframe src="${esc(v.media.embedUrl)}" title="${esc(v.label)}" loading="lazy" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin"></iframe>`
      + `</div>`
      + `<div class="dl-embed-bar"><span class="small muted">${esc(v.media.badge)} · ${esc(v.label)}</span>`
      + `<a class="btn btn-o btn-sm" href="${esc(v.url)}" target="_blank" rel="noopener">เปิดดูต้นฉบับ ↗</a></div>`
      + `</div>`).join('')
    + `</div>` : '';

  const linksHtml = links.length ? `<div class="dl-dlg-links"><h4>ลิงก์แนบ</h4><div class="dl-link-list">`
    + links.map((l) => `<a class="file-link" href="${esc(l.url)}" target="_blank" rel="noopener">${l.media.embedUrl ? PLAY_IC : LINK_IC}<span>${esc(l.label)}</span><em class="small muted"> (${esc(l.media.badge)})</em></a>`).join('')
    + `</div></div>` : '';

  body.innerHTML = (post.created_at ? `<p class="small muted">เผยแพร่ ${esc(thaiDate(post.created_at))}</p>` : '')
    + (imgs.length ? `<div class="cover" id="dlPostDlgCover"></div>` : '')
    + videosHtml
    + (post.body ? `<div class="article-body">${paras(post.body)}</div>` : '')
    + linksHtml;

  if (imgs.length) imageCarousel($('#dlPostDlgCover'), imgs, post.title || 'รูปภาพประกอบ');
  if (!dlg.open) dlg.showModal();
}

/* ======================= ผู้ดูแล (#/admin/rider) ======================= */
let adminBound = false, adminPosts = [], imgPicker = null, editId = null, formLinks = [];

export async function initDeliveryAdmin() {
  if (!adminBound) {
    adminBound = true;
    imgPicker = imageList($('#daImage'), $('#daImagePreview'), $('#daImageNote'));
    $('#daLinkAdd').addEventListener('click', addLinkFromInput);
    $('#daLinkUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLinkFromInput(); } });
    $('#daLinksList').addEventListener('click', onLinksListClick);
    $('#daAdd').addEventListener('click', savePost);
    $('#daCancel').addEventListener('click', resetForm);
    $('#daList').addEventListener('click', onPostList);
    $('#daList').addEventListener('change', onPostSort);
    $('#daInfoSave').addEventListener('click', saveInfo);
  }
  const t = await sb.from('site_texts').select('body').eq('key', 'delivery_info').maybeSingle();
  $('#daInfo').value = t.data?.body || '';
  await loadAdminPosts();
}

function renderFormLinks() {
  const box = $('#daLinksList');
  box.hidden = !formLinks.length;
  box.innerHTML = formLinks.map((l, i) => {
    const m = parseMediaLink(l.url);
    return `<div class="dl-link-item"><div class="l"><span class="chip">${esc(m?.badge || 'ลิงก์')}</span><b>${esc(l.label)}</b><span class="small muted">${esc(l.url)}</span></div>`
      + `<button type="button" class="btn btn-no btn-sm" data-rmlink="${i}" aria-label="ลบลิงก์">ลบ</button></div>`;
  }).join('');
}

function addLinkFromInput(silentEmpty = false) {
  const urlEl = $('#daLinkUrl'), lblEl = $('#daLinkLabel');
  const raw = urlEl.value.trim();
  if (!raw) { if (!silentEmpty) { toast('กรุณาวางลิงก์ https:// ก่อน', 'err'); urlEl.focus(); } return true; }
  const m = parseMediaLink(raw);
  if (!m) { toast('กรุณาวางลิงก์ที่ขึ้นต้นด้วย https:// เท่านั้น', 'err'); urlEl.focus(); return false; }
  if (formLinks.length >= 10) { toast('แนบลิงก์ได้สูงสุด 10 ลิงก์ต่อโพสต์', 'err'); return false; }
  const label = lblEl.value.trim().slice(0, 200) || defaultLinkLabel(m);
  formLinks.push({ url: m.url, label });
  urlEl.value = ''; lblEl.value = '';
  renderFormLinks();
  return true;
}

function onLinksListClick(e) {
  const b = e.target.closest('[data-rmlink]');
  if (!b) return;
  formLinks.splice(+b.dataset.rmlink, 1);
  renderFormLinks();
}

function resetForm() {
  editId = null;
  formLinks = [];
  $('#daFormTitle').textContent = 'โพสต์บริการจัดส่งยาถึงบ้าน';
  $('#daTitle').value = '';
  $('#daBody').value = '';
  $('#daLinkUrl').value = '';
  $('#daLinkLabel').value = '';
  $('#daAdd').textContent = 'โพสต์บริการจัดส่งยา';
  $('#daCancel').hidden = true;
  imgPicker.set([]);
  renderFormLinks();
}

async function loadAdminPosts() {
  const { data, error } = await sb.from('delivery_posts').select('id,title,body,image_path,gallery,links,sort,created_at').order('sort').order('created_at', { ascending: false });
  if (error) { $('#daList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  adminPosts = data || [];
  $('#daList').innerHTML = adminPosts.length ? adminPosts.map((x) => {
    const imgs = [x.image_path, ...(Array.isArray(x.gallery) ? x.gallery : [])].filter(Boolean);
    const links = normLinks(x.links);
    const thumb = imgs.length ? `<img src="${esc(publicImageUrl(imgs[0]))}" alt="">`
      : `<div class="dl-admin-thumb">${links.some((l) => l.media.embedUrl) ? PLAY_IC : LINK_IC}</div>`;
    const meta = [
      imgs.length ? `${imgs.length} รูป` : null,
      links.length ? `${links.length} ลิงก์` : null,
      x.body ? 'มีเนื้อหา' : null,
    ].filter(Boolean).join(' · ') || 'ไม่มีสื่อแนบ';
    return `<div class="da-poster" data-post-id="${x.id}">${thumb}`
      + `<div class="l"><b>${esc(x.title)}</b><span class="small muted">${esc(meta)}</span>`
      + `<label class="small">ลำดับ <input class="input da-sort" type="number" inputmode="numeric" value="${x.sort}" data-sort="${x.id}" aria-label="ลำดับโพสต์"></label></div>`
      + `<div class="row-btns"><button type="button" class="btn btn-o btn-sm" data-edit="${x.id}">แก้ไข</button>`
      + `<button type="button" class="btn btn-no btn-sm" data-del="${x.id}">ลบ</button></div></div>`;
  }).join('')
    : '<p class="empty">ยังไม่มีโพสต์ · เขียนโพสต์ใหม่ได้จากฟอร์มด้านบน</p>';
}

async function savePost() {
  const title = $('#daTitle').value.trim();
  if (!title) { toast('กรุณากรอกหัวข้อโพสต์', 'err'); $('#daTitle').focus(); return; }
  if (!addLinkFromInput(true)) return;   // ถ้าวางลิงก์ค้างไว้ในช่อง ดึงเข้าลิสต์ให้เลย
  const body = $('#daBody').value.trim();
  const btn = $('#daAdd');
  busy(btn, true, editId ? 'กำลังบันทึก…' : 'กำลังโพสต์…');
  const uploaded = [];
  try {
    await imgPicker.ready();
    const paths = [];
    for (const item of imgPicker.items()) {
      if (item.path) { paths.push(item.path); continue; }
      const path = await uploadPublicImage(item.blob, 'delivery');
      uploaded.push(path);
      paths.push(path);
    }
    const payload = {
      title,
      body,
      image_path: paths[0] || null,
      gallery: paths.slice(1),
      links: formLinks.map((l) => ({ url: l.url, label: l.label })),
      updated_at: new Date().toISOString(),
    };
    if (editId) {
      const old = adminPosts.find((p) => p.id === editId);
      const { error } = await sb.from('delivery_posts').update(payload).eq('id', editId);
      if (error) throw error;
      const keep = new Set(paths);
      const oldImgs = [old?.image_path, ...(Array.isArray(old?.gallery) ? old.gallery : [])].filter((p) => p && !keep.has(p));
      if (oldImgs.length) removeFiles('public-images', oldImgs);
      toast('บันทึกการแก้ไขโพสต์แล้ว');
    } else {
      payload.sort = adminPosts.length ? Math.min(...adminPosts.map((x) => x.sort)) - 1 : 0;   // โพสต์ใหม่ขึ้นต้นสุด
      const { error } = await sb.from('delivery_posts').insert(payload);
      if (error) throw error;
      toast('โพสต์บริการจัดส่งยาแล้ว');
    }
    resetForm();
    await loadAdminPosts();
  } catch (err) {
    if (uploaded.length) removeFiles('public-images', uploaded);
    toast(errText(err), 'err');
  } finally {
    busy(btn, false);
  }
}

async function onPostList(e) {
  const ed = e.target.closest('[data-edit]');
  if (ed) {
    const x = adminPosts.find((p) => p.id === +ed.dataset.edit);
    if (!x) return;
    editId = x.id;
    $('#daFormTitle').textContent = `แก้ไขโพสต์: ${x.title}`;
    $('#daTitle').value = x.title || '';
    $('#daBody').value = x.body || '';
    $('#daLinkUrl').value = '';
    $('#daLinkLabel').value = '';
    imgPicker.set([x.image_path, ...(Array.isArray(x.gallery) ? x.gallery : [])]);
    formLinks = normLinks(x.links).map((l) => ({ url: l.url, label: l.label }));
    renderFormLinks();
    $('#daAdd').textContent = 'บันทึกการแก้ไข';
    $('#daCancel').hidden = false;
    $('#daFormTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const b = e.target.closest('[data-del]');
  if (!b) return;
  const x = adminPosts.find((p) => p.id === +b.dataset.del);
  if (!x || !confirm(`ลบโพสต์ "${x.title}"?`)) return;
  const { error } = await sb.from('delivery_posts').delete().eq('id', x.id);
  if (error) { toast(errText(error), 'err'); return; }
  const imgs = [x.image_path, ...(Array.isArray(x.gallery) ? x.gallery : [])].filter(Boolean);
  if (imgs.length) removeFiles('public-images', imgs);
  if (editId === x.id) resetForm();
  toast('ลบโพสต์แล้ว');
  loadAdminPosts();
}

async function onPostSort(e) {
  const i = e.target.closest('[data-sort]'); if (!i) return;
  const { error } = await sb.from('delivery_posts').update({ sort: Math.round(+i.value || 0), updated_at: new Date().toISOString() }).eq('id', +i.dataset.sort);
  if (error) { toast(errText(error), 'err'); return; }
  toast('บันทึกลำดับแล้ว'); loadAdminPosts();
}

async function saveInfo() {
  const btn = $('#daInfoSave'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = await sb.from('site_texts').upsert({ key: 'delivery_info', body: $('#daInfo').value.trim() });
  busy(btn, false);
  if (error) toast(errText(error), 'err'); else toast('บันทึกข้อความแล้ว');
}
