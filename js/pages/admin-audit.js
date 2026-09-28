// ผู้ดูแล › ตั้งค่า › ประวัติการเข้าถึงข้อมูลผู้ป่วย (PDPA)
// ข้อมูลมาจาก admin_audit_log() ในฐานข้อมูล (ผู้ดูแลเท่านั้น) · บันทึกแก้/ลบไม่ได้ · ดาวน์โหลด CSV ไว้ใช้ยืนยันเวลามีการตรวจสอบ
import { sb } from '../supabase.js?v=4.4';
import { $, esc, thaiDateTime, toast, errText, busy } from '../util.js?v=4.4';
import { loadUnits } from '../data.js?v=4.4';

const PAGE = 100;
const ACTS = {
  'list:patients': ['เปิดรายชื่อผู้ป่วย', 'c-sub'], 'view:patients': ['เปิดดูข้อมูลผู้ป่วย', 'c-sub'],
  'insert:patients': ['เพิ่มผู้ป่วย', 'c-ok'], 'update:patients': ['แก้ไขข้อมูลผู้ป่วย', 'c-fix'], 'delete:patients': ['ลบผู้ป่วย', 'c-del'],
  'insert:visits': ['เพิ่มบันทึกเยี่ยมบ้าน', 'c-ok'], 'update:visits': ['แก้ไขบันทึกเยี่ยมบ้าน', 'c-fix'], 'delete:visits': ['ลบบันทึกเยี่ยมบ้าน', 'c-del'],
};
const FIELDS = {
  first_name: 'ชื่อ', last_name: 'นามสกุล', national_id: 'เลข 13 หลัก', birth_date: 'วันเกิด', hn_hospital: 'HN รพ.', hn_unit: 'HN รพ.สต.',
  coverage: 'สิทธิการรักษา', unit_id: 'รพ.สต.', visit_date: 'วันที่เยี่ยม', age: 'อายุ', weight: 'น้ำหนัก', bp: 'ความดัน', dtx: 'น้ำตาล',
  subjective: 'อาการ (S)', med_reconcile: 'Medication reconciliation', med_list: 'รายการยา', med_excess: 'ยาเหลือค้าง', drps: 'DRPs',
  drp_detail: 'รายละเอียด DRPs', drp_resolved: 'แก้ DRPs สำเร็จ', plan: 'แผนการดูแล (P)', next_appt: 'นัดครั้งถัดไป', med_until: 'ยาพอถึงวันที่',
};
const ROLE = { admin: 'ผู้ดูแล', staff: 'เจ้าหน้าที่', citizen: 'ประชาชน' };

let rows = [], total = 0, bound = false;
const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const act = (r) => ACTS[`${r.action}:${r.table_name}`] || [r.action, 'c-off'];
const who = (r) => r.actor_name || r.actor_email || (r.actor_id ? 'ผู้ใช้ที่ถูกลบแล้ว' : 'ระบบ');
const what = (r) => r.patient_name || (r.action === 'list' ? 'รายชื่อผู้ป่วยทั้งหน่วย' : 'ผู้ป่วยที่ถูกลบแล้ว');
const detail = (r) => (r.action === 'update' && r.detail ? 'แก้ไข: ' + r.detail.split(',').map((f) => FIELDS[f] || f).join(', ') : r.detail || '');

function filters() {
  return { p_from: $('#auFrom').value || null, p_to: $('#auTo').value || null, p_unit: $('#auUnit').value ? +$('#auUnit').value : null,
    p_action: $('#auAction').value || null, p_q: $('#auSearch').value.trim() || null };
}

export async function initAudit() {
  const units = await loadUnits();
  if (!bound) {
    bound = true;
    $('#auUnit').innerHTML = '<option value="">ทุก รพ.สต.</option>' + units.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('');
    const d = new Date(); $('#auTo').value = ymd(d); d.setDate(d.getDate() - 30); $('#auFrom').value = ymd(d);
    $('#auForm').addEventListener('submit', (e) => { e.preventDefault(); load(false); });
    $('#auMore').addEventListener('click', () => load(true));
    $('#auCsv').addEventListener('click', downloadCsv);
  }
  await load(false);
}

async function load(more) {
  if (!more) { rows = []; $('#auList').innerHTML = '<div class="skeleton" style="margin:12px 0"></div><div class="skeleton" style="width:70%"></div>'; }
  const btn = more ? $('#auMore') : $('#auShow');
  busy(btn, true, 'กำลังโหลด…');
  const { data, error } = await sb.rpc('admin_audit_log', { ...filters(), p_limit: PAGE, p_offset: rows.length });
  busy(btn, false);
  if (error) { $('#auList').innerHTML = `<p class="empty">โหลดไม่สำเร็จ: ${esc(errText(error))}</p>`; toast(errText(error), 'err'); return; }
  rows = rows.concat(data || []);
  total = data?.length ? +data[0].total : rows.length;
  render();
}

function render() {
  $('#auCount').textContent = `(${total.toLocaleString('th-TH')} รายการ)`;
  $('#auList').innerHTML = rows.length ? rows.map((r) => {
    const [label, cls] = act(r), d = detail(r);
    return `<div class="audit-row"><div class="l"><b>${esc(who(r))}</b>`
      + `<span class="small muted">${esc(r.actor_email || '')}${r.actor_role ? ' · ' + esc(ROLE[r.actor_role] || r.actor_role) : ''}</span>`
      + `<span class="small">${esc(what(r))}${r.unit_name ? ' · รพ.สต. ' + esc(r.unit_name) : ''}</span>`
      + (d ? `<span class="small muted">${esc(d)}</span>` : '') + '</div>'
      + `<div class="meta"><span class="chip ${cls}">${esc(label)}</span><span class="small muted num">${esc(thaiDateTime(r.at))}</span></div></div>`;
  }).join('') : '<p class="empty">ไม่พบรายการในช่วงที่เลือก</p>';
  $('#auMore').hidden = rows.length >= total;
}

async function downloadCsv() {
  const btn = $('#auCsv');
  busy(btn, true, 'กำลังเตรียมไฟล์…');
  const { data, error } = await sb.rpc('admin_audit_log', { ...filters(), p_limit: 5000, p_offset: 0 });
  busy(btn, false);
  if (error) { toast(errText(error), 'err'); return; }
  if (!data?.length) { toast('ไม่มีรายการให้ดาวน์โหลด', 'err'); return; }
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['วันเวลา', 'ผู้ใช้', 'อีเมล', 'บทบาท', 'การกระทำ', 'ผู้ป่วย', 'รพ.สต.', 'รายละเอียด', 'รหัสอ้างอิง'];
  const lines = data.map((r) => [thaiDateTime(r.at), who(r), r.actor_email, ROLE[r.actor_role] || r.actor_role, act(r)[0], what(r), r.unit_name, detail(r), r.id].map(cell).join(','));
  const blob = new Blob(['﻿' + [head.map(cell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `patient-access-log_${filters().p_from || 'all'}_${filters().p_to || ymd(new Date())}.csv`;   // ชื่อภาษาไทย Chrome ไม่รับ
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 1000);
  toast(`ดาวน์โหลด ${data.length.toLocaleString('th-TH')} รายการแล้ว${+data[0].total > data.length ? ' (สูงสุด 5,000 รายการ — แบ่งช่วงวันที่ถ้าต้องการมากกว่านี้)' : ''}`);
}
