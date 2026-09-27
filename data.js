// ข้อมูลอ้างอิงที่ใช้หลายหน้า (โหลดครั้งเดียวแล้วเก็บไว้)
import { sb } from './supabase.js';
import { fiscalYearOf } from './util.js';

let units = null, years = null;

/** รายชื่อ รพ.สต. [{id,name,phone,address,note,image_path}] */
export async function loadUnits(force = false) {
  if (units && !force) return units;
  const { data, error } = await sb.from('units').select('id,name,phone,address,note,image_path').order('sort');
  if (error) throw error;
  units = data;
  return units;
}
export const unitName = (id) => units?.find((u) => u.id === id)?.name || '';

/** ปีงบประมาณที่มีเกณฑ์ในระบบ + ปีงบปัจจุบัน (เรียงเก่า → ใหม่) */
export async function loadYears() {
  if (years) return years;
  const { data } = await sb.from('criteria_years').select('fiscal_year').order('fiscal_year');
  const set = new Set((data || []).map((r) => r.fiscal_year));
  set.add(fiscalYearOf());
  years = [...set].sort((a, b) => a - b);
  return years;
}
