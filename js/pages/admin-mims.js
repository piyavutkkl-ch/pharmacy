// ผู้ดูแล › ข้อมูลยา › เครื่องมือฐานข้อมูล › ฐานข้อมูล MIMS (#/admin/drugs/mims · 85_mims.sql · ผู้ดูแลเท่านั้น)
//   นำเข้าไฟล์ mims_doses.json (ทำด้วย Claude in Chrome ในเครื่องผู้ดูแลที่ login MIMS ไว้) → อ่านในเบราว์เซอร์ → แปลงเป็นข้อบ่งใช้รูปแบบเดียวกับเครื่องคำนวณ (mapInd)
//     ① drug_mims ต่อหน้า MIMS 1 หน้า (ลิงก์เดียวกัน = แถวเดียว · นำเข้าซ้ำ = อัปเดต) ② ยา รพ.สต. ที่ชื่อตรงกัน → local_drugs.mims_id
//     ③ ข้อบ่งใช้ที่คำนวณได้ → ร่างขนาดยา (dose_drugs.ai_draft · ซ่อน · ai_source 'MIMS Thailand …') ให้ยาที่ยังไม่มีข้อมูลคำนวณ · ยาที่มีร่างอยู่แล้ว = เติมข้อบ่งใช้ที่ยังไม่มี · ข้อมูลที่อนุมัติแล้วไม่แตะ
//   แปลงตามกฎตายตัว ไม่เดา: "ไม่พบ" = ไม่ใส่ · ขาดตัวเลขต่ำสุด/สูงสุด หรือต่อวันไม่บอกจำนวนครั้ง = เก็บไว้อ้างอิงใน MIMS (skip) ไม่เข้าเครื่องคำนวณ
//     fixed_mg = ขนาดคงที่ (fixed) · "มก. = SMX+TMP รวม" → ÷6 คิดจาก Trimethoprim (อัตราส่วน 5:1) · "elemental Fe" → คิดจาก Elemental iron (ยาต้องกรอกปริมาณธาตุเหล็กก่อนจึงคิดเม็ดได้)
//   ทุกข้อบ่งใช้มี ref {label: 'MIMS Thailand', url} → แสดง "ที่มา" ในหน้าคำนวณเมื่อเภสัชกรอนุมัติแล้ว
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, busy, errText } from '../util.js?v=4.4';
import { drugData, reloadDrugData, codeTag } from './admin-drugs.js?v=4.4';
import { indsProblem } from './admin-settings.js?v=4.4';
import { doseText } from './dose.js?v=4.4';

const LABEL = 'MIMS Thailand';
const SRC = 'MIMS Thailand (นำเข้าข้อมูลขนาดยา) · ยังไม่ผ่านการตรวจ';
const NF = (v) => v == null || v === '' || (typeof v === 'string' && /^\s*(ไม่พบ|-|n\/?a)\s*$/i.test(v));
const numOf = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v) ? +v : null);
const okUrl = (u) => (typeof u === 'string' && /^https:\/\/(www\.)?mims\.com\//.test(u) && u.length <= 300 ? u : null);
const normName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
let pending = null, bound = false, shown = 30;

/** จำนวนครั้งต่อวัน: 3 → [3] · "2-4" → [2,3,4] (≤ 4 แบบ) · อื่น ๆ (เช่น "1+") → null */
function timesList(v) {
  const n = numOf(v);
  if (n != null) return Number.isInteger(n) && n >= 1 && n <= 12 ? [n] : null;
  const m = /^\s*(\d+)\s*[-–]\s*(\d+)\s*$/.exec(String(v ?? ''));
  if (!m) return null;
  const a = +m[1], b = +m[2];
  if (!(a >= 1 && b <= 12 && b > a)) return null;
  return Array.from({ length: b - a + 1 }, (_, k) => a + k).slice(0, 4);
}
/** ชื่อสามัญจากลิงก์ MIMS เช่น .../sulfamethoxazole-plus-trimethoprim → Sulfamethoxazole + Trimethoprim */
export function mimsName(url, fallback) {
  const slug = /\/drug\/info\/([a-z0-9-]+)/i.exec(url || '')?.[1];
  const t = slug ? slug.replace(/-plus-/g, ' + ').replace(/-/g, ' ') : String(fallback || '').trim();
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 200);
}

/** แปลงข้อบ่งใช้ 1 ข้อจากไฟล์ → { ind } ใช้คำนวณได้ หรือ { ind, skip: เหตุผล } เก็บไว้อ้างอิงเท่านั้น */
export function mapInd(x, url) {
  const name = NF(x?.name) ? '' : String(x.name).trim().slice(0, 200);
  const note0 = NF(x?.note) ? '' : String(x.note).trim();
  const ind = { name: name || '(ไม่ระบุข้อบ่งใช้)' };
  if (['dose', 'day'].includes(x?.per)) ind.per = x.per;
  const fx = x?.fixed_mg && typeof x.fixed_mg === 'object' ? x.fixed_mg : null;
  let min = null, max = null;
  if (fx && numOf(fx.min) != null && numOf(fx.max) != null) { ind.fixed = true; min = numOf(fx.min); max = numOf(fx.max); }
  else if (numOf(x?.min) != null && numOf(x?.max) != null) { min = numOf(x.min); max = numOf(x.max); }
  let cap = numOf(x?.cap), capDay = numOf(x?.cap_day);
  const notes = [note0];
  // co-trimoxazole: MIMS บอกเป็นน้ำหนัก SMX+TMP รวม → คิดจาก trimethoprim (1/6 ของรวม เพราะ SMX:TMP = 5:1)
  if (/SMX\s*\+\s*TMP\s*รวม/i.test(note0)) {
    const d6 = (v) => (v == null ? null : +(v / 6).toFixed(3));
    min = d6(min); max = d6(max); cap = d6(cap); capDay = d6(capDay); ind.basis = 'Trimethoprim';
    notes.push('แปลงจากขนาด SMX+TMP รวม ÷ 6 เป็นขนาด trimethoprim (อัตราส่วน 5:1) · ตรวจทานกับต้นฉบับ');
  } else if (/อิง\s*trimethoprim/i.test(note0)) ind.basis = 'Trimethoprim';
  if (/elemental\s*Fe/i.test(note0)) ind.basis = 'Elemental iron';
  if (min != null) { ind.min = min; ind.max = max; }
  if (cap != null && cap > 0) ind.cap = cap;
  if (capDay != null && capDay > 0) ind.cap_day = capDay;
  const ts = timesList(x?.times);
  if (ind.per === 'day' && ts) { ind.times = ts[0]; if (ts.length > 1) ind.times_alt = ts.slice(1); }
  if (ind.per === 'dose' && !NF(x?.times)) ind.freq = /^\d+\+$/.test(String(x.times)) ? `วันละ ${parseInt(x.times, 10)} ครั้งขึ้นไป` : `วันละ ${String(x.times).replace('-', '–')} ครั้ง`.slice(0, 120);
  const aMin = numOf(x?.age_min), aMax = numOf(x?.age_max);
  if (aMin != null) ind.age_min = aMin;
  if (aMax != null) ind.age_max = aMax;
  if (!NF(x?.renal)) ind.renal = String(x.renal).trim().slice(0, 1000);
  const note = notes.filter(Boolean).join(' · ').slice(0, 500);
  if (note) ind.note = note;
  if (url) ind.ref = { label: LABEL, url };
  let skip = !name ? 'ไม่มีชื่อข้อบ่งใช้'
    : !ind.per ? 'ไม่ระบุว่าเป็นขนาดต่อครั้งหรือต่อวัน'
    : min == null ? 'ไม่มีขนาดยาต่ำสุด–สูงสุดครบ'
    : ind.per === 'day' && !ind.times ? 'ขนาดต่อวันแต่ไม่ระบุจำนวนครั้งที่แบ่งให้'
    : null;
  if (!skip) { const why = indsProblem([ind]); if (why) skip = why.replace(/^ข้อบ่งใช้ 1: /, ''); }
  return skip ? { ind: { ...ind, skip }, skip } : { ind };
}

/** อ่านไฟล์ทั้งหมด → กลุ่มตามหน้า MIMS (ลิงก์) + ยา รพ.สต. ที่ชื่อตรงกัน */
export function planImport(list, locals) {
  if (!Array.isArray(list)) throw new Error('ไฟล์ต้องเป็นรายการ (JSON array) ตามรูปแบบ mims_doses.json');
  if (list.length > 500) throw new Error('ไฟล์มีรายการมากเกินไป (เกิน 500 ยา)');
  const groups = new Map(), unmatched = [], noData = [];
  for (const it of list) {
    const drug = String(it?.drug || '').trim();
    if (!drug) continue;
    const url = okUrl(it?.ref?.url), key = url || `name:${drug.toLowerCase()}`;
    const inds = (Array.isArray(it.indications) ? it.indications : []).slice(0, 40).map((x) => mapInd(x, url));
    const useful = inds.filter((r) => !r.skip || r.ind.min != null || r.ind.cap != null || r.ind.cap_day != null);
    const locs = locals.filter((l) => normName(l.name) === normName(drug));
    if (!locs.length) unmatched.push(drug);
    if (!url && !useful.length) { noData.push({ drug, why: inds.map((r) => r.ind.note).filter(Boolean)[0] || 'ไม่พบข้อมูลใน MIMS' }); continue; }
    const g = groups.get(key) || { url, name: mimsName(url, drug), drugs: [], inds: [], locals: [] };
    g.drugs.push(drug);
    for (const r of inds) if (!g.inds.some((y) => JSON.stringify(y.ind) === JSON.stringify(r.ind))) g.inds.push(r);
    for (const l of locs) if (!g.locals.includes(l)) g.locals.push(l);
    groups.set(key, g);
  }
  const gs = [...groups.values()];
  return { groups: gs, unmatched, noData, nInds: gs.reduce((a, g) => a + g.inds.length, 0), nCalc: gs.reduce((a, g) => a + g.inds.filter((r) => !r.skip).length, 0) };
}
const usable = (inds) => (inds || []).filter((i) => !i.skip).map((i) => { const { skip, ...rest } = i; return rest; });
const indKey = (i) => `${String(i.name || '').toLowerCase()}|${i.ref?.url || ''}`;

/** สร้าง/เติมร่างขนาดยาจากข้อมูล MIMS ให้ยา รพ.สต. ที่ผูกไว้ → { made, filled, kept } */
export async function draftFromMims(m, locs, D) {
  const inds = usable(m.indications);
  const out = { made: 0, filled: 0, kept: 0 };
  if (!inds.length) return out;
  const own = (l) => [l.dose_id, ...(l.ingredients || []).map((x) => x.dose_id)].filter(Boolean);
  const need = locs.filter((l) => !own(l).length && !(l.link_na || []).includes('dose'));
  const drafts = new Map();
  for (const l of locs) {
    const d = l.dose_id && D.doses.find((x) => x.id === l.dose_id);
    if (!d) continue;
    if (d.ai_draft) drafts.set(d.id, d); else out.kept++;
  }
  for (const d of drafts.values()) {   // ร่างเดิม (AI หรือ MIMS) → เติมเฉพาะข้อบ่งใช้ที่ยังไม่มี
    const have = new Set((d.indications || []).map(indKey)), add = inds.filter((i) => !have.has(indKey(i)));
    if (!add.length) continue;
    const { error } = await sb.from('dose_drugs').update({ indications: [...(d.indications || []), ...add].slice(0, 40) }).eq('id', d.id);
    if (error) throw error;
    out.filled++;
  }
  if (need.length) {
    const src = `${SRC} · ${m.url || m.name}`.slice(0, 500);
    let d = D.doses.find((x) => x.ai_draft && x.ai_source === src);
    if (!d) {
      const f = inds[0];
      const row = { name: m.name.slice(0, 120), form: 'อื่น ๆ', indications: inds, indication: f.name, per: f.per, mg_per_kg_min: f.fixed ? 0 : f.min, mg_per_kg_max: f.fixed ? 0 : f.max,
        dose_freq_per_day: f.times ?? null, max_mg_per_dose: f.cap ?? null, freq: f.freq ?? null, renal_note: f.renal ?? null, concs: [], sort: 0, active: false, ai_draft: true, ai_source: src };
      const { data, error } = await sb.from('dose_drugs').insert(row).select().single();
      if (error) throw error;
      d = data; D.doses.push(d); out.made++;
    }
    for (const l of need) {
      const { error } = await sb.from('local_drugs').update({ dose_id: d.id, updated_at: new Date().toISOString() }).eq('id', l.id);
      if (error) throw error;
    }
  }
  return out;
}

async function runImport(btn) {
  if (!pending) return;
  busy(btn, true, 'กำลังนำเข้า…');
  const sum = { rows: 0, links: 0, made: 0, filled: 0, kept: 0 };
  try {
    const D = await drugData();
    for (const g of pending.groups) {
      const row = { name: g.name, url: g.url, label: LABEL, indications: g.inds.map((r) => r.ind),
        note: g.drugs.length > 1 ? `ใช้กับ: ${g.drugs.join(', ')}`.slice(0, 2000) : null };
      const old = D.mims.find((x) => (g.url && x.url === g.url) || (!g.url && !x.url && x.name.toLowerCase() === g.name.toLowerCase()));
      const q = old ? sb.from('drug_mims').update(row).eq('id', old.id).select().single() : sb.from('drug_mims').insert(row).select().single();
      const { data: m, error } = await q;
      if (error) throw error;
      sum.rows++;
      for (const l of g.locals) {
        if (l.mims_id === m.id || (l.mims_id && l.mims_id !== m.id)) continue;   // ผูกกับหน้าอื่นไว้แล้ว = ไม่ทับ
        const { error: e2 } = await sb.from('local_drugs').update({ mims_id: m.id, updated_at: new Date().toISOString() }).eq('id', l.id);
        if (e2) throw e2;
        l.mims_id = m.id; sum.links++;
      }
      const r = await draftFromMims(m, g.locals, D);
      sum.made += r.made; sum.filled += r.filled; sum.kept += r.kept;
    }
    await reloadDrugData();
    const p = pending; pending = null;
    $('#mmFile').value = ''; $('#mmImport').disabled = true; $('#mmPreview').innerHTML = '';
    $('#mmResult').innerHTML = `<div class="mm-done" data-mims-done><div><b>นำเข้าแล้ว</b><div class="small">ข้อมูล MIMS ${sum.rows} รายการ · ผูกกับยา ${sum.links} ตัว · สร้างร่างขนาดยาใหม่ ${sum.made} รายการ · เติมข้อบ่งใช้ในร่างเดิม ${sum.filled} รายการ${sum.kept ? ` · ข้อมูลคำนวณที่อนุมัติแล้ว ${sum.kept} ยา ไม่แตะ` : ''}</div>`
      + `<div class="small">ร่างขนาดยายังซ่อนอยู่ · เภสัชกรตรวจกับหน้า MIMS แล้วกด "อนุมัติใช้คำนวณ" ในศูนย์ข้อมูลยา${p.unmatched.length ? ` · ชื่อที่ไม่ตรงกับยาในระบบ: ${esc(p.unmatched.join(', '))}` : ''}</div></div></div>`;
    toast('นำเข้าข้อมูล MIMS แล้ว');
  } catch (err) { toast(errText(err), 'err'); } finally { busy(btn, false); }
}

function previewHtml(p) {
  return `<div class="mm-pre" data-mims-preview><p><b>พบ ${p.groups.length} หน้า MIMS</b> · ข้อบ่งใช้ ${p.nInds} ข้อ (ใช้คำนวณได้ ${p.nCalc} · เก็บไว้อ้างอิง ${p.nInds - p.nCalc})`
    + ` · ตรงกับยาในระบบ ${p.groups.reduce((a, g) => a + g.locals.length, 0)} ตัว</p>`
    + (p.unmatched.length ? `<p class="small dc-warn">ชื่อยาที่ไม่ตรงกับยาในระบบ (เก็บข้อมูล MIMS ไว้ แต่ยังไม่ผูก): ${esc(p.unmatched.join(', '))}</p>` : '')
    + (p.noData.length ? `<p class="small muted">ไม่มีข้อมูล (ข้าม): ${p.noData.map((x) => esc(`${x.drug} — ${x.why}`)).join(' · ')}</p>` : '')
    + '</div>';
}
async function onFile() {
  const f = $('#mmFile').files[0];
  pending = null; $('#mmImport').disabled = true; $('#mmResult').innerHTML = '';
  if (!f) { $('#mmPreview').innerHTML = ''; return; }
  try {
    if (f.size > 2 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกิน 2 MB');
    const list = JSON.parse(await f.text());
    const D = await drugData();
    pending = planImport(list, D.locals);
    $('#mmPreview').innerHTML = previewHtml(pending);
    $('#mmImport').disabled = !pending.groups.length;
  } catch (err) { $('#mmPreview').innerHTML = `<p class="small dc-err">อ่านไฟล์ไม่ได้: ${esc(err.message || String(err))}</p>`; }
}

/* ---- รายการข้อมูล MIMS ที่บันทึกแล้ว ---- */
async function renderList() {
  if (!$('#mmList')) return;
  const D = await drugData(), q = ($('#mmQ').value || '').trim().toLowerCase();
  const rows = D.mims.filter((m) => !q || `${m.name} ${m.web_code || ''}`.toLowerCase().includes(q));
  $('#mmCount').textContent = `(${D.mims.length})`;
  const n = document.querySelector('[data-adr-n="mims"]'); if (n) n.textContent = D.mims.length ? `· ${D.mims.length} รายการ` : '';
  $('#mmList').innerHTML = rows.length ? rows.slice(0, shown).map((m) => {
    const locs = D.locals.filter((l) => l.mims_id === m.id), inds = m.indications || [], ok = inds.filter((i) => !i.skip).length;
    return `<details class="mm-item" data-mims-row="${m.id}"><summary><span class="mm-h">${codeTag(m)}<b>${esc(m.name)}</b></span>`
      + `<span class="small muted">ข้อบ่งใช้ ${inds.length} (ใช้คำนวณได้ ${ok}) · ${locs.length ? `ผูกกับ ${esc(locs.map((l) => l.name).join(', '))}` : 'ยังไม่ผูกกับยา'}</span></summary>`
      + `<div class="mm-body">${m.url ? `<p class="small">อ้างอิง: <a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.label)} · ${esc(m.name)}</a> (ต้อง login MIMS)</p>` : ''}`
      + (m.note ? `<p class="small muted">${esc(m.note)}</p>` : '')
      + `<ul class="mm-inds">${inds.map((i) => `<li class="${i.skip ? 'mm-skip' : ''}"><b>${esc(i.name)}</b> · ${esc(doseText(i))}${i.fixed ? ' (ขนาดคงที่)' : ''}${i.cap_day ? ` · ไม่เกิน ${esc(i.cap_day)} มก./วัน` : ''}${i.freq ? ` · ${esc(i.freq)}` : ''}`
        + `${i.age_min != null || i.age_max != null ? ` · อายุ ${esc(i.age_min ?? 0)}–${esc(i.age_max ?? '')} ปี` : ''}${i.note ? `<br><span class="small muted">${esc(i.note)}</span>` : ''}${i.skip ? `<br><span class="small dc-warn">ยังใช้คำนวณไม่ได้: ${esc(i.skip)}</span>` : ''}</li>`).join('') || '<li class="muted">ไม่มีข้อบ่งใช้</li>'}</ul>`
      + `<div class="row-btns">${ok && locs.length ? `<button type="button" class="btn btn-o btn-sm" data-mims-draft="${m.id}">สร้าง/เติมร่างขนาดยาให้ยาที่ผูก</button>` : ''}<button type="button" class="btn btn-no btn-sm" data-mims-del="${m.id}">ลบ</button></div></div></details>`;
  }).join('') + (rows.length > shown ? `<button type="button" class="btn btn-o btn-sm di-more" data-mims-more>แสดงเพิ่ม (${rows.length - shown})</button>` : '')
    : `<p class="empty">${D.mims.length ? 'ไม่พบตามคำค้น' : 'ยังไม่มีข้อมูล MIMS · นำเข้าไฟล์ด้านบน'}</p>`;
}
async function onList(e) {
  const b = e.target.closest('button'); if (!b) return;
  const D = await drugData();
  if (b.dataset.mimsMore != null) { shown += 30; renderList(); return; }
  if (b.dataset.mimsDel) {
    const m = D.mims.find((x) => x.id === +b.dataset.mimsDel);
    if (!m || !confirm(`ลบข้อมูล MIMS "${m.name}"?\nยาที่ผูกไว้จะเลิกผูก · ร่างขนาดยาที่สร้างไปแล้วยังอยู่`)) return;
    busy(b, true, 'กำลังลบ…');
    const { error } = await sb.from('drug_mims').delete().eq('id', m.id);
    busy(b, false);
    if (error) { toast(errText(error), 'err'); return; }
    toast('ลบแล้ว'); await reloadDrugData(); return;
  }
  if (b.dataset.mimsDraft) {
    const m = D.mims.find((x) => x.id === +b.dataset.mimsDraft); if (!m) return;
    busy(b, true, 'กำลังสร้าง…');
    try {
      const r = await draftFromMims(m, D.locals.filter((l) => l.mims_id === m.id), D);
      toast(r.made || r.filled ? `สร้างร่าง ${r.made} · เติมร่างเดิม ${r.filled} · รอเภสัชกรตรวจ` : 'ยาที่ผูกมีข้อมูลคำนวณครบแล้ว ไม่ได้สร้างร่างเพิ่ม');
      await reloadDrugData();
    } catch (err) { toast(errText(err), 'err'); } finally { busy(b, false); }
  }
}
export function initMimsAdmin() {
  if (!$('#mmList')) return;
  if (!bound) {
    bound = true;
    $('#mmFile').addEventListener('change', onFile);
    $('#mmImport').addEventListener('click', (e) => runImport(e.currentTarget));
    $('#mmQ').addEventListener('input', () => { shown = 30; renderList(); });
    $('#mmList').addEventListener('click', onList);
    window.addEventListener('pcps:mimsdata', renderList);
    window.addEventListener('pcps:drugdata', renderList);   // ยาที่ผูก (โหลดยา รพ.สต. เสร็จทีหลัง)
  }
  $('#mmList').innerHTML = '<div class="skeleton"></div>';
  renderList();
}
