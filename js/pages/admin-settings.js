// ผู้ดูแล › ตั้งค่า › คำนวณโดสยา (ตาราง dose_drugs) และ ช่องทางติดต่อ รพ.สต. (ตาราง units)
// ความแรงยาเก็บใน dose_drugs.concs เป็น [{label, mgPer5ml}] หรือ [{label, mgPerMl}] (ยาน้ำ) หรือ [{label, mgPerTab}] (เม็ด/แคปซูล)
import { sb, publicImageUrl } from '../supabase.js?v=4.4';
import { $, esc, toast, errText, busy, thaiDateTime } from '../util.js?v=4.4';
import { loadUnits } from '../data.js?v=4.4';
import { uploadPublicImage, removeFiles } from '../upload.js?v=4.4';
import { resetDose, latinOf, keysOf, sameDrug } from './dose.js?v=4.4';
import { showForm, closeForm, parkForm, keepForm, isOpenAt } from './admin-drugs.js?v=4.4';

const num = (v) => (v === '' || v == null ? null : Number(v));
/** ข้อบ่งใช้ใช้คำนวณได้หรือไม่ (กฎเดียวกับ public.dose_inds_problem ใน 73_dose_approval.sql) → null = ใช้ได้ */
export function indsProblem(inds) {
  if (!Array.isArray(inds) || !inds.length) return 'ต้องมีข้อบ่งใช้อย่างน้อย 1 ข้อ';
  const T = (x) => Number.isInteger(x) && x >= 1 && x <= 12;
  for (const [k, i] of inds.entries()) {
    const w = `ข้อบ่งใช้ ${k + 1}: `;
    if (!i || typeof i !== 'object') return w + 'รูปแบบข้อมูลไม่ถูกต้อง';
    if (!String(i.name || '').trim()) return w + 'ยังไม่มีชื่อข้อบ่งใช้';
    if (!['dose', 'day'].includes(i.per)) return w + 'ต้องระบุว่าเป็นขนาดต่อครั้งหรือต่อวัน';
    if (typeof i.min !== 'number' || typeof i.max !== 'number') return w + 'ต้องมีขนาดยาต่ำสุดและสูงสุดเป็นตัวเลข';
    if (i.min < 0) return w + 'ขนาดยาต้องไม่ติดลบ';
    if (i.max <= 0) return w + 'ขนาดยาสูงสุดต้องมากกว่า 0';
    if (i.max < i.min) return w + 'ขนาดสูงสุดต้องไม่น้อยกว่าขนาดต่ำสุด';
    if (i.per === 'day' && !T(i.times)) return w + 'ขนาดต่อวันต้องระบุจำนวนครั้งที่แบ่งให้ (1–12 ครั้ง)';
    if (i.times_alt != null && !(Array.isArray(i.times_alt) && i.times_alt.every(T))) return w + 'จำนวนครั้งแบบอื่นต้องเป็น 1–12';
    if (i.cap != null && !(typeof i.cap === 'number' && i.cap > 0)) return w + 'ขนาดสูงสุดต่อครั้งต้องเป็นตัวเลขมากกว่า 0';
    if (i.unit != null && !['mg', 'mcg'].includes(i.unit)) return w + 'หน่วยขนาดยาต้องเป็น มก. หรือ mcg';
  }
  return null;
}
function say(el, text, ok) { el.style.color = ok ? 'var(--success)' : 'var(--error)'; el.textContent = text; }

/* ======================= คำนวณโดสยา ======================= */
let drugs = [], editDrug = null, doseBound = false, pickDose = null;   // pickDose = Set id ข้อมูลคำนวณของยาที่เลือกด้านบน (admin-drugs.js · 'pcps:drugpick')
window.addEventListener('pcps:drugpick', (e) => { pickDose = e.detail ? new Set(e.detail.doseIds) : null; if (doseBound) { renderDrugs(); renderReview(); } });
const pickN = (k, n) => { const el = document.querySelector(`[data-adr-n="${k}"]`); if (el) el.textContent = pickDose ? `· ${n ? `พบ ${n} รายการ` : 'ไม่มีข้อมูลของยานี้'}` : ''; };

/** ข้อบ่งใช้ของยา — ยาเก่าที่ยังไม่มี indications ใช้ช่องเดิมเป็นข้อแรก */
export const indsOf = (d) => (d.indications?.length ? d.indications
  : [{ name: d.indication, per: d.per, min: d.mg_per_kg_min, max: d.mg_per_kg_max, times: d.dose_freq_per_day, cap: d.max_mg_per_dose, freq: d.freq, renal: d.renal_note }]);
/** หน่วยขนาดยา: mg (ค่าเริ่ม) หรือ mcg (ไมโครกรัม เช่น levothyroxine) */
export const unitTh = (i) => (i?.unit === 'mcg' ? 'mcg' : 'มก.');
/** ค่าต่อ กก. เป็น มก. สำหรับช่องเดิม (mg_per_kg_* · max_mg_per_dose) */
export const asMg = (i, v) => (v == null ? null : i?.unit === 'mcg' ? +(v / 1000).toFixed(6) : v);
/** จำนวนครั้งที่แบ่งให้ต่อวัน — เลือกได้หลายแบบ (times = แบบที่ 1 · times_alt = แบบอื่น เช่น วันละ 1 หรือ 3 ครั้ง) */
export const timesOf = (i) => [i.times, ...(i.times_alt || [])].map(Number).filter((n) => n >= 1);
const parseTimes = (t) => [...new Set(String(t).split(/[,\s/หรือ]+/).map((x) => +x).filter((n) => Number.isInteger(n) && n >= 1 && n <= 12))].slice(0, 4);
const perText = (i) => `${i.basis ? `[${i.basis}] ` : ''}${i.min ?? '?'}–${i.max ?? '?'} ${unitTh(i)}/กก./${i.per === 'day' ? 'วัน' + (timesOf(i).length ? ' แบ่ง ' + timesOf(i).join(' หรือ ') + ' ครั้ง' : '') : 'ครั้ง'}${i.cap ? ' · สูงสุด ' + i.cap + ` ${unitTh(i)}/ครั้ง` : ''}`;

function indBox(i = { per: 'dose' }, open = true) {
  const v = (k) => esc(i[k] ?? '');
  return `<details class="ind-box"${open ? ' open' : ''}><summary><span class="ind-sum"></span><button type="button" class="btn btn-no btn-sm" data-rmind>ลบ</button></summary><div class="form-grid">`
    + `<div class="field full"><label>ข้อบ่งใช้ <span class="req">*</span><input class="input i-name" maxlength="200" placeholder="เช่น ลดไข้" value="${v('name')}"></label></div>`
    + `<div class="field"><label>คิดจากสารสำคัญ (ยาสูตรผสม)<input class="input i-basis" maxlength="60" list="dfIngList" placeholder="ยาเดี่ยวเว้นว่าง · เช่น Trimethoprim" value="${v('basis')}"></label></div>`
    + `<div class="field"><label>หน่วยขนาดยา<select class="input i-unit"><option value="mg"${i.unit !== 'mcg' ? ' selected' : ''}>มก. (mg)</option><option value="mcg"${i.unit === 'mcg' ? ' selected' : ''}>ไมโครกรัม (mcg)</option></select></label></div>`
    + `<div class="field"><label>คิดขนาดยาแบบ<select class="input i-per"><option value="dose"${i.per !== 'day' ? ' selected' : ''}>ต่อ กก. ต่อครั้ง</option><option value="day"${i.per === 'day' ? ' selected' : ''}>ต่อ กก. ต่อวัน (แบ่งให้)</option></select></label></div>`
    + `<div class="field i-times-wrap"${i.per === 'day' ? '' : ' hidden'}><label>แบ่งให้วันละ (ครั้ง) · ได้หลายแบบ<input class="input i-times" inputmode="numeric" maxlength="20" placeholder="เช่น 1, 3" value="${esc(timesOf(i).join(', '))}"></label><span class="small muted">คั่นด้วย , เช่น 1, 3 = แบบที่ 1 วันละ 1 ครั้ง · แบบที่ 2 วันละ 3 ครั้ง</span></div>`
    + `<div class="field full ind-mm"><div class="field"><label>ขนาดต่ำสุด (ต่อ กก.) <span class="req">*</span><input class="input i-min" type="number" inputmode="decimal" min="0" step="0.01" value="${v('min')}"></label></div>`
    + `<div class="field"><label>ขนาดสูงสุด (ต่อ กก.) <span class="req">*</span><input class="input i-max" type="number" inputmode="decimal" min="0" step="0.01" value="${v('max')}"></label></div></div>`
    + `<div class="field"><label>เพดานต่อครั้ง (หน่วยเดียวกัน)<input class="input i-cap" type="number" inputmode="decimal" min="0" step="0.1" value="${v('cap')}"></label></div>`
    + `<div class="field"><label>ความถี่ (ข้อความ)<input class="input i-freq" maxlength="120" placeholder="เช่น ทุก 4–6 ชั่วโมง" value="${v('freq')}"></label></div>`
    + `<div class="field full"><label>ขนาดยาในโรคไต<textarea class="i-renal" rows="2" maxlength="1000">${v('renal')}</textarea></label></div>`
    + srcBlock(i) + '</div></details>';
}
/** ที่มาของข้อบ่งใช้ที่ AI กรอกให้: ข้อความจากฉลาก (quote) + อ้างอิงพร้อมลิงก์ (ref) · เก็บไว้กับข้อบ่งใช้แม้ผู้ดูแลแก้ตัวเลข */
export function refOfLabel(lab) {
  if (!lab) return null;
  const e = /^\d{8}$/.test(lab.effective || '') ? ` ฉบับ ${+lab.effective.slice(6, 8)}/${+lab.effective.slice(4, 6)}/${lab.effective.slice(0, 4)}` : '';
  const name = lab.brand || lab.generic || '';
  return { label: `ฉลากยาสหรัฐฯ (US FDA) ${name}${e}`.trim().slice(0, 200),
    url: lab.set_id ? `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${encodeURIComponent(lab.set_id)}` : `https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=${encodeURIComponent(lab.generic || name)}` };
}
const safeUrl = (u) => (/^https:\/\//.test(String(u || '')) ? String(u) : '');
function srcBlock(i) {
  if (!i.quote && !i.ref) return '';
  const ref = i.ref || {};
  return `<div class="full ai-src"><span class="chip c-fix">AI กรอกให้ · ตรวจกับต้นฉบับก่อนบันทึก</span>`
    + (i.quote ? `<p class="small dh-quote">ข้อความจากฉลาก: “${esc(i.quote)}”</p>` : '')
    + (ref.label ? `<p class="small">อ้างอิง: ${safeUrl(ref.url) ? `<a href="${esc(safeUrl(ref.url))}" target="_blank" rel="noopener">${esc(ref.label)}</a>` : esc(ref.label)}</p>` : '')
    + `<input type="hidden" class="i-quote" value="${esc(i.quote || '')}"><input type="hidden" class="i-ref" value="${esc(i.ref ? JSON.stringify(i.ref) : '')}"></div>`;
}
function syncIndBoxes(root = $('#dfInds')) {
  root.querySelectorAll('.ind-box').forEach((b, k) => {
    const g = (c) => b.querySelector(c).value;
    b.querySelector('.i-times-wrap').hidden = g('.i-per') !== 'day';
    b.querySelector('.ind-sum').textContent = `ข้อบ่งใช้ ${k + 1}: ${g('.i-name').trim() || '(ยังไม่ระบุ)'} · ${perText({ basis: g('.i-basis').trim(), unit: g('.i-unit'), per: g('.i-per'), min: g('.i-min') || null, max: g('.i-max') || null, times: parseTimes(g('.i-times'))[0] || null, times_alt: parseTimes(g('.i-times')).slice(1), cap: g('.i-cap') || null })}`;
  });
}
function readInds(root = $('#dfInds')) {
  const out = [];
  root.querySelectorAll('.ind-box').forEach((b, k) => {
    const g = (c) => b.querySelector(c).value.trim(), n = `ข้อบ่งใช้ ${k + 1}`;
    const i = { name: g('.i-name'), basis: g('.i-basis') || null, unit: g('.i-unit') === 'mcg' ? 'mcg' : null, per: g('.i-per'), min: num(g('.i-min')), max: num(g('.i-max')), times: parseTimes(g('.i-times'))[0] ?? null, times_alt: parseTimes(g('.i-times')).slice(1), cap: num(g('.i-cap')), freq: g('.i-freq') || null, renal: g('.i-renal') || null };
    const bad = (t) => { b.open = true; throw new Error(`${n}: ${t}`); };
    if (!i.name) bad('กรุณาใส่ชื่อข้อบ่งใช้');
    if (i.min == null || i.max == null || i.min < 0) bad('กรุณาใส่ขนาดยาต่ำสุดและสูงสุด (ต่อ กก.)');
    if (i.max < i.min) bad('ขนาดสูงสุดต้องไม่น้อยกว่าขนาดต่ำสุด');
    if (i.per === 'day' && !(i.times >= 1)) bad('ยาแบบ "ต่อวัน" ต้องระบุจำนวนครั้งที่แบ่งให้ต่อวัน');
    if (i.per !== 'day' || !i.times_alt.length) i.times_alt = null;
    if (i.per !== 'day') i.times = null;
    const q = b.querySelector('.i-quote')?.value.trim(), r = b.querySelector('.i-ref')?.value;   // ที่มาจาก AI (เก็บไว้ให้ตรวจย้อนหลัง)
    if (q) i.quote = q.slice(0, 400);
    if (r) { try { const o = JSON.parse(r); if (o?.label) i.ref = { label: String(o.label).slice(0, 200), url: safeUrl(o.url).slice(0, 300) }; } catch { /* ไม่เป็นไร */ } }
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
    $('#dfInds').addEventListener('input', () => syncIndBoxes());
    $('#dfInds').addEventListener('change', () => syncIndBoxes());
    $('#dfReview').addEventListener('click', onReview);
    $('#dfReview').addEventListener('submit', (e) => { e.preventDefault(); saveReview(e.target); });
    ['input', 'change'].forEach((ev) => $('#dfReview').addEventListener(ev, (e) => { const b = e.target.closest('.r-inds'); if (b) syncIndBoxes(b); }));
    $('#dfAddConc').addEventListener('click', () => { $('#dfConcs').insertAdjacentHTML('beforeend', concRow()); $('#dfConcs .med-row:last-child input').focus(); });
    $('#dfConcs').addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) e.target.closest('.med-row').remove(); });
    $('#dfHelpBtn').addEventListener('click', runDoseHelp);
    $('#dfBulkMake').addEventListener('click', makeBulk);
    $('#dfBulkAi').addEventListener('click', bulkAi);
    $('#dfBulkStop').addEventListener('click', () => { bulkStop = true; });
    $('#dfBulkClear').addEventListener('click', () => { if (confirm('ล้างรายการยาที่รอเพิ่มทั้งหมด?')) { bulk = []; bulkCur = -1; saveBulk(); renderBulk(); } });
    $('#dfBulkList').addEventListener('click', onBulk);
    loadBulk();
    $('#dfHelpOut').addEventListener('click', onHelpOut);
    $('#dfCancel').addEventListener('click', resetDrugForm);
    $('#dfForm').addEventListener('submit', saveDrug);
    $('#dfList').addEventListener('click', onDrugList);
    ['#dfQ', '#dfFForm', '#dfSortBy'].forEach((s) => $(s).addEventListener(s === '#dfQ' ? 'input' : 'change', renderDrugs));
    resetDrugForm();
  }
  await reloadDrugs();
}

/* ---- เพิ่มหลายรายการ: วางรายชื่อยายาว ๆ → คิว (จำในเครื่องนี้ localStorage 'pcps_dose_queue') → เปิดทีละตัวในฟอร์ม + ช่วยกรอกให้ → บันทึกแล้วไปตัวถัดไป ---- */
const BULK_KEY = 'pcps_dose_queue';
let bulk = [], bulkCur = -1;   // [{ name, st: 'wait'|'done'|'skip' }]
const keyOf = (s) => String(s).toLowerCase().replace(/\s+/g, '');
const hasDrug = (name) => { const k = keyOf(name), en = doseQuery(name); return drugs.some((d) => keyOf(d.name) === k || (en && doseQuery(d.name) === en)); };
function loadBulk() { try { bulk = JSON.parse(localStorage.getItem(BULK_KEY) || '[]').filter((x) => x && x.name).map((x) => (x.st === 'busy' ? { ...x, st: 'wait' } : x)); } catch { bulk = []; } renderBulk(); }
function saveBulk() { try { localStorage.setItem(BULK_KEY, JSON.stringify(bulk)); } catch { /* ไม่เป็นไร */ } }
/** รายชื่อในช่อง → เพิ่มเข้าคิว (ตัดเลขข้อ/ซ้ำ · ยาที่มีแล้ว = ข้าม) */
function addToQueue() {
  const names = [...new Set($('#dfBulk').value.split(/\r?\n/).map((l) => l.replace(/^\s*(?:\d+[.)]\s*|[-•*]\s*)/, '').trim()).filter(Boolean))].slice(0, 200);
  if (!names.length) { if (bulk.some((x) => x.st === 'wait')) return true; toast('กรุณาวางรายชื่อยา บรรทัดละ 1 ยา', 'err'); $('#dfBulk').focus(); return false; }
  const have = new Set(bulk.map((x) => keyOf(x.name)));
  names.filter((n) => !have.has(keyOf(n))).forEach((name) => bulk.push({ name, st: hasDrug(name) ? 'skip' : 'wait', dup: hasDrug(name) }));
  $('#dfBulk').value = ''; saveBulk(); renderBulk();
  return true;
}
function makeBulk() {
  if (!addToQueue()) return;
  const next = bulk.findIndex((x) => x.st === 'wait');
  if (next >= 0) openBulk(next); else toast('ยาทุกตัวมีในรายการแล้ว');
}
function renderBulk() {
  const left = bulk.filter((x) => x.st === 'wait' || x.st === 'nodata').length, done = bulk.filter((x) => x.st === 'done' || x.st === 'draft').length;
  $('#dfBulkN').textContent = bulk.length ? `รอเพิ่ม ${left} · เพิ่มแล้ว ${done} · ทั้งหมด ${bulk.length}` : '';
  $('#dfBulkClear').hidden = !bulk.length;
  $('#dfBulkList').innerHTML = bulk.map((x, i) => `<div class="li${i === bulkCur ? ' df-bulk-cur' : ''}"><div class="l"><b>${esc(x.name)}</b>`
    + `<span class="small ${x.st === 'done' || x.st === 'draft' ? 'ok-text' : x.st === 'nodata' ? 'ai-err' : 'muted'}">${x.st === 'done' ? '✓ เพิ่มแล้ว' : x.st === 'draft' ? '✓ เก็บเป็นร่างแล้ว · รอตรวจในรายการยา' : x.st === 'nodata' ? esc(x.note || 'AI ไม่พบขนาดยา · กรอกเอง') : x.st === 'busy' ? 'AI กำลังดึงข้อมูล…' : x.dup ? 'มีในรายการยาแล้ว · ข้าม' : x.st === 'skip' ? 'ข้าม' : i === bulkCur ? 'กำลังกรอกในฟอร์มด้านล่าง' : 'รอเพิ่ม'}</span></div>`
    + (['done', 'draft', 'busy'].includes(x.st) ? '' : `<div class="row-btns"><button type="button" class="btn btn-o btn-sm" data-bulk-open="${i}">เปิดในฟอร์ม</button>${x.st === 'wait' ? `<button type="button" class="btn btn-o btn-sm" data-bulk-skip="${i}">ข้าม</button>` : ''}</div>`)
    + '</div>').join('');
}
function openBulk(i) {
  const x = bulk[i]; if (!x) return;
  if (location.hash !== '#/admin/drugs/dose') location.hash = '#/admin/drugs/dose';   // ฟอร์มกรอกทีละตัวอยู่ในแท็บคำนวณขนาดยา
  resetDrugForm(); bulkCur = i; renderBulk();
  $('#dfName').value = x.name;
  $('#dfForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (doseQuery(x.name).length >= 2) runDoseHelp();   // มีชื่อภาษาอังกฤษ = ช่วยกรอกจากฐานข้อมูลให้เลย
}
function onBulk(e) {
  const o = e.target.closest('[data-bulk-open]'), s = e.target.closest('[data-bulk-skip]');
  if (o) { const i = +o.dataset.bulkOpen; if (bulk[i].st === 'skip' || bulk[i].st === 'nodata') bulk[i].st = 'wait'; saveBulk(); openBulk(i); return; }
  if (s) { const i = +s.dataset.bulkSkip; bulk[i].st = 'skip'; if (bulkCur === i) bulkCur = -1; saveBulk(); renderBulk(); }
}
/** ให้ AI ดึงข้อมูลยาทุกตัวในคิว → บันทึกเป็นร่างที่ซ่อนไว้ (ai_draft · 56_dose_ai_drafts.sql) · ทำทีละตัว · กดหยุดได้ */
let bulkStop = false, bulkRunning = false;
async function aiDose(q) {
  const { data: id, error } = await sb.rpc('ai_dose_start', { p_name: q });
  if (error) throw error;
  let r = { status: 'pending' };
  for (let i = 0; r.status === 'pending' && i < 80; i++) {
    if (i) await new Promise((ok) => setTimeout(ok, 2500));
    const { data, error: e2 } = await sb.rpc('ai_dose_poll', { p_id: id });
    if (e2) throw e2;
    r = data;
  }
  return r;
}
/** ผลจากฐานข้อมูลยา → แถว dose_drugs (ร่าง · ซ่อน) · ไม่มีขนาดยา มก./กก. = null */
export function draftRow(name, r, sort) {
  const res = r.result || {}, ai = (res.ai || []).filter((i) => i.name && i.min != null && i.max != null && +i.max >= +i.min);
  if (!ai.length) return null;
  const seen = new Set(), concs = (res.rx || []).map(rxConc).filter((c) => c && !seen.has(c.label) && seen.add(c.label));
  const ref = refOfLabel(res.label);
  const inds = ai.slice(0, 20).map((i) => Object.fromEntries(Object.entries({ ...i, times: i.per === 'day' ? i.times : null, ref }).filter(([, v]) => v != null && v !== '')));
  const f = inds[0], lab = res.label || {};
  return {
    name: String(name).slice(0, 120), form: !concs.length ? 'อื่น ๆ' : concs.every((c) => c.mgPerTab != null) ? 'ยาเม็ด' : concs.every((c) => c.mgPerTab == null) ? 'ยาน้ำ' : 'อื่น ๆ',
    indications: inds, indication: f.name, per: f.per, mg_per_kg_min: asMg(f, f.min), mg_per_kg_max: asMg(f, f.max), dose_freq_per_day: f.times ?? null, max_mg_per_dose: asMg(f, f.cap ?? null), freq: f.freq ?? null, renal_note: f.renal ?? null,
    concs, sort, active: false, ai_draft: true,
    ai_source: `AI ร่างจากฉลากยา openFDA${lab.brand ? ' ' + lab.brand : ''}${lab.effective ? ' ฉบับ ' + lab.effective : ''} + ความแรงจาก RxNorm · ยังไม่ผ่านการตรวจ`.slice(0, 500),
  };
}
async function bulkAi() {
  if (bulkRunning) return;
  if (!addToQueue()) return;
  const todo = bulk.map((x, i) => i).filter((i) => bulk[i].st === 'wait');
  if (!todo.length) { toast('ไม่มียาที่รอเพิ่ม', 'err'); return; }
  bulkRunning = true; bulkStop = false;
  const btn = $('#dfBulkAi'), msg = $('#dfBulkMsg'); busy(btn, true, 'AI กำลังดึงข้อมูล…'); $('#dfBulkStop').hidden = false;
  let saved = 0, miss = 0;
  try {
    for (const [k, i] of todo.entries()) {
      if (bulkStop) break;
      const x = bulk[i], q = x.q || doseQuery(x.name);
      msg.style.color = ''; msg.textContent = `กำลังทำ ${k + 1}/${todo.length}: ${x.name}`;
      if (q.length < 2) { Object.assign(x, { st: 'nodata', note: 'ไม่มีชื่อภาษาอังกฤษ · กรอกเอง' }); miss++; saveBulk(); renderBulk(); continue; }
      x.st = 'busy'; renderBulk();
      try {
        const r = await aiDose(q);
        const row = r.status === 'done' ? draftRow(x.name, r, nextSort() + k) : null;
        if (!row) { Object.assign(x, { st: 'nodata', note: r.note || 'ฉลากยาไม่มีขนาดยาแบบ มก./กก. · กรอกเอง' }); miss++; }
        else {
          const { error } = await sb.from('dose_drugs').insert(row);
          if (error) throw error;
          x.st = 'draft'; saved++;
        }
      } catch (err) {
        Object.assign(x, { st: 'nodata', note: errText(err) }); miss++;
        if (/ครบ \d+ ครั้ง|ไม่มีสิทธิ์|ยังไม่พร้อม/.test(errText(err))) { saveBulk(); renderBulk(); break; }
      }
      saveBulk(); renderBulk();
    }
  } finally {
    busy(btn, false); $('#dfBulkStop').hidden = true; bulkRunning = false;
    msg.style.color = saved ? 'var(--success)' : 'var(--error)';
    msg.textContent = `เก็บเป็นร่างแล้ว ${saved} ยา${miss ? ` · ทำไม่ได้ ${miss} ยา (กด "เปิดในฟอร์ม" เพื่อกรอกเอง)` : ''}${bulkStop ? ' · หยุดแล้ว' : ''} · ร่างยังไม่แสดงในเครื่องคำนวณ ตรวจแล้วกด "ตรวจแล้ว · แสดง" ในรายการยา`;
    resetDose(); await reloadDrugs();
  }
}

/** บันทึกยาสำเร็จ → ยาตัวในคิวที่เปิดอยู่ = เพิ่มแล้ว → เปิดตัวถัดไป */
function bulkSaved() {
  if (bulkCur < 0 || !bulk[bulkCur]) return;
  bulk[bulkCur].st = 'done'; bulkCur = -1; saveBulk();
  const next = bulk.findIndex((x) => x.st === 'wait');
  if (next >= 0) { toast(`ไปยาตัวถัดไป: ${bulk[next].name}`); openBulk(next); } else { renderBulk(); toast('เพิ่มยาครบทุกตัวในรายการแล้ว'); }
}

/* ---- ช่วยกรอกจากฐานข้อมูลยา (50_ai_dose.sql): RxNorm = ความแรง · ฉลากยา openFDA → AI ร่างขนาดยา มก./กก. · ผู้ดูแลเลือกใส่ฟอร์มแล้วตรวจเองก่อนบันทึก ---- */
const SPIN = '<span class="spin" aria-hidden="true"></span>';
// ชื่อสามัญแบบไทย/อังกฤษ → ชื่อที่ฐานข้อมูลสหรัฐฯ ใช้
const US_NAME = { paracetamol: 'acetaminophen', salbutamol: 'albuterol', adrenaline: 'epinephrine', noradrenaline: 'norepinephrine', frusemide: 'furosemide', lignocaine: 'lidocaine', glibenclamide: 'glyburide', 'chlorpheniramine maleate': 'chlorpheniramine' };
/** ชื่อภาษาอังกฤษในชื่อยา เช่น "พาราเซตามอล (Paracetamol)" → "acetaminophen" */
export function doseQuery(name) {
  // ใช้ชื่ออังกฤษส่วนแรก (นอกวงเล็บ) ก่อน เช่น "Levothyroxine sodium (L-thyroxine sodium)" → "levothyroxine sodium"
  //   ชื่อไทยนำหน้า → ใช้ชื่อในวงเล็บ เช่น "พาราเซตามอล (Paracetamol)" → "acetaminophen"
  const outer = String(name).replace(/\([^()]*\)/g, ' '), inner = (String(name).match(/\(([^()]*)\)/) || [])[1] || '';
  const pick = /[A-Za-z]/.test(outer) ? outer : inner || String(name);
  const q = (pick.match(/[A-Za-z][A-Za-z0-9 .,+\-/]*/g) || []).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return US_NAME[q] || q;
}
/** ชื่อยาจาก RxNorm → แถวความแรง เช่น "amoxicillin 250 MG/5ML Oral Suspension" → { label: 'ยาน้ำ 250 มก./5 มล.', mgPer5ml: 250 } */
export function rxConc(name) {
  const m = String(name).match(/(\d+(?:\.\d+)?)\s*MG(?:\s*\/\s*(\d+(?:\.\d+)?)?\s*ML)?/i);
  if (!m || (String(name).match(/\d\s*MG/gi) || []).length > 1) return null;   // ยาสูตรผสม: กรอกเอง
  if (/topical|inject|ophthalmic|otic|nasal|rectal|vaginal|inhal|transdermal|cream|ointment|gel|paste|patch/i.test(name)) return null;   // เครื่องคำนวณใช้ยากิน
  const mg = +m[1], ml = m[0].toUpperCase().includes('ML') ? +(m[2] || 1) : null;
  if (ml) return ml === 5 ? { label: `ยาน้ำ ${mg} มก./5 มล.`, mgPer5ml: mg } : { label: `ยาน้ำ ${mg} มก./${ml === 1 ? '' : ml + ' '}มล.`, mgPerMl: +(mg / ml).toFixed(3) };
  if (/tablet|capsule/i.test(name)) return { label: `${/capsule/i.test(name) ? 'แคปซูล' : 'เม็ด'} ${mg} มก.`, mgPerTab: mg };
  return null;
}
let help = null;
async function runDoseHelp() {
  const out = $('#dfHelpOut'), btn = $('#dfHelpBtn'), q = doseQuery($('#dfName').value);
  if (q.length < 2) { out.innerHTML = '<p class="small ai-err">กรุณาพิมพ์ชื่อยาที่มีชื่อสามัญภาษาอังกฤษก่อน เช่น อะม็อกซีซิลลิน (Amoxicillin)</p>'; $('#dfName').focus(); return; }
  busy(btn, true, 'กำลังค้นข้อมูลยา…');
  out.innerHTML = `<p class="small muted">${SPIN}ค้น "${esc(q)}" ใน RxNorm และฉลากยา openFDA แล้วให้ AI ร่างขนาดยา (ประมาณ 10–60 วินาที)</p>`;
  try {
    const { data: id, error } = await sb.rpc('ai_dose_start', { p_name: q });
    if (error) throw error;
    let r = { status: 'pending' };
    for (let i = 0; r.status === 'pending' && i < 80; i++) {
      if (i) await new Promise((ok) => setTimeout(ok, 2500));
      const { data, error: e2 } = await sb.rpc('ai_dose_poll', { p_id: id });
      if (e2) throw e2;
      r = data;
    }
    if (r.status === 'pending') r = { status: 'error', note: 'หมดเวลารอ กรุณาลองใหม่' };
    help = r; renderHelp();
  } catch (err) { out.innerHTML = `<p class="small ai-err">${esc(errText(err))}</p>`; }
  finally { busy(btn, false); }
}
function renderHelp() {
  const r = help, out = $('#dfHelpOut');
  if (r.status === 'error') { out.innerHTML = `<p class="small ai-err">${esc(r.note || 'ค้นข้อมูลยาไม่สำเร็จ')}</p>`; return; }
  const res = r.result || {}, lab = res.label || null, ai = res.ai || [];
  const rx = (res.rx || []).map((n) => ({ n, c: rxConc(n) })).filter((x) => x.c);
  const seen = new Set(), concs = rx.filter((x) => { const k = x.c.label; if (seen.has(k)) return false; seen.add(k); return true; });
  out.innerHTML = '<div class="dh-box">'
    + `<p class="small"><a href="https://dailymed.nlm.nih.gov/dailymed/search.cfm?labeltype=all&query=${encodeURIComponent(help.query || $('#dfName').value)}" target="_blank" rel="noopener">ค้นฉลากยาเต็มใน DailyMed</a> (ฉลากชุดเดียวกับ openFDA · เปิดอ่านเอง)</p>`
    + `<p class="small">ที่มา: RxNorm (NLM)${lab ? ` · ฉลากยา openFDA${lab.brand ? ' ' + esc(lab.brand) : ''}${lab.effective ? ' ฉบับ ' + esc(lab.effective.replace(/^(\d{4})(\d\d)(\d\d)$/, '$3/$2/$1')) : ''} (สหรัฐฯ)` : ''} · <b>ตัวเลขเป็นร่าง ต้องตรวจกับเอกสารอ้างอิงก่อนบันทึก</b></p>`
    + (r.note ? `<p class="small ai-err">${esc(r.note)}</p>` : '')
    + (concs.length ? `<h3>ความแรงจาก RxNorm</h3><div class="dh-pick" id="dfHelpConcs">${concs.map((x, k) => `<label><input type="checkbox" value="${k}"> <span>${esc(x.c.label)} <span class="small muted">${esc(x.n)}</span></span></label>`).join('')}</div>`
      + '<div><button type="button" class="btn btn-o btn-sm" data-help="conc">ใส่ความแรงที่เลือกลงฟอร์ม</button></div>' : '')
    + (ai.length ? `<h3>ขนาดยาที่ AI ร่างจากฉลาก</h3><div class="dh-pick" id="dfHelpInds">${ai.map((i, k) => `<label><input type="checkbox" value="${k}" checked> <span><b>${esc(i.name)}</b> · ${esc(perText(i))}${i.freq ? ' · ' + esc(i.freq) : ''}${i.renal ? `<span class="small muted"> · โรคไต: ${esc(i.renal)}</span>` : ''}`
      + `${i.quote ? `<span class="small muted dh-quote">“${esc(i.quote)}”</span>` : ''}</span></label>`).join('')}</div>`
      + '<div><button type="button" class="btn btn-o btn-sm" data-help="ind">ใส่ข้อบ่งใช้ที่เลือกลงฟอร์ม</button></div>' : '')
    + ((res.ai_rejected || []).length ? `<details class="dh-rej" data-ai-rejected><summary class="small">AI ตอบแต่ตรวจกับฉลากไม่ผ่าน ${res.ai_rejected.length} ข้อ · ไม่ใช้</summary><ul class="small">${res.ai_rejected.map((i) => `<li><b>${esc(i.name || '-')}</b> · ${esc(perText(i))} — <span class="ai-err">${esc(i.why || '')}</span>${i.quote ? ` <span class="muted">“${esc(i.quote)}”</span>` : ''}</li>`).join('')}</ul></details>` : '')
    + (lab?.dosage ? `<details><summary class="small">ข้อความขนาดยาจากฉลากต้นฉบับ (ภาษาอังกฤษ)</summary><p class="dh-label">${esc(lab.dosage)}</p></details>` : '')
    + '</div>';
  help.concs = concs;
}
function onHelpOut(e) {
  const b = e.target.closest('[data-help]'); if (!b || !help) return;
  const picked = (box) => [...document.querySelectorAll(`${box} input:checked`)].map((x) => +x.value);
  if (b.dataset.help === 'conc') {
    const add = picked('#dfHelpConcs').map((k) => help.concs[k].c);
    if (!add.length) { say($('#dfMsg'), 'กรุณาติ๊กความแรงที่ต้องการก่อน'); return; }
    document.querySelectorAll('#dfConcs .med-row').forEach((r) => { if (!r.querySelector('.c-label').value.trim() && !r.querySelector('.c-mg').value) r.remove(); });
    const have = new Set([...document.querySelectorAll('#dfConcs .c-label')].map((x) => x.value.trim()));
    add.filter((c) => !have.has(c.label)).forEach((c) => $('#dfConcs').insertAdjacentHTML('beforeend', concRow(c)));
    if (add.every((c) => c.mgPerTab != null)) $('#dfForm2').value = 'ยาเม็ด'; else if (add.every((c) => c.mgPerTab == null)) $('#dfForm2').value = 'ยาน้ำ';
    say($('#dfMsg'), `ใส่ความแรง ${add.length} รายการแล้ว · ตรวจก่อนกดบันทึก`, true);
  } else {
    const ref = refOfLabel(help.result.label);
    const add = picked('#dfHelpInds').map((k) => ({ ...help.result.ai[k], ref }));
    if (!add.length) { say($('#dfMsg'), 'กรุณาติ๊กข้อบ่งใช้ที่ต้องการก่อน'); return; }
    const boxes = document.querySelectorAll('#dfInds .ind-box');
    if (boxes.length === 1 && !boxes[0].querySelector('.i-name').value.trim() && !boxes[0].querySelector('.i-min').value) boxes[0].remove();   // กล่องว่างเริ่มต้น
    add.forEach((i) => $('#dfInds').insertAdjacentHTML('beforeend', indBox(i)));
    syncIndBoxes();
    say($('#dfMsg'), `ใส่ข้อบ่งใช้ ${add.length} ข้อแล้ว · ตรวจตัวเลขก่อนกดบันทึก`, true);
  }
}

function concRow(c = {}) {
  const type = c.mgPerTab != null ? 'tablet' : c.mgPerMl != null ? 'ml' : 'liquid';
  return `<div class="med-row"><input class="input c-label" maxlength="80" placeholder="เช่น ยาน้ำ 120 มก./5 มล." value="${esc(c.label || '')}" aria-label="ชื่อความแรง">`
    + `<input class="input c-mg" type="number" inputmode="decimal" min="0" step="0.01" placeholder="มก." value="${esc(c.mgPerTab ?? c.mgPerMl ?? c.mgPer5ml ?? '')}" aria-label="ปริมาณยา (มก.)">`
    + `<select class="input c-type" aria-label="รูปแบบ">${[['liquid', 'มก./5 มล.'], ['ml', 'มก./มล.'], ['tablet', 'มก./เม็ด']].map(([k, l]) => `<option value="${k}"${type === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`
    + '<button type="button" class="btn btn-o btn-sm" data-rm aria-label="ลบความแรงนี้">ลบ</button></div>';
}

function readConcs(root = $('#dfConcs')) {
  const out = [];
  for (const r of root.querySelectorAll('.med-row')) {
    const label = r.querySelector('.c-label').value.trim(), mg = num(r.querySelector('.c-mg').value);
    if (!label && mg == null) continue;
    if (!label || !(mg > 0)) throw new Error('ความแรงของยาต้องมีทั้งชื่อและปริมาณ (มก.) มากกว่า 0');
    const t = r.querySelector('.c-type').value;
    out.push(t === 'tablet' ? { label, mgPerTab: mg } : t === 'ml' ? { label, mgPerMl: mg } : { label, mgPer5ml: mg });
  }
  return out;
}

async function reloadDrugs() {
  parkForm($('#dfForm'));   // ฟอร์มที่ขยายอยู่ใต้รายการต้องย้ายออกก่อนล้างรายการ (ไม่งั้นฟอร์มหายไปด้วย)
  $('#dfList').innerHTML = '<div class="skeleton"></div>';
  const { data, error } = await sb.from('dose_drugs').select('*, approver:profiles!dose_drugs_approved_by_fkey(full_name)').order('sort').order('name');
  if (error) { $('#dfList').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
  drugs = data;
  renderDrugs(); renderReview();
  if (!editDrug && !$('#dfName').value) $('#dfSort').value = nextSort();
}

/** ค้นหาชื่อ/ข้อบ่งใช้ · กรองรูปแบบยา · เรียงตามลำดับที่ตั้งไว้ หรือตามตัวอักษร */
function renderDrugs() {
  const q = $('#dfQ').value.trim().toLowerCase(), f = $('#dfFForm').value, sort = $('#dfSortBy').value;
  const picked = pickDose && drugs.filter((d) => pickDose.has(d.id));
  const list = picked ? (picked.some((d) => !d.ai_draft) ? [picked.find((d) => !d.ai_draft)] : picked.slice(0, 1)) : drugs.filter((d) => (f === 'all' || (d.form || 'อื่น ๆ') === f)
    && (!q || `${d.name} ${indsOf(d).map((i) => i.name || '').join(' ')}`.toLowerCase().includes(q)));
  pickN('dose', list.length);
  if (sort !== 'order') list.sort((a, b) => a.name.localeCompare(b.name, 'th') * (sort === 'asc' ? 1 : -1));
  $('#dfCount').textContent = list.length === drugs.length ? `(${drugs.length})` : `(${list.length} จาก ${drugs.length})`;
  parkForm($('#dfForm'));
  $('#dfList').innerHTML = !drugs.length ? '<p class="empty">ยังไม่มีรายการยา</p>' : !list.length ? `<p class="empty">${pickDose ? 'ยานี้ยังไม่มีข้อมูลคำนวณขนาดยา · เพิ่มได้จากฟอร์มด้านบน' : 'ไม่พบยาที่ค้นหา'}</p>` : list.map((d) => `<div class="li"><div class="l"><b>${esc(d.name)} <span class="chip c-off">${esc(d.form || 'อื่น ๆ')}</span></b>`
    + indsOf(d).map((i) => `<span class="small muted">${esc(i.name || 'ข้อบ่งใช้')}: ${esc(perText(i))}</span>`).join('')
    + `<span class="small muted">${indsOf(d).length} ข้อบ่งใช้ · ${(d.concs || []).length} ความแรง · ลำดับ ${d.sort}</span>`
    + (d.ai_draft && d.ai_source ? `<span class="small muted">${esc(d.ai_source)}</span>` : '')
    + (d.approved_at ? `<span class="small muted" data-approved>ตรวจ/อนุมัติ: ${esc(d.approver?.full_name || 'ผู้ดูแล')} · ${esc(thaiDateTime(d.approved_at))}</span>` : '')
    + (() => { const why = d.ai_draft ? (d.draft_issue || indsProblem(indsOf(d))) : indsProblem(indsOf(d)); return why ? `<span class="small fx-warn" data-inds-problem>${d.ai_draft ? 'ต้องแก้ก่อนอนุมัติ' : 'ข้อมูลขนาดยาไม่ครบ'}: ${esc(why)} · กด${d.ai_draft ? '"ตรวจ/แก้ไข"' : 'แก้ไข'}เพื่อแก้</span>` : ''; })()
    + (d.ai_draft ? '<span class="small muted">ร่างจาก AI: กด "ตรวจ/แก้ไข" ตรวจตัวเลขกับเอกสารอ้างอิง แล้วกดบันทึก = อนุมัติ</span>' : '')
    + `<div class="meta"><span class="chip ${d.active ? 'c-on' : 'c-off'}">${d.active ? 'แสดงอยู่' : 'ซ่อน'}</span>${d.ai_draft ? '<span class="chip c-fix">AI ร่าง · รอตรวจ</span>' : ''}</div></div>`
    + `<div class="actions"><button type="button" class="btn btn-o btn-sm" data-edit="${d.id}">${d.ai_draft ? 'ตรวจ/แก้ไข' : 'แก้ไข'}</button>`
    + (d.ai_draft ? '' : `<button type="button" class="btn btn-o btn-sm" data-toggle="${d.id}">${d.active ? 'ซ่อน' : 'แสดง'}</button>`)
    + `<button type="button" class="btn btn-no btn-sm" data-del="${d.id}">ลบ</button></div></div>`).join('');
  keepForm($('#dfForm'), $('#dfList'), editDrug && `[data-edit="${editDrug.id}"]`);
}
const nextSort = () => (drugs.length ? Math.max(...drugs.map((d) => d.sort)) + 1 : 0);

function resetDrugForm() {
  editDrug = null; parkForm($('#dfForm'));
  $('#dfForm').reset();
  $('#dfConcs').innerHTML = concRow();
  $('#dfInds').innerHTML = indBox(); syncIndBoxes();
  $('#dfSort').value = nextSort();
  $('#dfTitle').textContent = 'เพิ่มรายการยา';
  $('#dfSubmit').textContent = 'เพิ่มยา';
  $('#dfCancel').hidden = true;
  $('#dfHelpOut').innerHTML = ''; help = null;
  say($('#dfMsg'), '');
}

function startEditDrug(d) {
  if (isOpenAt($('#dfForm'), $('#dfList'), `[data-edit="${d.id}"]`)) { closeForm($('#dfForm'), true, resetDrugForm); return; }   // กดแก้ไขซ้ำ = ย่อ
  editDrug = d;
  $('#dfName').value = d.name; $('#dfForm2').value = d.form || 'อื่น ๆ';
  const inds = indsOf(d);
  $('#dfInds').innerHTML = inds.map((i) => indBox(i, inds.length <= 3)).join(''); syncIndBoxes();
  $('#dfSort').value = d.sort; $('#dfActive').checked = d.active;
  $('#dfConcs').innerHTML = (d.concs || []).map(concRow).join('') || concRow();
  $('#dfTitle').textContent = 'แก้ไข: ' + d.name;
  $('#dfSubmit').textContent = d.ai_draft ? 'ตรวจแล้ว · บันทึก (อนุมัติ)' : 'บันทึกการแก้ไข';
  $('#dfCancel').hidden = false;
  say($('#dfMsg'), '');
  showForm($('#dfForm'), $('#dfList'), `[data-edit="${d.id}"]`, $('#dfName'));   // ขยายใต้ยาที่กด
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
    name, form: $('#dfForm2').value, indications: inds, indication: f.name, per: f.per, mg_per_kg_min: asMg(f, f.min), mg_per_kg_max: asMg(f, f.max),
    dose_freq_per_day: f.times ?? null, max_mg_per_dose: asMg(f, f.cap ?? null), freq: f.freq ?? null, renal_note: f.renal ?? null,
    concs, sort: num($('#dfSort').value) ?? 0, active: $('#dfActive').checked, ai_draft: false,   // บันทึกผ่านฟอร์ม = ผู้ดูแลตรวจแล้ว
  };
  const btn = $('#dfSubmit'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = editDrug ? await sb.from('dose_drugs').update(row).eq('id', editDrug.id) : await sb.from('dose_drugs').insert(row);
  busy(btn, false);
  if (error) { say(m, errText(error)); return; }
  toast(editDrug?.ai_draft ? 'ตรวจแล้ว · อนุมัติแล้ว' : editDrug ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มยาแล้ว');
  const fromBulk = !editDrug && bulkCur >= 0;
  resetDose();
  await reloadDrugs();
  if (fromBulk) { const i = bulkCur; resetDrugForm(); bulkCur = i; bulkSaved(); } else resetDrugForm();
}

async function onDrugList(e) {
  const b = e.target.closest('button'); if (!b) return;
  const d = drugs.find((x) => String(x.id) === (b.dataset.edit || b.dataset.toggle || b.dataset.del)); if (!d) return;
  if (b.dataset.edit) return startEditDrug(d);
  if (b.dataset.toggle && d.ai_draft) return startEditDrug(d);   // ร่าง AI อนุมัติผ่านฟอร์มตรวจเท่านั้น (audit F-04)
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

/* ---- ร่างขนาดยาจาก AI รอตรวจ (63_ai_auto.sql: ระบบร่างให้ยารับประทานของ รพ.สต. เองทีละยา) ----
   แสดงทุกร่างเป็นกล่องที่กรอกไว้แล้ว แก้ได้ในกล่อง → "ตรวจแล้ว · ใช้คำนวณ" = บันทึก + แสดงในหน้าคำนวณขนาดยา */
const FORMS = ['ยาน้ำ', 'ยาเม็ด', 'ครีม', 'อื่น ๆ'], RV_OPEN = 5;
const ORAL = /เม็ด|แคปซูล|น้ำรับประทาน|ผง|NCD|เรื้อรัง/;
function rvCard(d, open) {
  const inds = indsOf(d);
  return `<details class="df-rv"${open ? ' open' : ''}><summary><b>${esc(d.name)}</b><span class="small muted">${inds.map((i) => esc(`${i.name || 'ข้อบ่งใช้'} ${perText(i)}`)).join(' · ')}</span></summary>`
    + `<form class="form-grid" data-rv="${d.id}" novalidate>`
    + `<div class="field"><label>ชื่อยา <span class="req">*</span><input class="input r-name" maxlength="120" value="${esc(d.name)}"></label></div>`
    + `<div class="field"><label>รูปแบบยา<select class="input r-form">${FORMS.map((f) => `<option${(d.form || 'อื่น ๆ') === f ? ' selected' : ''}>${f}</option>`).join('')}</select></label></div>`
    + `<div class="field full"><span class="label-like">ข้อบ่งใช้และขนาดยา</span><div class="ind-list r-inds">${inds.map((i) => indBox(i, true)).join('')}</div><div><button type="button" class="btn btn-o btn-sm" data-rv-addind>+ เพิ่มข้อบ่งใช้</button></div></div>`
    + `<div class="field full"><span class="label-like">ความแรงของยา</span><div class="med-rows r-concs">${(d.concs || []).map(concRow).join('') || concRow()}</div><div><button type="button" class="btn btn-o btn-sm" data-rv-addconc>+ เพิ่มความแรง</button></div></div>`
    + (d.ai_source ? `<p class="small muted full">${esc(d.ai_source)}</p>` : '')
    + (() => { const why = d.draft_issue || indsProblem(inds); return why ? `<p class="small fx-warn full" data-inds-problem>ต้องแก้ก่อนอนุมัติ: ${esc(why)}</p>` : ''; })()
    + '<div class="full row-btns df-rv-btns"><button class="btn btn-p btn-sm" type="submit">ตรวจแล้ว · ใช้คำนวณ</button><button type="button" class="btn btn-no btn-sm" data-rv-del>ลบร่าง</button><span class="small r-msg" aria-live="polite"></span></div>'
    + '</form></details>';
}
async function renderReview() {
  const list = drugs.filter((d) => d.ai_draft && (!pickDose || pickDose.has(d.id)));
  $('#dfRvCount').textContent = `(${list.length})`; pickN('ai', list.length);
  $('#dfReview').innerHTML = list.length ? list.map((d, k) => rvCard(d, k < RV_OPEN)).join('') : `<p class="empty">${pickDose ? 'ยานี้ไม่มีร่างรอตรวจ' : 'ไม่มีร่างรอตรวจ'}</p>`;
  $('#dfReview').querySelectorAll('.r-inds').forEach((b) => syncIndBoxes(b));
  // ความคืบหน้าของระบบ: ยารับประทานของ รพ.สต. ที่ยังไม่มีข้อมูลคำนวณ
  const { data, error } = await sb.from('local_drugs').select('name,category,dose_id,dose_ai_status,dose_ai_note').eq('active', true);
  if (error) { $('#dfRvStatus').textContent = ''; return; }
  const left = data.filter((l) => !l.dose_id && ORAL.test(l.category));
  const n = (st) => left.filter((l) => (l.dose_ai_status || 'wait') === st).length;
  const none = left.filter((l) => l.dose_ai_status === 'none');
  $('#dfRvStatus').innerHTML = !left.length ? 'ยารับประทานของ รพ.สต. มีข้อมูลคำนวณครบทุกตัวแล้ว'
    : `ระบบกำลังร่างให้ ${n('pending')} ยา · รอคิว ${n('wait') + n('error')} ยา (ทำต่อเองทีละยา ไม่ต้องกด)`
      + (none.length ? `<details class="df-rv-none"><summary>ฉลากยาไม่มีขนาดยาตามน้ำหนักตัว ${none.length} ยา (กรอกเองในฟอร์มด้านล่างได้)</summary><ul>${none.map((l) => `<li>${esc(l.name)}${l.dose_ai_note ? ` <span class="muted">· ${esc(l.dose_ai_note)}</span>` : ''}</li>`).join('')}</ul></details>` : '');
}
function onReview(e) {
  const card = e.target.closest('form[data-rv]'); if (!card) return;
  const rm = e.target.closest('[data-rmind]');
  if (rm) {
    e.preventDefault();
    const box = card.querySelector('.r-inds');
    if (box.children.length === 1) { say(card.querySelector('.r-msg'), 'ต้องมีข้อบ่งใช้อย่างน้อย 1 ข้อ'); return; }
    rm.closest('.ind-box').remove(); syncIndBoxes(box); return;
  }
  if (e.target.closest('[data-rv-addind]')) { const box = card.querySelector('.r-inds'); box.insertAdjacentHTML('beforeend', indBox()); syncIndBoxes(box); box.lastElementChild.querySelector('.i-name').focus(); return; }
  if (e.target.closest('[data-rv-addconc]')) { card.querySelector('.r-concs').insertAdjacentHTML('beforeend', concRow()); return; }
  if (e.target.closest('[data-rm]')) { e.target.closest('.med-row').remove(); return; }
  if (e.target.closest('[data-rv-del]')) delReview(card, e.target.closest('[data-rv-del]'));
}
async function saveReview(card) {
  const m = card.querySelector('.r-msg'), name = card.querySelector('.r-name').value.trim();
  if (!name) { say(m, 'กรุณาใส่ชื่อยา'); card.querySelector('.r-name').focus(); return; }
  let inds, concs;
  try { inds = readInds(card.querySelector('.r-inds')); concs = readConcs(card.querySelector('.r-concs')); } catch (err) { say(m, err.message); return; }
  const f = inds[0], btn = card.querySelector('[type=submit]');
  busy(btn, true, 'กำลังบันทึก…');
  const { error } = await sb.from('dose_drugs').update({
    name, form: card.querySelector('.r-form').value, indications: inds, indication: f.name, per: f.per, mg_per_kg_min: asMg(f, f.min), mg_per_kg_max: asMg(f, f.max),
    dose_freq_per_day: f.times ?? null, max_mg_per_dose: asMg(f, f.cap ?? null), freq: f.freq ?? null, renal_note: f.renal ?? null,
    concs, active: true, ai_draft: false,   // ผู้ดูแลตรวจแล้ว → ใช้ในเครื่องคำนวณ
  }).eq('id', +card.dataset.rv);
  busy(btn, false);
  if (error) { say(m, errText(error)); return; }
  toast(`ตรวจแล้ว · ${name} ใช้ในหน้าคำนวณขนาดยาแล้ว`);
  resetDose(); await reloadDrugs();
}
async function delReview(card, btn) {
  const name = card.querySelector('.r-name').value.trim();
  if (!confirm(`ลบร่างของ "${name}"? (ระบบจะไม่ร่างยานี้ใหม่เอง · เพิ่มเองได้ในฟอร์มด้านล่าง)`)) return;
  busy(btn, true);
  const { error } = await sb.from('dose_drugs').delete().eq('id', +card.dataset.rv);
  busy(btn, false);
  if (error) { toast(errText(error), 'err'); return; }
  toast('ลบร่างแล้ว'); await reloadDrugs();
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
