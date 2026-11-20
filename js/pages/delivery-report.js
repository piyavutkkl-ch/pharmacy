// สรุปจาก Google Sheets "ประวัติรายการจัดส่งยา" → หน้าบริการจัดส่งยาถึงบ้าน (53_delivery_reports.sql)
//   ผู้ดูแล › ตั้งค่า › จัดส่งยาถึงบ้าน: วางลิงก์ Google Sheets → อ่านในเครื่อง (ไม่อัปโหลดไฟล์) → summarizeDelivery() = ตัวเลขสรุปเท่านั้น
//     (ไม่มีชื่อ/เลขบัตร/HN/เบอร์/ที่อยู่ · HN ใช้นับจำนวนผู้ป่วยในเครื่องแล้วทิ้ง) → ตรวจตัวอย่าง → บันทึก delivery_reports
//   ปุ่ม "ให้ AI สรุปเป็นข้อความ" (ไม่บังคับ): ส่งเฉพาะตัวเลขสรุปให้ Gemini → ai_text
//   หน้าหลัก #/delivery: เลือกช่วงข้อมูล → ตัวเลข + กราฟแท่ง (เดือน/ตำบล/ช่องทาง/สิทธิ) + ข้อความจาก AI (ถ้ามี)
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, errText, busy, thaiDate, fiscalYearOf } from '../util.js?v=4.4';

const n = (x) => Number(x || 0).toLocaleString('th-TH');
const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_MONTH_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const COLS = {   // หัวตาราง (ตามไฟล์ของระบบจัดส่งยา) → ชื่อในโค้ด · หาจากชื่อหัว ไม่ยึดลำดับคอลัมน์
  status: 'สถานะ', service: 'บริการขนส่ง', hn: 'HN', created: ['วันเวลาที่สร้างออเดอร์', 'วันเวลาที่ลงทะเบียน'], done: 'วัน-เวลา จัดส่งพัสดุสำเร็จ',   // ไฟล์บางรุ่นใช้ "วันเวลาที่ลงทะเบียน" แทน
  cover: 'ประเภทสิทธิการรักษา', rights: 'รายละเอียดสิทธิการรักษา', fee: 'ค่าจัดส่ง', address: 'ที่อยู่จัดส่งยา',
};

// รูปแบบค้นหาหัวคอลัมน์แบบยืดหยุ่น (รองรับชื่อหัวตารางหลายแบบจากระบบจัดส่งยา / Google Sheets)
export const COL_PATTERNS = {
  status: /(?:สถานะ|status)/i,
  service: /(?:บริการขนส่ง|ประเภทขนส่ง|บริการ|ช่องทางจัดส่ง|ช่องทาง|ขนส่ง|service|channel)/i,
  hn: /^(?:hn|เลข\s*hn|รหัสผู้ป่วย)$/i,
  created: /(?:วัน(?:เวลา)?(?:ที่)?(?:สร้าง(?:ออเดอร์)?|ลงทะเบียน|สั่ง)|created|date)/i,
  done: /(?:จัดส่ง(?:พัสดุ)?สำเร็จ|ส่งมอบสำเร็จ|วันที่ส่งมอบ|วันที่สำเร็จ|delivery_date|done)/i,
  cover: /(?:ประเภทสิทธิ(?:การรักษา)?|สิทธิหลัก|cover)/i,
  rights: /(?:รายละเอียดสิทธิ(?:การรักษา)?|สิทธิการรักษา|สิทธิ|rights)/i,
  fee: /(?:ค่าจัดส่ง|ค่าส่ง|fee|shipping)/i,
  address: /(?:ที่อยู่(?:จัดส่ง(?:ยา)?)?|ที่อยู่ผู้รับ|ตำบล|address)/i,
};

export function matchCol(text, key) {
  const t = String(text || '').trim();
  if (!t) return false;
  const exact = COLS[key];
  if (exact) {
    if (Array.isArray(exact) ? exact.includes(t) : exact === t) return true;
  }
  const pat = COL_PATTERNS[key];
  if (pat && pat.test(t)) return true;
  return false;
}

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
/** ชื่อช่องทางจัดส่งสำหรับรายงานสรุปรายเดือน */
export function channelLabel(s) {
  const t = String(s || '').trim();
  if (isRider(t)) return 'ผ่าน Health Rider';
  if (/flash\s*express/i.test(t)) return 'ผ่านพัสดุ (Flash Express)';
  const inner = t.match(/\(([^()]+)/)?.[1];
  if (/^post|ไปรษณีย์|ขนส่ง|พัสดุ/i.test(t)) {
    const sub = inner ? clean(inner.replace(/\(.*$/, '')) : clean(t.replace(/^(?:ไปรษณีย์\/ขนส่ง|ไปรษณีย์|ขนส่ง|post)\s*/i, ''));
    return sub ? `ผ่านพัสดุ (${sub})` : 'ผ่านพัสดุ';
  }
  return t.startsWith('ผ่าน') ? clean(t) : `ผ่าน ${clean(t) || 'ไม่ระบุ'}`;
}
/** ชื่อสิทธิการรักษาหลักสำหรับรายงานสรุป */
export function coverLabel(rawCover, rawRights = '') {
  const c = String(rawCover || '').trim(), r = String(rawRights || '').trim();
  if (/^uc$/i.test(c) || /หลักประกันสุขภาพ|บัตรทอง/i.test(c)) return 'สิทธิหลักประกันสุขภาพ (UC / บัตรทอง)';
  if (/^non[- ]?uc$/i.test(c) || /non[- ]?uc/i.test(c)) {
    if (/อปท|LGO/i.test(r) || /อปท/i.test(c)) return 'สิทธิเบิกจ่ายตรง อปท. (Non-UC)';
    if (/ชำระเงินเอง|CSH/i.test(r)) return 'สิทธิชำระเงินเอง (Non-UC)';
    return 'สิทธิเบิกจ่ายตรง อปท. (Non-UC)';
  }
  return clean(c) || 'ไม่ระบุ';
}
/** ชื่อกลุ่มเป้าหมาย / สิทธิย่อยสำหรับรายงานสรุป */
export function rightsLabel(rawRights) {
  const t = clean(rawRights);
  if (!t) return 'ไม่ระบุ';
  if (/ผู้สูงอายุ/.test(t)) return 'กลุ่มผู้สูงอายุ';
  if (/ผู้พิการ/.test(t)) return 'กลุ่มผู้พิการ';
  if (/UC\s*ในเขต|ทั่วไปในเขต/i.test(t)) return 'สิทธิ UC ทั่วไปในเขต';
  if (/เด็กอายุ\s*0-12\s*ปี/.test(t)) return 'เด็กอายุ 0-12 ปี';
  if (/ครอบครัว\s*อสม/.test(t)) return 'บุคคลในครอบครัว อสม.';
  if (/ผู้มีรายได้น้อย/.test(t)) return 'ผู้มีรายได้น้อย';
  if (/เบิกได้จ่ายตรง\s*อปท|เบิกจ่ายตรง\s*อปท|^LGO\s*:/i.test(t)) return 'เบิกจ่ายตรง อปท.';
  if (/ชำระเงินเอง|^CSH\s*:/i.test(t)) return 'ชำระเงินเอง';
  return t.replace(/^[A-Z]{2,6}\s*:\s*/i, '').trim() || 'ไม่ระบุ';
}

/** หาแถวหัวตาราง + ฟังก์ชันอ่านช่องตามชื่อหัว (รองรับชื่อหัวคอลัมน์หลายแบบ) */
export function tableCols(rows) {
  const hi = rows.findIndex((r) => r.some((c) => matchCol(c, 'status')) && (
    r.some((c) => matchCol(c, 'service')) ||
    r.some((c) => matchCol(c, 'created')) ||
    r.some((c) => matchCol(c, 'address')) ||
    r.some((c) => matchCol(c, 'hn'))
  ));
  if (hi < 0) throw new Error('ไม่พบหัวตาราง "สถานะ" และหัวข้อที่เกี่ยวข้อง (บริการขนส่ง วันเวลาสร้างออเดอร์ ที่อยู่) — ใช้ไฟล์หรือชีตประวัติรายการจัดส่งยา');
  const head = rows[hi].map((c) => String(c).trim()), col = {};
  for (const [k, name] of Object.entries(COLS)) {
    let idx = [].concat(name).map((x) => head.indexOf(x)).find((i) => i >= 0) ?? -1;
    if (idx < 0 && COL_PATTERNS[k]) {
      idx = head.findIndex((c) => COL_PATTERNS[k].test(c));
    }
    col[k] = idx;
  }
  col.reg = head.indexOf('วันเวลาที่ลงทะเบียน');
  return { hi, col };
}
export const tambonOf = (addr) => {
  const t = String(addr || '').trim();
  if (!t) return 'ไม่ระบุ';
  const m = t.match(/(?:ตำบล|ต\.)\s*([^\s,]+)/);
  if (m) return clean(m[1].replace(/^[.\s]+/, '')) || 'ไม่ระบุ';
  if (!/[0-9]/.test(t) && !/(?:อำเภอ|อ\.|จังหวัด|จ\.|หมู่|ม\.)/.test(t) && t.length <= 40) {
    return clean(t.replace(/^ต(?:ำบล|\.)\s*/, '')) || 'ไม่ระบุ';
  }
  return 'ไม่ระบุ';
};

/* ---- ส่งออกเป็น Excel (ผู้ดูแลเลือกหัวข้อ/รายการเอง) · ทำในเครื่องนี้ ไม่อัปโหลด ไม่บันทึกในระบบ (มีข้อมูลส่วนบุคคล) ---- */
/** หัวข้อทั้งหมดในไฟล์ (แถวหัวตาราง) ตามลำดับในไฟล์ */
export function exportHeads(rows) {
  const { hi } = tableCols(rows);
  return rows[hi].map((c) => String(c).trim()).filter(Boolean);
}
/** แถวที่จะส่งออก: [หัวข้อที่เลือก, ...แถวข้อมูล] (หัวข้อเรียงตามที่เลือก · ข้อมูลของแต่ละรายการอยู่แถวเดียวกัน)
 *  which: all = ทุกรายการ · ok = จัดส่งสำเร็จ · rider = Health Rider ทุกสถานะ · rider_ok = Health Rider ที่สำเร็จ */
export function exportRows(rows, picked, which = 'ok') {
  const { hi, col } = tableCols(rows);
  const head = rows[hi].map((c) => String(c).trim()), idx = picked.map((h) => head.indexOf(h)).filter((i) => i >= 0);
  const get = (r, k) => (col[k] >= 0 ? String(r[col[k]] ?? '').trim() : '');
  const out = [idx.map((i) => head[i])];
  for (const r of rows.slice(hi + 1)) {
    const st = get(r, 'status'); if (!st) continue;
    if ((which === 'ok' || which === 'rider_ok') && !/สำเร็จ/.test(st)) continue;
    if ((which === 'rider' || which === 'rider_ok') && !isRider(get(r, 'service'))) continue;
    out.push(idx.map((i) => { const v = r[i] ?? ''; return typeof v === 'string' ? v.trim() : v; }));
  }
  return out;
}
/* SheetJS 0.20.3 จาก CDN ทางการของ SheetJS (ฟรี): รุ่น 0.18.5 บน npm/jsDelivr มีช่องโหว่ CVE-2023-30533 (prototype pollution ตอนอ่านไฟล์)
   และ CVE-2024-22363 (ReDoS) · SheetJS ไม่ออกรุ่นใหม่บน npm แล้ว (ตรวจความปลอดภัย 25 ต.ค. 2569) */
const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
/** บันทึกเป็นไฟล์ .xlsx (SheetJS จาก CDN · ช่องข้อความคงเป็นข้อความ เช่น HN ที่ขึ้นต้นด้วย 0) */
export async function downloadXlsx(aoa, name) {
  const XLSX = await import(XLSX_URL);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'ข้อมูล');
  XLSX.writeFile(wb, name);
}

/** Health Rider (55_rider_tambon.sql): เฉพาะบริการขนส่ง "rider" → ราย ปีงบ (จากวันที่สร้างออเดอร์) × ตำบล · HN ใช้นับคนในเครื่องแล้วทิ้ง
 *  ถ้าไม่มีคอลัมน์บริการขนส่ง จะนับทุกรายการเป็นบริการ rider
 *  → { [ปีงบ]: [{ tambon, delivered, clients, cancelled, free }] } */
export function riderByTambon(rows) {
  const { hi, col } = tableCols(rows);
  const get = (r, k) => (col[k] >= 0 ? String(r[col[k]] ?? '').trim() : '');
  const hasServiceCol = col.service >= 0;
  const out = new Map(), diag = { rows: 0, riders: 0, badDate: 0, sample: '', services: new Map() };
  for (const r of rows.slice(hi + 1)) {
    const st = get(r, 'status'); if (!st) continue;
    diag.rows++;
    if (hasServiceCol) add(diag.services, serviceName(get(r, 'service')));
    if (hasServiceCol && !isRider(get(r, 'service'))) continue;
    diag.riders++;
    const c = thDate(get(r, 'created')) || (col.reg >= 0 ? thDate(String(r[col.reg] ?? '').trim()) : null);
    if (!c) { diag.badDate++; diag.sample ||= get(r, 'created').slice(0, 40); continue; }
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

/** ตาราง (แถว × คอลัมน์) → ตัวเลขสรุป (ทั้งภาพรวมและแยกรายเดือน byMonth) · ไม่พบหัวตาราง = throw */
export function summarizeDelivery(rows) {
  const { hi, col } = tableCols(rows);
  const title = String(rows.slice(0, hi).flat().find((c) => String(c).trim()) || '').replace(/\d{6,}/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'ประวัติรายการจัดส่งยา';
  const get = (r, k) => (col[k] >= 0 ? String(r[col[k]] ?? '').trim() : '');
  const s = { total: 0, ok: 0, cancel: 0, other: 0 }, hnOk = new Set(), hnAll = new Set();
  const service = new Map(), month = new Map(), tambon = new Map(), rights = new Map(), cover = new Map(), hours = [], byMonthMap = new Map(), byYearMap = new Map();
  const getMonthBucket = (mk) => {
    let b = byMonthMap.get(mk);
    if (!b) {
      b = {
        total: 0, ok: 0, cancel: 0, other: 0, hnOk: new Set(), hnAll: new Set(),
        service: new Map(), cover: new Map(), rights: new Map(), tambon: new Map(),
        fee: 0, free: 0, paid: 0,
      };
      byMonthMap.set(mk, b);
    }
    return b;
  };
  const getYearBucket = (fy) => {
    let b = byYearMap.get(fy);
    if (!b) {
      b = {
        total: 0, ok: 0, cancel: 0, other: 0, hnOk: new Set(), hnAll: new Set(),
        service: new Map(), cover: new Map(), rights: new Map(), tambon: new Map(), month: new Map(),
        fee: 0, free: 0, paid: 0,
      };
      byYearMap.set(fy, b);
    }
    return b;
  };
  let fee = 0, free = 0, paid = 0, from = null, to = null;
  for (const r of rows.slice(hi + 1)) {
    const st = get(r, 'status'); if (!st) continue;
    s.total++;
    const c = thDate(get(r, 'created')) || (col.reg >= 0 ? thDate(String(r[col.reg] ?? '').trim()) : null);
    if (c) { if (!from || c < from) from = c; if (!to || c > to) to = c; }
    const mk = c ? `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}` : null;
    const mb = mk ? getMonthBucket(mk) : null;
    if (mb) mb.total++;
    const fy = c ? fiscalYearOf(c) : null;
    const yb = fy ? getYearBucket(fy) : null;
    if (yb) yb.total++;
    const hn = get(r, 'hn');
    if (hn) { hnAll.add(hn); if (mb) mb.hnAll.add(hn); if (yb) yb.hnAll.add(hn); }
    if (/ยกเลิก/.test(st)) {
      s.cancel++;
      if (mb) mb.cancel++;
      if (yb) yb.cancel++;
      continue;
    }
    if (!/สำเร็จ/.test(st)) {
      s.other++;
      if (mb) mb.other++;
      if (yb) yb.other++;
      continue;
    }
    s.ok++;
    if (hn) {
      hnOk.add(hn);
      if (mb) mb.hnOk.add(hn);
      if (yb) yb.hnOk.add(hn);
    }
    if (mb) mb.ok++;
    if (yb) yb.ok++;
    const svc = serviceName(get(r, 'service'));
    const tam = tambonOf(get(r, 'address'));
    const rig = rightsLabel(get(r, 'rights'));
    const cov = coverLabel(get(r, 'cover'), get(r, 'rights'));
    add(service, svc);
    if (mk) add(month, mk);
    add(tambon, tam);
    add(rights, rig);
    add(cover, cov);
    if (mb) {
      add(mb.service, svc);
      add(mb.tambon, tam);
      add(mb.rights, rig);
      add(mb.cover, cov);
    }
    if (yb) {
      add(yb.service, svc);
      if (mk) add(yb.month, mk);
      add(yb.tambon, tam);
      add(yb.rights, rig);
      add(yb.cover, cov);
    }
    const f = +get(r, 'fee').replace(/[^\d.]/g, '');
    if (Number.isFinite(f) && get(r, 'fee') !== '' && get(r, 'fee') !== '-') {
      fee += f; if (f > 0) paid++; else free++;
      if (mb) { mb.fee += f; if (f > 0) mb.paid++; else mb.free++; }
      if (yb) { yb.fee += f; if (f > 0) yb.paid++; else yb.free++; }
    }
    const d = thDate(get(r, 'done'));
    if (c && d && d >= c) hours.push((d - c) / 3600000);
  }
  if (!s.total) throw new Error('ไม่พบรายการจัดส่งในไฟล์');
  hours.sort((a, b) => a - b);
  const r1 = (x) => Math.round(x * 10) / 10;
  const byMonth = [...byMonthMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, m]) => [k, {
      total: m.total, ok: m.ok, cancel: m.cancel, other: m.other,
      patients: m.hnOk.size, patientsAll: m.hnAll.size,
      service: top(m.service), cover: top(m.cover), rights: top(m.rights), tambon: top(m.tambon),
      fee: Math.round(m.fee), free: m.free, paid: m.paid,
    }]);
  const byYear = [...byYearMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([fy, y]) => [fy, {
      total: y.total, ok: y.ok, cancel: y.cancel, other: y.other,
      patients: y.hnOk.size, patientsAll: y.hnAll.size,
      service: top(y.service), cover: top(y.cover), rights: top(y.rights), tambon: top(y.tambon),
      month: [...y.month.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      fee: Math.round(y.fee), free: y.free, paid: y.paid,
    }]);
  return {
    title, from: from ? iso(from) : null, to: to ? iso(to) : null,
    summary: {
      v: 1, ...s, patients: hnOk.size, patientsAll: hnAll.size,
      service: top(service), month: [...month.entries()].sort((a, b) => a[0].localeCompare(b[0])), tambon: top(tambon), rights: top(rights), cover: top(cover),
      byMonth, byYear,
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
  const XLSX = await import(XLSX_URL);
  const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
  // ช่องวันที่ของ Excel เป็นวันที่จริง (ไม่ใช่ข้อความ "วันที่ 01/05/2569") → แปลงเป็น วว/ดด/ปปปป ชช:นน (ค.ศ.) ให้อ่านแบบเดียวกับ CSV
  const pad = (x) => String(x).padStart(2, '0');
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })
    .map((r) => r.map((c) => (c instanceof Date ? `${pad(c.getDate())}/${pad(c.getMonth() + 1)}/${c.getFullYear()} ${pad(c.getHours())}:${pad(c.getMinutes())}` : c)));
}

/** ดึง Sheet ID และ GID จากลิงก์ Google Sheets ทุกรูปแบบ */
export function parseGoogleSheetUrl(url) {
  const u = String(url || '').trim();
  const mId = u.match(/\/spreadsheets\/(?:d|e)\/([a-zA-Z0-9-_]+)/);
  if (!mId) return null;
  const id = mId[1];
  const mGid = u.match(/[#&?]gid=([0-9]+)/);
  const gid = mGid ? mGid[1] : null;
  return { id, gid };
}

/** ดึงข้อมูลจาก Google Sheets (เปิดสิทธิ์ "ทุกคนที่มีลิงก์มีสิทธิ์อ่าน" หรือ เผยแพร่ไปยังเว็บ) → ตาราง 2 มิติ */
export async function fetchGoogleSheet(url) {
  const parsed = parseGoogleSheetUrl(url);
  if (!parsed) throw new Error('ลิงก์ Google Sheets ไม่ถูกต้อง — กรุณาคัดลอกลิงก์จากแถบที่อยู่ของเบราว์เซอร์');
  const { id, gid } = parsed;
  const gvizUrl = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json${gid ? `&gid=${gid}` : ''}`;
  let res;
  try {
    res = await fetch(gvizUrl);
  } catch (err) {
    throw new Error('เชื่อมต่อ Google Sheets ไม่ได้ — ตรวจสอบอินเทอร์เน็ต');
  }
  if (!res.ok) {
    throw new Error(`Google Sheets ตอบกลับสถานะ ${res.status} — ตรวจสอบว่าแชร์เป็น "ทุกคนที่มีลิงก์มีสิทธิ์อ่าน" หรือไม่`);
  }
  const text = await res.text();
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end < 0) {
    throw new Error('รูปแบบข้อมูล Google Sheets ไม่ถูกต้อง — ตรวจสอบว่าแชร์สิทธิ์ถูกต้อง');
  }
  let json;
  try {
    json = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('อ่านข้อมูล JSON จาก Google Sheets ไม่สำเร็จ');
  }
  if (json.status === 'error') {
    const msg = json.errors?.[0]?.message || 'เกิดข้อผิดพลาดในการอ่านชีต';
    throw new Error(`Google Sheets: ${msg}`);
  }
  const table = json.table;
  if (!table) throw new Error('ไม่พบตารางข้อมูลใน Google Sheets');
  const rows = [];
  const head = (table.cols || []).map((c) => (c ? String(c.label || '').trim() : ''));
  if (head.some(Boolean)) rows.push(head);
  for (const r of table.rows || []) {
    if (!r || !r.c) continue;
    const row = r.c.map((cell) => {
      if (!cell) return '';
      if (cell.f != null) return String(cell.f).trim();
      if (cell.v != null) return String(cell.v).trim();
      return '';
    });
    if (row.some(Boolean)) rows.push(row);
  }
  if (!rows.length) throw new Error('ไม่พบข้อมูลใน Google Sheet นี้');
  return rows;
}

/* ======================= แสดงผล (ใช้ทั้งหน้าหลักและตัวอย่างของผู้ดูแล) ======================= */
const monthLabel = (k) => { const [y, m] = String(k || '').split('-'); return TH_MONTH[+m - 1] ? `${TH_MONTH[+m - 1]} ${String(+y + 543).slice(2)}` : k; };
export const monthFullLabel = (k) => { const [y, m] = String(k || '').split('-'); return TH_MONTH_FULL[+m - 1] ? `เดือน ${TH_MONTH_FULL[+m - 1]} ${+y + 543}` : String(k || ''); };
const monthTabLabel = (k) => { const [y, m] = String(k || '').split('-'); return TH_MONTH_FULL[+m - 1] ? `${TH_MONTH_FULL[+m - 1]} ${+y + 543}` : String(k || ''); };
const pctStr = (v, total) => {
  if (!total || !v) return '0%';
  const p = Math.round((Number(v) / Number(total)) * 1000) / 10;
  return `${p.toFixed(1).replace(/\.0$/, '')}%`;
};

/** สร้างข้อความสรุปมาตรฐาน (1. ภาพรวมความสำเร็จ · 2. ช่องทางการจัดส่ง · 3. กลุ่มผู้รับบริการและสิทธิการรักษา · 4. สรุปรายเดือน · 5. ตามตำบล) สำหรับคัดลอกหรือแสดงผล */
export function buildMonthReportText(heading, m) {
  const ok = Number(m.ok || 0), total = Number(m.total || ok), patients = Number(m.patients || 0);
  const rate = total > 0 ? pctStr(ok, total) : '0%';
  const lines = [
    heading,
    '',
    '1. ภาพรวมความสำเร็จ (Key Highlights)',
    `ยอดการจัดส่งยาทั้งสิ้น: ${n(ok)} ครั้ง`,
    `จำนวนผู้รับบริการทั้งหมด: ${n(patients)} ราย`,
    `คิดเป็นอัตราการจัดส่งสำเร็จ: ${rate} (เฉพาะที่ได้ลงทะเบียนและทำการจัดส่ง)`,
  ];
  const svcs = (m.service || []).filter((x) => x[1] > 0);
  if (svcs.length) {
    lines.push('', '2. ช่องทางการจัดส่ง (Delivery Channels)');
    for (const [k, v] of svcs) lines.push(`${channelLabel(k)}: ${n(v)} ครั้ง (คิดเป็น ${pctStr(v, ok)})`);
  }
  const covs = (m.cover || []).filter((x) => x[1] > 0);
  const rigs = (m.rights || []).filter((x) => x[1] > 0);
  if (covs.length || rigs.length) {
    lines.push('', '3. กลุ่มผู้รับบริการและสิทธิการรักษา (Patient Demographics)');
    if (covs.length) {
      lines.push('จำแนกตามสิทธิการรักษาหลัก:');
      for (const [k, v] of covs) lines.push(`${coverLabel(k)}: ${n(v)} ครั้ง (${pctStr(v, ok)})`);
    }
    if (rigs.length) {
      if (covs.length) lines.push('');
      lines.push('จำแนกตามรายละเอียดกลุ่มเป้าหมาย (สิทธิย่อย):');
      for (const [k, v] of rigs) lines.push(`${rightsLabel(k)}: ${n(v)} ครั้ง (${pctStr(v, ok)})`);
    }
  }
  const months = (m.month || []).filter((x) => x[1] > 0);
  if (months.length) {
    lines.push('', '4. สรุปรายเดือน (จัดส่งสำเร็จ)');
    for (const [k, v] of months) lines.push(`${monthLabel(k)}: ${n(v)} ครั้ง (${pctStr(v, ok)})`);
  }
  const tams = (m.tambon || []).filter((x) => x[1] > 0);
  if (tams.length) {
    const secNum = months.length ? '5' : '4';
    lines.push('', `${secNum}. ตามตำบล`);
    for (const [k, v] of tams) {
      const lbl = k.startsWith('ต.') || k === 'ไม่ระบุ' ? k : `ต.${k}`;
      lines.push(`${lbl}: ${n(v)} ครั้ง (${pctStr(v, ok)})`);
    }
  }
  return lines.join('\n');
}

/** ดึงข้อมูลสรุปแยกรายปีงบประมาณ [[fy, yData], ...] — ถ้าบันทึกรุ่นเก่าไม่มี byYear จะแปลงจาก byMonth ให้ */
export function getFiscalYearData(summary) {
  if (Array.isArray(summary?.byYear) && summary.byYear.length) {
    return [...summary.byYear].sort((a, b) => b[0] - a[0]);
  }
  if (Array.isArray(summary?.byMonth) && summary.byMonth.length) {
    const map = new Map();
    for (const [mk, m] of summary.byMonth) {
      const [y, mo] = String(mk).split('-');
      const fy = (+y + 543) + (+mo >= 10 ? 1 : 0);
      let yb = map.get(fy);
      if (!yb) {
        yb = {
          total: 0, ok: 0, cancel: 0, other: 0, patients: 0, patientsAll: 0,
          service: new Map(), cover: new Map(), rights: new Map(), tambon: new Map(), month: new Map(),
          fee: 0, free: 0, paid: 0,
        };
        map.set(fy, yb);
      }
      yb.total += Number(m.total || 0);
      yb.ok += Number(m.ok || 0);
      yb.cancel += Number(m.cancel || 0);
      yb.other += Number(m.other || 0);
      yb.patients += Number(m.patients || 0);
      yb.patientsAll += Number(m.patientsAll || 0);
      yb.fee += Number(m.fee || 0);
      yb.free += Number(m.free || 0);
      yb.paid += Number(m.paid || 0);
      add(yb.month, mk, Number(m.ok || 0));
      for (const [k, v] of (m.service || [])) add(yb.service, k, v);
      for (const [k, v] of (m.cover || [])) add(yb.cover, k, v);
      for (const [k, v] of (m.rights || [])) add(yb.rights, k, v);
      for (const [k, v] of (m.tambon || [])) add(yb.tambon, k, v);
    }
    return [...map.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([fy, yb]) => [fy, {
        total: yb.total, ok: yb.ok, cancel: yb.cancel, other: yb.other,
        patients: yb.patients, patientsAll: yb.patientsAll,
        service: top(yb.service), cover: top(yb.cover), rights: top(yb.rights), tambon: top(yb.tambon),
        month: [...yb.month.entries()].sort((a, b) => a[0].localeCompare(b[0])),
        fee: Math.round(yb.fee), free: yb.free, paid: yb.paid,
      }]);
  }
  return [];
}

export function yearHeading(fy, y) {
  const months = (y?.month || []).filter((x) => x[1] > 0);
  const range = months.length > 1
    ? ` (${monthLabel(months[0][0])} – ${monthLabel(months[months.length - 1][0])})`
    : months.length === 1 ? ` (${monthLabel(months[0][0])})` : '';
  return `ภาพรวมปีงบประมาณ ${fy}${range}`;
}

function renderMonthCard(heading, m, key, isTotal = false) {
  const ok = Number(m.ok || 0), total = Number(m.total || ok), patients = Number(m.patients || 0);
  const rate = total > 0 ? pctStr(ok, total) : '0%';
  const svcs = (m.service || []).filter((x) => x[1] > 0);
  const covs = (m.cover || []).filter((x) => x[1] > 0);
  const rigs = (m.rights || []).filter((x) => x[1] > 0);
  const months = (m.month || []).filter((x) => x[1] > 0);
  const tams = (m.tambon || []).filter((x) => x[1] > 0);
  const hasExtra = isTotal && (months.length > 0 || tams.length > 0);
  const monthSec = 4;
  const tamSec = months.length > 0 ? 5 : 4;

  return `<details class="dr-month-card${isTotal ? ' dr-month-total' : ''}" data-month-card="${esc(key)}" open>`
    + `<summary class="dr-month-head">`
    + `<span class="dr-month-title"><h3>${esc(heading)}</h3>`
    + `<span class="small muted dr-month-badge">${n(ok)} ครั้ง (${rate})</span></span>`
    + `<div class="dr-month-actions">`
    + `<button type="button" class="btn btn-o btn-sm" data-dr-copy="${esc(key)}" title="คัดลอกสรุป">คัดลอกสรุป</button>`
    + `</div></summary>`
    + '<div class="dr-month-body">'
    + '<div class="dr-sec"><h4>1. ภาพรวมความสำเร็จ (Key Highlights)</h4><ul class="dr-kv-list">'
    + `<li><div class="dr-line"><span>ยอดการจัดส่งยาทั้งสิ้น:</span><b class="num">${n(ok)} ครั้ง</b></div></li>`
    + `<li><div class="dr-line"><span>จำนวนผู้รับบริการทั้งหมด:</span><b class="num">${n(patients)} ราย</b></div></li>`
    + `<li><div class="dr-line"><span>คิดเป็นอัตราการจัดส่งสำเร็จ:</span><b class="num">${rate} <span class="small muted">(เฉพาะที่ได้ลงทะเบียนและทำการจัดส่ง)</span></b></div></li>`
    + '</ul></div>'
    + (svcs.length ? '<div class="dr-sec"><h4>2. ช่องทางการจัดส่ง (Delivery Channels)</h4><ul class="dr-kv-list">'
      + svcs.map(([k, v]) => `<li><div class="dr-line"><span>${esc(channelLabel(k))}:</span><b class="num">${n(v)} ครั้ง (คิดเป็น ${pctStr(v, ok)})</b></div>`
        + `<div class="meter"><span style="width:${ok ? Math.round((v / ok) * 100) : 0}%"></span></div></li>`).join('')
      + '</ul></div>' : '')
    + ((covs.length || rigs.length) ? '<div class="dr-sec"><h4>3. กลุ่มผู้รับบริการและสิทธิการรักษา (Patient Demographics)</h4>'
      + (covs.length ? '<div class="dr-subsec"><h5>จำแนกตามสิทธิการรักษาหลัก:</h5><ul class="dr-kv-list">'
        + covs.map(([k, v]) => `<li><div class="dr-line"><span>${esc(coverLabel(k))}:</span><b class="num">${n(v)} ครั้ง (${pctStr(v, ok)})</b></div>`
          + `<div class="meter"><span style="width:${ok ? Math.round((v / ok) * 100) : 0}%"></span></div></li>`).join('')
        + '</ul></div>' : '')
      + (rigs.length ? '<div class="dr-subsec"><h5>จำแนกตามรายละเอียดกลุ่มเป้าหมาย (สิทธิย่อย):</h5><ul class="dr-kv-list">'
        + rigs.map(([k, v]) => `<li><div class="dr-line"><span>${esc(rightsLabel(k))}:</span><b class="num">${n(v)} ครั้ง (${pctStr(v, ok)})</b></div>`
          + `<div class="meter"><span style="width:${ok ? Math.round((v / ok) * 100) : 0}%"></span></div></li>`).join('')
        + '</ul></div>' : '')
      + '</div>' : '')
    + (hasExtra ? `<div class="dr-grid" style="margin-top:2px">`
      + (months.length ? `<div class="dr-sec"><h4>${monthSec}. สรุปรายเดือน (จัดส่งสำเร็จ)</h4><ul class="dr-kv-list">`
        + months.map(([k, v]) => `<li><div class="dr-line"><span>${esc(monthLabel(k))}:</span><b class="num">${n(v)} ครั้ง (${pctStr(v, ok)})</b></div>`
          + `<div class="meter"><span style="width:${ok ? Math.round((v / ok) * 100) : 0}%"></span></div></li>`).join('')
        + '</ul></div>' : '')
      + (tams.length ? `<div class="dr-sec"><h4>${tamSec}. ตามตำบล</h4><ul class="dr-kv-list">`
        + tams.map(([k, v]) => `<li><div class="dr-line"><span>${esc(k.startsWith('ต.') || k === 'ไม่ระบุ' ? k : 'ต.' + k)}:</span><b class="num">${n(v)} ครั้ง (${pctStr(v, ok)})</b></div>`
          + `<div class="meter"><span style="width:${ok ? Math.round((v / ok) * 100) : 0}%"></span></div></li>`).join('')
        + '</ul></div>' : '')
      + `</div>` : '')
    + '</div></details>';
}

async function copyTextSafe(txt) {
  let copied = false;
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(txt); copied = true; } catch { copied = false; }
  }
  if (!copied) {
    try {
      const ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      copied = document.execCommand('copy');
      ta.remove();
    } catch { copied = false; }
  }
  toast('คัดลอกข้อความสรุปแล้ว');
}

export function renderDeliveryReport(box, rep) {
  const s = rep.summary || {};
  const period = rep.period_from ? `${thaiDate(rep.period_from)} – ${thaiDate(rep.period_to)}` : '';
  const byYears = getFiscalYearData(s);
  const byMonthDesc = Array.isArray(s.byMonth) ? [...s.byMonth].reverse() : [];
  const textMap = new Map();
  for (const [mk, m] of byMonthDesc) textMap.set(mk, buildMonthReportText(monthFullLabel(mk), m));
  for (const [fy, y] of byYears) {
    const heading = yearHeading(fy, y);
    textMap.set('fy-' + fy, buildMonthReportText(heading, y));
  }
  if (byYears.length) {
    const allFyText = byYears.map(([fy, y]) => buildMonthReportText(yearHeading(fy, y), y)).join('\n\n' + '─'.repeat(40) + '\n\n');
    textMap.set('total', allFyText);
  } else {
    textMap.set('total', buildMonthReportText('สรุปภาพรวมการจัดส่งยา', s));
  }
  box._drTexts = textMap;

  const monthlyHtml = (byMonthDesc.length || s.ok) ? `<div class="dr-monthly">`
    + `<div class="dr-monthly-bar"><h3>สรุปผลการดำเนินงานแยกตามเดือน</h3>`
    + `<div class="row-btns dr-monthly-bar-btns" style="align-items:center;gap:6px">`
    + `<button type="button" class="btn btn-o btn-sm" data-dr-toggle-all>ย่อทั้งหมด</button>`
    + (byMonthDesc.length > 1 ? `<button type="button" class="btn btn-o btn-sm" data-dr-copy-all>คัดลอกสรุปทุกเดือน</button>` : '')
    + `</div></div>`
    + (byMonthDesc.length > 1 ? `<div class="unit-tabs dr-month-tabs" role="tablist" aria-label="เลือกเดือนที่ต้องการดู">`
      + `<button type="button" data-dr-month-tab="all" aria-current="true">ทุกเดือน (${byMonthDesc.length} เดือน)</button>`
      + byMonthDesc.map(([mk]) => `<button type="button" data-dr-month-tab="${esc(mk)}" aria-current="false">${esc(monthTabLabel(mk))}</button>`).join('')
      + (byYears.length > 1
        ? `<button type="button" data-dr-month-tab="total" aria-current="false">ภาพรวมแยกปีงบ</button>`
          + byYears.map(([fy]) => `<button type="button" data-dr-month-tab="fy-${fy}" aria-current="false">ปีงบ ${fy}</button>`).join('')
        : `<button type="button" data-dr-month-tab="total" aria-current="false">ภาพรวม${byYears.length ? `ปีงบ ${byYears[0][0]}` : 'ทุกเดือน'}</button>`)
      + `</div>` : '')
    + `<div class="dr-month-grid">`
    + (byMonthDesc.length
        ? byMonthDesc.map(([mk, m]) => renderMonthCard(monthFullLabel(mk), m, mk, false)).join('')
        : (byYears.length
            ? byYears.map(([fy, y]) => renderMonthCard(yearHeading(fy, y), y, 'fy-' + fy, true)).join('')
            : renderMonthCard('สรุปภาพรวมการจัดส่งยา', s, 'total', true)))
    + `</div>`
    + (byMonthDesc.length > 1 ? `<div class="dr-total-section" data-month-card="total" hidden>`
      + (byYears.length
          ? byYears.map(([fy, y]) => renderMonthCard(yearHeading(fy, y), y, 'fy-' + fy, true)).join('')
          : renderMonthCard('สรุปภาพรวมการจัดส่งยา', s, 'total', true))
      + `</div>` : '')
    + `</div>` : '';

  box.innerHTML = `<p class="small muted">${esc(rep.title)}${period ? ' · ' + esc(period) : ''} · ตัวเลขสรุปเท่านั้น ไม่มีข้อมูลรายบุคคล</p>`
    + '<div class="track-figs dl-figs">'
    + `<div class="fig"><div class="n num">${n(s.ok)}</div><div class="t">จัดส่งยาสำเร็จ (ครั้ง)</div></div>`
    + `<div class="fig"><div class="n num">${n(s.patients)}</div><div class="t">ผู้ป่วยที่ได้รับยา (คน)</div></div>`
    + `<div class="fig"><div class="n num">${s.ok ? Math.round((s.free / Math.max(1, s.free + s.paid)) * 100) : 0}%</div><div class="t">ส่งฟรี (ไม่เสียค่าจัดส่ง)</div></div>`
    + (s.hoursMedian != null ? `<div class="fig"><div class="n num">${s.hoursMedian < 24 ? n(s.hoursMedian) + ' ชม.' : n(Math.round(s.hoursMedian / 24 * 10) / 10) + ' วัน'}</div><div class="t">ระยะเวลาส่งถึงมือ (ค่ากลาง)</div></div>` : '')
    + '</div>'
    + `<p class="small muted">รายการทั้งหมด ${n(s.total)} · สำเร็จ ${n(s.ok)} · ยกเลิก ${n(s.cancel)}${s.other ? ' · อื่น ๆ ' + n(s.other) : ''} · ค่าจัดส่งรวม ${n(s.fee)} บาท</p>`
    + (rep.ai_status === 'done' && rep.ai_text ? `<div class="dr-ai"><h3>สรุปโดย AI</h3>${String(rep.ai_text).split(/\n+/).filter((l) => l.trim()).map((l) => `<p>${esc(l)}</p>`).join('')}</div>` : '')
    + monthlyHtml;

  if (!box._drBound) {
    box._drBound = true;
    const syncToggleAll = () => {
      const tgAll = box.querySelector('[data-dr-toggle-all]');
      if (!tgAll) return;
      const cards = [...box.querySelectorAll('details.dr-month-card')].filter((c) => !c.hidden && !c.closest('[hidden]'));
      if (!cards.length) return;
      const anyOpen = cards.some((c) => c.open);
      tgAll.textContent = anyOpen ? 'ย่อทั้งหมด' : 'ขยายทั้งหมด';
    };
    box.addEventListener('toggle', syncToggleAll, true);
    box.addEventListener('click', (e) => {
      const tgAll = e.target.closest('[data-dr-toggle-all]');
      if (tgAll) {
        const cards = [...box.querySelectorAll('details.dr-month-card')].filter((c) => !c.hidden && !c.closest('[hidden]'));
        const anyOpen = cards.some((c) => c.open);
        cards.forEach((c) => { c.open = !anyOpen; });
        tgAll.textContent = anyOpen ? 'ขยายทั้งหมด' : 'ย่อทั้งหมด';
        return;
      }
      const tab = e.target.closest('[data-dr-month-tab]');
      if (tab) {
        const pick = tab.dataset.drMonthTab;
        box.querySelectorAll('[data-dr-month-tab]').forEach((b) => b.setAttribute('aria-current', String(b === tab)));
        const totalSec = box.querySelector('.dr-total-section');
        const monthGrid = box.querySelector('.dr-month-grid');
        if (pick === 'all') {
          if (monthGrid) monthGrid.hidden = false;
          if (totalSec) totalSec.hidden = true;
          box.querySelectorAll('.dr-month-grid [data-month-card]').forEach((c) => { c.hidden = false; });
        } else if (pick === 'total') {
          if (monthGrid) monthGrid.hidden = true;
          if (totalSec) {
            totalSec.hidden = false;
            totalSec.querySelectorAll('[data-month-card]').forEach((c) => {
              c.hidden = false;
              c.open = true;
            });
          }
        } else if (pick.startsWith('fy-')) {
          if (monthGrid) monthGrid.hidden = true;
          if (totalSec) {
            totalSec.hidden = false;
            totalSec.querySelectorAll('[data-month-card]').forEach((c) => {
              const isMatch = c.dataset.monthCard === pick;
              c.hidden = !isMatch;
              if (isMatch) c.open = true;
            });
          }
        } else {
          if (monthGrid) monthGrid.hidden = false;
          if (totalSec) totalSec.hidden = true;
          box.querySelectorAll('.dr-month-grid [data-month-card]').forEach((c) => {
            const isMatch = c.dataset.monthCard === pick;
            c.hidden = !isMatch;
            if (isMatch) c.open = true;
          });
        }
        syncToggleAll();
        return;
      }
      const cp = e.target.closest('[data-dr-copy]');
      if (cp && box._drTexts) {
        e.preventDefault();
        e.stopPropagation();
        const txt = box._drTexts.get(cp.dataset.drCopy);
        if (txt) copyTextSafe(txt);
        return;
      }
      const cpAll = e.target.closest('[data-dr-copy-all]');
      if (cpAll && box._drTexts) {
        const monthsTxt = byMonthDesc.map(([mk]) => box._drTexts.get(mk)).filter(Boolean);
        const fyTxt = byYears.map(([fy]) => box._drTexts.get('fy-' + fy)).filter(Boolean);
        const allTxt = [...monthsTxt, ...fyTxt].join('\n\n' + '─'.repeat(40) + '\n\n');
        if (allTxt) copyTextSafe(allTxt);
      }
    });
  }
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
    $('#drSheetBtn')?.addEventListener('click', onSheet);
    $('#drSheetUrl')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onSheet(); } });
    $('#drSave').addEventListener('click', saveDraft);
    $('#drList').addEventListener('click', onList);
  }
  await loadAdminList();
}

async function runAiForReport(id, notify = true) {
  const { error } = await sb.rpc('ai_delivery_start', { p_id: id });
  if (error) throw error;
  let r = { ai_status: 'pending' };
  for (let i = 0; r.ai_status === 'pending' && i < 80; i++) {
    await new Promise((ok) => setTimeout(ok, i < 2 ? 1200 : 2500));
    const { data, error: e2 } = await sb.rpc('ai_delivery_poll', { p_id: id });
    if (e2) throw e2;
    r = data || {};
  }
  if (notify) {
    if (r.ai_status === 'done') toast('AI สรุปแล้ว · แสดงที่หน้าจัดส่งยา');
    else toast(r.ai_note || 'AI ยังสรุปไม่เสร็จ กรุณาลองใหม่', 'err');
  }
  return r;
}

async function onSheet() {
  const url = ($('#drSheetUrl')?.value || '').trim();
  if (!url) { toast('กรุณาวางลิงก์ Google Sheets ก่อน', 'err'); $('#drSheetUrl')?.focus(); return; }
  const msg = $('#drMsg'); msg.style.color = ''; msg.textContent = 'กำลังดึงข้อมูลจาก Google Sheets และสรุปแยกตามเดือน…';
  const btn = $('#drSheetBtn'); busy(btn, true, 'กำลังดึง…');
  try {
    const table = await fetchGoogleSheet(url);
    draft = summarizeDelivery(table);
    $('#drTitle').value = draft.title;
    renderDeliveryReport($('#drPreview'), { title: draft.title, period_from: draft.from, period_to: draft.to, summary: draft.summary });
    $('#drPreviewWrap').hidden = false;
    const mCount = draft.summary.byMonth?.length || 1;
    msg.style.color = 'var(--success)';
    msg.textContent = `อ่านแล้ว ${n(draft.summary.total)} รายการ (แยก ${mCount} เดือน) · ตรวจตัวอย่างด้านล่างแล้วกด "บันทึกและแสดงที่หน้าจัดส่งยา"`;
  } catch (err) {
    draft = null; $('#drPreviewWrap').hidden = true;
    msg.style.color = 'var(--error)'; msg.textContent = 'อ่าน Google Sheets ไม่สำเร็จ: ' + errText(err);
  } finally {
    busy(btn, false);
  }
}
async function saveDraft() {
  if (!draft) { toast('กรุณาดึงข้อมูลจาก Google Sheets ก่อน', 'err'); return; }
  const btn = $('#drSave'); busy(btn, true, 'กำลังบันทึก…');
  const title = $('#drTitle').value.trim() || draft.title;
  const { error } = await sb.from('delivery_reports').insert({ title, period_from: draft.from, period_to: draft.to, summary: draft.summary });
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
    + `<span class="small muted">${r.period_from ? esc(`${thaiDate(r.period_from)} – ${thaiDate(r.period_to)}`) + ' · ' : ''}สำเร็จ ${n(r.summary?.ok)} ครั้ง · ผู้ป่วย ${n(r.summary?.patients)} คน${r.summary?.byMonth?.length ? ` · ${r.summary.byMonth.length} เดือน` : ''} · บันทึก ${esc(thaiDate(r.created_at))}</span>`
    + `<span class="small ${r.ai_status === 'error' ? 'ai-err' : 'muted'}" data-ai-st="${r.id}">${r.ai_status === 'done' ? '✓ มีสรุปจาก AI แล้ว' : r.ai_status === 'pending' ? 'AI กำลังสรุป…' : r.ai_status === 'error' ? esc(r.ai_note || 'AI สรุปไม่สำเร็จ') : 'ยังไม่มีสรุปจาก AI'}</span></div>`
    + `<div class="row-btns"><button type="button" class="btn btn-o btn-sm" data-ai="${r.id}">${r.ai_status === 'done' ? 'ให้ AI สรุปใหม่' : 'ให้ AI สรุปเป็นข้อความ'}</button><button type="button" class="btn btn-no btn-sm" data-del="${r.id}">ลบ</button></div></div>`).join('')
    : '<p class="empty">ยังไม่มีสรุปจาก Google Sheets · วางลิงก์ด้านบนเพื่อเริ่ม</p>';
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
    await runAiForReport(id, true);
  } catch (err) { toast(errText(err), 'err'); }
  finally { busy(ai, false); loadAdminList(); initDeliveryReports(); }
  if (st()) st().scrollIntoView({ block: 'nearest' });
}
