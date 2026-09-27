// ผลการดำเนินงาน (ตัวเลขสรุป), ผลงาน รพ.สต., อันดับเกณฑ์มาตรฐาน, ช่องทางติดต่อ — ข้อมูลสาธารณะ ไม่มีข้อมูลรายบุคคล
import { sb, publicImageUrl } from '../supabase.js?v=4.4';
import { $, esc, art, thaiDate, fiscalYearOf } from '../util.js?v=4.4';
import { loadUnits, loadYears, unitName } from '../data.js?v=4.4';

const CUR_FY = fiscalYearOf();

/* ---------- ผลการดำเนินงาน ---------- */
let trkUnit = 'all', trkYear = CUR_FY, trkBound = false;

export async function initTracking() {
  const [units, years] = await Promise.all([loadUnits(), loadYears()]);
  if (!trkBound) {
    trkBound = true;
    $('#trackArt').innerHTML = art('visit');
    $('#trkUnitTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-u]'); if (!b) return; trkUnit = b.dataset.u === 'all' ? 'all' : +b.dataset.u; renderTracking(units, years); });
    $('#trkYearTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-y]'); if (!b) return; trkYear = +b.dataset.y; renderTracking(units, years); });
  }
  renderTracking(units, years);
}

async function renderTracking(units, years) {
  $('#trkUnitTabs').innerHTML = [`<button type="button" data-u="all" aria-current="${trkUnit === 'all'}">ทั้งอำเภอ</button>`]
    .concat(units.map((u) => `<button type="button" data-u="${u.id}" aria-current="${trkUnit === u.id}">${esc(u.name)}</button>`)).join('');
  $('#trkYearTabs').innerHTML = years.map((y) => `<button type="button" data-y="${y}" aria-current="${trkYear === y}">ปีงบประมาณ ${y}${y === CUR_FY ? ' (ปัจจุบัน)' : ''}</button>`).join('');
  ['#trkVisits', '#trkDrps', '#trkMedExcess'].forEach((s) => { $(s).textContent = '…'; });
  const { data, error } = await sb.rpc('public_tracking_stats', { p_year: trkYear, p_unit: trkUnit === 'all' ? null : trkUnit });
  const r = (!error && data && data[0]) || { visits: 0, drps_found: 0, drps_resolved: 0, excess_resolved: 0 };
  $('#trkVisits').textContent = r.visits.toLocaleString('th-TH');
  $('#trkDrps').textContent = `${r.drps_found} / ${r.drps_resolved}`;
  $('#trkMedExcess').textContent = r.excess_resolved.toLocaleString('th-TH');
}

/* ---------- ผลงาน รพ.สต. + อันดับ ---------- */
let lbYear = null, achBound = false;

export async function initAchievements() {
  const [units, years] = await Promise.all([loadUnits(), loadYears()]);
  const { data, error } = await sb.from('achievements').select('id,unit_id,title,image_path,created_at').order('created_at', { ascending: false }).limit(30);
  const list = error ? [] : data;
  $('#achGrid').innerHTML = list.length
    ? list.map((a) => `<div class="news-card"><div class="thumb">${a.image_path ? `<img src="${esc(publicImageUrl(a.image_path))}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block">` : art('รายงาน')}</div>`
      + `<div class="body"><span class="tag">รพ.สต. ${esc(unitName(a.unit_id))}</span><h3>${esc(a.title)}</h3><span class="d num">${esc(thaiDate(a.created_at))}</span></div></div>`).join('')
    : '<p class="empty" style="grid-column:1/-1">ยังไม่มีผลงานที่เผยแพร่</p>';

  const critYears = years.filter((y) => y <= CUR_FY);
  if (lbYear === null) lbYear = critYears.includes(CUR_FY) ? CUR_FY : critYears[critYears.length - 1];
  if (!achBound) {
    achBound = true;
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
