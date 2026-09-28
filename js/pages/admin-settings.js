// ผู้ดูแล › ตั้งค่า › คำนวณโดสยา (ตาราง dose_drugs) และ ช่องทางติดต่อ รพ.สต. (ตาราง units)
// ความแรงยาเก็บใน dose_drugs.concs เป็น [{label, mgPer5ml}] หรือ [{label, mgPerMl}] (ยาน้ำ) หรือ [{label, mgPerTab}] (เม็ด/แคปซูล)
import { sb, publicImageUrl } from '../supabase.js?v=4.4';
import { $, esc, toast, errText, busy } from '../util.js?v=4.4';
import { loadUnits } from '../data.js?v=4.4';
import { uploadPublicImage, removeFiles } from '../upload.js?v=4.4';
import { resetDose } from './dose.js?v=4.4';

const num = (v) => (v === '' || v == null ? null : Number(v));
function say(el, text, ok) { el.style.color = ok ? 'var(--success)' : 'var(--error)'; el.textContent = text; }

/* ======================= คำนวณโดสยา ======================= */
let drugs = [], editDrug = null, doseBound = false;

/** ข้อบ่งใช้ของยา — ยาเก่าที่ยังไม่มี indications ใช้ช่องเดิมเป็นข้อแรก */
export const indsOf = (d) => (d.indications?.length ? d.indications
  : [{ name: d.indication, per: d.per, min: d.mg_per_kg_min, max: d.mg_per_kg_max, times: d.dose_freq_per_day, cap: d.max_mg_per_dose, freq: d.freq, renal: d.renal_note }]);
const perText = (i) => `${i.min ?? '?'}–${i.max ?? '?'} มก./กก./${i.per === 'day' ? 'วัน' + (i.times ? ' แบ่ง ' + i.times + ' ครั้ง' : '') : 'ครั้ง'}${i.cap ? ' · สูงสุด ' + i.cap + ' มก./ครั้ง' : ''}`;

function indBox(i = { per: 'dose' }, open = true) {
  const v = (k) => esc(i[k] ?? '');
  return `<details class="ind-box"${open ? ' open' : ''}><summary><span class="ind-sum"></span><button type="button" class="btn btn-no btn-sm" data-rmind>ลบ</button></summary><div class="form-grid">`
    + `<div class="field full"><label>ข้อบ่งใช้ <span class="req">*</span><input class="input i-name" maxlength="200" placeholder="เช่น ลดไข้" value="${v('name')}"></label></div>`
    + `<div class="field"><label>คิดขนาดยาแบบ<select class="input i-per"><option value="dose"${i.per !== 'day' ? ' selected' : ''}>มก./กก./ครั้ง</option><option value="day"${i.per === 'day' ? ' selected' : ''}>มก./กก./วัน (แบ่งให้)</option></select></label></div>`
    + `<div class="field i-times-wrap"${i.per === 'day' ? '' : ' hidden'}><label>แบ่งให้วันละ (ครั้ง)<input class="input i-times" type="number" inputmode="numeric" min="1" max="12" value="${v('times')}"></label></div>`
    + `<div class="field"><label>ขนาดต่ำสุด (มก./กก.) <span class="req">*</span><input class="input i-min" type="number" inputmode="decimal" min="0" step="0.01" value="${v('min')}"></label></div>`
    + `<div class="field"><label>ขนาดสูงสุด (มก./กก.) <span class="req">*</span><input class="input i-max" type="number" inputmode="decimal" min="0" step="0.01" value="${v('max')}"></label></div>`
    + `<div class="field"><label>เพดานต่อครั้ง (มก.)<input class="input i-cap" type="number" inputmode="decimal" min="0" step="0.1" value="${v('cap')}"></label></div>`
    + `<div class="field"><label>ความถี่ (ข้อความ)<input class="input i-freq" maxlength="120" placeholder="เช่น ทุก 4–6 ชั่วโมง" value="${v('freq')}"></label></div>`
    + `<div class="field full"><label>ขนาดยาในโรคไต<textarea class="i-renal" rows="2" maxlength="1000">${v('renal')}</textarea></label></div></div></details>`;
}
function syncIndBoxes() {
  document.querySelectorAll('#dfInds .ind-box').forEach((b, k) => {
    const g = (c) => b.querySelector(c).value;
    b.querySelector('.i-times-wrap').hidden = g('.i-per') !== 'day';
    b.querySelector('.ind-sum').textContent = `ข้อบ่งใช้ ${k + 1}: ${g('.i-name').trim() || '(ยังไม่ระบุ)'} · ${perText({ per: g('.i-per'), min: g('.i-min') || null, max: g('.i-max') || null, times: g('.i-times') || null, cap: g('.i-cap') || null })}`;
  });
}
function readInds() {
  const out = [];
  document.querySelectorAll('#dfInds .ind-box').forEach((b, k) => {
    const g = (c) => b.querySelector(c).value.trim(), n = `ข้อบ่งใช้ ${k + 1}`;
    const i = { name: g('.i-name'), per: g('.i-per'), min: num(g('.i-min')), max: num(g('.i-max')), times: num(g('.i-times')), cap: num(g('.i-cap')), freq: g('.i-freq') || null, renal: g('.i-renal') || null };
    const bad = (t) => { b.open = true; throw new Error(`${n}: ${t}`); };
    if (!i.name) bad('กรุณาใส่ชื่อข้อบ่งใช้');
    if (i.min == null || i.max == null || i.min < 0) bad('กรุณาใส่ขนาดยาต่ำสุดและสูงสุด (มก./กก.)');
    if (i.max < i.min) bad('ขนาดสูงสุดต้องไม่น้อยกว่าขนาดต่ำสุด');
    if (i.per === 'day' && !(i.times >= 1)) bad('ยาแบบ "ต่อวัน" ต้องระบุจำนวนครั้งที่แบ่งให้ต่อวัน');
    if (i.per !== 'day') i.times = null;
    Object.keys(i).forEach((key) => { if (i[key] == null) delete i[key]; });
    out.push(i);
  });
  if (!out.length) throw new Error('ต้องมีข้อบ่งใช้อย่างน้อย 1 ข้อ');
  return out;
}

export async function initDoseAdmin() {
  if (!doseBound) {
    doseBound = true;
    $('#dfAddInd').addEventListener('click', () => { $('#dfInds').insertAdjacentHTML('beforeend', indBox()); syncIndBoxes(); $('#dfInds .ind-box:last-child .i-name').focus(); });
    $('#dfInds').addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rmind]'); if (!rm) return;
      e.preventDefault();
      if ($('#dfInds').children.length === 1) { say($('#dfMsg'), 'ต้องมีข้อบ่งใช้อย่างน้อย 1 ข้อ'); return; }
      rm.closest('.ind-box').remove(); syncIndBoxes();
    });
    $('#dfInds').addEventListener('input', syncIndBoxes);
    $('#dfInds').addEventListener('change', syncIndBoxes);
    $('#dfAddConc').addEventListener('click', () => { $('#dfConcs').insertAdjacentHTML('beforeend', concRow()); $('#dfConcs .med-row:last-child input').focus(); });
    $('#dfConcs').addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) e.target.closest('.med-row').remove(); });
    $('#dfCancel').addEventListener('click', resetDrugForm);
    $('#dfForm').addEventListener('submit', saveDrug);
    $('#dfList').addEventListener('click', onDrugList);
    resetDrugForm();
  }
  await reloadDrugs();
}


function concRow(c = {}) {
  const type = c.mgPerTab != null ? 'tablet' : c.mgPerMl != null ? 'ml' : 'liquid';
  return `<div class="med-row"><input class="input c-label" maxlength="80" placeholder="เช่น ยาน้ำ 120 มก./5 มล." value="${esc(c.label || '')}" aria-label="ชื่อความแรง">`
    + `<input class="input c-mg" type="number" inputmode="decimal" min="0" step="0.01" placeholder="มก." value="${esc(c.mgPerTab ?? c.mgPerMl ?? c.mgPer5ml ?? '')}" aria-label="ปริมาณยา (มก.)">`
    + `<select class="input c-type" aria-label="รูปแบบ">${[['liquid', 'มก./5 มล.'], ['ml', 'มก./มล.'], ['tablet', 'มก./เม็ด']].map(([k, l]) => `<option value="${k}"${type === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`
    + '<button type="button" class="btn btn-o btn-sm" data-rm aria-label="ลบความแรงนี้">ลบ</button></div>';
}

function readConcs() {
  const out = [];
  for (const r of document.querySelectorAll('#dfConcs .med-row')) {
    const label = r.querySelector('.c-label').value.trim(), mg = num(r.querySelector('.c-mg').value);
    if (!label && mg == null) continue;
    if (!label || !(mg > 0)) throw new Error('ความแรงของยาต้องมีทั้งชื่อและปริมาณ (มก.) มากกว่า 0');
    const t = r.querySelector('.c-type').value;
    out.push(t === 'tablet' ? { label, mgPerTab: mg } : t === 'ml' ? { label, mgPerMl: mg } : { label, mgPer5ml: mg });
  }
  return out;
}

async function reloadDrugs() {
  $('#dfList').innerHTML = '<div class="skeleton"></div>';
  const { data, error } = await sb.from('dose_drugs').select('*').order('sort').order('name');
  if (error) { $('#dfList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  drugs = data;
  $('#dfList').innerHTML = drugs.length ? drugs.map((d) => `<div class="li"><div class="l"><b>${esc(d.name)}</b>`
    + indsOf(d).map((i) => `<span class="small muted">${esc(i.name || 'ข้อบ่งใช้')}: ${esc(perText(i))}</span>`).join('')
    + `<span class="small muted">${indsOf(d).length} ข้อบ่งใช้ · ${(d.concs || []).length} ความแรง · ลำดับ ${d.sort}</span>`
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
  $('#dfInds').innerHTML = indBox(); syncIndBoxes();
  $('#dfSort').value = nextSort();
  $('#dfTitle').textContent = 'เพิ่มรายการยา';
  $('#dfSubmit').textContent = 'เพิ่มยา';
  $('#dfCancel').hidden = true;
  say($('#dfMsg'), '');
}

function startEditDrug(d) {
  editDrug = d;
  $('#dfName').value = d.name;
  const inds = indsOf(d);
  $('#dfInds').innerHTML = inds.map((i) => indBox(i, inds.length <= 3)).join(''); syncIndBoxes();
  $('#dfSort').value = d.sort; $('#dfActive').checked = d.active;
  $('#dfConcs').innerHTML = (d.concs || []).map(concRow).join('') || concRow();
  $('#dfTitle').textContent = 'แก้ไข: ' + d.name;
  $('#dfSubmit').textContent = 'บันทึกการแก้ไข';
  $('#dfCancel').hidden = false;
  say($('#dfMsg'), '');
  $('#dfForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveDrug(e) {
  e.preventDefault();
  const m = $('#dfMsg');
  const name = $('#dfName').value.trim();
  if (!name) { say(m, 'กรุณาใส่ชื่อยา'); $('#dfName').focus(); return; }
  let concs, inds;
  try { inds = readInds(); concs = readConcs(); } catch (err) { say(m, err.message); return; }
  const f = inds[0];   // ช่องเดิม = ข้อบ่งใช้แรก (หน้าเว็บรุ่นเก่ายังใช้ได้)
  const row = {
    name, indications: inds, indication: f.name, per: f.per, mg_per_kg_min: f.min, mg_per_kg_max: f.max,
    dose_freq_per_day: f.times ?? null, max_mg_per_dose: f.cap ?? null, freq: f.freq ?? null, renal_note: f.renal ?? null,
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
