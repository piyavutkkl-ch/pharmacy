// ข้อมูลอ้างอิงที่ใช้หลายหน้า (โหลดครั้งเดียวแล้วเก็บไว้)
import { sb } from './supabase.js?v=4.4';
import { fiscalYearOf } from './util.js?v=4.4';

let units = null, years = null, hiddenYears = new Set();

/** รายชื่อ รพ.สต. [{id,name,phone,address,note,image_path}] */
export async function loadUnits(force = false) {
  if (units && !force) return units;
  const { data, error } = await sb.from('units').select('id,name,phone,address,note,image_path').order('sort');
  if (error) throw error;
  units = data;
  return units;
}
export const unitName = (id) => units?.find((u) => u.id === id)?.name || '';

export function resetYears() { years = null; }

/** เรียงข้อเกณฑ์: หัวข้อ → หัวข้อย่อย (ตามลำดับที่ปรากฏ) → เลขข้อ (1.2 ก่อน 1.10) */
export function sortItems(items) {
  const subPos = new Map();
  [...items].sort((a, b) => a.sort - b.sort).forEach((it) => { const k = it.topic_no + '|' + it.sub_id; if (!subPos.has(k)) subPos.set(k, subPos.size); });
  const last = (no) => +String(no).split('.').pop();
  return [...items].sort((a, b) => a.topic_no - b.topic_no || subPos.get(a.topic_no + '|' + a.sub_id) - subPos.get(b.topic_no + '|' + b.sub_id) || last(a.item_no) - last(b.item_no));
}

/** ปีงบประมาณที่มีเกณฑ์ในระบบ + ปีงบปัจจุบัน (เรียงเก่า → ใหม่) · ปีที่ผู้ดูแลซ่อนไว้ไม่รวม เว้นแต่ includeHidden */
export async function loadYears({ includeHidden = false } = {}) {
  if (!years) {
    const { data } = await sb.from('criteria_years').select('fiscal_year,hidden').order('fiscal_year');
    hiddenYears = new Set((data || []).filter((r) => r.hidden).map((r) => r.fiscal_year));
    const set = new Set((data || []).map((r) => r.fiscal_year));
    set.add(fiscalYearOf());
    years = [...set].sort((a, b) => a - b);
  }
  return includeHidden ? years : years.filter((y) => !hiddenYears.has(y));
}
export const isHiddenYear = (y) => hiddenYears.has(y);
