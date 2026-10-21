// ผู้ดูแล › ข้อมูลยา › ถังยาที่ลบ (88_drug_trash.sql · เจ้าของเว็บ 21 ต.ค.)
//   กดลบยา (หน้าทำงานทีละยา · ตารางแก้ไขยา · เครื่องมือฐานข้อมูล) = ย้ายลงถัง (local_drugs.trashed_at) ยังไม่ลบจริง · ประชาชน/เจ้าหน้าที่มองไม่เห็นทันที (RLS)
//   กล่อง #dcTrash ใต้หน้าข้อมูลยา: เรียกคืนได้ภายใน 7 วัน · ครบ 7 วัน หน้าผู้ดูแลลบถาวรให้เอง (purgeOld)
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, busy, errText, thaiDate } from '../util.js?v=4.4';
import { drugData, reloadDrugData, codeTag } from './admin-drugs.js?v=4.4';

export const TRASH_DAYS = 7;
const DAY = 86400000;
let bound = false, purged = false;

/** ย้ายยาลงถัง (ถามยืนยันก่อน) · คืนค่า true เมื่อย้ายแล้ว */
export async function trashDrug(l, btn = null) {
  if (!confirm(`ลบ "${l.name}" ออกจากรายการยา?\nยาจะอยู่ในถังยาที่ลบ ${TRASH_DAYS} วัน (เรียกคืนได้) แล้วจึงลบถาวร`)) return false;
  if (btn) busy(btn, true, 'กำลังลบ…');
  try {
    const { error } = await sb.from('local_drugs').update({ trashed_at: new Date().toISOString() }).eq('id', l.id);
    if (error) throw error;
    toast(`ย้าย "${l.name}" ลงถังแล้ว · เรียกคืนได้ภายใน ${TRASH_DAYS} วัน`);
    await reloadDrugData();
    return true;
  } catch (err) { toast(errText(err), 'err'); return false; } finally { if (btn) busy(btn, false); }
}
async function restore(id, btn) {
  busy(btn, true, 'กำลังเรียกคืน…');
  const { error } = await sb.from('local_drugs').update({ trashed_at: null }).eq('id', id);
  busy(btn, false);
  if (error) { toast(errText(error), 'err'); return; }
  toast('เรียกคืนยาแล้ว');
  await reloadDrugData();
  window.dispatchEvent(new CustomEvent('pcps:drugtrash'));   // หน้าทำงานทีละยา/ตารางแก้ไขยา วาดรายการใหม่
}
/** ยาที่อยู่ในถังครบ 7 วัน → ลบถาวร (ทำครั้งเดียวต่อการเปิดหน้า) */
async function purgeOld() {
  if (purged) return; purged = true;
  const cut = new Date(Date.now() - TRASH_DAYS * DAY).toISOString();
  const { data, error } = await sb.from('local_drugs').delete().lt('trashed_at', cut).select('id');
  if (!error && (data || []).length) await reloadDrugData();
}
function render(trashed) {
  const box = $('#dcTrash'); if (!box) return;
  $('#dcTrashN').textContent = trashed.length ? `(${trashed.length})` : '';
  const left = (t) => Math.max(0, Math.ceil((new Date(t).getTime() + TRASH_DAYS * DAY - Date.now()) / DAY));
  $('#dcTrashList').innerHTML = trashed.length
    ? [...trashed].sort((a, b) => String(b.trashed_at).localeCompare(String(a.trashed_at))).map((l) => `<div class="li" data-tr-row="${esc(l.id)}"><div class="l"><b>${codeTag(l)}${esc(l.name)}</b>`
      + `<span class="small muted">ลบเมื่อ ${esc(thaiDate(l.trashed_at))} · ลบถาวรใน ${left(l.trashed_at)} วัน</span></div>`
      + `<div class="actions"><button type="button" class="btn btn-o btn-sm" data-tr-restore="${esc(l.id)}">เรียกคืน</button></div></div>`).join('')
    : '<p class="empty small">ไม่มียาในถัง</p>';
}
export async function initDrugTrash() {
  if (!bound) {
    bound = true;
    $('#dcTrashList').addEventListener('click', (e) => { const b = e.target.closest('[data-tr-restore]'); if (b) restore(/^\d+$/.test(b.dataset.trRestore) ? +b.dataset.trRestore : b.dataset.trRestore, b); });
    window.addEventListener('pcps:drugdata', async () => render((await drugData()).trashed || []));
  }
  await purgeOld();
  render((await drugData()).trashed || []);
}
