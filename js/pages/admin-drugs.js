// ผู้ดูแล › ข้อมูลยา (#/admin/drugs[/ai|dose|local|nlem|fda|ddi]) · ส่วนต่าง ๆ เรียงแนวตั้ง ย่อ/ขยายได้ (<details data-adr-sec>)
//   เลือกยา รพ.สต. ด้านบน (#adrQ) → ทุกฐานข้อมูลแสดงเฉพาะยานั้น (pick) · ส่วนคำนวณขนาดยา/ร่าง AI (admin-settings.js) รับผ่านเหตุการณ์ 'pcps:drugpick' {doseIds}
//   รายการยา รพ.สต. อ.ควนกาหลง (local_drugs · 58_local_drugs.sql): เพิ่ม/แก้/ซ่อน/ลบ + ผูกกับข้อมูลยาในบัญชียาหลัก (mono_refs → drug_monographs.ref)
//   ฉลากยาสหรัฐฯ openFDA (drug_fda_labels · 59_fda_labels.sql): ดึงจาก api.fda.gov ในเบราว์เซอร์ (ฟรี · ไม่ใช้คีย์) แล้วบันทึก · แก้/ลบ · ผูกกับยา รพ.สต. ด้วย local_drugs.fda_key
//     ภาษาไทย: AI แปลทีละฉลาก/ทั้งหมด (ai_fda_th_start/poll · 60_drug_calc_th.sql) · ผู้ดูแลแก้ข้อความไทยแล้ว = th_reviewed
//   Drug interaction (ddi_pairs · 61_ddi.sql · DDInter): ค้นหา/กรองระดับ · AI แปลไทยทีละคู่/ทั้งหมด (ai_ddi_th_start/poll) · แก้/ลบ · ยา รพ.สต. ผูกด้วย local_drugs.ddi_ids
//     ปุ่ม "แก้ไขข้อมูลนี้" ในหน้าข้อมูลยา → sessionStorage 'pcps_drug_edit' (local:/mono:/fda:/ddi:<id>) → เปิดฟอร์มนั้น
//     หัวข้อ/การตัดความยาว (FDA_SECTIONS) ต้องตรงกับ tools/nlem/fda_labels.py
//   ยานอก รพ.สต. (local_drugs.outside · 81_outside_drugs.sql): ตารางเดียวกับยา รพ.สต. แสดงในส่วน "ฐานข้อมูลบัญชียานอก รพ.สต." (#loList) · ใช้ฟอร์ม #ldForm ร่วมกัน
//   กล่อง "ผูกฐานข้อมูล" ในฟอร์มคำนวณขนาดยา (admin-settings.js → dlFill/dlSave): ยาที่ใช้ข้อมูลคำนวณนี้ (dose_id) + บัญชียาหลัก + ฉลาก openFDA + DDInter → ผูกให้ทุกตัว
//   เพิ่มหลายรายการ + AI (admin-settings.js bulkAi → linkDrug): ชื่อยาที่พิมพ์ → ยา รพ.สต. ที่ตรงกัน หรือสร้างยานอก รพ.สต. (ซ่อน) → เติมช่องที่ยังว่าง
//   บัญชียาหลักแห่งชาติ (drug_monographs · 57_drug_monographs.sql): ค้นหา เพิ่ม แก้ ลบ · หัวข้อในยาแก้เป็นข้อความ "## หัวข้อ" + บรรทัดเนื้อหา
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, busy, errText } from '../util.js?v=4.4';
import { resetDrugInfo, strengthOf, comboName, keysOf, latinOf, sameDrug } from './dose.js?v=4.4';

let doseOpts = '<option value="">ข้อมูลคำนวณ: อัตโนมัติ (จับคู่ตามชื่อยา)</option>';
let locals = [], monos = [], fdas = [], doses = [], ddDrugs = [], ddPairs = [], ddShown = 30, editDd = null, ddStop = false, thStop = false, bound = false, editLocal = null, editMono = null, editFda = null, links = [], dmShown = 30, pick = null, ready = null, newOutside = false;

export async function initDrugsAdmin() {
  if (!bound) bind();
  ['#ldForm', '#dmForm', '#faForm', '#ddForm'].forEach((f) => parkForm($(f)));   // ฟอร์มที่ขยายใต้รายการต้องย้ายออกก่อนล้างรายการ
  $('#ldList').innerHTML = $('#dmList').innerHTML = $('#faList').innerHTML = '<div class="skeleton"></div><div class="skeleton" style="width:70%;margin-top:10px"></div>';
  ready = Promise.all([loadLocals(), loadMonos(), loadFdas(), loadDoses(), loadDdi()]);
  await ready;
  if (!editLocal) resetLocal();
  openPending();
}
/* ---- เลือกยาด้านบน → ทุกส่วนแสดงเฉพาะยานั้น · ส่วนต่าง ๆ ย่อ/ขยายได้ ---- */
const secs = () => document.querySelectorAll('[data-admin-view="drugs"] .adr-sec');
let secTouched = false;
/** เปิดส่วนตามลิงก์ (#/admin/drugs/<ส่วน>) แล้วเลื่อนไปที่นั่น · ครั้งแรกปิดส่วนอื่นไว้ */
export function openDrugSection(v) {
  if (!secTouched) { secTouched = true; secs().forEach((d) => { d.open = d.dataset.adrSec === v; }); }
  const el = v && document.querySelector(`[data-adr-sec="${v}"]`);
  if (!el) return;
  el.open = true;
  requestAnimationFrame(() => el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
}
/** ข้อมูลยาทุกฐาน (ศูนย์ข้อมูลยา · drug-center.js) · รอโหลดเสร็จก่อน */
export async function drugData() {
  if (!ready) await initDrugsAdmin(); else await ready;
  return { locals, monos, fdas, doses, ddDrugs };
}
/** โหลดยา รพ.สต. ใหม่หลังศูนย์ข้อมูลยาบันทึก (รายการในส่วนฐานข้อมูลอัปเดตตาม) */
export async function reloadDrugData(fda = false) { changed(); await Promise.all([loadLocals(), fda ? loadFdas() : null]); }
/** id ข้อมูลคำนวณขนาดยาของยา รพ.สต. (ผูกไว้ หรือจับคู่ตามชื่อเหมือนหน้าคำนวณ) */
export function doseIdsOf(l) {
  const ids = [l.dose_id, ...(l.ingredients || []).map((x) => x.dose_id)].filter(Boolean);
  if (ids.length) return [...new Set(ids)];
  const keys = keysOf(l.name);
  return doses.filter((d) => keys.some((k) => sameDrug(k, latinOf(d.name)))).map((d) => d.id);
}
function setPick(l) {
  pick = l || null;
  $('#adrClear').hidden = !pick;
  $('#adrInfo').textContent = pick ? `แสดงเฉพาะ: ${pick.name} · ทุกส่วนด้านล่าง` : 'ยังไม่ได้เลือกยา · แสดงทุกรายการ';
  if (!pick) $('#adrQ').value = '';
  if (pick) secs().forEach((d) => { d.open = true; });
  dmShown = 30; ddShown = 30;
  renderLocals(); renderMonos(); renderFdas(); renderDd();
  window.dispatchEvent(new CustomEvent('pcps:drugpick', { detail: pick ? { name: pick.name, doseIds: doseIdsOf(pick) } : null }));
}
function onPickInput() {
  const v = $('#adrQ').value.trim().toLowerCase();
  if (!v) { if (pick) setPick(null); return; }
  const l = locals.find((x) => x.name.toLowerCase() === v) || (() => { const m = locals.filter((x) => x.name.toLowerCase().includes(v)); return m.length === 1 ? m[0] : null; })();
  if (l && l !== pick) { $('#adrQ').value = l.name; setPick(l); }
}
const secN = (k, n) => { const el = document.querySelector(`[data-adr-n="${k}"]`); if (el) el.textContent = pick ? `· ${n ? `พบ ${n} รายการ` : 'ไม่มีข้อมูลของยานี้'}` : ''; };

/* ---- กล่องแก้ไขขยายใต้รายการที่กด (ไม่เด้งขึ้นไปด้านบน) · วาดรายการใหม่ = เก็บกล่องกลับที่เดิมก่อน แล้ววางใต้รายการเดิมอีกครั้ง ---- */
//   กดแก้ไขแถวเดิมซ้ำ = ย่อกล่อง (isOpenAt) · เปิด/ย่อมีเอฟเฟคเลื่อน (CSS .inline-edit / .closing) · ใช้ใน admin-settings.js (รายการยาคำนวณขนาดยา) ด้วย
const homes = new Map();
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function placeForm(form, row, top0) {
  if (!homes.has(form)) { const ph = document.createComment('ที่เดิมของฟอร์ม'); form.before(ph); homes.set(form, ph); }
  const moved = form.previousElementSibling !== row, top = top0 ?? row.getBoundingClientRect().top;
  row.after(form); form.classList.add('inline-edit'); form.classList.remove('closing');
  // ฟอร์มย้ายออกจากด้านบนของหน้า → เนื้อหาเลื่อนขึ้น · เลื่อนจอตามให้แถวที่กดอยู่ที่เดิม (ไม่ต้องเลื่อนหาเอง)
  const shift = row.getBoundingClientRect().top - top;
  if (Math.abs(shift) > 1) window.scrollBy({ top: shift, behavior: 'instant' });
  if (moved && !calm()) { form.classList.remove('opening'); void form.offsetWidth; form.classList.add('opening'); }
}
export function parkForm(form) { const ph = homes.get(form); if (ph && form.previousSibling !== ph) ph.after(form); form.classList.remove('inline-edit', 'opening', 'closing'); }
/** กล่องแก้ไขเปิดอยู่ใต้แถวนี้แล้วหรือยัง (กดซ้ำ = ย่อ) */
export function isOpenAt(form, list, sel) { const row = list.querySelector(sel)?.closest('.li'); return !!row && !form.hidden && form.classList.contains('inline-edit') && form.previousElementSibling === row; }
/** เปิดฟอร์มใต้แถวของรายการ (มีแถวในหน้า) หรือที่เดิมด้านบน + เลื่อนไป (ไม่มีแถว เช่น มาจากหน้าข้อมูลยา) */
export function showForm(form, list, sel, focus) {
  const row = list.querySelector(sel)?.closest('.li'), y = row?.getBoundingClientRect().top;   // ตำแหน่งแถวก่อนฟอร์มขึ้น
  form.hidden = false;
  if (row) placeForm(form, row, y); else { parkForm(form); const d = form.closest('details'); if (d) d.open = true; form.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  focus?.focus({ preventScroll: !!row });
}
/** ย่อกล่อง (เลื่อนขึ้นแล้วซ่อน) · keep = ฟอร์มหลักที่ไม่ซ่อน (เพิ่ม/แก้ไข) → กลับไปที่เดิมด้านบน */
export function closeForm(form, keep = false, after = null) {
  const done = () => { if (!keep) form.hidden = true; parkForm(form); after?.(); };
  if (form.classList.contains('inline-edit') && !calm()) { form.classList.remove('opening'); form.classList.add('closing'); setTimeout(done, 220); } else done();
}
/** หลังวาดรายการใหม่: กล่องที่เปิดอยู่กลับไปอยู่ใต้แถวเดิม */
export function keepForm(form, list, sel) { if (form.hidden || !sel) return; const row = list.querySelector(sel)?.closest('.li'); if (row) placeForm(form, row); }

/** มาจากปุ่ม "แก้ไขข้อมูลนี้" ในหน้าข้อมูลยา → เปิดฟอร์มของรายการนั้น */
function openPending() {
  let key = null;
  try { key = sessionStorage.getItem('pcps_drug_edit'); sessionStorage.removeItem('pcps_drug_edit'); } catch { /* ไม่เป็นไร */ }
  const [kind, id] = String(key || '').split(':');
  if (kind === 'local') { const l = locals.find((x) => x.id === +id); if (l) editLocalForm(l); }
  if (kind === 'mono') { const m = monos.find((x) => x.id === +id); if (m) openMonoForm(m); }
  if (kind === 'fda') { const f = fdas.find((x) => x.id === +id); if (f) openFdaForm(f); }
  if (kind === 'ddi') { const d = ddPairs.find((x) => x.id === +id); if (d) openDdForm(d); }
}
async function loadDoses() {
  const { data } = await sb.from('dose_drugs').select('id,name,active,ai_draft,web_code,draft_issue,approved_at,indications').order('sort');
  doses = data || [];
  doseOpts = '<option value="">ข้อมูลคำนวณ: อัตโนมัติ (จับคู่ตามชื่อยา)</option>' + doses.map((d) => `<option value="${d.id}">${esc(codeTxt(d))}${esc(d.name)}${d.ai_draft ? ' (ร่าง · รอตรวจ)' : d.active ? '' : ' (ซ่อน)'}</option>`).join('');
  document.querySelectorAll('#ldIngs .r-dose').forEach((x) => { const v = x.value; x.innerHTML = doseOpts; x.value = v; });
}

async function loadLocals() {
  const { data, error } = await sb.from('local_drugs').select('*').order('sort').order('id');
  if (error) { toast(errText(error), 'err'); $('#ldList').innerHTML = '<p class="empty">โหลดรายการยาไม่สำเร็จ</p>'; return; }
  locals = data;
  $('#ldCats').innerHTML = [...new Set(locals.map((l) => l.category))].map((c) => `<option value="${esc(c)}">`).join('');
  $('#adrNames').innerHTML = locals.map((l) => `<option value="${esc(l.name)}"></option>`).join('');
  if (pick) pick = locals.find((l) => l.id === pick.id) || null;   // ข้อมูลล่าสุดหลังบันทึก
  renderLocals();
  window.dispatchEvent(new CustomEvent('pcps:drugdata'));   // ศูนย์ข้อมูลยา (drug-center.js) วาดใหม่
}
async function loadMonos() {
  const all = [];
  for (let from = 0; ; from += 1000) {   // ครั้งละ ≤ 1000 แถว
    const { data, error } = await sb.from('drug_monographs').select('*').order('sort').order('id').range(from, from + 999);
    if (error) { toast(errText(error), 'err'); $('#dmList').innerHTML = '<p class="empty">โหลดข้อมูลยาไม่สำเร็จ</p>'; return; }
    all.push(...data);
    if (data.length < 1000) break;
  }
  monos = all;
  $('#dmGroups').innerHTML = [...new Set(monos.map((m) => m.group_name))].map((g) => `<option value="${esc(g)}">`).join('');
  renderMonos(); renderLocals(); renderLinks();
}
const byRef = (r) => monos.find((m) => m.ref === r);
/** รหัสยาในเว็บ (82_drug_codes.sql · เช่น SHPS-A-01) เป็นป้ายหน้าชื่อยา */
export const codeTag = (x) => (x?.web_code ? `<span class="chip c-code">${esc(x.web_code)}</span> ` : '');
const codeTxt = (x) => (x?.web_code ? `${x.web_code} · ` : '');
const monoByName = (n) => monos.find((m) => m.name === n);
/** ชื่อยา DDInter ที่พิมพ์ในช่อง → ป้ายรหัส + ชื่อ (ไม่พบ = ป้ายเตือน) */
function ddiChips(input, out) {
  const names = $(input).value.split(',').map((x) => x.trim()).filter(Boolean);
  $(out).innerHTML = names.map((n) => { const d = ddDrugs.find((x) => x.name.toLowerCase() === n.toLowerCase() || x.id === n);
    return d ? `<span class="chip c-role">${codeTag(d)}${esc(d.name)}</span>` : `<span class="chip c-fix">ไม่พบใน DDInter: ${esc(n)}</span>`; }).join('');
}
const changed = () => resetDrugInfo();   // หน้าข้อมูลยาโหลดใหม่ครั้งถัดไป

function bind() {
  bound = true;
  $('#adrQ').addEventListener('input', onPickInput);
  $('#adrQ').addEventListener('change', onPickInput);
  $('#adrClear').addEventListener('click', () => { setPick(null); $('#adrQ').focus(); });
  $('#adrOpenAll').addEventListener('click', () => secs().forEach((d) => { d.open = true; }));
  $('#adrCloseAll').addEventListener('click', () => secs().forEach((d) => { d.open = false; }));
  $('#ldForm').addEventListener('submit', saveLocal);
  $('#ldCancel').addEventListener('click', resetLocal);
  ['#ldQ', '#ldFilter'].forEach((s) => $(s).addEventListener(s === '#ldQ' ? 'input' : 'change', renderLocals));
  $('#ldList').addEventListener('click', onLocalList);
  $('#loList').addEventListener('click', onLocalList);
  ['#loQ', '#loFilter'].forEach((s) => $(s).addEventListener(s === '#loQ' ? 'input' : 'change', renderLocals));
  $('#loNew').addEventListener('click', newOutsideForm);
  bindLinkBox();
  $('#ldLinkQ').addEventListener('input', renderPick);
  $('#ldLinkOut').addEventListener('click', (e) => {
    const b = e.target.closest('[data-link]'); if (!b) return;
    const name = b.dataset.link;
    links = [...new Set([...links, ...monos.filter((m) => m.name === name).map((m) => m.ref)])];
    $('#ldLinkQ').value = ''; renderPick(); renderLinks();
  });
  $('#ldLinks').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unlink]'); if (!b) return;
    links = links.filter((r) => byRef(r)?.name !== b.dataset.unlink && r !== b.dataset.unlink); renderLinks();
  });
  $('#faFetch').addEventListener('click', () => fetchAndSave($('#faGeneric').value, $('#faRoute').value, $('#faBrand').value, $('#faFetch')));
  $('#dmdGo').addEventListener('click', searchDailyMed);
  $('#dmdQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchDailyMed(); } });
  $('#dmdOut').addEventListener('click', (e) => { const b = e.target.closest('[data-dmd-imp]'); if (b) importBySetId(b.dataset.dmdImp, b); });
  $('#faQ').addEventListener('input', renderFdas);
  $('#faList').addEventListener('click', onFdaList);
  $('#faForm').addEventListener('submit', saveFda);
  $('#faThAll').addEventListener('click', thAll);
  $('#ddThAll').addEventListener('click', ddThAll);
  $('#ddThStop').addEventListener('click', () => { ddStop = true; });
  $('#ddQ').addEventListener('input', () => { ddShown = 30; renderDd(); });
  $('#ddLevel').addEventListener('change', () => { ddShown = 30; renderDd(); });
  $('#ddMore').addEventListener('click', () => { ddShown += 50; renderDd(); });
  $('#ddList').addEventListener('click', onDdList);
  $('#ddForm').addEventListener('submit', saveDd);
  $('#ddCancel').addEventListener('click', () => { closeForm($('#ddForm')); editDd = null; });
  $('#faThStop').addEventListener('click', () => { thStop = true; });
  ['#ldName', '#ldUnit'].forEach((x) => $(x).addEventListener('input', strHint));
  $('#ldIngs').addEventListener('input', strHint);
  $('#ldIngAdd').addEventListener('click', () => { $('#ldIngs').insertAdjacentHTML('beforeend', ingRow()); ingRows(); $('#ldIngs').lastElementChild.querySelector('.r-n').focus(); });
  $('#ldIngs').addEventListener('click', (e) => { const b = e.target.closest('[data-ing-rm]'); if (!b) return; b.closest('.ld-ing-row').remove(); if (!$('#ldIngs').children.length) $('#ldIngs').innerHTML = ingRow(); ingRows(); });
  $('#faCancel').addEventListener('click', () => { closeForm($('#faForm')); editFda = null; });
  $('#dmNew').addEventListener('click', () => openMonoForm(null));
  $('#dmCancel').addEventListener('click', () => { closeForm($('#dmForm')); editMono = null; });
  $('#dmForm').addEventListener('submit', saveMono);
  $('#dmQ').addEventListener('input', () => { dmShown = 30; renderMonos(); });
  $('#dmMore').addEventListener('click', () => { dmShown += 50; renderMonos(); });
  $('#dmList').addEventListener('click', onMonoList);
}

/* ======================= รายการยา รพ.สต. ======================= */
function linkNames(refs) { return [...new Set((refs || []).map((r) => byRef(r)?.name || r))]; }
/** วาดทั้งรายการยา รพ.สต. (#ldList) และยานอก รพ.สต. (#loList) · ฟอร์ม #ldForm กลับไปอยู่ใต้แถวที่แก้ไขอยู่ */
function renderLocals() {
  parkForm($('#ldForm'));
  const own = locals.filter((l) => !l.outside), out = locals.filter((l) => l.outside);
  const q = $('#ldQ').value.trim().toLowerCase(), f = $('#ldFilter').value;
  const list = pick ? own.filter((l) => l.id === pick.id) : own.filter((l) => (!q || [l.name, l.code, l.category, ...linkNames(l.mono_refs)].join(' ').toLowerCase().includes(q))
    && (f === 'all' || (f === 'unlinked' ? !(l.mono_refs || []).length : !l.active)));
  $('#ldCount').textContent = `(${own.length})`; secN('local', list.length);
  $('#ldList').innerHTML = !own.length ? '<p class="empty">ยังไม่มีรายการยา</p>' : !list.length ? '<p class="empty">ไม่พบยาที่ค้นหา</p>' : list.map(localRow).join('');
  const oq = $('#loQ').value.trim().toLowerCase(), of = $('#loFilter').value;
  const olist = pick ? out.filter((l) => l.id === pick.id) : out.filter((l) => (!oq || [l.name, l.code, l.category, ...linkNames(l.mono_refs)].join(' ').toLowerCase().includes(oq)) && (of === 'all' || !l.active));
  $('#loCount').textContent = `(${out.length})`; secN('outside', olist.length);
  $('#loList').innerHTML = !out.length ? '<p class="empty">ยังไม่มียานอก รพ.สต. · พิมพ์ชื่อยาใน "เพิ่มหลายรายการ" แล้วให้ AI ดึงข้อมูล หรือกด "+ เพิ่มยานอก รพ.สต."</p>'
    : !olist.length ? '<p class="empty">ไม่พบยาที่ค้นหา</p>' : olist.map(localRow).join('');
  const form = $('#ldForm');
  if (newOutside && !form.hidden) placeForm(form, $('#loBar'));
  else keepForm(form, editLocal?.outside ? $('#loList') : $('#ldList'), editLocal && `[data-ld-edit="${editLocal.id}"]`);
}
function localRow(l) {
  return `<div class="li"><div class="l"><b>${codeTag(l)}${esc(l.name)}</b>`
      + `<span class="small muted">${[l.code && `รหัส ${esc(l.code)}`, esc(l.category), (l.pack_size || l.unit) && `บรรจุ ${esc([l.pack_size, l.unit].filter(Boolean).join(' '))}`].filter(Boolean).join(' · ')}</span>`
      + `<span class="small">${(l.mono_refs || []).length ? `ข้อมูลยา: ${esc(linkNames(l.mono_refs).join(', '))}` : '<span class="chip c-fix">ยังไม่ผูกข้อมูลยา</span>'}</span>`
      + (() => { const st = strengthOf(l); return st ? `<span class="small muted">ความแรง ${st.mg} ${{ tab: 'มก./เม็ด', '5ml': 'มก./5 มล.', ml: 'มก./มล.' }[st.per]}${l.strength ? '' : ' (อ่านจากชื่อ)'}</span>` : comboName(l.name) ? '<span class="small fx-warn">ยาสูตรผสม · กรอกสารสำคัญแต่ละตัวก่อนใช้คำนวณ</span>' : ''; })()
      + (l.fda_key ? `<span class="small muted">ฉลาก openFDA: ${esc(fdas.find((f) => f.key === l.fda_key)?.title || l.fda_key)}</span>` : '')
      + (l.note && l.outside ? `<span class="small muted">${esc(l.note)}</span>` : '')
      + `${l.active ? '' : `<div class="meta"><span class="chip c-off">${l.outside ? 'ซ่อน · รอตรวจ' : 'ซ่อน'}</span></div>`}</div>`
      + `<div class="actions"><button type="button" class="btn btn-o btn-sm" data-ld-edit="${l.id}">แก้ไข</button>`
      + `<button type="button" class="btn btn-no btn-sm" data-ld-del="${l.id}">ลบ</button></div></div>`;
}
/** "+ เพิ่มยานอก รพ.สต." → ฟอร์มว่างขยายใต้ปุ่ม (ติ๊กยานอก รพ.สต. ไว้) · กดซ้ำ = ย่อ */
function newOutsideForm() {
  const form = $('#ldForm');
  if (newOutside && !form.hidden && form.previousElementSibling === $('#loBar')) { closeForm(form, true, resetLocal); return; }
  snapNew(); const keep = newDraft; newDraft = null; resetLocal(); newDraft = keep; newOutside = true; $('#ldNewNote').hidden = false;
  $('#ldOutside').checked = true; $('#ldActive').checked = false;
  $('#ldCat').value = 'ยานอก รพ.สต.'; $('#ldCancel').hidden = false;
  placeForm(form, $('#loBar')); $('#ldName').focus({ preventScroll: true });
}
/* ---- สารสำคัญ · ความแรง · ข้อมูลคำนวณขนาดยา: แถวละ 1 สาร (ยาเดี่ยว 1 แถว → strength + dose_id · ยาสูตรผสม ≥ 2 แถว → ingredients[] พร้อม dose_id รายสาร) ---- */
const UNITS = [['mg|tab', 'มก./เม็ด'], ['mg|5ml', 'มก./5 มล.'], ['mg|ml', 'มก./มล.'], ['mcg|tab', 'mcg/เม็ด'], ['mcg|ml', 'mcg/มล.']];
function ingRow(x = {}) {
  const u = `${x.u || 'mg'}|${x.per || 'tab'}`;
  return `<div class="ld-ing-row"><input class="input r-n" maxlength="60" placeholder="ชื่อสารสำคัญ เช่น Trimethoprim" aria-label="ชื่อสารสำคัญ" value="${esc(x.name || '')}">`
    + `<input class="input r-mg" type="number" inputmode="decimal" min="0" step="0.001" placeholder="ความแรง" aria-label="ความแรง" value="${esc(x.amt ?? '')}">`
    + `<select class="input r-u" aria-label="หน่วยความแรง">${UNITS.map(([v, l]) => `<option value="${v}"${v === u ? ' selected' : ''}>${l}</option>`).join('')}</select>`
    + `<select class="input r-dose" aria-label="ข้อมูลคำนวณขนาดยาของสารนี้">${doseOpts}</select>`
    + '<button type="button" class="btn btn-no btn-sm" data-ing-rm aria-label="ลบแถวนี้">×</button></div>';
}
/** ปรับป้ายตามจำนวนแถว (ยาเดี่ยว: ไม่ต้องใส่ชื่อ) */
function ingRows() {
  const rows = [...document.querySelectorAll('#ldIngs .ld-ing-row')];
  rows.forEach((r) => { r.querySelector('.r-n').placeholder = rows.length > 1 ? 'ชื่อสารสำคัญ เช่น Trimethoprim' : 'ชื่อสารสำคัญ (ยาเดี่ยวเว้นว่างได้)'; });
  strHint();
}
function fillIngs(l) {
  const ings = l?.ingredients || [];
  const rows = ings.length ? ings.map((x) => ({ name: x.name, amt: x.amt ?? x.mg, u: x.u || 'mg', per: x.per || 'tab', dose: x.dose_id }))
    : [{ name: '', amt: l?.strength ? (l.strength.u === 'mcg' ? l.strength.amt : l.strength.mg) : '', u: l?.strength?.u || 'mg', per: l?.strength?.per || 'tab', dose: l?.dose_id }];
  $('#ldIngs').innerHTML = rows.map(ingRow).join('');
  [...$('#ldIngs').children].forEach((r, k) => { r.querySelector('.r-dose').value = rows[k].dose ?? ''; });
  $('#ldIngWarn').hidden = !ings.some((x) => x.auto);
  ingRows();
}
/** อ่านแถว → { strength, dose_id, ingredients } หรือ throw ข้อความผิดพลาด */
function readIngs() {
  const rows = [...document.querySelectorAll('#ldIngs .ld-ing-row')].map((r) => {
    const [u, per] = r.querySelector('.r-u').value.split('|'), amt = +r.querySelector('.r-mg').value;
    return { name: r.querySelector('.r-n').value.trim(), amt: amt > 0 ? amt : null, u, per, dose_id: +r.querySelector('.r-dose').value || null };
  }).filter((x) => x.name || x.amt || x.dose_id);
  const mgOf = (x) => (x.u === 'mcg' ? +(x.amt / 1000).toFixed(6) : x.amt);
  if (rows.length <= 1) {
    const r = rows[0];
    return { strength: r?.amt ? { mg: mgOf(r), per: r.per, ...(r.u === 'mcg' ? { u: 'mcg', amt: r.amt } : {}) } : null, dose_id: r?.dose_id || null, ingredients: null };
  }
  const bad = rows.find((x) => !x.name || !x.amt);
  if (bad) throw new Error('ยาสูตรผสม: กรอกชื่อและความแรงของสารสำคัญให้ครบทุกแถว');
  if (new Set(rows.map((x) => x.per)).size > 1) throw new Error('ยาสูตรผสม: หน่วยของทุกสารต้องเป็นต่อเม็ด หรือต่อ มล. เหมือนกัน');
  return { strength: null, dose_id: null, ingredients: rows.map((x) => ({ name: x.name, mg: mgOf(x), per: x.per, ...(x.u === 'mcg' ? { u: 'mcg', amt: x.amt } : {}), ...(x.dose_id ? { dose_id: x.dose_id } : {}) })) };
}
/** ช่องความแรงว่าง → บอกว่าระบบอ่านจากชื่อยาได้เท่าไร */
function strHint() {
  const rows = document.querySelectorAll('#ldIngs .ld-ing-row');
  if (rows.length > 1) { $('#ldStrHint').textContent = 'ยาสูตรผสม: เลือกข้อมูลคำนวณขนาดยาของสารที่ต้องการ · หน้าคำนวณคิดจำนวนเม็ด/มล. จากสารนั้น'; return; }
  if (+rows[0]?.querySelector('.r-mg').value > 0) { $('#ldStrHint').textContent = 'ใช้ความแรงที่กรอก'; return; }
  if (comboName($('#ldName').value)) { $('#ldStrHint').textContent = 'ชื่อยาเป็นยาสูตรผสม · ระบบไม่อ่านความแรงจากชื่อ กรอกสารสำคัญแถวละสาร (กด "+ เพิ่มสารสำคัญ")'; return; }
  const st = strengthOf({ name: $('#ldName').value, unit: $('#ldUnit').value });
  $('#ldStrHint').textContent = st ? `ว่าง = อ่านจากชื่อยา: ${+st.mg.toFixed(3)} ${{ tab: 'มก./เม็ด', '5ml': 'มก./5 มล.', ml: 'มก./มล.' }[st.per]}` : 'อ่านจากชื่อยาไม่ได้ · กรอกความแรงเพื่อใช้ในเครื่องคำนวณ (เช่น ยาน้ำ 120 มก./5 มล.)';
}
function renderLinks() {
  const names = linkNames(links);
  $('#ldLinks').innerHTML = names.length ? names.map((n) => `<span class="chip c-role">${codeTag(monoByName(n))}${esc(n)}<button type="button" class="nt-x" data-unlink="${esc(n)}" aria-label="เลิกผูก ${esc(n)}">×</button></span>`).join('')
    : '<span class="small muted">ยังไม่ได้ผูก</span>';
}
function renderPick() {
  const q = $('#ldLinkQ').value.trim().toLowerCase();
  if (q.length < 2) { $('#ldLinkOut').innerHTML = ''; return; }
  const names = [...new Map(monos.filter((m) => m.name.toLowerCase().includes(q)).map((m) => [m.name, m])).values()].slice(0, 12);
  $('#ldLinkOut').innerHTML = names.length ? names.map((m) => `<button type="button" class="btn btn-o btn-sm btn-wrap" data-link="${esc(m.name)}">+ ${codeTag(m)}${esc(m.name)} <span class="small muted">${esc(m.sub_code)} ${esc(m.sub_name)}</span></button>`).join('')
    : '<span class="small muted">ไม่พบในบัญชียาหลัก · เพิ่มข้อมูลยาใหม่ได้ในกล่องด้านล่าง</span>';
}
/* ---- ฟอร์มด้านบน (#ldNewFold · ปกติย่อไว้) = เพิ่มยาใหม่ · กด "แก้ไข" ในรายการ = ฟอร์มย้ายลงไปใต้ยานั้น
//   ด้านบนไม่ย่อ/ไม่ขยายตาม · ข้อมูลยาใหม่ที่กรอกค้างไว้เก็บไว้ (newDraft) แล้วคืนกลับเมื่อบันทึก/ยกเลิกการแก้ไข ---- */
let newDraft = null;
const DRAFT_F = ['#ldName', '#ldCode', '#ldCat', '#ldPack', '#ldUnit', '#ldNote', '#ldDdi', '#ldFda', '#ldSort'];
function snapNew() {
  if (editLocal || newOutside) return;   // ฟอร์มไม่ได้อยู่ในโหมดเพิ่มยาใหม่
  const ings = [...document.querySelectorAll('#ldIngs .ld-ing-row')].map((r) => { const [u, per] = r.querySelector('.r-u').value.split('|');
    return { name: r.querySelector('.r-n').value, amt: r.querySelector('.r-mg').value, u, per, dose: r.querySelector('.r-dose').value }; });
  const v = DRAFT_F.map((x) => $(x).value);
  if (!$('#ldName').value.trim() && !$('#ldCode').value.trim() && !links.length && !ings.some((x) => x.name || x.amt)) { newDraft = null; return; }
  newDraft = { v, links: [...links], ings, active: $('#ldActive').checked, outside: $('#ldOutside').checked };
}
function restoreNew() {
  const d = newDraft; newDraft = null;
  if (!d) return;
  DRAFT_F.forEach((x, i) => { $(x).value = d.v[i]; });
  links = d.links; $('#ldActive').checked = d.active; $('#ldOutside').checked = d.outside;
  $('#ldIngs').innerHTML = d.ings.map(ingRow).join('');
  [...$('#ldIngs').children].forEach((r, k) => { r.querySelector('.r-dose').value = d.ings[k].dose || ''; });
  ingRows(); renderLinks();
}
function resetLocal() {
  editLocal = null; links = []; newOutside = false;
  ['#ldName', '#ldCode', '#ldCat', '#ldPack', '#ldUnit', '#ldNote', '#ldLinkQ'].forEach((s) => { $(s).value = ''; });
  $('#ldSort').value = locals.length ? Math.max(...locals.map((l) => l.sort)) + 1 : 1; $('#ldActive').checked = true; $('#ldOutside').checked = false; $('#ldFda').value = '';
  $('#ldDdi').value = ''; fillIngs(null); ddiChips('#ldDdi', '#ldDdiChips');
  $('#ldSubmit').textContent = 'เพิ่มยา'; $('#ldCancel').hidden = true; $('#ldMsg').textContent = '';
  renderLinks(); renderPick();
  parkForm($('#ldForm'));
  restoreNew();
  $('#ldNewNote').hidden = true;
}
export function editLocalForm(l) {
  const list = l.outside ? $('#loList') : $('#ldList');
  if (isOpenAt($('#ldForm'), list, `[data-ld-edit="${l.id}"]`)) { closeForm($('#ldForm'), true, resetLocal); return; }   // กดแก้ไขซ้ำ = ย่อ
  snapNew();
  editLocal = l; newOutside = false; links = [...(l.mono_refs || [])]; $('#ldNewNote').hidden = false;
  $('#ldName').value = l.name; $('#ldCode').value = l.code || ''; $('#ldCat').value = l.category; $('#ldPack').value = l.pack_size || '';
  $('#ldUnit').value = l.unit || ''; $('#ldNote').value = l.note || ''; $('#ldFda').value = l.fda_key || '';
  fillIngs(l);
  $('#ldDdi').value = (l.ddi_ids || []).map((i) => ddDrugs.find((d) => d.id === i)?.name || i).join(', '); $('#ldSort').value = l.sort; $('#ldActive').checked = l.active; $('#ldOutside').checked = !!l.outside; ddiChips('#ldDdi', '#ldDdiChips');
  $('#ldLinkFold').open = !doseIdsOf(l).length;   // ยาที่มีข้อมูลคำนวณ = ผูกที่ คำนวณขนาดยา › แก้ไข
  $('#ldSubmit').textContent = 'บันทึกการแก้ไข'; $('#ldCancel').hidden = false; $('#ldMsg').textContent = '';
  renderLinks();
  showForm($('#ldForm'), list, `[data-ld-edit="${l.id}"]`, $('#ldName'));   // ขยายใต้ยาที่กด
}
async function saveLocal(e) {
  e.preventDefault();
  const name = $('#ldName').value.trim(), category = $('#ldCat').value.trim();
  if (!name) { $('#ldName').focus(); $('#ldMsg').textContent = 'กรุณากรอกชื่อยา'; return; }
  if (!category) { $('#ldCat').focus(); $('#ldMsg').textContent = 'กรุณาระบุหมวดยา'; return; }
  const code = $('#ldCode').value.trim() || null;
  if (code && locals.some((l) => l.code === code && l.id !== editLocal?.id)) { $('#ldCode').focus(); $('#ldMsg').textContent = 'รหัสยานี้มีในรายการแล้ว'; return; }
  const row = { name, code, category, pack_size: $('#ldPack').value.trim(), unit: $('#ldUnit').value.trim(), note: $('#ldNote').value.trim() || null,
    mono_refs: links, fda_key: $('#ldFda').value || null, sort: +$('#ldSort').value || 0, active: $('#ldActive').checked, outside: $('#ldOutside').checked, updated_at: new Date().toISOString() };
  try { Object.assign(row, readIngs()); } catch (err) { $('#ldMsg').textContent = err.message; $('#ldIngs .r-n')?.focus(); return; }   // บันทึกโดยผู้ดูแล = ทวนสอบแล้ว (ไม่มี auto)
  const ddiNames = $('#ldDdi').value.split(',').map((x) => x.trim()).filter(Boolean);
  const ddiIds = ddiNames.map((n) => ddDrugs.find((d) => d.name.toLowerCase() === n.toLowerCase() || d.id === n)?.id);
  if (ddiIds.some((x) => !x)) { $('#ldDdi').focus(); $('#ldMsg').textContent = `ไม่พบยาใน DDInter: ${ddiNames.filter((n, i) => !ddiIds[i]).join(', ')} (เลือกจากรายการที่แนะนำ)`; return; }
  row.ddi_ids = [...new Set(ddiIds)];
  const btn = $('#ldSubmit'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = editLocal ? await sb.from('local_drugs').update(row).eq('id', editLocal.id) : await sb.from('local_drugs').insert(row);
  busy(btn, false);
  if (error) { toast(errText(error), 'err'); return; }
  toast(editLocal ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มยาแล้ว'); changed();
  await loadLocals(); resetLocal();
}
async function onLocalList(e) {
  const ed = e.target.closest('[data-ld-edit]'), del = e.target.closest('[data-ld-del]');
  if (ed) { const l = locals.find((x) => x.id === +ed.dataset.ldEdit); if (l) editLocalForm(l); return; }
  if (!del) return;
  const l = locals.find((x) => x.id === +del.dataset.ldDel);
  if (!l || !confirm(`ลบ "${l.name}" ออกจากรายการยา${l.outside ? 'นอก ' : ' '}รพ.สต.?\n(ข้อมูลยาในบัญชียาหลักไม่ถูกลบ)`)) return;
  const { error } = await sb.from('local_drugs').delete().eq('id', l.id);
  if (error) { toast(errText(error), 'err'); return; }
  toast('ลบยาแล้ว'); changed();
  if (editLocal?.id === l.id) resetLocal();
  loadLocals();
}

/* ======================= กล่อง "ผูกฐานข้อมูล" ในฟอร์มคำนวณขนาดยา (admin-settings.js) ======================= */
//   ยาที่ใช้ข้อมูลคำนวณนี้ (local_drugs.dose_id) + บัญชียาหลัก (mono_refs) + ฉลาก openFDA (fda_key) + DDInter (ddi_ids) → บันทึกครั้งเดียวผูกให้ทุกตัว
//   บันทึกเฉพาะช่องที่ผู้ดูแลเปลี่ยน (เทียบกับค่าตอนเปิด dl.init) · ยาที่เพิ่มใหม่ในกล่อง = เติมช่องที่ยังว่างของยานั้น
//   ยาสูตรผสม (ผูกรายสาร) และยาที่จับคู่ตามชื่อ เอาออกจากกล่องนี้ไม่ได้ (แก้ที่ฐานข้อมูลบัญชียา รพ.สต.) · ยาที่จับคู่ตามชื่อ บันทึกแล้วผูกจริง (dose_id)
const isCombo = (l) => (l.ingredients || []).length > 1;
const usesDose = (l, id) => l.dose_id === id || (l.ingredients || []).some((x) => x.dose_id === id);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
let dl = { ids: [], refs: [], auto: new Set(), init: null };
function bindLinkBox() {
  const add = () => {
    const v = $('#dlLocalQ').value.trim().toLowerCase(), l = v && locals.find((x) => x.name.toLowerCase() === v);
    if (!l) return;
    if (!dl.ids.includes(l.id)) dl.ids.push(l.id);
    $('#dlLocalQ').value = ''; renderLinkBox();
  };
  $('#dlLocalQ').addEventListener('input', add);
  $('#dlLocalQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  $('#dlLocals').addEventListener('click', (e) => { const b = e.target.closest('[data-dl-rm]'); if (!b) return; dl.ids = dl.ids.filter((i) => i !== +b.dataset.dlRm); renderLinkBox(); });
  $('#dlMonoQ').addEventListener('input', renderDlPick);
  $('#dlDdi').addEventListener('input', () => ddiChips('#dlDdi', '#dlDdiChips'));
  $('#ldDdi').addEventListener('input', () => ddiChips('#ldDdi', '#ldDdiChips'));
  $('#dlMonoQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  $('#dlMonoOut').addEventListener('click', (e) => {
    const b = e.target.closest('[data-link]'); if (!b) return;
    dl.refs = [...new Set([...dl.refs, ...monos.filter((m) => m.name === b.dataset.link).map((m) => m.ref)])];
    $('#dlMonoQ').value = ''; renderDlPick(); renderLinkBox();
  });
  $('#dlMonos').addEventListener('click', (e) => { const b = e.target.closest('[data-unlink]'); if (!b) return; dl.refs = dl.refs.filter((r) => byRef(r)?.name !== b.dataset.unlink && r !== b.dataset.unlink); renderLinkBox(); });
}
function renderDlPick() {
  const q = $('#dlMonoQ').value.trim().toLowerCase();
  if (q.length < 2) { $('#dlMonoOut').innerHTML = ''; return; }
  const names = [...new Map(monos.filter((m) => m.name.toLowerCase().includes(q)).map((m) => [m.name, m])).values()].slice(0, 12);
  $('#dlMonoOut').innerHTML = names.length ? names.map((m) => `<button type="button" class="btn btn-o btn-sm btn-wrap" data-link="${esc(m.name)}">+ ${codeTag(m)}${esc(m.name)} <span class="small muted">${esc(m.sub_code)} ${esc(m.sub_name)}</span></button>`).join('')
    : '<span class="small muted">ไม่พบในบัญชียาหลัก</span>';
}
const PER_TH = { tab: 'มก./เม็ด', '5ml': 'มก./5 มล.', ml: 'มก./มล.' };
function renderLinkBox() {
  $('#dlLocals').innerHTML = dl.ids.length ? dl.ids.map((id) => {
    const l = locals.find((x) => x.id === id); if (!l) return '';
    const st = strengthOf(l), fixed = isCombo(l) || dl.auto.has(id);
    return `<span class="chip c-role" data-dl-id="${id}">${codeTag(l)}${esc(l.name)}${st ? ` · ${+(+st.mg).toFixed(3)} ${PER_TH[st.per] || ''}` : ''}${l.outside ? ' · ยานอก รพ.สต.' : ''}`
      + `${isCombo(l) ? ' · สูตรผสม' : dl.auto.has(id) ? ' · จับคู่ตามชื่อ' : ''}${l.active ? '' : ' · ซ่อน'}`
      + (fixed ? '' : `<button type="button" class="nt-x" data-dl-rm="${id}" aria-label="เอา ${esc(l.name)} ออก">×</button>`) + '</span>';
  }).join('') : '<span class="small muted">ยังไม่มียา รพ.สต. ที่ใช้ข้อมูลนี้ · พิมพ์ชื่อยาด้านล่างเพื่อเพิ่ม</span>';
  const names = linkNames(dl.refs);
  $('#dlMonos').innerHTML = names.length ? names.map((n) => `<span class="chip c-role">${codeTag(monoByName(n))}${esc(n)}<button type="button" class="nt-x" data-unlink="${esc(n)}" aria-label="เลิกผูก ${esc(n)}">×</button></span>`).join('')
    : '<span class="small muted">ยังไม่ได้ผูก</span>';
  $('#dlN').textContent = dl.ids.length ? `· ยา ${dl.ids.length} รายการ` : '';
  ddiChips('#dlDdi', '#dlDdiChips');
}
/** เปิดฟอร์มคำนวณขนาดยา (เพิ่ม/แก้ไข) → เติมกล่องผูกฐานข้อมูลจากยา รพ.สต. ที่ใช้ข้อมูลนี้ */
export async function dlFill(dose) {
  if (ready) await ready;
  const id = dose?.id || null;
  const users = id ? locals.filter((l) => usesDose(l, id)) : [];
  const auto = id ? locals.filter((l) => !l.dose_id && !isCombo(l) && !usesDose(l, id) && doseIdsOf(l).includes(id)) : [];
  const all = [...users, ...auto];
  const keys = [...new Set(all.map((l) => l.fda_key).filter(Boolean))];
  const ddi = [...new Set(all.flatMap((l) => l.ddi_ids || []))];
  dl = { ids: all.map((l) => l.id), refs: [...new Set(all.flatMap((l) => l.mono_refs || []))], auto: new Set(auto.map((l) => l.id)), init: null };
  dl.init = { ids: [...dl.ids], refs: [...dl.refs], fda: keys[0] || null, ddi };
  $('#dlFda').value = keys[0] || ''; $('#dlDdi').value = ddi.map(ddName).join(', ');
  $('#dlLocalQ').value = ''; $('#dlMonoQ').value = ''; renderDlPick();
  $('#dlWarn').hidden = keys.length < 2;
  $('#dlWarn').textContent = keys.length > 1 ? `ยาแต่ละตัวผูกฉลากต่างกัน (${keys.length} ฉลาก) · ถ้าเปลี่ยนช่องฉลากแล้วบันทึก ทุกตัวจะใช้ฉลากเดียวกัน` : '';
  renderLinkBox();
}
/** บันทึกกล่องผูกฐานข้อมูลหลังบันทึกข้อมูลคำนวณ (id) → จำนวนยาที่แก้ · throw = ข้อมูลในกล่องไม่ถูกต้อง */
export function dlCheck() {
  const names = $('#dlDdi').value.split(',').map((x) => x.trim()).filter(Boolean);
  const ids = names.map((n) => ddDrugs.find((d) => d.name.toLowerCase() === n.toLowerCase() || d.id === n)?.id);
  if (ids.some((x) => !x)) throw new Error(`ผูกฐานข้อมูล: ไม่พบยาใน DDInter ${names.filter((n, i) => !ids[i]).join(', ')} (เลือกจากรายการที่แนะนำ)`);
  return [...new Set(ids)];
}
export async function dlSave(id) {
  if (!dl.init || !id) return 0;
  const ddi = dlCheck(), fda = $('#dlFda').value || null, now = new Date().toISOString();
  const refsCh = !sameSet(dl.refs, dl.init.refs), fdaCh = fda !== dl.init.fda, ddiCh = !sameSet(ddi, dl.init.ddi);
  const jobs = [];
  for (const lid of new Set([...dl.ids, ...dl.init.ids])) {
    const l = locals.find((x) => x.id === lid); if (!l) continue;
    const row = {}, fresh = !dl.init.ids.includes(lid);
    if (!dl.ids.includes(lid)) { if (l.dose_id === id) row.dose_id = null; }   // เอาออกจากกล่อง = เลิกใช้ข้อมูลคำนวณนี้
    else {
      if (!isCombo(l) && l.dose_id !== id) row.dose_id = id;
      if (refsCh ? !sameSet(l.mono_refs || [], dl.refs) : fresh && !(l.mono_refs || []).length && dl.refs.length) row.mono_refs = dl.refs;
      if (fdaCh ? l.fda_key !== fda : fresh && !l.fda_key && fda) row.fda_key = fda;
      if (ddiCh ? !sameSet(l.ddi_ids || [], ddi) : fresh && !(l.ddi_ids || []).length && ddi.length) row.ddi_ids = ddi;
    }
    if (Object.keys(row).length) jobs.push(sb.from('local_drugs').update({ ...row, updated_at: now }).eq('id', lid));
  }
  const res = await Promise.all(jobs), err = res.find((r) => r.error)?.error;
  if (err) throw err;
  if (jobs.length) { changed(); await loadLocals(); }
  dl.init = null;
  return jobs.length;
}

/* ======================= เพิ่มหลายรายการ + AI: ผูกชื่อยาที่พิมพ์กับทุกฐานข้อมูล ======================= */
const FORM_WORDS = /\b(?:tabs?|tablets?|caps?|capsules?|syr|syrup|susp|suspension|sol|solution|cream|oint|ointment|inj|injection|drops?|mg|mcg|ml|g|iu|foil|sr|er)\b/g;
/** ชื่อสามัญสำหรับจับคู่: "PARACETAMOL 500 MG (FOIL)" → "paracetamol" · "พาราเซตามอล (Paracetamol)" → "paracetamol" */
export function genericKey(name) {
  const s = String(name || ''), outer = s.replace(/\([^()]*\)/g, ' '), inner = (s.match(/\(([^()]*[A-Za-z][^()]*)\)/) || [])[1] || '';
  const p = /[A-Za-z]/.test(outer) ? outer : inner;
  return p.toLowerCase().replace(/\d.*$/, '').replace(FORM_WORDS, ' ').replace(/[^a-z\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}
const likeKey = (a, b) => !!a && !!b && (a === b || sameDrug(a, b) || sameDrug(b, a));
/** ยา รพ.สต./ยานอก ที่ตรงกับชื่อที่พิมพ์: ชื่อสามัญเดียวกัน หรือผูกข้อมูลยาบัญชียาหลักเดียวกัน · พิมพ์ความแรงมาด้วย = ต้องมีตัวเลขนั้นในชื่อ */
export function matchLocals(name, alias = '') {
  const g = genericKey(name); if (g.length < 3) return [];
  const nums = String(name).match(/\d+(?:\.\d+)?/g) || [];
  const refs = new Set(monos.filter((m) => keysOf(m.name).some((k) => likeKey(k, g) || likeKey(k, alias))).map((m) => m.ref));
  return locals.filter((l) => {
    const lg = genericKey(l.name);
    const hit = likeKey(lg, g) || likeKey(lg, alias) || (!isCombo(l) && (l.mono_refs || []).some((r) => refs.has(r)));
    return hit && nums.every((n) => new RegExp(`(^|[^\\d.])${n.replace('.', '\\.')}(?![\\d])`).test(l.name));
  });
}
/** ชื่อยาที่พิมพ์ → ยา รพ.สต. ที่ตรงกัน หรือสร้างใหม่ในบัญชียานอก รพ.สต. (ซ่อนจนผู้ดูแลตรวจ) → เติมช่องที่ยังว่าง:
 *   บัญชียาหลัก · ฉลาก openFDA ยารับประทาน (ชุดเดียวกับที่ AI ใช้ร่างขนาดยา setId หรือค้นจากชื่อ us) · DDInter (เฉพาะยาที่มีในข้อมูลที่นำเข้า) · ข้อมูลคำนวณ doseId
 *   ไม่ทับข้อมูลที่ผู้ดูแลผูกไว้แล้ว · คืน { created, names, parts: [ข้อความสรุป] } */
export async function linkDrug(name, { doseId = null, setId = null, us = '' } = {}) {
  if (!ready) await initDrugsAdmin(); else await ready;
  const g = genericKey(name), en = String(us || g).toLowerCase(), now = new Date().toISOString();
  let ls = matchLocals(name, en), created = false;
  const refs = [...new Set(monos.filter((m) => keysOf(m.name).some((k) => likeKey(k, g) || likeKey(k, en))).map((m) => m.ref))];
  let fda = fdas.find((f) => f.route === 'ORAL' && (f.generic === en || f.generic === g))?.key || null, fdaNew = false;
  if (!fda && (!ls.length || ls.some((l) => !l.fda_key)) && en.length >= 3) {
    try {
      const row = (setId && await fetchFdaBySetId(setId)) || await fetchFdaLabel(en, 'ORAL');
      if (row?.sections.length) {
        const { error } = await sb.from('drug_fda_labels').upsert({ ...row, fetched_at: now, updated_at: now }, { onConflict: 'key' });
        if (!error) { fda = row.key; fdaNew = true; }
      }
    } catch { /* ไม่มีฉลาก / openFDA ไม่ตอบ = ข้ามข้อนี้ */ }
  }
  const ddi = [...new Set(ddDrugs.filter((d) => { const k = d.name.toLowerCase(); return k === g || k === en; }).map((d) => d.id))];
  if (!ls.length) {
    // ไม่มีในบัญชียา รพ.สต. → เพิ่มในบัญชียานอก รพ.สต. เฉพาะเมื่อพบข้อมูลอย่างน้อย 1 ฐาน (ชื่อที่พิมพ์ผิด/ไม่มีจริง = ไม่สร้าง)
    if (!refs.length && !fda && !ddi.length && !doseId) return { created: false, names: [], parts: ['ไม่พบในฐานข้อมูลใดเลย · ตรวจชื่อยาภาษาอังกฤษ'] };
    const row = { name: String(name).trim().slice(0, 200), category: 'ยานอก รพ.สต.', outside: true, active: false,
      note: 'ระบบเพิ่มจากรายชื่อยาที่พิมพ์ (เพิ่มหลายรายการ) · รอผู้ดูแลตรวจ', sort: (locals.length ? Math.max(...locals.map((l) => l.sort)) : 0) + 1 };
    const { data, error } = await sb.from('local_drugs').insert(row).select();
    if (error) throw error;
    ls = [data[0]]; locals.push(data[0]); created = true;
  }
  const jobs = ls.map((l) => {
    const row = {};
    if (!(l.mono_refs || []).length && refs.length) row.mono_refs = refs;
    if (!l.fda_key && fda) row.fda_key = fda;
    if (!(l.ddi_ids || []).length && ddi.length) row.ddi_ids = ddi;
    if (doseId && !l.dose_id && !isCombo(l)) row.dose_id = doseId;
    return Object.keys(row).length ? sb.from('local_drugs').update({ ...row, updated_at: now }).eq('id', l.id) : null;
  }).filter(Boolean);
  const err = (await Promise.all(jobs)).find((r) => r.error)?.error;
  if (err) throw err;
  changed(); await Promise.all([loadLocals(), fdaNew ? loadFdas() : null]);
  const has = (k) => ls.some((l) => (locals.find((x) => x.id === l.id) || l)[k]?.length);
  const parts = [created ? 'เพิ่มในบัญชียานอก รพ.สต. (ซ่อน · รอตรวจ)' : `ยา รพ.สต.: ${ls.map((l) => l.name).join(', ')}`,
    has('mono_refs') ? 'บัญชียาหลัก ✓' : 'บัญชียาหลัก: ไม่พบ', has('fda_key') ? 'ฉลาก openFDA ✓' : 'ฉลาก openFDA: ไม่พบ', has('ddi_ids') ? 'DDInter ✓' : 'DDInter: ไม่มีในข้อมูลที่นำเข้า'];
  return { created, names: ls.map((l) => l.name), parts };
}

/* ======================= บัญชียาหลักแห่งชาติ ======================= */
function renderMonos() {
  const q = $('#dmQ').value.trim().toLowerCase();
  const list = pick ? monos.filter((m) => (pick.mono_refs || []).includes(m.ref)) : monos.filter((m) => !q || [m.name, m.group_name, m.sub_name, m.sub_code].join(' ').toLowerCase().includes(q));
  secN('nlem', list.length);
  $('#dmCount').textContent = `(${monos.length})`;
  parkForm($('#dmForm'));
  $('#dmList').innerHTML = !monos.length ? '<p class="empty">ยังไม่มีข้อมูลยา</p>' : !list.length ? `<p class="empty">${pick ? 'ยานี้ยังไม่ผูกกับบัญชียาหลัก · ผูกได้ที่ฟอร์มยา รพ.สต. (ช่อง "ข้อมูลยาในบัญชียาหลักแห่งชาติที่ผูกไว้")' : 'ไม่พบข้อมูลยาที่ค้นหา'}</p>`
    : list.slice(0, dmShown).map((m) => `<div class="li"><div class="l"><b>${codeTag(m)}${esc(m.name)}</b>`
      + `<span class="small muted">กลุ่มยา ${m.group_no} ${esc(m.group_name)} › ${esc(m.sub_code)} ${esc(m.sub_name)}</span>`
      + `<span class="small muted">${(m.forms || []).map((f) => esc([f.form, f.acct].filter(Boolean).join(' · '))).join(' / ')}${(m.sections || []).length ? ` · ${(m.sections || []).map((x) => esc(x.title)).join(', ')}` : ''}</span></div>`
      + `<div class="actions"><button type="button" class="btn btn-o btn-sm" data-dm-edit="${m.id}">แก้ไข</button>`
      + `<button type="button" class="btn btn-no btn-sm" data-dm-del="${m.id}">ลบ</button></div></div>`).join('');
  keepForm($('#dmForm'), $('#dmList'), editMono && `[data-dm-edit="${editMono.id}"]`);
  $('#dmMore').hidden = list.length <= dmShown;
  if (list.length > dmShown) $('#dmMore').textContent = `แสดงเพิ่ม (เหลืออีก ${list.length - dmShown} รายการ)`;
}
/** หัวข้อในยา ⇄ ข้อความ "## หัวข้อ\nบรรทัด…" */
const sectionsText = (secs) => (secs || []).map((x) => `## ${x.title}\n${(x.body || []).join('\n')}`).join('\n');
function parseSections(txt) {
  const out = [];
  for (const raw of String(txt).split('\n')) {
    const line = raw.trim(); if (!line) continue;
    const h = line.match(/^##\s*(.+)$/);
    if (h) out.push({ title: h[1].trim().slice(0, 100), body: [] });
    else { if (!out.length) out.push({ title: 'รายละเอียด', body: [] }); out[out.length - 1].body.push(line); }
  }
  return out.filter((x) => x.body.length || x.title);
}
const formsText = (forms) => (forms || []).map((f) => [f.form, f.acct].filter(Boolean).join(' | ')).join('\n');
const parseForms = (txt) => String(txt).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const [form, acct = ''] = l.split('|').map((x) => x.trim());
  return { form, acct };
});
function openMonoForm(m) {
  if (m && isOpenAt($('#dmForm'), $('#dmList'), `[data-dm-edit="${m.id}"]`)) { closeForm($('#dmForm')); editMono = null; return; }
  editMono = m;
  $('#dmTitle').textContent = m ? `แก้ไข: ${m.name}` : 'เพิ่มข้อมูลยาใหม่';
  $('#dmName').value = m?.name || ''; $('#dmGroupNo').value = m?.group_no ?? ''; $('#dmGroup').value = m?.group_name || '';
  $('#dmSubCode').value = m?.sub_code || ''; $('#dmSub').value = m?.sub_name || '';
  $('#dmForms').value = formsText(m?.forms); $('#dmFlags').value = (m?.flags || []).join(', '); $('#dmSections').value = sectionsText(m?.sections);
  $('#dmMsg').textContent = '';
  if (m) showForm($('#dmForm'), $('#dmList'), `[data-dm-edit="${m.id}"]`, $('#dmName'));
  else { parkForm($('#dmForm')); $('#dmForm').hidden = false; $('#dmForm').scrollIntoView({ block: 'start', behavior: 'smooth' }); $('#dmName').focus(); }
}
async function saveMono(e) {
  e.preventDefault();
  const name = $('#dmName').value.trim();
  if (!name) { $('#dmName').focus(); $('#dmMsg').textContent = 'กรุณากรอกชื่อยา'; return; }
  const row = {
    name, group_no: +$('#dmGroupNo').value || 0, group_name: $('#dmGroup').value.trim() || 'อื่น ๆ',
    sub_code: $('#dmSubCode').value.trim() || String(+$('#dmGroupNo').value || 0), sub_name: $('#dmSub').value.trim(),
    forms: parseForms($('#dmForms').value), flags: $('#dmFlags').value.split(',').map((x) => x.trim()).filter(Boolean),
    sections: parseSections($('#dmSections').value), updated_at: new Date().toISOString(),
  };
  const btn = $('#dmSubmit'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = editMono ? await sb.from('drug_monographs').update(row).eq('id', editMono.id)
    : await sb.from('drug_monographs').insert({ ...row, no: 0, ref: `custom:${Date.now()}`, sort: (monos.length ? Math.max(...monos.map((m) => m.sort)) : 0) + 1 });
  busy(btn, false);
  if (error) { toast(errText(error), 'err'); return; }
  toast(editMono ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มข้อมูลยาแล้ว'); changed();
  closeForm($('#dmForm')); editMono = null;
  loadMonos();
}
async function onMonoList(e) {
  const ed = e.target.closest('[data-dm-edit]'), del = e.target.closest('[data-dm-del]');
  if (ed) { const m = monos.find((x) => x.id === +ed.dataset.dmEdit); if (m) openMonoForm(m); return; }
  if (!del) return;
  const m = monos.find((x) => x.id === +del.dataset.dmDel); if (!m) return;
  const used = locals.filter((l) => (l.mono_refs || []).includes(m.ref));
  if (!confirm(`ลบข้อมูลยา "${m.name}" (${m.sub_code} ${m.sub_name})?` + (used.length ? `\nยา รพ.สต. ที่ผูกไว้ ${used.length} รายการจะไม่แสดงข้อมูลส่วนนี้` : ''))) return;
  const { error } = await sb.from('drug_monographs').delete().eq('id', m.id);
  if (error) { toast(errText(error), 'err'); return; }
  toast('ลบข้อมูลยาแล้ว'); changed();
  loadMonos();
}

/* ======================= ฉลากยาสหรัฐฯ (openFDA) ======================= */
const FDA_SECTIONS = [
  ['ข้อบ่งใช้', ['indications_and_usage']],
  ['ขนาดยาและวิธีใช้', ['dosage_and_administration']],
  ['ข้อห้ามใช้', ['contraindications', 'do_not_use']],
  ['คำเตือนกรอบดำ', ['boxed_warning']],
  ['คำเตือนและข้อควรระวัง', ['warnings_and_cautions', 'warnings', 'precautions', 'ask_doctor', 'ask_doctor_or_pharmacist', 'when_using', 'stop_use']],
  ['อาการไม่พึงประสงค์', ['adverse_reactions']],
  ['Drug interaction', ['drug_interactions']],
  ['การใช้ในหญิงตั้งครรภ์/ให้นมบุตร เด็ก ผู้สูงอายุ', ['pregnancy', 'lactation', 'nursing_mothers', 'pregnancy_or_breast_feeding', 'pediatric_use', 'geriatric_use']],
  ['กลไกการออกฤทธิ์', ['mechanism_of_action']],
  ['เภสัชจลนศาสตร์', ['pharmacokinetics']],
  ['การได้รับยาเกินขนาด', ['overdosage']],
  ['การเก็บรักษา', ['storage_and_handling']],
];
const FDA_MAX = 2500;
const fdaClean = (t) => String(t).replace(/\s+/g, ' ').trim()
  .replace(/^\d+(\.\d+)*\s+[A-Z][A-Z &/,-]+\s+/, '')
  .replace(/^\d+\.\d+(\.\d+)*\s+/, '')
  .replace(/^(INDICATIONS (AND|&) USAGE|DOSAGE (AND|&) ADMINISTRATION|CONTRAINDICATIONS|WARNINGS( AND PRECAUTIONS)?|PRECAUTIONS|ADVERSE REACTIONS|DRUG INTERACTIONS|OVERDOSAGE|PREGNANCY|NURSING MOTHERS|PEDIATRIC USE|GERIATRIC USE|LACTATION|MECHANISM OF ACTION|PHARMACOKINETICS|Uses|Directions|Warnings|Do not use|Ask a doctor[a-z ]*|Stop use[a-z ]*|When using[a-z ]*|If pregnant or breast-feeding,?|Storage and Handling|HOW SUPPLIED)[:\s]+/i, '');
function fdaSections(lab) {
  const out = [];
  for (const [title, keys] of FDA_SECTIONS) {
    let body = keys.filter((k) => lab[k]?.length).map((k) => fdaClean(lab[k].join(' '))).filter(Boolean).join(' ');
    if (!body) continue;
    if (body.length > FDA_MAX) { const cut = body.slice(0, FDA_MAX); body = cut.slice(0, Math.max(cut.lastIndexOf('. '), FDA_MAX - 300) + 1).trim() + ' …'; }
    out.push({ title, body });
  }
  return out;
}
/** ดึงฉลากจาก openFDA แล้วเลือกฉลากที่ข้อมูลครบที่สุด (ตัวยาเดี่ยว · ยาสั่งจ่าย · ไม่ใช่โฮมีโอพาธีย์) */
export async function fetchFdaLabel(generic, route, brand) {
  const g = generic.trim().toLowerCase();
  const q = `openfda.generic_name:"${g}"+AND+openfda.route:"${route}"` + (brand ? `+AND+openfda.brand_name:"${brand.trim()}"` : '');
  const res = await fetch('https://api.fda.gov/drug/label.json?search=' + encodeURI(q).replace(/#/g, '%23') + '&limit=50');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`openFDA ไม่ตอบ (รหัส ${res.status}) กรุณาลองใหม่`);
  const labs = ((await res.json()).results || []).filter((l) => (l.openfda?.generic_name || []).map((x) => x.toLowerCase()).includes(g) && !/homeopath|\bHPUS\b/i.test(JSON.stringify(l)));
  if (!labs.length) return null;
  const score = (l) => { const o = l.openfda || {}, gn = (o.generic_name || []).map((x) => x.toLowerCase());
    return fdaSections(l).length * 10 + (gn.length === 1 && gn[0] === g ? 30 : 0) + ((o.product_type || []).includes('HUMAN PRESCRIPTION DRUG') ? 15 : 0)
      - (/bacteriostatic/i.test((o.brand_name || []).join(' ')) ? 25 : 0) + (+String(l.effective_time || '0').slice(0, 4) || 0) / 1000; };
  const lab = labs.reduce((a, b) => (score(b) > score(a) ? b : a));
  const o = lab.openfda || {};
  return { key: [g, route, ...(brand?.trim() ? [brand.trim().toLowerCase()] : [])].join('|'), generic: g, route, brand: brand?.trim().toLowerCase() || null,
    title: ((o.brand_name || o.generic_name || [g])[0] || g).slice(0, 200), set_id: lab.set_id || null, effective: lab.effective_time || null, sections: fdaSections(lab) };
}
/* ---- DailyMed (69_dailymed.sql): ค้นผ่านฐานข้อมูล (DailyMed ไม่เปิดให้เบราว์เซอร์เรียกตรง) → นำเข้าฉลากชุดเดียวกันผ่าน openFDA ด้วย set_id ---- */
async function searchDailyMed() {
  const q = $('#dmdQ').value.trim(), btn = $('#dmdGo'), out = $('#dmdOut'), msg = $('#dmdMsg');
  if (q.length < 2) { $('#dmdQ').focus(); msg.textContent = 'กรุณาพิมพ์ชื่อยาภาษาอังกฤษ'; return; }
  busy(btn, true, 'กำลังค้น…'); msg.textContent = ''; out.innerHTML = '<div class="skeleton"></div>';
  try {
    const { data: id, error } = await sb.rpc('dailymed_search', { p_q: q });
    if (error) throw error;
    let r = { status: 'pending' };
    for (let i = 0; r.status === 'pending' && i < 20; i++) {
      await new Promise((ok) => setTimeout(ok, i ? 1500 : 800));
      const { data, error: e2 } = await sb.rpc('dailymed_result', { p_id: id });
      if (e2) throw e2;
      r = data;
    }
    if (r.status !== 'done') throw new Error('DailyMed ไม่ตอบ กรุณาลองใหม่');
    msg.textContent = r.data.length ? `พบ ${r.data.length} ฉลาก (ล่าสุดก่อน)` : 'ไม่พบฉลากใน DailyMed · ลองชื่อสามัญที่สหรัฐฯ ใช้';
    out.innerHTML = r.data.map((x) => `<div class="li"><div class="l"><b>${esc(x.title)}</b><span class="small muted">ปรับปรุง ${esc(x.published_date || '-')} · ฉบับที่ ${esc(x.spl_version ?? '-')}</span></div>`
      + `<div class="actions"><a class="btn btn-o btn-sm" href="https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${encodeURIComponent(x.setid)}" target="_blank" rel="noopener">เปิดใน DailyMed</a>`
      + `<button type="button" class="btn btn-p btn-sm" data-dmd-imp="${esc(x.setid)}">นำเข้าฉลากนี้</button></div></div>`).join('');
  } catch (err) { out.innerHTML = ''; msg.style.color = 'var(--error)'; msg.textContent = errText(err); return; }
  finally { busy(btn, false); }
  msg.style.color = '';
}
/** ฉลากจาก openFDA ด้วย set_id (ฉลากชุดเดียวกับ DailyMed) → แถว drug_fda_labels */
export async function fetchFdaBySetId(setid) {
  const res = await fetch(`https://api.fda.gov/drug/label.json?search=set_id:"${encodeURIComponent(setid)}"&limit=1`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`openFDA ไม่ตอบ (รหัส ${res.status}) กรุณาลองใหม่`);
  const lab = ((await res.json()).results || [])[0];
  if (!lab) return null;
  const o = lab.openfda || {}, g = String((o.generic_name || [])[0] || '').toLowerCase().slice(0, 150), route = String((o.route || ['ORAL'])[0]).toUpperCase();
  const brand = String((o.brand_name || [])[0] || '').toLowerCase().slice(0, 120);
  if (!g) return null;
  return { key: [g, route, ...(brand && brand !== g ? [brand] : [])].join('|').slice(0, 200), generic: g, route, brand: brand && brand !== g ? brand : null,
    title: ((o.brand_name || o.generic_name || [g])[0] || g).slice(0, 200), set_id: lab.set_id || setid, effective: lab.effective_time || null, sections: fdaSections(lab) };
}
async function importBySetId(setid, btn) {
  const msg = $('#dmdMsg'); busy(btn, true, 'กำลังนำเข้า…');
  try {
    const row = await fetchFdaBySetId(setid);
    if (!row || !row.sections.length) { msg.style.color = 'var(--error)'; msg.textContent = 'ฉลากนี้ยังไม่มีใน openFDA (หรือไม่มีหัวข้อที่ใช้ได้) · เปิดอ่านใน DailyMed ได้'; return; }
    const { error } = await sb.from('drug_fda_labels').upsert({ ...row, fetched_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    msg.style.color = 'var(--success)'; msg.textContent = `นำเข้าฉลาก "${row.title}" แล้ว (${row.sections.length} หัวข้อ) · ผูกกับยา รพ.สต. ได้ที่แท็บบัญชียา รพ.สต.`;
    changed(); await loadFdas();
  } catch (err) { msg.style.color = 'var(--error)'; msg.textContent = errText(err); }
  finally { busy(btn, false); }
}
async function fetchAndSave(generic, route, brand, btn) {
  if (!generic.trim()) { $('#faGeneric').focus(); $('#faMsg').textContent = 'กรุณากรอกชื่อสามัญภาษาอังกฤษ'; return; }
  busy(btn, true, 'กำลังดึง…'); $('#faMsg').textContent = '';
  try {
    const row = await fetchFdaLabel(generic, route, brand);
    if (!row || !row.sections.length) { $('#faMsg').style.color = 'var(--error)'; $('#faMsg').textContent = 'ไม่พบฉลากยานี้ใน openFDA · ลองชื่อสามัญที่สหรัฐฯ ใช้ (เช่น paracetamol → acetaminophen, salbutamol → albuterol) หรือเปลี่ยนช่องทางให้ยา'; return; }
    const { error } = await sb.from('drug_fda_labels').upsert({ ...row, fetched_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    $('#faMsg').style.color = 'var(--success)'; $('#faMsg').textContent = `บันทึกฉลาก "${row.title}" แล้ว (${row.sections.length} หัวข้อ) · ผูกกับยา รพ.สต. ได้ที่ช่อง "ฉลากยาสหรัฐฯ" ในฟอร์มด้านบน`;
    changed(); await loadFdas();
  } catch (err) { $('#faMsg').style.color = 'var(--error)'; $('#faMsg').textContent = errText(err); }
  finally { busy(btn, false); }
}
async function loadFdas() {
  const { data, error } = await sb.from('drug_fda_labels').select('*').order('generic');
  if (error) { toast(errText(error), 'err'); $('#faList').innerHTML = '<p class="empty">โหลดฉลากยาไม่สำเร็จ</p>'; return; }
  fdas = data;
  const cur = $('#ldFda').value;
  $('#ldFda').innerHTML = '<option value="">— ไม่ผูก —</option>' + fdas.map((f) => `<option value="${esc(f.key)}">${esc(codeTxt(f))}${esc(f.title)} · ${esc(f.generic)} (${esc(f.route)})</option>`).join('');
  $('#ldFda').value = fdas.some((f) => f.key === cur) ? cur : (editLocal?.fda_key || '');
  const dcur = $('#dlFda').value;
  $('#dlFda').innerHTML = $('#ldFda').innerHTML; $('#dlFda').value = fdas.some((f) => f.key === dcur) ? dcur : '';
  renderFdas(); renderLocals();
}
function renderFdas() {
  const q = $('#faQ').value.trim().toLowerCase();
  const list = pick ? fdas.filter((f) => f.key === pick.fda_key) : fdas.filter((f) => !q || [f.title, f.generic, f.route].join(' ').toLowerCase().includes(q));
  secN('fda', list.length);
  const used = (k) => locals.filter((l) => l.fda_key === k).length;
  $('#faCount').textContent = `(${fdas.length})`;
  parkForm($('#faForm'));
  $('#faList').innerHTML = !fdas.length ? '<p class="empty">ยังไม่มีฉลากยา</p>' : !list.length ? `<p class="empty">${pick ? 'ยานี้ยังไม่ผูกฉลาก openFDA · ดึงฉลากด้านบน แล้วผูกที่ฟอร์มยา รพ.สต.' : 'ไม่พบฉลากที่ค้นหา'}</p>`
    : list.map((f) => `<div class="li"><div class="l"><b>${codeTag(f)}${esc(f.title)}</b><span class="small muted">${esc(f.generic)} · ${esc(f.route)}${f.brand ? ` · ${esc(f.brand)}` : ''} · ${(f.sections || []).length} หัวข้อ${f.effective ? ` · ฉลาก ${esc(f.effective)}` : ''}</span>`
      + `<span class="small ${used(f.key) ? 'muted' : ''}">${used(f.key) ? `ผูกกับยา รพ.สต. ${used(f.key)} รายการ` : '<span class="chip c-off">ยังไม่ผูกกับยา รพ.สต.</span>'}</span>`
      + `<div class="meta">${f.sections_th?.length ? `<span class="chip ${f.th_reviewed ? 'c-on' : 'c-role'}">${f.th_reviewed ? 'ภาษาไทย · ตรวจแล้ว' : 'ภาษาไทย (AI แปล)'}</span>` : f.th_status === 'pending' ? '<span class="chip c-off">AI กำลังแปล…</span>' : '<span class="chip c-off">ยังไม่มีภาษาไทย</span>'}${f.th_status === 'error' && f.th_note ? `<span class="small ai-err">${esc(f.th_note)}</span>` : ''}</div></div>`
      + `<div class="actions"><button type="button" class="btn btn-o btn-sm" data-fa-th="${f.id}">${f.sections_th?.length ? 'AI แปลใหม่' : 'ให้ AI แปลไทย'}</button><button type="button" class="btn btn-o btn-sm" data-fa-refresh="${f.id}">ดึงใหม่</button><button type="button" class="btn btn-o btn-sm" data-fa-edit="${f.id}">แก้ไข</button>`
      + `<button type="button" class="btn btn-no btn-sm" data-fa-del="${f.id}">ลบ</button></div></div>`).join('');
  keepForm($('#faForm'), $('#faList'), editFda && `[data-fa-edit="${editFda.id}"]`);
}
async function onFdaList(e) {
  const b = e.target.closest('[data-fa-refresh],[data-fa-edit],[data-fa-del],[data-fa-th]'); if (!b) return;
  const f = fdas.find((x) => x.id === +(b.dataset.faRefresh || b.dataset.faEdit || b.dataset.faDel || b.dataset.faTh)); if (!f) return;
  if (b.dataset.faTh) {
    if (f.th_reviewed && !confirm(`ให้ AI แปล "${f.title}" ใหม่?\nข้อความภาษาไทยที่ตรวจ/แก้ไว้จะถูกแทนที่`)) return;
    busy(b, true, 'AI กำลังแปล…');
    try { await translate(f); toast('AI แปลเป็นภาษาไทยแล้ว'); } catch (err) { toast(errText(err), 'err'); }
    finally { busy(b, false); changed(); loadFdas(); }
    return;
  }
  if (b.dataset.faRefresh) {
    if (!confirm(`ดึงฉลาก "${f.title}" ใหม่จาก openFDA?\nข้อความที่แก้เองในฉลากนี้จะถูกแทนที่`)) return;
    return fetchAndSave(f.generic, f.route, f.brand || '', b);
  }
  if (b.dataset.faEdit) { openFdaForm(f); return; }
  if (!confirm(`ลบฉลาก "${f.title}"?` + (locals.some((l) => l.fda_key === f.key) ? '\nยา รพ.สต. ที่ผูกไว้จะไม่แสดงข้อมูลฉลากนี้' : ''))) return;
  const { error } = await sb.from('drug_fda_labels').delete().eq('id', f.id);
  if (error) { toast(errText(error), 'err'); return; }
  toast('ลบฉลากแล้ว'); changed(); loadFdas();
}
function openFdaForm(f) {
  if (isOpenAt($('#faForm'), $('#faList'), `[data-fa-edit="${f.id}"]`)) { closeForm($('#faForm')); editFda = null; return; }
  editFda = f; $('#faTitle').textContent = `แก้ไขฉลาก: ${f.title}`; $('#faName').value = f.title;
  $('#faSections').value = sectionsText((f.sections || []).map((x) => ({ title: x.title, body: [x.body] })));
  $('#faSectionsTh').value = sectionsText(f.sections_th || []);
  showForm($('#faForm'), $('#faList'), `[data-fa-edit="${f.id}"]`, $('#faSectionsTh'));
}
/** ให้ AI แปล/เรียบเรียงฉลาก 1 ฉลากเป็นภาษาไทย (60_drug_calc_th.sql · ai_fda_th_start/poll) */
async function translate(f) {
  const { error } = await sb.rpc('ai_fda_th_start', { p_id: f.id });
  if (error) throw error;
  let r = { th_status: 'pending' };
  for (let i = 0; r.th_status === 'pending' && i < 80; i++) {
    await new Promise((ok) => setTimeout(ok, 2500));
    const { data, error: e2 } = await sb.rpc('ai_fda_th_poll', { p_id: f.id });
    if (e2) throw e2;
    r = data;
  }
  if (r.th_status !== 'done') throw new Error(r.th_note || 'AI ยังแปลไม่เสร็จ กรุณาลองใหม่');
  return r;
}
/** แปลทุกฉลากที่ยังไม่มีภาษาไทย ทีละฉลาก · กดหยุดได้ */
async function thAll() {
  const todo = fdas.filter((f) => !f.sections_th?.length);
  const msg = $('#faMsg'), btn = $('#faThAll');
  if (!todo.length) { msg.style.color = 'var(--success)'; msg.textContent = 'ทุกฉลากมีภาษาไทยแล้ว'; return; }
  thStop = false; busy(btn, true, 'AI กำลังแปล…'); $('#faThStop').hidden = false;
  let ok = 0, bad = 0;
  try {
    for (const [i, f] of todo.entries()) {
      if (thStop) break;
      msg.style.color = ''; msg.textContent = `กำลังแปล ${i + 1}/${todo.length}: ${f.title}`;
      try { await translate(f); ok++; } catch (err) { bad++; if (/ครบ \d+ ครั้ง|ไม่มีสิทธิ์|ยังไม่พร้อม/.test(errText(err))) { msg.textContent = errText(err); break; } }
    }
  } finally {
    busy(btn, false); $('#faThStop').hidden = true; changed();
    msg.style.color = ok ? 'var(--success)' : 'var(--error)';
    msg.textContent = `แปลเป็นภาษาไทยแล้ว ${ok} ฉลาก${bad ? ` · ไม่สำเร็จ ${bad} ฉลาก (กด "ให้ AI แปลไทย" ทีละฉลากเพื่อลองใหม่)` : ''}${thStop ? ' · หยุดแล้ว' : ''}`;
    await loadFdas();
  }
}
async function saveFda(e) {
  e.preventDefault();
  if (!editFda) return;
  const sections = parseSections($('#faSections').value).map((x) => ({ title: x.title, body: x.body.join(' ') })).filter((x) => x.body);
  const th = parseSections($('#faSectionsTh').value).map((x) => ({ title: x.title, body: x.body.map((l) => l.replace(/^[-•]\s*/, '')).filter(Boolean) })).filter((x) => x.body.length);
  const btn = $('#faSave'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = await sb.from('drug_fda_labels').update({ title: $('#faName').value.trim() || editFda.title, sections, sections_th: th.length ? th : null, th_reviewed: th.length > 0, updated_at: new Date().toISOString() }).eq('id', editFda.id);
  busy(btn, false);
  if (error) { toast(errText(error), 'err'); return; }
  toast('บันทึกฉลากแล้ว'); changed(); closeForm($('#faForm')); editFda = null; loadFdas();
}

/* ======================= Drug interaction (DDInter) ======================= */
const DD_RANK = { Major: 0, Moderate: 1, Minor: 2, Unknown: 3 };
const ddName = (id) => ddDrugs.find((d) => d.id === id)?.name || id;
async function loadDdi() {
  const [d, p] = await Promise.all([sb.from('ddi_drugs').select('id,name,web_code').order('name'), sb.from('ddi_pairs').select('*').order('id')]);
  if (d.error || p.error) { toast(errText(d.error || p.error), 'err'); $('#ddList').innerHTML = '<p class="empty">โหลดข้อมูลไม่สำเร็จ</p>'; return; }
  ddDrugs = d.data; ddPairs = p.data.sort((a, b) => DD_RANK[a.level] - DD_RANK[b.level] || ddName(a.a).localeCompare(ddName(b.a)));
  $('#ddiNames').innerHTML = ddDrugs.map((x) => `<option value="${esc(x.name)}"></option>`).join('');
  if (editLocal) $('#ldDdi').value = (editLocal.ddi_ids || []).map(ddName).join(', '); ddiChips('#ldDdi', '#ldDdiChips');
  renderDd();
}
function renderDd() {
  const q = $('#ddQ').value.trim().toLowerCase(), lv = $('#ddLevel').value;
  const ids = pick ? pick.ddi_ids || [] : null;
  const list = ddPairs.filter((p) => (lv === 'all' || p.level === lv) && (ids ? ids.includes(p.a) || ids.includes(p.b) : !q || `${ddName(p.a)} ${ddName(p.b)}`.toLowerCase().includes(q)));
  secN('ddi', list.length);
  $('#ddCount').textContent = `(${ddPairs.length} คู่ · แปลไทยแล้ว ${ddPairs.filter((p) => p.description_th).length})`;
  parkForm($('#ddForm'));
  $('#ddList').innerHTML = !ddPairs.length ? '<p class="empty">ยังไม่มีข้อมูล drug interaction</p>' : !list.length ? `<p class="empty">${pick ? (ids.length ? 'ยานี้ไม่มีคู่ interaction กับยา รพ.สต. อื่น' : 'ยานี้ยังไม่ผูกกับยาใน DDInter · ผูกได้ที่ฟอร์มยา รพ.สต.') : 'ไม่พบคู่ยาที่ค้นหา'}</p>`
    : list.slice(0, ddShown).map((p) => `<div class="li"><div class="l"><b>${codeTag(ddDrugs.find((d) => d.id === p.a))}${esc(ddName(p.a))} × ${codeTag(ddDrugs.find((d) => d.id === p.b))}${esc(ddName(p.b))}</b>`
      + `<span class="small muted">${esc(p.level)} · ${esc((p.mech || []).join(', ') || '-')}</span>`
      + `<div class="meta">${p.description_th ? `<span class="chip ${p.th_reviewed ? 'c-on' : 'c-role'}">${p.th_reviewed ? 'ภาษาไทย · ตรวจแล้ว' : 'ภาษาไทย (AI แปล)'}</span>` : '<span class="chip c-off">ยังไม่มีภาษาไทย</span>'}${p.th_status === 'error' && p.th_note ? `<span class="small ai-err">${esc(p.th_note)}</span>` : ''}</div></div>`
      + `<div class="actions"><button type="button" class="btn btn-o btn-sm" data-dd-th="${p.id}">${p.description_th ? 'AI แปลใหม่' : 'ให้ AI แปลไทย'}</button><button type="button" class="btn btn-o btn-sm" data-dd-edit="${p.id}">แก้ไข</button>`
      + `<button type="button" class="btn btn-no btn-sm" data-dd-del="${p.id}">ลบ</button></div></div>`).join('');
  keepForm($('#ddForm'), $('#ddList'), editDd && `[data-dd-edit="${editDd.id}"]`);
  $('#ddMore').hidden = list.length <= ddShown;
  if (list.length > ddShown) $('#ddMore').textContent = `แสดงเพิ่ม (เหลืออีก ${list.length - ddShown} คู่)`;
}
async function translateDd(p) {
  const { error } = await sb.rpc('ai_ddi_th_start', { p_id: p.id });
  if (error) throw error;
  let r = { th_status: 'pending' };
  for (let i = 0; r.th_status === 'pending' && i < 80; i++) {
    await new Promise((ok) => setTimeout(ok, 2500));
    const { data, error: e2 } = await sb.rpc('ai_ddi_th_poll', { p_id: p.id });
    if (e2) throw e2;
    r = data;
  }
  if (r.th_status !== 'done') throw new Error(r.th_note || 'AI ยังแปลไม่เสร็จ กรุณาลองใหม่');
  return r;
}
async function ddThAll() {
  const todo = ddPairs.filter((p) => !p.description_th && p.description);   // เรียงรุนแรงก่อนอยู่แล้ว
  const msg = $('#ddMsg'), btn = $('#ddThAll');
  if (!todo.length) { msg.style.color = 'var(--success)'; msg.textContent = 'ทุกคู่มีภาษาไทยแล้ว'; return; }
  ddStop = false; busy(btn, true, 'AI กำลังแปล…'); $('#ddThStop').hidden = false;
  let ok = 0, bad = 0;
  try {
    for (const [i, p] of todo.entries()) {
      if (ddStop) break;
      msg.style.color = ''; msg.textContent = `กำลังแปล ${i + 1}/${todo.length}: ${ddName(p.a)} × ${ddName(p.b)}`;
      try { await translateDd(p); ok++; } catch (err) { bad++; if (/ครบ \d+ ครั้ง|ไม่มีสิทธิ์|ยังไม่พร้อม/.test(errText(err))) { msg.textContent = errText(err); break; } }
    }
  } finally {
    busy(btn, false); $('#ddThStop').hidden = true; changed();
    msg.style.color = ok ? 'var(--success)' : 'var(--error)';
    msg.textContent = `แปลเป็นภาษาไทยแล้ว ${ok} คู่${bad ? ` · ไม่สำเร็จ ${bad} คู่` : ''}${ddStop ? ' · หยุดแล้ว (กดอีกครั้งเพื่อแปลต่อ)' : ''}`;
    await loadDdi();
  }
}
function openDdForm(p) {
  if (isOpenAt($('#ddForm'), $('#ddList'), `[data-dd-edit="${p.id}"]`)) { closeForm($('#ddForm')); editDd = null; return; }
  editDd = p; $('#ddTitle').textContent = `แก้ไข: ${ddName(p.a)} × ${ddName(p.b)}`; $('#ddLv').value = p.level;
  $('#ddDescTh').value = p.description_th || ''; $('#ddMgmtTh').value = p.management_th || ''; $('#ddDesc').value = p.description || ''; $('#ddMgmt').value = p.management || '';
  showForm($('#ddForm'), $('#ddList'), `[data-dd-edit="${p.id}"]`, $('#ddDescTh'));
}
async function onDdList(e) {
  const b = e.target.closest('[data-dd-th],[data-dd-edit],[data-dd-del]'); if (!b) return;
  const p = ddPairs.find((x) => x.id === +(b.dataset.ddTh || b.dataset.ddEdit || b.dataset.ddDel)); if (!p) return;
  if (b.dataset.ddEdit) { openDdForm(p); return; }
  if (b.dataset.ddTh) {
    if (p.th_reviewed && !confirm('ให้ AI แปลคู่นี้ใหม่?\nข้อความภาษาไทยที่ตรวจ/แก้ไว้จะถูกแทนที่')) return;
    busy(b, true, 'AI กำลังแปล…');
    try { await translateDd(p); toast('AI แปลเป็นภาษาไทยแล้ว'); } catch (err) { toast(errText(err), 'err'); } finally { busy(b, false); changed(); loadDdi(); }
    return;
  }
  if (!confirm(`ลบคู่ interaction "${ddName(p.a)} × ${ddName(p.b)}"?`)) return;
  const { error } = await sb.from('ddi_pairs').delete().eq('id', p.id);
  if (error) { toast(errText(error), 'err'); return; }
  toast('ลบแล้ว'); changed(); loadDdi();
}
async function saveDd(e) {
  e.preventDefault();
  if (!editDd) return;
  const th = $('#ddDescTh').value.trim();
  const row = { level: $('#ddLv').value, description_th: th || null, management_th: $('#ddMgmtTh').value.trim() || null, th_reviewed: !!th,
    description: $('#ddDesc').value.trim(), management: $('#ddMgmt').value.trim(), updated_at: new Date().toISOString() };
  const btn = $('#ddSave'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = await sb.from('ddi_pairs').update(row).eq('id', editDd.id);
  busy(btn, false);
  if (error) { toast(errText(error), 'err'); return; }
  toast('บันทึกแล้ว'); changed(); closeForm($('#ddForm')); editDd = null; loadDdi();
}
