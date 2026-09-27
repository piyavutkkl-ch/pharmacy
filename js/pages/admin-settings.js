// ผู้ดูแล › ตั้งค่า › คำนวณโดสยา (ตาราง dose_drugs) และ ช่องทางติดต่อ รพ.สต. (ตาราง units)
// ความแรงยาเก็บใน dose_drugs.concs เป็น [{label, mgPer5ml}] (ยาน้ำ) หรือ [{label, mgPerTab}] (เม็ด/แคปซูล)
import { sb, publicImageUrl } from '../supabase.js?v=4.3.1';
import { $, esc, toast, errText, busy } from '../util.js?v=4.3.1';
import { loadUnits } from '../data.js?v=4.3.1';
import { uploadPublicImage, removeFiles } from '../upload.js?v=4.3.1';
import { resetDose } from './dose.js?v=4.3.1';

const num = (v) => (v === '' || v == null ? null : Number(v));
function say(el, text, ok) { el.style.color = ok ? 'var(--success)' : 'var(--error)'; el.textContent = text; }

/* ======================= คำนวณโดสยา ======================= */
let drugs = [], editDrug = null, doseBound = false;

export async function initDoseAdmin() {
  if (!doseBound) {
    doseBound = true;
    $('#dfPer').addEventListener('change', syncPer);
    $('#dfAddConc').addEventListener('click', () => { $('#dfConcs').insertAdjacentHTML('beforeend', concRow()); $('#dfConcs .med-row:last-child input').focus(); });
    $('#dfConcs').addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) e.target.closest('.med-row').remove(); });
    $('#dfCancel').addEventListener('click', resetDrugForm);
    $('#dfForm').addEventListener('submit', saveDrug);
    $('#dfList').addEventListener('click', onDrugList);
    resetDrugForm();
  }
  await reloadDrugs();
}

function syncPer() { $('#dfFreqWrap').hidden = $('#dfPer').value !== 'day'; }

function concRow(c = {}) {
  const tab = c.mgPerTab != null;
  return `<div class="med-row"><input class="input c-label" maxlength="80" placeholder="เช่น ยาน้ำ 120 มก./5 มล." value="${esc(c.label || '')}" aria-label="ชื่อความแรง">`
    + `<input class="input c-mg" type="number" inputmode="decimal" min="0" step="0.01" placeholder="มก." value="${esc(c.mgPerTab ?? c.mgPer5ml ?? '')}" aria-label="ปริมาณยา (มก.)">`
    + `<select class="input c-type" aria-label="รูปแบบ"><option value="liquid"${tab ? '' : ' selected'}>มก./5 มล.</option><option value="tablet"${tab ? ' selected' : ''}>มก./เม็ด</option></select>`
    + '<button type="button" class="btn btn-o btn-sm" data-rm aria-label="ลบความแรงนี้">ลบ</button></div>';
}

function readConcs() {
  const out = [];
  for (const r of document.querySelectorAll('#dfConcs .med-row')) {
    const label = r.querySelector('.c-label').value.trim(), mg = num(r.querySelector('.c-mg').value);
    if (!label && mg == null) continue;
    if (!label || !(mg > 0)) throw new Error('ความแรงของยาต้องมีทั้งชื่อและปริมาณ (มก.) มากกว่า 0');
    out.push(r.querySelector('.c-type').value === 'tablet' ? { label, mgPerTab: mg } : { label, mgPer5ml: mg });
  }
  return out;
}

async function reloadDrugs() {
  $('#dfList').innerHTML = '<div class="skeleton"></div>';
  const { data, error } = await sb.from('dose_drugs').select('*').order('sort').order('name');
  if (error) { $('#dfList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  drugs = data;
  $('#dfList').innerHTML = drugs.length ? drugs.map((d) => `<div class="li"><div class="l"><b>${esc(d.name)}</b>`
    + `<span class="small muted">${d.mg_per_kg_min}–${d.mg_per_kg_max} มก./กก./${d.per === 'dose' ? 'ครั้ง' : 'วัน' + (d.dose_freq_per_day ? ' แบ่ง ' + d.dose_freq_per_day + ' ครั้ง' : '')}`
    + `${d.max_mg_per_dose ? ' · สูงสุด ' + d.max_mg_per_dose + ' มก./ครั้ง' : ''} · ${(d.concs || []).length} ความแรง · ลำดับ ${d.sort}</span>`
    + `<div class="meta"><span class="chip ${d.active ? 'c-on' : 'c-off'}">${d.active ? 'แสดงอยู่' : 'ซ่อน'}</span></div></div>`
    + `<div class="actions"><button type="button" class="btn btn-o btn-sm" data-edit="${d.id}">แก้ไข</button>`
    + `<button type="button" class="btn btn-o btn-sm" data-toggle="${d.id}">${d.active ? 'ซ่อน' : 'แสดง'}</button>`
    + `<button type="button" class="btn btn-no btn-sm" data-del="${d.id}">ลบ</button></div></div>`).join('')
    : '<p class="empty">ยังไม่มีรายการยา</p>';
  if (!editDrug && !$('#dfName').value) $('#dfSort').value = nextSort();
}
const nextSort = () => (drugs.length ? Math.max(...drugs.map((d) => d.sort)) + 1 : 0);

function resetDrugForm() {
  editDrug = null;
  $('#dfForm').reset();
  $('#dfConcs').innerHTML = concRow();
  $('#dfSort').value = nextSort();
  $('#dfTitle').textContent = 'เพิ่มรายการยา';
  $('#dfSubmit').textContent = 'เพิ่มยา';
  $('#dfCancel').hidden = true;
  syncPer(); say($('#dfMsg'), '');
}

function startEditDrug(d) {
  editDrug = d;
  $('#dfName').value = d.name; $('#dfInd').value = d.indication || ''; $('#dfPer').value = d.per;
  $('#dfTimes').value = d.dose_freq_per_day ?? ''; $('#dfMin').value = d.mg_per_kg_min; $('#dfMax').value = d.mg_per_kg_max;
  $('#dfCap').value = d.max_mg_per_dose ?? ''; $('#dfFreq').value = d.freq || ''; $('#dfRenal').value = d.renal_note || '';
  $('#dfSort').value = d.sort; $('#dfActive').checked = d.active;
  $('#dfConcs').innerHTML = (d.concs || []).map(concRow).join('') || concRow();
  $('#dfTitle').textContent = 'แก้ไข: ' + d.name;
  $('#dfSubmit').textContent = 'บันทึกการแก้ไข';
  $('#dfCancel').hidden = false;
  syncPer(); say($('#dfMsg'), '');
  $('#dfForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveDrug(e) {
  e.preventDefault();
  const m = $('#dfMsg');
  const name = $('#dfName').value.trim(), min = num($('#dfMin').value), max = num($('#dfMax').value), per = $('#dfPer').value;
  const times = num($('#dfTimes').value);
  if (!name) { say(m, 'กรุณาใส่ชื่อยา'); $('#dfName').focus(); return; }
  if (min == null || max == null || min < 0) { say(m, 'กรุณาใส่ขนาดยาต่ำสุดและสูงสุด (มก./กก.)'); return; }
  if (max < min) { say(m, 'ขนาดสูงสุดต้องไม่น้อยกว่าขนาดต่ำสุด'); return; }
  if (per === 'day' && !(times >= 1)) { say(m, 'ยาแบบ "ต่อวัน" ต้องระบุจำนวนครั้งที่แบ่งให้ต่อวัน'); $('#dfTimes').focus(); return; }
  let concs;
  try { concs = readConcs(); } catch (err) { say(m, err.message); return; }
  const row = {
    name, indication: $('#dfInd').value.trim() || null, per, mg_per_kg_min: min, mg_per_kg_max: max,
    dose_freq_per_day: per === 'day' ? times : null, max_mg_per_dose: num($('#dfCap').value),
    freq: $('#dfFreq').value.trim() || null, renal_note: $('#dfRenal').value.trim() || null,
    concs, sort: num($('#dfSort').value) ?? 0, active: $('#dfActive').checked,
  };
  const btn = $('#dfSubmit'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = editDrug ? await sb.from('dose_drugs').update(row).eq('id', editDrug.id) : await sb.from('dose_drugs').insert(row);
  busy(btn, false);
  if (error) { say(m, errText(error)); return; }
  toast(editDrug ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มยาแล้ว');
  resetDose();
  await reloadDrugs();
  resetDrugForm();
}

async function onDrugList(e) {
  const b = e.target.closest('button'); if (!b) return;
  const d = drugs.find((x) => String(x.id) === (b.dataset.edit || b.dataset.toggle || b.dataset.del)); if (!d) return;
  if (b.dataset.edit) return startEditDrug(d);
  let res;
  if (b.dataset.toggle) res = await sb.from('dose_drugs').update({ active: !d.active }).eq('id', d.id);
  else {
    if (!confirm(`ลบ "${d.name}" ออกจากเครื่องคำนวณ? (ถ้าอาจใช้อีก แนะนำกด "ซ่อน" แทน)`)) return;
    res = await sb.from('dose_drugs').delete().eq('id', d.id);
    if (editDrug?.id === d.id) resetDrugForm();
  }
  if (res.error) { toast(errText(res.error), 'err'); return; }
  toast(b.dataset.del ? 'ลบแล้ว' : d.active ? 'ซ่อนแล้ว' : 'แสดงแล้ว');
  resetDose();
  reloadDrugs();
}

/* ======================= ช่องทางติดต่อ รพ.สต. ======================= */
let units = [], editUnit = null, ctBound = false;

export async function initContactsAdmin() {
  if (!ctBound) {
    ctBound = true;
    $('#ctCancel').addEventListener('click', closeUnit);
    $('#ctForm').addEventListener('submit', saveUnit);
    $('#ctList').addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const u = units.find((x) => String(x.id) === (b.dataset.edit || b.dataset.rmimg)); if (!u) return;
      if (b.dataset.edit) return openUnit(u);
      if (!confirm(`ลบรูปของ รพ.สต. ${u.name}?`)) return;
      const { error } = await sb.from('units').update({ image_path: null }).eq('id', u.id);
      if (error) { toast(errText(error), 'err'); return; }
      await removeFiles('public-images', [u.image_path]);
      toast('ลบรูปแล้ว'); reloadUnits();
    });
  }
  closeUnit();
  await reloadUnits();
}

async function reloadUnits() {
  units = await loadUnits(true);    // โหลดใหม่ เพื่อให้หน้าแรกเห็นข้อมูลล่าสุดด้วย
  $('#ctList').innerHTML = units.map((u) => `<div class="li">`
    + (u.image_path ? `<img src="${esc(publicImageUrl(u.image_path))}" alt="" loading="lazy" style="width:72px;height:48px;object-fit:cover;border-radius:8px;flex:none">` : '')
    + `<div class="l"><b>รพ.สต. ${esc(u.name)}</b><span class="small muted">${u.phone ? 'โทร ' + esc(u.phone) : 'ยังไม่ระบุเบอร์โทร'}${u.address ? ' · ' + esc(u.address) : ''}</span>`
    + (u.note ? `<span class="small muted">${esc(u.note)}</span>` : '') + '</div>'
    + `<div class="actions"><button type="button" class="btn btn-o btn-sm" data-edit="${u.id}">แก้ไข</button>`
    + (u.image_path ? `<button type="button" class="btn btn-no btn-sm" data-rmimg="${u.id}">ลบรูป</button>` : '') + '</div></div>').join('');
}

function openUnit(u) {
  editUnit = u;
  $('#ctTitle').textContent = 'แก้ไขช่องทางติดต่อ รพ.สต. ' + u.name;
  $('#ctPhone').value = u.phone || ''; $('#ctAddress').value = u.address || ''; $('#ctNote').value = u.note || ''; $('#ctImage').value = '';
  say($('#ctMsg'), '');
  $('#ctEdit').hidden = false;
  $('#ctEdit').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#ctPhone').focus({ preventScroll: true });
}
function closeUnit() { editUnit = null; $('#ctEdit').hidden = true; $('#ctForm').reset(); }

async function saveUnit(e) {
  e.preventDefault();
  if (!editUnit) return;
  const u = editUnit, f = $('#ctImage').files[0], m = $('#ctMsg');
  const phone = $('#ctPhone').value.trim();
  if (phone && !/^[0-9+\-\s(),]{6,30}$/.test(phone)) { say(m, 'เบอร์โทรใช้ได้เฉพาะตัวเลข และเครื่องหมาย - , ( )'); return; }
  const row = { phone: phone || null, address: $('#ctAddress').value.trim() || null, note: $('#ctNote').value.trim() || null };
  const btn = $('#ctSubmit'); busy(btn, true, 'กำลังบันทึก…');
  let newPath = null;
  try {
    if (f) { newPath = await uploadPublicImage(f, `units/${u.id}`); row.image_path = newPath; }
    const { error } = await sb.from('units').update(row).eq('id', u.id);
    if (error) throw error;
    if (newPath && u.image_path) await removeFiles('public-images', [u.image_path]);
    toast('บันทึกแล้ว — หน้าหลักแสดงข้อมูลใหม่แล้ว');
    closeUnit();
    await reloadUnits();
  } catch (err) {
    if (newPath) await removeFiles('public-images', [newPath]);
    say(m, err.code ? errText(err) : err.message || errText(err));
  } finally { busy(btn, false); }
}
