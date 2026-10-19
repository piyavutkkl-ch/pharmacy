// ผลการดำเนินงาน (ตัวเลขสรุป), ผลงาน รพ.สต., อันดับเกณฑ์มาตรฐาน, ช่องทางติดต่อ — ข้อมูลสาธารณะ ไม่มีข้อมูลรายบุคคล
import { sb, publicImageUrl } from '../supabase.js?v=4.4';
import { $, esc, art, thaiDate, fiscalYearOf, errText, toast } from '../util.js?v=4.4';
import { loadUnits, loadYears, unitName } from '../data.js?v=4.4';
import { loadSummaryList, renderSummaryPoster } from './summaries.js?v=4.4';
import { bindPosterNav } from './delivery.js?v=4.4';
import { smartCover } from '../lightbox.js?v=4.4';
import { paras } from './delivery.js?v=4.4';
import { sortItems } from '../data.js?v=4.4';
import { auth } from '../auth.js?v=4.4';

const CUR_FY = fiscalYearOf();

/* ---------- ผลการดำเนินงาน ---------- */
let trkUnit = 'all', trkYear = CUR_FY, trkBound = false;

export async function initTracking() {
  const [units, years] = await Promise.all([loadUnits(), loadYears()]);
  if (!trkBound) {
    trkBound = true;
    $('#trkUnitTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-u]'); if (!b) return; trkUnit = b.dataset.u === 'all' ? 'all' : +b.dataset.u; trkDaySel = null; renderTracking(units, years); });
    $('#trkYearTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-y]'); if (!b) return; trkYear = +b.dataset.y; trkMonth = defaultMonth(); trkDaySel = null; renderTracking(units, years); });
    document.querySelectorAll('[data-trk]').forEach((b) => b.addEventListener('click', () => { trkOpen = trkOpen === b.dataset.trk ? null : b.dataset.trk; renderTrkDetail(); }));
    $('#trkMonthTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; trkMonth = trkMonth === b.dataset.m ? null : b.dataset.m; trkDaySel = null; renderMonths(); loadCal(); });
    $('#trkCal').addEventListener('click', (e) => { const b = e.target.closest('[data-day]'); if (!b) return; trkDaySel = trkDaySel === b.dataset.day ? null : b.dataset.day; paintCal(); renderDay(); });
  }
  renderTracking(units, years);
  initLeaderboard(years);   // ใต้ "ผลงานด้านเภสัชกรรมปฐมภูมิ" = อันดับผลการประเมินเกณฑ์มาตรฐาน (เลือกปีงบของตัวเอง)
}

async function renderTracking(units, years) {
  $('#trkUnitTabs').innerHTML = [`<button type="button" data-u="all" aria-current="${trkUnit === 'all'}">ทั้งอำเภอ</button>`]
    .concat(units.map((u) => `<button type="button" data-u="${u.id}" aria-current="${trkUnit === u.id}">${esc(u.name)}</button>`)).join('');
  $('#trkYearTabs').innerHTML = years.map((y) => `<button type="button" data-y="${y}" aria-current="${trkYear === y}">ปีงบประมาณ ${y}${y === CUR_FY ? ' (ปัจจุบัน)' : ''}</button>`).join('');
  ['#trkVisits', '#trkDrps', '#trkMedExcess'].forEach((s) => { $(s).textContent = '…'; });
  loadSummaryList(trkUnit, trkYear).then((list) => { if (list) renderSummaryPoster($('#trackArt'), list, art('visit')); });   // กรอบ 10:7 = ภาพสรุปผลงานเยี่ยมบ้าน
  renderAchRow(trkUnit, trkYear);   // แถวล่าง = ผลงานด้านเภสัชกรรมปฐมภูมิ (เมนูผลงานของเจ้าหน้าที่)
  renderMonths(); loadCal();        // เลือกเดือน → ปฏิทินผลงานเยี่ยมบ้าน
  const { data, error } = await sb.rpc('public_tracking_stats', { p_year: trkYear, p_unit: trkUnit === 'all' ? null : trkUnit });
  const r = (!error && data && data[0]) || { visits: 0, drps_found: 0, drps_resolved: 0, excess_resolved: 0 };
  $('#trkVisits').textContent = r.visits.toLocaleString('th-TH');
  $('#trkDrps').textContent = `${r.drps_found} / ${r.drps_resolved}`;
  $('#trkMedExcess').textContent = r.excess_resolved.toLocaleString('th-TH');
  renderTrkDetail();
}

/* ---------- ปฏิทินผลงานเยี่ยมบ้าน: เลือกเดือน (ใต้ปีงบ) → ปฏิทินเดือนนั้น วงกลม = วันที่มีผลงาน → กดวัน = รายละเอียดด้านล่าง ----------
   ทุกคน: จำนวนการเยี่ยม/DRPs (public_visit_days · 72_visit_days.sql ตัวเลขรวม) + สรุปผลงานเยี่ยมบ้าน (summary_date) + ผลงานที่โพสต์วันนั้น
   เจ้าหน้าที่/ผู้ดูแล: + รายชื่อการเยี่ยมวันนั้น (RLS ของ visits + log_patient_access) */
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;   // วันที่ตามเวลาเครื่อง (ไทย)
/** เดือนของปีงบ (พ.ศ.) เรียง ต.ค. → ก.ย. เป็น 'YYYY-MM' (ค.ศ.) */
const fyMonths = (fy) => Array.from({ length: 12 }, (_, k) => { const y = fy - 543 - 1 + (k >= 3 ? 1 : 0), m = ((k + 9) % 12) + 1; return `${y}-${pad(m)}`; });
const defaultMonth = () => { const now = new Date(), m = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`; return fyMonths(trkYear).includes(m) ? m : null; };
let trkMonth = defaultMonth(), trkDaySel = null, calSeq = 0, cal = { days: new Map(), sums: [], achs: [] };

function renderMonths() {
  $('#trkMonthTabs').innerHTML = '<span class="small muted trk-mlbl">เลือกเดือน:</span>' + fyMonths(trkYear).map((m) => {
    const [y, mo] = m.split('-').map(Number);
    return `<button type="button" data-m="${m}" aria-current="${trkMonth === m}">${MONTHS[mo - 1]} ${String(y + 543).slice(2)}</button>`;
  }).join('');
}
async function loadCal() {
  const panel = $('#trkCalPanel'), seq = ++calSeq;
  panel.hidden = !trkMonth;
  if (!trkMonth) return;
  const [y, m] = trkMonth.split('-').map(Number), last = new Date(y, m, 0).getDate();
  const from = `${trkMonth}-01`, to = `${trkMonth}-${pad(last)}`, unit = trkUnit === 'all' ? null : trkUnit;
  $('#trkCalTitle').textContent = `ปฏิทินผลงานเยี่ยมบ้าน · ${MONTHS_FULL[m - 1]} ${y + 543}${unit ? ' · รพ.สต.' + unitName(unit) : ''}`;
  $('#trkCal').innerHTML = '<div class="skeleton"></div>'; $('#trkDay').innerHTML = '';
  let sq = sb.from('visit_summaries').select('id,unit_id,title,image_path,summary_date').gte('summary_date', from).lte('summary_date', to);
  let aq = sb.from('achievements').select('id,unit_id,title,image_path,created_at').eq('hidden', false)
    .gte('created_at', new Date(y, m - 1, 1).toISOString()).lt('created_at', new Date(y, m, 1).toISOString());
  if (unit) { sq = sq.eq('unit_id', unit); aq = aq.eq('unit_id', unit); }
  const [d, su, ac] = await Promise.all([sb.rpc('public_visit_days', { p_from: from, p_to: to, p_unit: unit }), sq, aq]);
  if (seq !== calSeq) return;
  cal = { days: new Map((d.data || []).map((r) => [String(r.day).slice(0, 10), r])), sums: su.data || [], achs: (ac.data || []).map((a) => ({ ...a, day: ymd(new Date(a.created_at)) })) };
  if (d.error) toast(errText(d.error), 'err');
  paintCal(); renderDay();
}
const dayHas = (k) => ({ v: cal.days.get(k)?.visits || 0, s: cal.sums.filter((x) => x.summary_date === k).length, a: cal.achs.filter((x) => x.day === k).length });
function paintCal() {
  if (!trkMonth) return;
  const [y, m] = trkMonth.split('-').map(Number), first = new Date(y, m - 1, 1).getDay(), last = new Date(y, m, 0).getDate(), today = ymd(new Date());
  const cells = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map((w) => `<span class="tc-h" role="columnheader">${w}</span>`).concat(Array.from({ length: first }, () => '<span class="tc-pad"></span>'));
  for (let dd = 1; dd <= last; dd++) {
    const k = `${trkMonth}-${pad(dd)}`, h = dayHas(k), any = h.v || h.s || h.a;
    const tip = [h.v && `เยี่ยม ${h.v} ครั้ง`, h.s && `สรุปผลงาน ${h.s}`, h.a && `ผลงาน ${h.a}`].filter(Boolean).join(' · ');
    cells.push(`<button type="button" class="tc-d${any ? ' has' : ''}${k === today ? ' today' : ''}" data-day="${k}" aria-pressed="${trkDaySel === k}" aria-label="${dd} ${MONTHS_FULL[m - 1]}${tip ? ' · ' + tip : ' · ไม่มีผลงาน'}"${any ? '' : ' disabled'}>`
      + `<span class="tc-n">${dd}</span>${h.v ? `<span class="tc-c num">${h.v}</span>` : ''}${h.s || h.a ? '<i class="tc-dot" aria-hidden="true"></i>' : ''}</button>`);
  }
  const n = [...cal.days.values()].reduce((t, r) => t + r.visits, 0);
  $('#trkCal').innerHTML = cells.join('') + `<p class="small muted tc-sum">เดือนนี้เยี่ยมบ้าน ${n.toLocaleString('th-TH')} ครั้ง · สรุปผลงาน ${cal.sums.length} · ผลงานที่โพสต์ ${cal.achs.length} · ตัวเลขในวงกลม = จำนวนการเยี่ยม · จุด = มีสรุปผลงาน/ผลงาน</p>`;
}
let daySeq = 0;
async function renderDay() {
  const box = $('#trkDay'), k = trkDaySel, seq = ++daySeq;
  if (!k) { box.innerHTML = ''; return; }
  const r = cal.days.get(k), sums = cal.sums.filter((x) => x.summary_date === k), achs = cal.achs.filter((x) => x.day === k);
  const thumb = (path, label) => (path ? `<img src="${esc(publicImageUrl(path))}" alt="" loading="lazy">` : `<span class="ach-art">${art(label)}</span>`);
  box.innerHTML = `<h3>ผลงานวันที่ ${esc(thaiDate(k))}</h3>`
    + (r ? `<div class="track-figs dl-figs"><div class="fig"><div class="n num">${r.visits.toLocaleString('th-TH')}</div><div class="t">จำนวนการออกเยี่ยม</div></div><div class="fig"><div class="n num">${r.drps_found} / ${r.drps_resolved}</div><div class="t">DRPs ที่พบ / แก้ไขสำเร็จ</div></div></div>` : '')
    + (sums.length || achs.length ? `<div class="poster-row trk-day-row">${sums.map((x) => `<a class="poster ach-poster" href="#/summary/${esc(x.id)}">${thumb(x.image_path, 'visit')}<span>${esc(x.title || 'สรุปผลงานเยี่ยมบ้าน')}<em class="small muted"> สรุปผลงานเยี่ยมบ้าน · รพ.สต.${esc(unitName(x.unit_id))}</em></span></a>`).join('')}`
      + `${achs.map((a) => `<a class="poster ach-poster" href="#/achievement/${esc(a.id)}">${thumb(a.image_path, 'รายงาน')}<span>${esc(a.title)}<em class="small muted"> ผลงาน · รพ.สต.${esc(unitName(a.unit_id))}</em></span></a>`).join('')}</div>` : '')
    + '<div class="trk-day-visits"></div>';
  if (!r) return;
  const vb = box.querySelector('.trk-day-visits');
  if (!isStaffish()) { vb.innerHTML = '<p class="small muted">รายชื่อผู้ป่วยที่เยี่ยม ดูได้เฉพาะเจ้าหน้าที่ รพ.สต. และผู้ดูแลระบบ · <a href="#/login">เข้าสู่ระบบ</a></p>'; return; }
  let q = sb.from('visits').select('id,visit_date,unit_id,patient_id,drps,drp_resolved,patient:patients(first_name,last_name)').eq('visit_date', k);
  if (trkUnit !== 'all') q = q.eq('unit_id', trkUnit);
  const { data, error } = await q.limit(200);
  if (seq !== daySeq) return;
  if (error) { vb.innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  [...new Set((data || []).map((v) => v.unit_id))].forEach((u) => sb.rpc('log_patient_access', { p_unit: u, p_patient: null }).then(() => {}, () => {}));   // PDPA
  const role = auth.profile.role;
  vb.innerHTML = (data || []).length ? `<div class="list trk-visits">${data.map((v) => `<a class="li" href="#/${role}/visits/${esc(v.id)}"><div class="l"><b>${esc(v.patient ? `${v.patient.first_name} ${v.patient.last_name}` : 'ผู้ป่วย')}</b>`
    + `<span class="small muted">รพ.สต.${esc(unitName(v.unit_id))} · ${v.drps?.length ? `DRPs ${v.drps.length} ข้อ${v.drp_resolved ? ' (แก้ไขสำเร็จ)' : ''}` : 'ไม่พบ DRPs'}</span></div></a>`).join('')}</div><p class="small muted">ข้อมูลผู้ป่วย · ใช้เพื่อการดูแลเท่านั้น · การเปิดดูถูกบันทึกตาม PDPA</p>`
    : `<p class="small muted">${role === 'staff' ? 'ไม่มีการเยี่ยมของ รพ.สต. ตัวเองในวันนี้ (หน่วยอื่นแสดงเฉพาะตัวเลข)' : 'ไม่พบรายการ'}</p>`;
}

/* กดตัวเลข → รายละเอียดใต้ตัวเลข: DRPs แยกชนิด (ทุกคน · ตัวเลขรวม) · รายการเยี่ยม (เฉพาะเจ้าหน้าที่/ผู้ดูแล · RLS + บันทึกการเปิดดู PDPA) */
let trkOpen = null, trkSeq = 0;
const isStaffish = () => ['staff', 'admin'].includes(auth.profile?.role);
async function renderTrkDetail() {
  const box = $('#trkDetail'), seq = ++trkSeq;
  $('#trkVisitsMore').hidden = !isStaffish();
  document.querySelectorAll('[data-trk]').forEach((b) => b.setAttribute('aria-expanded', String(trkOpen === b.dataset.trk)));
  box.hidden = !trkOpen;
  if (!trkOpen) return;
  const where = `${trkUnit === 'all' ? 'ทั้งอำเภอ' : 'รพ.สต.' + esc(unitName(trkUnit))} · ปีงบประมาณ ${trkYear}`;
  box.innerHTML = '<div class="skeleton"></div>';
  if (trkOpen === 'drps') {
    const { data, error } = await sb.rpc('public_drp_stats', { p_year: trkYear, p_unit: trkUnit === 'all' ? null : trkUnit });
    if (seq !== trkSeq) return;
    if (error) { box.innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
    const max = Math.max(1, ...(data || []).map((d) => d.found));
    box.innerHTML = `<h3>DRPs แยกตามชนิด <span class="small muted">${where} · เรียงจากพบมากไปน้อย</span></h3>`
      + ((data || []).length ? data.map((d) => `<div class="drp-row"><span>${esc(d.drp)}</span><span class="small num"><b>พบ ${d.found.toLocaleString('th-TH')}</b> · แก้ไขสำเร็จ ${d.resolved.toLocaleString('th-TH')} (${Math.round((d.resolved / d.found) * 100)}%)</span>`
        + `<span class="drp-bar" aria-hidden="true"><i style="width:${(d.found / max) * 100}%"></i></span><span class="drp-bar" aria-hidden="true"><i class="ok" style="width:${(d.resolved / max) * 100}%"></i></span></div>`).join('')
        + '<p class="small muted">แถบบน = พบ · แถบล่าง (เขียว) = แก้ไขสำเร็จ · นับจากบันทึกการเยี่ยมที่พบ DRP ชนิดนั้น</p>'
        : '<p class="empty">ยังไม่พบ DRPs ในช่วงนี้</p>');
    return;
  }
  if (!isStaffish()) { box.innerHTML = `<p class="empty">รายการเยี่ยม (ชื่อผู้ป่วย) ดูได้เฉพาะเจ้าหน้าที่ รพ.สต. และผู้ดูแลระบบ · <a href="#/login">เข้าสู่ระบบ</a></p>`; return; }
  let q = sb.from('visits').select('id,visit_date,unit_id,patient_id,drps,drp_resolved,patient:patients(first_name,last_name)').eq('fiscal_year', trkYear);
  if (trkUnit !== 'all') q = q.eq('unit_id', trkUnit);
  const { data, error } = await q.order('visit_date', { ascending: false }).limit(1000);
  if (seq !== trkSeq) return;
  if (error) { box.innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  [...new Set((data || []).map((v) => v.unit_id))].forEach((u) => sb.rpc('log_patient_access', { p_unit: u, p_patient: null }).then(() => {}, () => {}));   // PDPA
  const role = auth.profile.role, own = role === 'staff' && trkUnit === 'all';
  box.innerHTML = `<h3>รายการเยี่ยม <span class="small muted">${where} · ${(data || []).length} รายการ${own ? ' · แสดงเฉพาะผู้ป่วยของ รพ.สต. ตัวเอง' : ''}</span></h3>`
    + ((data || []).length ? `<div class="list trk-visits">${data.map((v) => `<a class="li" href="#/${role}/visits/${esc(v.id)}"><div class="l"><b>${esc(v.patient ? `${v.patient.first_name} ${v.patient.last_name}` : 'ผู้ป่วย')}</b>`
      + `<span class="small muted">เยี่ยมวันที่ ${esc(thaiDate(v.visit_date))} · รพ.สต.${esc(unitName(v.unit_id))} · ${v.drps?.length ? `DRPs ${v.drps.length} ข้อ${v.drp_resolved ? ' (แก้ไขสำเร็จ)' : ''}` : 'ไม่พบ DRPs'}</span></div></a>`).join('')}</div>`
      + '<p class="small muted">ข้อมูลผู้ป่วย · ใช้เพื่อการดูแลเท่านั้น · การเปิดดูถูกบันทึกตาม PDPA</p>'
      : '<p class="empty">ยังไม่มีการเยี่ยมในช่วงนี้</p>');
}

/** แถว "ผลงานด้านเภสัชกรรมปฐมภูมิ" ใต้ผลการดำเนินงาน: ผลงานที่เจ้าหน้าที่ส่งจากเมนูผลงาน ตาม รพ.สต./ปีงบที่เลือก (ปีงบนับจากวันที่ส่ง) */
let achSeq = 0, achRowBound = false, achRows = [];
async function renderAchRow(unit, year) {
  const row = $('#trkSums'), seq = ++achSeq;
  if (!achRowBound) {
    achRowBound = true; bindPosterNav(row);
  }
  row.innerHTML = '<div class="skeleton poster-skel"></div>';
  let q = sb.from('achievements').select('id,unit_id,title,body,image_path,created_at').eq('hidden', false);   // ระงับการแสดง = ไม่ขึ้นหน้าสาธารณะ
  if (unit !== 'all') q = q.eq('unit_id', unit);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(200);
  if (seq !== achSeq) return;
  achRows = (error ? [] : data).filter((a) => fiscalYearOf(new Date(a.created_at)) === year);
  row.innerHTML = achRows.length ? achRows.map((a) => `<a class="poster ach-poster" href="#/achievement/${esc(a.id)}" data-ach="${esc(a.id)}" aria-label="อ่านผลงาน ${esc(a.title)}">`
    + (a.image_path ? `<img src="${esc(publicImageUrl(a.image_path))}" alt="" loading="lazy">` : `<span class="ach-art">${art('รายงาน')}</span>`)
    + `<span>${esc(a.title)}<em class="small muted"> รพ.สต.${esc(unitName(a.unit_id))} · ${esc(thaiDate(a.created_at))}</em></span></a>`).join('')
    : `<p class="empty">ยังไม่มีผลงาน${unit === 'all' ? '' : 'ของ รพ.สต.' + esc(unitName(unit))} ในปีงบ ${year}</p>`;
  row.parentNode.querySelectorAll('[data-poster-nav]').forEach((b) => { b.hidden = achRows.length < 2; });
}

/* ---------- หน้าอ่านผลงาน #/achievement/<id> (แบบหน้าข่าว) ---------- */
export async function showAchievement(id) {
  ['#acTag', '#acTitle', '#acDate'].forEach((s) => { $(s).textContent = ''; });
  $('#acTitle').textContent = 'กำลังโหลด…'; $('#acBody').innerHTML = ''; $('#acCover').innerHTML = ''; $('#acCover').className = 'cover'; $('#acCrit').hidden = true; $('#acHidden').hidden = true;
  await loadUnits();
  const { data: a, error } = await sb.from('achievements').select('id,unit_id,title,body,image_path,item_ids,hidden,created_at').eq('id', id).maybeSingle();
  if (error || !a) { $('#acTitle').textContent = 'ไม่พบผลงานนี้'; $('#acBody').innerHTML = '<p class="muted">อาจถูกลบหรือระงับการแสดงแล้ว</p>'; return; }
  document.title = a.title + ' · Primary Care Pharmacy Services';
  $('#acTag').textContent = `ผลงาน รพ.สต.${unitName(a.unit_id)}`;
  $('#acTitle').textContent = a.title;
  $('#acDate').textContent = thaiDate(a.created_at);
  $('#acHidden').hidden = !a.hidden;
  if (a.image_path) smartCover($('#acCover'), publicImageUrl(a.image_path), a.title); else $('#acCover').innerHTML = art('รายงาน');
  $('#acBody').innerHTML = a.body ? paras(a.body) : '<p class="muted">ไม่มีรายละเอียดเพิ่มเติม</p>';
  if (a.item_ids?.length) {   // ข้อมาตรฐานที่ผลงานนี้เป็นหลักฐาน (เกณฑ์เป็นข้อมูลสาธารณะ)
    const { data: its } = await sb.from('criteria_items').select('id,item_no,body,sort,topic_no,sub_id,fiscal_year').in('id', a.item_ids);
    const list = sortItems(its || []);
    if (list.length) {
      $('#acCrit').innerHTML = '<h2>สอดคล้องกับมาตรฐาน</h2><ul class="ac-crit-list">' + list.map((it) => `<li><b>ข้อ ${esc(it.item_no)}</b> ${esc(it.body)} <span class="small muted">(ปีงบ ${it.fiscal_year})</span></li>`).join('') + '</ul>';
      $('#acCrit').hidden = false;
    }
  }
}

/* ---------- ผลงาน รพ.สต. (#/achievements) ---------- */

export async function initAchievements() {
  await loadUnits();
  const { data, error } = await sb.from('achievements').select('id,unit_id,title,image_path,created_at').eq('hidden', false).order('created_at', { ascending: false }).limit(30);
  const list = error ? [] : data;
  $('#achGrid').innerHTML = list.length
    ? list.map((a) => `<a class="news-card" href="#/achievement/${esc(a.id)}"><div class="thumb">${a.image_path ? `<img src="${esc(publicImageUrl(a.image_path))}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block">` : art('รายงาน')}</div>`
      + `<div class="body"><span class="tag">รพ.สต. ${esc(unitName(a.unit_id))}</span><h3>${esc(a.title)}</h3><span class="d num">${esc(thaiDate(a.created_at))}</span></div></a>`).join('')
    : '<p class="empty" style="grid-column:1/-1">ยังไม่มีผลงานที่เผยแพร่</p>';
}

/* ---------- อันดับเกณฑ์มาตรฐาน (อยู่ในช่องผลการดำเนินงาน ใต้ "ผลงานด้านเภสัชกรรมปฐมภูมิ") ---------- */
let lbYear = null, lbBound = false;
function initLeaderboard(years) {
  const critYears = years.filter((y) => y <= CUR_FY);
  if (lbYear === null) lbYear = critYears.includes(CUR_FY) ? CUR_FY : critYears[critYears.length - 1];
  if (!lbBound) {
    lbBound = true;
    $('#lbYearTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-y]'); if (!b) return; lbYear = +b.dataset.y; renderLeaderboard(critYears); });
  }
  renderLeaderboard(critYears);
}

async function renderLeaderboard(years) {
  $('#lbYearTabs').innerHTML = years.map((y) => `<button type="button" data-y="${y}" aria-current="${lbYear === y}">ปีงบ ${y}</button>`).join('');
  $('#lbPodium').innerHTML = '<div class="skeleton" style="width:60%;margin:24px auto"></div>';
  $('#lbList').innerHTML = '';
  const { data, error } = await sb.rpc('public_unit_scores', { p_year: lbYear });
  const ranked = error ? [] : data;
  const max = ranked[0]?.max_score || 0;
  if (!ranked.length || ranked.every((r) => r.score === 0)) {
    $('#lbPodium').innerHTML = `<p class="empty">ยังไม่มีผลการประเมินที่อนุมัติแล้วในปีงบ ${lbYear}</p>`;
    return;
  }
  const top3 = ranked.slice(0, 3);
  $('#lbPodium').innerHTML = '<div class="podium">' + [1, 0, 2].map((i) => {
    const r = top3[i]; if (!r) return '';
    return `<div class="podium-spot podium-${i + 1}"><span class="medal">${i + 1}</span><span class="pname">${esc(r.unit_name)}</span><div class="block"></div><span class="pscore num">${r.score}/${max} คะแนน</span></div>`;
  }).join('') + '</div>';
  $('#lbList').innerHTML = ranked.slice(3).map((r, i) => {
    const pct = max ? Math.round(r.score / max * 100) : 0;
    return `<div class="li"><div class="l"><b>อันดับ ${i + 4} · รพ.สต. ${esc(r.unit_name)}</b><span class="small muted">ปีงบประมาณ ${lbYear}</span></div><b class="num">${r.score}/${max} (${pct}%)</b></div>`;
  }).join('');
}

/* ---------- ช่องทางติดต่อ รพ.สต. ---------- */
export async function initContacts() {
  const units = await loadUnits(true);
  $('#contactGrid').innerHTML = units.map((u) => '<div class="center">'
    + (u.image_path ? `<div style="width:100%;aspect-ratio:16/9;border-radius:10px;overflow:hidden;margin-bottom:6px"><img src="${esc(publicImageUrl(u.image_path))}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block"></div>` : '')
    + `<span class="eyebrow">รพ.สต.</span><b>${esc(u.name)}</b>`
    + (u.phone ? `<a class="small" href="tel:${esc(u.phone.replace(/[^0-9+]/g, ''))}">โทร ${esc(u.phone)}</a>` : '<span class="small muted">ยังไม่ระบุเบอร์โทร</span>')
    + (u.address ? `<span class="small muted">${esc(u.address)}</span>` : '')
    + (u.note ? `<span class="small muted">${esc(u.note)}</span>` : '')
    + '</div>').join('');
}
