// ผู้ดูแล › ข้อมูลยา › เครื่องมือฐานข้อมูล › บัญชียา รพ.สต. (#/admin/drugs/rpst · rpst_list · 86_rpst_list.sql · ผู้ดูแลเท่านั้น)
//   บัญชียา รพ.สต. = แหล่งข้อมูลขั้นที่ 2 (รหัสยาโรงพยาบาล · ชื่อ · หมวด · ขนาดบรรจุ · หน่วย) · ยาในเว็บแอพ (local_drugs) ผูกด้วยรหัสเดียวกัน
//   ปุ่ม "เพิ่มยาในบัญชีที่ยังไม่มีในเว็บแอพ" = ดึงทุกรายการที่ยังไม่มีมาเป็นยาในเว็บแอพครั้งเดียว (เริ่มจากบัญชี รพ.สต. · ยานอก รพ.สต. เพิ่มทีหลังได้)
//   นำเข้าไฟล์บัญชี (Excel/CSV จากระบบโรงพยาบาล · อ่านในเครื่อง): เพิ่มรายการใหม่ · อัปเดตชื่อ/หน่วย · รายการที่ไม่อยู่ในไฟล์ = in_list false (ไม่ลบ)
//     ติ๊ก "เพิ่มยาใหม่เป็นยาในเว็บแอพด้วย" = นำเข้า + ดึงในขั้นตอนเดียว
//   เพิ่มรายการ = กล่องย่อด้านบน (#rlNewFold) · แก้ไข = กล่องขยายใต้รายการที่กด (#rlEditForm · showForm/keepForm เหมือนฐานข้อมูลอื่น · กดซ้ำ = ย่อ)
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, busy, errText } from '../util.js?v=4.4';
import { drugData, reloadDrugData, codeTag, showForm, closeForm, keepForm, parkForm, isOpenAt } from './admin-drugs.js?v=4.4';
import { readTable } from './delivery-report.js?v=4.4';

let bound = false, editId = null, pending = null, shown = 40;
const S = (v, n) => String(v ?? '').trim().slice(0, n);

/** รายการในบัญชีที่ยังไม่มียาในเว็บแอพ (รหัสยังไม่ถูกใช้) */
const notInApp = (D) => { const used = new Set(D.locals.map((l) => l.code).filter(Boolean)); return D.rpst.filter((it) => !used.has(it.code) && it.in_list !== false); };
const asLocal = (it) => ({ code: it.code, name: it.name, category: it.category || 'อื่น ๆ', pack_size: it.pack_size || '', unit: it.unit || '', sort: it.sort || 0, outside: false });

/** อ่านตาราง (แถวแรกที่มีหัว "รหัส"/"ชื่อ" = หัวตาราง · ไม่มีหัว = คอลัมน์ รหัส · ชื่อ · หน่วย) → รายการ */
export function parseList(rows) {
  const hi = rows.findIndex((r) => r.some((c) => /รหัส|code/i.test(String(c))) && r.some((c) => /ชื่อ|name|รายการ/i.test(String(c))));
  const head = hi >= 0 ? rows[hi].map((c) => String(c)) : [];
  const col = (re, d) => { const i = head.findIndex((c) => re.test(c)); return i >= 0 ? i : d; };
  const c = { code: col(/รหัส|code/i, 0), name: col(/ชื่อ|name|รายการ/i, 1), unit: col(/หน่วย|unit/i, hi >= 0 ? -1 : 2), cat: col(/หมวด|ประเภท|กลุ่ม|category/i, -1), pack: col(/ขนาดบรรจุ|บรรจุ|pack/i, -1) };
  const out = [], seen = new Set();
  rows.slice(hi + 1).forEach((r, k) => {
    const code = S(r[c.code], 30), name = S(r[c.name], 200);
    if (!code || !name || seen.has(code)) return;
    seen.add(code);
    out.push({ code, name, unit: c.unit >= 0 ? S(r[c.unit], 40) : '', category: c.cat >= 0 ? S(r[c.cat], 100) || 'อื่น ๆ' : null, pack_size: c.pack >= 0 ? S(r[c.pack], 40) : null, sort: k + 1 });
  });
  return out;
}

async function pull(btn) {
  const D = await drugData(), list = notInApp(D);
  if (!list.length) { toast('ทุกรายการในบัญชีมีในเว็บแอพแล้ว'); return; }
  if (!confirm(`เพิ่มยา ${list.length} รายการจากบัญชียา รพ.สต. เป็นยาในเว็บแอพ?\nแต่ละยายังต้องผูกแหล่งข้อมูลและขนาดยาในศูนย์ข้อมูลยา`)) return;
  busy(btn, true, 'กำลังเพิ่ม…');
  const { error } = await sb.from('local_drugs').insert(list.map(asLocal));
  busy(btn, false);
  if (error) { toast(errText(error), 'err'); return; }
  toast(`เพิ่มยาในเว็บแอพ ${list.length} รายการแล้ว`);
  await reloadDrugData();
}

async function render() {
  if (!$('#rlList')) return;
  const D = await drugData(), q = ($('#rlQ').value || '').trim().toLowerCase(), byCode = new Map(D.locals.filter((l) => l.code).map((l) => [l.code, l]));
  const miss = notInApp(D);
  $('#rlCount').textContent = `(${D.rpst.length})`;
  const n = document.querySelector('[data-adr-n="rpst"]'); if (n) n.textContent = D.rpst.length ? `· ${D.rpst.length} รายการ` : '';
  $('#rlPull').hidden = !miss.length;
  $('#rlPull').textContent = `เพิ่มยาในบัญชีที่ยังไม่มีในเว็บแอพ (${miss.length})`;
  $('#rlPullNote').textContent = miss.length ? '' : 'ทุกรายการในบัญชีมีในเว็บแอพแล้ว';
  const rows = D.rpst.filter((it) => !q || `${it.code} ${it.name}`.toLowerCase().includes(q));
  parkForm($('#rlEditForm'));   // กล่องแก้ไขต้องย้ายออกก่อนล้างรายการ
  $('#rlList').innerHTML = rows.length ? rows.slice(0, shown).map((it) => { const l = byCode.get(it.code);
    return `<div class="li" data-rl-row="${it.id}"><div class="l"><b>${esc(it.code)} · ${esc(it.name)}</b><span class="small muted">${esc([it.category, it.pack_size && `บรรจุ ${it.pack_size}`, it.unit].filter(Boolean).join(' · '))}</span>`
      + `<span class="small">${l ? `ยาในเว็บแอพ: ${codeTag(l)}${esc(l.name)}` : '<span class="chip c-fix">ยังไม่มีในเว็บแอพ</span>'}${it.in_list === false ? ' <span class="chip c-off">ไม่อยู่ในไฟล์บัญชีล่าสุด</span>' : ''}</span></div>`
      + `<div class="actions"><button type="button" class="btn btn-o btn-sm" data-rl-edit="${it.id}">แก้ไข</button><button type="button" class="btn btn-no btn-sm" data-rl-del="${it.id}">ลบ</button></div></div>`; }).join('')
    + (rows.length > shown ? `<button type="button" class="btn btn-o btn-sm di-more" data-rl-more>แสดงเพิ่ม (${rows.length - shown})</button>` : '')
    : `<p class="empty">${D.rpst.length ? 'ไม่พบตามคำค้น' : 'ยังไม่มีรายการในบัญชี · เพิ่มหรือนำเข้าไฟล์ด้านบน'}</p>`;
  keepForm($('#rlEditForm'), $('#rlList'), editId != null ? `[data-rl-row="${editId}"]` : null);
}
const rowOf = (D, id) => D.rpst.find((x) => String(x.id) === String(id));
const vals = (p) => ({ code: S($(`#${p}Code`).value, 30), name: S($(`#${p}Name`).value, 200), category: S($(`#${p}Cat`).value, 100) || 'อื่น ๆ', pack_size: S($(`#${p}Pack`).value, 40), unit: S($(`#${p}Unit`).value, 40) });
const dupMsg = (error) => (/duplicate|23505/.test(errText(error) + error.code) ? 'รหัสยานี้มีในบัญชีแล้ว' : errText(error));
/** เพิ่มรายการใหม่ (กล่องด้านบน) */
async function addItem(e) {
  e.preventDefault();
  const row = vals('rl');
  if (!row.code || !row.name) { toast('กรอกรหัสยาและชื่อยา', 'err'); return; }
  const btn = $('#rlSave'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = await sb.from('rpst_list').insert({ ...row, in_list: true });
  busy(btn, false);
  if (error) { toast(dupMsg(error), 'err'); return; }
  toast('เพิ่มในบัญชีแล้ว'); $('#rlForm').reset(); await reloadDrugData();
}
/** แก้ไข: กล่องขยายใต้รายการที่กด */
function openEdit(it) {
  const f = $('#rlEditForm'), sel = `[data-rl-row="${it.id}"]`;
  if (isOpenAt(f, $('#rlList'), sel)) { closeEdit(); return; }   // กดซ้ำ = ย่อ
  editId = it.id;
  $('#rlEditTitle').textContent = `แก้ไข ${it.code}`;
  $('#rlECode').value = it.code || ''; $('#rlEName').value = it.name || ''; $('#rlECat').value = it.category || ''; $('#rlEPack').value = it.pack_size || ''; $('#rlEUnit').value = it.unit || '';
  showForm(f, $('#rlList'), sel, $('#rlEName'));
}
function closeEdit() { editId = null; closeForm($('#rlEditForm')); }
async function saveEdit(e) {
  e.preventDefault();
  const row = vals('rlE');
  if (!row.code || !row.name) { toast('กรอกรหัสยาและชื่อยา', 'err'); return; }
  const btn = $('#rlESave'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = await sb.from('rpst_list').update(row).eq('id', editId);
  busy(btn, false);
  if (error) { toast(dupMsg(error), 'err'); return; }
  toast('บันทึกแล้ว'); closeEdit(); await reloadDrugData();
}
async function onList(e) {
  const b = e.target.closest('button'); if (!b) return;
  const D = await drugData();
  if (b.dataset.rlMore != null) { shown += 40; render(); return; }
  if (b.dataset.rlEdit) { const it = rowOf(D, b.dataset.rlEdit); if (it) openEdit(it); return; }
  if (b.dataset.rlDel) {
    const it = D.rpst.find((x) => String(x.id) === b.dataset.rlDel), used = it && D.locals.find((l) => l.code === it.code);
    if (!it || !confirm(`ลบ ${it.code} · ${it.name} ออกจากบัญชียา รพ.สต.?${used ? `\nยาในเว็บแอพ "${used.name}" จะขึ้นว่ารหัสไม่อยู่ในบัญชี (ยาไม่ถูกลบ)` : ''}`)) return;
    busy(b, true, 'กำลังลบ…');
    const { error } = await sb.from('rpst_list').delete().eq('id', it.id);
    busy(b, false);
    if (error) { toast(errText(error), 'err'); return; }
    toast('ลบแล้ว'); await reloadDrugData();
  }
}
async function onFile() {
  const f = $('#rlFile').files[0];
  pending = null; $('#rlImport').disabled = true;
  if (!f) { $('#rlPreview').innerHTML = ''; return; }
  try {
    const list = parseList(await readTable(f));
    if (!list.length) throw new Error('ไม่พบรายการยา (ต้องมีคอลัมน์รหัสยาและชื่อยา)');
    const D = await drugData(), have = new Map(D.rpst.map((x) => [x.code, x])), codes = new Set(list.map((x) => x.code));
    const add = list.filter((x) => !have.has(x.code)), chg = list.filter((x) => { const o = have.get(x.code); return o && (o.name !== x.name || (x.unit && o.unit !== x.unit) || o.in_list === false); });
    const gone = D.rpst.filter((x) => !codes.has(x.code) && x.in_list !== false);
    pending = { list, add, chg, gone };
    $('#rlPreview').innerHTML = `<div class="mm-pre" data-rl-preview><p><b>พบ ${list.length} รายการในไฟล์</b> · ใหม่ ${add.length} · เปลี่ยนชื่อ/หน่วย ${chg.length} · ไม่อยู่ในไฟล์ ${gone.length}</p>`
      + (add.length ? `<p class="small">ใหม่: ${esc(add.slice(0, 8).map((x) => `${x.code} ${x.name}`).join(', '))}${add.length > 8 ? ' …' : ''}</p>` : '')
      + (gone.length ? `<p class="small muted">ไม่อยู่ในไฟล์ (เก็บไว้ ทำเครื่องหมาย ไม่ลบ): ${esc(gone.slice(0, 8).map((x) => `${x.code} ${x.name}`).join(', '))}${gone.length > 8 ? ' …' : ''}</p>` : '') + '</div>';
    $('#rlImport').disabled = !(add.length || chg.length || gone.length);
  } catch (err) { $('#rlPreview').innerHTML = `<p class="small dc-err">อ่านไฟล์ไม่ได้: ${esc(err.message || String(err))}</p>`; }
}
async function runImport(btn) {
  if (!pending) return;
  busy(btn, true, 'กำลังนำเข้า…');
  try {
    const { add, chg, gone } = pending, D = await drugData(), have = new Map(D.rpst.map((x) => [x.code, x]));
    if (add.length) { const { error } = await sb.from('rpst_list').insert(add.map((x) => ({ ...x, category: x.category || 'อื่น ๆ', pack_size: x.pack_size || '', in_list: true }))); if (error) throw error; }
    for (const x of chg) {
      const up = { name: x.name, in_list: true, ...(x.unit ? { unit: x.unit } : {}), ...(x.category ? { category: x.category } : {}), ...(x.pack_size ? { pack_size: x.pack_size } : {}) };
      const { error } = await sb.from('rpst_list').update(up).eq('id', have.get(x.code).id); if (error) throw error;
    }
    if (gone.length) { const { error } = await sb.from('rpst_list').update({ in_list: false }).in('id', gone.map((x) => x.id)); if (error) throw error; }
    await reloadDrugData();
    let pulled = 0;
    if ($('#rlAlsoApp').checked) {
      const D2 = await drugData(), list = notInApp(D2);
      if (list.length) { const { error } = await sb.from('local_drugs').insert(list.map(asLocal)); if (error) throw error; pulled = list.length; await reloadDrugData(); }
    }
    toast(`นำเข้าแล้ว · ใหม่ ${add.length} · อัปเดต ${chg.length}${gone.length ? ` · ไม่อยู่ในไฟล์ ${gone.length}` : ''}${pulled ? ` · เพิ่มเป็นยาในเว็บแอพ ${pulled}` : ''}`);
    pending = null; $('#rlFile').value = ''; $('#rlPreview').innerHTML = ''; btn.disabled = true;
  } catch (err) { toast(errText(err), 'err'); } finally { busy(btn, false); }
}
export function initRpstAdmin() {
  if (!$('#rlList')) return;
  if (!bound) {
    bound = true;
    $('#rlPull').addEventListener('click', (e) => pull(e.currentTarget));
    $('#rlForm').addEventListener('submit', addItem);
    $('#rlEditForm').addEventListener('submit', saveEdit);
    $('#rlECancel').addEventListener('click', closeEdit);
    $('#rlQ').addEventListener('input', () => { shown = 40; render(); });
    $('#rlList').addEventListener('click', onList);
    $('#rlFile').addEventListener('change', onFile);
    $('#rlImport').addEventListener('click', (e) => runImport(e.currentTarget));
    window.addEventListener('pcps:rpstdata', render);
    window.addEventListener('pcps:drugdata', render);
  }
  $('#rlList').innerHTML = '<div class="skeleton"></div>';
  render();
}
