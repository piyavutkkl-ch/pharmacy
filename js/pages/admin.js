// ผู้ดูแล: โครงหน้า + เมนู + ตัวเลขงานค้าง + ข้อเสนอแนะ
// ข่าว → admin-news.js · ตรวจประเมิน → admin-review.js · เยี่ยมบ้าน → visits.js · เอกสาร → docs.js
// ตั้งค่า → admin-settings.js (ยา, ช่องทางติดต่อ) + admin-staff.js (บัญชีเจ้าหน้าที่)
import { sb } from '../supabase.js?v=4.3.1';
import { $, $$, esc, thaiDate, toast, errText } from '../util.js?v=4.3.1';
import { auth } from '../auth.js?v=4.3.1';
import { loadUnits, unitName } from '../data.js?v=4.3.1';
import { setCurrent } from '../nav.js?v=4.3.1';
import { initAdminNews } from './admin-news.js?v=4.3.1';
import { initReview } from './admin-review.js?v=4.3.1';
import { mountVisits } from './visits.js?v=4.3.1';
import { initAdminDocs } from './docs.js?v=4.3.1';
import { initDoseAdmin, initContactsAdmin } from './admin-settings.js?v=4.3.1';
import { initRoster } from './admin-staff.js?v=4.3.1';

export const ADMIN_TABS = { news: 'ข่าวประชาสัมพันธ์', review: 'ตรวจประเมินผลงาน', visits: 'เยี่ยมบ้าน', docs: 'จัดการเอกสาร', feedback: 'ข้อเสนอแนะ', settings: 'ตั้งค่า' };
const SUBS = { dose: initDoseAdmin, contacts: initContactsAdmin, staff: initRoster };

export async function showAdmin(tab, sub) {
  if (tab === 'staff') { location.replace('#/admin/settings/staff'); return; }   // ลิงก์เดิมจากขั้น 4.1
  if (!ADMIN_TABS[tab]) tab = 'news';
  $('#adminHello').textContent = 'สวัสดี ' + (auth.profile.full_name || '');
  $('#adminViewTitle').textContent = ADMIN_TABS[tab];
  setCurrent('data-admin-tab', tab);
  $$('[data-admin-view]').forEach((v) => { v.hidden = v.dataset.adminView !== tab; });
  refreshAdminBadges();
  if (tab === 'news') return initAdminNews();
  if (tab === 'review') return initReview();
  if (tab === 'visits') return showVisits();
  if (tab === 'docs') return initAdminDocs();
  if (tab === 'feedback') return initFeedback();
  if (!SUBS[sub]) sub = 'dose';
  $$('#asTabs [data-sub]').forEach((a) => { if (a.dataset.sub === sub) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $$('[data-admin-sub]').forEach((v) => { v.hidden = v.dataset.adminSub !== sub; });
  return SUBS[sub]();
}

/** ตัวเลขงานค้างบนเมนู */
export async function refreshAdminBadges() {
  const [n, r] = await Promise.all([
    sb.from('news').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('item_status').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
  ]);
  $('#admNewsBadge').textContent = n.count ? String(n.count) : '';
  $('#admReviewBadge').textContent = r.count ? String(r.count) : '';
}

/* ---------- เยี่ยมบ้าน (เลือก รพ.สต.) ---------- */
let visitUnit = 0;
async function showVisits() {
  const units = await loadUnits();
  $('#avUnits').innerHTML = units.map((u) => `<button type="button" data-u="${u.id}" aria-current="${u.id === visitUnit}">${esc(u.name)}</button>`).join('');
  $('#avUnits').onclick = (e) => { const b = e.target.closest('[data-u]'); if (!b) return; visitUnit = +b.dataset.u; showVisits(); };
  mountVisits($('#adminVisitsSlot'), visitUnit);
}

/* ---------- ข้อเสนอแนะ ---------- */
let fbFilter = 'all';
async function initFeedback() {
  await loadUnits();
  $('#afList').innerHTML = '<div class="skeleton"></div>';
  const { data, error } = await sb.from('feedback').select('id,body,source,unit_id,created_at,author:profiles!feedback_author_id_fkey(full_name,email)').order('created_at', { ascending: false }).limit(300);
  if (error) { $('#afList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  const n = { all: data.length, staff: data.filter((f) => f.source === 'staff').length, public: data.filter((f) => f.source === 'public').length };
  $('#afFilter').innerHTML = [['all', 'ทั้งหมด'], ['staff', 'จากเจ้าหน้าที่'], ['public', 'จากหน้าเว็บ (ประชาชน)']]
    .map(([k, l]) => `<button type="button" data-f="${k}" aria-current="${fbFilter === k}">${l} (${n[k]})</button>`).join('');
  $('#afFilter').onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) { fbFilter = b.dataset.f; initFeedback(); } };
  const list = data.filter((f) => fbFilter === 'all' || f.source === fbFilter);
  $('#afList').innerHTML = list.length ? list.map((f) => `<div class="li"><div class="l"><b>${esc(f.body)}</b>`
    + `<span class="small muted">${esc(f.author?.full_name || f.author?.email || 'ไม่ระบุ')}${f.source === 'staff' ? ' · รพ.สต. ' + esc(unitName(f.unit_id)) : ' · ประชาชน'} · ${esc(thaiDate(f.created_at))}</span></div>`
    + `<button type="button" class="btn btn-no btn-sm" data-del="${f.id}">ลบ</button></div>`).join('') : '<p class="empty">ยังไม่มีข้อเสนอแนะ</p>';
  $('#afList').onclick = async (e) => {
    const b = e.target.closest('[data-del]'); if (!b || !confirm('ลบข้อเสนอแนะนี้?')) return;
    const { error: er } = await sb.from('feedback').delete().eq('id', +b.dataset.del);
    if (er) toast(errText(er), 'err'); else { toast('ลบแล้ว'); initFeedback(); }
  };
}
