// Health Rider (ขั้น 22) — หน้าแสดงผลงาน (ตัวเลขรวม ไม่มีข้อมูลรายบุคคล)
//   หน้าหลัก #/rider: ข้อความแนะนำ + ผลงานรายปีงบ (รวมทั้งอำเภอ + ราย รพ.สต.) → initRider()
//   แท็บ Health Rider ของเจ้าหน้าที่ (#/staff/rider) และผู้ดูแล (#/admin/rider) → mountRiderEditor(slot, unit)
//     กรอกตัวเลข หรือนำเข้าจาก Excel (.xlsx / .csv / คัดลอกตารางมาวาง) แล้วกด "บันทึกและแสดงผลงาน"
//     เจ้าหน้าที่ (unit = หน่วยตัวเอง) แก้ได้เฉพาะหน่วยตัวเอง · ผู้ดูแล (unit = null) แก้ได้ทุก รพ.สต. + ข้อความแนะนำ
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, errText, busy, fiscalYearOf } from '../util.js?v=4.4';
import { loadUnits, loadYears, unitName } from '../data.js?v=4.4';
import { paras } from './delivery.js?v=4.4';

const CUR_FY = fiscalYearOf();
const n = (x) => Number(x || 0).toLocaleString('th-TH');
export const RIDER_FIELDS = [['trips', 'ออกให้บริการ', 'ครั้ง'], ['clients', 'ผู้รับบริการ', 'คน']];

/* ======================= หน้าหลัก ======================= */
let hrYear = CUR_FY, hrBound = false, stats = [];

export async function initRider() {
  const years = (await Promise.all([loadUnits(), loadYears()]))[1];
  if (!hrBound) {
    hrBound = true;
    $('#hrYears').addEventListener('click', (e) => { const b = e.target.closest('[data-y]'); if (b) { hrYear = +b.dataset.y; renderStats(years); } });
  }
  $('#hrFigs').innerHTML = '<div class="skeleton"></div>';
  const [t, s] = await Promise.all([
    sb.from('site_texts').select('body').eq('key', 'rider_info').maybeSingle(),
    sb.from('rider_stats').select('fiscal_year,unit_id,trips,clients'),
  ]);
  $('#hrInfo').innerHTML = paras(t.data?.body) || '<p class="muted">ยังไม่มีข้อมูลบริการ</p>';
  stats = s.data || [];
  renderStats(years);
}

function renderStats(years) {
  const ys = [...new Set([...years, ...stats.map((r) => r.fiscal_year)])].filter((y) => y <= CUR_FY).sort((a, b) => a - b);
  if (!ys.includes(hrYear)) hrYear = ys[ys.length - 1] ?? CUR_FY;
  $('#hrYears').innerHTML = ys.map((y) => `<button type="button" data-y="${y}" aria-current="${y === hrYear}">ปีงบประมาณ ${y}${y === CUR_FY ? ' (ปัจจุบัน)' : ''}</button>`).join('');
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

/* ======================= แท็บแก้ไข (เจ้าหน้าที่ / ผู้ดูแล) ======================= */
let E = null;   // { unit (null = ผู้ดูแล), isAdmin, units }

const TEMPLATE = (isAdmin) => `
  <p class="small muted">ตัวเลขที่บันทึกแสดงที่หน้าหลัก › บริการจัดส่งยาถึงบ้าน (Health Rider) ทันที · <a href="#/rider">ดูหน้าผลงาน Health Rider</a></p>
  <div class="panel">
    <div class="panel-head"><h2>ผลงาน Health Rider</h2><label class="small" for="hrYear">ปีงบประมาณ</label></div>
    <select id="hrYear" class="input"></select>
    <div class="da-stats" id="hrStats"></div>
    <details class="hr-import">
      <summary>นำเข้าจาก Excel</summary>
      <p class="small muted">ตารางมี 3 คอลัมน์: <b>ชื่อ รพ.สต.</b> · <b>ออกให้บริการ (ครั้ง)</b> · <b>ผู้รับบริการ (คน)</b> (มีแถวหัวตารางหรือไม่ก็ได้)${isAdmin ? '' : ' · ระบบใช้เฉพาะแถวของหน่วยตัวเอง'}</p>
      <div class="field"><label for="hrFile">เลือกไฟล์ Excel (.xlsx) หรือ .csv</label><input id="hrFile" class="input" type="file" accept=".xlsx,.xls,.csv,text/csv"></div>
      <div class="field"><label for="hrPaste">หรือคัดลอกตารางจาก Excel มาวางที่นี่</label><textarea id="hrPaste" rows="4" placeholder="ชื่อ รพ.สต.&#9;ครั้ง&#9;คน"></textarea></div>
      <div class="row-btns" style="align-items:center"><button type="button" class="btn btn-o btn-sm" id="hrPasteUse">ใช้ข้อมูลที่วาง</button><span class="small" id="hrImportMsg" aria-live="polite"></span></div>
    </details>
    <div><button type="button" class="btn btn-p btn-sm" id="hrStatSave">บันทึกและแสดงผลงาน</button></div>
  </div>
  ${isAdmin ? `<div class="panel">
    <h2>ข้อความแนะนำ Health Rider</h2>
    <label for="hrInfoEdit" class="small muted">แสดงเหนือผลงานที่หน้าหลัก · ขึ้นบรรทัดใหม่ = ย่อหน้าใหม่</label>
    <textarea id="hrInfoEdit" rows="4" maxlength="5000"></textarea>
    <div><button type="button" class="btn btn-p btn-sm" id="hrInfoSave">บันทึกข้อความ</button></div>
  </div>` : ''}`;

/** แสดงหน้าแก้ไข Health Rider ใน slot · unit = รพ.สต. ของเจ้าหน้าที่ หรือ null สำหรับผู้ดูแล */
export async function mountRiderEditor(slot, unit = null) {
  const isAdmin = unit == null;
  slot.innerHTML = '<div class="skeleton"></div>';
  let units, years;
  try { [units, years] = await Promise.all([loadUnits(), loadYears({ includeHidden: true })]); }
  catch (err) { slot.innerHTML = `<p class="empty">${esc(errText(err))}</p>`; return; }
  document.querySelectorAll('[data-rider-slot]').forEach((s) => { if (s !== slot) s.innerHTML = ''; });   // id ในหน้าต้องไม่ซ้ำ
  slot.innerHTML = TEMPLATE(isAdmin);
  E = { unit, isAdmin, units: isAdmin ? units : units.filter((u) => u.id === unit) };
  const ys = [...new Set([...years, CUR_FY, CUR_FY + 1])].sort((a, b) => b - a);
  $('#hrYear').innerHTML = ys.map((y) => `<option value="${y}"${y === CUR_FY ? ' selected' : ''}>ปีงบประมาณ ${y}</option>`).join('');
  $('#hrYear').addEventListener('change', loadStats);
  $('#hrStatSave').addEventListener('click', saveStats);
  $('#hrFile').addEventListener('change', importFile);
  $('#hrPasteUse').addEventListener('click', () => applyRows(parseText($('#hrPaste').value)));
  const jobs = [loadStats()];
  if (isAdmin) {
    $('#hrInfoSave').addEventListener('click', saveInfo);
    jobs.push(sb.from('site_texts').select('body').eq('key', 'rider_info').maybeSingle().then((t) => { $('#hrInfoEdit').value = t.data?.body || ''; }));
  }
  await Promise.all(jobs);
}

async function loadStats() {
  const y = +$('#hrYear').value;
  let q = sb.from('rider_stats').select('unit_id,trips,clients').eq('fiscal_year', y);
  if (!E.isAdmin) q = q.eq('unit_id', E.unit);
  const { data } = await q;
  const m = new Map((data || []).map((r) => [r.unit_id, r]));
  $('#hrStats').innerHTML = E.units.map((u) => `<div class="da-stat"><span>${esc(u.name)}</span>`
    + RIDER_FIELDS.map(([k, label, unitLabel]) => `<label class="small">${label} (${unitLabel})<input class="input" type="number" inputmode="numeric" min="0" data-u="${u.id}" data-k="${k}" value="${m.get(u.id)?.[k] ?? ''}"></label>`).join('')
    + '</div>').join('');
}

/* ---------- นำเข้าจาก Excel ---------- */
/** ข้อความตาราง (วางจาก Excel = คั่นด้วย tab · CSV = คั่นด้วยจุลภาค) → [[ช่อง,…],…] */
function parseText(text) {
  return String(text || '').split(/\r?\n/).map((line) => {
    if (line.includes('\t')) return line.split('\t');
    const out = []; let cur = '', q = false;   // CSV แบบมีเครื่องหมายคำพูด
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  }).filter((r) => r.some((c) => String(c).trim()));
}

async function importFile(e) {
  const f = e.target.files[0]; if (!f) return;
  const msg = $('#hrImportMsg');
  try {
    if (/\.csv$/i.test(f.name) || f.type === 'text/csv') { applyRows(parseText((await f.text()).replace(/^﻿/, ''))); return; }
    msg.textContent = 'กำลังอ่านไฟล์ Excel…';
    const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/xlsx.mjs');
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    applyRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }));
  } catch (err) { msg.textContent = ''; toast('อ่านไฟล์ไม่สำเร็จ: ' + errText(err) + ' · ลองบันทึกเป็น .csv หรือคัดลอกตารางมาวางแทน', 'err'); }
  finally { e.target.value = ''; }
}

const norm = (s) => String(s || '').replace(/รพ\.?\s*สต\.?|โรงพยาบาลส่งเสริมสุขภาพตำบล|\s/g, '');
const num = (s) => { const v = +String(s ?? '').replace(/[,\s]/g, ''); return Number.isFinite(v) && v >= 0 ? Math.round(v) : null; };

/** ใส่ตัวเลขจากตารางลงช่องกรอก (ยังไม่บันทึก — ให้ตรวจก่อนกดบันทึก) */
function applyRows(rows) {
  const msg = $('#hrImportMsg');
  let hit = 0; const miss = [];
  for (const r of rows) {
    const name = norm(r[0]);
    if (!name || num(r[1]) == null) continue;   // แถวหัวตาราง/แถวว่าง
    const u = E.units.find((x) => norm(x.name) === name) || E.units.find((x) => name.includes(norm(x.name)));
    if (!u) { if (E.isAdmin) miss.push(String(r[0]).trim()); continue; }
    RIDER_FIELDS.forEach(([k], i) => { const v = num(r[i + 1]); if (v != null) $(`#hrStats [data-u="${u.id}"][data-k="${k}"]`).value = v; });
    hit++;
  }
  msg.style.color = hit ? 'var(--success)' : 'var(--error)';
  msg.textContent = hit ? `นำเข้า ${hit} รพ.สต. แล้ว — ตรวจตัวเลขแล้วกด "บันทึกและแสดงผลงาน"${miss.length ? ` · ไม่พบชื่อ: ${miss.join(', ')}` : ''}`
    : 'ไม่พบแถวที่ตรงกับชื่อ รพ.สต. — คอลัมน์แรกต้องเป็นชื่อ รพ.สต.';
}

async function saveStats() {
  const y = +$('#hrYear').value, rows = [];
  for (const u of E.units) {
    const v = (k) => $(`#hrStats [data-u="${u.id}"][data-k="${k}"]`).value;
    if (RIDER_FIELDS.every(([k]) => v(k) === '')) continue;
    const row = { fiscal_year: y, unit_id: u.id, updated_at: new Date().toISOString() };
    for (const [k] of RIDER_FIELDS) { row[k] = Math.round(+v(k) || 0); if (row[k] < 0) { toast('ตัวเลขต้องไม่ติดลบ', 'err'); return; } }
    rows.push(row);
  }
  if (!rows.length) { toast('ยังไม่ได้กรอกตัวเลข', 'err'); return; }
  const btn = $('#hrStatSave'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = await sb.from('rider_stats').upsert(rows);
  busy(btn, false);
  if (error) toast(errText(error), 'err'); else toast(`บันทึกผลงานปีงบ ${y} แล้ว${E.isAdmin ? ` (${rows.length} รพ.สต.)` : ''} · แสดงที่หน้าหลักแล้ว`);
}

async function saveInfo() {
  const btn = $('#hrInfoSave'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = await sb.from('site_texts').upsert({ key: 'rider_info', body: $('#hrInfoEdit').value.trim(), updated_at: new Date().toISOString() });
  busy(btn, false);
  if (error) toast(errText(error), 'err'); else toast('บันทึกข้อความแล้ว');
}
