// ผู้ดูแล › ข้อมูลยา › ตารางแก้ไขยา › นำเข้า/ส่งออก (เจ้าของเว็บ 21 ต.ค.: หน้าตาราง = ตารางฐานข้อมูลพร้อม import/export)
//   ส่งออก: แถวที่แสดงอยู่ในตาราง → Excel (.xlsx · SheetJS จาก jsDelivr) / CSV (UTF-8 BOM) / JSON · ทำในเบราว์เซอร์
//   นำเข้า: ไฟล์รูปแบบเดียวกัน → จับคู่ยาด้วยรหัสในเว็บ (SHPS-…/OUT-…) → ชื่อยาตรงกัน → แสดงรายการที่จะเปลี่ยนก่อน → กดยืนยันจึงบันทึก
//   ช่องว่างในไฟล์ = ไม่เปลี่ยนค่าเดิม (ไม่ลบข้อมูลด้วยช่องว่าง) · แถวที่ไม่พบยา + มีชื่อ = เพิ่มยาใหม่ (ซ่อนไว้จนผู้ดูแลตรวจ)
//   ขนาดยา (ข้อบ่งใช้) ไม่นำเข้าจากไฟล์ — ต้องผ่านการ์ดขนาดยา + ทดสอบสูตรในหน้าทำงานทีละยา
import { sb } from '../supabase.js?v=4.4';
import { esc, toast, busy, errText } from '../util.js?v=4.4';
import { readTable, downloadXlsx } from './delivery-report.js?v=4.4';
import { drugData, reloadDrugData } from './admin-drugs.js?v=4.4';
import { DC } from './drug-center.js?v=4.4';

const UNIT_OF = (s) => (s && +s.mg > 0 ? `${s.u || 'mg'}|${s.per || 'tab'}` : '');
const unitLabel = (k) => DC.UNITS.find(([v]) => v === k)?.[1] || '';
const unitKey = (t) => { const x = String(t || '').trim(); return DC.UNITS.find(([v, lb]) => v === x || lb === x)?.[0] || null; };
const ingText = (ings) => (ings || []).map((x) => `${x.name} ${x.amt ?? x.mg} ${unitLabel(`${x.u || 'mg'}|${x.per || 'tab'}`)}`).join('; ');
const yes = (v) => /^(1|true|yes|y|ใช่|แสดง|✓)$/i.test(String(v).trim());
const no = (v) => /^(0|false|no|n|ไม่|ไม่ใช่|ซ่อน)$/i.test(String(v).trim());

/** คอลัมน์ไฟล์: [key (JSON), หัวคอลัมน์ (Excel/CSV), ค่าจากยา] */
export const COLS = [
  ['web_code', 'รหัสในเว็บ', (l) => l.web_code || ''],
  ['name', 'ชื่อยา', (l) => l.name],
  ['category', 'รูปแบบ', (l) => l.category || ''],
  ['strength', 'ความแรง', (l) => (l.strength && +l.strength.mg > 0 ? (l.strength.u === 'mcg' ? l.strength.amt : l.strength.mg) : '')],
  ['strength_unit', 'หน่วยความแรง', (l) => unitLabel(UNIT_OF(l.strength))],
  ['as_name', 'คิดเป็น (สาร)', (l) => l.strength?.as?.name || ''],
  ['as_mg', 'คิดเป็น (มก.)', (l) => l.strength?.as?.mg ?? ''],
  ['ingredients', 'สารสำคัญ (ยาสูตรผสม)', (l) => ((l.ingredients || []).length > 1 ? ingText(l.ingredients) : '')],
  ['pack_size', 'บรรจุ', (l) => l.pack_size || ''],
  ['unit', 'หน่วยนับ', (l) => l.unit || ''],
  ['note', 'หมายเหตุ', (l) => l.note || ''],
  ['active', 'แสดง', (l) => (l.active ? 'ใช่' : 'ไม่')],
  ['rpst_code', 'รหัสบัญชี รพ.สต.', (l) => l.code || ''],
  ['fda_key', 'ฉลากยา (openFDA key)', (l) => l.fda_key || ''],
  ['nlem', 'บัญชียาหลัก', (l, D) => [...new Set((l.mono_refs || []).map((r) => D.monos.find((m) => m.ref === r)?.name).filter(Boolean))].join('; ')],
  ['ddi', 'DDInter', (l) => (l.ddi_ids || []).join('; ')],
  ['status', 'สถานะ (อ่านอย่างเดียว)', (l, D, st) => st || ''],
];

/** ส่งออกยาที่แสดงอยู่ */
export async function exportDrugs(list, kind) {
  const D = await drugData(), day = new Date().toISOString().slice(0, 10), name = `drugs-${day}`;
  const objs = list.map(({ l, status }) => Object.fromEntries(COLS.map(([k, , get]) => [k, get(l, D, status ? DC.ROW[status]?.[0] : '')])));
  if (kind === 'json') return save(new Blob([JSON.stringify(objs, null, 2)], { type: 'application/json' }), `${name}.json`);
  const aoa = [COLS.map(([, h]) => h), ...objs.map((o) => COLS.map(([k]) => o[k]))];
  if (kind === 'csv') {
    const cell = (v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    return save(new Blob([`﻿${aoa.map((r) => r.map(cell).join(',')).join('\r\n')}`], { type: 'text/csv' }), `${name}.csv`);
  }
  return downloadXlsx(aoa, `${name}.xlsx`);
}
function save(blob, file) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** อ่านไฟล์ → [{key: ค่า}] (หัวคอลัมน์ไทยหรือ key ก็ได้) */
export async function readDrugFile(f) {
  if (/\.json$/i.test(f.name) || f.type === 'application/json') {
    const v = JSON.parse(await f.text());
    if (!Array.isArray(v)) throw new Error('ไฟล์ JSON ต้องเป็นรายการ [ {...}, ... ]');
    return v;
  }
  const aoa = await readTable(f);
  const head = (aoa[0] || []).map((h) => String(h).trim());
  const idx = COLS.map(([k, h]) => head.findIndex((x) => x === h || x === k));
  if (!idx.some((i, n) => i >= 0 && ['name', 'web_code'].includes(COLS[n][0]))) throw new Error('ไม่พบคอลัมน์ "ชื่อยา" หรือ "รหัสในเว็บ" ในไฟล์');
  return aoa.slice(1).filter((r) => r.some((c) => String(c).trim())).map((r) => Object.fromEntries(COLS.map(([k], n) => [k, idx[n] >= 0 ? r[idx[n]] : undefined])));
}

/** เทียบไฟล์กับข้อมูลเดิม → { upd: [{l, row, diff}], add: [row], bad: [ข้อความ], same } */
export async function planDrugImport(items) {
  const D = await drugData(), out = { upd: [], add: [], bad: [], same: 0 }, cats = new Set(await knownCats());
  const byCode = new Map(D.locals.filter((l) => l.web_code).map((l) => [l.web_code, l])), byName = new Map(D.locals.map((l) => [l.name.trim().toUpperCase(), l]));
  const has = (v) => v != null && String(v).trim() !== '';
  items.slice(0, 2000).forEach((o, n) => {
    const line = `แถว ${n + 2}`;
    const l = (has(o.web_code) && byCode.get(String(o.web_code).trim())) || (has(o.name) && byName.get(String(o.name).trim().toUpperCase())) || null;
    const row = {}, diff = [];
    const set = (k, v, label, oldV) => { if (JSON.stringify(v) !== JSON.stringify(oldV ?? null)) { row[k] = v; diff.push([label, oldV, v]); } };
    try {
      if (has(o.name)) set('name', String(o.name).trim().slice(0, 200), 'ชื่อยา', l?.name);
      if (has(o.category)) { const c = String(o.category).trim().slice(0, 100); if (cats && !cats.has(c)) throw new Error(`หมวดใหม่ "${c}" · เพิ่มหมวดก่อนจึงนำเข้าได้`); set('category', c, 'รูปแบบ', l?.category); }
      for (const [k, lb, max] of [['pack_size', 'บรรจุ', 40], ['unit', 'หน่วยนับ', 40], ['note', 'หมายเหตุ', 500]]) if (has(o[k])) set(k, String(o[k]).trim().slice(0, max), lb, l?.[k]);
      if (has(o.active)) { if (!yes(o.active) && !no(o.active)) throw new Error('ช่อง "แสดง" ต้องเป็น ใช่/ไม่'); set('active', yes(o.active), 'แสดง', l?.active); }
      if (has(o.ingredients)) {
        const ings = String(o.ingredients).split(';').map((t) => t.trim()).filter(Boolean).map((t) => {
          const m = /^(.+?)\s+([\d.]+)\s*(.*)$/.exec(t); if (!m) throw new Error(`สารสำคัญ "${t}" ต้องเป็น ชื่อ ความแรง หน่วย`);
          const [u, per] = (unitKey(m[3]) || 'mg|tab').split('|'), amt = +m[2];
          return { name: m[1].trim(), mg: u === 'mcg' ? +(amt / 1000).toFixed(6) : amt, per, ...(u === 'mcg' ? { u: 'mcg', amt } : {}), ...((l?.ingredients || []).find((x) => x.name.toLowerCase() === m[1].trim().toLowerCase())?.dose_id ? { dose_id: l.ingredients.find((x) => x.name.toLowerCase() === m[1].trim().toLowerCase()).dose_id } : {}) };
        });
        if (ings.length > 1) { if (new Set(ings.map((x) => x.per)).size > 1) throw new Error('สารสำคัญทุกตัวต้องหน่วยเดียวกัน'); set('ingredients', ings, 'สารสำคัญ', l?.ingredients); if (l?.strength) set('strength', null, 'ความแรง', l.strength); }
      } else if (has(o.strength)) {
        const amt = +o.strength, uk = has(o.strength_unit) ? unitKey(o.strength_unit) : UNIT_OF(l?.strength) || 'mg|tab';
        if (!(amt > 0)) throw new Error('ความแรงต้องเป็นตัวเลขมากกว่า 0');
        if (!uk) throw new Error(`หน่วยความแรง "${o.strength_unit}" ไม่รู้จัก (ใช้ ${DC.UNITS.map(([, t]) => t).join(' / ')})`);
        const [u, per] = uk.split('|'), asN = has(o.as_name) ? String(o.as_name).trim() : l?.strength?.as?.name, asMg = has(o.as_mg) ? +o.as_mg : l?.strength?.as?.mg;
        if (asN && !(asMg > 0)) throw new Error('กรอก "คิดเป็น (มก.)" ให้ครบ');
        set('strength', { mg: u === 'mcg' ? +(amt / 1000).toFixed(6) : amt, per, ...(u === 'mcg' ? { u: 'mcg', amt } : {}), ...(asN ? { as: { name: asN, mg: +asMg } } : {}) }, 'ความแรง', l?.strength);
      }
      if (has(o.rpst_code)) {
        const c = String(o.rpst_code).trim();
        if (!(D.rpst || []).some((x) => x.code === c)) throw new Error(`รหัสบัญชี ${c} ไม่มีในบัญชียา รพ.สต. (เพิ่มในบัญชีก่อน)`);
        if (D.locals.some((x) => x.code === c && x.id !== l?.id)) throw new Error(`รหัสบัญชี ${c} ผูกกับยาตัวอื่นแล้ว`);
        set('code', c, 'รหัสบัญชี รพ.สต.', l?.code); if (row.code) row.outside = false;
      }
      if (has(o.fda_key)) { const k = String(o.fda_key).trim(); if (!D.fdas.some((f) => f.key === k)) throw new Error(`ไม่พบฉลาก ${k}`); set('fda_key', k, 'ฉลากยา', l?.fda_key); }
      if (has(o.nlem)) {
        const names = String(o.nlem).split(';').map((t) => t.trim()).filter(Boolean), miss = names.filter((x) => !D.monos.some((m) => m.name === x));
        if (miss.length) throw new Error(`ไม่พบในบัญชียาหลัก: ${miss.join(', ')}`);
        const refs = D.monos.filter((m) => names.includes(m.name)).map((m) => m.ref);
        if (JSON.stringify([...refs].sort()) !== JSON.stringify([...(l?.mono_refs || [])].sort())) { row.mono_refs = refs; diff.push(['บัญชียาหลัก', '', names.join(', ')]); }
      }
      if (has(o.ddi)) {
        const ids = String(o.ddi).split(';').map((t) => t.trim()).filter(Boolean), miss = ids.filter((x) => !D.ddDrugs.some((d) => d.id === x));
        if (miss.length) throw new Error(`ไม่พบใน DDInter: ${miss.join(', ')}`);
        if (JSON.stringify([...ids].sort()) !== JSON.stringify([...(l?.ddi_ids || [])].sort())) { row.ddi_ids = ids; diff.push(['DDInter', (l?.ddi_ids || []).join(', '), ids.join(', ')]); }
      }
    } catch (err) { out.bad.push(`${line}${has(o.name) ? ` (${String(o.name).trim()})` : ''}: ${err.message}`); return; }
    if (!l) { if (!has(o.name)) { out.bad.push(`${line}: ไม่มีชื่อยา`); return; } out.add.push({ row: { category: 'อื่น ๆ', ...row, outside: !row.code, active: false }, diff }); return; }
    if (diff.length) out.upd.push({ l, row, diff }); else out.same++;
  });
  return out;
}
const show = (v) => (v == null || v === '' ? '–' : Array.isArray(v) ? `${v.length} รายการ` : typeof v === 'object' ? (v.mg ? `${v.u === 'mcg' ? v.amt : v.mg} ${unitLabel(UNIT_OF(v))}${v.as ? ` คิดเป็น ${v.as.name} ${v.as.mg}` : ''}` : JSON.stringify(v)) : v === true ? 'ใช่' : v === false ? 'ไม่' : String(v));
export function planHtml(p, file) {
  const n = p.upd.length + p.add.length;
  return `<b>นำเข้า "${esc(file)}"</b><p class="small">แก้ ${p.upd.length} ยา · เพิ่มใหม่ ${p.add.length} ยา (ซ่อนไว้ก่อน) · ไม่เปลี่ยน ${p.same} ยา${p.bad.length ? ` · <span class="dc-err">ข้ามเพราะข้อมูลไม่ถูกต้อง ${p.bad.length} แถว</span>` : ''}</p>`
    + (p.bad.length ? `<details class="small dg-bad"${p.bad.length <= 10 ? ' open' : ''}><summary>แถวที่ข้าม (${p.bad.length})</summary><ul>${p.bad.slice(0, 50).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : '')
    + (n ? `<div class="chg"><table><thead><tr><th>ยา</th><th>ช่อง</th><th>เดิม</th><th>ใหม่</th></tr></thead><tbody>${[...p.upd.map((x) => [x.l.name, x.diff]), ...p.add.map((x) => [`${x.row.name} (ใหม่)`, x.diff])].slice(0, 80)
      .map(([nm, diff]) => diff.map(([f, a, b2], i) => `<tr>${i ? '<td></td>' : `<td><b>${esc(nm)}</b></td>`}<td>${esc(f)}</td><td class="muted">${esc(show(a))}</td><td>${esc(show(b2))}</td></tr>`).join('')).join('')}</tbody></table></div>` : '<p class="small muted">ไม่มีอะไรต้องเปลี่ยน</p>')
    + `<div class="row-btns">${n ? `<button type="button" class="btn btn-p btn-sm" data-dg-impok>บันทึก ${n} ยา</button>` : ''}<button type="button" class="btn btn-o btn-sm" data-dg-impno>${n ? 'ยกเลิก' : 'ปิด'}</button></div>`;
}
/** บันทึกตามแผน · คืนจำนวนที่สำเร็จ/ไม่สำเร็จ */
export async function applyDrugImport(p, btn) {
  busy(btn, true, 'กำลังบันทึก…');
  let ok = 0, bad = 0;
  try {
    const now = new Date().toISOString();
    for (const x of p.upd) { const { error } = await sb.from('local_drugs').update({ ...x.row, updated_at: now }).eq('id', x.l.id); if (error) { bad++; toast(`${x.l.name}: ${errText(error)}`, 'err'); } else ok++; }
    if (p.add.length) { const { error } = await sb.from('local_drugs').insert(p.add.map((x) => x.row)); if (error) { bad += p.add.length; toast(errText(error), 'err'); } else ok += p.add.length; }
    await reloadDrugData();
  } finally { busy(btn, false); }
  return { ok, bad };
}

/* ======================= นำเข้าด้วย AI (89_ai_drug_import.sql) =======================
   ไฟล์ที่ไม่ใช่รูปแบบส่งออกของเว็บ (Excel/CSV จากระบบอื่น · PDF · ข้อความ) → อ่านข้อความในเบราว์เซอร์ → AI บอกว่าเป็นฐานไหน + จับลงช่อง
   → ตรวจหมวด (หมวดที่ยังไม่มี = แจ้งเตือน ไม่นำเข้าแถวนั้น จนกว่าผู้ดูแลกด "เพิ่มหมวด") → แสดงรายการ → ผู้ดูแลกดบันทึก */
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build';
/** ข้อความจากไฟล์ (ตาราง = คั่นด้วยแท็บ) · ≤ 40,000 ตัวอักษร */
export async function fileText(f) {
  if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
    const pdfjs = await import(`${PDFJS}/pdf.min.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`;
    const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise, out = [];
    for (let i = 1; i <= Math.min(doc.numPages, 40); i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      let line = '', y = null;
      for (const it of tc.items) { const yy = Math.round(it.transform[5]); if (y != null && Math.abs(yy - y) > 2) { out.push(line); line = ''; } line += (line && !line.endsWith(' ') ? '\t' : '') + it.str; y = yy; }
      out.push(line);
    }
    return out.join('\n').slice(0, 40000);
  }
  if (/\.(txt|md)$/i.test(f.name) || f.type.startsWith('text/plain')) return (await f.text()).slice(0, 40000);
  const aoa = await readTable(f);
  return aoa.slice(0, 600).map((r) => r.map((c) => String(c ?? '').replace(/\s+/g, ' ').trim()).join('\t')).join('\n').slice(0, 40000);
}
/** ไฟล์เป็นรูปแบบส่งออกของเว็บนี้ (หัวคอลัมน์ตรง) → นำเข้าตรงได้ ไม่ต้องใช้ AI */
export async function isOwnFormat(f) {
  if (/\.json$/i.test(f.name)) return true;
  if (/\.(pdf|txt|md)$/i.test(f.name)) return false;
  try { const head = ((await readTable(f))[0] || []).map((h) => String(h).trim()); return head.includes('ชื่อยา') && head.includes('รหัสในเว็บ'); } catch { return false; }
}
export async function aiAnalyze(name, text, onWait) {
  const { data: id, error } = await sb.rpc('ai_drug_import_start', { p_name: name, p_text: text });
  if (error) throw error;
  for (let n = 0; n < 80; n++) {
    await new Promise((ok) => setTimeout(ok, n ? 3000 : 1200));
    onWait?.(n);
    const { data, error: e2 } = await sb.rpc('ai_drug_import_poll', { p_id: id });
    if (e2) throw e2;
    if (data.status !== 'pending') { if (!data.result) throw new Error(data.note || 'AI วิเคราะห์ไม่สำเร็จ กรุณาลองใหม่'); return data.result; }
  }
  throw new Error('หมดเวลารอ AI กรุณาลองใหม่');
}

/* ---- หมวดยา (เจ้าของเว็บเพิ่มเอง · site_texts 'drug_categories' + หมวดที่ใช้อยู่แล้ว) ---- */
let extraCats = null;
async function loadCats() {
  if (extraCats) return extraCats;
  const { data } = await sb.from('site_texts').select('body').eq('key', 'drug_categories').maybeSingle();
  try { extraCats = JSON.parse(data?.body || '[]').filter((x) => typeof x === 'string'); } catch { extraCats = []; }
  return extraCats;
}
export async function knownCats() {
  const D = await drugData(), extra = await loadCats();
  return [...new Set([...extra, ...D.locals.map((l) => l.category), ...(D.rpst || []).map((x) => x.category), ...D.monos.map((m) => m.group_name)].filter(Boolean).map((x) => String(x).trim()))].sort((a, b) => a.localeCompare(b, 'th'));
}
export async function addCats(names) {
  const cur = await loadCats(), next = [...new Set([...cur, ...names.map((x) => String(x).trim()).filter(Boolean)])];
  if (JSON.stringify(next).length > 4900) throw new Error('รายการหมวดยาวเกินไป');
  const { error } = await sb.from('site_texts').upsert({ key: 'drug_categories', body: JSON.stringify(next), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
  extraCats = next;
}

/** ผล AI → แผนนำเข้า (ตามฐาน) · แถวที่หมวดใหม่ = newCats (ข้ามจนกว่าจะเพิ่มหมวด) */
export async function planFromAi(res) {
  const D = await drugData(), cats = new Set(await knownCats()), newCats = new Map();
  const catOk = (c, line) => { if (!c || cats.has(String(c).trim())) return true; const k = String(c).trim(); newCats.set(k, [...(newCats.get(k) || []), line]); return false; };
  const plan = { target: res.target, why: res.why || '', dropped: res.dropped || 0, unmapped: res.unmapped || [], upd: [], add: [], bad: [], same: 0, newCats };
  const rows = res.rows || [];
  if (res.target === 'drugs') {
    const ok = rows.filter((r, n) => catOk(r.category, r.name || `แถว ${n + 1}`));
    Object.assign(plan, await planDrugImport(ok.map((r) => ({ name: r.name, category: r.category, strength: r.strength, strength_unit: r.strength_unit, pack_size: r.pack_size, unit: r.unit, note: r.note, rpst_code: r.rpst_code }))), { target: 'drugs', newCats });
  } else if (res.target === 'rpst') {
    const byCode = new Map((D.rpst || []).map((x) => [x.code, x]));
    rows.forEach((r) => {
      if (!r.code || !r.name) { plan.bad.push(`${r.name || r.code || 'แถว'}: ต้องมีรหัสยาและชื่อ`); return; }
      if (!catOk(r.category, `${r.code} ${r.name}`)) return;
      const old = byCode.get(String(r.code).trim()), row = {}, diff = [];
      for (const [k, lb] of [['name', 'ชื่อ'], ['category', 'หมวด'], ['pack_size', 'บรรจุ'], ['unit', 'หน่วย']]) if (r[k] && String(r[k]).trim() !== String(old?.[k] ?? '')) { row[k] = String(r[k]).trim(); diff.push([lb, old?.[k], row[k]]); }
      if (!old) plan.add.push({ row: { code: String(r.code).trim(), category: 'อื่น ๆ', ...row, in_list: true }, diff: [['รหัส', '', r.code], ...diff] });
      else if (diff.length) plan.upd.push({ l: { id: old.id, name: `${old.code} · ${old.name}` }, row, diff }); else plan.same++;
    });
  } else if (res.target === 'nlem') {
    rows.forEach((r) => {
      if (!catOk(r.group_name, r.name)) return;
      const old = D.monos.find((m) => m.name.toLowerCase() === String(r.name).trim().toLowerCase());
      if (old) { plan.same++; return; }   // มีในบัญชียาหลักแล้ว = ไม่ทับเนื้อหาเดิม (แก้ที่หน้าทำงานทีละยา)
      plan.add.push({ row: { name: String(r.name).trim(), group_name: r.group_name || 'อื่น ๆ', sub_name: r.sub_name || '', forms: r.forms || [], flags: [], sections: [] }, diff: [['ใหม่ในบัญชียาหลัก', '', [r.group_name, r.sub_name].filter(Boolean).join(' › ')]] });
    });
  }
  return plan;
}
const TARGET = { drugs: 'รายการยาในเว็บแอพ', rpst: 'บัญชียา รพ.สต.', nlem: 'บัญชียาหลักแห่งชาติ', other: 'ไม่ใช่ข้อมูลยาที่นำเข้าได้' };
export function aiPlanHtml(p, file) {
  const nc = [...p.newCats.entries()];
  return `<div class="dg-ai-h"><span class="dg-ai-ic" aria-hidden="true">✦</span><div><b>AI วิเคราะห์ "${esc(file)}"</b><p class="small">ข้อมูลนี้คือ <b>${esc(TARGET[p.target] || p.target)}</b>${p.why ? ` · ${esc(p.why)}` : ''}</p></div></div>`
    + (p.dropped ? `<p class="small dc-warn">ตัด ${p.dropped} แถวที่ AI ใส่มาแต่ไม่พบในไฟล์ (กันข้อมูลที่ AI แต่งเอง)</p>` : '')
    + (p.unmapped.length ? `<p class="small muted">ข้อมูลในไฟล์ที่ยังไม่มีช่องรองรับ: ${esc(p.unmapped.join(', '))}</p>` : '')
    + (nc.length ? `<div class="dg-newcat"><b class="small">⚠ พบหมวดใหม่ ${nc.length} หมวด · แถวในหมวดนี้ยังไม่นำเข้า จนกว่าคุณจะเพิ่มหมวด</b>${nc.map(([c, ls]) => `<div class="dg-nc"><span><b>${esc(c)}</b> <small class="muted">(${ls.length} รายการ: ${esc(ls.slice(0, 3).join(', '))}${ls.length > 3 ? ' …' : ''})</small></span><button type="button" class="btn btn-o btn-sm" data-dg-addcat="${esc(c)}">+ เพิ่มหมวดนี้</button></div>`).join('')}</div>` : '')
    + (p.target === 'other' ? '<div class="row-btns"><button type="button" class="btn btn-o btn-sm" data-dg-impno>ปิด</button></div>' : planHtml(p, file).replace(/^<b>นำเข้า[^<]*<\/b>/, ''));
}
/** บันทึกแผนจาก AI ตามฐาน */
export async function applyAiPlan(p, btn) {
  if (p.target === 'drugs') return applyDrugImport(p, btn);
  busy(btn, true, 'กำลังบันทึก…');
  let ok = 0, bad = 0;
  try {
    const tb = p.target === 'rpst' ? 'rpst_list' : 'drug_monographs';
    for (const x of p.upd) { const { error } = await sb.from(tb).update(x.row).eq('id', x.l.id); if (error) { bad++; toast(errText(error), 'err'); } else ok++; }
    if (p.add.length) {
      const rows = p.target === 'nlem' ? p.add.map((x, i) => ({ ...x.row, group_no: 0, sub_code: '0', no: 0, ref: `custom:${Date.now()}-${i}`, sort: 100000 + i })) : p.add.map((x) => x.row);
      const { error } = await sb.from(tb).insert(rows); if (error) { bad += rows.length; toast(errText(error), 'err'); } else ok += rows.length;
    }
    await reloadDrugData();
  } finally { busy(btn, false); }
  return { ok, bad };
}
