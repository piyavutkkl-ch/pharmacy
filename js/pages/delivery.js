// บริการจัดส่งยาถึงบ้าน (ขั้น 21)
//   หน้าหลัก #/delivery: โปสเตอร์เลื่อนซ้าย-ขวา + ข้อความแนะนำ + สถิติการจัดส่ง (ตัวเลขรวม ไม่มีข้อมูลรายบุคคล) → initDelivery()
//   ผู้ดูแล › ตั้งค่า › จัดส่งยาถึงบ้าน: โปสเตอร์ / ข้อความ / สถิติรายปีงบ × รพ.สต. → initDeliveryAdmin()
import { sb, publicImageUrl } from '../supabase.js?v=4.4';
import { $, esc, toast, errText, busy, fiscalYearOf } from '../util.js?v=4.4';
import { loadUnits, loadYears, unitName } from '../data.js?v=4.4';
import { A4, imagePicker, uploadPublicImage, removeFiles } from '../upload.js?v=4.4';

const CUR_FY = fiscalYearOf();
const paras = (t) => String(t || '').split(/\n+/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');
const n = (x) => Number(x || 0).toLocaleString('th-TH');

/* ======================= หน้าหลัก ======================= */
let dlYear = CUR_FY, dlBound = false, stats = [];

export async function initDelivery() {
  const [units, years] = await Promise.all([loadUnits(), loadYears()]);
  if (!dlBound) {
    dlBound = true;
    $('#dlYears').addEventListener('click', (e) => { const b = e.target.closest('[data-y]'); if (b) { dlYear = +b.dataset.y; renderStats(units, years); } });
    document.querySelectorAll('[data-poster-nav]').forEach((b) => b.addEventListener('click', () => {
      const row = $('#dlPosters'); row.scrollBy({ left: (b.dataset.posterNav === 'next' ? 1 : -1) * row.clientWidth * 0.8, behavior: 'smooth' });
    }));
  }
  $('#dlPosters').innerHTML = '<div class="skeleton poster-skel"></div>';
  const [p, t, s] = await Promise.all([
    sb.from('delivery_posters').select('id,title,image_path,sort').order('sort').order('created_at', { ascending: false }),
    sb.from('site_texts').select('body').eq('key', 'delivery_info').maybeSingle(),
    sb.from('delivery_stats').select('fiscal_year,unit_id,deliveries,patients'),
  ]);
  const posters = p.data || [];
  $('#dlPosters').innerHTML = posters.length ? posters.map((x) => `<a class="poster" href="${esc(publicImageUrl(x.image_path))}" target="_blank" rel="noopener">`
    + `<img src="${esc(publicImageUrl(x.image_path))}" alt="${esc(x.title || 'โปสเตอร์บริการจัดส่งยาถึงบ้าน')}" loading="lazy">${x.title ? `<span>${esc(x.title)}</span>` : ''}</a>`).join('')
    : '<p class="empty">ยังไม่มีโปสเตอร์</p>';
  document.querySelectorAll('[data-poster-nav]').forEach((b) => { b.hidden = posters.length < 2; });
  $('#dlInfo').innerHTML = paras(t.data?.body) || '<p class="muted">ยังไม่มีข้อมูลบริการ</p>';
  stats = s.data || [];
  renderStats(units, years);
}

function renderStats(units, years) {
  const ys = [...new Set([...years, ...stats.map((r) => r.fiscal_year)])].filter((y) => y <= CUR_FY).sort((a, b) => a - b);
  if (!ys.includes(dlYear)) dlYear = ys[ys.length - 1] ?? CUR_FY;
  $('#dlYears').innerHTML = ys.map((y) => `<button type="button" data-y="${y}" aria-current="${y === dlYear}">ปีงบประมาณ ${y}${y === CUR_FY ? ' (ปัจจุบัน)' : ''}</button>`).join('');
  const rows = stats.filter((r) => r.fiscal_year === dlYear);
  const tot = rows.reduce((a, r) => ({ d: a.d + r.deliveries, p: a.p + r.patients }), { d: 0, p: 0 });
  $('#dlFigs').innerHTML = `<div class="fig"><div class="n num">${n(tot.d)}</div><div class="t">จำนวนครั้งที่จัดส่งยา</div></div>`
    + `<div class="fig"><div class="n num">${n(tot.p)}</div><div class="t">ผู้ป่วยที่ได้รับบริการ (คน)</div></div>`
    + `<div class="fig"><div class="n num">${rows.filter((r) => r.deliveries > 0).length}</div><div class="t">รพ.สต. ที่ให้บริการ</div></div>`;
  const max = Math.max(1, ...rows.map((r) => r.deliveries));
  $('#dlBars').innerHTML = rows.length ? [...rows].sort((a, b) => b.deliveries - a.deliveries).map((r) => `<div class="bar-row"><div><span>${esc(unitName(r.unit_id))}</span>`
    + `<b class="num">${n(r.deliveries)} ครั้ง · ${n(r.patients)} คน</b></div><div class="meter"><span style="width:${Math.round(r.deliveries / max * 100)}%"></span></div></div>`).join('')
    : '<p class="empty">ยังไม่มีสถิติของปีงบนี้</p>';
}

/* ======================= ผู้ดูแล ======================= */
let adminBound = false, posters = [], picker = null;

export async function initDeliveryAdmin() {
  const [units, years] = await Promise.all([loadUnits(), loadYears({ includeHidden: true })]);
  if (!adminBound) {
    adminBound = true;
    picker = imagePicker($('#daImage'), $('#daPreview'), $('#daImageNote'), { fit: A4 });
    $('#daAdd').addEventListener('click', addPoster);
    $('#daList').addEventListener('click', onPosterList);
    $('#daList').addEventListener('change', onPosterSort);
    $('#daInfoSave').addEventListener('click', saveInfo);
    const ys = [...new Set([...years, CUR_FY, CUR_FY + 1])].sort((a, b) => b - a);
    $('#daYear').innerHTML = ys.map((y) => `<option value="${y}"${y === CUR_FY ? ' selected' : ''}>ปีงบประมาณ ${y}</option>`).join('');
    $('#daYear').addEventListener('change', () => loadStats(units));
    $('#daStatSave').addEventListener('click', () => saveStats(units));
  }
  const t = await sb.from('site_texts').select('body').eq('key', 'delivery_info').maybeSingle();
  $('#daInfo').value = t.data?.body || '';
  await Promise.all([loadPosters(), loadStats(units)]);
}

async function loadPosters() {
  const { data, error } = await sb.from('delivery_posters').select('id,title,image_path,sort').order('sort').order('created_at', { ascending: false });
  if (error) { $('#daList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  posters = data;
  $('#daList').innerHTML = posters.length ? posters.map((x) => `<div class="da-poster"><img src="${esc(publicImageUrl(x.image_path))}" alt="">`
    + `<div class="l"><b>${esc(x.title || '(ไม่มีชื่อ)')}</b><label class="small">ลำดับ <input class="input da-sort" type="number" inputmode="numeric" value="${x.sort}" data-sort="${x.id}" aria-label="ลำดับโปสเตอร์"></label></div>`
    + `<button type="button" class="btn btn-no btn-sm" data-del="${x.id}">ลบ</button></div>`).join('')
    : '<p class="empty">ยังไม่มีโปสเตอร์ · เพิ่มได้จากฟอร์มด้านบน</p>';
}

async function addPoster() {
  const btn = $('#daAdd'), blob = await picker.ready();
  if (!blob) { toast('กรุณาเลือกรูปโปสเตอร์', 'err'); return; }
  busy(btn, true, 'กำลังอัปโหลด…');
  let path = null;
  try {
    path = await uploadPublicImage(blob, 'delivery');
    const sort = posters.length ? Math.max(...posters.map((x) => x.sort)) + 1 : 0;
    const { error } = await sb.from('delivery_posters').insert({ title: $('#daTitle').value.trim() || null, image_path: path, sort });
    if (error) throw error;
    $('#daTitle').value = ''; picker.reset(); toast('เพิ่มโปสเตอร์แล้ว'); await loadPosters();
  } catch (err) { if (path) removeFiles('public-images', [path]); toast(errText(err), 'err'); }
  finally { busy(btn, false); }
}

async function onPosterList(e) {
  const b = e.target.closest('[data-del]'); if (!b) return;
  const x = posters.find((p) => p.id === +b.dataset.del);
  if (!x || !confirm(`ลบโปสเตอร์ "${x.title || 'ไม่มีชื่อ'}"?`)) return;
  const { error } = await sb.from('delivery_posters').delete().eq('id', x.id);
  if (error) { toast(errText(error), 'err'); return; }
  removeFiles('public-images', [x.image_path]); toast('ลบโปสเตอร์แล้ว'); loadPosters();
}

async function onPosterSort(e) {
  const i = e.target.closest('[data-sort]'); if (!i) return;
  const { error } = await sb.from('delivery_posters').update({ sort: Math.round(+i.value || 0) }).eq('id', +i.dataset.sort);
  if (error) { toast(errText(error), 'err'); return; }
  toast('บันทึกลำดับแล้ว'); loadPosters();
}

async function saveInfo() {
  const btn = $('#daInfoSave'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = await sb.from('site_texts').upsert({ key: 'delivery_info', body: $('#daInfo').value.trim() });
  busy(btn, false);
  if (error) toast(errText(error), 'err'); else toast('บันทึกข้อความแล้ว');
}

async function loadStats(units) {
  const y = +$('#daYear').value;
  const { data } = await sb.from('delivery_stats').select('unit_id,deliveries,patients').eq('fiscal_year', y);
  const m = new Map((data || []).map((r) => [r.unit_id, r]));
  $('#daStats').innerHTML = units.map((u) => `<div class="da-stat"><span>${esc(u.name)}</span>`
    + `<label class="small">จัดส่ง (ครั้ง)<input class="input" type="number" inputmode="numeric" min="0" data-u="${u.id}" data-k="deliveries" value="${m.get(u.id)?.deliveries ?? ''}"></label>`
    + `<label class="small">ผู้ป่วย (คน)<input class="input" type="number" inputmode="numeric" min="0" data-u="${u.id}" data-k="patients" value="${m.get(u.id)?.patients ?? ''}"></label></div>`).join('');
}

async function saveStats(units) {
  const y = +$('#daYear').value, rows = [];
  for (const u of units) {
    const v = (k) => $(`#daStats [data-u="${u.id}"][data-k="${k}"]`).value;
    if (v('deliveries') === '' && v('patients') === '') continue;
    const d = Math.round(+v('deliveries') || 0), p = Math.round(+v('patients') || 0);
    if (d < 0 || p < 0) { toast('ตัวเลขต้องไม่ติดลบ', 'err'); return; }
    rows.push({ fiscal_year: y, unit_id: u.id, deliveries: d, patients: p, updated_at: new Date().toISOString() });
  }
  if (!rows.length) { toast('ยังไม่ได้กรอกตัวเลข', 'err'); return; }
  const btn = $('#daStatSave'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = await sb.from('delivery_stats').upsert(rows);
  busy(btn, false);
  if (error) toast(errText(error), 'err'); else toast(`บันทึกสถิติปีงบ ${y} แล้ว (${rows.length} รพ.สต.)`);
}
