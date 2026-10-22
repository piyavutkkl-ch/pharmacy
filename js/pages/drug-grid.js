// ผู้ดูแล › ข้อมูลยา › ตารางแก้ไขยา (#/admin/drugs/grid) — แก้ข้อมูลยาแบบตาราง Excel/Notion (เจ้าของเว็บ 21 ต.ค.)
//   ยา 1 แถว · คลิกช่อง = แก้ (Enter บันทึก · Esc ยกเลิก · Tab ช่องถัดไป) · บันทึกลง local_drugs ทันทีทีละช่อง (RLS ผู้ดูแล + ประวัติแก้ไขข้อมูลยา 79 เหมือนเดิม)
//   เลือกฐานข้อมูลที่แสดง (#dgDbs): "หลายฐานพร้อมกัน" = ช่องผูกของแต่ละฐาน · "ทีละฐาน" = ฐานเดียว + รายละเอียด/เหตุผล/คู่ที่ระบบเสนอ (✓ ใช้ ✗ ไม่ใช่)
//   ช่องผูกฐานข้อมูล = เมนูค้นหา (คู่ที่ระบบเสนออยู่บนสุด) · บัญชียาหลัก/DDInter ผูกได้หลายรายการ: เลือก = เพิ่ม · เลือกตัวที่ผูกอยู่ (✓) = เอาออก
//   ขนาดยาไม่แก้ตัวเลขในตาราง: กดช่อง → แผงยาขั้นที่ 3 ในศูนย์ข้อมูลยา (ตรวจซ้ำด้วยทดสอบสูตรก่อนอนุมัติ)
//   สถานะ/คู่ที่ระบบเสนอใช้ชุดเดียวกับศูนย์ข้อมูลยา (drug-center.js judgeAll/suggest) · ไลบรารี Tabulator 6.3.1 (MIT) จาก jsDelivr โหลดเมื่อเปิดหน้านี้
import { sb } from '../supabase.js?v=4.4';
import { $, $$, esc, toast, errText } from '../util.js?v=4.4';
import { strengthOf, comboName } from './dose.js?v=4.4';
import { reloadDrugData, drugData } from './admin-drugs.js?v=4.4';
import { DC, centerRows, suggest, applyRow, basesOf, rejectPair } from './drug-center.js?v=4.4';
import { trashDrug } from './drug-trash.js?v=4.4';
import { exportDrugs, readDrugFile, planDrugImport, planHtml, applyDrugImport, fileText, isOwnFormat, aiAnalyze, planFromAi, aiPlanHtml, applyAiPlan, knownCats, addCats, looksMims, resultHtml, retryPlan } from './drug-io.js?v=4.4';
import { parseMimsText, headTh } from './mims-text.js?v=4.4';
import { saveMimsText } from './admin-mims.js?v=4.4';

const TAB = 'https://cdn.jsdelivr.net/npm/tabulator-tables@6.3.1/dist';
const TAB_JS = `${TAB}/js/tabulator_esm.min.mjs`, TAB_CSS = `${TAB}/css/tabulator.min.css`;
const DBS = ['rpst', 'mims', 'fda', 'nlem', 'ddi', 'dose'];
const DBN = { rpst: 'บัญชียา รพ.สต.', mims: 'MIMS', fda: 'ฉลากยาสหรัฐฯ', nlem: 'บัญชียาหลัก', ddi: 'DDInter', dose: 'ขนาดยา' };
const MULTI = ['nlem', 'ddi'];   // ผูกได้หลายรายการ
const KEY = 'pcps_drug_grid';   // จำวิธีแสดง/ฐานที่เลือก (เฉพาะเครื่องนี้)
const num = (x) => +(+x).toFixed(3);

let table = null, Tabulator = null, D = null, rows = [], bound = false, saving = false;
let st = load();

function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && ['multi', 'one'].includes(v.mode) && Array.isArray(v.dbs)) return { mode: v.mode, dbs: v.dbs.filter((k) => DBS.includes(k)), str: v.str !== false }; } catch { /* ไม่เป็นไร */ }
  return { mode: 'multi', dbs: [...DBS], str: true };
}
function remember() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ไม่เป็นไร */ } }

/* ---------- ข้อมูลแถว ---------- */
const combo = (l) => DC.isCombo(l) || !!comboName(l.name);
const monoNames = (l) => [...new Set((l.mono_refs || []).map((r) => D.monos.find((m) => m.ref === r)?.name).filter(Boolean))];
function rowOf({ l, j, st: status }) {
  const s = l.strength;
  return {
    id: l.id, l, j, status, sg: {},
    name: l.name, code: l.web_code || '', category: l.category || '',
    amt: s && +s.mg > 0 ? (s.u === 'mcg' ? +s.amt : +s.mg) : null, unit: `${s?.u || 'mg'}|${s?.per || 'tab'}`,
    asName: s?.as?.name || '', asMg: s?.as?.mg ? +s.as.mg : null,
    pack: l.pack_size || '', cunit: l.unit || '', note: l.note || '', active: !!l.active,
    rpst: l.code || '', mims: l.mims_id ?? '', fda: l.fda_key || '', nlem: monoNames(l), ddi: [...(l.ddi_ids || [])], dose: j.dose.s,
  };
}
/** คู่ที่ระบบเสนอ (คำนวณเมื่อแสดงครั้งแรก) */
function sugOf(d, k) {
  if (!(k in d.sg)) d.sg[k] = ['miss', 'wait'].includes(d.j[k].s) && k !== 'dose' ? suggest(d.l, k, d.j) : null;
  return d.sg[k];
}

/* ---------- การแสดงผลในช่อง ---------- */
const mut = (t) => `<span class="dg-mut">${esc(t)}</span>`;
function cellHtml(d, k) {
  const x = d.j[k], c = DC.cellS(k, x.s), sg = sugOf(d, k);
  const t = x.t || (c === 'opt' ? 'ไม่บังคับ' : x.s === 'miss' ? (k === 'dose' ? 'ยังไม่มีข้อมูลคำนวณ' : 'ยังไม่ผูก') : x.s === 'err' ? x.why || '' : '');
  return `<span class="dg-c s-${c}" title="${esc(DC.SN[c])}"><i aria-hidden="true">${DC.SYM[c]}</i><span>${esc(t)}</span></span>`
    + (sg ? `<span class="dg-sg">เสนอ ${sg.conf}%: ${esc(sg.label)}</span>` : '')
    + (k === 'dose' && x.s !== 'na' ? '<span class="dg-go">เปิดตารางขนาดยา ›</span>' : '');
}
function amtHtml(d) {
  if (combo(d.l)) { const ings = (d.l.ingredients || []).filter((x) => +x.mg > 0); return mut(ings.length ? `สูตรผสม: ${ings.map((x) => `${x.name} ${num(x.amt ?? x.mg)}`).join(' + ')} · ดูช่องสารสำคัญ` : 'สูตรผสม · กรอกที่ช่องสารสำคัญ'); }
  if (d.amt != null && d.amt !== '') return esc(String(num(d.amt)));
  const s = strengthOf(d.l);
  return s ? mut(`${num(s.mg)} (อ่านจากชื่อยา)`) : mut('—');
}
function unitHtml(d) {
  if (combo(d.l)) return '';
  if (d.amt != null && d.amt !== '') return esc(DC.UNITS.find(([v]) => v === d.unit)?.[1] || d.unit);
  const s = strengthOf(d.l);
  return s ? mut(DC.PER[s.per] || '') : '';
}
/** ช่อง "คิดเป็น" ที่กรอกครึ่งเดียว (ยังไม่บันทึก) มีแถบสี */
const pending = (d) => (d.asName || '') !== (d.l.strength?.as?.name || '') || +(d.asMg || 0) !== +(d.l.strength?.as?.mg || 0);
function detailHtml(d, k, what) {
  const x = d.j[k];
  if (what === 'why') return x.why ? `<span class="${x.s === 'err' ? 'dg-err' : 'dg-mut'}">${esc(x.why)}</span>` : '';
  if (what === 'sug') {
    const sg = sugOf(d, k);
    if (!sg) return x.s === 'miss' && k !== 'dose' ? mut('ระบบยังหาคู่ไม่ได้ · คลิกช่องผูกเพื่อเลือกเอง') : '';
    return `<span class="dg-sgb"><b>${esc(sg.label)}</b> ${mut(`${sg.conf}%`)}<span class="dg-ev">${sg.ev.map(([t, y]) => `<span class="${y ? 'y' : 'n'}">${y ? '✓' : '✗'} ${esc(t)}</span>`).join('')}</span>`
      + `<span class="dg-act"><button type="button" class="btn btn-p btn-sm" data-dg-ok${sg.strong ? '' : ' disabled title="หลักฐานไม่ครบ ตรวจก่อนแล้วเลือกเองในช่องผูก"'}>✓ ใช้คู่นี้</button><button type="button" class="btn btn-o btn-sm" data-dg-no>✗ ไม่ใช่</button></span></span>`;
  }
  const l = d.l;
  if (k === 'rpst') { const it = x.item; return !it ? '' : what === 'unit' ? esc(it.unit || '') : what === 'cat' ? esc(it.category || '') : it.in_list === false ? '<span class="dg-err">ไม่อยู่ในไฟล์ล่าสุด</span>' : 'อยู่'; }
  if (k === 'mims') {
    const m = x.mims; if (!m) return '';
    if (what === 'inds') { const a = m.indications || []; return esc(`${a.length} ข้อ · ใช้คำนวณได้ ${a.filter((i) => !i.skip).length}`); }
    return /^https:\/\//.test(m.url || '') ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">เปิด MIMS</a>` : '';
  }
  if (k === 'fda') {
    const f = l.fda_key && D.fdas.find((y) => y.key === l.fda_key); if (!f) return '';
    return what === 'gen' ? esc(f.generic || '') : what === 'route' ? esc(f.route || '') : f.sections_th?.length ? (f.th_reviewed ? 'ตรวจแล้ว' : 'AI แปล รอตรวจ') : mut('ยังไม่มี');
  }
  if (k === 'nlem') return esc([...new Set(monoNames(l).flatMap((n) => D.monos.filter((m) => m.name === n).flatMap((m) => (m.forms || []).map((f) => f.form))))].join(', '));
  if (k === 'dose') {
    const ds = x.dose; if (!ds) return '';
    if (what === 'inds') return esc(`${(ds.indications || []).length || (ds.indication ? 1 : 0)} ข้อ`);
    const t = x.test; return !t ? '' : t.status === 'pass' ? '<span class="dg-ok">✓ ผ่าน</span>' : t.status === 'warn' ? `ผ่าน · ควรตรวจ ${t.issues.length} ข้อ` : '<span class="dg-err">! ไม่ผ่าน</span>';
  }
  return '';
}

/* ---------- ตัวเลือกในช่องผูก ---------- */
function linkValues(d, k) {
  const sg = sugOf(d, k), top = sg && !(MULTI.includes(k) ? d[k].includes(sg.target) : d[k] === sg.target) ? [{ label: `★ ระบบเสนอ ${sg.conf}% · ${sg.label}`, value: sg.target }] : [];
  if (k === 'rpst') {
    const used = new Set(D.locals.filter((x) => x.id !== d.id).map((x) => x.code).filter(Boolean));
    return [...top, { label: '— ไม่อยู่ในบัญชี (ยานอก รพ.สต.) —', value: '' }, ...(D.rpst || []).filter((it) => !used.has(it.code)).map((it) => ({ label: `${it.code} · ${it.name}`, value: it.code }))];
  }
  if (k === 'mims') return [...top, { label: '— ไม่ผูก —', value: '' }, ...(D.mims || []).map((m) => ({ label: `${m.web_code ? m.web_code + ' · ' : ''}${m.name}`, value: m.id }))];
  if (k === 'fda') return [...top, { label: '— ไม่ผูก —', value: '' }, ...D.fdas.map((f) => ({ label: `${f.web_code ? f.web_code + ' · ' : ''}${f.title} · ${f.generic} (${f.route})`, value: f.key }))];
  if (k === 'nlem') {
    const names = [...new Set(D.monos.map((m) => m.name))], on = d.nlem;
    return [...top, ...(on.length ? [{ label: '— เอาออกทั้งหมด —', value: '__clear__' }] : []), ...on.map((n) => ({ label: `✓ ${n} (เลือก = เอาออก)`, value: n })), ...names.filter((n) => !on.includes(n)).map((n) => ({ label: n, value: n }))];
  }
  const on = d.ddi, name = (i) => D.ddDrugs.find((x) => x.id === i)?.name || i;
  return [...top, ...(on.length ? [{ label: '— เอาออกทั้งหมด —', value: '__clear__' }] : []), ...on.map((i) => ({ label: `✓ ${name(i)} (เลือก = เอาออก)`, value: i })), ...D.ddDrugs.filter((x) => !on.includes(x.id)).map((x) => ({ label: `${x.web_code ? x.web_code + ' · ' : ''}${x.name}`, value: x.id }))];
}
const lc = (s) => String(s || '').toLowerCase();
const listParams = (values, extra = {}) => ({ values, autocomplete: true, listOnEmpty: true, allowEmpty: true, filterDelay: 120, placeholderEmpty: 'ไม่พบ', placeholderLoading: 'กำลังค้นหา…', filterFunc: (term, label) => lc(label).includes(lc(term)), ...extra });

/* ---------- คอลัมน์ ---------- */
const DETAIL = {   // ทีละฐาน: คอลัมน์รายละเอียดเพิ่ม
  rpst: [['unit', 'หน่วย'], ['cat', 'หมวดในบัญชี'], ['inlist', 'ในไฟล์ล่าสุด']],
  mims: [['inds', 'ข้อบ่งใช้'], ['url', 'หน้า MIMS']],
  fda: [['gen', 'ชื่อสามัญ'], ['route', 'ช่องทาง'], ['th', 'ภาษาไทย']],
  nlem: [['forms', 'รูปแบบในบัญชี']],
  ddi: [],
  dose: [['inds', 'ข้อบ่งใช้'], ['test', 'ทดสอบสูตร']],
};
function columns() {
  const ed = (fn) => (cell) => fn(cell.getRow().getData());
  const base = [
    { title: '', field: 'id', frozen: true, headerSort: false, width: 48, hozAlign: 'center', cssClass: 'dg-opencell',
      formatter: (cell) => `<button type="button" class="dg-open" data-dg-open aria-label="เปิดแผงยา ${esc(cell.getRow().getData().name)}" title="เปิดแผงยา 3 ขั้น">↗</button>`,
      cellClick: (e, cell) => openPanel(cell.getRow().getData().id) },
    { title: 'ยา (ในเว็บแอพ)', field: 'name', frozen: true, minWidth: 150, maxWidth: 260, cssClass: 'dg-name dg-ed dg-wrap', editor: 'input', editorParams: { elementAttributes: { maxlength: '200' } },
      formatter: (cell) => { const d = cell.getRow().getData(); return `<b>${esc(d.name)}</b>${d.l.outside ? '<span class="dg-tag">ยานอก</span>' : ''}${d.l.active ? '' : '<span class="dg-tag">ซ่อน</span>'}`; } },
    ...(st.str ? [{ title: '① รายการยาบนเว็บ', columns: [
      { title: 'รหัส', field: 'code', width: 110, formatter: (cell) => mut(cell.getValue() || '—') },
      { title: 'รูปแบบ', field: 'category', minWidth: 150, maxWidth: 200, cssClass: 'dg-ed dg-wrap', editor: 'list',
        editorParams: () => ({ values: [...new Set(D.locals.map((x) => x.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th')) }), formatter: (cell) => esc(cell.getValue() || '—') },
      { title: 'สารสำคัญ', field: '_ings', minWidth: 170, maxWidth: 280, headerSort: false, cssClass: 'dg-ed dg-wrap', formatter: (cell) => ingsHtml(cell.getRow().getData().l),   // เพิ่ม/ลดสารสำคัญ + ความแรงรายสาร (thread 534c846e)
        cellClick: (e, cell) => openIngs(cell.getRow().getData().l) },
      { title: 'ความแรง', field: 'amt', width: 130, cssClass: 'dg-ed dg-wrap', editor: 'number', editorParams: { min: 0, step: 0.001, selectContents: true }, editable: ed((d) => !combo(d.l)), formatter: (cell) => amtHtml(cell.getRow().getData()), sorter: 'number',
        cellClick: (e, cell) => { const d = cell.getRow().getData(); if (combo(d.l)) openIngs(d.l); } },
      { title: 'หน่วย', field: 'unit', width: 110, headerSort: false, cssClass: 'dg-ed', editor: 'list', editorParams: { values: DC.UNITS.map(([value, label]) => ({ value, label })) }, editable: ed((d) => !combo(d.l)), formatter: (cell) => unitHtml(cell.getRow().getData()) },
      { title: 'คิดเป็น (สาร)', field: 'asName', width: 140, headerSort: false, cssClass: 'dg-ed dg-wrap', editor: 'list', editable: ed((d) => !combo(d.l)),
        editorParams: (cell) => { const d = cell.getRow().getData(); return listParams([{ label: '— ไม่มี —', value: '' }, ...[...new Set([...basesOf(d.l), ...(d.asName ? [d.asName] : [])])].map((n) => ({ label: n, value: n }))], { freetext: true }); },
        formatter: (cell) => { const d = cell.getRow().getData(); if (pending(d)) cell.getElement().classList.add('dg-pend'); else cell.getElement().classList.remove('dg-pend'); return d.asName ? esc(d.asName) : ''; } },
      { title: 'คิดเป็น (มก.)', field: 'asMg', width: 120, headerSort: false, cssClass: 'dg-ed', editor: 'number', editorParams: { min: 0, step: 0.001, selectContents: true }, editable: ed((d) => !combo(d.l)),
        formatter: (cell) => { const d = cell.getRow().getData(); if (pending(d)) cell.getElement().classList.add('dg-pend'); else cell.getElement().classList.remove('dg-pend'); return d.asMg ? esc(String(num(d.asMg))) : ''; } },
      { title: 'บรรจุ', field: 'pack', width: 90, cssClass: 'dg-ed', editor: 'input', editorParams: { elementAttributes: { maxlength: '40' } }, formatter: (cell) => esc(cell.getValue() || '') },
      { title: 'หน่วยนับ', field: 'cunit', width: 100, cssClass: 'dg-ed', editor: 'input', editorParams: { elementAttributes: { maxlength: '40' } }, formatter: (cell) => esc(cell.getValue() || '') },
      { title: 'หมายเหตุ', field: 'note', minWidth: 140, maxWidth: 260, cssClass: 'dg-ed dg-wrap', editor: 'input', editorParams: { elementAttributes: { maxlength: '500' } }, formatter: (cell) => esc(cell.getValue() || '') },
      { title: 'แสดง', field: 'active', width: 96, cssClass: 'dg-ed', editor: 'list', editorParams: { values: [{ label: 'แสดง', value: true }, { label: 'ซ่อน', value: false }] },
        formatter: (cell) => (cell.getValue() ? '<span class="dg-ok">✓ แสดง</span>' : mut('ซ่อน')) },
    ] }] : []),
  ];
  const groups = st.dbs.map((k) => {
    const link = k === 'dose'
      ? { title: st.mode === 'one' ? 'ข้อมูลคำนวณ' : DBN[k], field: 'dose', minWidth: 170, maxWidth: 280, cssClass: 'dg-link dg-goto dg-wrap', headerSort: false, formatter: (cell) => cellHtml(cell.getRow().getData(), 'dose'), cellClick: (e, cell) => openPanel(cell.getRow().getData().id) }
      : { title: st.mode === 'one' ? 'ผูกกับ' : DBN[k], field: k, minWidth: 170, maxWidth: 300, cssClass: 'dg-link dg-ed dg-wrap', headerSort: false, editor: 'list',
        editorParams: (cell) => listParams(linkValues(cell.getRow().getData(), k)), formatter: (cell) => cellHtml(cell.getRow().getData(), k) };
    if (st.mode === 'multi') return link;
    const cols = [link, ...DETAIL[k].map(([w, t]) => ({ title: t, field: `_${k}_${w}`, minWidth: 90, maxWidth: 240, headerSort: false, cssClass: 'dg-wrap', formatter: (cell) => detailHtml(cell.getRow().getData(), k, w) })),
      { title: 'เหตุผล', field: `_${k}_why`, minWidth: 160, maxWidth: 300, headerSort: false, cssClass: 'dg-wrap', formatter: (cell) => detailHtml(cell.getRow().getData(), k, 'why') }];
    if (k !== 'dose') cols.push({ title: 'คู่ที่ระบบเสนอ', field: `_${k}_sug`, minWidth: 220, maxWidth: 340, headerSort: false, cssClass: 'dg-wrap', formatter: (cell) => detailHtml(cell.getRow().getData(), k, 'sug'), cellClick: (e, cell) => onSug(e, cell, k) });
    return { title: `${k === 'dose' ? '③' : '②'} ${DBN[k]}`, columns: cols };
  });
  const tail = { title: 'สถานะ', field: 'status', minWidth: 96, formatter: (cell) => { const [t, c] = DC.ROW[cell.getValue()]; return `<span class="dc-pill p-${c}">${t}</span>`; },
    sorter: (a, b) => ['err', 'miss', 'wait', 'ready'].indexOf(a) - ['err', 'miss', 'wait', 'ready'].indexOf(b) };
  const del = { title: 'ลบ', field: '_del', width: 110, headerSort: false, hozAlign: 'center', cssClass: 'dg-delcell',   // ลบรายการยานี้ = ย้ายลงถัง 7 วัน (drug-trash.js)
    formatter: (cell) => `<button type="button" class="dg-del" data-dg-del aria-label="ลบรายการยา ${esc(cell.getRow().getData().name)}">ลบรายการยานี้</button>`,
    cellClick: async (e, cell) => { if (!e.target.closest('[data-dg-del]') || saving) return; if (await trashDrug(cell.getRow().getData().l)) await refresh(true); } };
  return [...base, ...(st.mode === 'multi' && groups.length ? [{ title: '② แหล่งข้อมูล · ③ ขนาดยา', columns: groups }] : groups), tail, del];
}

/* ---------- บันทึก ---------- */
function strengthRow(d) {
  const amt = d.amt === '' || d.amt == null ? 0 : +d.amt, [u, per] = String(d.unit || 'mg|tab').split('|'), asN = String(d.asName || '').trim(), asMgV = +d.asMg || 0;
  if (!(amt >= 0)) return { err: 'ความแรงต้องเป็นตัวเลขที่มากกว่า 0' };
  if (asN && !(asMgV > 0)) return { wait: `กรอกช่อง "คิดเป็น (มก.)" ของ ${asN} ต่อ แล้วระบบจึงบันทึก` };
  if (!asN && asMgV > 0) return { wait: 'เลือกสารในช่อง "คิดเป็น (สาร)" ต่อ แล้วระบบจึงบันทึก' };
  if (asN && !(amt > 0)) return { err: 'กรอกความแรงของยาก่อน แล้วจึงใส่ "คิดเป็น"' };
  return { strength: amt > 0 ? { mg: u === 'mcg' ? +(amt / 1000).toFixed(6) : amt, per, ...(u === 'mcg' ? { u: 'mcg', amt } : {}), ...(asN ? { as: { name: asN, mg: asMgV } } : {}) } : null };
}
async function onEdited(cell) {
  const f = cell.getField(), d = cell.getRow().getData(), l = d.l, v = cell.getValue();
  const undo = (msg) => { toast(msg, 'err'); cell.restoreOldValue(); };
  let row = null, msg = 'บันทึกแล้ว';
  if (f === 'name') { const n = String(v || '').trim(); if (!n) return undo('กรุณาใส่ชื่อยา'); row = { name: n }; msg = 'บันทึกชื่อยาแล้ว'; }
  else if (f === 'category') { row = { category: v || null }; msg = 'บันทึกรูปแบบยาแล้ว'; }
  else if (f === 'pack') { row = { pack_size: String(v ?? '').trim() }; msg = 'บันทึกขนาดบรรจุแล้ว'; }
  else if (f === 'cunit') { row = { unit: String(v ?? '').trim() }; msg = 'บันทึกหน่วยนับแล้ว'; }
  else if (f === 'note') { row = { note: String(v ?? '').trim() || null }; msg = 'บันทึกหมายเหตุแล้ว'; }
  else if (f === 'active') { row = { active: v === true || v === 'true' }; msg = row.active ? 'แสดงยานี้ที่หน้าหลักแล้ว' : 'ซ่อนยานี้จากหน้าหลักแล้ว'; }
  else if (['amt', 'unit', 'asName', 'asMg'].includes(f)) {
    const r = strengthRow(d);
    if (r.err) return undo(r.err);
    if (r.wait) { toast(r.wait); cell.getRow().reformat(); return; }
    if (JSON.stringify(r.strength) === JSON.stringify(l.strength ?? null)) { cell.getRow().reformat(); return; }
    row = { strength: r.strength }; msg = 'บันทึกความแรงแล้ว';
  } else if (f === 'rpst') {
    if (!v && l.code && !confirm(`เลิกผูก "${l.name}" กับบัญชียา รพ.สต. (รหัส ${l.code}) และตั้งเป็นยานอก รพ.สต.?`)) { cell.restoreOldValue(); return; }
    row = { code: v || null, outside: !v }; msg = v ? `ผูกบัญชียา รพ.สต. รหัส ${v} แล้ว` : 'ตั้งเป็นยานอก รพ.สต. แล้ว'; }
  else if (f === 'mims') { row = { mims_id: DC.idv(v) }; msg = v ? 'ผูก MIMS แล้ว' : 'เลิกผูก MIMS แล้ว'; }
  else if (f === 'fda') { row = { fda_key: v || null }; msg = v ? 'ผูกฉลากยาแล้ว' : 'เลิกผูกฉลากยาแล้ว'; }
  else if (f === 'nlem' || f === 'ddi') {
    const cur = f === 'nlem' ? monoNames(l) : [...(l.ddi_ids || [])], pickV = Array.isArray(v) ? null : v;
    if (pickV == null || pickV === '') { cell.restoreOldValue(); return; }
    const next = pickV === '__clear__' ? [] : cur.includes(pickV) ? cur.filter((x) => x !== pickV) : [...cur, pickV];
    row = f === 'nlem' ? { mono_refs: D.monos.filter((m) => next.includes(m.name)).map((m) => m.ref) } : { ddi_ids: next };
    msg = pickV === '__clear__' ? `เลิกผูก ${DBN[f]} ทั้งหมดแล้ว` : cur.includes(pickV) ? `เอาออกจาก ${DBN[f]} แล้ว` : `ผูก ${DBN[f]} แล้ว`;
  }
  if (row) await save(l, row, msg, () => cell.restoreOldValue());
}
async function save(l, row, msg, fail) {
  saving = true;
  try {
    const { error } = await sb.from('local_drugs').update({ ...row, updated_at: new Date().toISOString() }).eq('id', l.id);
    if (error) { toast(errText(error), 'err'); fail?.(); return false; }
    toast(msg);
    await reloadDrugData(); await refresh(true);
    return true;
  } finally { saving = false; }
}
async function onSug(e, cell, k) {
  const b = e.target.closest('[data-dg-ok],[data-dg-no]'); if (!b || b.disabled || saving) return;
  const d = cell.getRow().getData(), sg = sugOf(d, k); if (!sg) return;
  if (b.matches('[data-dg-ok]')) { await save(d.l, applyRow(d.l, k, sg.target), `ผูก ${DBN[k]} แล้ว`); return; }
  try { await rejectPair(d.l, k, sg.target); toast('จำไว้แล้วว่าไม่ใช่คู่นี้'); await refresh(false); } catch (err) { toast(errText(err), 'err'); }
}
/* ---------- สารสำคัญ (เพิ่ม/ลด · ความแรงรายสาร) · กล่อง #dgIng ---------- */
const ING_UNITS = DC.UNITS;   // มก./เม็ด · มก./5 มล. · มก./มล. · mcg/เม็ด · mcg/มล.
let ingFor = null;
function ingsHtml(l) {
  const ings = l.ingredients || [];
  if (ings.length > 1) return `${ings.map((x) => `${esc(x.name)} ${esc(String(num(x.amt ?? x.mg)))}`).join(' + ')} ${esc(ING_UNITS.find(([v]) => v === `${ings[0].u || 'mg'}|${ings[0].per || 'tab'}`)?.[1] || '')}`;
  return mut(comboName(l.name) ? 'สูตรผสม · กดเพื่อกรอกสารสำคัญ' : 'ยาเดี่ยว · กดเพื่อเพิ่มสาร');
}
const ingRow = (x = {}) => `<div class="dg-ing-row"><input class="input i-n" maxlength="60" placeholder="ชื่อสารสำคัญ เช่น Trimethoprim" aria-label="ชื่อสารสำคัญ" value="${esc(x.name || '')}">`
  + `<input class="input i-a" type="number" inputmode="decimal" min="0" step="0.001" placeholder="ความแรง" aria-label="ความแรง" value="${esc(x.amt ?? '')}">`
  + `<select class="input i-u" aria-label="หน่วย">${ING_UNITS.map(([v, t]) => `<option value="${v}"${v === `${x.u || 'mg'}|${x.per || 'tab'}` ? ' selected' : ''}>${t}</option>`).join('')}</select>`
  + '<button type="button" class="btn btn-no btn-sm" data-ing-rm aria-label="ลบสารนี้">×</button></div>';
function openIngs(l) {
  ingFor = l;
  const ings = l.ingredients || [], s = l.strength;
  const rows = ings.length ? ings.map((x) => ({ name: x.name, amt: x.amt ?? x.mg, u: x.u || 'mg', per: x.per || 'tab' }))
    : [{ name: '', amt: s ? (s.u === 'mcg' ? s.amt : s.mg) : '', u: s?.u || 'mg', per: s?.per || 'tab' }];
  $('#dgIngTitle').textContent = l.name;
  $('#dgIngRows').innerHTML = rows.map(ingRow).join('');
  $('#dgIng').hidden = false;
  $('#dgIng').scrollIntoView({ block: 'nearest' });
  $('#dgIngRows .i-n')?.focus({ preventScroll: true });
}
function closeIngs() { ingFor = null; $('#dgIng').hidden = true; }
/** แถวสารสำคัญ → แถว local_drugs (1 สาร = ยาเดี่ยว: strength · ≥ 2 สาร = ingredients[] · คง dose_id รายสารตามชื่อเดิม) */
export function ingsRow(l, rows) {
  rows = rows.filter((x) => x.name || x.amt);
  const mgOf = (x) => (x.u === 'mcg' ? +(x.amt / 1000).toFixed(6) : x.amt);
  if (rows.length <= 1) {
    const r = rows[0], as = (l.ingredients || []).length > 1 ? null : l.strength?.as;
    if (r && !(r.amt > 0)) throw new Error('กรอกความแรงของสารสำคัญ');
    const old = (l.ingredients || []).find((x) => r && x.name && x.name.toLowerCase() === String(r.name).toLowerCase());
    return { strength: r ? { mg: mgOf(r), per: r.per, ...(r.u === 'mcg' ? { u: 'mcg', amt: r.amt } : {}), ...(as ? { as } : {}) } : null, ingredients: null, ...(old?.dose_id && !l.dose_id ? { dose_id: old.dose_id } : {}) };
  }
  if (rows.some((x) => !x.name || !(x.amt > 0))) throw new Error('ยาสูตรผสม: กรอกชื่อและความแรงของสารสำคัญให้ครบทุกแถว');
  if (new Set(rows.map((x) => x.name.toLowerCase())).size < rows.length) throw new Error('ชื่อสารสำคัญซ้ำกัน');
  if (new Set(rows.map((x) => x.per)).size > 1) throw new Error('ยาสูตรผสม: ทุกสารต้องเป็นต่อเม็ด หรือต่อ มล. เหมือนกัน');
  const doseOf = (n) => (l.ingredients || []).find((x) => x.name.toLowerCase() === n.toLowerCase())?.dose_id;
  return { strength: null, dose_id: null, ingredients: rows.map((x) => ({ name: x.name, mg: mgOf(x), per: x.per, ...(x.u === 'mcg' ? { u: 'mcg', amt: x.amt } : {}), ...(doseOf(x.name) ? { dose_id: doseOf(x.name) } : {}) })) };
}
async function saveIngs(btn) {
  const l = ingFor; if (!l) return;
  const rows = [...document.querySelectorAll('#dgIngRows .dg-ing-row')].map((r) => { const [u, per] = r.querySelector('.i-u').value.split('|'), a = +r.querySelector('.i-a').value; return { name: r.querySelector('.i-n').value.trim().replace(/\s+/g, ' '), amt: a > 0 ? a : null, u, per }; });
  let row;
  try { row = ingsRow(l, rows); } catch (err) { toast(err.message, 'err'); return; }
  btn.disabled = true;
  const ok = await save(l, row, row.ingredients ? `บันทึกสารสำคัญ ${row.ingredients.length} ตัวแล้ว` : 'บันทึกความแรงแล้ว');
  btn.disabled = false;
  if (ok) closeIngs();
}

/** เปิดยานี้ในหน้าทำงานทีละยา (#/admin/drugs) · ขนาดยาแก้ที่การ์ดขนาดยาในหน้านั้น */
function openPanel(id) { try { sessionStorage.setItem('pcps_work_focus', String(id)); } catch { /* ไม่เป็นไร */ } location.hash = '#/admin/drugs/work'; }

/* ---------- ตาราง ---------- */
async function refresh(reload) {
  const rs = await centerRows(reload);
  D = await drugData(); rows = rs.map(rowOf);
  if (table) { await table.replaceData(rows); count(); }
}
function filterFn(d) {
  const q = lc($('#dgQ').value.trim()), sc = $('#dgScope').value;
  return (sc === 'all' || (sc === 'outside' ? !!d.l.outside : !d.l.outside))
    && (!q || lc([d.name, d.code, d.l.code, d.category].join(' ')).includes(q))
    && (!$('#dgGap').checked || st.dbs.some((k) => ['miss', 'err', 'wait'].includes(d.j[k].s)));
}
function count() {
  const n = table.getDataCount('active');
  $('#dgCount').textContent = `แสดง ${n} จาก ${rows.length} ยา · ฐานที่แสดง: ${st.dbs.map((k) => DBN[k]).join(', ') || 'ไม่มี (เฉพาะข้อมูลยา)'}`;
}
function renderBar() {
  $$('[data-dg-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dgMode === st.mode)));
  $('#dgDbs').innerHTML = `<button type="button" class="dg-chip dg-chip-str" data-dg-str aria-pressed="${st.str}" title="รหัส · รูปแบบ · ความแรง · คิดเป็น">① รายการยาบนเว็บ</button>` + (st.mode === 'multi' ? `<button type="button" class="dg-chip" data-dg-all aria-pressed="${st.dbs.length === DBS.length}">ทั้งหมด</button>` : '')
    + DBS.map((k) => `<button type="button" class="dg-chip" data-dg-db="${k}" aria-pressed="${st.dbs.includes(k)}">${DBN[k]}</button>`).join('');
}
function applyCols() {
  renderBar(); remember();
  if (!table) return;
  table.setColumns(columns());
  table.refreshFilter(); count();
}
function bind() {
  window.addEventListener('pcps:drugtrash', () => { if (table && !$('#dcGrid').hidden) refresh(true); });   // เรียกคืนจากถังยาที่ลบ
  bound = true;
  $$('[data-dg-mode]').forEach((b) => b.addEventListener('click', () => {
    if (st.mode === b.dataset.dgMode) return;
    st.mode = b.dataset.dgMode;
    if (st.mode === 'one') st.dbs = [st.dbs[0] || 'rpst'];
    applyCols();
  }));
  $('#dgDbs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dg-db],[data-dg-all],[data-dg-str]'); if (!b) return;
    if (b.matches('[data-dg-str]')) st.str = !st.str;
    else if (b.matches('[data-dg-all]')) st.dbs = st.dbs.length === DBS.length ? [] : [...DBS];
    else if (st.mode === 'one') st.dbs = [b.dataset.dgDb];
    else { const k = b.dataset.dgDb; st.dbs = st.dbs.includes(k) ? st.dbs.filter((x) => x !== k) : DBS.filter((x) => x === k || st.dbs.includes(x)); }
    applyCols();
  });
  const re = () => { if (table) { table.refreshFilter(); count(); } };
  $('#dgQ').addEventListener('input', re); $('#dgScope').addEventListener('change', re); $('#dgGap').addEventListener('change', re);
  // นำเข้า/ส่งออก (drug-io.js)
  $$('[data-dg-export]').forEach((b) => b.addEventListener('click', async () => { if (!table) return; try { await exportDrugs(table.getData('active'), b.dataset.dgExport); } catch (err) { toast(errText(err), 'err'); } }));
  let plan = null, aiRes = null, aiFile = '', mimsList = null, lastRes = null, stage = '';   // mimsList = ไฟล์ MIMS ที่แยกหัวข้อแล้ว [{ file, p, err }] · lastRes = ผลบันทึกล่าสุด (ลองใหม่เฉพาะที่ไม่ได้) · stage = ขั้นที่กำลังทำ (บอกว่า error ตรงไหน)
  const box = () => $('#dgImpBox');
  const stepHtml = (on, msg) => `<div class="dg-steps">${[['📄', 'อ่านไฟล์'], ['✦', 'AI วิเคราะห์ว่าเป็นข้อมูลฐานไหน'], ['✓', 'ตรวจแล้วกดบันทึก']].map(([i, t], k) => `<span class="dg-step${k < on ? ' ok' : k === on ? ' now' : ''}"><b aria-hidden="true">${i}</b>${t}</span>`).join('')}</div>${msg ? `<p class="small muted">${esc(msg)}</p>` : '<div class="skeleton"></div>'}`;
  // ไฟล์ MIMS (PDF ที่พิมพ์หน้าเว็บ · หลายไฟล์ได้) → แยกหัวข้อในเครื่อง (ไม่ใช้ AI) → เลือกยาที่ผูก → บันทึกฐานข้อมูล MIMS
  const mimsStep = (on) => `<div class="dg-steps">${[['📄', 'อ่านไฟล์'], ['✂', 'แยกหัวข้อ MIMS ในเครื่อง (ไม่ใช้ AI)'], ['✓', 'เลือกยาที่ผูก แล้วกดบันทึก']].map(([i, t], k) => `<span class="dg-step${k < on ? ' ok' : k === on ? ' now' : ''}"><b aria-hidden="true">${i}</b>${t}</span>`).join('')}</div>`;
  const nameKey = (x) => String(x || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  const guessLocal = (p) => { const k = nameKey(p.name)[0]; if (!k) return null; const ls = (D?.locals || []).filter((l) => nameKey(l.name).includes(k)); return ls.find((l) => !l.mims_id) || ls[0] || null; };
  const showMims = () => {
    const locals = [...(D?.locals || [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    box().innerHTML = mimsStep(2) + `<p class="small muted">ไฟล์ข้อมูล MIMS ไม่ส่งให้ AI · ระบบแยกหัวข้อจากข้อความในไฟล์เอง · การ์ดข้อบ่งใช้รอเภสัชกรกรอกตัวเลขในหน้าทำงานทีละยา (ไม่เดาตัวเลข)</p>`
      + `<div class="dg-sum" data-dg-sum><span class="dc-ok">✓ ใช้ได้ ${mimsList.filter((x) => x.p?.sections.length).length} ไฟล์</span>${mimsList.some((x) => !x.p?.sections.length) ? `<span class="dc-err">✗ ข้าม ${mimsList.filter((x) => !x.p?.sections.length).length} ไฟล์</span>` : ''}</div>`
      + mimsList.map(({ file, p, sel, err }, k) => `<div class="dg-mims${err || !p.sections.length ? ' bad' : ''}" data-dg-mims="${k}"><p class="small"><b>${esc(file)}</b></p>`
        + (err ? `<p class="small dc-err" data-dg-mims-err>ข้ามไฟล์นี้: ${esc(err)}</p>` : p.sections.length ? `<p><b>${esc(p.name || '(ไม่พบชื่อยา)')}</b> · แยกได้ ${p.sections.length} หัวข้อ · การ์ดข้อบ่งใช้ ${p.inds.length} ข้อ${p.brands.length ? ` · ชื่อการค้า ${p.brands.length}` : ''}</p>`
          + `<div class="mm-heads">${p.sections.map((x) => `<details class="dg-mh"><summary class="chip">${esc(headTh(x.title))}</summary><p class="small">${esc(x.body.slice(0, 600))}${x.body.length > 600 ? '…' : ''}</p></details>`).join('')}</div>`
          + `<label class="dw-f"><span>ผูกกับยาในเว็บแอพ</span><select class="input" data-dg-mimsl="${k}"><option value="">— ไม่ผูก (เก็บในฐานข้อมูล MIMS อย่างเดียว) —</option>${locals.map((l) => `<option value="${esc(l.id)}"${String(l.id) === String(sel ?? '') ? ' selected' : ''}>${esc(l.name)}${l.mims_id ? ' (ผูก MIMS อยู่แล้ว)' : ''}</option>`).join('')}</select></label>`
          : '<p class="small dc-err" data-dg-mims-empty>ไม่พบหัวข้อของหน้า MIMS ในไฟล์นี้ (เช่น "Indications and Dosage") · ไฟล์นี้จะไม่ถูกบันทึก</p>') + '</div>').join('')
      + `<div class="row-btns"><button type="button" class="btn btn-p btn-sm" data-dg-mimssave${mimsList.some((x) => x.p?.sections.length) ? '' : ' disabled'}>${mimsList.some((x) => !x.p?.sections.length) ? 'ข้ามไฟล์ที่ไม่ได้ · ' : ''}บันทึกลงฐานข้อมูล MIMS (${mimsList.filter((x) => x.p?.sections.length).length} ไฟล์)</button><button type="button" class="btn btn-o btn-sm" data-dg-impno>ยกเลิก</button></div>`;
  };
  const showAi = async () => { plan = await planFromAi(aiRes); plan.ai = true; box().innerHTML = stepHtml(2, '') .replace('<div class="skeleton"></div>', '') + aiPlanHtml(plan, aiFile); };
  $('#dgImport').addEventListener('change', async (e) => {
    const files = [...e.target.files], f = files[0]; e.target.value = ''; if (!f) return;
    box().hidden = false; box().innerHTML = stepHtml(0, ''); box().scrollIntoView({ block: 'nearest' });
    plan = null; aiRes = null; aiFile = f.name; mimsList = null;
    try {
      if (files.length > 1 || /\.pdf$/i.test(f.name) || /\.(txt|md)$/i.test(f.name)) {   // MIMS: หลายไฟล์ได้ · แยกหัวข้อในเครื่อง ไม่ใช้ AI
        stage = 'อ่านไฟล์';
        const texts = await Promise.all(files.slice(0, 20).map(async (x) => { try { return { file: x.name, text: await fileText(x) }; } catch (err) { return { file: x.name, err: `อ่านไฟล์ไม่ได้: ${errText(err)}` }; } }));
        if (texts.some((x) => x.text && looksMims(x.text, x.file))) {   // มีไฟล์ MIMS = แยกหัวข้อไฟล์ MIMS · ไฟล์อื่น/อ่านไม่ได้ = แสดงว่าข้าม พร้อมเหตุผล
          stage = 'แยกหัวข้อ MIMS';
          await reloadDrugData(); D = await drugData();
          mimsList = texts.map(({ file, text, err }) => {
            if (err) return { file, err };
            if (!looksMims(text, file)) return { file, err: 'ไม่ใช่ไฟล์หน้า MIMS (ไฟล์ชนิดอื่นนำเข้าทีละไฟล์)' };
            try { const p = parseMimsText(text, file.replace(/\.[^.]+$/, '').split(/[_]/)[0]); return { file, p, sel: guessLocal(p)?.id ?? null }; } catch (e2) { return { file, err: `แยกหัวข้อไม่ได้: ${errText(e2)}` }; }
          });
          showMims(); return;
        }
        if (files.length > 1) throw new Error('นำเข้าทีละไฟล์ (เลือกหลายไฟล์ได้เฉพาะไฟล์หน้า MIMS)');
        if (texts[0].err) throw new Error(texts[0].err);
      }
      stage = 'อ่านไฟล์';
      if (await isOwnFormat(f)) { stage = 'ตรวจข้อมูลในไฟล์'; plan = await planDrugImport(await readDrugFile(f)); box().innerHTML = planHtml(plan, f.name); return; }   // ไฟล์ที่ส่งออกจากเว็บนี้ = นำเข้าตรง ไม่ใช้ AI
      const text = await fileText(f);
      if (text.replace(/\s/g, '').length < 10) throw new Error('ไม่พบข้อความในไฟล์ (PDF ที่เป็นภาพสแกนอ่านไม่ได้)');
      stage = 'AI วิเคราะห์ไฟล์';
      box().innerHTML = stepHtml(1, 'AI กำลังวิเคราะห์ไฟล์… (ไม่ส่งข้อมูล MIMS · ห้ามใช้ไฟล์ที่มีข้อมูลผู้ป่วย)');
      aiRes = await aiAnalyze(f.name, text);
      stage = 'จับคู่ข้อมูลกับฐานข้อมูล';
      await showAi();
    } catch (err) { plan = null; box().innerHTML = `<p class="small dc-err" data-dg-imperr>นำเข้า "${esc(f.name)}" ไม่สำเร็จ · ขั้น<b>${esc(stage || 'อ่านไฟล์')}</b>: ${esc(errText(err))}</p><p class="small muted">ยังไม่มีข้อมูลใดถูกบันทึก</p><div class="row-btns"><button type="button" class="btn btn-o btn-sm" data-dg-impno>ปิด</button></div>`; }
  });
  box().addEventListener('click', async (e) => {
    if (e.target.closest('[data-dg-impno]')) { plan = null; aiRes = null; mimsList = null; box().hidden = true; return; }
    const ms = e.target.closest('[data-dg-mimssave]');
    if (ms && mimsList) {
      ms.disabled = true; ms.textContent = 'กำลังบันทึก…';
      let cards = 0; const results = [];
      for (const [k, x] of mimsList.entries()) {
        if (!x.p?.sections.length) continue;
        const v = box().querySelector(`[data-dg-mimsl="${k}"]`)?.value || ''; x.sel = v || null;
        try { const r = await saveMimsText(x.p, v ? DC.idv(v) : null); cards += r.added; results.push({ name: `${x.file} → ${x.p.name}`, ok: true, item: x, kind: 'mims' }); }
        catch (err) { results.push({ name: x.file, ok: false, why: errText(err), item: x, kind: 'mims' }); }
      }
      lastRes = { kind: 'mims', results };
      box().innerHTML = resultHtml(`บันทึกไฟล์ MIMS · การ์ดข้อบ่งใช้ใหม่ ${cards} ข้อ (รอกรอกตัวเลขในหน้าทำงานทีละยา)`, results);
      if (results.every((x) => x.ok)) toast(`บันทึก MIMS แล้ว ${results.length} ไฟล์`);
      mimsList = null; await refresh(true); return;
    }
    if (e.target.closest('[data-dg-retry]') && lastRes) {   // ลองใหม่เฉพาะที่ไม่ได้
      const rb = e.target.closest('[data-dg-retry]');
      if (lastRes.kind === 'mims') { mimsList = lastRes.results.filter((x) => !x.ok).map((x) => x.item); lastRes = null; showMims(); return; }
      const p2 = retryPlan(lastRes.plan, lastRes.results);
      const r = lastRes.plan.ai ? await applyAiPlan({ ...p2, ai: true }, rb) : await applyDrugImport(p2, rb);
      const merged = [...lastRes.results.filter((x) => x.ok), ...r.results];
      lastRes = { kind: 'plan', plan: lastRes.plan, results: merged };
      box().innerHTML = resultHtml(`ลองใหม่แล้ว · ได้เพิ่ม ${r.ok} · ยังไม่ได้ ${r.bad}`, merged);
      await refresh(true); return;
    }
    const c = e.target.closest('[data-dg-addcat]');
    if (c) { try { await addCats([c.dataset.dgAddcat]); toast(`เพิ่มหมวด "${c.dataset.dgAddcat}" แล้ว`); renderCats(); await showAi(); } catch (err) { toast(errText(err), 'err'); } return; }
    const b = e.target.closest('[data-dg-impok]'); if (!b || !plan) return;
    const skipped = plan.bad.length, r = plan.ai ? await applyAiPlan(plan, b) : await applyDrugImport(plan, b);
    lastRes = { kind: 'plan', plan, results: r.results }; plan = null; aiRes = null;
    if (r.bad) box().innerHTML = resultHtml(`บันทึกแล้วบางส่วน${skipped ? ` (ข้ามแถวที่ข้อมูลไม่ถูกต้อง ${skipped} แถว)` : ''}`, r.results);   // ไม่ได้บางรายการ = แสดงรายการ + ลองใหม่/ข้าม
    else { toast(`นำเข้าแล้ว ${r.ok} รายการ${skipped ? ` · ข้าม ${skipped} แถวที่ไม่ได้` : ''}`); box().hidden = true; }
    await refresh(true); renderCats();
  });
  // หมวดยา: เจ้าของเว็บเพิ่มเอง (นำเข้าไฟล์ที่มีหมวดใหม่ต้องเพิ่มหมวดก่อน)
  const renderCats = async () => { const cs = await knownCats(); $('#dgCatN').textContent = `(${cs.length})`; $('#dgCatList').innerHTML = cs.map((x) => `<span class="chip c-role">${esc(x)}</span>`).join(''); };
  $('#dgCats').addEventListener('toggle', () => { if ($('#dgCats').open) renderCats(); });
  $('#dgCatAdd').addEventListener('click', async () => { const v = $('#dgCatNew').value.trim(); if (!v) { $('#dgCatNew').focus(); return; } try { await addCats([v]); $('#dgCatNew').value = ''; toast(`เพิ่มหมวด "${v}" แล้ว`); renderCats(); } catch (err) { toast(errText(err), 'err'); } });
  $('#dgIngAdd').addEventListener('click', () => { $('#dgIngRows').insertAdjacentHTML('beforeend', ingRow({ u: $('#dgIngRows .i-u')?.value.split('|')[0], per: $('#dgIngRows .i-u')?.value.split('|')[1] })); $('#dgIngRows .dg-ing-row:last-child .i-n').focus(); });
  $('#dgIngRows').addEventListener('click', (e) => { const b = e.target.closest('[data-ing-rm]'); if (!b) return; if ($$('#dgIngRows .dg-ing-row').length > 1) b.closest('.dg-ing-row').remove(); else b.closest('.dg-ing-row').querySelectorAll('input').forEach((x) => { x.value = ''; }); });
  $('#dgIngSave').addEventListener('click', (e) => saveIngs(e.currentTarget));
  $('#dgIngCancel').addEventListener('click', closeIngs);
  $('#dgGroup').addEventListener('change', () => table?.setGroupBy($('#dgGroup').checked ? 'category' : false));
}
async function loadLib() {
  if (Tabulator) return;
  const css = document.querySelector(`link[href="${TAB_CSS}"]`) ? null : new Promise((ok) => {   // วาดตารางหลังสไตล์โหลดเสร็จ (ขนาดหัวคอลัมน์คำนวณถูก)
    const ln = document.createElement('link'); ln.rel = 'stylesheet'; ln.href = TAB_CSS; ln.onload = ok; ln.onerror = ok; document.head.append(ln);
  });
  [{ TabulatorFull: Tabulator }] = await Promise.all([import(TAB_JS), css]);
}
/** มาจากแผงยา (✎ แก้ข้อมูลยา) → ล้างตัวกรอง แสดงช่องข้อมูลยา เลื่อนไปแถวยานั้น + ไฮไลต์ */
async function focusPending() {
  let id = null, k = null;   // 'id' หรือ 'id:ฐาน' (มาจากหน้าทำงานทีละยา · แก้ไขรายละเอียด → แสดงทีละฐานที่ฐานนั้น)
  try { [id, k] = String(sessionStorage.getItem('pcps_grid_focus') || '').split(':'); sessionStorage.removeItem('pcps_grid_focus'); } catch { /* ไม่เป็นไร */ }
  const row = id && table.getRow(DC.idv(id));
  if (!row) return;
  $('#dgQ').value = ''; $('#dgGap').checked = false; $('#dgScope').value = 'all';
  if (DBS.includes(k)) { st = { ...st, mode: 'one', dbs: [k], str: true }; applyCols(); }
  else if (!st.str) { st.str = true; applyCols(); } else { table.refreshFilter(); count(); }
  const r = table.getRow(DC.idv(id));
  await r.scrollTo('center', false).catch(() => {});
  const el = r.getElement(); el.classList.add('dg-flash'); el.scrollIntoView({ block: 'center' });
  setTimeout(() => el.classList.remove('dg-flash'), 3000);
}
export async function initDrugGrid() {
  // นำเข้าทั้งไฟล์ (บัญชียา รพ.สต. · MIMS) ย้ายจากเครื่องมือฐานข้อมูลมาไว้ที่หน้าตาราง (ตัวกล่องเดิม · การทำงานเดิมของ admin-rpst/admin-mims)
  for (const id of ['rlImportFold', 'mmImportFold']) { const el = document.getElementById(id); if (el && el.parentElement?.id !== 'dgBulkSlot') $('#dgBulkSlot').append(el); }
  if (!bound) bind();
  renderBar();
  try { await Promise.all([loadLib(), refresh(true)]); } catch (err) {
    toast(errText(err), 'err'); $('#dgTable').innerHTML = '<p class="empty">โหลดตารางไม่สำเร็จ กรุณาลองใหม่</p>'; return;
  }
  if (table) { table.redraw(true); count(); await focusPending(); return; }
  $('#dgTable').innerHTML = '';
  table = new Tabulator('#dgTable', {
    data: rows, index: 'id', columns: columns(), layout: 'fitData', renderVertical: 'basic', maxHeight: '72vh',
    groupBy: $('#dgGroup').checked ? 'category' : false, groupStartOpen: true, groupToggleElement: 'header',
    groupHeader: (v, n) => `${esc(v || 'ไม่ระบุรูปแบบ')} <span class="dg-gn">${n} ยา</span>`,
    initialSort: [{ column: 'name', dir: 'asc' }], columnDefaults: { vertAlign: 'middle' },
    placeholder: 'ไม่มียาตามเงื่อนไขนี้', editTriggerEvent: 'click',
  });
  table.on('tableBuilt', () => { table.setFilter(filterFn); count(); setTimeout(focusPending, 0); });
  table.on('cellEdited', (cell) => { onEdited(cell).catch((err) => toast(errText(err), 'err')); });
  // ช่องค้นหา (รายการ) เริ่มด้วยค่าเดิมที่เลือกทั้งข้อความ → พิมพ์แล้วแทนที่ (ไม่ต่อท้ายค่าเดิม)
  table.on('cellEditing', (cell) => setTimeout(() => { const i = cell.getElement().querySelector('input'); if (i && i.type !== 'number' && document.activeElement === i) i.select(); }, 0));
  table.on('dataFiltered', () => setTimeout(() => table && count(), 0));
}
