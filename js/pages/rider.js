// Health Rider — หน้าแสดงผลงาน (ตัวเลขรวม ไม่มีข้อมูลรายบุคคล)
//   หน้าหลัก (ช่องบริการจัดส่งยาถึงบ้าน #hrBlock): ข้อความแนะนำ + ผลงานรายปีงบ แยกตามตำบล (rider_tambon_stats · 55_rider_tambon.sql)
//     ปีงบที่ยังไม่มีข้อมูลรายตำบล = แสดงแบบเดิมราย รพ.สต. (rider_stats)
//   ผู้ดูแล › Health Rider (#/admin/rider) → mountRiderEditor(slot): ตามหัวข้อไฟล์ "ประวัติรายการจัดส่งยา" (นับเฉพาะบริการ rider)
//     ส่งสำเร็จ (ครั้ง) · ผู้รับบริการ (คน) · ยกเลิก (ครั้ง) · ส่งฟรี (ครั้ง) ราย ตำบล · กรอกเอง หรือนำเข้าไฟล์ (อ่านในเครื่อง ไม่อัปโหลด)
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, errText, busy, fiscalYearOf } from '../util.js?v=4.4';
import { loadUnits, loadYears, unitName } from '../data.js?v=4.4';
import { paras } from './delivery.js?v=4.4';
import { readTable, riderByTambon } from './delivery-report.js?v=4.4';

const CUR_FY = fiscalYearOf();
const n = (x) => Number(x || 0).toLocaleString('th-TH');
export const RIDER_FIELDS = [['delivered', 'ส่งยาสำเร็จ', 'ครั้ง'], ['clients', 'ผู้รับบริการ', 'คน'], ['cancelled', 'ยกเลิก', 'ครั้ง'], ['free', 'ส่งฟรี', 'ครั้ง']];

/* ======================= หน้าหลัก ======================= */
let hrYear = CUR_FY, hrBound = false, stats = [], tstats = [];

export async function initRider() {
  const years = (await Promise.all([loadUnits(), loadYears()]))[1];
  if (!hrBound) {
    hrBound = true;
    $('#hrYears').addEventListener('click', (e) => { const b = e.target.closest('[data-y]'); if (b) { hrYear = +b.dataset.y; renderStats(years); } });
  }
  $('#hrFigs').innerHTML = '<div class="skeleton"></div>';
  const [t, s, ts] = await Promise.all([
    sb.from('site_texts').select('body').eq('key', 'rider_info').maybeSingle(),
    sb.from('rider_stats').select('fiscal_year,unit_id,trips,clients'),
    sb.from('rider_tambon_stats').select('fiscal_year,tambon,delivered,clients,cancelled,free'),
  ]);
  $('#hrInfo').innerHTML = paras(t.data?.body) || '<p class="muted">ยังไม่มีข้อมูลบริการ</p>';
  stats = s.data || []; tstats = ts.data || [];
  renderStats(years);
}

function renderStats(years) {
  const ys = [...new Set([...years, ...stats.map((r) => r.fiscal_year), ...tstats.map((r) => r.fiscal_year)])].filter((y) => y <= CUR_FY).sort((a, b) => a - b);
  if (!ys.includes(hrYear)) hrYear = ys[ys.length - 1] ?? CUR_FY;
  $('#hrYears').innerHTML = ys.map((y) => `<button type="button" data-y="${y}" aria-current="${y === hrYear}">ปีงบประมาณ ${y}${y === CUR_FY ? ' (ปัจจุบัน)' : ''}</button>`).join('');
  const trows = tstats.filter((r) => r.fiscal_year === hrYear);
  if (trows.length) {   // แยกตามตำบล (ตามไฟล์ประวัติรายการจัดส่งยา)
    const tot = trows.reduce((a, r) => ({ d: a.d + r.delivered, c: a.c + r.clients, x: a.x + r.cancelled, f: a.f + r.free }), { d: 0, c: 0, x: 0, f: 0 });
    $('#hrFigs').innerHTML = `<div class="fig"><div class="n num">${n(tot.d)}</div><div class="t">ส่งยาสำเร็จ (ครั้ง)</div></div>`
      + `<div class="fig"><div class="n num">${n(tot.c)}</div><div class="t">ผู้รับบริการ (คน)</div></div>`
      + `<div class="fig"><div class="n num">${trows.filter((r) => r.delivered > 0).length}</div><div class="t">ตำบลที่ให้บริการ</div></div>`
      + `<div class="fig"><div class="n num">${tot.d ? Math.round((tot.f / tot.d) * 100) : 0}%</div><div class="t">ส่งฟรี · ยกเลิก ${n(tot.x)} ครั้ง</div></div>`;
    const max = Math.max(1, ...trows.map((r) => r.delivered));
    $('#hrBars').innerHTML = [...trows].sort((a, b) => b.delivered - a.delivered).map((r) => `<div class="bar-row"><div><span>ต.${esc(r.tambon)}</span>`
      + `<b class="num">${n(r.delivered)} ครั้ง · ${n(r.clients)} คน</b></div><div class="meter"><span style="width:${Math.round(r.delivered / max * 100)}%"></span></div></div>`).join('');
    return;
  }
  const rows = stats.filter((r) => r.fiscal_year === hrYear);
  const tot = rows.reduce((a, r) => ({ t: a.t + r.trips, c: a.c + r.clients }), { t: 0, c: 0 });
  $('#hrFigs').innerHTML = `<div class="fig"><div class="n num">${n(tot.t)}</div><div class="t">จำนวนครั้งที่ออกให้บริการ</div></div>`
    + `<div class="fig"><div class="n num">${n(tot.c)}</div><div class="t">ผู้รับบริการ (คน)</div></div>`
    + `<div class="fig"><div class="n num">${rows.filter((r) => r.trips > 0).length}</div><div class="t">รพ.สต. ที่ให้บริการ</div></div>`;
  const max = Math.max(1, ...rows.map((r) => r.trips));
  $('#hrBars').innerHTML = rows.length ? [...rows].sort((a, b) => b.trips - a.trips).map((r) => `<div class="bar-row"><div><span>${esc(unitName(r.unit_id))}</span>`
    + `<b class="num">${n(r.trips)} ครั้ง · ${n(r.clients)} คน</b></div><div class="meter"><span style="width:${Math.round(r.trips / max * 100)}%"></span></div></div>`).join('')
    : '<p class="empty">ยังไม่มีผลงานของปีงบนี้</p>';
}

/* ======================= ผู้ดูแล › Health Rider (แยกตามตำบล) ======================= */
let E = null;   // { draft: { [ปีงบ]: [{ tambon, … }] } จากไฟล์ที่นำเข้า (ยังไม่บันทึก) }

const TEMPLATE = `
  <p class="small muted">ตัวเลขที่บันทึกแสดงที่หน้าหลัก › บริการจัดส่งยาถึงบ้าน (Health Rider) ทันที · <a href="#/rider">ดูหน้าผลงาน Health Rider</a></p>
  <div class="panel">
    <div class="panel-head"><h2>ผลงาน Health Rider แยกตามตำบล</h2><label class="small" for="hrYear">ปีงบประมาณ</label></div>
    <select id="hrYear" class="input"></select>
    <p class="small muted">ตามหัวข้อไฟล์ "ประวัติรายการจัดส่งยา" · นับเฉพาะบริการขนส่ง rider · ส่งยาสำเร็จ / ผู้รับบริการ (คน ไม่นับซ้ำ) / ยกเลิก / ส่งฟรี (ค่าจัดส่ง 0 บาท)</p>
    <div class="hr-tam" id="hrStats"></div>
    <div class="nt-add"><input id="hrNewTambon" class="input" maxlength="60" placeholder="ชื่อตำบล" aria-label="ชื่อตำบลที่จะเพิ่ม"><button type="button" class="btn btn-o btn-sm" id="hrAddTambon">+ เพิ่มตำบล</button></div>
    <details class="hr-import" open>
      <summary>นำเข้าจากไฟล์ประวัติรายการจัดส่งยา</summary>
      <p class="small muted">เลือกไฟล์ .xlsx หรือ .csv จากระบบจัดส่งยา · ระบบนับในเครื่องนี้ <b>ไม่อัปโหลดไฟล์</b> และเก็บเฉพาะตัวเลขรวม · แยกปีงบจากวันที่สร้างออเดอร์</p>
      <div class="field"><label for="hrFile">เลือกไฟล์</label><input id="hrFile" class="input" type="file" accept=".xlsx,.xls,.csv,text/csv"></div>
      <span class="small" id="hrImportMsg" aria-live="polite"></span>
    </details>
    <div class="row-btns"><button type="button" class="btn btn-p btn-sm" id="hrStatSave">บันทึกและแสดงผลงาน</button><button type="button" class="btn btn-o btn-sm" id="hrSaveAll" hidden>บันทึกทุกปีงบจากไฟล์</button></div>
  </div>
  <div class="panel">
    <h2>ข้อความแนะนำ Health Rider</h2>
    <label for="hrInfoEdit" class="small muted">แสดงเหนือผลงานที่หน้าหลัก · ขึ้นบรรทัดใหม่ = ย่อหน้าใหม่</label>
    <textarea id="hrInfoEdit" rows="4" maxlength="5000"></textarea>
    <div><button type="button" class="btn btn-p btn-sm" id="hrInfoSave">บันทึกข้อความ</button></div>
  </div>`;

/** หน้าแก้ไขผลงาน Health Rider (ผู้ดูแล) ใน slot */
export async function mountRiderEditor(slot) {
  slot.innerHTML = '<div class="skeleton"></div>';
  let years;
  try { years = await loadYears({ includeHidden: true }); }
  catch (err) { slot.innerHTML = `<p class="empty">${esc(errText(err))}</p>`; return; }
  document.querySelectorAll('[data-rider-slot]').forEach((s) => { if (s !== slot) s.innerHTML = ''; });   // id ในหน้าต้องไม่ซ้ำ
  slot.innerHTML = TEMPLATE;
  E = { draft: {} };
  const ys = [...new Set([...years, CUR_FY, CUR_FY + 1])].sort((a, b) => b - a);
  $('#hrYear').innerHTML = ys.map((y) => `<option value="${y}"${y === CUR_FY ? ' selected' : ''}>ปีงบประมาณ ${y}</option>`).join('');
  $('#hrYear').addEventListener('change', loadStats);
  $('#hrStatSave').addEventListener('click', saveStats);
  $('#hrSaveAll').addEventListener('click', saveAll);
  $('#hrFile').addEventListener('change', importFile);
  $('#hrAddTambon').addEventListener('click', addTambon);
  $('#hrNewTambon').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTambon(); } });
  $('#hrStats').addEventListener('click', delTambon);
  $('#hrInfoSave').addEventListener('click', saveInfo);
  await Promise.all([loadStats(), sb.from('site_texts').select('body').eq('key', 'rider_info').maybeSingle().then((t) => { $('#hrInfoEdit').value = t.data?.body || ''; })]);
}

const rowHtml = (r, saved) => `<div class="da-stat hr-trow" data-tambon="${esc(r.tambon)}"${saved ? ' data-saved="1"' : ''}><span>ต.${esc(r.tambon)}</span>`
  + RIDER_FIELDS.map(([k, label, u]) => `<label class="small">${label} (${u})<input class="input" type="number" inputmode="numeric" min="0" data-k="${k}" value="${r[k] ?? ''}"></label>`).join('')
  + `<button type="button" class="btn btn-no btn-sm" data-del-tambon aria-label="ลบตำบล ${esc(r.tambon)}">ลบ</button></div>`;

async function loadStats() {
  const y = +$('#hrYear').value;
  $('#hrStats').innerHTML = '<div class="skeleton"></div>';
  const { data, error } = await sb.from('rider_tambon_stats').select('tambon,delivered,clients,cancelled,free').eq('fiscal_year', y);
  if (error) { $('#hrStats').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  const saved = new Map((data || []).map((r) => [r.tambon, r]));
  const draft = E.draft[y] || [];
  const names = [...new Set([...draft.map((r) => r.tambon), ...saved.keys()])];
  $('#hrStats').innerHTML = names.map((t) => rowHtml(draft.find((r) => r.tambon === t) || saved.get(t) || { tambon: t }, saved.has(t))).join('')
    || `<p class="empty">ยังไม่มีผลงานของปีงบ ${y} · นำเข้าไฟล์ด้านล่าง หรือเพิ่มตำบลแล้วกรอกเอง</p>`;
}

function addTambon() {
  const t = $('#hrNewTambon').value.replace(/^ต(?:ำบล|\.)\s*/, '').trim();
  if (!t) { $('#hrNewTambon').focus(); return; }
  if ([...document.querySelectorAll('#hrStats [data-tambon]')].some((r) => r.dataset.tambon === t)) { toast('มีตำบลนี้แล้ว', 'err'); return; }
  $('#hrStats .empty')?.remove();
  $('#hrStats').insertAdjacentHTML('beforeend', rowHtml({ tambon: t }, false));
  $('#hrNewTambon').value = '';
}

async function delTambon(e) {
  const b = e.target.closest('[data-del-tambon]'); if (!b) return;
  const row = b.closest('[data-tambon]'), t = row.dataset.tambon, y = +$('#hrYear').value;
  if (row.dataset.saved) {
    if (!confirm(`ลบผลงานของ ต.${t} ปีงบ ${y}?`)) return;
    const { error } = await sb.from('rider_tambon_stats').delete().eq('fiscal_year', y).eq('tambon', t);
    if (error) { toast(errText(error), 'err'); return; }
    toast('ลบแล้ว');
  }
  if (E.draft[y]) E.draft[y] = E.draft[y].filter((r) => r.tambon !== t);
  row.remove();
}

function readRows(y) {
  const rows = [];
  for (const r of document.querySelectorAll('#hrStats [data-tambon]')) {
    const v = (k) => r.querySelector(`[data-k="${k}"]`).value;
    if (RIDER_FIELDS.every(([k]) => v(k) === '')) continue;
    const row = { fiscal_year: y, tambon: r.dataset.tambon, updated_at: new Date().toISOString() };
    for (const [k] of RIDER_FIELDS) { row[k] = Math.round(+v(k) || 0); if (row[k] < 0) throw new Error('ตัวเลขต้องไม่ติดลบ'); }
    rows.push(row);
  }
  return rows;
}

async function saveStats() {
  const y = +$('#hrYear').value;
  let rows;
  try { rows = readRows(y); } catch (err) { toast(err.message, 'err'); return; }
  if (!rows.length) { toast('ยังไม่ได้กรอกตัวเลข', 'err'); return; }
  const btn = $('#hrStatSave'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = await sb.from('rider_tambon_stats').upsert(rows);
  busy(btn, false);
  if (error) { toast(errText(error), 'err'); return; }
  delete E.draft[y]; $('#hrSaveAll').hidden = Object.keys(E.draft).length < 1;
  toast(`บันทึกผลงานปีงบ ${y} แล้ว (${rows.length} ตำบล) · แสดงที่หน้าหลักแล้ว`);
  loadStats();
}

async function saveAll() {
  const rows = Object.entries(E.draft).flatMap(([y, list]) => list.map((r) => ({ fiscal_year: +y, ...r, updated_at: new Date().toISOString() })));
  if (!rows.length) return;
  const btn = $('#hrSaveAll'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = await sb.from('rider_tambon_stats').upsert(rows);
  busy(btn, false);
  if (error) { toast(errText(error), 'err'); return; }
  toast(`บันทึกแล้ว ${Object.keys(E.draft).length} ปีงบ · แสดงที่หน้าหลักแล้ว`);
  E.draft = {}; $('#hrSaveAll').hidden = true; loadStats();
}

/** นำเข้าไฟล์ประวัติรายการจัดส่งยา → นับเฉพาะ rider ราย ปีงบ × ตำบล → ใส่ช่องกรอก (ยังไม่บันทึก) */
async function importFile(e) {
  const f = e.target.files[0]; if (!f) return;
  const msg = $('#hrImportMsg'); msg.style.color = ''; msg.textContent = 'กำลังอ่านไฟล์ในเครื่อง…';
  try {
    const res = riderByTambon(await readTable(f)), ys = Object.keys(res).map(Number).sort((a, b) => a - b);
    if (!ys.length) throw new Error('ไม่พบรายการบริการขนส่ง rider ในไฟล์');
    E.draft = res;
    const cur = +$('#hrYear').value, show = ys.includes(cur) ? cur : ys[ys.length - 1];
    if (![...$('#hrYear').options].some((o) => +o.value === show)) $('#hrYear').insertAdjacentHTML('beforeend', `<option value="${show}">ปีงบประมาณ ${show}</option>`);
    $('#hrYear').value = String(show); await loadStats();
    $('#hrSaveAll').hidden = ys.length < 2;
    msg.style.color = 'var(--success)';
    msg.textContent = `นับแล้ว ปีงบ ${ys.join(', ')} · ${ys.map((y) => `${y}: ${res[y].reduce((a, r) => a + r.delivered, 0)} ครั้ง ${res[y].length} ตำบล`).join(' · ')} — ตรวจตัวเลขแล้วกดบันทึก${ys.length > 1 ? ' (หรือ "บันทึกทุกปีงบจากไฟล์")' : ''}`;
  } catch (err) { msg.style.color = 'var(--error)'; msg.textContent = 'อ่านไฟล์ไม่สำเร็จ: ' + errText(err) + ' · ลองบันทึกเป็น .csv แล้วเลือกใหม่'; }
  finally { e.target.value = ''; }
}

async function saveInfo() {
  const btn = $('#hrInfoSave'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = await sb.from('site_texts').upsert({ key: 'rider_info', body: $('#hrInfoEdit').value.trim(), updated_at: new Date().toISOString() });
  busy(btn, false);
  if (error) toast(errText(error), 'err'); else toast('บันทึกข้อความแล้ว');
}
