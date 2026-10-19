// สรุปจากไฟล์ "ประวัติรายการจัดส่งยา" (Excel/CSV จากระบบจัดส่งยา) → หน้าบริการจัดส่งยาถึงบ้าน (53_delivery_reports.sql)
//   ผู้ดูแล › ตั้งค่า › จัดส่งยาถึงบ้าน: เลือกไฟล์ → อ่านในเครื่อง (ไม่อัปโหลดไฟล์) → summarizeDelivery() = ตัวเลขสรุปเท่านั้น
//     (ไม่มีชื่อ/เลขบัตร/HN/เบอร์/ที่อยู่ · HN ใช้นับจำนวนผู้ป่วยในเครื่องแล้วทิ้ง) → ตรวจตัวอย่าง → บันทึก delivery_reports
//   ปุ่ม "ให้ AI สรุปเป็นข้อความ" (ไม่บังคับ): ส่งเฉพาะตัวเลขสรุปให้ Gemini → ai_text
//   หน้าหลัก #/delivery: เลือกช่วงข้อมูล → ตัวเลข + กราฟแท่ง (เดือน/ตำบล/ช่องทาง/สิทธิ) + ข้อความจาก AI (ถ้ามี)
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, errText, busy, thaiDate, fiscalYearOf } from '../util.js?v=4.4';

const n = (x) => Number(x || 0).toLocaleString('th-TH');
const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const COLS = {   // หัวตาราง (ตามไฟล์ของระบบจัดส่งยา) → ชื่อในโค้ด · หาจากชื่อหัว ไม่ยึดลำดับคอลัมน์
  status: 'สถานะ', service: 'บริการขนส่ง', hn: 'HN', created: ['วันเวลาที่สร้างออเดอร์', 'วันเวลาที่ลงทะเบียน'], done: 'วัน-เวลา จัดส่งพัสดุสำเร็จ',   // ไฟล์บางรุ่นใช้ "วันเวลาที่ลงทะเบียน" แทน
  cover: 'ประเภทสิทธิการรักษา', rights: 'รายละเอียดสิทธิการรักษา', fee: 'ค่าจัดส่ง', address: 'ที่อยู่จัดส่งยา',
};

/** วันที่จากไฟล์ → Date: "วันที่ 01/05/2569 เวลา 9:17 น." · "1/5/69" · "01-05-2026" · "2026-05-01 09:17" · เลขวันที่ของ Excel (45778.38)
 *  ปี พ.ศ. → ค.ศ. · ปี 2 หลัก: ≥ 50 = พ.ศ. 25xx (69 = 2569) · < 50 = ค.ศ. 20xx */
export function thDate(s) {
  const t = String(s ?? '').trim();
  let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:\D+(\d{1,2}):(\d{2}))?/), y, mo, d;
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = t.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\D+(\d{1,2})[:.](\d{2}))?/))) {
    [d, mo, y] = [+m[1], +m[2], +m[3]];
    if (m[3].length === 2) y = y >= 50 ? 2500 + y : 2000 + y;
    m = [m[0], , , , m[4], m[5]];
  } else if (/^\d{5}(\.\d+)?$/.test(t) && +t > 30000 && +t < 80000) {   // เลขวันที่ของ Excel (นับจาก 30 ธ.ค. 1899)
    const x = new Date(Math.round((+t - 25569) * 86400000)); return new Date(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(), x.getUTCHours(), x.getUTCMinutes());
  } else return null;
  if (y > 2400) y -= 543;
  const dt = new Date(y, mo - 1, d, +(m[4] || 0), +(m[5] || 0));
  return Number.isNaN(dt.getTime()) || dt.getMonth() !== mo - 1 ? null : dt;
}
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const clean = (s) => String(s ?? '').replace(/\d{6,}/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);   // ป้ายกำกับ: ตัดตัวเลขยาว ๆ ทิ้งเสมอ
const top = (m, k = 12) => [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'th')).slice(0, k);
const add = (m, key, by = 1) => { if (key) m.set(key, (m.get(key) || 0) + by); };
const isRider = (s) => /rider|ไรเดอร์/i.test(String(s || ''));   // "rider", "Health Rider", "ไรเดอร์ …"
function serviceName(s) {
  const t = String(s || '').trim();
  if (isRider(t)) return 'ไรเดอร์ (Health Rider)';
  const inner = t.match(/\(([^()]+)/)?.[1];
  if (/^post/i.test(t)) return `ไปรษณีย์/ขนส่ง${inner ? ' ' + clean(inner.replace(/\(.*$/, '')) : ''}`;
  return clean(t) || 'ไม่ระบุ';
}

/** หาแถวหัวตาราง + ฟังก์ชันอ่านช่องตามชื่อหัว */
function tableCols(rows) {
  const hi = rows.findIndex((r) => r.some((c) => String(c).trim() === COLS.status) && r.some((c) => String(c).trim() === COLS.service));
  if (hi < 0) throw new Error('ไม่พบหัวตาราง "สถานะ" และ "บริการขนส่ง" — ใช้ไฟล์ประวัติรายการจัดส่งยาจากระบบจัดส่งยา');
  const head = rows[hi].map((c) => String(c).trim()), col = {};
  for (const [k, name] of Object.entries(COLS)) col[k] = [].concat(name).map((x) => head.indexOf(x)).find((i) => i >= 0) ?? -1;
  return { hi, col };
}
const tambonOf = (addr) => clean(String(addr || '').match(/ตำบล\s*([^\s]+)/)?.[1]) || 'ไม่ระบุ';

/** Health Rider (55_rider_tambon.sql): เฉพาะบริการขนส่ง "rider" → ราย ปีงบ (จากวันที่สร้างออเดอร์) × ตำบล · HN ใช้นับคนในเครื่องแล้วทิ้ง
 *  → { [ปีงบ]: [{ tambon, delivered, clients, cancelled, free }] } */
export function riderByTambon(rows) {
  const { hi, col } = tableCols(rows);
  const get = (r, k) => (col[k] >= 0 ? String(r[col[k]] ?? '').trim() : '');
  const out = new Map(), diag = { rows: 0, riders: 0, badDate: 0, sample: '', services: new Map() };
  for (const r of rows.slice(hi + 1)) {
    const st = get(r, 'status'); if (!st) continue;
    diag.rows++; add(diag.services, serviceName(get(r, 'service')));
    if (!isRider(get(r, 'service'))) continue;
    diag.riders++;
    const c = thDate(get(r, 'created')); if (!c) { diag.badDate++; diag.sample ||= get(r, 'created').slice(0, 40); continue; }
    const fy = fiscalYearOf(c), tam = tambonOf(get(r, 'address'));
    const y = out.get(fy) || new Map(); out.set(fy, y);
    const t = y.get(tam) || { tambon: tam, delivered: 0, hn: new Set(), cancelled: 0, free: 0 }; y.set(tam, t);
    if (/ยกเลิก/.test(st)) { t.cancelled++; continue; }
    if (!/สำเร็จ/.test(st)) continue;
    t.delivered++;
    const hn = get(r, 'hn'); if (hn) t.hn.add(hn);
    const fee = get(r, 'fee'); if (fee !== '' && fee !== '-' && !(+fee.replace(/[^\d.]/g, '') > 0)) t.free++;
  }
  const res = {};
  for (const [fy, m] of out) res[fy] = [...m.values()].map(({ hn, ...t }) => ({ ...t, clients: hn.size })).sort((a, b) => b.delivered - a.delivered);
  Object.defineProperty(res, 'diag', { value: { ...diag, services: top(diag.services, 6).map(([k, v]) => `${k} ${v}`) } });   // ไว้บอกเหตุผลเมื่อไม่พบรายการ (ไม่มีข้อมูลรายบุคคล)
  return res;
}

/** ตาราง (แถว × คอลัมน์) → ตัวเลขสรุป · ไม่พบหัวตาราง = throw */
export function summarizeDelivery(rows) {
  const { hi, col } = tableCols(rows);
  const title = String(rows.slice(0, hi).flat().find((c) => String(c).trim()) || '').replace(/\d{6,}/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'ประวัติรายการจัดส่งยา';
  const get = (r, k) => (col[k] >= 0 ? String(r[col[k]] ?? '').trim() : '');
  const s = { total: 0, ok: 0, cancel: 0, other: 0 }, hnOk = new Set(), hnAll = new Set();
  const service = new Map(), month = new Map(), tambon = new Map(), rights = new Map(), cover = new Map(), hours = [];
  let fee = 0, free = 0, paid = 0, from = null, to = null;
  for (const r of rows.slice(hi + 1)) {
    const st = get(r, 'status'); if (!st) continue;
    s.total++;
    const c = thDate(get(r, 'created'));
    if (c) { if (!from || c < from) from = c; if (!to || c > to) to = c; }
    const hn = get(r, 'hn'); if (hn) hnAll.add(hn);
    if (/ยกเลิก/.test(st)) { s.cancel++; continue; }
    if (!/สำเร็จ/.test(st)) { s.other++; continue; }
    s.ok++; if (hn) hnOk.add(hn);
    add(service, serviceName(get(r, 'service')));
    if (c) add(month, `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}`);
    add(tambon, tambonOf(get(r, 'address')));
    add(rights, clean(get(r, 'rights')) || 'ไม่ระบุ');
    add(cover, clean(get(r, 'cover')) || 'ไม่ระบุ');
    const f = +get(r, 'fee').replace(/[^\d.]/g, '');
    if (Number.isFinite(f) && get(r, 'fee') !== '' && get(r, 'fee') !== '-') { fee += f; if (f > 0) paid++; else free++; }
    const d = thDate(get(r, 'done'));
    if (c && d && d >= c) hours.push((d - c) / 3600000);
  }
  if (!s.total) throw new Error('ไม่พบรายการจัดส่งในไฟล์');
  hours.sort((a, b) => a - b);
  const r1 = (x) => Math.round(x * 10) / 10;
  return {
    title, from: from ? iso(from) : null, to: to ? iso(to) : null,
    summary: {
      v: 1, ...s, patients: hnOk.size, patientsAll: hnAll.size,
      service: top(service), month: [...month.entries()].sort((a, b) => a[0].localeCompare(b[0])), tambon: top(tambon), rights: top(rights), cover: top(cover),
      fee: Math.round(fee), free, paid,
      hoursAvg: hours.length ? r1(hours.reduce((a, b) => a + b, 0) / hours.length) : null, hoursMedian: hours.length ? r1(hours[Math.floor(hours.length / 2)]) : null,
    },
  };
}

/** ข้อความตาราง (วางจาก Excel = คั่นด้วย tab · CSV = คั่นด้วยจุลภาค) → [[ช่อง,…],…] */
export function parseText(text) {
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

/** อ่านไฟล์ในเครื่อง → ตาราง (CSV อ่านเอง · Excel ใช้ SheetJS จาก CDN) */
export async function readTable(f) {
  if (/\.csv$/i.test(f.name) || f.type === 'text/csv') return parseText((await f.text()).replace(/^﻿/, ''));
  const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/xlsx.mjs');
  const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
  // ช่องวันที่ของ Excel เป็นวันที่จริง (ไม่ใช่ข้อความ "วันที่ 01/05/2569") → แปลงเป็น วว/ดด/ปปปป ชช:นน (ค.ศ.) ให้อ่านแบบเดียวกับ CSV
  const pad = (x) => String(x).padStart(2, '0');
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })
    .map((r) => r.map((c) => (c instanceof Date ? `${pad(c.getDate())}/${pad(c.getMonth() + 1)}/${c.getFullYear()} ${pad(c.getHours())}:${pad(c.getMinutes())}` : c)));
}

/* ======================= แสดงผล (ใช้ทั้งหน้าหลักและตัวอย่างของผู้ดูแล) ======================= */
const monthLabel = (k) => { const [y, m] = k.split('-'); return `${TH_MONTH[+m - 1]} ${String(+y + 543).slice(2)}`; };
function bars(title, list, label = (k) => k, unit = 'ครั้ง') {
  if (!list?.length) return '';
  const max = Math.max(1, ...list.map((x) => x[1]));
  return `<div class="dr-block"><h3>${esc(title)}</h3><div class="bars">${list.map(([k, v]) => `<div class="bar-row"><div><span>${esc(label(k))}</span><b class="num">${n(v)} ${unit}</b></div>`
    + `<div class="meter"><span style="width:${Math.round((v / max) * 100)}%"></span></div></div>`).join('')}</div></div>`;
}
export function renderDeliveryReport(box, rep) {
  const s = rep.summary || {};
  const period = rep.period_from ? `${thaiDate(rep.period_from)} – ${thaiDate(rep.period_to)}` : '';
  box.innerHTML = `<p class="small muted">${esc(rep.title)}${period ? ' · ' + esc(period) : ''} · ตัวเลขสรุปเท่านั้น ไม่มีข้อมูลรายบุคคล</p>`
    + '<div class="track-figs dl-figs">'
    + `<div class="fig"><div class="n num">${n(s.ok)}</div><div class="t">จัดส่งยาสำเร็จ (ครั้ง)</div></div>`
    + `<div class="fig"><div class="n num">${n(s.patients)}</div><div class="t">ผู้ป่วยที่ได้รับยา (คน)</div></div>`
    + `<div class="fig"><div class="n num">${s.ok ? Math.round((s.free / Math.max(1, s.free + s.paid)) * 100) : 0}%</div><div class="t">ส่งฟรี (ไม่เสียค่าจัดส่ง)</div></div>`
    + (s.hoursMedian != null ? `<div class="fig"><div class="n num">${s.hoursMedian < 24 ? n(s.hoursMedian) + ' ชม.' : n(Math.round(s.hoursMedian / 24 * 10) / 10) + ' วัน'}</div><div class="t">ระยะเวลาส่งถึงมือ (ค่ากลาง)</div></div>` : '')
    + '</div>'
    + `<p class="small muted">รายการทั้งหมด ${n(s.total)} · สำเร็จ ${n(s.ok)} · ยกเลิก ${n(s.cancel)}${s.other ? ' · อื่น ๆ ' + n(s.other) : ''} · ค่าจัดส่งรวม ${n(s.fee)} บาท</p>`
    + (rep.ai_status === 'done' && rep.ai_text ? `<div class="dr-ai"><h3>สรุปโดย AI</h3>${String(rep.ai_text).split(/\n+/).filter((l) => l.trim()).map((l) => `<p>${esc(l)}</p>`).join('')}</div>` : '')
    + '<div class="dr-grid">'
    + bars('รายเดือน (จัดส่งสำเร็จ)', s.month, monthLabel)
    + bars('ตามตำบล', s.tambon)
    + bars('ตามช่องทางจัดส่ง', s.service)
    + bars('ตามสิทธิการรักษา', s.rights)
    + '</div>';
}

/* ======================= หน้าหลัก #/delivery ======================= */
let reports = [], pubBound = false;
export async function initDeliveryReports() {
  const panel = $('#drPanel');
  const { data, error } = await sb.from('delivery_reports').select('id,title,period_from,period_to,summary,ai_text,ai_status,created_at').order('created_at', { ascending: false }).limit(24);
  reports = error ? [] : data || [];
  panel.hidden = !reports.length;
  if (!reports.length) return;
  if (!pubBound) { pubBound = true; $('#drPick').addEventListener('change', showPicked); }
  $('#drPick').innerHTML = reports.map((r) => `<option value="${r.id}">${esc(r.period_from ? `${thaiDate(r.period_from)} – ${thaiDate(r.period_to)}` : r.title)}</option>`).join('');
  $('#drPick').hidden = reports.length < 2;
  showPicked();
}
function showPicked() { const r = reports.find((x) => x.id === +$('#drPick').value) || reports[0]; if (r) renderDeliveryReport($('#drView'), r); }

/* ======================= ผู้ดูแล › ตั้งค่า › จัดส่งยาถึงบ้าน ======================= */
let draft = null, adminBound = false, adminList = [];
export async function initDeliveryReportAdmin() {
  if (!adminBound) {
    adminBound = true;
    $('#drFile').addEventListener('change', onFile);
    $('#drSave').addEventListener('click', saveDraft);
    $('#drList').addEventListener('click', onList);
  }
  await loadAdminList();
}
async function onFile(e) {
  const f = e.target.files[0]; if (!f) return;
  const msg = $('#drMsg'); msg.style.color = ''; msg.textContent = 'กำลังอ่านไฟล์ในเครื่อง…';
  try {
    draft = summarizeDelivery(await readTable(f));
    $('#drTitle').value = draft.title;
    renderDeliveryReport($('#drPreview'), { title: draft.title, period_from: draft.from, period_to: draft.to, summary: draft.summary });
    $('#drPreviewWrap').hidden = false;
    msg.style.color = 'var(--success)';
    msg.textContent = `อ่านแล้ว ${n(draft.summary.total)} รายการ · ตรวจตัวอย่างด้านล่างแล้วกด "บันทึกและแสดงที่หน้าจัดส่งยา"`;
  } catch (err) {
    draft = null; $('#drPreviewWrap').hidden = true;
    msg.style.color = 'var(--error)'; msg.textContent = 'อ่านไฟล์ไม่สำเร็จ: ' + errText(err) + ' · ลองบันทึกเป็น .csv แล้วเลือกใหม่';
  } finally { e.target.value = ''; }
}
async function saveDraft() {
  if (!draft) { toast('กรุณาเลือกไฟล์ก่อน', 'err'); return; }
  const btn = $('#drSave'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = await sb.from('delivery_reports').insert({ title: $('#drTitle').value.trim() || draft.title, period_from: draft.from, period_to: draft.to, summary: draft.summary });
  busy(btn, false);
  if (error) { toast(errText(error), 'err'); return; }
  toast('บันทึกแล้ว · แสดงที่หน้าหลัก › บริการจัดส่งยาถึงบ้าน');
  draft = null; $('#drPreviewWrap').hidden = true; $('#drMsg').textContent = '';
  loadAdminList(); initDeliveryReports();
}
async function loadAdminList() {
  $('#drList').innerHTML = '<div class="skeleton"></div>';
  const { data, error } = await sb.from('delivery_reports').select('id,title,period_from,period_to,summary,ai_text,ai_status,ai_note,created_at').order('created_at', { ascending: false });
  if (error) { $('#drList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  adminList = data || [];
  $('#drList').innerHTML = adminList.length ? adminList.map((r) => `<div class="li"><div class="l"><b>${esc(r.title)}</b>`
    + `<span class="small muted">${r.period_from ? esc(`${thaiDate(r.period_from)} – ${thaiDate(r.period_to)}`) + ' · ' : ''}สำเร็จ ${n(r.summary?.ok)} ครั้ง · ผู้ป่วย ${n(r.summary?.patients)} คน · บันทึก ${esc(thaiDate(r.created_at))}</span>`
    + `<span class="small ${r.ai_status === 'error' ? 'ai-err' : 'muted'}" data-ai-st="${r.id}">${r.ai_status === 'done' ? '✓ มีสรุปจาก AI แล้ว' : r.ai_status === 'pending' ? 'AI กำลังสรุป…' : r.ai_status === 'error' ? esc(r.ai_note || 'AI สรุปไม่สำเร็จ') : 'ยังไม่มีสรุปจาก AI'}</span></div>`
    + `<div class="row-btns"><button type="button" class="btn btn-o btn-sm" data-ai="${r.id}">${r.ai_status === 'done' ? 'ให้ AI สรุปใหม่' : 'ให้ AI สรุปเป็นข้อความ'}</button><button type="button" class="btn btn-no btn-sm" data-del="${r.id}">ลบ</button></div></div>`).join('')
    : '<p class="empty">ยังไม่มีสรุปจากไฟล์ · เลือกไฟล์ด้านบนเพื่อเริ่ม</p>';
}
async function onList(e) {
  const ai = e.target.closest('[data-ai]'), del = e.target.closest('[data-del]');
  if (del) {
    const r = adminList.find((x) => x.id === +del.dataset.del);
    if (!r || !confirm(`ลบสรุป "${r.title}"?`)) return;
    const { error } = await sb.from('delivery_reports').delete().eq('id', r.id);
    if (error) { toast(errText(error), 'err'); return; }
    toast('ลบแล้ว'); loadAdminList(); initDeliveryReports(); return;
  }
  if (!ai) return;
  const id = +ai.dataset.ai, st = () => $(`[data-ai-st="${id}"]`);
  busy(ai, true, 'AI กำลังสรุป…');
  try {
    const { error } = await sb.rpc('ai_delivery_start', { p_id: id });
    if (error) throw error;
    let r = { ai_status: 'pending' };
    for (let i = 0; r.ai_status === 'pending' && i < 80; i++) {
      await new Promise((ok) => setTimeout(ok, 2500));
      const { data, error: e2 } = await sb.rpc('ai_delivery_poll', { p_id: id });
      if (e2) throw e2;
      r = data;
    }
    if (r.ai_status === 'done') toast('AI สรุปแล้ว · แสดงที่หน้าจัดส่งยา');
    else toast(r.ai_note || 'AI ยังสรุปไม่เสร็จ กรุณาลองใหม่', 'err');
  } catch (err) { toast(errText(err), 'err'); }
  finally { busy(ai, false); loadAdminList(); initDeliveryReports(); }
  if (st()) st().scrollIntoView({ block: 'nearest' });
}
