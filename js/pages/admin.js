// ผู้ดูแล: โครงหน้า + เมนู + ตัวเลขงานค้าง + ข้อเสนอแนะ (อยู่ใน ตั้งค่า › ข้อเสนอแนะ)
// ข่าว → admin-news.js · ตรวจประเมิน → admin-review.js · ข้อความ → chat.js · เยี่ยมบ้าน → visits.js · เอกสาร → docs.js
// ข้อมูลยา (#/admin/drugs/dose|db) → admin-settings.js initDoseAdmin + admin-drugs.js · Health Rider (#/admin/rider[/delivery]) → rider.js + delivery.js
// ตั้งค่า → admin-settings.js (ช่องทางติดต่อ) + admin-staff.js (บัญชีเจ้าหน้าที่) + admin-audit.js (ประวัติการเข้าถึงข้อมูลผู้ป่วย)
import { sb } from '../supabase.js?v=4.4';
import { $, $$, esc, thaiDate, toast, errText } from '../util.js?v=4.4';
import { auth } from '../auth.js?v=4.4';
import { loadUnits, unitName } from '../data.js?v=4.4';
import { setCurrent } from '../nav.js?v=4.4';
import { initAdminNews } from './admin-news.js?v=4.4';
import { initReview } from './admin-review.js?v=4.4';
import { mountVisits, ALL } from './visits.js?v=4.4';
import { initAdminDocs } from './docs.js?v=4.4';
import { initDoseAdmin, initContactsAdmin } from './admin-settings.js?v=4.4';
import { initDrugsAdmin, openDrugSection } from './admin-drugs.js?v=4.4';
import { initMimsAdmin } from './admin-mims.js?v=4.4';
import { initRpstAdmin } from './admin-rpst.js?v=4.4';
import { initDrugCenter, showDrugTab, setDrawer, drugPage } from './drug-center.js?v=4.4';
import { initDrugWork } from './drug-work.js?v=4.4';
import { initDrugTrash } from './drug-trash.js?v=4.4';
import { initDrugGrid } from './drug-grid.js?v=4.4';
import { initRoster } from './admin-staff.js?v=4.4';
import { initAudit } from './admin-audit.js?v=4.4';
import { initDeliveryAdmin } from './delivery.js?v=4.4';
import { initDeliveryReportAdmin } from './delivery-report.js?v=4.4';
import { mountRiderEditor } from './rider.js?v=4.4';
import { mountSummaries } from './summaries.js?v=4.4';
import { mountAch, visitTabs } from './staff.js?v=4.4';
import { mountInbox, unmountInbox } from './chat.js?v=4.4';
import { mountUnitChat, unmountUnitChat } from './unitchat.js?v=4.4';

export const ADMIN_TABS = { news: 'ข่าวประชาสัมพันธ์', messages: 'ข้อความ', visits: 'เยี่ยมบ้าน', achievements: 'ผลงานมาตรฐานความปลอดภัยด้านยา ในรพ.สต.', rider: 'จัดส่งยาถึงบ้าน · Health Rider', review: 'ตรวจประเมินผลงาน', docs: 'จัดการเอกสาร', drugs: 'ข้อมูลยา', settings: 'ตั้งค่า' };
const SUBS = { contacts: initContactsAdmin, staff: initRoster, audit: initAudit, feedback: () => initFeedback() };
// ย้ายจากตั้งค่า: ข้อมูลยา (คำนวณขนาดยา/ฐานข้อมูลยา) → เมนูข้อมูลยา · จัดส่งยาถึงบ้าน → เมนู Health Rider
const DB_PARTS = ['rpst', 'local', 'outside', 'nlem', 'fda', 'ddi', 'mims'];
const MOVED = { dose: '#/admin/drugs/dose', drugs: '#/admin/drugs/db', delivery: '#/admin/rider/delivery' };

export async function showAdmin(tab, sub) {
  if (tab === 'staff') { location.replace('#/admin/settings/staff'); return; }   // ลิงก์เดิมจากขั้น 4.1
  if (tab === 'feedback') { location.replace('#/admin/settings/feedback'); return; }   // ย้ายไปอยู่ในตั้งค่า
  if (tab === 'settings' && MOVED[sub]) { location.replace(MOVED[sub]); return; }
  if (!ADMIN_TABS[tab]) tab = 'news';
  adminHead();
  $('#adminViewTitle').textContent = ADMIN_TABS[tab];
  setCurrent('data-admin-tab', tab);
  $$('[data-admin-view]').forEach((v) => { v.hidden = v.dataset.adminView !== tab; });
  refreshAdminBadges();
  if (tab === 'news') return initAdminNews();
  if (tab === 'review') return initReview();
  if (tab === 'messages') return showMessages(sub);
  if (tab === 'visits') return showVisits(sub || null);
  if (tab === 'achievements') return showAch();
  if (tab === 'rider') {   // Health Rider + จัดส่งยาถึงบ้าน
    const d = sub === 'delivery';
    subTabs('#arTabs', d ? 'delivery' : 'rider');
    $$('[data-rider-sub]').forEach((v) => { v.hidden = v.dataset.riderSub !== (d ? 'delivery' : 'rider'); });
    if (d) { initDeliveryAdmin(); initDeliveryReportAdmin(); return; }
    return mountRiderEditor($('#adminRiderSlot'));
  }
  if (tab === 'drugs') {   // ข้อมูลยา
    // ไม่ระบุ/center = ภาพรวม (drug-center.js · หน้าแรก) · work = ทำงานทีละยา (drug-work.js) · grid = ตารางแก้ไขยา + นำเข้า/ส่งออก (drug-grid.js) · help = วิธีใช้
    // ai/dose/rpst/local/outside/nlem/fda/ddi/mims/db/tools = เครื่องมือฐานข้อมูล (แผงด้านขวา) เปิดที่ส่วนนั้น · หน้าด้านหลังแผง = หน้าที่เปิดอยู่ล่าสุด
    const page = !sub ? 'center' : ['work', 'center', 'grid', 'help'].includes(sub) ? sub : drugPage();
    subTabs('#dcTabs', page); showDrugTab(page);
    if (page === 'help') return;
    const v = sub === 'db' ? 'local' : DB_PARTS.includes(sub) || sub === 'ai' || sub === 'dose' ? sub : null;
    const drawer = !!sub && !['work', 'center', 'grid'].includes(sub);
    setDrawer(drawer, 'route');
    if (drawer) openDrugSection(v);
    const first = page === 'work' ? initDrugWork() : page === 'grid' ? initDrugGrid() : null;   // หน้าที่เปิดอยู่รับ "แก้ไขข้อมูลนี้" (pcps_drug_edit) ก่อน
    const run = Promise.all([initDrugsAdmin(), initDoseAdmin(), first]);
    initMimsAdmin(); initRpstAdmin();
    initDrugCenter(); initDrugTrash();
    return run;
  }
  if (tab === 'docs') return initAdminDocs();
  if (!SUBS[sub]) sub = 'contacts';
  subTabs('#asTabs', sub);
  $$('[data-admin-view="settings"] [data-admin-sub]').forEach((v) => { v.hidden = v.dataset.adminSub !== sub; });
  return SUBS[sub]();
}
function subTabs(sel, sub) {
  $$(`${sel} [data-sub]`).forEach((a) => {
    if (a.dataset.sub !== sub) { a.removeAttribute('aria-current'); return; }
    a.setAttribute('aria-current', 'page');
    a.parentNode.scrollLeft = a.offsetLeft - a.parentNode.offsetLeft - 16;   // มือถือ: แท็บที่เลือกต้องมองเห็น
  });
}

/** ตัวเลขงานค้างบนเมนู */
export async function refreshAdminBadges() {
  const [n, r, q, dz] = await Promise.all([
    sb.from('news').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('item_status').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    sb.from('staff_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('dose_drugs').select('id,audit_flags').eq('active', true),   // AI ตรวจย้อนหลังพบ (91)
  ]);
  const nAudit = (dz.data || []).reduce((a, x) => a + (Array.isArray(x.audit_flags) ? x.audit_flags.length : 0), 0);
  if ($('#admDrugsBadge')) $('#admDrugsBadge').textContent = nAudit ? String(nAudit) : '';
  $('#admNewsBadge').textContent = n.count ? String(n.count) : '';
  $('#admReviewBadge').textContent = r.count ? String(r.count) : '';
  $('#admSetBadge').textContent = $('#admReqBadge').textContent = q.count ? String(q.count) : '';   // คำร้องขอสิทธิ์เจ้าหน้าที่
}

/* ---------- ข้อความ: ห้องยา รพ. (ค่าเริ่มต้น) หรือดูกล่องของ รพ.สต. ---------- */
let msgTarget;   // รพ.สต. ที่เปิดดู (ประชาชนคุยกับ รพ.สต. เท่านั้น · ผู้ดูแลเข้าไปช่วยตอบได้) · null = ห้องยา รพ. เดิม (แสดงเมื่อยังมีห้องเก่า)
async function showMessages(sub) {
  const toUnits = sub === 'units';   // #/admin/messages/units = คุยกับ รพ.สต.
  $$('#ucAdminSwitch [data-uc]').forEach((a) => { if ((a.dataset.uc === 'admin') === toUnits) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $('#amCitizen').hidden = toUnits; $('#adminUnitChatSlot').hidden = !toUnits;
  if (toUnits) { unmountInbox(); return mountUnitChat($('#adminUnitChatSlot')); }
  unmountUnitChat();
  const units = await loadUnits();
  const { data } = await sb.from('conversations').select('target_unit,unread_staff');
  const unread = (t) => (data || []).filter((c) => (c.target_unit ?? null) === t).reduce((s, c) => s + c.unread_staff, 0);
  const legacy = (data || []).some((c) => c.target_unit == null);
  if (msgTarget === undefined || (msgTarget === null && !legacy)) msgTarget = (units.find((u) => unread(u.id)) || units[0])?.id ?? null;   // หน่วยที่มีข้อความค้างก่อน
  $('#amTargets').innerHTML = [...units.map((u) => u.id), ...(legacy ? [null] : [])].map((t) => {
    const n = unread(t);
    return `<button type="button" data-t="${t ?? ''}" aria-current="${t === msgTarget}">${t == null ? 'ห้องยา รพ. (ข้อความเดิม)' : 'รพ.สต.' + esc(unitName(t))}${n ? ` (${n})` : ''}</button>`;
  }).join('');
  $('#amTargets').onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; msgTarget = b.dataset.t === '' ? null : +b.dataset.t; showMessages(); };
  mountInbox($('#adminInboxSlot'), msgTarget);
}

/* ---------- เยี่ยมบ้าน: โรงพยาบาล (รวมทุกชื่อ) หรือเลือก รพ.สต. ---------- */
let visitUnit = ALL, visitSub = null;
async function showVisits(sub) {
  const units = await loadUnits();
  visitSub = sub;
  const openVisit = sub && sub !== 'summary' ? sub : null;
  if (openVisit) visitUnit = ALL;   // ลิงก์จากสรุปผลงาน → เปิดจากรายชื่อรวม (ผู้ป่วยอยู่หน่วยไหนก็เจอ)
  $('#avUnits').innerHTML = `<button type="button" data-u="${ALL}" aria-current="${visitUnit === ALL}">โรงพยาบาลควนกาหลง (รวมทุกชื่อ)</button>`
    + units.map((u) => `<button type="button" data-u="${u.id}" aria-current="${u.id === visitUnit}">${esc(u.name)}</button>`).join('');
  $('#avUnits').onclick = (e) => { const b = e.target.closest('[data-u]'); if (!b) return; visitUnit = b.dataset.u === ALL ? ALL : +b.dataset.u; showVisits(visitSub === 'summary' ? 'summary' : null); };
  if (visitTabs($('#vtAdminSwitch'), $('#adminVisitsSlot'), $('#adminSumSlot'), sub)) mountSummaries($('#adminSumSlot'), visitUnit === ALL ? 'all' : visitUnit);
  else mountVisits($('#adminVisitsSlot'), visitUnit, openVisit);   // ผู้ดูแลเพิ่ม/แก้สรุปผลงานได้ทุกหน่วย (เลือก รพ.สต. ในฟอร์ม)
}

/* ---------- ผลงาน รพ.สต. (ผู้ดูแล: ผลงานทุกหน่วย · เลือก/เปลี่ยน รพ.สต. ในฟอร์ม · ใช้หน้าเดียวกับเจ้าหน้าที่ staff.js mountAch) ---------- */
const showAch = () => mountAch($('#adminAchSlot'), 'all');

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

// แก้ชื่อในหน้าต่างข้อมูลส่วนตัว → คำทักทายหัวหน้าเปลี่ยนตาม
/** หัวหน้า: ชื่อ + ตำแหน่ง (จากบัญชีเจ้าหน้าที่) */
function adminHead() {
  $('#adminHello').textContent = 'สวัสดี ' + (auth.profile?.full_name || '');
  $('#adminSub').textContent = (auth.profile?.position ? auth.profile.position + ' · ' : '') + 'ผู้ดูแลระบบ · โรงพยาบาลควนกาหลง';
}
window.addEventListener('pcps:profile', () => { if (auth.profile) adminHead(); });
