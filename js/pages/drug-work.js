// ผู้ดูแล › ข้อมูลยา › โปรไฟล์ยา (#/admin/drugs · หน้าแรกของข้อมูลยา · เจ้าของเว็บ 21 ต.ค.) — "ค้นหา → เลือกยา → จัดการจบในหน้าเดียว"
//   ซ้าย = รายการยา (ค้น ชื่อ/สารสำคัญ/รหัส · จุดสี = สถานะ) + "พิมพ์ชื่อยาใหม่ → AI เตรียมให้ทั้งตัว" (สร้างยา + ดึงฉลาก openFDA + ให้ AI ร่างขนาดยาเป็นการ์ดรอตรวจ)
//   กลาง = หัวยา (ชื่อ · รูปแบบ · ความแรง · คิดเป็น แก้ในที่) + วงกลมความคืบหน้า + แถบขั้นตอน + ปุ่ม "ถัดไป" (พาไปสิ่งที่ยังค้าง)
//          แหล่งข้อมูล 5 ชิป (บัญชี รพ.สต. · MIMS · OpenFDA+DailyMed · บัญชียาหลัก · DDInter) กดชิป = ผูก/เปลี่ยนในที่ · คู่ที่ระบบเสนอกดเดียว
//          การ์ดขนาดยา (ข้อบ่งใช้ละ 1 การ์ด) กรอกด้วยปุ่มรูป: กลุ่มอายุ · ตามน้ำหนัก/คงที่ · ต่อครั้ง/ต่อวัน · Min/Max · วันละกี่ครั้ง · เพดาน · ละเอียดเพิ่ม (ไต/หมายเหตุ/ที่มา)
//          หน่วยตามต้นฉบับ (ไม่แปลงเอง) · แต่ละการ์ดทดสอบสูตร + กฎความปลอดภัยทันที: ผ่าน → "ตรวจตัวเลขกับฉลากแล้ว" · ไม่ผ่าน/เตือน → "ให้ AI ตรวจกับฉลาก" (87 · ฉลาก OpenFDA) หรือ "ให้ AI ค้นจากเว็บพร้อมลิงก์" (90)
//   ขวา = ต้นฉบับข้างกัน (OpenFDA+DailyMed / MIMS · ไฮไลต์ข้อความที่การ์ดอ้าง · เลือกข้อความ = ใช้เป็นที่มา/สร้างการ์ด) + ผลคำนวณสด (สูตรเดียวกับหน้าคำนวณ)
//   ล่าง = เหลืออีกกี่อย่าง + บันทึกร่าง / อนุมัติใช้คำนวณ (ต้องตรวจทุกการ์ดที่ใช้ + ทดสอบสูตรผ่าน · saveDose ใน drug-center.js ชุดเดียวกับแผงยาเดิม)
//   ป้ายสถานะข้อมูล: AI สร้าง · กรอกเอง · ตรวจแล้ว · พร้อมคำนวณ
//   กฎความปลอดภัย (dose-rules.js · audit 22 ต.ค.): ไม่ผ่าน = แก้ก่อน (ให้ AI ตรวจกับฉลาก หรือค้นจากเว็บพร้อมลิงก์ 90) · เตือน = ติ๊กรับทราบทีละข้อ → "ตรวจตัวเลขกับฉลากแล้ว"
//   หัวยา: ปุ่ม ซ่อน/แสดงยานี้ (local_drugs.active) + ลบ (ย้ายลงถัง 7 วัน) · ยาที่แสดงอยู่แต่ยังไม่มีผู้อนุมัติ = ปุ่ม "อนุมัติใช้คำนวณ" (approve_dose)
import { sb } from '../supabase.js?v=4.4';
import { $, $$, esc, toast, busy, errText, thaiDate } from '../util.js?v=4.4';
import { strengthOf, concOf, comboName, doseNumbers, sameBasis } from './dose.js?v=4.4';
import { drugData, reloadDrugData, genericKey, codeTag, fetchFdaLabel, fetchFdaBySetId, sectionsText, parseSections, formsText, parseForms } from './admin-drugs.js?v=4.4';
import { indsProblem, refOfLabel, doseQuery, timesOf } from './admin-settings.js?v=4.4';
import { testDose, testWeights } from './dose-test.js?v=4.4';
import { drugRules, indRules, autoCaps, OPEN_AGE, flagHides, FLAG_LEVEL, DECISION } from './dose-rules.js?v=4.4';
import { loadSavedFixes } from './dose-check.js?v=4.4';
import { DC, centerRows, suggest, applyRow, basesOf, rejectPair, saveDose, doseRows, openTools } from './drug-center.js?v=4.4';
import { ingsRow } from './drug-grid.js?v=4.4';
import { parseMimsText, headTh } from './mims-text.js?v=4.4';
import { trashDrug } from './drug-trash.js?v=4.4';
import { mimsPreviewHtml, saveMimsText } from './admin-mims.js?v=4.4';

const SRCS = [['rpst', 'บัญชี รพ.สต.', 'list'], ['mims', 'MIMS', 'doc'], ['fda', 'OpenFDA+DailyMed', 'flask'], ['nlem', 'บัญชียาหลัก', 'book'], ['ddi', 'DDInter', 'swap']];
const SRCN = Object.fromEntries(SRCS.map(([k, t]) => [k, t]));
const AGES = [['inf', 'ทารก', '< 2 ปี', 0, 2, 'baby'], ['kid', 'เด็ก', '2–12 ปี', 2, 12, 'kid'], ['adt', 'ผู้ใหญ่', '≥ 12 ปี', 12, null, 'adult']];
const TIMES = [1, 2, 3, 4, 6];
const FDA_SECS = ['ขนาดยาและวิธีใช้', 'ข้อบ่งใช้', 'การใช้ในหญิงตั้งครรภ์/ให้นมบุตร เด็ก ผู้สูงอายุ'];
const MIMS_MAIN = ['Indications and Dosage', 'Special Patient Group'];
const DOT = { ready: 'ok', wait: 'wait', miss: 'miss', err: 'err' };
const RANK = { err: 0, miss: 1, wait: 2, ready: 3 };
const ic = (n, cls = '') => `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#dwi-${n}"/></svg>`;
const numv = (v) => (v === '' || v == null || !Number.isFinite(+v) ? null : +v);
const n2 = (x) => (Number.isFinite(x) ? (x >= 10 ? Math.round(x) : x >= 1 ? +x.toFixed(1) : +x.toPrecision(2)) : '–');
const rg = (a, b) => (n2(a) === n2(b) ? `${n2(a)}` : `${n2(a)}–${n2(b)}`);
const norm = (x) => String(x || '').trim().replace(/\s+/g, ' ').toUpperCase();
const idv = (v) => (/^\d+$/.test(String(v ?? '')) ? +v : v || null);

let wantPart = null;   // ส่วนที่ต้องเปิดให้หลังเลือกยา (drug | rpst | mims | fda | nlem | ddi | dose | new)
let dbEd = null, ddPairs = null, dmRes = null, hist = null;   // แก้ไขรายละเอียดแหล่งข้อมูลในแผง · คู่ยา DDInter ของยานี้ · ผล DailyMed · ประวัติแก้ไข
let D = null, rows = [], sel = null, cards = [], focus = 0, wSel = null, pop = null, popQ = '', srcTab = null, filt = 'todo', dirty = false, prep = '', bound = false, edit = null, mimsParsed = null;

/* ---------- ข้อมูล ---------- */
const cur = () => rows.find((r) => String(r.l.id) === String(sel)) || null;
const fdaOf = (l) => (l.fda_key ? D.fdas.find((f) => f.key === l.fda_key) : null);
const mimsOf = (l) => (l.mims_id ? (D.mims || []).find((m) => String(m.id) === String(l.mims_id)) : null);
const fdaRef = (f) => (f ? refOfLabel({ brand: f.brand, generic: f.generic, effective: f.effective, set_id: f.set_id }) : null);
/** ข้อบ่งใช้ที่พร้อมบันทึก: ตัดช่องว่าง/ค่าว่าง · times_alt เฉพาะต่อวัน */
function cleanInd(i) {
  const o = {};
  for (const [k, v] of Object.entries(i || {})) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length) || ['checked'].includes(k)) continue;
    o[k] = typeof v === 'string' ? v.trim() : v;
  }
  if (o.per !== 'day') { delete o.times; delete o.times_alt; }
  if (!o.fixed) delete o.fixed;
  if (o.unit !== 'mcg') delete o.unit;
  return o;
}
const srcKind = (i) => (/^MIMS/.test(i?.ref?.label || '') ? 'mims' : /dailymed|fda/i.test(`${i?.ref?.url || ''} ${i?.ref?.label || ''}`) ? 'fda' : i?.ref?.label ? 'other' : 'manual');
const srcTag = (i) => ({ mims: 'MIMS', fda: 'OpenFDA+DailyMed', other: i.ref?.label || 'อ้างอิง', manual: 'กรอกเอง' }[srcKind(i)]);

function buildCards(l, j) {
  const d = j.dose.dose, approved = j.dose.s === 'ok';
  return doseRows(l, j).map((r) => ({ ind: { ...r.ind }, on: r.on, skip: r.skip, ok: !!(r.on && (approved || r.ind.checked)), ai: !!(d?.ai_draft && r.on) || !!r.ind.quote && srcKind(r.ind) === 'fda' && !approved, fix: null, open: false }));
}
function select(id, keep = false) {
  if (!keep && dirty && String(id) !== String(sel) && !confirm('มีการแก้ไขขนาดยาที่ยังไม่บันทึก · ทิ้งการแก้ไขแล้วไปยาตัวอื่น?')) return false;
  sel = id; pop = null; popQ = ''; edit = null; mimsParsed = null; wSel = null; dbEd = null; ddPairs = null; dmRes = null; hist = null;
  const r = cur();
  if (r && !keep) { cards = buildCards(r.l, r.j); dirty = false; focus = Math.max(0, cards.findIndex((c) => c.on && !c.ok)); srcTab = null; attachSaved(r); }
  try { sessionStorage.setItem('pcps_work_sel', String(id)); } catch { /* ไม่เป็นไร */ }
  renderList(); renderMain();
  return true;
}
/** ค่าที่ AI เสนอไว้แล้ว (เช่น จากปุ่มตรวจทุกตัวในภาพรวม) → ใส่ในการ์ดที่ยังไม่ผ่าน ชื่อข้อบ่งใช้ตรงกัน (ผู้ดูแลกดใช้เอง) */
async function attachSaved(r) {
  const did = r.j.dose.dose?.id, ids = did ? D.locals.filter((x) => x.id === r.l.id || x.dose_id === did || (x.ingredients || []).some((g) => g.dose_id === did)).map((x) => x.id) : [r.l.id];
  const m = await loadSavedFixes(ids);
  if (!m.size || String(sel) !== String(r.l.id)) return;
  let n = 0;
  cards.forEach((c, k) => {
    const f = m.get(String(c.ind.name || '').trim());
    if (!f || c.fix || c.filled || c.ok || cardTest(r.l, r.j, c).status === 'pass') return;
    if (fillCard(r.l, c, k, { mode: f.mode || f.result?.mode, res: f.result })) n++;
  });
  if (n) { prep = `AI เติมข้อมูลให้แล้ว ${n} ข้อ (จากการตรวจทุกตัว) · เปิดลิงก์ตรวจตัวเลข แล้วกด "ตรวจตัวเลขกับฉลากแล้ว" และ "อนุมัติใช้คำนวณ" · ยังไม่บันทึก/ยังไม่แสดงต่อประชาชน`; renderMain(); }
}
/** เติมค่าที่ AI หาได้ลงการ์ดเลย (ยังไม่บันทึก · ต้องตรวจและอนุมัติเอง) · เก็บค่าเดิมไว้ย้อนกลับได้ */
function fillCard(l, c, k, fix) {
  const res = fix?.res; if (!res?.ind) return false;
  const ref = res.ind.ref || fdaRef(fdaOf(l));   // ค้นจากเว็บ = ลิงก์ที่ AI ใช้ · ตรวจกับฉลาก = ฉลาก DailyMed ของยานี้
  c.filled = { prev: { ...c.ind }, mode: fix.mode || res.mode || 'label', res };
  c.ind = { ...res.ind, name: c.ind.name || res.ind.name, ...(ref ? { ref } : {}) };
  c.fix = null; c.ack = []; c.ai = true; c.fixed = true; c.skip = null; c.on = true; c.open = true;
  changed(k);
  return true;
}
/** ธง AI ตรวจย้อนหลัง (91/92) ของข้อนี้: AI เสนอ (ตัวเลขขัด/นอกฉลาก/สงสัย) → เภสัชกรตัดสิน 4 แบบ (DECISION) · ตัดสินแล้วไม่ถูกธงซ้ำจนกว่าตัวเลขจะเปลี่ยน
 *  ซ่อนตัวเลขเมื่อ AI ว่าตัวเลขขัด (ยังไม่ตัดสิน) หรือเภสัชกรยืนยันว่าขัด · แก้ตัวเลขแล้วอนุมัติใหม่ = ล้างธงเอง */
const DEC_BTN = [['conflict', 'ขัดจริง · ต้องแก้'], ['offlabel_ok', 'นอกฉลาก · มีแนวทางรองรับ'], ['local', 'แนวปฏิบัติท้องถิ่น'], ['no_conflict', 'ไม่ขัด · AI เข้าใจผิด']];
function auditHtml(j, c, k) {
  const f = (Array.isArray(j.dose.dose?.audit_flags) ? j.dose.dose.audit_flags : []).find((x) => x.name === c.ind.name);
  if (!f) return '';
  const hide = flagHides(f), kind = FLAG_LEVEL[f.level] || 'สงสัย';
  const head = f.decision ? `ตัดสินแล้ว: ${DECISION[f.decision] || f.decision}${hide ? ' · หน้าคำนวณหยุดแสดงข้อนี้จนแก้ตัวเลข' : ' · แสดงตามเดิม'}`
    : `${kind} · ${hide ? 'หน้าคำนวณหยุดแสดงข้อนี้แล้ว' : 'ยังแสดงอยู่'} · รอเภสัชกรตัดสิน`;
  return `<div class="dw-fix${hide ? ' bad' : ''}" data-dw-audit="${k}" data-level="${esc(f.level || '')}" data-decision="${esc(f.decision || '')}"><b>${ic('spark')}AI ตรวจย้อนหลัง: ${esc(head)}</b>`
    + `<span class="small">${esc(f.why || '')}</span>${f.quote ? `<span class="small">ฉลาก: <span lang="en">“${esc(f.quote)}”</span></span>` : ''}`
    + (f.decision ? `<span class="small muted">ตัดสินเมื่อ ${esc(thaiDate(f.decided_at) || '-')} · ผู้ตัดสินดูได้ที่ "ประวัติแก้ไข" · ตรวจซ้ำรอบหน้าจะไม่ถูกธงซ้ำ ถ้าตัวเลขข้อนี้ไม่เปลี่ยน</span>`
      + `<div class="row-btns"><button type="button" class="btn btn-o btn-sm" data-dw-decide="${k}" data-v="">เปลี่ยนการตัดสิน</button></div></div>`
      : `<span class="small muted">AI เสนอ เภสัชกรตัดสิน · เทียบกับต้นฉบับ MIMS/แนวทางด้านข้างก่อน · ถ้าตัวเลขผิดจริง แก้ค่าแล้วกดอนุมัติใหม่ (ล้างธงเอง)</span>`
      + `<div class="row-btns dw-dec">${DEC_BTN.map(([v, t]) => `<button type="button" class="btn ${v === 'conflict' ? 'btn-o dw-dec-bad' : 'btn-o'} btn-sm" data-dw-decide="${k}" data-v="${v}">${t}</button>`).join('')}</div></div>`);
}
/** การ์ดที่ AI เติมให้แล้ว: เปลี่ยนอะไร · ที่ยังขาด · ลิงก์ให้เปิดตรวจ · ย้อนกลับค่าเดิม */
function filledHtml(c, k) {
  const f = c.filled, web = f.mode === 'web', old = cleanInd(f.prev), nw = cleanInd(c.ind);
  const diff = Object.keys(FLAB).filter((x) => x !== 'name' && x !== 'quote' && JSON.stringify(old[x] ?? null) !== JSON.stringify(nw[x] ?? null));
  return `<div class="dw-fix" data-dw-filled data-mode="${web ? 'web' : 'label'}"><b>${ic('spark')}AI เติมให้แล้ว${web ? ' (ค้นจากเว็บ)' : ' (จากฉลาก OpenFDA)'}</b>${f.res.why ? ` <span class="small">${esc(f.res.why)}</span>` : ''}`
    + `<ul>${diff.map((x) => `<li>${esc(FLAB[x])}: <s>${esc(fmtv(old[x]))}</s> → <b>${esc(fmtv(nw[x]))}</b></li>`).join('') || '<li>ไม่มีค่าที่เปลี่ยน</li>'}</ul>`
    + (f.res.left ? `<p class="small dc-warn">ยังขาด: ${esc(f.res.left)}</p>` : '') + linksHtml(f.res)
    + `<p class="small muted">${web ? '<b>ค่าจากเว็บยังไม่ได้ตรวจเทียบต้นฉบับโดยระบบ</b> · ' : ''}เปิดลิงก์ตรวจตัวเลขก่อนกด "ตรวจตัวเลขกับฉลากแล้ว" · ยังไม่บันทึกจนกด "อนุมัติใช้คำนวณ"</p>`
    + `<div class="row-btns"><button type="button" class="btn btn-o btn-sm" data-dw-undo="${k}">ย้อนกลับค่าเดิม</button></div></div>`;
}
async function refresh(rebuild = true) {
  await reloadDrugData();
  rows = await centerRows(true); D = await drugData();
  const r = cur();
  if (r && rebuild) { cards = buildCards(r.l, r.j); dirty = false; }
  renderList(); renderMain();
}
/** บันทึกข้อมูลยา (local_drugs) แล้ววาดใหม่ · คงการ์ดที่กำลังแก้ไว้ */
async function saveLocal(row, msg) {
  const r = cur(); if (!r) return false;
  const { error } = await sb.from('local_drugs').update({ ...row, updated_at: new Date().toISOString() }).eq('id', r.l.id);
  if (error) { toast(errText(error), 'err'); return false; }
  toast(msg);
  const keep = dirty ? cards : null;
  await refresh(!keep);
  if (keep) { cards = keep; renderMain(); }
  return true;
}

/* ---------- รายการยาด้านซ้าย ---------- */
function searchText(r) {
  const l = r.l, f = fdaOf(l), m = mimsOf(l);
  return [l.name, l.web_code, l.code, l.category, genericKey(l.name), ...(l.ingredients || []).map((x) => x.name), f?.generic, m?.name].join(' ').toLowerCase();
}
function listRows() {
  const q = ($('#dwQ')?.value || '').trim().toLowerCase();
  return rows.filter((r) => (filt === 'all' || (filt === 'ready' ? r.st === 'ready' : r.st !== 'ready')) && (!q || searchText(r).includes(q)))
    .sort((a, b) => RANK[a.st] - RANK[b.st] || a.l.name.localeCompare(b.l.name));
}
function renderList() {
  const list = listRows();
  $$('[data-dw-filt]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dwFilt === filt)));
  const n = { todo: rows.filter((r) => r.st !== 'ready').length, all: rows.length, ready: rows.filter((r) => r.st === 'ready').length };
  $$('[data-dw-filt]').forEach((b) => { const x = b.querySelector('b'); if (x) x.textContent = n[b.dataset.dwFilt]; });
  $('#dwList').innerHTML = list.length ? list.slice(0, 300).map(({ l, st }) => `<button type="button" class="dw-dr${String(l.id) === String(sel) ? ' on' : ''}" data-dw-pick="${esc(l.id)}" aria-current="${String(l.id) === String(sel)}">`
    + `<span class="dw-dot d-${DOT[st]}" title="${esc(DC.ROW[st][0])}"></span><span class="dw-dr-t"><b>${esc(l.name)}</b><small>${esc([l.web_code, l.category].filter(Boolean).join(' · '))}${l.outside ? ' · ยานอก' : ''}</small></span></button>`).join('')
    : '<p class="empty small">ไม่พบยา</p>';
}

/* ---------- สิ่งที่ยังค้าง (ปุ่มถัดไป · แถบล่าง) ---------- */
function todo(l, j) {
  const t = [];
  if (['miss', 'err', 'wait'].includes(j.str.s)) t.push({ go: 'head', text: j.str.s === 'wait' ? 'ตรวจข้อมูลยา (คิดเป็น)' : 'กรอกข้อมูลยา (ความแรง)' });
  for (const [k] of SRCS) if (k !== 'mims' && ['miss', 'err', 'wait'].includes(j[k].s)) t.push({ go: `src:${k}`, text: `ผูก ${SRCN[k]}` });
  if (j.dose.s !== 'na') {
    const on = cards.filter((c) => c.on);
    if (!on.length) t.push({ go: 'dose', text: 'เพิ่ม/เลือกข้อบ่งใช้' });
    cards.forEach((c, k) => { if (c.on && !c.ok) t.push({ go: `card:${k}`, text: `ตรวจข้อบ่งใช้ ${k + 1}` }); });
    if (on.length && on.every((c) => c.ok) && (dirty || j.dose.s !== 'ok')) t.push({ go: 'save', text: 'อนุมัติใช้คำนวณ' });
  }
  return t;
}
function steps(l, j) {
  const src = SRCS.filter(([k]) => k !== 'mims' && j[k].s !== 'na'), okSrc = src.filter(([k]) => j[k].s === 'ok').length;
  const on = cards.filter((c) => c.on), test = on.length ? testDose({ ...(j.dose.dose || {}), indications: on.map((c) => cleanInd(c.ind)) }, [l]) : null;
  const na = j.dose.s === 'na' && !on.length;
  const st = (ok, warn) => (ok ? 'ok' : warn ? 'warn' : '');
  return [
    ['pill', 'ข้อมูลยา', st(j.str.s === 'ok' || j.str.s === 'na', j.str.s === 'err')],
    ['link', `แหล่งข้อมูล ${okSrc}/${src.length}`, st(okSrc === src.length, src.some(([k]) => j[k].s === 'err'))],
    ['scale', 'ขนาดยา', na ? 'ok' : st(on.length && on.every((c) => c.ok), false)],
    ['flask', 'ทดสอบสูตร', na ? 'ok' : st(test && test.status !== 'fail', test?.status === 'fail')],
    ['bolt', 'พร้อมใช้คำนวณ', na ? 'ok' : st(j.dose.s === 'ok' && !dirty && l.active, false)],
  ];
}

/* ---------- หัวยา ---------- */
function headHtml(l, j) {
  const tasks = todo(l, j), done = [j.str, j.rpst, j.fda, j.nlem, j.ddi, j.dose].filter((x) => x.s === 'ok' || x.s === 'na').length;
  const C = 2 * Math.PI * 26, st = strengthOf(l), cats = [...new Set(D.locals.map((x) => x.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
  const ings = (l.ingredients || []).filter((x) => +x.mg > 0);
  const strT = ings.length > 1 ? ings.map((x) => `${x.name} ${n2(+x.mg)}`).join(' + ') + ` ${DC.PER[ings[0].per] || ''}` : st ? `${n2(st.mg)} ${DC.PER[st.per]}${l.strength ? '' : ' (อ่านจากชื่อ)'}` : 'ยังไม่มีความแรง';
  const sp = steps(l, j);
  return `<section class="card dw-head" id="dwHead"><div class="dw-h1">`
    + `<div class="dw-ring" title="ครบ ${done} จาก 6 ส่วน"><svg viewBox="0 0 62 62"><circle cx="31" cy="31" r="26" class="dw-ring-bg"/><circle cx="31" cy="31" r="26" class="dw-ring-fg" stroke-dasharray="${(C * done / 6).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 31 31)"/></svg><b>${done}/6</b></div>`
    + `<div class="dw-ttl">${edit === 'name' ? `<div class="dw-inl"><input id="dwName" class="input" maxlength="200" value="${esc(l.name)}" aria-label="ชื่อยา"><button type="button" class="btn btn-p btn-sm" data-dw-hsave="name">บันทึก</button><button type="button" class="btn btn-o btn-sm" data-dw-hcancel>ยกเลิก</button></div>`
      : `<h3><button type="button" class="dw-name" data-dw-hedit="name" title="แก้ชื่อยา">${esc(l.name)} <span class="dw-pen">✎</span></button></h3>`}`
    + `<div class="dw-chips">${codeTag(l)}<label class="dw-chip">${ic('pill')}<select id="dwCat" aria-label="รูปแบบยา">${cats.map((c) => `<option${c === l.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>`
    + `<button type="button" class="dw-chip p${j.str.s === 'ok' ? '' : ' warn'}" data-dw-hedit="drug" title="แก้ข้อมูลยาแบบละเอียด (สารสำคัญ · ความแรง · บรรจุ · หมายเหตุ)">${esc(strT)}${st?.as ? ` · คิดเป็น ${esc(st.as.name)} ${n2(+st.as.mg)}` : ''} <span class="dw-pen">✎</span></button>`
    + `${l.outside ? '<span class="dw-tag t-man">ยานอก รพ.สต.</span>' : ''}${l.active ? '' : '<span class="dw-tag t-man">ซ่อนจากหน้าหลัก</span>'}<button type="button" class="dw-chip" data-dw-hist aria-expanded="${!!hist}">${ic('clock')}ประวัติแก้ไข</button></div>`
    + `<div class="dw-acts"><button type="button" class="btn btn-o btn-sm" data-dw-hide title="${l.active ? 'ซ่อนจากประชาชน/เจ้าหน้าที่ (ข้อมูลยังอยู่ แสดงใหม่ได้)' : 'แสดงยานี้ที่หน้าหลัก/เครื่องคำนวณ'}">${l.active ? '🙈 ซ่อนยานี้' : '👁 แสดงยานี้'}</button>`
    + `<button type="button" class="btn btn-o btn-sm dw-deldrug" data-dw-deldrug title="ย้ายลงถังยาที่ลบ (เรียกคืนได้ 7 วัน)">${ic('trash')}ลบยานี้</button></div>`
    + (edit === 'drug' ? drugEditor(l) : '') + (j.str.why && edit !== 'drug' ? `<p class="small ${j.str.s === 'err' ? 'dc-err' : 'dc-warn'}">${esc(j.str.why)}</p>` : '') + '</div>'
    + `<button type="button" class="btn btn-p dw-next" data-dw-next>${tasks.length ? `ถัดไป: ${esc(tasks[0].text)}` : 'ยาตัวถัดไปที่ยังไม่เสร็จ'} ›</button></div>`
    + (hist ? histHtml() : '')
    + (prep ? `<p class="dw-prep" data-dw-prep>${ic('spark')}${esc(prep)}</p>` : '')
    + `<ol class="dw-steps">${sp.map(([i, t, s], k) => `<li class="dw-stp ${s}"><button type="button" data-dw-go="${['head', 'src', 'dose', 'dose', 'bar'][k]}"><span class="c">${ic(i)}</span><span>${esc(t)}</span></button></li>`).join('')}</ol></section>`;
}
/** ข้อมูลยาแบบละเอียด (local_drugs): ชื่อ · รูปแบบ · สารสำคัญ/ความแรง (แถวละสาร · 1 สาร = ยาเดี่ยว) · คิดเป็น · บรรจุ · หน่วยนับ · หมายเหตุ · แสดงที่หน้าหลัก */
function drugEditor(l) {
  const ings = l.ingredients || [], s0 = l.strength, cats = [...new Set(D.locals.map((x) => x.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
  const rows = ings.length ? ings.map((x) => ({ name: x.name, amt: x.amt ?? x.mg, u: x.u || 'mg', per: x.per || 'tab' })) : [{ name: '', amt: s0 ? (s0.u === 'mcg' ? s0.amt : s0.mg) : '', u: s0?.u || 'mg', per: s0?.per || 'tab' }];
  const bases = [...new Set([...basesOf(l), ...(s0?.as ? [s0.as.name] : [])])];
  return `<div class="dw-ded" id="dwDrugEd"><b class="small">${ic('pill')}ข้อมูลยา (แก้ละเอียด)</b>`
    + `<div class="dw-inl"><label class="dw-f dw-grow"><span>ชื่อยา</span><input id="dwEdName" class="input" maxlength="200" value="${esc(l.name)}"></label>`
    + `<label class="dw-f"><span>รูปแบบ</span><input id="dwEdCat" class="input" maxlength="100" list="dwCats" value="${esc(l.category || '')}"><datalist id="dwCats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label></div>`
    + `<div class="dw-f"><span>สารสำคัญ · ความแรง <small class="muted">(1 สาร = ยาเดี่ยว · 2 สารขึ้นไป = ยาสูตรผสม หน่วยเดียวกัน)</small></span><div id="dwIngRows">${rows.map(ingRowHtml).join('')}</div>`
    + `<div class="row-btns"><button type="button" class="btn btn-o btn-sm" data-dw-ingadd>${ic('plus')}เพิ่มสารสำคัญ</button></div></div>`
    + `<div class="dw-inl"><label class="dw-f"><span>คิดเป็น (สาร · ยาเดี่ยว)</span><input id="dwAsName" class="input" list="dwBases" maxlength="60" placeholder="เช่น Elemental iron" value="${esc(s0?.as?.name || '')}"><datalist id="dwBases">${bases.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></label>`
    + `<label class="dw-f"><span>คิดเป็น (มก.)</span><input id="dwAsMg" class="input" type="number" inputmode="decimal" min="0" step="0.001" value="${s0?.as ? esc(s0.as.mg) : ''}"></label>`
    + `<label class="dw-f"><span>บรรจุ</span><input id="dwEdPack" class="input" maxlength="40" value="${esc(l.pack_size || '')}"></label>`
    + `<label class="dw-f"><span>หน่วยนับ</span><input id="dwEdUnit" class="input" maxlength="40" value="${esc(l.unit || '')}"></label></div>`
    + `<label class="dw-f"><span>หมายเหตุ</span><input id="dwEdNote" class="input" maxlength="500" value="${esc(l.note || '')}"></label>`
    + `<label class="dw-use"><input type="checkbox" id="dwEdActive"${l.active ? ' checked' : ''}> แสดงยานี้ที่หน้าหลัก/เครื่องคำนวณ</label>`
    + `<div class="row-btns"><button type="button" class="btn btn-p btn-sm" data-dw-hsave="drug">บันทึกข้อมูลยา</button><button type="button" class="btn btn-o btn-sm" data-dw-hcancel>ยกเลิก</button></div></div>`;
}
const ingRowHtml = (x = {}) => `<div class="dw-ing"><input class="input i-n" maxlength="60" placeholder="ชื่อสาร (ยาเดี่ยวเว้นว่างได้)" aria-label="ชื่อสารสำคัญ" value="${esc(x.name || '')}">`
  + `<input class="input i-a" type="number" inputmode="decimal" min="0" step="0.001" placeholder="ความแรง" aria-label="ความแรง" value="${esc(x.amt ?? '')}">`
  + `<select class="input i-u" aria-label="หน่วย">${DC.UNITS.map(([v, t]) => `<option value="${v}"${v === `${x.u || 'mg'}|${x.per || 'tab'}` ? ' selected' : ''}>${t}</option>`).join('')}</select>`
  + `<button type="button" class="dw-x" data-dw-ingrm aria-label="ลบสารนี้">×</button></div>`;

/* ---------- แหล่งข้อมูล ---------- */
function srcHtml(l, j) {
  const chips = SRCS.map(([k, t, i]) => {
    const x = j[k], c = DC.cellS(k, x.s), sg = ['miss', 'wait'].includes(x.s) ? suggest(l, k, j) : null;
    const tx = x.s === 'ok' || x.s === 'wait' ? (x.t || '').replace(/^[A-Z]+-[A-Z]-\d+ /, '').slice(0, 60) : x.s === 'na' ? 'ไม่ใช้กับยานี้' : x.s === 'err' ? 'ข้อมูลผิด · กดดู' : c === 'opt' ? 'ไม่บังคับ' : 'ยังไม่ผูก';
    return `<div class="dw-s s-${c}${pop === k ? ' open' : ''}${sg ? ' sg' : ''}" id="dwSrc-${k}"><button type="button" class="dw-s-b" data-dw-src="${k}" aria-expanded="${pop === k}"><span class="ic-w">${ic(i)}</span><b>${esc(t)}</b><span class="dw-s-t">${esc(tx)}</span></button>`
      + (sg?.strong ? `<button type="button" class="dw-mini" data-dw-sgok="${k}" data-target="${esc(sg.target)}">⚡ เสนอ ${sg.conf}% · ✓ ใช้</button>` : sg ? `<span class="dw-mini o">เสนอ ${sg.conf}% · กดดู</span>` : '') + '</div>';
  }).join('');
  return `<section class="card dw-src" id="dwSrcs"><div class="dw-sh">${ic('link')}<b>แหล่งข้อมูล</b><span class="dw-tag t-ok">กดชิป = ผูก/เปลี่ยนในที่</span></div><div class="dw-srow">${chips}</div>${pop ? popHtml(l, j, pop) : ''}</section>`;
}
function candidates(l, k) {
  const q = popQ.trim().toLowerCase(), has = (t) => !q || t.toLowerCase().includes(q);
  if (k === 'rpst') { const used = new Set(D.locals.map((x) => x.code).filter(Boolean)); return (D.rpst || []).filter((it) => !used.has(it.code)).map((it) => [it.code, `${it.code} · ${it.name}`]).filter(([, t]) => has(t)); }
  if (k === 'mims') return (D.mims || []).map((m) => [m.id, `${m.web_code ? m.web_code + ' · ' : ''}${m.name}`]).filter(([, t]) => has(t));
  if (k === 'fda') return D.fdas.map((f) => [f.key, `${f.title} · ${f.generic} (${f.route})`]).filter(([, t]) => has(t));
  if (k === 'nlem') { const on = new Set((l.mono_refs || []).map((r) => D.monos.find((m) => m.ref === r)?.name)); return [...new Set(D.monos.map((m) => m.name))].filter((n) => !on.has(n)).map((n) => [n, n]).filter(([, t]) => has(t)); }
  return D.ddDrugs.filter((x) => !(l.ddi_ids || []).includes(x.id)).map((x) => [x.id, `${x.web_code ? x.web_code + ' · ' : ''}${x.name}`]).filter(([, t]) => has(t));
}
function popHtml(l, j, k) {
  const x = j[k], sg = ['miss', 'wait'].includes(x.s) ? suggest(l, k, j) : null, na = (l.link_na || []).includes(k);
  const curs = k === 'nlem' ? [...new Set((l.mono_refs || []).map((r) => D.monos.find((m) => m.ref === r)?.name).filter(Boolean))].map((n) => [n, n])
    : k === 'ddi' ? (l.ddi_ids || []).map((i) => [i, D.ddDrugs.find((d) => d.id === i)?.name || i])
    : k === 'rpst' ? (l.code ? [[l.code, x.t || l.code]] : []) : k === 'mims' ? (l.mims_id ? [[l.mims_id, x.t || '']] : []) : (l.fda_key ? [[l.fda_key, x.t || l.fda_key]] : []);
  const cs = candidates(l, k).slice(0, 20);
  return `<div class="dw-pop" id="dwPop" data-k="${k}"><div class="dw-pop-h"><b>${esc(SRCN[k])}</b>${x.why ? `<span class="small ${x.s === 'err' ? 'dc-err' : 'muted'}">${esc(x.why)}</span>` : ''}<span class="sp"></span>${curs.length ? `<button type="button" class="dw-link" data-dw-dbed="${k}" aria-pressed="${dbEd?.k === k}">✎ แก้ไขรายละเอียด</button>` : ''}<button type="button" class="dw-link" data-dw-grid="${k}" title="เปิดตารางแก้ไขยา แสดงฐาน ${esc(SRCN[k])} ที่แถวยานี้">ดูในตาราง ›</button><button type="button" class="dw-x" data-dw-src="${k}" aria-label="ปิด">×</button></div>`
    + (sg ? `<div class="dw-sug"><span class="small muted">ระบบเสนอ</span><b>${esc(sg.label)}</b><div class="dc-ev">${sg.ev.map(([t, y]) => `<span class="${y ? 'y' : 'n'}">${y ? '✓' : '✗'} ${esc(t)}</span>`).join('')}</div>`
      + `<div class="row-btns"><button type="button" class="btn btn-p btn-sm" data-dw-sgok="${k}" data-target="${esc(sg.target)}"${sg.strong ? '' : ' disabled title="หลักฐานไม่ครบ · ตรวจแล้วเลือกจากรายการด้านล่าง"'}>✓ ใช้คู่นี้ (${sg.conf}%)</button><button type="button" class="btn btn-o btn-sm" data-dw-sgno="${k}" data-target="${esc(sg.target)}">✗ ไม่ใช่</button></div></div>` : '')
    + (curs.length ? `<div class="dw-cur">${curs.map(([v, t]) => `<span class="chip c-role"><button type="button" class="dw-chipgo" data-dw-dbed="${k}" data-key="${esc(v)}" title="กดเพื่อแก้ไขรายละเอียด">${esc(t)} ✎</button><button type="button" class="nt-x" data-dw-un="${esc(v)}" aria-label="เลิกผูก ${esc(t)}">×</button></span>`).join('')}</div>` : '')
    + (dbEd?.k === k ? dbEditorHtml(l, k, dbEd.key ?? curs[0]?.[0]) : '')
    + `<input id="dwSq" class="input" type="search" placeholder="พิมพ์ค้นหาใน ${esc(SRCN[k])}" value="${esc(popQ)}" aria-label="ค้นหาใน ${esc(SRCN[k])}">`
    + `<div class="dw-cands">${cs.map(([v, t]) => `<button type="button" class="dw-opt" data-dw-set="${esc(v)}">${esc(t)}</button>`).join('') || '<span class="small muted">ไม่พบ</span>'}</div>`
    + (k === 'fda' ? `<div class="row-btns"><button type="button" class="btn btn-o btn-sm" data-dw-fetch>ดึงฉลากจาก openFDA แล้วผูกเลย</button></div>${dailyMedHtml(l)}` : '')
    + (k === 'rpst' && !l.code ? `<div class="dw-mims dw-rpadd"><b class="small">ไม่พบในบัญชี? เพิ่มในบัญชียา รพ.สต. แล้วผูกกับยานี้เลย</b>`
      + `<div class="dw-inl"><label class="dw-f"><span>รหัสยาโรงพยาบาล</span><input id="dwRpCode" class="input" maxlength="30" autocomplete="off"></label><label class="dw-f dw-grow"><span>ชื่อในบัญชี</span><input id="dwRpName" class="input" maxlength="200" value="${esc(l.name)}"></label>`
      + `<label class="dw-f"><span>หน่วยนับ</span><input id="dwRpUnit" class="input" maxlength="40" placeholder="เช่น เม็ด, ขวด"></label></div>`
      + `<div class="row-btns"><button type="button" class="btn btn-p btn-sm" data-dw-rpadd>${ic('plus')}เพิ่มในบัญชีและผูก</button></div></div>` : '')
    + (k === 'mims' ? `<div class="dw-mims"><label class="small" for="dwMimsText"><b>วางข้อความหน้า MIMS ของยานี้</b> · แยกหัวข้อให้อัตโนมัติ + การ์ดข้อบ่งใช้ (ไม่ใช้ AI)</label><textarea id="dwMimsText" rows="4" maxlength="300000" placeholder="เปิดหน้ายาใน MIMS → เลือกทั้งหน้า → คัดลอก → วางที่นี่"></textarea><div id="dwMimsPre">${mimsPreviewHtml(mimsParsed)}</div><div class="row-btns"><button type="button" class="btn btn-p btn-sm" data-dw-mimssave${mimsParsed?.sections.length ? '' : ' disabled'}>บันทึกและผูกกับยานี้</button></div></div>` : '')
    + `<div class="row-btns"><button type="button" class="dc-na-t" data-dw-na="${k}">${na ? 'ต้องมีส่วนนี้ (ยกเลิก "ไม่ใช้")' : 'ไม่ใช้กับยานี้'}</button></div></div>`;
}

/* ---------- แก้ไขรายละเอียดแหล่งข้อมูล (ในแผง · ไม่ต้องเปิดเครื่องมือฐานข้อมูล) ---------- */
const fld = (id, label, val, attrs = '', wide = false) => `<label class="dw-f${wide ? ' dw-grow' : ''}"><span>${label}</span><input id="${id}" class="input" value="${esc(val ?? '')}" ${attrs}></label>`;
const area = (id, label, val, rows = 6, lang = '') => `<label class="dw-f"><span>${label}</span><textarea id="${id}" rows="${rows}"${lang ? ` lang="${lang}"` : ''}>${esc(val ?? '')}</textarea></label>`;
function dbEditorHtml(l, k, key) {
  const shared = (pred, code) => {   // ยาในเว็บแอพที่ผูกกับข้อมูลนี้ (แก้แล้วมีผลทุกตัว)
    const us = D.locals.filter(pred);
    return `<div class="dw-linked">${code ? `<span class="chip c-code">${esc(code)}</span>` : ''}<span class="small">${us.length > 1 ? `${ic('link')}ใช้ร่วมกับยา ${us.length} ตัว · แก้แล้วมีผลทุกตัว:` : `${ic('link')}ผูกกับยา:`}</span>`
      + us.slice(0, 12).map((x) => `<span class="dw-lk${x.id === l.id ? ' me' : ''}">${codeTag(x)}${esc(x.name)}</span>`).join('') + (us.length > 12 ? `<span class="small muted">และอีก ${us.length - 12}</span>` : '') + '</div>';
  };
  const foot = `<div class="row-btns"><button type="button" class="btn btn-p btn-sm" data-dw-dbsave="${k}" data-key="${esc(key ?? '')}">บันทึก</button><button type="button" class="btn btn-o btn-sm" data-dw-dbed="${k}">ปิด</button></div>`;
  let body = '';
  if (k === 'rpst') {
    const it = (D.rpst || []).find((x) => x.code === key); if (!it) return '<p class="small muted">ไม่พบรายการนี้ในบัญชียา รพ.สต.</p>';
    body = shared((x) => x.code === it.code, it.code)
      + `<div class="dw-inl">${fld('dwDbCode', 'รหัสยาโรงพยาบาล', it.code, 'maxlength="30"')}${fld('dwDbName', 'ชื่อในบัญชี', it.name, 'maxlength="200"', true)}</div>`
      + `<div class="dw-inl">${fld('dwDbCat', 'หมวด', it.category, 'maxlength="100"')}${fld('dwDbPack', 'บรรจุ', it.pack_size, 'maxlength="40"')}${fld('dwDbUnit', 'หน่วย', it.unit, 'maxlength="40"')}</div>`
      + `<label class="dw-use"><input type="checkbox" id="dwDbIn"${it.in_list !== false ? ' checked' : ''}> อยู่ในไฟล์บัญชีล่าสุด</label>`;
  } else if (k === 'mims') {
    const m = mimsOf(l); if (!m) return '';
    body = shared((x) => String(x.mims_id) === String(m.id), m.web_code)
      + `<div class="dw-inl">${fld('dwDbName', 'ชื่อยา (MIMS)', m.name, 'maxlength="200"', true)}${fld('dwDbUrl', 'ลิงก์หน้า MIMS', m.url, 'maxlength="300" placeholder="https://www.mims.com/thailand/drug/info/…"', true)}</div>`
      + area('dwDbSecs', 'หัวข้อและเนื้อหา (บรรทัด "## หัวข้อ" ตามด้วยเนื้อหา)', (m.sections || []).map((x) => `## ${x.title}\n${x.body}`).join('\n'), 10, 'en')
      + fld('dwDbNote', 'หมายเหตุ', m.note, 'maxlength="2000"', true);
  } else if (k === 'fda') {
    const f = fdaOf(l); if (!f) return '';
    body = shared((x) => x.fda_key === f.key, f.web_code)
      + `<div class="dw-inl">${fld('dwDbName', 'ชื่อฉลาก', f.title, 'maxlength="200"', true)}<span class="small muted">${esc(f.generic)} (${esc(f.route)})${f.effective ? ` · ฉบับ ${esc(f.effective)}` : ''}</span></div>`
      + area('dwDbSecs', 'ต้นฉบับภาษาอังกฤษ (## หัวข้อ)', sectionsText((f.sections || []).map((x) => ({ title: x.title, body: [x.body] }))), 8, 'en')
      + area('dwDbTh', 'ภาษาไทย (## หัวข้อ · บันทึกแล้ว = ตรวจแล้ว)', sectionsText(f.sections_th || []), 8)
      + `<div class="row-btns"><button type="button" class="btn btn-o btn-sm" data-dw-fdath>${ic('spark')}${f.sections_th?.length ? 'ให้ AI แปลไทยใหม่' : 'ให้ AI แปลไทย'}</button><span class="small muted">${f.th_reviewed ? 'ภาษาไทย · ตรวจแล้ว' : f.sections_th?.length ? 'ภาษาไทยจาก AI · รอตรวจ' : 'ยังไม่มีภาษาไทย'}</span></div>`;
  } else if (k === 'nlem') {
    const m = D.monos.find((x) => (l.mono_refs || []).includes(x.ref) && x.name === key) || D.monos.find((x) => x.name === key); if (!m) return '';
    body = shared((x) => (x.mono_refs || []).includes(m.ref), m.web_code)
      + `<div class="dw-inl">${fld('dwDbName', 'ชื่อยา', m.name, 'maxlength="300"', true)}${fld('dwDbGroup', 'กลุ่มยา', m.group_name, 'maxlength="200"', true)}${fld('dwDbSub', 'กลุ่มย่อย', m.sub_name, 'maxlength="200"', true)}</div>`
      + area('dwDbForms', 'รูปแบบ | บัญชี (บรรทัดละ 1)', formsText(m.forms), 3)
      + fld('dwDbFlags', 'หมายเหตุพิเศษ (คั่นด้วย ,)', (m.flags || []).join(', '), 'maxlength="300"', true)
      + area('dwDbSecs', 'หัวข้อและเนื้อหา (## หัวข้อ)', sectionsText(m.sections), 10);
  } else if (k === 'ddi') {
    const d = D.ddDrugs.find((x) => String(x.id) === String(key)); if (!d) return '';
    const mine = (ddPairs || []).filter((p) => p.a === d.id || p.b === d.id);
    body = shared((x) => (x.ddi_ids || []).includes(d.id), d.web_code || d.id)
      + `<div class="dw-inl">${fld('dwDbName', `ชื่อยาใน DDInter (${esc(d.id)})`, d.name, 'maxlength="200"', true)}</div>`
      + `<details class="dw-pairs" open><summary class="small"><b>คู่ interaction ของยานี้</b> ${ddPairs ? `(${mine.length})` : '· กำลังโหลด…'}</summary>`
      + (ddPairs ? (mine.length ? mine.map((p) => pairHtml(p, d.id)).join('') : '<p class="small muted">ไม่มีคู่ interaction กับยาอื่นในระบบ</p>') : '<div class="skeleton"></div>') + '</details>';
  }
  return `<div class="dw-dbed" id="dwDbEd" data-k="${k}"><b class="small">${ic('doc')}แก้ไขรายละเอียดใน ${esc(SRCN[k])}</b>${body}${foot}</div>`;
}
const ddN = (id) => D.ddDrugs.find((x) => x.id === id)?.name || id;
function pairHtml(p, me) {
  const o = p.a === me ? p.b : p.a;
  const users = D.locals.filter((x) => (x.ddi_ids || []).includes(o)).slice(0, 6);
  return `<details class="dw-pair" data-pair="${p.id}"><summary><b>× ${esc(ddN(o))}</b>${users.length ? `<span class="small muted">(${users.map((x) => esc(x.web_code || x.name)).join(', ')})</span>` : ''} <span class="dw-tag ${p.level === 'Major' ? 't-warn' : 't-man'}">${esc(p.level)}</span>${p.description_th ? `<span class="dw-tag ${p.th_reviewed ? 't-ok' : 't-ai'}">${p.th_reviewed ? 'ไทย · ตรวจแล้ว' : 'ไทย (AI)'}</span>` : '<span class="dw-tag t-man">ยังไม่มีไทย</span>'}</summary>`
    + `<label class="dw-f"><span>ระดับ</span><select class="input p-lv">${['Major', 'Moderate', 'Minor', 'Unknown'].map((x) => `<option${x === p.level ? ' selected' : ''}>${x}</option>`).join('')}</select></label>`
    + `<label class="dw-f"><span>คำอธิบาย (ไทย)</span><textarea class="p-dth" rows="3">${esc(p.description_th || '')}</textarea></label>`
    + `<label class="dw-f"><span>การจัดการ (ไทย)</span><textarea class="p-mth" rows="3">${esc(p.management_th || '')}</textarea></label>`
    + `<details class="small"><summary>ต้นฉบับภาษาอังกฤษ</summary><label class="dw-f"><span>Description</span><textarea class="p-d" rows="3" lang="en">${esc(p.description || '')}</textarea></label><label class="dw-f"><span>Management</span><textarea class="p-m" rows="3" lang="en">${esc(p.management || '')}</textarea></label></details>`
    + `<div class="row-btns"><button type="button" class="btn btn-p btn-sm" data-dw-pairsave="${p.id}">บันทึกคู่นี้</button><button type="button" class="btn btn-o btn-sm" data-dw-pairth="${p.id}">${ic('spark')}${p.description_th ? 'AI แปลใหม่' : 'ให้ AI แปลไทย'}</button></div></details>`;
}
function dailyMedHtml(l) {
  const g = genericKey(l.name);
  return `<details class="dw-dmd"${dmRes ? ' open' : ''}><summary class="small">ค้นฉลากใน DailyMed (ฉบับอื่น/ยี่ห้ออื่น)</summary><div class="dw-inl"><input id="dwDmQ" class="input dw-grow" maxlength="80" value="${esc(dmRes?.q || g)}" placeholder="ชื่อสามัญภาษาอังกฤษ" aria-label="ค้นใน DailyMed"><button type="button" class="btn btn-o btn-sm" data-dw-dmgo>ค้น</button></div>`
    + (dmRes ? (dmRes.list.length ? dmRes.list.map((x) => `<div class="dw-dmr"><span><b>${esc(x.title)}</b><small class="muted"> · ${esc(x.published_date || '-')}</small></span><a class="dw-link" href="https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${encodeURIComponent(x.setid)}" target="_blank" rel="noopener">เปิด</a><button type="button" class="btn btn-o btn-sm" data-dw-dmimp="${esc(x.setid)}">นำเข้าและผูก</button></div>`).join('') : `<p class="small muted">${esc(dmRes.msg || 'ไม่พบฉลาก')}</p>`) : '')
    + '</details>';
}
const H_FIELD = { name: 'ชื่อยา', strength: 'ความแรง', ingredients: 'สารสำคัญ', dose_id: 'ข้อมูลคำนวณ', indications: 'ข้อบ่งใช้/ขนาดยา', active: 'การแสดง', ai_draft: 'สถานะร่าง', concs: 'ความแรง (เดิม)', form: 'รูปแบบยา' };
const hVal = (v) => (v == null ? '–' : typeof v === 'object' ? (Array.isArray(v) ? `${v.length} รายการ` : JSON.stringify(v).slice(0, 80)) : String(v).slice(0, 80));
function histHtml() {
  if (hist === 'load') return '<div class="dw-hist"><div class="skeleton"></div></div>';
  if (hist.err) return `<div class="dw-hist"><p class="small dc-err">${esc(hist.err)}</p></div>`;
  return `<div class="dw-hist"><b class="small">${ic('clock')}ประวัติแก้ไข (ยานี้ + ข้อมูลคำนวณ · ล่าสุดก่อน)</b>${hist.list.length ? `<ol>${hist.list.map((h) => `<li><b>${esc(new Date(h.changed_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }))}</b> · ${esc(h.changer?.full_name || 'ระบบ')} · ${esc({ insert: 'เพิ่ม', update: 'แก้ไข', delete: 'ลบ' }[h.action] || h.action)} ${h.table_name === 'dose_drugs' ? '(ขนาดยา)' : ''}`
    + (h.action === 'update' ? `<ul>${(h.fields || []).filter((k) => H_FIELD[k]).map((k) => `<li>${esc(H_FIELD[k])}: <span class="muted">${esc(hVal(h.old_values?.[k]))}</span> → ${esc(hVal(h.new_values?.[k]))}</li>`).join('')}</ul>` : '') + '</li>').join('')}</ol>` : '<p class="small muted">ยังไม่มีประวัติการแก้ไข</p>'}</div>`;
}
async function loadHist(l, j) {
  hist = 'load'; renderMain();
  const q = (t, id) => sb.from('drug_data_history').select('id,table_name,action,fields,old_values,new_values,changed_at,changer:profiles!drug_data_history_changed_by_fkey(full_name)').eq('table_name', t).eq('row_id', id).order('changed_at', { ascending: false }).limit(30);
  const did = j.dose.dose?.id;
  const [a, b] = await Promise.all([q('local_drugs', l.id), did ? q('dose_drugs', did) : { data: [] }]);
  if (a.error || b.error) { hist = { err: errText(a.error || b.error) }; renderMain(); return; }
  hist = { list: [...a.data, ...b.data].sort((x, y) => String(y.changed_at).localeCompare(String(x.changed_at))).slice(0, 40) };
  renderMain();
}
async function loadPairs(l) {
  const ids = l.ddi_ids || []; if (!ids.length) { ddPairs = []; return; }
  const [a, b] = await Promise.all([sb.from('ddi_pairs').select('*').in('a', ids), sb.from('ddi_pairs').select('*').in('b', ids)]);
  if (a.error || b.error) { toast(errText(a.error || b.error), 'err'); ddPairs = []; return; }
  const seen = new Map(); [...a.data, ...b.data].forEach((p) => seen.set(p.id, p));
  ddPairs = [...seen.values()].sort((x, y) => ['Major', 'Moderate', 'Minor', 'Unknown'].indexOf(x.level) - ['Major', 'Moderate', 'Minor', 'Unknown'].indexOf(y.level));
}
/** บันทึกรายละเอียดแหล่งข้อมูลที่แก้ในแผง */
async function saveDb(l, k, key, btn) {
  const v = (id) => $(`#${id}`)?.value.trim() ?? '';
  const now = new Date().toISOString();
  busy(btn, true, 'กำลังบันทึก…');
  try {
    if (k === 'rpst') {
      const it = (D.rpst || []).find((x) => x.code === key), code = v('dwDbCode');
      if (!code || !v('dwDbName')) throw new Error('กรอกรหัสยาและชื่อในบัญชี');
      const { error } = await sb.from('rpst_list').update({ code, name: v('dwDbName'), category: v('dwDbCat') || 'อื่น ๆ', pack_size: v('dwDbPack'), unit: v('dwDbUnit'), in_list: $('#dwDbIn').checked }).eq('id', it.id);
      if (error) throw (/duplicate|23505/.test(errText(error) + error.code) ? new Error('รหัสยานี้มีในบัญชีแล้ว') : error);
      if (code !== it.code) { const { error: e2 } = await sb.from('local_drugs').update({ code, updated_at: now }).eq('code', it.code); if (e2) throw e2; }
    } else if (k === 'mims') {
      const m = mimsOf(l), url = v('dwDbUrl');
      if (url && !/^https:\/\/(www\.)?mims\.com\//.test(url)) throw new Error('ลิงก์ต้องเป็นหน้าเว็บ mims.com');
      const sections = parseSections($('#dwDbSecs').value).map((x) => ({ title: x.title, body: x.body.join('\n') })).filter((x) => x.body);
      const { error } = await sb.from('drug_mims').update({ name: v('dwDbName') || m.name, url: url || null, note: v('dwDbNote') || null, sections }).eq('id', m.id);
      if (error) throw error;
    } else if (k === 'fda') {
      const f = fdaOf(l);
      const sections = parseSections($('#dwDbSecs').value).map((x) => ({ title: x.title, body: x.body.join(' ') })).filter((x) => x.body);
      const th = parseSections($('#dwDbTh').value).map((x) => ({ title: x.title, body: x.body.map((t) => t.replace(/^[-•]\s*/, '')).filter(Boolean) })).filter((x) => x.body.length);
      const { error } = await sb.from('drug_fda_labels').update({ title: v('dwDbName') || f.title, sections, sections_th: th.length ? th : null, th_reviewed: th.length > 0, updated_at: now }).eq('id', f.id);
      if (error) throw error;
    } else if (k === 'nlem') {
      const m = D.monos.find((x) => (l.mono_refs || []).includes(x.ref) && x.name === key) || D.monos.find((x) => x.name === key);
      const row = { name: v('dwDbName') || m.name, group_name: v('dwDbGroup') || m.group_name, sub_name: v('dwDbSub'), forms: parseForms($('#dwDbForms').value), flags: v('dwDbFlags').split(',').map((x) => x.trim()).filter(Boolean), sections: parseSections($('#dwDbSecs').value), updated_at: now };
      const { error } = await sb.from('drug_monographs').update(row).eq('id', m.id);
      if (error) throw error;
      Object.assign(m, row);
    } else if (k === 'ddi') {
      const d = D.ddDrugs.find((x) => String(x.id) === String(key)), name = v('dwDbName');
      if (!name) throw new Error('กรอกชื่อยา');
      const { error } = await sb.from('ddi_drugs').update({ name, updated_at: now }).eq('id', d.id);
      if (error) throw error;
      d.name = name;
    }
    toast(`บันทึกข้อมูล ${SRCN[k]} แล้ว`);
    dbEd = null;
    const keep = dirty ? cards : null;
    await reloadDrugData(k === 'fda'); await refresh(!keep); if (keep) { cards = keep; renderMain(); }
  } catch (err) { toast(errText(err), 'err'); } finally { busy(btn, false); }
}
async function pairSave(id, btn) {
  const box = btn.closest('[data-pair]'), p = ddPairs.find((x) => x.id === id), th = box.querySelector('.p-dth').value.trim();
  const row = { level: box.querySelector('.p-lv').value, description_th: th || null, management_th: box.querySelector('.p-mth').value.trim() || null, th_reviewed: !!th, description: box.querySelector('.p-d').value.trim(), management: box.querySelector('.p-m').value.trim(), updated_at: new Date().toISOString() };
  busy(btn, true, 'กำลังบันทึก…');
  const { error } = await sb.from('ddi_pairs').update(row).eq('id', id);
  busy(btn, false);
  if (error) { toast(errText(error), 'err'); return; }
  Object.assign(p, row); toast('บันทึกคู่ interaction แล้ว'); renderMain();
}
/** AI แปลไทย (ฉลาก/คู่ยา) · ทีละรายการ · poll จนเสร็จ */
async function aiTh(start, poll, id, btn) {
  busy(btn, true, 'AI กำลังแปล…');
  try {
    const { error } = await sb.rpc(start, { p_id: id }); if (error) throw error;
    let r = { th_status: 'pending' };
    for (let i = 0; r.th_status === 'pending' && i < 80; i++) { await new Promise((ok) => setTimeout(ok, i ? 2500 : 1000)); const { data, error: e2 } = await sb.rpc(poll, { p_id: id }); if (e2) throw e2; r = data; }
    if (r.th_status !== 'done') throw new Error(r.th_note || 'AI ยังแปลไม่เสร็จ กรุณาลองใหม่');
    toast('AI แปลเป็นภาษาไทยแล้ว · ตรวจแล้วกดบันทึก');
    return r;
  } catch (err) { toast(errText(err), 'err'); return null; } finally { busy(btn, false); }
}
async function dmSearch(btn) {
  const q = $('#dwDmQ').value.trim(); if (q.length < 2) { toast('พิมพ์ชื่อยาภาษาอังกฤษ', 'err'); return; }
  busy(btn, true, 'กำลังค้น…');
  try {
    const { data: id, error } = await sb.rpc('dailymed_search', { p_q: q }); if (error) throw error;
    let r = { status: 'pending' };
    for (let i = 0; r.status === 'pending' && i < 20; i++) { await new Promise((ok) => setTimeout(ok, i ? 1500 : 800)); const { data, error: e2 } = await sb.rpc('dailymed_result', { p_id: id }); if (e2) throw e2; r = data; }
    if (r.status !== 'done') throw new Error('DailyMed ไม่ตอบ กรุณาลองใหม่');
    dmRes = { q, list: r.data || [], msg: (r.data || []).length ? '' : 'ไม่พบฉลากใน DailyMed · ลองชื่อสามัญที่สหรัฐฯ ใช้' };
  } catch (err) { toast(errText(err), 'err'); } finally { busy(btn, false); }
  renderMain();
}
async function dmImport(l, setid, btn) {
  busy(btn, true, 'กำลังนำเข้า…');
  try {
    const row = await fetchFdaBySetId(setid);
    if (!row?.sections?.length) throw new Error('openFDA ไม่มีฉลากชุดนี้ (DailyMed มีแต่ openFDA ยังไม่อัปเดต)');
    const { error } = await sb.from('drug_fda_labels').upsert({ ...row, fetched_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    await reloadDrugData(true); dmRes = null; pop = null;
    await saveLocal({ fda_key: row.key }, `นำเข้าและผูกฉลาก "${row.title}" แล้ว`);
  } catch (err) { toast(errText(err), 'err'); } finally { busy(btn, false); }
}

/* ---------- การ์ดขนาดยา ---------- */
/** ผลตรวจการ์ด: โครงสร้าง → ทดสอบสูตร + กฎความปลอดภัยของข้อนี้ → กฎที่ต้องดูข้ออื่น (ช่วงอายุขาดตอน · เด็กเกินผู้ใหญ่) จากทุกข้อที่ใช้
 *  → { status, text, issues: [ข้อความ], warns: [ข้อความเตือนที่ต้องรับทราบ] } */
function cardTest(l, j, c) {
  const i = cleanInd(c.ind), p = indsProblem([i]);
  if (p) return { status: 'fail', text: p.replace(/^ข้อบ่งใช้ 1: /, ''), issues: [p], fails: [p.replace(/^ข้อบ่งใช้ 1: /, '')], warns: [] };
  const t = testDose({ ...(j.dose.dose || {}), indications: [i] }, [l]);
  const strip = (s) => s.replace(/^ข้อบ่งใช้ 1(?: \([^)]*\))?(?: · [^:]*)?: /, '');
  const on = cards.filter((x) => x.on || x === c), at = on.indexOf(c);
  const cross = at < 0 ? [] : drugRules(on.map((x) => cleanInd(x.ind))).filter((x) => x.cross && x.k === at);
  const all = [...t.issues.map((x) => ({ sev: x.sev, text: strip(x.text) })), ...cross.map((x) => ({ sev: x.sev, text: x.text }))];
  const status = all.some((x) => x.sev === 'fail') ? 'fail' : all.length ? 'warn' : 'pass';
  const top = all.find((x) => x.sev === 'fail') || all[0];
  // แก้ช่วงอายุได้ในคลิกเดียว: ช่องอายุไม่ตรงชื่อ → ใช้อายุตามชื่อ · ช่วงอายุขาดตอน → ต่อช่วงของข้อก่อนหน้า
  const ageW = (a, b) => (b == null || b >= OPEN_AGE ? `${a} ปีขึ้นไป` : `${a}–${b} ปี`);
  // แก้คลิกเดียวจากกฎ: อายุตามชื่อ · ต่อช่วงอายุที่ขาด · เพดานที่คิดจากขนาดคงที่ · เพดานจากขนาดผู้ใหญ่
  const rs = at < 0 ? indRules(i) : drugRules(on.map((x) => cleanInd(x.ind))).filter((x) => x.k === at);
  const fixes = rs.filter((x) => x.fix).map((x) => {
    const { k: fk, label, ...set } = x.fix, tc = fk != null ? on[fk] : c;
    return tc && { k: cards.indexOf(tc), set, label: label || `ใช้ช่วงอายุตามชื่อ (${ageW(set.age_min, set.age_max)})` };
  }).filter(Boolean);
  c.ageFixes = fixes;
  return { status, text: top ? top.text : 'ผ่านทุกน้ำหนักตัวอย่าง', issues: all.map((x) => x.text), fails: all.filter((x) => x.sev === 'fail').map((x) => x.text), warns: all.filter((x) => x.sev === 'warn').map((x) => x.text), fixes };
}
const unitTh = (i) => `${i.unit === 'mcg' ? 'mcg' : 'มก.'}${i.fixed ? '' : '/กก.'}${i.per === 'day' ? '/วัน' : '/ครั้ง'}`;
function ageSel(i) {
  const a = i.age_min ?? 0, b = i.age_max ?? Infinity;
  const on = AGES.filter(([, , , lo, hi]) => lo >= a && (hi ?? Infinity) <= b).map(([k]) => k);
  const aligned = (i.age_min == null || AGES.some(([, , , lo]) => lo === i.age_min)) && (i.age_max == null || AGES.some(([, , , , hi]) => hi === i.age_max));
  return { on: i.age_min == null && i.age_max == null ? [] : on, aligned };
}
function cardHtml(l, j, c, k) {
  const i = c.ind, t = cardTest(l, j, c), foc = k === focus;
  if (c.ok && !c.open) {   // ตรวจแล้ว = ย่อเหลือบรรทัดเดียว (กด "แก้" เพื่อเปิด)
    return `<div class="dw-card sm${c.on ? '' : ' off'}${foc ? ' foc' : ''}" data-card="${k}"><span class="dw-tag t-ok">${ic('tick')}ตรวจแล้ว</span><span class="dw-sum"><b>${esc(i.name || 'ข้อบ่งใช้')}</b> · ${esc(sumText(i))}</span><button type="button" class="btn btn-o btn-sm" data-dw-open="${k}">แก้</button></div>`;
  }
  const ag = ageSel(i), times = timesOf(i), custom = c.ageCustom || !ag.aligned, ac = autoCaps(cleanInd(i));
  const st = c.ok ? '<span class="dw-tag t-ok">✓ ตรวจแล้ว</span>' : c.ai ? `<span class="dw-tag t-ai">${ic('spark')}AI ${c.fixed ? 'แก้' : 'ร่าง'} · รอตรวจ</span>` : c.skip ? '<span class="dw-tag t-warn">ยังไม่ครบ</span>' : '<span class="dw-tag t-man">' + ic('user') + 'กรอกเอง</span>';
  const fixBox = auditHtml(j, c, k) + (c.fix ? fixHtml(c, k) : c.filled ? filledHtml(c, k) : '');
  return `<div class="dw-card${foc ? ' foc' : ''}${c.on ? '' : ' off'}" data-card="${k}" id="dwCard-${k}">`
    + `<div class="dw-ch"><label class="dw-use" title="ใช้ข้อบ่งใช้นี้ในเครื่องคำนวณ"><input type="checkbox" data-dw-on="${k}"${c.on ? ' checked' : ''}> ใช้</label>`
    + `<input class="input dw-iname" data-k="${k}" data-f="name" maxlength="200" placeholder="ชื่อข้อบ่งใช้ เช่น ลดไข้" value="${esc(i.name || '')}" aria-label="ชื่อข้อบ่งใช้ ${k + 1}">`
    + `${st}${srcKind(i) === 'manual' ? '' : `<span class="dw-tag t-src">${esc(srcTag(i))}</span>`}<button type="button" class="dw-x" data-dw-del="${k}" aria-label="ลบข้อบ่งใช้ ${k + 1}">×</button></div>`
    + (c.skip ? `<p class="small dc-warn">${esc(c.skip)}</p>` : '')
    + `<div class="dw-row"><span class="dw-lbl">ใคร</span>${AGES.map(([a, t1, t2, , , icn]) => `<button type="button" class="dw-opt2${ag.on.includes(a) && !custom ? ' on' : ''}" data-dw-age="${a}" data-k="${k}" aria-pressed="${ag.on.includes(a) && !custom}">${ic(icn, 'lg')}<span>${t1}</span><small>${t2}</small></button>`).join('')}`
    + `<button type="button" class="dw-link" data-dw-agec="${k}">${custom ? 'ใช้ปุ่มกลุ่มอายุ' : 'ระบุอายุเอง'}</button></div>`
    + (custom ? `<div class="dw-row"><span class="dw-lbl"></span><label class="dw-f s"><span>อายุตั้งแต่ (ปี)</span><input class="input" type="number" min="0" max="120" step="0.1" data-k="${k}" data-f="age_min" value="${esc(i.age_min ?? '')}" placeholder="ไม่จำกัด"></label><label class="dw-f s"><span>ถึงก่อน (ปี) · ว่าง = ไม่จำกัด</span><input class="input" type="number" min="0" max="120" step="0.1" data-k="${k}" data-f="age_max" value="${esc(i.age_max ?? '')}" placeholder="ไม่จำกัด"></label></div>` : '')
    + `<div class="dw-row"><span class="dw-lbl">คิดแบบ</span><span class="dw-seg"><button type="button" class="dw-opt3${i.fixed ? '' : ' on'}" data-dw-set1="fixed:0" data-k="${k}">${ic('scale')}ตามน้ำหนัก</button><button type="button" class="dw-opt3${i.fixed ? ' on' : ''}" data-dw-set1="fixed:1" data-k="${k}">${ic('ruler')}ขนาดคงที่</button></span>`
    + `<span class="dw-seg"><button type="button" class="dw-opt3${i.per === 'day' ? '' : ' on'}" data-dw-set1="per:dose" data-k="${k}">${ic('one')}ต่อครั้ง</button><button type="button" class="dw-opt3${i.per === 'day' ? ' on' : ''}" data-dw-set1="per:day" data-k="${k}">${ic('cal')}ต่อวัน (แบ่งให้)</button></span>`
    + `<span class="dw-seg"><button type="button" class="dw-opt3${i.unit === 'mcg' ? '' : ' on'}" data-dw-set1="unit:mg" data-k="${k}">มก.</button><button type="button" class="dw-opt3${i.unit === 'mcg' ? ' on' : ''}" data-dw-set1="unit:mcg" data-k="${k}">mcg</button></span></div>`
    + `<div class="dw-row dw-mm"><span class="dw-lbl">ขนาด</span><label class="dw-num"><small>Min</small><input class="input" type="number" inputmode="decimal" min="0" step="0.01" data-k="${k}" data-f="min" value="${esc(i.min ?? '')}" aria-label="ขนาดต่ำสุด (Min)"></label><b>—</b>`
    + `<label class="dw-num"><small>Max</small><input class="input" type="number" inputmode="decimal" min="0" step="0.01" data-k="${k}" data-f="max" value="${esc(i.max ?? '')}" aria-label="ขนาดสูงสุด (Max)"></label><span class="dw-unit" data-dw-unit="${k}">${esc(unitTh(i))}</span></div>`
    + (i.per === 'day' ? `<div class="dw-row"><span class="dw-lbl">แบ่งให้</span>${TIMES.map((n) => `<button type="button" class="dw-opt3${times.includes(n) ? ' on' : ''}" data-dw-times="${n}" data-k="${k}" aria-pressed="${times.includes(n)}">${ic('clock')}${n}×</button>`).join('')}<span class="small muted">แตะหลายอัน = ให้ได้หลายแบบ</span></div>`
      : `<div class="dw-row"><span class="dw-lbl">ความถี่</span><input class="input dw-grow" maxlength="120" data-k="${k}" data-f="freq" value="${esc(i.freq || '')}" placeholder="เช่น ทุก 4–6 ชั่วโมง เมื่อมีอาการ"></div>`)
    + `<div class="dw-row"><span class="dw-lbl">เพดาน</span><label class="dw-cap">${ic('shield')}<span>ครั้งละ ≤</span><input class="input" type="number" inputmode="decimal" min="0" step="0.1" data-k="${k}" data-f="cap" value="${esc(i.cap ?? '')}" placeholder="${ac?.cap != null ? `= ${ac.cap}` : ''}" aria-label="ขนาดสูงสุดต่อครั้ง"><span>${i.unit === 'mcg' ? 'mcg' : 'มก.'}</span></label>`
    + `<label class="dw-cap">${ic('shield')}<span>วันละ ≤</span><input class="input" type="number" inputmode="decimal" min="0" step="0.1" data-k="${k}" data-f="cap_day" value="${esc(i.cap_day ?? '')}" placeholder="${ac?.cap_day != null ? `= ${ac.cap_day}` : ''}" aria-label="ขนาดสูงสุดต่อวัน"><span>${i.unit === 'mcg' ? 'mcg' : 'มก.'}</span></label></div>`
    + (ac ? `<p class="small muted dw-autocap" data-dw-autocap="${k}">ขนาดคงที่: เพดานคิดจากขนาดที่กรอกให้เอง (${[ac.cap != null ? `ครั้งละ ≤ ${ac.cap}` : '', ac.cap_day != null ? `วันละ ≤ ${ac.cap_day}` : 'วันละ = ใส่ตามฉลาก ถ้ามี (ขึ้นกับความถี่)'].filter(Boolean).join(' · ')}) · เว้นว่างได้</p>` : '')
    + (i.basis || comboName(l.name) || (l.ingredients || []).length > 1 || basesOf(l).length ? `<div class="dw-row"><span class="dw-lbl">คิดจากสาร</span><input class="input dw-grow" maxlength="60" data-k="${k}" data-f="basis" list="dwBasesC" value="${esc(i.basis || '')}" placeholder="ยาเดี่ยวเว้นว่าง · เช่น Trimethoprim, Elemental iron"><datalist id="dwBasesC">${[...new Set([...basesOf(l), ...(l.ingredients || []).map((x) => x.name)])].map((b) => `<option value="${esc(b)}">`).join('')}</datalist></div>` : '')
    + `<details class="dw-more"${c.open ? ' open' : ''}><summary>⋯ ละเอียดเพิ่ม ${['freq', 'renal', 'note', 'quote'].map((f2) => `<span class="dw-d${i[f2] ? ' y' : ''}" title="${{ freq: 'ความถี่', renal: 'ไต', note: 'หมายเหตุ', quote: 'ที่มา' }[f2]}"></span>`).join('')} <span class="small muted">ความถี่ · ไต · หมายเหตุ · ที่มา</span></summary>`
    + (i.per === 'day' ? `<label class="dw-f"><span>ความถี่ (ข้อความ)</span><input class="input" maxlength="120" data-k="${k}" data-f="freq" value="${esc(i.freq || '')}" placeholder="เช่น ทุก 8 ชั่วโมง"></label>` : '')
    + `<label class="dw-f"><span>ขนาดยาในโรคไต</span><textarea rows="2" maxlength="1000" data-k="${k}" data-f="renal">${esc(i.renal || '')}</textarea></label>`
    + `<label class="dw-f"><span>หมายเหตุ</span><input class="input" maxlength="500" data-k="${k}" data-f="note" value="${esc(i.note || '')}"></label>`
    + `<label class="dw-f"><span>ข้อความต้นฉบับที่ใช้ (ที่มา)</span><textarea rows="2" maxlength="400" data-k="${k}" data-f="quote" lang="en">${esc(i.quote || '')}</textarea></label>`
    + '</details>'
    + (i.ref?.label ? `<p class="small dw-ref" data-dw-ref="${k}">ที่มา: ${/^https:\/\//.test(i.ref.url || '') ? `<a href="${esc(i.ref.url)}" target="_blank" rel="noopener">${esc(i.ref.label)} ↗</a>` : esc(i.ref.label)}${/^AI ค้นจากเว็บ/.test(i.ref.label) ? ' · <b>เปิดลิงก์ตรวจตัวเลขก่อนกดตรวจแล้ว</b>' : ''}</p>` : '')
    + checkHtml(t, c, k) + fixBox + cfHtml(l, t, c, k)
    + '</div>';
}
const statusLine = (t) => (t.status === 'pass' ? `${ic('check')}ผ่านการทดสอบสูตรและกฎความปลอดภัย` : t.status === 'warn' ? `● ผ่าน · มีข้อควรตรวจ ${t.warns.length} ข้อ (ติ๊กรับทราบทีละข้อ)` : `! ยังไม่ผ่าน ${t.fails.length} ข้อ: แก้ตามรายการ หรือให้ AI ช่วยหาค่าพร้อมที่มา`);
/** รายการปัญหาของการ์ด: ไม่ผ่าน = ต้องแก้ · เตือน = ติ๊กรับทราบทีละข้อ (c.ack) */
function issuesHtml(t, c, k) {
  if (t.status === 'pass' || c.ok) return '';
  return `<ul class="dw-iss" data-dw-iss="${k}">${t.fails.map((x) => `<li class="t-fail">${esc(x)}</li>`).join('')}`
    + (t.fixes || []).map((f, n) => `<li class="dw-agefix"><button type="button" class="btn btn-o btn-sm" data-dw-agefix="${k}" data-n="${n}">${ic('tick')}${esc(f.label)}</button></li>`).join('')
    + t.warns.map((x) => `<li class="t-warn"><label><input type="checkbox" data-dw-ack="${k}" value="${esc(x)}"${(c.ack || []).includes(x) ? ' checked' : ''}> รับทราบ: ${esc(x)}</label></li>`).join('') + '</ul>';
}
/** สถานะตรวจ + รายการปัญหา (วาดใหม่ระหว่างพิมพ์ได้) */
const checkHtml = (t, c, k) => `<div class="dw-chk" data-dw-chk="${k}"><p class="dw-cst t-${t.status}" data-dw-cst="${k}">${statusLine(t)}</p>${issuesHtml(t, c, k)}</div>`;
/** ปุ่มท้ายการ์ด: ตรวจตัวเลขกับฉลากแล้ว (ไม่ผ่าน = ไม่มีปุ่ม · เตือน = ต้องรับทราบครบ) · ให้ AI ตรวจกับฉลาก / ค้นจากเว็บพร้อมลิงก์ · ข้อถัดไป */
function cfHtml(l, t, c, k) {
  const f = fdaOf(l);
  return `<div class="dw-cf" data-dw-cf="${k}">${t.status === 'fail' ? '' : `<button type="button" class="btn btn-p btn-sm" data-dw-ok="${k}"${c.ok || !acked(t, c) ? ' disabled' : ''} title="${acked(t, c) ? '' : 'ติ๊กรับทราบข้อควรตรวจทุกข้อก่อน'}">${ic('tick')}${c.ok ? 'ตรวจแล้ว' : 'ตรวจตัวเลขกับฉลากแล้ว'}</button>`}`
    + (t.status === 'pass' || c.ok ? '' : `<button type="button" class="btn ${t.status === 'fail' ? 'btn-p' : 'btn-o'} btn-sm" data-dw-fix="${k}"${f ? '' : ' disabled title="ยานี้ยังไม่ได้ผูกฉลาก OpenFDA+DailyMed"'}>${ic('spark')}ให้ AI ตรวจกับฉลาก</button>`
      + `<button type="button" class="btn btn-o btn-sm" data-dw-web="${k}" title="AI ค้นจากแหล่งที่เชื่อถือได้บนเว็บ แล้วเสนอค่าพร้อมลิงก์ให้เปิดตรวจ">${ic('spark')}ให้ AI ค้นจากเว็บพร้อมลิงก์</button>`)
    + `<button type="button" class="btn btn-o btn-sm" data-dw-skip="${k}">ข้อถัดไป ›</button></div>`;
}
/** เตือนทุกข้อติ๊กรับทราบแล้วหรือยัง */
const acked = (t, c) => c.ok || t.warns.every((x) => (c.ack || []).includes(x));
function sumText(i) {
  const a = i.age_min != null || i.age_max != null ? `อายุ ${i.age_min ?? 0}${i.age_max != null ? `–${i.age_max}` : '+'} ปี · ` : '';
  return `${a}${i.min ?? '?'}–${i.max ?? '?'} ${unitTh(i)}${i.per === 'day' && timesOf(i).length ? ` · วันละ ${timesOf(i).join(' หรือ ')} ครั้ง` : ''}${i.cap ? ` · ครั้งละ ≤ ${i.cap}` : ''}${i.cap_day ? ` · วันละ ≤ ${i.cap_day}` : ''}`;
}
const FLAB = { name: 'ชื่อ', per: 'ต่อครั้ง/ต่อวัน', fixed: 'ขนาดคงที่', unit: 'หน่วย', min: 'Min', max: 'Max', times: 'วันละ (ครั้ง)', times_alt: 'แบบอื่น', cap: 'ครั้งละไม่เกิน', cap_day: 'วันละไม่เกิน', age_min: 'อายุตั้งแต่', age_max: 'ถึงอายุ', freq: 'ความถี่', renal: 'ไต', note: 'หมายเหตุ', basis: 'คิดจากสาร', quote: 'ข้อความอ้างอิง' };
function fixHtml(c, k) {
  const f = c.fix;
  const web = f.mode === 'web';
  if (f.state === 'wait') return `<div class="dw-fix" data-dw-fixwait>${ic('spark')}${web ? 'AI กำลังค้นจากเว็บ (แหล่งที่เชื่อถือได้) พร้อมลิงก์อ้างอิง…' : 'AI กำลังตรวจกับฉลาก OpenFDA+DailyMed…'}</div>`;
  if (f.err) return `<div class="dw-fix bad">${esc(f.err)}</div>`;
  const r = f.res || {}, links = linksHtml(r);
  if (r.none) return `<div class="dw-fix bad" data-dw-fixnone>AI: ${esc(r.why || 'ไม่พบข้อมูลพอให้แก้')} · ${web ? 'แก้เองจากเอกสารกำกับยา' : 'ลอง "ให้ AI ค้นจากเว็บพร้อมลิงก์" หรือแก้เองจากต้นฉบับ'}${links}</div>`;
  if (r.rejected || !r.ind) return `<div class="dw-fix bad" data-dw-fixbad>ค่าที่ AI เสนอตรวจไม่ผ่าน จึงไม่ใช้: ${esc(r.why || f.note || '')} · แก้เองจากต้นฉบับ${links}</div>`;
  const old = cleanInd(c.ind), nw = r.ind, diff = Object.keys(FLAB).filter((x) => JSON.stringify(old[x] ?? null) !== JSON.stringify(nw[x] ?? null) && x !== 'name');
  return `<div class="dw-fix" data-dw-fixok data-mode="${web ? 'web' : 'label'}"><b>${ic('spark')}${web ? 'AI ค้นจากเว็บ เสนอค่า' : 'AI ตรวจกับฉลาก เสนอแก้'}</b>${r.why ? ` <span class="small">${esc(r.why)}</span>` : ''}<ul>${diff.map((x) => `<li>${esc(FLAB[x])}: <s>${esc(fmtv(old[x]))}</s> → <b>${esc(fmtv(nw[x]))}</b></li>`).join('') || '<li>ไม่มีค่าที่เปลี่ยน</li>'}</ul>`
    + (r.left ? `<p class="small dc-warn" data-dw-fixleft>ยังขาด: ${esc(r.left)}${web ? '' : ' · ลอง "ให้ AI ค้นจากเว็บพร้อมลิงก์"'}</p>` : '') + links
    + `<div class="row-btns"><button type="button" class="btn btn-p btn-sm" data-dw-fixuse="${k}">ใช้ค่าที่ AI เสนอ</button><button type="button" class="btn btn-o btn-sm" data-dw-fixno="${k}">ไม่ใช้</button></div>`
    + `<p class="small muted">${web ? '<b>ค่าจากเว็บยังไม่ได้ตรวจเทียบต้นฉบับโดยระบบ</b> · เปิดลิงก์ด้านบนตรวจตัวเลขเองก่อน · ' : ''}ใช้แล้วยังต้องตรวจและกด "ตรวจตัวเลขกับฉลากแล้ว" เอง</p></div>`;
}
/** ลิงก์ที่ AI ใช้ (ค้นจริงด้วย Google Search + ลิงก์ที่ AI ระบุเฉพาะเว็บที่ค้นเจอ) · https เท่านั้น */
function linksHtml(r) {
  const ls = [...(r.refs || []), ...(r.sources || [])].filter((x) => /^https:\/\//.test(x?.url || '')).slice(0, 8);
  return ls.length ? `<div class="dw-links" data-dw-links><span class="small muted">ลิงก์ให้เปิดตรวจ:</span>${ls.map((x) => `<a class="chip" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || 'แหล่งอ้างอิง')} ↗</a>`).join('')}</div>` : '';
}
const fmtv = (v) => (v == null ? '–' : Array.isArray(v) ? v.join(', ') : v === true ? 'ใช่' : String(v));
function doseHtml(l, j) {
  const x = j.dose, sibs = D.locals.filter((y) => y.id !== l.id && genericKey(y.name) === genericKey(l.name)).map((y) => rows.find((r) => r.l.id === y.id)).filter((r) => r?.j.dose.dose && (r.j.dose.dose.indications || []).length);
  if (x.s === 'na' && !cards.length) return `<section class="card dw-dose" id="dwDose"><div class="dw-sh">${ic('scale')}<b>ขนาดยา</b></div><p class="small muted">${esc(x.t || 'ยานี้ไม่ใช้คำนวณขนาดยา')}</p><div class="row-btns"><button type="button" class="dc-na-t" data-dw-na="dose">${(l.link_na || []).includes('dose') ? 'ต้องคำนวณขนาดยา (ยกเลิก "ไม่ใช้")' : 'ต้องคำนวณขนาดยา'}</button></div></section>`;
  const nAi = cards.filter((c) => c.on && c.ai && !c.ok).length;
  const ts = cards.filter((c) => c.on).map((c) => (c.ok ? 'ok' : cardTest(l, j, c).status)), nF = ts.filter((x) => x === 'fail').length, nW = ts.filter((x) => x === 'warn').length;
  return `<section class="card dw-dose" id="dwDose"><div class="dw-sh">${ic('scale')}<b>ขนาดยา · ข้อบ่งใช้</b>${nAi ? `<span class="dw-tag t-ai">${ic('spark')}AI ${nAi} ข้อ รอตรวจ</span>` : ''}${x.dose ? `<span class="small muted">${esc((x.t || '').replace(/^DOSE-\S+\s/, ''))}</span>` : ''}</div>`
    + (x.dose?.approved_at && x.dose.active ? `<div class="dw-chkall"><span class="small muted">AI ตรวจย้อนหลังยาที่อนุมัติแล้วกับฉลากทุกคืน</span><button type="button" class="btn btn-o btn-sm" data-dw-auditnow>${ic('spark')}ให้ AI ตรวจย้อนหลังยานี้ตอนนี้</button></div>` : '')
    + (ts.length ? `<div class="dw-chkall" data-dw-chkall><span class="small">${nF ? `<b class="dc-err">ไม่ผ่าน ${nF} ข้อ</b> · ` : ''}${nW ? `<span class="dc-warn">ควรตรวจ ${nW} ข้อ</span> · ` : ''}${!nF && !nW ? '<span class="dc-ok">ทุกข้อผ่านกฎความปลอดภัย</span> · ' : ''}ใช้ ${ts.length} ข้อ</span>`
      + `<button type="button" class="btn ${nF ? 'btn-p' : 'btn-o'} btn-sm" data-dw-aiall>${ic('spark')}ตรวจยานี้${nF ? ` + ให้ AI เติมข้อมูล ${nF} ข้อที่ไม่ผ่าน` : 'ทั้งตัว'}</button></div>` : '')
    + (cards.length ? cards.map((c, k) => cardHtml(l, j, c, k)).join('') : '<p class="empty small">ยังไม่มีข้อบ่งใช้ · เพิ่มเอง หรือให้ AI ร่างจากฉลาก</p>')
    + `<div class="dw-add"><button type="button" class="btn btn-o btn-sm" data-dw-addind>${ic('plus')}เพิ่มข้อบ่งใช้</button><button type="button" class="btn btn-o btn-sm" data-dw-ai>${ic('spark')}ให้ AI ร่างจากฉลาก</button>`
    + sibs.slice(0, 3).map((r) => `<button type="button" class="btn btn-o btn-sm" data-dw-copy="${esc(r.l.id)}">${ic('swap')}คัดลอกจาก ${esc(r.l.name)}</button>`).join('')
    + `<button type="button" class="dc-na-t" data-dw-na="dose">ยานี้ไม่ต้องคำนวณขนาดยา</button></div></section>`;
}

/* ---------- ด้านขวา: ต้นฉบับ + ผลคำนวณสด ---------- */
function mark(text, quote) {
  const t = String(text || '');
  const q = String(quote || '').replace(/\s+/g, ' ').trim();
  if (q.length < 8) return esc(t);
  const flat = t.replace(/\s+/g, ' '), at = flat.toLowerCase().indexOf(q.toLowerCase().slice(0, 160));
  if (at < 0) return esc(t);
  const len = Math.min(q.length, flat.length - at);
  return `${esc(flat.slice(0, at))}<mark>${esc(flat.slice(at, at + len))}</mark>${esc(flat.slice(at + len))}`;
}
function sourceHtml(l) {
  const f = fdaOf(l), m = mimsOf(l), c = cards[focus], q = c?.ind.quote || '';
  const tab = srcTab || (c && srcKind(c.ind) === 'mims' && m ? 'mims' : f ? 'fda' : m ? 'mims' : 'fda');
  let body;
  if (tab === 'fda') {
    const secs = f ? (f.sections || []).filter((s) => FDA_SECS.includes(s.title)) : [];
    body = !f ? `<p class="small muted">ยังไม่ได้ผูกฉลาก OpenFDA+DailyMed</p><button type="button" class="btn btn-o btn-sm" data-dw-src="fda">ผูกฉลาก</button>`
      : `<p class="small muted">${esc(f.title)} · ${esc(f.generic)} (${esc(f.route)})${f.set_id ? ` · <a href="https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${encodeURIComponent(f.set_id)}" target="_blank" rel="noopener">เปิด DailyMed</a>` : ''}</p>`
        + (secs.length ? secs.map((s) => `<div class="dw-sec"><b>${esc(s.title)}</b><p lang="en">${mark(s.body, q)}</p></div>`).join('') : '<p class="small muted">ฉลากนี้ไม่มีหัวข้อขนาดยา</p>');
  } else {
    const secs = m ? (m.sections || []) : [], main = secs.filter((s) => MIMS_MAIN.includes(s.title)), rest = secs.filter((s) => !MIMS_MAIN.includes(s.title));
    body = !m ? `<p class="small muted">ยังไม่ได้ผูก MIMS</p><button type="button" class="btn btn-o btn-sm" data-dw-src="mims">ผูก / วางข้อความหน้า MIMS</button>`
      : `<p class="small muted">${esc(m.name)}${m.url ? ` · <a href="${esc(m.url)}" target="_blank" rel="noopener">เปิด MIMS (ต้อง login)</a>` : ''}</p>`
        + (main.length ? main.map((s) => `<div class="dw-sec"><b>${esc(headTh(s.title))}</b><p lang="en">${mark(s.body, q)}</p></div>`).join('')
          : (m.indications || []).length ? (m.indications || []).map((i) => `<div class="dw-sec"><b>${esc(i.name)}</b><p>${esc(sumText(i))}${i.note ? ` · ${esc(i.note)}` : ''}</p></div>`).join('') + '<p class="small muted">ยังไม่มีข้อความเต็มของหน้า MIMS · กดผูก MIMS เพื่อวางข้อความ</p>' : '<p class="small muted">ยังไม่มีข้อความ</p>')
        + (rest.length ? `<details class="dw-rest"><summary class="small">หัวข้ออื่นของหน้า MIMS (${rest.length})</summary>${rest.map((s) => `<div class="dw-sec"><b>${esc(headTh(s.title))}</b><p lang="en">${esc(s.body)}</p></div>`).join('')}</details>` : '');
  }
  return `<section class="card dw-panel" id="dwSource"><div class="dw-sh">${ic('doc')}<b>ต้นฉบับ (เทียบข้างกัน)</b></div>`
    + `<div class="dw-tabs" role="group"><button type="button" class="dw-tab" data-dw-tab="fda" aria-pressed="${tab === 'fda'}">OpenFDA+DailyMed</button><button type="button" class="dw-tab" data-dw-tab="mims" aria-pressed="${tab === 'mims'}">MIMS</button>`
    + `${(tab === 'fda' ? f : m) ? `<button type="button" class="dw-link dw-srcedit" data-dw-srcedit="${tab}">✎ แก้ไขข้อมูล${tab === 'fda' ? 'ฉลากนี้' : ' MIMS'}</button>` : ''}</div>`
    + `<div class="dw-srcbody" id="dwSrcBody" data-tab="${tab}">${body}</div>`
    + `<div class="row-btns"><button type="button" class="btn btn-o btn-sm" data-dw-usesel>ใช้ข้อความที่เลือกเป็นที่มาของข้อ ${focus + 1}</button><button type="button" class="btn btn-o btn-sm" data-dw-newsel>${ic('plus')}สร้างข้อบ่งใช้จากข้อความที่เลือก</button></div>`
    + `<p class="small muted">${q ? 'ไฮไลต์ = ข้อความที่ข้อบ่งใช้นี้อ้าง' : 'ลากเลือกประโยคในต้นฉบับ แล้วกดปุ่มด้านบน'}</p></section>`;
}
function liveHtml(l, j) {
  const c = cards[focus];
  let body;
  if (!c) body = '<p class="small muted">เพิ่มข้อบ่งใช้เพื่อดูผลคำนวณ</p>';
  else {
    const i = cleanInd(c.ind), p = indsProblem([i]);
    if (p) body = `<p class="small dc-warn">${esc(p.replace(/^ข้อบ่งใช้ 1: /, ''))}</p>`;
    else {
      const ws = testWeights(i), w = ws.includes(wSel) ? wSel : ws[Math.min(1, ws.length - 1)], st = strengthOf(l);
      const conc = st ? { ...concOf(st, l.name), lname: l.name } : null, r = doseNumbers(i, w, conc), U = i.unit === 'mcg' ? 'mcg' : 'มก.';
      const v = r.vol, vu = v ? (v.u === 'tab' ? 'เม็ด' : 'มล.') : '';
      const big = r.basisMissing ? `กรอก "คิดเป็น ${esc(i.basis)}" ที่หัวยาก่อน` : r.comboMissing ? 'ยาสูตรผสม: ระบุ "คิดจากสาร"' : v ? `${rg(v.a, v.b)} ${vu}/ครั้ง` : `${rg(r.lo, r.hi)} ${U}/ครั้ง`;
      const tm = i.per === 'day' ? ` · วันละ ${i.times} ครั้ง` : i.freq ? ` · ${esc(i.freq)}` : '';
      const how = i.fixed ? `ขนาดคงที่ ${rg(i.min, i.max)} ${U}${i.per === 'day' ? '/วัน' : '/ครั้ง'}` : `${w} กก. × ${rg(i.min, i.max)} ${unitTh(i)} = ${i.per === 'day' ? `${rg(r.rawDayMin, r.rawDayMax)} ${U}/วัน → ` : ''}ครั้งละ ${rg(r.lo, r.hi)} ${U}`;
      body = `<div class="dw-ws" role="group" aria-label="น้ำหนักตัวอย่าง">${ws.map((x) => `<button type="button" class="dw-opt3${x === w ? ' on' : ''}" data-dw-w="${x}">${x ? `${x} กก.` : 'ทุกน้ำหนัก'}</button>`).join('')}</div>`
        + `<div class="dw-res"><span class="dw-big" data-dw-big>${big}${tm}</span><span class="small muted">${how}${st ? ` · ${esc(n2(st.mg))} ${esc(DC.PER[st.per])}` : ' · ยังไม่มีความแรง'}${r.capped || r.dayCapped ? ' · ถึงเพดาน' : ''}</span></div>`;
    }
  }
  const on = cards.filter((x) => x.on), t = on.length ? testDose({ ...(j.dose.dose || {}), indications: on.map((x) => cleanInd(x.ind)) }, [l]) : null;
  const tl = !t ? '' : t.status === 'pass' ? `<p class="dw-tl ok">${ic('check')}ทุกข้อที่ใช้ ผ่านทุกน้ำหนักตัวอย่าง</p>` : t.status === 'warn' ? `<p class="dw-tl warn">● ผ่าน · มีข้อควรตรวจ ${t.issues.length} ข้อ</p>` : '<p class="dw-tl bad">! ยังมีข้อที่ทดสอบสูตรไม่ผ่าน</p>';
  return `<section class="card dw-panel" id="dwLive"><div class="dw-sh">${ic('flask')}<b>ผลคำนวณสด · ข้อ ${focus + 1}</b><span class="dw-tag t-ok">ทดสอบสูตรอยู่ในหน้านี้</span></div>${body}${tl}</section>`;
}
function barHtml(l, j) {
  const t = todo(l, j), on = cards.filter((c) => c.on), d = j.dose.dose;
  const live = d && !d.ai_draft && d.active && !!d.approved_at && [l.dose_id, ...(l.ingredients || []).map((g) => g.dose_id)].includes(d.id);   // ยังไม่มีผู้อนุมัติ = ปุ่มอนุมัติ
  const allOk = on.length && on.every((c) => c.ok), test = on.length ? testDose({ ...(d || {}), indications: on.map((c) => cleanInd(c.ind)) }, [l]) : null;
  const can = allOk && !indsProblem(on.map((c) => cleanInd(c.ind))) && test?.status !== 'fail';
  const why = !on.length ? 'ยังไม่มีข้อบ่งใช้ที่ใช้' : !allOk ? 'ตรวจทุกข้อที่ใช้ก่อน (กด "ตรวจตัวเลขกับฉลากแล้ว")' : test?.status === 'fail' ? 'ยังไม่ผ่านการทดสอบสูตร/กฎความปลอดภัย' : '';
  return `<div class="card dw-bar" id="dwBar"><div class="dw-left"><b>${t.length ? `เหลืออีก ${t.length} อย่าง` : 'ครบแล้ว'}</b>${dirty ? ' <span class="dw-tag t-warn">ยังไม่บันทึก</span>' : ''}`
    + `<span class="small">${t.slice(0, 4).map((x) => `<button type="button" class="dw-link" data-dw-goto="${esc(x.go)}">${esc(x.text)}</button>`).join(' · ')}</span></div>`
    + `<div class="dw-leg"><span>${ic('spark', 'c-ai')}AI สร้าง</span><span>${ic('user')}กรอกเอง</span><span>${ic('tick', 'c-ok')}ตรวจแล้ว</span><span>${ic('bolt', 'c-p')}พร้อมคำนวณ</span></div>`
    + (j.dose.s === 'na' && !on.length ? '' : `<div class="row-btns">${live ? '' : `<button type="button" class="btn btn-o btn-sm" data-dw-save="draft"${on.length ? '' : ' disabled'}>บันทึกร่างไว้ก่อน</button>`}`
      + `<button type="button" class="btn btn-p" data-dw-save="${live ? 'save' : 'approve'}"${can && (dirty || !live) ? '' : ' disabled'} title="${esc(why)}">${ic('bolt')}${live ? 'บันทึกการแก้ไข' : 'อนุมัติใช้คำนวณ'}</button></div>`) + '</div>';
}

/* ---------- วาด ---------- */
function renderMain() {
  const r = cur(), el = $('#dwMain');
  if (!r) { el.innerHTML = `<p class="empty">${rows.length ? 'เลือกยาจากรายการด้านซ้าย' : 'ยังไม่มียา · พิมพ์ชื่อยาใหม่ด้านซ้าย'}</p>`; return; }
  const { l, j } = r;
  if (focus >= cards.length) focus = Math.max(0, cards.length - 1);
  const y = window.scrollY;
  el.innerHTML = headHtml(l, j) + srcHtml(l, j) + `<div class="dw-work">${doseHtml(l, j)}<div class="dw-side">${sourceHtml(l)}${liveHtml(l, j)}</div></div>` + barHtml(l, j);
  window.scrollTo(0, y);
}
function renderParts() {   // ระหว่างพิมพ์: วาดเฉพาะส่วนที่ขึ้นกับตัวเลข (ไม่วาดช่องกรอกใหม่ → เคอร์เซอร์ไม่หาย)
  const r = cur(); if (!r) return;
  cards.forEach((c, k) => {
    const el = document.querySelector(`[data-dw-chk="${k}"]`); if (!el) return;
    const t = cardTest(r.l, r.j, c); el.outerHTML = checkHtml(t, c, k);
    document.querySelector(`[data-dw-cf="${k}"]`)?.replaceWith(Object.assign(document.createElement('div'), { innerHTML: cfHtml(r.l, t, c, k) }).firstElementChild);
    const u = document.querySelector(`[data-dw-unit="${k}"]`); if (u) u.textContent = unitTh(c.ind);
  });
  $('#dwLive')?.replaceWith(Object.assign(document.createElement('div'), { innerHTML: liveHtml(r.l, r.j) }).firstElementChild);
  $('#dwBar')?.replaceWith(Object.assign(document.createElement('div'), { innerHTML: barHtml(r.l, r.j) }).firstElementChild);
}

/* ---------- การกระทำ ---------- */
function changed(k) { const c = cards[k]; if (!c) return; c.ok = false; dirty = true; }
function setAge(c, a) {
  const ag = ageSel(c.ind), on = new Set(ag.aligned ? ag.on : []);
  if (on.has(a)) on.delete(a); else on.add(a);
  const sel2 = AGES.filter(([x]) => on.has(x));
  c.ageCustom = false;
  if (!sel2.length) { c.ind.age_min = null; c.ind.age_max = null; return; }   // ไม่เลือก = ยังไม่ระบุ (กฎ: ต้องระบุ)
  const lo = Math.min(...sel2.map((x) => x[3])), his = sel2.map((x) => x[4]);
  c.ind.age_min = lo; c.ind.age_max = his.includes(null) ? null : Math.max(...his);   // ทุกกลุ่ม = ตั้งแต่ 0 ปี (ทุกอายุ)
}
function goTo(go) {
  if (!go) return;
  const [kind, arg] = go.split(':');
  if (kind === 'head') { edit = 'drug'; renderMain(); $('#dwHead')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
  if (kind === 'src') { pop = arg || null; popQ = ''; renderMain(); $('#dwSrcs')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
  if (kind === 'card') { focus = +arg; cards[focus].open = true; renderMain(); $(`#dwCard-${focus}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  if (kind === 'save' || kind === 'bar') { $('#dwBar')?.scrollIntoView({ block: 'end', behavior: 'smooth' }); return; }
  $('#dwDose')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function nextDrug() {
  const list = listRows(), at = list.findIndex((r) => String(r.l.id) === String(sel));
  const nx = list.slice(at + 1).find((r) => r.st !== 'ready') || list.find((r) => r.st !== 'ready' && String(r.l.id) !== String(sel));
  if (nx) select(nx.l.id); else toast('ไม่มียาที่ยังต้องทำแล้ว');
}
async function linkSet(l, k, v) {
  if (k === 'rpst') return saveLocal({ code: v, outside: false }, `ผูกบัญชียา รพ.สต. รหัส ${v} แล้ว`);
  if (k === 'mims') return saveLocal({ mims_id: idv(v) }, 'ผูก MIMS แล้ว');
  if (k === 'fda') return saveLocal({ fda_key: v }, 'ผูกฉลาก OpenFDA+DailyMed แล้ว');
  if (k === 'nlem') return saveLocal({ mono_refs: [...new Set([...(l.mono_refs || []), ...D.monos.filter((m) => m.name === v).map((m) => m.ref)])] }, 'ผูกบัญชียาหลักแล้ว');
  return saveLocal({ ddi_ids: [...new Set([...(l.ddi_ids || []), v])] }, 'ผูก DDInter แล้ว');
}
async function linkUnset(l, k, v) {
  if (k === 'rpst') { if (!confirm(`เลิกผูกกับบัญชียา รพ.สต. (รหัส ${l.code}) และตั้งเป็นยานอก รพ.สต.?`)) return; return saveLocal({ code: null, outside: true }, 'ตั้งเป็นยานอก รพ.สต. แล้ว'); }
  if (k === 'mims') return saveLocal({ mims_id: null }, 'เลิกผูก MIMS แล้ว');
  if (k === 'fda') return saveLocal({ fda_key: null }, 'เลิกผูกฉลากแล้ว');
  if (k === 'nlem') return saveLocal({ mono_refs: (l.mono_refs || []).filter((r) => D.monos.find((m) => m.ref === r)?.name !== v) }, 'เลิกผูกบัญชียาหลักแล้ว');
  return saveLocal({ ddi_ids: (l.ddi_ids || []).filter((x) => String(x) !== String(v)) }, 'เลิกผูก DDInter แล้ว');
}
async function saveDrug() {
  const r = cur(); if (!r) return; const l = r.l;
  const name = $('#dwEdName').value.trim().replace(/\s+/g, ' ');
  if (!name) { toast('กรุณาใส่ชื่อยา', 'err'); $('#dwEdName').focus(); return; }
  const ings = $$('#dwIngRows .dw-ing').map((x) => { const [u, per] = x.querySelector('.i-u').value.split('|'), a = +x.querySelector('.i-a').value; return { name: x.querySelector('.i-n').value.trim().replace(/\s+/g, ' '), amt: a > 0 ? a : null, u, per }; });
  let st;
  try { st = ingsRow(l, ings); } catch (err) { toast(err.message, 'err'); return; }
  const asN = $('#dwAsName').value.trim(), asMg = numv($('#dwAsMg').value) || 0;
  if (st.strength) {
    if (asN && !(asMg > 0)) { toast(`กรอกปริมาณ ${asN} ที่คิดเป็น (มก.)`, 'err'); return; }
    if (!asN && asMg > 0) { toast('กรอกชื่อสารในช่อง "คิดเป็น (สาร)"', 'err'); return; }
    const { as: _old, ...rest } = st.strength; st.strength = { ...rest, ...(asN ? { as: { name: asN, mg: asMg } } : {}) };
  } else if (asN && !st.ingredients) { toast('กรอกความแรงของยาก่อน แล้วจึงใส่ "คิดเป็น"', 'err'); return; }
  edit = null;
  await saveLocal({ name, category: $('#dwEdCat').value.trim() || l.category, pack_size: $('#dwEdPack').value.trim(), unit: $('#dwEdUnit').value.trim(), note: $('#dwEdNote').value.trim() || null, active: $('#dwEdActive').checked, ...st }, 'บันทึกข้อมูลยาแล้ว');
}
/** ส่งข้อที่ทดสอบสูตรไม่ผ่านให้ AI ตรวจกับฉลาก OpenFDA (87) → แสดงค่าที่เสนอให้ผู้ดูแลกดใช้ */
async function startFix(k, btn, mode = 'label') {
  const r = cur(), c = cards[k]; if (!r || !c) return false;
  const t = cardTest(r.l, r.j, c);
  busy(btn, true, 'กำลังส่ง…');
  try {
    const { data: id, error } = await sb.rpc(mode === 'web' ? 'ai_dose_web_start' : 'ai_dose_fix_start', { p_local: r.l.id, p_ind: cleanInd(c.ind), p_issues: t.issues.slice(0, 12) });
    if (error) throw error;
    c.fix = { state: 'wait', id, mode }; renderMain();
    for (let n = 0; n < 60; n++) {
      await new Promise((ok) => setTimeout(ok, n ? 3000 : 1200));
      const { data, error: e2 } = await sb.rpc('ai_dose_fix_poll', { p_id: id });
      if (e2) throw e2;
      if (data.status !== 'pending') { if (cards[k] === c) { c.fix = { state: 'done', mode, res: data.result, note: data.note }; if (!data.result && data.note) c.fix.err = data.note; renderMain(); } return true; }
    }
    c.fix = { state: 'done', err: 'หมดเวลารอ AI · ลองใหม่ หรือแก้เองจากต้นฉบับ' }; renderMain();
    return true;
  } catch (err) { toast(errText(err), 'err'); if (c.fix?.state === 'wait') { c.fix = null; renderMain(); } return false; } finally { busy(btn, false); }
}
/** ให้ AI ตรวจย้อนหลังยาที่อนุมัติแล้วตอนนี้ (91 dose_audit_now/poll) → ธงในการ์ด */
async function auditNow(l, j, btn) {
  const d = j.dose.dose; if (!d) return;
  busy(btn, true, 'AI กำลังตรวจกับฉลาก…');
  try {
    const { data: id, error } = await sb.rpc('dose_audit_now', { p_dose: d.id }); if (error) throw error;
    for (let n = 0; n < 70; n++) {
      await new Promise((ok) => setTimeout(ok, n ? 3000 : 1500));
      const { data, error: e2 } = await sb.rpc('dose_audit_poll', { p_id: id }); if (e2) throw e2;
      if (data.status === 'pending') continue;
      const fl = data.flags || [];
      prep = data.status !== 'done' ? `AI ตรวจย้อนหลังไม่สำเร็จ: ${data.note || ''}` : fl.length ? `AI ตรวจย้อนหลังพบ ${fl.length} ข้อ (ดูในการ์ด)` : 'AI ตรวจย้อนหลังแล้ว: ตรงกับฉลากทุกข้อ';
      await refresh(false); renderMain(); return;
    }
    prep = 'หมดเวลารอ AI · ระบบจะตรวจให้เองตอนกลางคืน'; renderMain();
  } catch (err) { toast(errText(err), 'err'); } finally { busy(btn, false); }
}
/** ตรวจยานี้ทั้งตัว + ให้ AI ช่วยทุกข้อที่ไม่ผ่าน (ทีละข้อ · ฉลาก OpenFDA ก่อน ไม่พอ = ค้นจากเว็บพร้อมลิงก์) */
async function aiAllCards(btn) {
  const r = cur(); if (!r) return;
  const bad = cards.map((c, k) => ({ c, k })).filter(({ c }) => c.on && !c.ok && cardTest(r.l, r.j, c).status === 'fail');
  if (!bad.length) { prep = cards.some((c) => c.on) ? 'ตรวจแล้ว: ทุกข้อที่ใช้ผ่านกฎความปลอดภัย · ข้อที่มีข้อควรตรวจ ติ๊กรับทราบแล้วกดตรวจตัวเลขกับฉลากแล้ว' : 'ยังไม่มีข้อบ่งใช้ · เพิ่มเอง หรือให้ AI ร่างจากฉลาก'; renderMain(); return; }
  busy(btn, true, 'AI กำลังเติมข้อมูล…');
  let filled = 0;
  try {
    const f = fdaOf(r.l);
    for (const [n, { c, k }] of bad.entries()) {
      if (cur() !== r || cards[k] !== c) break;
      prep = `AI กำลังหาค่า ข้อ ${k + 1} (${n + 1}/${bad.length})…`;
      if (f && !(await startFix(k, null, 'label'))) break;
      if (!(c.fix?.res?.ind && !c.fix.res.left)) {   // ฉลากไม่มี/ไม่พอ → ค้นจากเว็บ
        const lab = c.fix?.res?.ind ? c.fix : null;
        if (!(await startFix(k, null, 'web'))) break;
        if (!c.fix?.res?.ind && lab) c.fix = lab;   // เว็บไม่พบ = ใช้ค่าจากฉลาก
      }
      if (fillCard(r.l, c, k, c.fix)) filled++;   // เติมลงการ์ดเลย (ยังไม่บันทึก) · ไม่พบ = กล่องบอกเหตุผลค้างไว้
    }
    prep = `AI เติมข้อมูลให้แล้ว ${filled} จาก ${bad.length} ข้อที่ไม่ผ่าน · เปิดลิงก์ตรวจตัวเลขในแต่ละการ์ด แล้วกด "ตรวจตัวเลขกับฉลากแล้ว" และ "อนุมัติใช้คำนวณ" (ยังไม่บันทึก)`;
  } finally { busy(btn, false); renderMain(); }
}
/** ให้ AI ร่างขนาดยาจากฉลาก openFDA (50 ai_dose_start) → การ์ด "AI ร่าง" รอตรวจ (ยังไม่บันทึก) */
async function aiDraft(l, btn) {
  const q = doseQuery(String(l.name).replace(/\d.*$/, '')) || genericKey(l.name);
  if (btn) busy(btn, true, 'AI กำลังร่าง…');
  prep = `AI กำลังร่างขนาดยาจากฉลาก openFDA (${q})…`; renderMain();
  try {
    const { data: id, error } = await sb.rpc('ai_dose_start', { p_name: q });
    if (error) throw error;
    for (let n = 0; n < 60; n++) {
      await new Promise((ok) => setTimeout(ok, n ? 2500 : 1000));
      const { data, error: e2 } = await sb.rpc('ai_dose_poll', { p_id: id });
      if (e2) throw e2;
      if (data.status === 'pending') continue;
      const ai = data.result?.ai || [], ref = refOfLabel(data.result?.label);
      if (String(cur()?.l.id) === String(l.id) && ai.length) {
        ai.forEach((x) => cards.push({ ind: { ...x, ...(ref ? { ref } : {}) }, on: true, skip: null, ok: false, ai: true, fix: null, open: false }));
        dirty = true; focus = cards.length - ai.length;
      }
      prep = ai.length ? `AI ร่างขนาดยา ${ai.length} ข้อแล้ว · ตรวจกับต้นฉบับทีละข้อ` : (data.note || 'AI ไม่พบขนาดยาในฉลาก · กรอกเองจากต้นฉบับ');
      renderMain(); return;
    }
    prep = 'หมดเวลารอ AI · ลองใหม่ภายหลัง'; renderMain();
  } catch (err) { prep = ''; toast(errText(err), 'err'); renderMain(); } finally { if (btn) busy(btn, false); }
}
/** ดึงฉลาก openFDA (ข้อมูลสาธารณะ) เก็บในฐานข้อมูล · link = ผูกกับยานี้ด้วย */
async function fetchLabel(l, link) {
  const g = doseQuery(String(l.name).replace(/\d.*$/, '')) || genericKey(l.name);
  const row = await fetchFdaLabel(g, 'ORAL');
  if (!row?.sections?.length) throw new Error(`ไม่พบฉลาก "${g}" ใน openFDA · ลองค้น DailyMed ในเครื่องมือฐานข้อมูล`);
  const { error } = await sb.from('drug_fda_labels').upsert({ ...row, fetched_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
  await reloadDrugData(true);
  if (link) await saveLocal({ fda_key: row.key }, `ดึงและผูกฉลาก "${row.title}" แล้ว`);
  return row;
}
/** พิมพ์ชื่อยาใหม่ → สร้างยา (ผูกบัญชี รพ.สต. ถ้าชื่อตรง) → ดึงฉลาก + ให้ AI ร่างขนาดยา (รอตรวจ) */
async function addDrug(btn) {
  const name = $('#dwNew').value.trim().replace(/\s+/g, ' ');
  if (name.length < 2) { toast('พิมพ์ชื่อยา', 'err'); return; }
  const ex = D.locals.find((x) => norm(x.name) === norm(name));
  if (ex) { $('#dwNew').value = ''; select(ex.id); toast('มียานี้อยู่แล้ว · เปิดยานี้ให้'); return; }
  const it = (D.rpst || []).find((x) => norm(x.name) === norm(name)), used = it && D.locals.some((x) => x.code === it.code);
  const category = /SYR|SUSP|SOLN|ELIXIR|\bML\b|น้ำ/i.test(name) ? 'ยาน้ำรับประทาน' : /TAB|CAP|\bMG\b|เม็ด/i.test(name) ? 'ยาเม็ด/แคปซูล' : 'อื่น ๆ';
  busy(btn, true, 'กำลังเพิ่ม…');
  try {
    const { data, error } = await sb.from('local_drugs').insert({ name, category, code: it && !used ? it.code : null, outside: !(it && !used), active: false }).select().single();
    if (error) throw error;
    $('#dwNew').value = ''; filt = 'all';
    await refresh(false); select(data.id, false);
    prep = 'AI กำลังเตรียม: ดึงฉลาก openFDA…'; renderMain();
    const l = cur()?.l;
    try { await fetchLabel(l, false); } catch { /* ไม่พบฉลาก = ข้าม */ }
    rows = await centerRows(true); D = await drugData(); renderMain();
    await aiDraft(cur().l, null);
  } catch (err) { toast(errText(err), 'err'); } finally { busy(btn, false); }
}
async function saveCards(mode, btn) {
  const r = cur(); if (!r) return;
  const bad = cards.map((c, k) => (c.on ? indsProblem([cleanInd(c.ind)]) && k : null)).filter((x) => x != null && x !== false);
  if (bad.length) { toast(`ข้อบ่งใช้ ${bad[0] + 1} ยังกรอกไม่ครบ`, 'err'); goTo(`card:${bad[0]}`); return; }
  if (mode !== 'draft' && cards.some((c) => c.on && !c.ok)) { const k = cards.findIndex((c) => c.on && !c.ok); toast(`ตรวจข้อบ่งใช้ ${k + 1} ก่อน (กด "ตรวจตัวเลขกับฉลากแล้ว")`, 'err'); goTo(`card:${k}`); return; }
  const rowsOut = cards.map((c) => ({ ind: { ...cleanInd(c.ind), ...(mode === 'draft' && c.ok ? { checked: true } : {}) }, on: c.on, skip: c.on ? null : c.skip }));
  busy(btn, true, 'กำลังบันทึก…');
  try {
    const { sib } = await saveDose(r.l, r.j, rowsOut, mode);
    toast(mode === 'draft' ? 'บันทึกเป็นร่างแล้ว (ยังไม่ใช้คำนวณ)' : mode === 'approve' ? `อนุมัติแล้ว · ใช้คำนวณได้${sib.length ? ` (ใช้ร่วมกับ ${sib.map((x) => x.name).join(', ')})` : ''}` : 'บันทึกแล้ว');
    dirty = false; prep = '';
    await refresh(true);
  } catch (err) { toast(errText(err), 'err'); } finally { busy(btn, false); }
}
/** ลบยานี้ = ย้ายลงถังยาที่ลบ (drug-trash.js · 7 วัน) → เปิดยาตัวถัดไป */
async function delDrug(l, btn) {
  const list = listRows(), at = list.findIndex((r) => String(r.l.id) === String(l.id));
  const nx = list[at + 1] || list[at - 1] || null;
  if (!(await trashDrug(l, btn))) return;   // ย้ายลงถังยาที่ลบ 7 วัน (เรียกคืนได้ที่กล่องด้านล่าง)
  dirty = false; sel = nx ? nx.l.id : null; cards = [];
  try { sessionStorage.removeItem('pcps_work_sel'); } catch { /* ไม่เป็นไร */ }
  await refresh(true);
  if (sel != null) select(sel, false);
}
/** เพิ่มรายการใหม่ในบัญชียา รพ.สต. (rpst_list) จากแผงแหล่งข้อมูล แล้วผูกยานี้กับรหัสนั้น (ไม่ต้องไปแผงเครื่องมือ) */
async function addRpst(l, btn) {
  const code = $('#dwRpCode').value.trim().slice(0, 30), name = $('#dwRpName').value.trim().replace(/\s+/g, ' ').slice(0, 200), unit = $('#dwRpUnit').value.trim().slice(0, 40);
  if (!code || !name) { toast('กรอกรหัสยาและชื่อในบัญชี', 'err'); $(code ? '#dwRpName' : '#dwRpCode').focus(); return; }
  if (D.locals.some((x) => x.id !== l.id && x.code === code)) { toast(`รหัส ${code} ผูกกับยาตัวอื่นแล้ว`, 'err'); return; }
  busy(btn, true, 'กำลังบันทึก…');
  try {
    if (!(D.rpst || []).some((x) => x.code === code)) {
      const { error } = await sb.from('rpst_list').insert({ code, name, category: l.category || 'อื่น ๆ', pack_size: l.pack_size || '', unit: unit || l.unit || '', in_list: true });
      if (error) throw (/duplicate|23505/.test(errText(error) + error.code) ? new Error('รหัสยานี้มีในบัญชีแล้ว · เลือกจากรายการด้านบน') : error);
    }
    pop = null;
    await saveLocal({ code, outside: false }, `เพิ่มรหัส ${code} ในบัญชียา รพ.สต. และผูกกับยานี้แล้ว`);
  } catch (err) { toast(errText(err), 'err'); } finally { busy(btn, false); }
}
function selText() {
  const s = window.getSelection(), box = $('#dwSrcBody');
  if (!s || s.isCollapsed || !box || !box.contains(s.anchorNode)) return '';
  return String(s).replace(/\s+/g, ' ').trim().slice(0, 400);
}
function tabRef(l) {
  const tab = $('#dwSrcBody')?.dataset.tab, m = mimsOf(l);
  return tab === 'mims' ? (m ? { label: 'MIMS Thailand', url: m.url || '' } : null) : fdaRef(fdaOf(l));
}

async function onMain(e) {
  const r = cur(); if (!r) return;
  const { l, j } = r, t = e.target, B = (s) => t.closest(s);
  let b;
  if ((b = B('[data-dw-next]'))) { const tk = todo(l, j); if (tk.length) goTo(tk[0].go); else nextDrug(); return; }
  if ((b = B('[data-dw-go]'))) { goTo(b.dataset.dwGo); return; }
  if ((b = B('[data-dw-goto]'))) { goTo(b.dataset.dwGoto); return; }
  if ((b = B('[data-dw-hedit]'))) { edit = edit === b.dataset.dwHedit ? null : b.dataset.dwHedit; renderMain(); $('#dwName, #dwEdName')?.focus(); return; }
  if (B('[data-dw-hcancel]')) { edit = null; renderMain(); return; }
  if ((b = B('[data-dw-hsave]'))) {
    if (b.dataset.dwHsave === 'name') { const n = $('#dwName').value.trim(); if (!n) { toast('กรุณาใส่ชื่อยา', 'err'); return; } edit = null; await saveLocal({ name: n }, 'บันทึกชื่อยาแล้ว'); return; }
    await saveDrug(); return;
  }
  if ((b = B('[data-dw-deldrug]'))) { await delDrug(l, b); return; }
  if (B('[data-dw-ingadd]')) { const u = $('#dwIngRows .i-u')?.value.split('|') || []; $('#dwIngRows').insertAdjacentHTML('beforeend', ingRowHtml({ u: u[0], per: u[1] })); $('#dwIngRows .dw-ing:last-child .i-n').focus(); return; }
  if ((b = B('[data-dw-ingrm]'))) { if ($$('#dwIngRows .dw-ing').length > 1) b.closest('.dw-ing').remove(); else b.closest('.dw-ing').querySelectorAll('input').forEach((x) => { x.value = ''; }); return; }
  if ((b = B('[data-dw-tools]'))) { openTools(b.dataset.dwTools); return; }
  // แหล่งข้อมูล
  if ((b = B('[data-dw-sgok]'))) { await saveLocal(applyRow(l, b.dataset.dwSgok, b.dataset.target), `ผูก ${SRCN[b.dataset.dwSgok]} แล้ว`); return; }
  if ((b = B('[data-dw-sgno]'))) { try { await rejectPair(l, b.dataset.dwSgno, b.dataset.target); toast('จำไว้แล้วว่าไม่ใช่คู่นี้'); rows = await centerRows(false); renderMain(); } catch (err) { toast(errText(err), 'err'); } return; }
  if ((b = B('[data-dw-src]'))) { const k = b.dataset.dwSrc; pop = pop === k ? null : k; popQ = ''; mimsParsed = null; renderMain(); if (pop) { $('#dwPop')?.scrollIntoView({ block: 'nearest' }); $('#dwSq')?.focus({ preventScroll: true }); } return; }
  if ((b = B('[data-dw-set]'))) { const k = $('#dwPop').dataset.k; pop = null; await linkSet(l, k, b.dataset.dwSet); return; }
  if ((b = B('[data-dw-dbed]'))) {   // แก้ไขรายละเอียดแหล่งข้อมูลในแผง (เปิด/ปิด)
    const k = b.dataset.dwDbed, key = b.dataset.key ?? null;
    const same = dbEd && dbEd.k === k && (key == null || String(dbEd.key ?? '') === key);
    dbEd = b.closest('#dwDbEd') || same ? null : { k, key };
    if (dbEd?.k === 'ddi' && !ddPairs) { renderMain(); await loadPairs(l); }
    pop = k; renderMain(); $('#dwDbEd')?.scrollIntoView({ block: 'nearest' }); return;
  }
  if ((b = B('[data-dw-dbsave]'))) { await saveDb(l, b.dataset.dwDbsave, b.dataset.key || null, b); return; }
  if ((b = B('[data-dw-pairsave]'))) { await pairSave(+b.dataset.dwPairsave, b); return; }
  if ((b = B('[data-dw-pairth]'))) { const id = +b.dataset.dwPairth, p = ddPairs.find((x) => x.id === id); if (p.th_reviewed && !confirm('ให้ AI แปลคู่นี้ใหม่? ข้อความไทยที่ตรวจไว้จะถูกแทนที่')) return; const r2 = await aiTh('ai_ddi_th_start', 'ai_ddi_th_poll', id, b); if (r2) { await loadPairs(l); renderMain(); } return; }
  if (B('[data-dw-fdath]')) { const f = fdaOf(l); if (f.th_reviewed && !confirm('ให้ AI แปลฉลากนี้ใหม่? ข้อความไทยที่ตรวจไว้จะถูกแทนที่')) return; const r2 = await aiTh('ai_fda_th_start', 'ai_fda_th_poll', f.id, B('[data-dw-fdath]')); if (r2) { await reloadDrugData(true); await refresh(!dirty); dbEd = { k: 'fda' }; pop = 'fda'; renderMain(); } return; }
  if ((b = B('[data-dw-dmgo]'))) { await dmSearch(b); return; }
  if ((b = B('[data-dw-dmimp]'))) { await dmImport(l, b.dataset.dwDmimp, b); return; }
  if (B('[data-dw-hist]')) { if (hist) { hist = null; renderMain(); } else await loadHist(l, j); return; }
  if ((b = B('[data-dw-srcedit]'))) {   // ต้นฉบับ: แก้ไขข้อมูลจากตรงนี้ = แผงแหล่งข้อมูลนั้น + แก้ไขรายละเอียด (ไม่ต้องเปิดเครื่องมือฐานข้อมูล)
    const k = b.dataset.dwSrcedit; pop = k; popQ = ''; mimsParsed = null; dbEd = { k, key: null };
    renderMain(); $('#dwDbEd')?.scrollIntoView({ block: 'nearest' }); return;
  }
  if ((b = B('[data-dw-grid]'))) { if (dirty && !confirm('มีการแก้ไขขนาดยาที่ยังไม่บันทึก · ทิ้งการแก้ไขแล้วไปตารางแก้ไขยา?')) return; dirty = false; try { sessionStorage.setItem('pcps_grid_focus', `${l.id}:${b.dataset.dwGrid}`); } catch { /* ไม่เป็นไร */ } location.hash = '#/admin/drugs/grid'; return; }
  if ((b = B('[data-dw-rpadd]'))) { await addRpst(l, b); return; }
  if ((b = B('[data-dw-un]'))) { const k = $('#dwPop').dataset.k; await linkUnset(l, k, b.dataset.dwUn); return; }
  if ((b = B('[data-dw-na]'))) { const k = b.dataset.dwNa, curNa = l.link_na || []; await saveLocal({ link_na: curNa.includes(k) ? curNa.filter((x) => x !== k) : [...curNa, k] }, curNa.includes(k) ? 'ต้องมีข้อมูลส่วนนี้' : 'ตั้งเป็น "ไม่ใช้กับยานี้" แล้ว'); return; }
  if ((b = B('[data-dw-fetch]'))) { busy(b, true, 'กำลังดึง…'); try { pop = null; await fetchLabel(l, true); } catch (err) { toast(errText(err), 'err'); } finally { busy(b, false); } return; }
  if ((b = B('[data-dw-mimssave]'))) {
    busy(b, true, 'กำลังบันทึก…');
    try { const res = await saveMimsText(mimsParsed, l.id); toast(`บันทึกข้อมูล MIMS "${res.m.name}" และผูกกับยานี้แล้ว · การ์ดข้อบ่งใช้ใหม่ ${res.added}`); pop = null; mimsParsed = null; srcTab = 'mims'; const keep = dirty ? cards : null; await refresh(!keep); if (keep) { const rr = cur(); const add = doseRows(rr.l, rr.j).filter((x) => !keep.some((c) => (c.ind.quote || c.ind.name) === (x.ind.quote || x.ind.name))); cards = [...keep, ...add.map((x) => ({ ind: { ...x.ind }, on: x.on, skip: x.skip, ok: false, ai: false, fix: null, open: false }))]; renderMain(); } } catch (err) { toast(errText(err), 'err'); } finally { busy(b, false); }
    return;
  }
  // การ์ดขนาดยา
  if ((b = B('[data-card]')) && !B('button, input, textarea, select, summary, a, label')) { const k = +b.dataset.card; if (k !== focus) { focus = k; renderMain(); } return; }
  if ((b = B('[data-dw-open]'))) { const k = +b.dataset.dwOpen; cards[k].open = true; focus = k; renderMain(); return; }
  if ((b = B('[data-dw-age]'))) { const k = +b.dataset.k; setAge(cards[k], b.dataset.dwAge); changed(k); focus = k; renderMain(); return; }
  if ((b = B('[data-dw-agefix]'))) {   // แก้ช่วงอายุคลิกเดียว (ตามชื่อ / ต่อช่วงที่ขาด)
    const f = cards[+b.dataset.dwAgefix]?.ageFixes?.[+b.dataset.n], c = f && cards[f.k]; if (!c) return;
    Object.assign(c.ind, f.set); c.ageCustom = !ageSel(c.ind).aligned; changed(f.k); focus = +b.dataset.dwAgefix; renderMain(); return;
  }
  if ((b = B('[data-dw-agec]'))) { const k = +b.dataset.dwAgec, c = cards[k]; c.ageCustom = !(c.ageCustom || !ageSel(c.ind).aligned); if (!c.ageCustom) { c.ind.age_min = null; c.ind.age_max = null; changed(k); } focus = k; renderMain(); return; }
  if ((b = B('[data-dw-set1]'))) {
    const k = +b.dataset.k, c = cards[k], [f, v] = b.dataset.dwSet1.split(':');
    if (f === 'fixed') c.ind.fixed = v === '1' ? true : null;
    if (f === 'per') { c.ind.per = v; if (v === 'day' && !(c.ind.times >= 1)) c.ind.times = null; }
    if (f === 'unit') c.ind.unit = v === 'mcg' ? 'mcg' : null;
    changed(k); focus = k; renderMain(); return;
  }
  if ((b = B('[data-dw-times]'))) {
    const k = +b.dataset.k, c = cards[k], n = +b.dataset.dwTimes, ts = timesOf(c.ind);
    const nx = ts.includes(n) ? ts.filter((x) => x !== n) : [...ts, n];
    c.ind.times = nx[0] ?? null; c.ind.times_alt = nx.length > 1 ? nx.slice(1, 4) : null;
    changed(k); focus = k; renderMain(); return;
  }
  if ((b = B('[data-dw-ok]'))) {
    const k = +b.dataset.dwOk, c = cards[k], ct = cardTest(l, j, c);
    if (ct.status === 'fail') { toast('ข้อนี้ยังไม่ผ่านการตรวจ · แก้ตามรายการก่อน', 'err'); return; }
    if (!acked(ct, c)) { toast('ติ๊กรับทราบข้อควรตรวจทุกข้อก่อน', 'err'); return; }
    c.ok = true; c.open = false; c.skip = null; if (!c.on) c.on = true; dirty = true;
    const nx = cards.findIndex((x, i) => i > k && x.on && !x.ok);
    focus = nx >= 0 ? nx : k; renderMain(); if (nx >= 0) $(`#dwCard-${nx}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  if ((b = B('[data-dw-skip]'))) { const k = +b.dataset.dwSkip; cards[k].open = false; focus = Math.min(cards.length - 1, k + 1); if (cards[focus]) cards[focus].open = true; renderMain(); $(`#dwCard-${focus}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  if ((b = B('[data-dw-del]'))) { const k = +b.dataset.dwDel; if (!confirm(`ลบข้อบ่งใช้ "${cards[k].ind.name || k + 1}" ออกจากยานี้?`)) return; cards.splice(k, 1); dirty = true; focus = Math.max(0, Math.min(focus, cards.length - 1)); renderMain(); return; }
  if ((b = B('[data-dw-fix]'))) { await startFix(+b.dataset.dwFix, b, 'label'); return; }
  if ((b = B('[data-dw-web]'))) { await startFix(+b.dataset.dwWeb, b, 'web'); return; }
  if ((b = B('[data-dw-aiall]'))) { await aiAllCards(b); return; }
  if ((b = B('[data-dw-decide]'))) {   // เภสัชกรตัดสินธง AI ตรวจย้อนหลัง (92 dose_audit_decide · บันทึกผู้ตัดสินในประวัติแก้ไข)
    const c = cards[+b.dataset.dwDecide], d = j.dose.dose, v = b.dataset.v; if (!c || !d) return;
    const f = (d.audit_flags || []).find((x) => x.name === c.ind.name);
    const msg = !v ? `ยกเลิกการตัดสินข้อ "${c.ind.name}" (กลับเป็นรอตัดสิน)?`
      : `ตัดสินข้อ "${c.ind.name}" ว่า "${DECISION[v]}"?${v === 'conflict' ? '\nหน้าคำนวณจะหยุดแสดงตัวเลขข้อนี้จนแก้ตัวเลขแล้วอนุมัติใหม่' : flagHides(f) ? '\nตัวเลขข้อนี้จะกลับมาแสดงในหน้าคำนวณ' : ''}`;
    if (!confirm(msg)) return;
    busy(b, true, 'กำลังบันทึก…');
    try { const { error } = await sb.rpc('dose_audit_decide', { p_dose: d.id, p_name: c.ind.name, p_decision: v }); if (error) throw error; toast(v ? `บันทึกการตัดสินแล้ว: ${DECISION[v]}` : 'ยกเลิกการตัดสินแล้ว'); await refresh(false); renderMain(); }
    catch (err) { toast(errText(err), 'err'); } finally { busy(b, false); }
    return;
  }
  if ((b = B('[data-dw-auditnow]'))) { await auditNow(l, j, b); return; }
  if ((b = B('[data-dw-hide]'))) {
    if (dirty && !confirm('มีการแก้ไขขนาดยาที่ยังไม่บันทึก · ดำเนินการต่อ? (การแก้ไขยังค้างอยู่)')) return;
    busy(b, true, 'กำลังบันทึก…');
    try { await saveLocal({ active: !l.active }, l.active ? 'ซ่อนยานี้แล้ว · ประชาชน/เจ้าหน้าที่ไม่เห็น (ข้อมูลยังอยู่ กด "แสดงยานี้" เพื่อเปิดใหม่)' : 'แสดงยานี้แล้ว'); } finally { busy(b, false); }
    return;
  }
  if ((b = B('[data-dw-fixuse]'))) {
    const k = +b.dataset.dwFixuse, c = cards[k]; if (!c?.fix?.res?.ind) return;
    fillCard(l, c, k, c.fix); renderMain(); return;
  }
  if ((b = B('[data-dw-undo]'))) { const k = +b.dataset.dwUndo, c = cards[k]; if (!c?.filled) return; c.ind = c.filled.prev; c.filled = null; changed(k); renderMain(); return; }
  if ((b = B('[data-dw-fixno]'))) { cards[+b.dataset.dwFixno].fix = null; renderMain(); return; }
  if (B('[data-dw-addind]')) { cards.push({ ind: { name: '', per: 'dose' }, on: true, skip: null, ok: false, ai: false, fix: null, open: true }); focus = cards.length - 1; dirty = true; renderMain(); $(`#dwCard-${focus} .dw-iname`)?.focus(); return; }
  if ((b = B('[data-dw-ai]'))) { await aiDraft(l, b); return; }
  if ((b = B('[data-dw-copy]'))) {
    const src = rows.find((x) => String(x.l.id) === b.dataset.dwCopy), inds = src?.j.dose.dose?.indications || [];
    inds.forEach((i) => cards.push({ ind: { ...i }, on: true, skip: null, ok: false, ai: false, fix: null, open: true }));
    dirty = true; focus = cards.length - inds.length; toast(`คัดลอก ${inds.length} ข้อจาก ${src.l.name} · ตรวจกับความแรงของยานี้ก่อนอนุมัติ`); renderMain(); return;
  }
  // ด้านขวา
  if ((b = B('[data-dw-tab]'))) { srcTab = b.dataset.dwTab; renderMain(); return; }
  if ((b = B('[data-dw-w]'))) { wSel = +b.dataset.dwW; renderParts(); return; }
  if (B('[data-dw-usesel]')) {
    const s = selText(), c = cards[focus];
    if (!s) { toast('ลากเลือกข้อความในต้นฉบับก่อน', 'err'); return; }
    if (!c) { toast('ยังไม่มีข้อบ่งใช้ · กด "สร้างข้อบ่งใช้จากข้อความที่เลือก"', 'err'); return; }
    c.ind.quote = s; const rf = tabRef(l); if (rf) c.ind.ref = rf; changed(focus); renderMain(); return;
  }
  if (B('[data-dw-newsel]')) {
    const s = selText(); if (!s) { toast('ลากเลือกข้อความในต้นฉบับก่อน', 'err'); return; }
    const rf = tabRef(l);
    cards.push({ ind: { name: '', per: 'dose', quote: s, ...(rf ? { ref: rf } : {}) }, on: true, skip: null, ok: false, ai: false, fix: null, open: true });
    focus = cards.length - 1; dirty = true; renderMain(); $(`#dwCard-${focus} .dw-iname`)?.focus(); return;
  }
  if ((b = B('[data-dw-save]'))) { await saveCards(b.dataset.dwSave, b); }
}
function onInput(e) {
  const t = e.target;
  if (t.id === 'dwSq') { popQ = t.value; const r = cur(); const box = $('#dwPop .dw-cands'); if (r && box) { const cs = candidates(r.l, $('#dwPop').dataset.k).slice(0, 20); box.innerHTML = cs.map(([v, x]) => `<button type="button" class="dw-opt" data-dw-set="${esc(v)}">${esc(x)}</button>`).join('') || '<span class="small muted">ไม่พบ</span>'; } return; }
  if (t.id === 'dwMimsText') { try { mimsParsed = t.value.trim() ? parseMimsText(t.value) : null; } catch (err) { mimsParsed = null; toast(err.message, 'err'); } $('#dwMimsPre').innerHTML = mimsPreviewHtml(mimsParsed); const sv = $('[data-dw-mimssave]'); if (sv) sv.disabled = !mimsParsed?.sections.length; return; }
  const k = t.dataset.k, f = t.dataset.f;
  if (k == null || !f) return;
  const c = cards[+k]; if (!c) return;
  const NUM = ['min', 'max', 'cap', 'cap_day', 'age_min', 'age_max'];
  c.ind[f] = NUM.includes(f) ? numv(t.value) : t.value;
  if (['cap', 'cap_day'].includes(f) && !(c.ind[f] > 0)) c.ind[f] = null;
  if (f === 'quote' && t.value.trim() && !c.ind.ref) { const rf = tabRef(cur().l); if (rf) c.ind.ref = rf; }
  changed(+k); focus = +k; renderParts();
}
async function onChange(e) {
  const t = e.target;
  if (t.id === 'dwCat') { await saveLocal({ category: t.value }, 'บันทึกรูปแบบยาแล้ว'); return; }
  if (t.dataset.dwOn != null) { const c = cards[+t.dataset.dwOn]; c.on = t.checked; dirty = true; renderMain(); }
  if (t.dataset.dwAck != null) {   // รับทราบข้อควรตรวจทีละข้อ
    const c = cards[+t.dataset.dwAck]; if (!c) return;
    c.ack = (c.ack || []).filter((x) => x !== t.value).concat(t.checked ? [t.value] : []);
    renderParts();
  }
}

function pending() {
  let id = null;
  try {
    const [kind, x] = String(sessionStorage.getItem('pcps_drug_edit') || '').split(':');
    if (kind === 'local' && x) { id = x; sessionStorage.removeItem('pcps_drug_edit'); }
    const g = sessionStorage.getItem('pcps_work_focus');   // 'id' หรือ 'id:ส่วน' (มาจากภาพรวม/ตาราง) · 'new' = ช่องชื่อยาใหม่
    if (g) { sessionStorage.removeItem('pcps_work_focus'); if (g === 'new') wantPart = 'new'; else { const [x2, part] = g.split(':'); id = x2; wantPart = part || null; } }
    if (!id) id = sessionStorage.getItem('pcps_work_sel');
  } catch { /* ไม่เป็นไร */ }
  return id;
}
/** เปิดส่วนที่ภาพรวม/ตารางขอไว้ (แก้ละเอียดทันที) */
async function applyPart() {
  const part = wantPart; wantPart = null;
  if (!part) return;
  if (part === 'new') { $('#dwNew')?.focus(); $('#dwNew')?.scrollIntoView({ block: 'center' }); return; }
  const r = cur(); if (!r) return;
  if (part === 'drug') { edit = 'drug'; renderMain(); $('#dwHead')?.scrollIntoView({ block: 'start' }); $('#dwEdName')?.focus({ preventScroll: true }); return; }
  if (part === 'dose') { goTo('dose'); return; }
  if (SRCN[part]) {
    pop = part; popQ = '';
    const linked = part === 'rpst' ? r.l.code : part === 'mims' ? r.l.mims_id : part === 'fda' ? r.l.fda_key : part === 'nlem' ? (r.l.mono_refs || []).length : (r.l.ddi_ids || []).length;
    dbEd = linked ? { k: part, key: null } : null;
    if (dbEd?.k === 'ddi') await loadPairs(r.l);
    renderMain(); ($('#dwDbEd') || $('#dwPop'))?.scrollIntoView({ block: 'nearest' });
  }
}
function bind() {
  bound = true;
  $('#dwQ').addEventListener('input', renderList);
  $('#dwList').addEventListener('click', (e) => { const b = e.target.closest('[data-dw-pick]'); if (b) { select(b.dataset.dwPick); if (matchMedia('(max-width: 900px)').matches) $('#dwMain').scrollIntoView({ block: 'start' }); } });
  $$('[data-dw-filt]').forEach((b) => b.addEventListener('click', () => { filt = b.dataset.dwFilt; renderList(); }));
  $('#dwNewGo').addEventListener('click', (e) => addDrug(e.currentTarget));
  $('#dwNew').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addDrug($('#dwNewGo')); } });
  const m = $('#dwMain');
  m.addEventListener('click', (e) => { onMain(e).catch((err) => toast(errText(err), 'err')); });
  m.addEventListener('input', onInput);
  m.addEventListener('change', (e) => { onChange(e).catch((err) => toast(errText(err), 'err')); });
  m.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'dwName') { e.preventDefault(); m.querySelector('[data-dw-hsave="name"]')?.click(); } });
  m.addEventListener('toggle', (e) => { const d = e.target; if (d.classList?.contains('dw-more')) { const k = +d.closest('[data-card]')?.dataset.card; if (cards[k]) cards[k].open = d.open; } }, true);
  window.addEventListener('pcps:workback', async () => {
    if ($('#dcWork').hidden) return;
    const want = pending();
    await refresh(!dirty);
    if (want && String(want) !== String(sel) && rows.some((r) => String(r.l.id) === String(want))) select(idv(want));
    await applyPart();
  });
  window.addEventListener('pcps:drugtrash', () => { if (!$('#dcWork').hidden) refresh(!dirty).then(() => { if (dirty) renderMain(); }); });
  window.addEventListener('beforeunload', (e) => { if (dirty && !$('#dcWork').hidden) { e.preventDefault(); e.returnValue = ''; } });
}
export async function initDrugWork() {
  if (!bound) bind();
  const want = pending();
  try { rows = await centerRows(true); D = await drugData(); } catch (err) { toast(errText(err), 'err'); $('#dwMain').innerHTML = '<p class="empty">โหลดข้อมูลยาไม่สำเร็จ กรุณาลองใหม่</p>'; return; }
  const has = (id) => rows.some((r) => String(r.l.id) === String(id));
  if (want && has(want) && String(want) !== String(sel)) { if (!select(idv(want) ?? want)) renderMain(); }
  else if (sel != null && has(sel)) { const r = cur(); if (!dirty) cards = buildCards(r.l, r.j); renderList(); renderMain(); }
  else { const first = listRows()[0] || rows[0]; if (first) select(first.l.id, false); else { renderList(); renderMain(); } }
  if (want && has(want) && filt !== 'all' && !listRows().some((r) => String(r.l.id) === String(want))) { filt = 'all'; renderList(); }   // ยาที่เปิดจากภาพรวมอาจเสร็จแล้ว → แสดงในรายการด้วย
  await applyPart();
}
