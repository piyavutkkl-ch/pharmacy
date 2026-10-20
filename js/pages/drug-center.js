// ผู้ดูแล › ข้อมูลยา › ศูนย์ข้อมูลยา (#/admin/drugs) · วิธีใช้ (#/admin/drugs/help)
//   ตอบ 3 คำถาม: มียาอะไรบ้าง (การ์ด + วงกลมรายส่วน) → ยาตัวไหนมีปัญหา (ตารางสถานะ 5 ช่อง เรียงปัญหาหนักก่อน) → กดตรงไหน (แผงรายละเอียดด้านขวา)
//   สถานะต่อส่วน judge(): ok ครบ · wait รอตรวจ (ร่าง AI / จับคู่ตามชื่อ / สารสำคัญที่ระบบใส่) · miss ยังไม่ผูก · err ข้อมูลขัดกัน · na ไม่ใช้กับยานี้
//     na มาจากกลุ่มยา (ยาทาไม่ต้องคำนวณ ฯลฯ) หรือผู้ดูแลกำหนด local_drugs.link_na (83_drug_center.sql)
//   แผงรายละเอียด: ขั้นความพร้อม 4 ขั้น (ข้อมูลครบ ≠ พร้อมใช้คำนวณ) + แผนผัง + แก้ทีละส่วนในแผง (กดปุ่มดินสอ · เปิดได้ทีละส่วน)
//   คู่ที่ระบบเสนอ suggest(): หลักฐาน + ความมั่นใจ · กด ✓ ได้เฉพาะ ≥ 85% และหลักฐานตรงทุกข้อ · ✗ = จำใน drug_link_rejects ไม่เสนออีก · ระบบไม่ผูกเอง
//   ใช้ข้อมูลชุดเดียวกับส่วนฐานข้อมูลด้านล่าง (admin-drugs.js drugData) · บันทึกแล้วโหลดใหม่ทั้งสองที่
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, busy, errText } from '../util.js?v=4.4';
import { strengthOf, comboName, keysOf, sameDrug } from './dose.js?v=4.4';
import { drugData, reloadDrugData, doseIdsOf, genericKey, codeTag, fetchFdaLabel, editLocalForm, openDrugSection } from './admin-drugs.js?v=4.4';
import { indsProblem, indsOf, openDoseEdit, doseQuery } from './admin-settings.js?v=4.4';

const K = ['str', 'dose', 'nlem', 'fda', 'ddi'];
const KN = { str: 'ความแรง / สารสำคัญ', dose: 'ขนาดยา (คำนวณ)', nlem: 'บัญชียาหลักแห่งชาติ', fda: 'ฉลาก openFDA', ddi: 'DDInter' };
const KS = { str: 'ความแรง', dose: 'ขนาดยา', nlem: 'บัญชียาหลัก', fda: 'ฉลาก', ddi: 'DDInter' };
const SYM = { ok: '✓', wait: '●', miss: '✗', err: '!', na: '–' };
const SN = { ok: 'ครบ', wait: 'รอตรวจ', miss: 'ยังไม่ผูก', err: 'ผิดพลาด', na: 'ไม่ใช้' };
const ROW = { err: ['ผิดพลาด', 'err'], miss: ['ยังไม่ครบ', 'miss'], wait: ['รอตรวจ', 'wait'], ready: ['พร้อมใช้', 'ok'] };
const RANK = { err: 0, miss: 1, wait: 2, ready: 3 };
const PER = { tab: 'มก./เม็ด', '5ml': 'มก./5 มล.', ml: 'มก./มล.' };
const UNITS = [['mg|tab', 'มก./เม็ด'], ['mg|5ml', 'มก./5 มล.'], ['mg|ml', 'มก./มล.'], ['mcg|tab', 'mcg/เม็ด'], ['mcg|ml', 'mcg/มล.']];
// กลุ่มยาที่ไม่ต้องมีข้อมูลส่วนนั้น (ค่าเริ่มต้น · ผู้ดูแลเปลี่ยนได้ในแผง)
const ORAL = /เม็ด|แคปซูล|น้ำรับประทาน|ผง/, NCD = /NCD|เรื้อรัง/;
const NO_FDA = /สมุนไพร/, NO_DDI = /ภายนอก|สมุนไพร|สารน้ำ|ป้ายปาก/;
const STRONG = 85;

let D = null, rejects = [], filt = 'all', scope = 'all', sel = null, focusK = null, edit = null, bound = false;
const like = (a, b) => !!a && !!b && (a === b || sameDrug(a, b) || sameDrug(b, a));
const num = (x) => +(+x).toFixed(3);
const isCombo = (l) => (l.ingredients || []).filter((x) => +x.mg > 0).length > 1;
const cat = (l) => String(l.category || '');
const doseById = (id) => D.doses.find((d) => d.id === id);

/** สถานะของยา 1 ตัวในส่วน k → { s, t (ค่าที่ผูก), why (เหตุผล), auto (ข้อมูลคำนวณที่จับคู่ตามชื่อ) } */
function judge(l, k) {
  const na = (l.link_na || []).includes(k), NA = (why) => ({ s: 'na', t: na ? 'ผู้ดูแลกำหนดว่าไม่ใช้กับยานี้' : why });
  if (k === 'str') {
    const ings = (l.ingredients || []).filter((x) => +x.mg > 0);
    if (ings.length > 1) return ings.some((x) => x.auto) ? { s: 'wait', t: ings.map((x) => `${x.name} ${num(x.mg)}`).join(' + ') + ` ${PER[ings[0].per] || ''}`, why: 'สารสำคัญชุดนี้ระบบใส่ให้ รอทวนสอบกับฉลากจริง' }
      : { s: 'ok', t: ings.map((x) => `${x.name} ${num(x.mg)}`).join(' + ') + ` ${PER[ings[0].per] || ''}` };
    if (comboName(l.name)) return na ? NA() : { s: 'err', why: 'ยาสูตรผสม ยังไม่ได้กรอกสารสำคัญแต่ละตัว เครื่องคำนวณจึงคิดจำนวนเม็ด/มล. ไม่ได้' };
    const st = strengthOf(l);
    if (st) return { s: 'ok', t: `${num(st.mg)} ${PER[st.per]}${l.strength ? '' : ' (อ่านจากชื่อยา)'}` };
    return na || !(ORAL.test(cat(l)) || NCD.test(cat(l))) ? NA('ยากลุ่มนี้ไม่ใช้คำนวณ') : { s: 'miss', why: 'ยังไม่มีความแรง และอ่านจากชื่อยาไม่ได้' };
  }
  if (k === 'dose') {
    const own = [l.dose_id, ...(l.ingredients || []).map((x) => x.dose_id)].filter(Boolean);
    if (na && !own.length) return NA();   // ผู้ดูแลกำหนดว่าไม่ใช้ ชนะการจับคู่ตามชื่อ
    const ids = own.length ? own : doseIdsOf(l), d = ids.length ? doseById(ids[0]) : null;
    if (!d) return na || !ORAL.test(cat(l)) ? NA(NCD.test(cat(l)) ? 'ยาโรคเรื้อรังผู้ใหญ่ ไม่คำนวณตามน้ำหนัก' : 'ยากลุ่มนี้ไม่คำนวณตามน้ำหนัก') : { s: 'miss', why: 'ยังไม่มีข้อมูลคำนวณขนาดยา' };
    const name = `${d.web_code ? d.web_code + ' ' : ''}${d.name}`;
    if (d.ai_draft) return d.draft_issue ? { s: 'err', t: name, why: `ร่าง AI ข้อมูลไม่ครบ: ${d.draft_issue}`, dose: d } : { s: 'wait', t: `${name} · ร่าง AI รอเภสัชกรตรวจ`, dose: d };
    const p = indsProblem(indsOf(d));
    if (p) return { s: 'err', t: name, why: p, dose: d };
    if (!own.length) return { s: 'wait', t: `${name} · จับคู่ตามชื่อ ยังไม่ได้ยืนยัน`, dose: d, auto: d };
    if (!d.active) return { s: 'wait', t: `${name} · ซ่อนจากเครื่องคำนวณ`, dose: d };
    return { s: 'ok', t: `${name}${d.approved_at ? ' · อนุมัติแล้ว' : ''}`, dose: d };
  }
  if (k === 'nlem') {
    const ms = [...new Map((l.mono_refs || []).map((r) => D.monos.find((m) => m.ref === r)).filter(Boolean).map((m) => [m.name, m])).values()];
    return ms.length ? { s: 'ok', t: ms.map((m) => `${m.web_code ? m.web_code + ' ' : ''}${m.name}`).join(', ') } : na ? NA() : { s: 'miss' };
  }
  if (k === 'fda') {
    const f = l.fda_key && D.fdas.find((x) => x.key === l.fda_key);
    if (f) return { s: 'ok', t: `${f.web_code ? f.web_code + ' ' : ''}${f.title} · ${f.generic} (${f.route})` };
    if (l.fda_key) return { s: 'err', why: `ผูกฉลาก "${l.fda_key}" ไว้ แต่ไม่พบฉลากนี้แล้ว` };
    return na || NO_FDA.test(cat(l)) ? NA('ยาสมุนไพรไม่มีฉลาก FDA') : { s: 'miss' };
  }
  const ds = (l.ddi_ids || []).map((i) => D.ddDrugs.find((x) => x.id === i)).filter(Boolean);
  return ds.length ? { s: 'ok', t: ds.map((x) => `${x.web_code ? x.web_code + ' ' : ''}${x.name}`).join(' + ') } : na || NO_DDI.test(cat(l)) ? NA('ยาใช้เฉพาะที่/สมุนไพร ไม่ตรวจ interaction') : { s: 'miss' };
}
const judgeAll = (l) => Object.fromEntries(K.map((k) => [k, judge(l, k)]));
function rowStatus(j, l) {
  const v = K.map((k) => j[k].s);
  return v.includes('err') ? 'err' : v.includes('miss') ? 'miss' : v.includes('wait') || !l.active ? 'wait' : 'ready';
}
/** ขั้นความพร้อม 4 ขั้น: ข้อมูลยา → ผูกฐานข้อมูล → เภสัชกรตรวจ → อนุมัติใช้ */
function steps(j, l) {
  const s1 = !['miss', 'err'].includes(j.str.s);
  const s2 = s1 && !['dose', 'nlem', 'fda', 'ddi'].some((k) => j[k].s === 'miss');
  const s3 = s2 && !K.some((k) => ['err', 'wait'].includes(j[k].s));
  const s4 = s3 && l.active && (j.dose.s === 'na' || !!j.dose.dose?.approved_at || !!j.dose.dose?.active);
  return [s1, s2, s3, s4];
}

/* ---------- คู่ที่ระบบเสนอ (หลักฐาน + ความมั่นใจ) ---------- */
const tabletLike = (l) => /TAB|CAP|เม็ด|แคปซูล/i.test(`${l.name} ${l.unit} ${cat(l)}`);
const liquidLike = (l) => /SYR|SUSP|ML\b|น้ำ/i.test(`${l.name} ${l.unit} ${cat(l)}`) && !tabletLike(l);
function routeOf(l) {
  const t = `${l.name} ${cat(l)}`;
  if (/EYE|ตา\b|หยอดตา/i.test(t)) return 'OPHTHALMIC';
  if (/ภายนอก|CREAM|OINT|LOTION|GEL/i.test(t)) return 'TOPICAL';
  if (ORAL.test(cat(l)) || NCD.test(cat(l))) return 'ORAL';
  return null;
}
/** ชื่อที่ใช้ค้นคู่: ชื่อสามัญจากชื่อยา · ชื่อที่สหรัฐฯ ใช้ · ชื่อในบัญชียาหลักที่ผูกไว้ */
function namesOf(l) {
  const g = genericKey(l.name), us = doseQuery(String(l.name).replace(/\d.*$/, '')) || '';
  const mono = (l.mono_refs || []).map((r) => D.monos.find((m) => m.ref === r)).filter(Boolean).flatMap((m) => keysOf(m.name));
  return { g, us: us !== g ? us : '', mono: [...new Set(mono)].filter((x) => x !== g) };
}
const rejected = (l, k, t) => rejects.some((r) => r.local_id === l.id && r.kind === k && r.target === String(t));
function suggest(l, k, j) {
  const { g, us, mono } = namesOf(l);
  if (g.length < 3 && !mono.length) return null;
  const out = [];
  if (k === 'dose' && j.dose.auto) out.push({ target: j.dose.auto.id, label: `${j.dose.auto.web_code || ''} ${j.dose.auto.name}`.trim(), conf: 90, ev: [['ชื่อสามัญตรงกับข้อมูลคำนวณ', true], ['ยาเดี่ยว (ไม่ใช่สูตรผสม)', !isCombo(l)]] });
  if (k === 'nlem') {
    const seen = new Set();
    for (const m of D.monos) {
      if (seen.has(m.name)) continue;
      const ks = keysOf(m.name), exact = ks.includes(g) || (us && ks.includes(us)), near = !exact && ks.some((x) => like(x, g) || like(x, us));
      if (!exact && !near) continue;
      seen.add(m.name);
      const forms = (m.forms || []).map((f) => f.form).join(', ');
      const formOk = tabletLike(l) ? /tab|cap/i.test(forms) : liquidLike(l) ? /syr|susp|sol|liq|drop|elixir/i.test(forms) : null;
      const ev = [[exact ? 'ชื่อสามัญตรง' : 'ชื่อสามัญใกล้เคียง (เกลือ/รูปแบบต่างกัน)', exact]];
      if (formOk != null) ev.push([formOk ? `มีรูปแบบยา${tabletLike(l) ? 'เม็ด' : 'น้ำ'}ในบัญชี` : `ไม่มีรูปแบบยา${tabletLike(l) ? 'เม็ด' : 'น้ำ'}ในบัญชี (${forms || '-'})`, formOk]);
      out.push({ target: m.name, label: `${m.web_code || ''} ${m.name}`.trim(), conf: (exact ? 78 : 62) + (formOk ? 18 : formOk === false ? -10 : 8), ev });
    }
  }
  if (k === 'fda') {
    const want = routeOf(l);
    for (const f of D.fdas) {
      const gen = String(f.generic || '').toLowerCase(), exact = gen === g || (us && gen === us) || mono.includes(gen);
      if (!exact && !like(gen, g) && !(us && like(gen, us))) continue;
      const ev = [[exact ? `ชื่อสามัญตรง (${gen})` : `ชื่อสามัญใกล้เคียง (${gen})`, exact]];
      if (want) ev.push([f.route === want ? `ช่องทางให้ยาตรง (${f.route})` : `ช่องทางให้ยาไม่ตรง (${f.route} ≠ ${want})`, f.route === want]);
      out.push({ target: f.key, label: `${f.web_code || ''} ${f.title} · ${gen} (${f.route})`.trim(), conf: (exact ? 78 : 60) + (want ? (f.route === want ? 18 : -20) : 6) + (f.brand ? -6 : 0), ev });
    }
  }
  if (k === 'ddi') {
    for (const d of D.ddDrugs) {
      const n = d.name.toLowerCase(), byName = n === g || (us && n === us), byMono = mono.includes(n);
      if (!byName && !byMono) continue;
      const ev = [[byName ? 'ชื่อสามัญในชื่อยาตรง' : 'ตรงกับชื่อในบัญชียาหลักที่ผูกไว้', true], ['ยาเดี่ยว (ไม่ใช่สูตรผสม)', !isCombo(l)]];
      out.push({ target: d.id, label: `${d.web_code || ''} ${d.name}`.trim(), conf: byName ? 95 : 88, ev });
    }
  }
  const best = out.filter((x) => !rejected(l, k, x.target)).map((x) => ({ ...x, conf: Math.max(5, Math.min(99, x.conf)) })).sort((a, b) => b.conf - a.conf)[0];
  return best ? { ...best, strong: best.conf >= STRONG && best.ev.every((e) => e[1]) } : null;
}
/** แถวที่ต้องบันทึกเมื่อยืนยันคู่ (รวมกับ row เดิมได้ — ยืนยันหลายส่วนพร้อมกัน) */
function applyRow(l, k, target, row = {}) {
  if (k === 'nlem') row.mono_refs = [...new Set([...(row.mono_refs || l.mono_refs || []), ...D.monos.filter((m) => m.name === target).map((m) => m.ref)])];
  if (k === 'fda') row.fda_key = target;
  if (k === 'ddi') row.ddi_ids = [...new Set([...(row.ddi_ids || l.ddi_ids || []), target])];
  if (k === 'dose') row.dose_id = +target;
  return row;
}
async function save(l, row, msg, k) {
  const { error } = await sb.from('local_drugs').update({ ...row, updated_at: new Date().toISOString() }).eq('id', l.id);
  if (error) { toast(errText(error), 'err'); return false; }
  toast(msg); edit = null; focusK = k || null;
  await reloadDrugData(); D = await drugData(); renderAll(); return true;
}

/* ---------- หน้า ---------- */
let rowsCache = [];
function compute() {
  rowsCache = D.locals.map((l) => { const j = judgeAll(l); return { l, j, st: rowStatus(j, l) }; });
}
function inScope(r) { return scope === 'all' || (scope === 'outside' ? !!r.l.outside : !r.l.outside); }
function renderTop() {
  const rs = rowsCache.filter(inScope), n = { all: rs.length, ready: 0, wait: 0, miss: 0, err: 0 };
  rs.forEach((r) => n[r.st]++);
  const cards = [['all', 'ยาทั้งหมด', ''], ['ready', 'พร้อมใช้', 'ok'], ['miss', 'ข้อมูลยังไม่ครบ', 'miss'], ['wait', 'รอเภสัชกรตรวจ', 'wait'], ['err', 'ผิดพลาด', 'err']];
  $('#dcCards').innerHTML = cards.map(([k, t, c]) => `<button type="button" class="dc-card" data-dc-f="${k}" aria-pressed="${filt === k}"><span class="dc-num">${n[k]}</span><span class="dc-lbl">${c ? `<i class="dc-dot d-${c}"></i>` : ''}${t}</span></button>`).join('');
  $('#dcStack').innerHTML = ['ready', 'wait', 'miss', 'err'].map((k) => `<span class="d-${ROW[k][1]}" style="flex-grow:${n[k]}" title="${ROW[k][0]} ${n[k]}"></span>`).join('');
  const C = 2 * Math.PI * 22;
  $('#dcRings').innerHTML = K.map((k) => {
    const app = rs.filter((r) => r.j[k].s !== 'na'), ok = app.filter((r) => r.j[k].s === 'ok').length, bad = app.length - ok, p = app.length ? ok / app.length : 1;
    const tone = app.some((r) => r.j[k].s === 'err') ? 'err' : bad ? 'miss' : 'ok';
    return `<button type="button" class="dc-ring" data-dc-f="sec:${k}" aria-pressed="${filt === 'sec:' + k}" aria-label="${KN[k]}: ครบ ${ok} จาก ${app.length} · ยังต้องแก้ ${bad} · กดเพื่อดูยาที่ยังขาดส่วนนี้">`
      + `<svg viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="22" class="dc-ring-bg"/><circle cx="28" cy="28" r="22" class="dc-ring-fg r-${tone}" stroke-dasharray="${(C * p).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 28 28)"/><text x="28" y="32" text-anchor="middle">${Math.round(p * 100)}%</text></svg>`
      + `<span class="dc-ring-t"><b>${KS[k]}</b><span>${ok}/${app.length}${bad ? ` · ขาด ${bad}` : ''}</span></span></button>`;
  }).join('');
}
function visibleRows() {
  const q = $('#dcQ').value.trim().toLowerCase();
  return rowsCache.filter((r) => inScope(r) && (filt === 'all' || (filt.startsWith('sec:') ? ['miss', 'err', 'wait'].includes(r.j[filt.slice(4)].s) : r.st === filt))
    && (!q || [r.l.name, r.l.web_code, r.l.code, cat(r.l)].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => RANK[a.st] - RANK[b.st] || (a.l.sort ?? 0) - (b.l.sort ?? 0) || a.l.id - b.l.id);
}
function renderTable() {
  const list = visibleRows();
  const label = filt === 'all' ? '' : filt.startsWith('sec:') ? ` · ยังขาด/รอตรวจส่วน "${KS[filt.slice(4)]}"` : ` · ${ROW[filt][0]}`;
  $('#dcCount').textContent = `แสดง ${list.length} ยา${label} · ปัญหาหนักอยู่บนสุด · กดช่องเพื่อแก้ส่วนนั้น`;
  const strong = list.flatMap((r) => K.filter((k) => ['miss', 'wait'].includes(r.j[k].s)).map((k) => ({ r, k, sg: suggest(r.l, k, r.j) })).filter((x) => x.sg?.strong && (x.k !== 'dose' || x.r.j.dose.auto)));
  $('#dcBulk').hidden = !strong.length;
  $('#dcBulk').textContent = `✓ ยืนยันคู่ที่มั่นใจสูง (${strong.length})`;
  $('#dcTable').innerHTML = `<div class="dc-tr dc-th" role="row"><span role="columnheader">ยา</span>${K.map((k) => `<span role="columnheader" title="${KN[k]}">${KS[k]}</span>`).join('')}<span role="columnheader">สถานะ</span></div>`
    + (list.length ? list.map(({ l, j, st }) => `<div class="dc-tr${l.id === sel ? ' is-sel' : ''}" role="row">`
      + `<button type="button" class="dc-nm" data-dc-row="${l.id}"><b>${esc(l.name)}</b><span class="code">${esc(l.web_code || '')}${l.outside ? ' · ยานอก รพ.สต.' : ''}${l.active ? '' : ' · ซ่อน'}</span></button>`
      + K.map((k) => `<button type="button" class="dc-cell s-${j[k].s}" data-dc-row="${l.id}" data-dc-k="${k}" title="${KN[k]}: ${SN[j[k].s]}" aria-label="${esc(l.name)} · ${KN[k]}: ${SN[j[k].s]}">${SYM[j[k].s]}</button>`).join('')
      + `<span class="dc-pill p-${ROW[st][1]}">${ROW[st][0]}</span></div>`).join('')
      : '<p class="empty">ไม่มียาในกลุ่มนี้</p>');
}
function mapSvg(j, l) {
  const pos = { str: [62, 70], dose: [190, 24], nlem: [190, 70], fda: [190, 116], ddi: [316, 70] };
  const E = [['str', 'dose'], ['str', 'nlem'], ['str', 'fda'], ['nlem', 'ddi'], ['fda', 'ddi']];
  const bad = (k) => ['miss', 'err'].includes(j[k].s);
  return `<svg class="dc-map" viewBox="0 0 380 140" role="img" aria-label="แผนผังการเชื่อมข้อมูลของ ${esc(l.name)}">`
    + E.map(([a, b]) => `<line x1="${pos[a][0]}" y1="${pos[a][1]}" x2="${pos[b][0]}" y2="${pos[b][1]}" class="dc-edge${bad(b) ? ' e-' + j[b].s : ''}"/>`).join('')
    + K.map((k) => `<g class="dc-node n-${j[k].s}" data-dc-node="${k}" tabindex="0" role="button" aria-label="${KN[k]}: ${SN[j[k].s]}"><rect x="${pos[k][0] - 52}" y="${pos[k][1] - 15}" width="104" height="30" rx="15"/><text x="${pos[k][0]}" y="${pos[k][1] + 4.5}" text-anchor="middle">${SYM[j[k].s]} ${KS[k]}</text></g>`).join('')
    + '</svg>';
}
/* ---- แก้ทีละส่วนในแผง ---- */
function editorHtml(l, k) {
  const foot = (extra = '') => `<div class="dc-ed-foot"><button type="button" class="btn btn-p btn-sm" data-dc-save="${k}">บันทึก</button><button type="button" class="btn btn-o btn-sm" data-dc-cancel>ยกเลิก</button>${extra}`
    + `<button type="button" class="dc-na-t" data-dc-na="${k}">${(l.link_na || []).includes(k) ? 'ต้องมีส่วนนี้ (ยกเลิก "ไม่ใช้")' : 'ไม่ใช้กับยานี้'}</button></div>`;
  if (k === 'str') {
    if (isCombo(l) || comboName(l.name)) return `<p class="small">ยาสูตรผสม กรอกสารสำคัญทีละตัวในฟอร์มยา</p><div class="dc-ed-foot"><button type="button" class="btn btn-p btn-sm" data-dc-full="str">แก้สารสำคัญ (ฟอร์มยา)</button><button type="button" class="btn btn-o btn-sm" data-dc-cancel>ปิด</button></div>`;
    const s = l.strength, u = `${s?.u || 'mg'}|${s?.per || 'tab'}`;
    return `<div class="dc-ed-row"><input id="dcStrAmt" class="input" type="number" inputmode="decimal" min="0" step="0.001" placeholder="ความแรง" aria-label="ความแรง" value="${s ? esc(s.u === 'mcg' ? s.amt : s.mg) : ''}">`
      + `<select id="dcStrUnit" class="input" aria-label="หน่วย">${UNITS.map(([v, t]) => `<option value="${v}"${v === u ? ' selected' : ''}>${t}</option>`).join('')}</select></div>`
      + '<p class="small muted">ว่าง = อ่านจากชื่อยา · ยาสูตรผสมกรอกในฟอร์มยา</p>' + foot(`<button type="button" class="btn btn-o btn-sm" data-dc-full="str">ฟอร์มเต็ม</button>`);
  }
  if (k === 'dose') {
    const cur = l.dose_id || '';
    return `<select id="dcDose" class="input" aria-label="ข้อมูลคำนวณขนาดยา"><option value="">— ไม่ผูก —</option>${D.doses.map((d) => `<option value="${d.id}"${d.id === cur ? ' selected' : ''}>${esc(`${d.web_code ? d.web_code + ' · ' : ''}${d.name}${d.ai_draft ? ' (ร่าง · รอตรวจ)' : d.active ? '' : ' (ซ่อน)'}`)}</option>`).join('')}</select>`
      + foot(`<button type="button" class="btn btn-o btn-sm" data-dc-full="dose">แก้ขนาดยา (ฟอร์มเต็ม)</button>`);
  }
  if (k === 'nlem') {
    const names = [...new Set(edit.refs.map((r) => D.monos.find((m) => m.ref === r)?.name).filter(Boolean))];
    return `<div class="di-chips">${names.map((n) => { const m = D.monos.find((x) => x.name === n); return `<span class="chip c-role">${codeTag(m)}${esc(n)}<button type="button" class="nt-x" data-dc-unmono="${esc(n)}" aria-label="เลิกผูก ${esc(n)}">×</button></span>`; }).join('') || '<span class="small muted">ยังไม่ได้ผูก</span>'}</div>`
      + `<input id="dcMonoQ" class="input" type="search" placeholder="พิมพ์ชื่อยาภาษาอังกฤษเพื่อค้นหา" aria-label="ค้นหาข้อมูลยาในบัญชียาหลัก" value="${esc(edit.q || '')}"><div class="ld-pick" id="dcMonoOut">${monoPick(edit.q)}</div>` + foot();
  }
  if (k === 'fda') {
    return `<select id="dcFda" class="input" aria-label="ฉลาก openFDA"><option value="">— ไม่ผูก —</option>${D.fdas.map((f) => `<option value="${esc(f.key)}"${f.key === l.fda_key ? ' selected' : ''}>${esc(`${f.web_code ? f.web_code + ' · ' : ''}${f.title} · ${f.generic} (${f.route})`)}</option>`).join('')}</select>`
      + foot(`<button type="button" class="btn btn-o btn-sm" data-dc-fetch>ดึงฉลากใหม่จาก openFDA</button>`);
  }
  return `<div class="di-chips">${edit.ddi.map((i) => { const d = D.ddDrugs.find((x) => x.id === i); return `<span class="chip c-role">${codeTag(d)}${esc(d?.name || i)}<button type="button" class="nt-x" data-dc-unddi="${esc(i)}" aria-label="เอาออก">×</button></span>`; }).join('') || '<span class="small muted">ยังไม่ได้ผูก</span>'}</div>`
    + `<div class="dc-ed-row"><input id="dcDdiQ" class="input" list="ddiNames" maxlength="120" placeholder="ชื่อยาภาษาอังกฤษใน DDInter" aria-label="เพิ่มยาใน DDInter"><button type="button" class="btn btn-o btn-sm" data-dc-addddi>เพิ่ม</button></div>` + foot();
}
function monoPick(q) {
  q = String(q || '').trim().toLowerCase();
  if (q.length < 2) return '';
  const ms = [...new Map(D.monos.filter((m) => m.name.toLowerCase().includes(q)).map((m) => [m.name, m])).values()].slice(0, 8);
  return ms.length ? ms.map((m) => `<button type="button" class="btn btn-o btn-sm btn-wrap" data-dc-addmono="${esc(m.name)}">+ ${codeTag(m)}${esc(m.name)}</button>`).join('') : '<span class="small muted">ไม่พบในบัญชียาหลัก</span>';
}
function sugHtml(l, k, sg) {
  return `<div class="dc-sug"><span class="small muted">ระบบเสนอ</span><b>${esc(sg.label)}</b>`
    + `<div class="dc-ev">${sg.ev.map(([t, y]) => `<span class="${y ? 'y' : 'n'}">${y ? '✓' : '✗'} ${esc(t)}</span>`).join('')}</div>`
    + `<span class="dc-conf">ความมั่นใจ ${sg.conf}%${sg.strong ? '' : ' · หลักฐานไม่ครบ ตรวจก่อนแล้วผูกเองด้วยปุ่มดินสอ'}</span>`
    + `<div class="dc-ed-foot"><button type="button" class="btn btn-p btn-sm" data-dc-ok="${k}" data-target="${esc(sg.target)}"${sg.strong ? '' : ' disabled'}>✓ ใช้คู่นี้</button><button type="button" class="btn btn-o btn-sm" data-dc-no="${k}" data-target="${esc(sg.target)}">✗ ไม่ใช่</button></div></div>`;
}
function renderPanel() {
  const r = rowsCache.find((x) => x.l.id === sel);
  if (!r) { $('#dcPanel').innerHTML = '<p class="empty">กดชื่อยาหรือช่องสถานะในตาราง เพื่อดูและแก้ข้อมูลยาตัวนั้น</p>'; return; }
  const { l, j, st } = r, sp = steps(j, l), first = sp.indexOf(false);
  const secs = K.map((k) => {
    const x = j[k], open = edit?.k === k, sg = !open && ['miss', 'wait'].includes(x.s) ? suggest(l, k, j) : null;
    let body;
    if (open) body = `<div class="dc-ed">${editorHtml(l, k)}</div>`;
    else body = (x.t ? `<p class="small${x.s === 'na' ? ' muted' : ''}">${esc(x.t)}</p>` : '')
      + (x.why ? `<p class="small ${x.s === 'err' ? 'dc-err' : 'dc-warn'}">${esc(x.why)}</p>` : '')
      + (sg && (k !== 'dose' || x.auto) ? sugHtml(l, k, sg) : x.s === 'miss' ? '<p class="small muted">ระบบยังหาคู่ที่น่าจะตรงไม่ได้ · กดปุ่มดินสอเพื่อค้นเอง</p>' : '')
      + (x.s === 'wait' && x.dose && !x.auto ? `<div class="dc-ed-foot"><button type="button" class="btn btn-p btn-sm" data-dc-full="dose">เปิดตรวจขนาดยา</button></div>` : '');
    return `<section class="dc-sec s-${x.s}${open ? ' is-open' : ''}" id="dcSec-${k}" aria-label="${KN[k]}"><div class="dc-sec-h"><b>${KN[k]}</b><span class="dc-pill p-${x.s === 'ok' ? 'ok' : x.s}">${SYM[x.s]} ${SN[x.s]}</span>`
      + `<button type="button" class="dc-pen" data-dc-edit="${k}" aria-label="${open ? 'ปิดการแก้ไข' : 'แก้ไข'} ${KN[k]}" aria-expanded="${open}">${open ? '×' : '✎'}</button></div>${body}</section>`;
  }).join('');
  $('#dcPanel').innerHTML = `<div class="dc-ph">${codeTag(l)}<h3>${esc(l.name)}</h3><div class="dc-tags"><span class="dc-pill p-${ROW[st][1]}">${ROW[st][0]}</span><span class="chip c-off">${esc(cat(l))}</span>${l.outside ? '<span class="chip c-off">ยานอก รพ.สต.</span>' : ''}${l.active ? '' : '<span class="chip c-fix">ซ่อนจากหน้าหลัก</span>'}</div></div>`
    + `<ol class="dc-steps" aria-label="ขั้นความพร้อม">${['ข้อมูลยา', 'ผูกฐานข้อมูล', 'เภสัชกรตรวจ', 'อนุมัติใช้'].map((t, i) => `<li class="${sp[i] ? 'done' : i === first ? 'now' : ''}"><i></i>${i + 1} ${t}</li>`).join('')}</ol>`
    + `<div class="dc-mapbox">${mapSvg(j, l)}</div>${secs}`
    + `<div class="dc-ed-foot"><button type="button" class="btn btn-o btn-sm" data-dc-full="all">เปิดฟอร์มยาเต็ม</button></div>`;
  if (focusK) { const el = $(`#dcSec-${focusK}`); if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } }
}
function renderAll() { compute(); renderTop(); renderTable(); renderPanel(); }

/** เปิด/ปิดแท็บวิธีใช้ (แยกจากศูนย์ข้อมูลยา) */
export function showDrugTab(help) {
  $('#dcCenter').hidden = help; $('#dcHelp').hidden = !help;
  document.querySelectorAll('[data-admin-view="drugs"] .adr-pick, [data-admin-view="drugs"] .adr-sec').forEach((x) => { x.hidden = help; });
}
export async function initDrugCenter() {
  if (!bound) bind();
  try {
    const [d, rj] = await Promise.all([drugData(), sb.from('drug_link_rejects').select('local_id,kind,target')]);
    D = d; rejects = rj.data || [];
  } catch (err) { toast(errText(err), 'err'); $('#dcTable').innerHTML = '<p class="empty">โหลดข้อมูลยาไม่สำเร็จ กรุณาลองใหม่</p>'; return; }
  renderAll();
}
function pick(id, k) {
  sel = id; focusK = k || null; edit = null;
  renderTable(); renderPanel();
  if (matchMedia('(max-width: 1100px)').matches) $('#dcPanel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  else if (k) $(`#dcSec-${k}`)?.scrollIntoView({ block: 'nearest' });
}
function openEdit(l, k) {
  edit = edit?.k === k ? null : { k, refs: [...(l.mono_refs || [])], ddi: [...(l.ddi_ids || [])], q: '' };
  focusK = null; renderPanel();
  if (edit) { $(`#dcSec-${k}`)?.scrollIntoView({ block: 'nearest' }); $(`#dcSec-${k} input, #dcSec-${k} select`)?.focus({ preventScroll: true }); }
}
function bind() {
  bound = true;
  window.addEventListener('pcps:drugdata', async () => { if (!D) return; D = await drugData(); if (!$('#dcCenter').hidden) renderAll(); });   // ข้อมูลชุดใหม่หลังบันทึก (ที่นี่หรือส่วนฐานข้อมูลด้านล่าง)
  const onF = (e) => { const b = e.target.closest('[data-dc-f]'); if (!b) return; filt = filt === b.dataset.dcF ? 'all' : b.dataset.dcF; renderTop(); renderTable(); };
  $('#dcCards').addEventListener('click', onF); $('#dcRings').addEventListener('click', onF);
  $('#dcQ').addEventListener('input', renderTable);
  $('#dcScope').addEventListener('change', () => { scope = $('#dcScope').value; renderTop(); renderTable(); });
  $('#dcTable').addEventListener('click', (e) => { const b = e.target.closest('[data-dc-row]'); if (b) pick(+b.dataset.dcRow, b.dataset.dcK); });
  $('#dcBulk').addEventListener('click', bulk);
  $('#dcPanel').addEventListener('input', (e) => { if (e.target.id === 'dcMonoQ') { edit.q = e.target.value; $('#dcMonoOut').innerHTML = monoPick(edit.q); } });
  $('#dcPanel').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'dcDdiQ') { e.preventDefault(); addDdi(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-dc-node]')) { e.preventDefault(); e.target.closest('[data-dc-node]').dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });
  $('#dcPanel').addEventListener('click', onPanel);
}
function addDdi() {
  const v = $('#dcDdiQ').value.trim().toLowerCase(), d = v && D.ddDrugs.find((x) => x.name.toLowerCase() === v || x.id.toLowerCase() === v);
  if (!d) { toast('ไม่พบยานี้ใน DDInter · เลือกจากรายการที่แนะนำ', 'err'); return; }
  if (!edit.ddi.includes(d.id)) edit.ddi.push(d.id);
  renderPanel(); $('#dcDdiQ')?.focus();
}
async function onPanel(e) {
  const r = rowsCache.find((x) => x.l.id === sel); if (!r) return;
  const { l } = r, t = e.target, B = (s) => t.closest(s);
  if (B('[data-dc-node]')) { focusK = B('[data-dc-node]').dataset.dcNode; renderPanel(); $(`#dcSec-${focusK}`)?.scrollIntoView({ block: 'nearest' }); return; }
  if (B('[data-dc-edit]')) return openEdit(l, B('[data-dc-edit]').dataset.dcEdit);
  if (B('[data-dc-cancel]')) { edit = null; renderPanel(); return; }
  if (B('[data-dc-unmono]')) { const n = B('[data-dc-unmono]').dataset.dcUnmono; edit.refs = edit.refs.filter((x) => D.monos.find((m) => m.ref === x)?.name !== n); renderPanel(); return; }
  if (B('[data-dc-addmono]')) { const n = B('[data-dc-addmono]').dataset.dcAddmono; edit.refs = [...new Set([...edit.refs, ...D.monos.filter((m) => m.name === n).map((m) => m.ref)])]; edit.q = ''; renderPanel(); return; }
  if (B('[data-dc-unddi]')) { const i = B('[data-dc-unddi]').dataset.dcUnddi; edit.ddi = edit.ddi.filter((x) => x !== i); renderPanel(); return; }
  if (B('[data-dc-addddi]')) return addDdi();
  if (B('[data-dc-full]')) {
    const k = B('[data-dc-full]').dataset.dcFull, did = l.dose_id || r.j.dose.dose?.id;
    if (k === 'dose' && did) { openDoseEdit(did); return; }
    openDrugSection(l.outside ? 'outside' : 'local'); editLocalForm(l);
    if (k === 'all' || k === 'str') document.querySelector('#ldForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (B('[data-dc-na]')) {
    const k = B('[data-dc-na]').dataset.dcNa, cur = l.link_na || [];
    const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
    await save(l, { link_na: next }, cur.includes(k) ? `${KS[k]}: ต้องมีข้อมูลส่วนนี้` : `${KS[k]}: ไม่ใช้กับยานี้`, k); return;
  }
  if (B('[data-dc-fetch]')) {
    const btn = B('[data-dc-fetch]'), g = doseQuery(String(l.name).replace(/\d.*$/, '')) || genericKey(l.name);
    busy(btn, true, 'กำลังดึง…');
    try {
      const row = await fetchFdaLabel(g, routeOf(l) || 'ORAL');
      if (!row?.sections?.length) { toast(`ไม่พบฉลาก "${g}" ใน openFDA · ลองค้นในส่วนฉลากยาด้านล่าง`, 'err'); return; }
      const { error } = await sb.from('drug_fda_labels').upsert({ ...row, fetched_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw error;
      await reloadDrugData(true); D = await drugData(); compute(); renderPanel(); $('#dcFda').value = row.key; toast(`ดึงฉลาก "${row.title}" แล้ว · กดบันทึกเพื่อผูก`);
    } catch (err) { toast(errText(err), 'err'); } finally { busy(btn, false); }
    return;
  }
  if (B('[data-dc-save]')) {
    const k = B('[data-dc-save]').dataset.dcSave, btn = B('[data-dc-save]'); let row = {};
    if (k === 'str') {
      const amt = +$('#dcStrAmt').value, [u, per] = $('#dcStrUnit').value.split('|');
      row.strength = amt > 0 ? { mg: u === 'mcg' ? +(amt / 1000).toFixed(6) : amt, per, ...(u === 'mcg' ? { u: 'mcg', amt } : {}) } : null;
    }
    if (k === 'dose') row.dose_id = +$('#dcDose').value || null;
    if (k === 'nlem') row.mono_refs = edit.refs;
    if (k === 'fda') row.fda_key = $('#dcFda').value || null;
    if (k === 'ddi') row.ddi_ids = edit.ddi;
    busy(btn, true, 'กำลังบันทึก…');
    await save(l, row, `บันทึก${KS[k]}แล้ว`, k);
    busy(btn, false); return;
  }
  if (B('[data-dc-ok]')) { const b = B('[data-dc-ok]'), k = b.dataset.dcOk; await save(l, applyRow(l, k, b.dataset.target), `ผูก${KS[k]}แล้ว`, k); return; }
  if (B('[data-dc-no]')) {
    const b = B('[data-dc-no]'), k = b.dataset.dcNo, row = { local_id: l.id, kind: k, target: b.dataset.target };
    const { error } = await sb.from('drug_link_rejects').insert(row);
    if (error && !/duplicate|23505/.test(errText(error) + error.code)) { toast(errText(error), 'err'); return; }
    rejects.push(row); focusK = k; toast('จำไว้แล้วว่าไม่ใช่คู่นี้'); renderAll();
  }
}
/** ยืนยันคู่ที่มั่นใจสูงทั้งหมดในรายการที่แสดงอยู่ */
async function bulk() {
  const list = visibleRows().flatMap((r) => K.filter((k) => ['miss', 'wait'].includes(r.j[k].s)).map((k) => ({ r, k, sg: suggest(r.l, k, r.j) })).filter((x) => x.sg?.strong && (x.k !== 'dose' || x.r.j.dose.auto)));
  if (!list.length || !confirm(`ยืนยันผูก ${list.length} คู่ที่ระบบมั่นใจสูง (หลักฐานตรงทุกข้อ)?\nตรวจรายละเอียดแต่ละยาได้ภายหลังในแผงด้านขวา`)) return;
  const rows = new Map();
  list.forEach(({ r, k, sg }) => rows.set(r.l, applyRow(r.l, k, sg.target, rows.get(r.l) || {})));
  const btn = $('#dcBulk'); busy(btn, true, 'กำลังบันทึก…');
  const now = new Date().toISOString();
  const res = await Promise.all([...rows].map(([l, row]) => sb.from('local_drugs').update({ ...row, updated_at: now }).eq('id', l.id)));
  busy(btn, false);
  const bad = res.filter((x) => x.error).length;
  toast(bad ? `ผูกสำเร็จ ${rows.size - bad} ยา · ไม่สำเร็จ ${bad} ยา` : `ผูกแล้ว ${list.length} คู่ (${rows.size} ยา)`, bad ? 'err' : undefined);
  await reloadDrugData(); D = await drugData(); renderAll();
}
