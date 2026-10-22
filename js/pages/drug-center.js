// ผู้ดูแล › ข้อมูลยา › ศูนย์ข้อมูลยา (#/admin/drugs) · วิธีใช้ (#/admin/drugs/help)
//   ตอบ 3 คำถาม: มียาอะไรบ้าง (การ์ด + วงกลมรายส่วน) → ยาตัวไหนมีปัญหา (ตารางสถานะ เรียงปัญหาหนักก่อน) → กดตรงไหน (แผงรายละเอียดด้านขวา)
//   แผงยา 3 ขั้น (เจ้าของเว็บ 20 ต.ค.): ① ยาในเว็บแอพ (ชื่อ · รูปแบบ · ความแรง · คิดเป็น) ② แหล่งข้อมูล (บัญชียา รพ.สต. · MIMS · ฉลากยาสหรัฐฯ DailyMed/openFDA · บัญชียาหลัก · DDInter)
//     ③ ขนาดยา = ตารางข้อบ่งใช้จากทุกแหล่ง (ข้อมูลคำนวณเดิม · ข้อที่ยังไม่เลือก spare_inds · MIMS) ติ๊กเลือก/แก้ในแถว → ตรวจซ้ำด้วยทดสอบสูตร → อนุมัติ (ไม่ต้องเลือกรายการ DOSE-xx เอง)
//   สถานะต่อส่วน judge(): ok ครบ · wait รอตรวจ (ร่าง AI / จับคู่ตามชื่อ / สารสำคัญที่ระบบใส่) · miss ยังไม่ผูก · err ข้อมูลขัดกัน · na ไม่ใช้กับยานี้
//     na มาจากกลุ่มยา (ยาทาไม่ต้องคำนวณ ฯลฯ) หรือผู้ดูแลกำหนด local_drugs.link_na (83_drug_center.sql)
//   แผงรายละเอียด: ขั้นความพร้อม 4 ขั้น (ข้อมูลครบ ≠ พร้อมใช้คำนวณ) + แผนผัง + แก้ทีละส่วนในแผง (กดปุ่มดินสอ · เปิดได้ทีละส่วน)
//   แก้ข้อมูลยา (ขั้นที่ 1) / ฟอร์มยาเต็ม → ตารางแก้ไขยา ที่แถวยานี้ (sessionStorage 'pcps_grid_focus') · ยาสูตรผสมแก้สารสำคัญที่ฟอร์มยา
//   คู่ที่ระบบเสนอ suggest(): หลักฐาน + ความมั่นใจ · กด ✓ ได้เฉพาะ ≥ 85% และหลักฐานตรงทุกข้อ · ✗ = จำใน drug_link_rejects ไม่เสนออีก · ระบบไม่ผูกเอง
//   ใช้ข้อมูลชุดเดียวกับเครื่องมือฐานข้อมูล (admin-drugs.js drugData) · บันทึกแล้วโหลดใหม่ทั้งสองที่
//   เครื่องมือฐานข้อมูล = แผงด้านขวา #dcDrawer (ส่วนฐานข้อมูลเดิม 7 ส่วน) · เปิดจากลิงก์ (#/admin/drugs/<ส่วน>) หรือจากแผงยา (ฟอร์มเต็ม)
//     เปิดจากแผงยา → บันทึกแล้วปิดเอง กลับมาที่ยาเดิม (เหตุการณ์ pcps:dosesaved / pcps:localsaved) · ไม่ต้องเลื่อนหาหรือกลับไปดูอีกที่
//   ปุ่ม "อนุมัติใช้คำนวณ" = แสดงยา + ขนาดยาในเครื่องคำนวณพร้อมกัน (ร่าง AI ต้องผ่านฟอร์มตรวจเสมอ · audit F-04) · "ถัดไป ›" = ยาตัวต่อไปในรายการที่กรองอยู่
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, busy, errText } from '../util.js?v=4.4';
import { strengthOf, comboName, keysOf, sameDrug, doseText, sameBasis } from './dose.js?v=4.4';
import { drugData, reloadDrugData, doseIdsOf, genericKey, codeTag, fetchFdaLabel } from './admin-drugs.js?v=4.4';
import { indsProblem, indsOf, doseQuery, draftWord, indBox, readInds, syncIndBoxes, asMg, ageText } from './admin-settings.js?v=4.4';
import { testDose, testHtml } from './dose-test.js?v=4.4';
import { runCheck, bindCheck } from './dose-check.js?v=4.4';

const K = ['str', 'rpst', 'mims', 'fda', 'nlem', 'ddi', 'dose'];   // ตามลำดับขั้น: ① str ② rpst/mims/fda/nlem/ddi ③ dose (รวมผลทดสอบสูตร)
const SRC = ['rpst', 'mims', 'fda', 'nlem', 'ddi'];   // ขั้นที่ 2 แหล่งข้อมูล
const KREQ = K.filter((k) => k !== 'mims');   // ส่วนที่นับสถานะยา · MIMS เป็นแหล่งอ้างอิงเสริม ไม่บังคับ
const KN = { str: 'ยาในเว็บแอพ', rpst: 'บัญชียา รพ.สต.', mims: 'MIMS Thailand (ไม่บังคับ)', fda: 'ฉลากยาสหรัฐฯ (DailyMed / openFDA)', nlem: 'บัญชียาหลักแห่งชาติ', ddi: 'DDInter (ยาตีกัน)', dose: 'ขนาดยา' };
const KS = { str: 'ข้อมูลยา', rpst: 'บัญชี รพ.สต.', mims: 'MIMS', fda: 'ฉลาก', nlem: 'บัญชียาหลัก', ddi: 'DDInter', dose: 'ขนาดยา' };
const KH = { ...KS, rpst: 'รพ.สต.', ddi: 'DDI' };   // หัวตาราง (คอลัมน์แคบ)
const SYM = { ok: '✓', wait: '●', miss: '✗', err: '!', na: '–', opt: '○' };
const SN = { ok: 'ครบ', wait: 'รอตรวจ', miss: 'ยังไม่ผูก', err: 'ผิดพลาด', na: 'ไม่ใช้', opt: 'ยังไม่ผูก (ไม่บังคับ)' };
const cellS = (k, s) => (k === 'mims' && s === 'miss' ? 'opt' : s);   // MIMS ไม่บังคับ → ช่องที่ยังไม่ผูกแสดงแบบกลาง ๆ
const ROW = { err: ['ผิดพลาด', 'err'], miss: ['ยังไม่ครบ', 'miss'], wait: ['รอตรวจ', 'wait'], ready: ['พร้อมใช้', 'ok'] };
const RANK = { err: 0, miss: 1, wait: 2, ready: 3 };
const PER = { tab: 'มก./เม็ด', '5ml': 'มก./5 มล.', ml: 'มก./มล.' };
const UNITS = [['mg|tab', 'มก./เม็ด'], ['mg|5ml', 'มก./5 มล.'], ['mg|ml', 'มก./มล.'], ['mcg|tab', 'mcg/เม็ด'], ['mcg|ml', 'mcg/มล.']];
// กลุ่มยาที่ไม่ต้องมีข้อมูลส่วนนั้น (ค่าเริ่มต้น · ผู้ดูแลเปลี่ยนได้ในแผง)
const ORAL = /เม็ด|แคปซูล|น้ำรับประทาน|ผง/, NCD = /NCD|เรื้อรัง/;
const NO_FDA = /สมุนไพร/, NO_DDI = /ภายนอก|สมุนไพร|สารน้ำ|ป้ายปาก/;
const STRONG = 85;

let stepOpen = {}, jump = false;   // jump = เปิดจากตารางแก้ไขยา → เลื่อนไปที่แผงยา
let D = null, rejects = [], filt = 'all', scope = 'all', sel = null, focusK = null, edit = null, bound = false, drawerFrom = null, approveAfter = null, dt = null;   // dt = ตารางขนาดยาของยาที่เลือก (ขั้นที่ 3)
const like = (a, b) => !!a && !!b && (a === b || sameDrug(a, b) || sameDrug(b, a));
const num = (x) => +(+x).toFixed(3);
const idv = (v) => (/^\d+$/.test(String(v ?? '')) ? +v : v || null);   // id ตัวเลข (ฐานข้อมูลจริง) หรือข้อความ (ข้อมูลทดสอบ)
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
    if (st) {
      const own = [l.dose_id, ...(l.ingredients || []).map((x) => x.dose_id)].filter(Boolean), d = doseById((own.length ? own : doseIdsOf(l))[0]);
      const need = d && indsOf(d).map((i) => i.basis).find((b) => b && !sameBasis(b, genericKey(l.name)) && !(st.as && sameBasis(st.as.name, b)));
      if (need) return { s: 'wait', t: `${num(st.mg)} ${PER[st.per]}`, why: `ขนาดยาคิดจาก ${need} → กรอกช่อง "คิดเป็น" (${need} กี่ มก. ต่อ${PER[st.per].replace('มก./', '')})` };
      return { s: 'ok', t: `${num(st.mg)} ${PER[st.per]}${st.as ? ` · คิดเป็น ${st.as.name} ${num(st.as.mg)}` : ''}${l.strength ? '' : ' (อ่านจากชื่อยา)'}` };
    }
    return na || !(ORAL.test(cat(l)) || NCD.test(cat(l))) ? NA('ยากลุ่มนี้ไม่ใช้คำนวณ') : { s: 'miss', why: 'ยังไม่มีความแรง และอ่านจากชื่อยาไม่ได้' };
  }
  if (k === 'dose') {
    const own = [l.dose_id, ...(l.ingredients || []).map((x) => x.dose_id)].filter(Boolean);
    if (na && !own.length) return NA();   // ผู้ดูแลกำหนดว่าไม่ใช้ ชนะการจับคู่ตามชื่อ
    const ids = own.length ? own : doseIdsOf(l), d = ids.length ? doseById(ids[0]) : null;
    if (!d) return na || !ORAL.test(cat(l)) ? NA(NCD.test(cat(l)) ? 'ยาโรคเรื้อรังผู้ใหญ่ ไม่คำนวณตามน้ำหนัก' : 'ยากลุ่มนี้ไม่คำนวณตามน้ำหนัก') : { s: 'miss', why: 'ยังไม่มีข้อมูลคำนวณขนาดยา' };
    const name = `${d.web_code ? d.web_code + ' ' : ''}${d.name}`;
    if (d.ai_draft) return d.draft_issue ? { s: 'err', t: name, why: `${draftWord(d)} ข้อมูลไม่ครบ: ${d.draft_issue}`, dose: d } : { s: 'wait', t: `${name} · ${draftWord(d)} รอเภสัชกรตรวจ`, dose: d };
    const p = indsProblem(indsOf(d));
    if (p) return { s: 'err', t: name, why: p, dose: d };
    const t = testDose(d, [l]);   // ตรวจซ้ำด้วยทดสอบสูตร (สูตรเดียวกับหน้าคำนวณ)
    if (t.status === 'fail') return { s: 'err', t: name, why: `ผลทดสอบสูตรไม่ผ่าน: ${t.issues.find((x) => x.sev === 'fail').text}`, dose: d, test: t };
    if (!own.length) return { s: 'wait', t: `${name} · จับคู่ตามชื่อ ยังไม่ได้ยืนยัน`, dose: d, auto: d, test: t };
    if (!d.active) return { s: 'wait', t: `${name} · ซ่อนจากเครื่องคำนวณ`, dose: d, test: t };
    if (!d.approved_at) return { s: 'wait', t: `${name} · รอเภสัชกรอนุมัติ`, why: 'ยังไม่มีผู้อนุมัติ (ข้อมูลเดิมก่อนมีระบบอนุมัติ) · ประชาชน/เจ้าหน้าที่ยังไม่เห็นยานี้ในเครื่องคำนวณ · ตรวจแล้วกด "อนุมัติใช้คำนวณ" ในหน้าทำงานทีละยา', dose: d, test: t };
    return { s: 'ok', t: `${name} · อนุมัติแล้ว`, dose: d, test: t };
  }
  if (k === 'rpst') {   // บัญชียา รพ.สต. (86): รหัสยาในเว็บแอพ = รหัสในบัญชี
    const it = l.code && (D.rpst || []).find((x) => x.code === l.code);
    if (it) return { s: it.in_list === false ? 'wait' : 'ok', t: `รหัส ${it.code} · ${it.name}${it.unit ? ` (${it.unit})` : ''}`, why: it.in_list === false ? 'ไม่อยู่ในไฟล์บัญชีล่าสุดที่นำเข้า' : '' , item: it };
    if (l.outside) return { s: 'na', t: 'ยานอก รพ.สต. (ไม่อยู่ในบัญชี)' };
    if (l.code) return { s: 'err', why: `รหัส ${l.code} ไม่อยู่ในบัญชียา รพ.สต.` };
    return { s: 'miss', why: 'ยังไม่ได้ผูกกับรายการในบัญชี' };
  }
  if (k === 'test') {   // ทดสอบสูตรด้วยน้ำหนักตัวอย่าง × ความแรงของยานี้ (สูตรเดียวกับหน้าคำนวณ)
    const dj = judge(l, 'dose');
    if (!dj.dose) return { s: 'na', t: dj.s === 'na' ? 'ยาไม่คำนวณตามน้ำหนัก ไม่ต้องทดสอบ' : 'ยังไม่มีข้อมูลคำนวณให้ทดสอบ' };
    const t = testDose(dj.dose, [l]), warns = t.issues.filter((x) => x.sev === 'warn').length;
    if (t.status === 'fail') return { s: 'err', why: `ผลทดสอบไม่ผ่าน: ${t.issues.find((x) => x.sev === 'fail').text}`, test: t };
    return { s: 'ok', t: t.status === 'pass' ? 'ผ่านทุกน้ำหนักตัวอย่าง' : `ผ่าน · มีข้อควรตรวจ ${warns} ข้อ (ดูตาราง)`, test: t };
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
  if (k === 'mims') {
    const m = l.mims_id && (D.mims || []).find((x) => x.id === l.mims_id);
    if (m) { const inds = m.indications || [], ok = inds.filter((i) => !i.skip).length; return { s: 'ok', t: `${m.web_code ? m.web_code + ' ' : ''}${m.name} · ข้อบ่งใช้ ${inds.length} (ใช้คำนวณได้ ${ok})`, mims: m }; }
    if (l.mims_id) return { s: 'err', why: 'ผูกข้อมูล MIMS ไว้ แต่ไม่พบข้อมูลนี้แล้ว' };
    return na ? NA() : { s: 'miss', why: 'ไม่บังคับ · ใช้เป็นแหล่งอ้างอิงขนาดยา (นำเข้าได้ที่ ⋯ เครื่องมือฐานข้อมูล › ฐานข้อมูล MIMS)' };
  }
  const ds = (l.ddi_ids || []).map((i) => D.ddDrugs.find((x) => x.id === i)).filter(Boolean);
  return ds.length ? { s: 'ok', t: ds.map((x) => `${x.web_code ? x.web_code + ' ' : ''}${x.name}`).join(' + ') } : na || NO_DDI.test(cat(l)) ? NA('ยาใช้เฉพาะที่/สมุนไพร ไม่ตรวจ interaction') : { s: 'miss' };
}
const judgeAll = (l) => Object.fromEntries(K.map((k) => [k, judge(l, k)]));
function rowStatus(j, l) {
  const v = KREQ.map((k) => j[k].s);
  return v.includes('err') ? 'err' : v.includes('miss') ? 'miss' : v.includes('wait') || !l.active ? 'wait' : 'ready';
}
/** 3 ขั้น: ① ยาในเว็บแอพ ② แหล่งข้อมูล (MIMS ไม่บังคับ) ③ ขนาดยา (อนุมัติแล้ว/ไม่ใช้) */
function steps(j) {
  return [!['miss', 'err'].includes(j.str.s), !SRC.some((k) => k !== 'mims' && ['miss', 'err'].includes(j[k].s)), ['ok', 'na'].includes(j.dose.s)];
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
  if (k === 'rpst') {   // รายการในบัญชีที่ชื่อตรงกัน และยังไม่ถูกยาในเว็บแอพตัวอื่นใช้
    const used = new Set(D.locals.map((x) => x.code).filter(Boolean)), nm = (x) => String(x || '').trim().replace(/\s+/g, ' ').toUpperCase();
    for (const it of D.rpst || []) {
      if (used.has(it.code)) continue;
      const exact = nm(it.name) === nm(l.name), near = !exact && genericKey(it.name) === g;
      if (!exact && !near) continue;
      out.push({ target: it.code, label: `${it.code} · ${it.name}`, conf: exact ? 97 : 70, ev: [[exact ? 'ชื่อยาตรงกับในบัญชี' : 'ชื่อสามัญตรง แต่ชื่อเต็ม/ความแรงต่างกัน', exact]] });
    }
  }
  if (k === 'mims') {
    for (const m of D.mims || []) {
      const ks = keysOf(m.name), exact = ks.includes(g) || (us && ks.includes(us)) || mono.some((x) => ks.includes(x));
      if (!exact && !ks.some((x) => like(x, g))) continue;
      out.push({ target: m.id, label: `${m.web_code || ''} ${m.name}`.trim(), conf: exact ? 90 : 65, ev: [[exact ? 'ชื่อสามัญตรง' : 'ชื่อสามัญใกล้เคียง', exact], ['ยาเดี่ยว (ไม่ใช่สูตรผสม)', !isCombo(l) || / \+ /.test(m.name)]] });
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
  if (k === 'mims') row.mims_id = idv(target);
  if (k === 'rpst') { row.code = target; row.outside = false; }
  return row;
}
async function save(l, row, msg, k) {
  const { error } = await sb.from('local_drugs').update({ ...row, updated_at: new Date().toISOString() }).eq('id', l.id);
  if (error) { toast(errText(error), 'err'); return false; }
  toast(msg); edit = null; focusK = k || null; dt = null;   // ผูกแหล่งข้อมูลใหม่ → ตารางขนาดยาสร้างใหม่
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
  $('#dcTable').innerHTML = `<div class="dc-tr dc-th" role="row"><span role="columnheader">ยา</span>${K.map((k) => `<span role="columnheader" title="${KN[k]}">${KH[k]}</span>`).join('')}<span role="columnheader">สถานะ</span></div>`
    + (list.length ? list.map(({ l, j, st }) => `<div class="dc-tr${l.id === sel ? ' is-sel' : ''}" role="row">`
      + `<button type="button" class="dc-nm" data-dc-row="${l.id}"><b>${esc(l.name)}</b><span class="code">${esc(l.web_code || '')}${l.outside ? ' · ยานอก รพ.สต.' : ''}${l.active ? '' : ' · ซ่อน'}</span></button>`
      + K.map((k) => { const c = cellS(k, j[k].s); return `<button type="button" class="dc-cell s-${c}" data-dc-row="${l.id}" data-dc-k="${k}" title="${KN[k]}: ${SN[c]}" aria-label="${esc(l.name)} · ${KN[k]}: ${SN[c]}">${SYM[c]}</button>`; }).join('')
      + `<span class="dc-pill p-${ROW[st][1]}">${ROW[st][0]}</span></div>`).join('')
      : '<p class="empty">ไม่มียาในกลุ่มนี้</p>');
}
/* ---- แก้ทีละส่วนในแผง ---- */
function editorHtml(l, k) {
  const foot = (extra = '') => `<div class="dc-ed-foot"><button type="button" class="btn btn-p btn-sm" data-dc-save="${k}">บันทึก</button><button type="button" class="btn btn-o btn-sm" data-dc-cancel>ยกเลิก</button>${extra}`
    + `<button type="button" class="dc-na-t" data-dc-na="${k}">${(l.link_na || []).includes(k) ? 'ต้องมีส่วนนี้ (ยกเลิก "ไม่ใช้")' : 'ไม่ใช้กับยานี้'}</button></div>`;
  if (k === 'str') {   // ① ยาในเว็บแอพ: ชื่อ · รูปแบบ · ความแรง · คิดเป็น (เมื่อขนาดยาคิดจากสารเฉพาะ เช่น ธาตุเหล็ก)
    const s = l.strength, u = `${s?.u || 'mg'}|${s?.per || 'tab'}`, cats = [...new Set(D.locals.map((x) => x.category).filter(Boolean))];
    const bases = basesOf(l), combo = isCombo(l) || comboName(l.name);
    return `<div class="dc-f"><label class="small" for="dcName">ชื่อยา</label><input id="dcName" class="input" maxlength="200" value="${esc(l.name)}"></div>`
      + `<div class="dc-f"><label class="small" for="dcCat">รูปแบบยา</label><select id="dcCat" class="input">${cats.map((c) => `<option${c === l.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>`
      + (combo ? `<p class="small">ยาสูตรผสม: กรอกสารสำคัญทีละตัวในฟอร์มยา</p><div class="dc-ed-foot"><button type="button" class="btn btn-o btn-sm" data-dc-work="drug">✎ แก้สารสำคัญ (หน้าทำงานทีละยา)</button></div>`
        : `<div class="dc-f"><span class="small">ความแรง</span><div class="dc-ed-row"><input id="dcStrAmt" class="input" type="number" inputmode="decimal" min="0" step="0.001" placeholder="ว่าง = อ่านจากชื่อยา" aria-label="ความแรง" value="${s ? esc(s.u === 'mcg' ? s.amt : s.mg) : ''}">`
        + `<select id="dcStrUnit" class="input" aria-label="หน่วย">${UNITS.map(([v, t]) => `<option value="${v}"${v === u ? ' selected' : ''}>${t}</option>`).join('')}</select></div></div>`
        + (bases.length || s?.as ? `<div class="dc-f"><span class="small">คิดเป็น (ขนาดยาบางข้อคิดจากสารนี้ · ไม่ใช่น้ำหนักเกลือ)</span><div class="dc-ed-row"><select id="dcAsName" class="input" aria-label="คิดเป็นสาร"><option value="">— ไม่มี —</option>${[...new Set([...bases, ...(s?.as ? [s.as.name] : [])])].map((n) => `<option${s?.as && sameBasis(s.as.name, n) ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`
          + `<input id="dcAsMg" class="input" type="number" inputmode="decimal" min="0" step="0.001" placeholder="มก. ต่อหน่วยเดียวกัน" aria-label="ปริมาณที่คิดเป็น" value="${s?.as ? esc(s.as.mg) : ''}"></div></div>` : ''))
      + `<div class="dc-ed-foot"><button type="button" class="btn btn-p btn-sm" data-dc-save="str">บันทึก</button><button type="button" class="btn btn-o btn-sm" data-dc-cancel>ยกเลิก</button><button type="button" class="btn btn-o btn-sm" data-dc-work="drug">แก้ละเอียด ›</button></div>`;
  }
  if (k === 'rpst') {   // ② บัญชียา รพ.สต.: เลือกรายการในบัญชี (รหัสโรงพยาบาล) หรือเป็นยานอก รพ.สต.
    const used = new Set(D.locals.filter((x) => x.id !== l.id).map((x) => x.code).filter(Boolean));
    const opts = (D.rpst || []).filter((it) => !used.has(it.code));
    return `<select id="dcRpst" class="input" aria-label="รายการในบัญชียา รพ.สต."><option value="">— ไม่อยู่ในบัญชี (ยานอก รพ.สต.) —</option>${opts.map((it) => `<option value="${esc(it.code)}"${it.code === l.code ? ' selected' : ''}>${esc(`${it.code} · ${it.name}`)}</option>`).join('')}</select>`
      + `<p class="small muted">ยังไม่มีในรายการ = เพิ่ม/นำเข้าที่ ⋯ เครื่องมือฐานข้อมูล › บัญชียา รพ.สต.</p>`
      + `<div class="dc-ed-foot"><button type="button" class="btn btn-p btn-sm" data-dc-save="rpst">บันทึก</button><button type="button" class="btn btn-o btn-sm" data-dc-cancel>ยกเลิก</button><button type="button" class="btn btn-o btn-sm" data-dc-work="rpst">✎ แก้ไข/เพิ่มในบัญชียา รพ.สต. ›</button></div>`;
  }
  if (k === 'nlem') {
    const names = [...new Set(edit.refs.map((r) => D.monos.find((m) => m.ref === r)?.name).filter(Boolean))];
    return `<div class="di-chips">${names.map((n) => { const m = D.monos.find((x) => x.name === n); return `<span class="chip c-role">${codeTag(m)}${esc(n)}<button type="button" class="nt-x" data-dc-unmono="${esc(n)}" aria-label="เลิกผูก ${esc(n)}">×</button></span>`; }).join('') || '<span class="small muted">ยังไม่ได้ผูก</span>'}</div>`
      + `<input id="dcMonoQ" class="input" type="search" placeholder="พิมพ์ชื่อยาภาษาอังกฤษเพื่อค้นหา" aria-label="ค้นหาข้อมูลยาในบัญชียาหลัก" value="${esc(edit.q || '')}"><div class="ld-pick" id="dcMonoOut">${monoPick(edit.q)}</div>` + foot();
  }
  if (k === 'mims') {
    return `<select id="dcMims" class="input" aria-label="ข้อมูล MIMS"><option value="">— ไม่ผูก —</option>${(D.mims || []).map((m) => `<option value="${m.id}"${m.id === l.mims_id ? ' selected' : ''}>${esc(`${m.web_code ? m.web_code + ' · ' : ''}${m.name}`)}</option>`).join('')}</select>`
      + `<p class="small muted">ยังไม่มีในรายการ = นำเข้าไฟล์ MIMS ที่ ⋯ เครื่องมือฐานข้อมูล › ฐานข้อมูล MIMS</p>` + foot(`<button type="button" class="btn btn-o btn-sm" data-dc-tool="mims">เปิดฐานข้อมูล MIMS</button>`);
  }
  if (k === 'fda') {
    return `<select id="dcFda" class="input" aria-label="ฉลาก openFDA"><option value="">— ไม่ผูก —</option>${D.fdas.map((f) => `<option value="${esc(f.key)}"${f.key === l.fda_key ? ' selected' : ''}>${esc(`${f.web_code ? f.web_code + ' · ' : ''}${f.title} · ${f.generic} (${f.route})`)}</option>`).join('')}</select>`
      + foot(`<button type="button" class="btn btn-o btn-sm" data-dc-fetch>ดึงฉลากจาก openFDA และผูกเลย</button>`);
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
/** การ์ดแหล่งข้อมูล 1 แหล่ง (ขั้นที่ 2) · ปุ่มดินสอ = แก้ในการ์ด · ระบบเสนอคู่ ✓/✗ */
function secHtml(l, j, k) {
  const x = j[k], open = edit?.k === k, sg = !open && ['miss', 'wait'].includes(x.s) ? suggest(l, k, j) : null, cs = cellS(k, x.s);
  const body = open ? `<div class="dc-ed">${editorHtml(l, k)}</div>`
    : (x.t ? `<p class="small${x.s === 'na' ? ' muted' : ''}">${esc(x.t)}</p>` : '')
      + (x.why ? `<p class="small ${x.s === 'err' ? 'dc-err' : cs === 'opt' ? 'muted' : 'dc-warn'}">${esc(x.why)}</p>` : '')
      + (k === 'mims' && x.mims?.url ? `<p class="small"><a href="${esc(x.mims.url)}" target="_blank" rel="noopener">เปิดหน้า MIMS (ต้อง login)</a> · ข้อบ่งใช้อยู่ในขั้นที่ 3</p>` : '')
      + (sg ? sugHtml(l, k, sg) : x.s === 'miss' && k !== 'mims' ? '<p class="small muted">ระบบยังหาคู่ที่น่าจะตรงไม่ได้ · กดปุ่มดินสอเพื่อเลือกเอง</p>' : '');
  return `<section class="dc-sec s-${cs}${open ? ' is-open' : ''}" id="dcSec-${k}" aria-label="${KN[k]}"><div class="dc-sec-h"><b>${KN[k]}</b><span class="dc-pill p-${cs === 'opt' ? 'na' : cs}">${SYM[cs]} ${SN[cs]}</span>`
    + `<button type="button" class="dc-pen" data-dc-edit="${k}" aria-label="${open ? 'ปิดการแก้ไข' : 'แก้ไข'} ${KN[k]}" aria-expanded="${open}">${open ? '×' : '✎'}</button></div>${body}</section>`;
}
/** ขั้นที่ 1: ยาในเว็บแอพ (อ่านอย่างเดียว · ปุ่มดินสอ = แก้) */
function step1Body(l, j) {
  if (edit?.k === 'str') return `<div class="dc-ed" id="dcSec-str">${editorHtml(l, 'str')}</div>`;
  const st = strengthOf(l), ings = (l.ingredients || []).filter((x) => +x.mg > 0);
  const strT = ings.length > 1 ? ings.map((x) => `${x.name} ${num(x.mg)}`).join(' + ') + ` ${PER[ings[0].per] || ''}` : st ? `${num(st.mg)} ${PER[st.per]}${l.strength ? '' : ' (อ่านจากชื่อยา)'}` : '—';
  const asT = st?.as ? `${st.as.name} ${num(st.as.mg)} ${PER[st.per]}` : '';
  return `<div class="dc-sec s-${j.str.s}" id="dcSec-str"><div class="dc-kv"><span><small>ชื่อยา</small>${esc(l.name)}</span><span><small>รูปแบบยา</small>${esc(cat(l) || '—')}</span>`
    + `<span><small>ความแรง</small>${esc(strT)}</span>${asT ? `<span><small>คิดเป็น</small>${esc(asT)}</span>` : ''}</div>`
    + (j.str.why ? `<p class="small ${j.str.s === 'err' ? 'dc-err' : 'dc-warn'}">${esc(j.str.why)}</p>` : '')
    + `<div class="dc-ed-foot"><button type="button" class="btn btn-o btn-sm" data-dc-work="drug">✎ แก้ไขในหน้าทำงานทีละยา</button></div></div>`;
}
function stepBox(n, title, done, open, right, body) {
  return `<details class="dc-step${done ? ' done' : ''}" data-dc-step="${n}"${open ? ' open' : ''}><summary><span class="dc-n">${done ? '✓' : n}</span><b>${title}</b><span class="small muted dc-step-r">${right}</span></summary><div class="dc-step-b">${body}</div></details>`;
}
function renderPanel() {
  const r = rowsCache.find((x) => x.l.id === sel);
  if (!r) { $('#dcPanel').innerHTML = '<p class="empty">กดชื่อยาหรือช่องสถานะในตาราง เพื่อดูและแก้ข้อมูลยาตัวนั้น</p>'; return; }
  const { l, j, st } = r, sp = steps(j), first = sp.indexOf(false);
  if (!dt || dt.lid !== l.id) dt = buildDt(l, j);
  const inStep = (n) => (focusK ? (focusK === 'str' ? 1 : focusK === 'dose' ? 3 : 2) === n : false) || (edit && (edit.k === 'str' ? 1 : 2) === n);
  const openOf = (n) => inStep(n) || (stepOpen[n] ?? (first === -1 ? n === 3 : first + 1 === n));
  const nSrc = SRC.filter((k) => k !== 'mims' && j[k].s !== 'na'), okSrc = nSrc.filter((k) => j[k].s === 'ok').length;
  const list = visibleRows(), at = list.findIndex((x) => x.l.id === l.id), next = list[at + 1] || null;
  $('#dcPanel').innerHTML = `<div class="dc-ph"><div class="dc-ph-top">${codeTag(l)}${next ? `<button type="button" class="btn btn-o btn-sm dc-next" data-dc-next="${next.l.id}" title="${esc(next.l.name)}">ถัดไป ›</button>` : ''}</div><h3>${esc(l.name)}</h3><div class="dc-tags"><span class="dc-pill p-${ROW[st][1]}">${ROW[st][0]}</span>${l.outside ? '<span class="chip c-off">ยานอก รพ.สต.</span>' : ''}${l.active ? '' : '<span class="chip c-fix">ซ่อนจากหน้าหลัก</span>'}</div><button type="button" class="btn btn-p btn-sm dc-towork" data-dc-work="">✎ แก้ไขละเอียดในหน้าทำงานทีละยา ›</button></div>`
    + stepBox(1, 'ยาในเว็บแอพ', sp[0], openOf(1), sp[0] ? '' : SN[j.str.s], step1Body(l, j))
    + stepBox(2, 'แหล่งข้อมูล', sp[1], openOf(2), `ผูก ${okSrc}/${nSrc.length}${j.mims.s === 'ok' ? ' + MIMS' : ''}`, SRC.map((k) => secHtml(l, j, k)).join(''))
    + stepBox(3, 'ขนาดยา', sp[2], openOf(3), j.dose.s === 'na' ? 'ไม่ใช้คำนวณ' : SN[j.dose.s], doseHtml(l, j))
    + `<div class="dc-ed-foot"><button type="button" class="btn btn-o btn-sm" data-dc-work="drug">✎ แก้ไขในหน้าทำงานทีละยา ›</button></div>`;
  if (focusK) { const el = $(`#dcSec-${focusK}`) || $(`[data-dc-step="${focusK === 'str' ? 1 : focusK === 'dose' ? 3 : 2}"]`); if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } }
}

/* ---- ขั้นที่ 3: ตารางขนาดยาจากทุกแหล่ง ---- */
const indKey = (i) => `${String(i.name || '').trim().toLowerCase()}|${i.ref?.url || ''}|${i.min ?? ''}|${i.max ?? ''}|${i.per || ''}`;
const srcOf = (i) => (/^MIMS/.test(i.ref?.label || '') ? 'MIMS' : /dailymed|fda/i.test(`${i.ref?.url || ''} ${i.ref?.label || ''}`) ? 'ฉลาก US' : i.ref?.label ? i.ref.label : 'กรอกเอง');
const clean = (i) => { const { skip, ...rest } = i; return rest; };
/** สารที่ข้อบ่งใช้คิดขนาดยา (basis) จากข้อมูลคำนวณ + MIMS → ตัวเลือกช่อง "คิดเป็น" ในขั้นที่ 1 (ยาเดี่ยว) */
function basesOf(l) {
  const d = judge(l, 'dose').dose, m = l.mims_id && (D.mims || []).find((x) => x.id === l.mims_id);
  const all = [...(d ? indsOf(d) : []), ...(d?.spare_inds || []), ...(m?.indications || [])].map((i) => i.basis).filter(Boolean);
  return [...new Set(all)].filter((b) => !sameBasis(b, genericKey(l.name)));
}
/** แถวในตาราง: ข้อมูลคำนวณเดิม (ติ๊กไว้) · ข้อที่เก็บไว้ (spare_inds) · MIMS ที่ยังไม่มี (ไม่ติ๊ก) · ข้อมูล MIMS ไม่ครบ = แก้ก่อนจึงติ๊กได้ */
function buildDt(l, j) {
  const d = j.dose.dose, rows = [], seen = new Set();
  const push = (i, on) => { const k = indKey(i); if (seen.has(k)) return; seen.add(k); rows.push({ ind: clean(i), on: on && !i.skip, skip: i.skip || null }); };
  if (d) { indsOf(d).forEach((i) => push(i, true)); (d.spare_inds || []).forEach((i) => push(i, false)); }
  const m = l.mims_id && (D.mims || []).find((x) => x.id === l.mims_id);
  if (m) (m.indications || []).forEach((i) => push(i, false));
  return { lid: l.id, rows, editing: null };
}
const onInds = () => dt.rows.filter((r) => r.on).map((r) => r.ind);
function doseHtml(l, j) {
  const x = j.dose, d = x.dose;
  if (x.s === 'na') return `<p class="small muted">${esc(x.t || 'ไม่ใช้คำนวณขนาดยา')}</p><div class="dc-ed-foot"><button type="button" class="dc-na-t" data-dc-na="dose">${(l.link_na || []).includes('dose') ? 'ต้องคำนวณขนาดยา (ยกเลิก "ไม่ใช้")' : 'ต้องคำนวณขนาดยา'}</button></div>`;
  const rows = dt.rows, on = onInds();
  const rowHtml = (r, k) => dt.editing === k
    ? `<li class="dt-row is-ed"><div class="dt-ed" id="dtEd">${indBox(r.ind, true)}<div class="dc-ed-foot"><button type="button" class="btn btn-p btn-sm" data-dt-apply>ใช้ค่านี้</button><button type="button" class="btn btn-o btn-sm" data-dt-cancel>ยกเลิก</button></div></div></li>`
    : `<li class="dt-row${r.on ? ' on' : ''}${r.skip ? ' skip' : ''}"><label class="dt-chk"><input type="checkbox" data-dt-on="${k}"${r.on ? ' checked' : ''}${r.skip ? ' disabled' : ''} aria-label="ใช้ข้อบ่งใช้ ${esc(r.ind.name)}"></label>`
      + `<div class="dt-main"><b>${esc(r.ind.name)}</b><span>${esc(doseText(r.ind))}${r.ind.fixed ? ' · ขนาดคงที่' : ''}</span>`
      + `<span class="small muted">${esc([ageText(r.ind), r.ind.freq, r.ind.cap_day ? `ไม่เกิน ${r.ind.cap_day} ${r.ind.unit === 'mcg' ? 'mcg' : 'มก.'}/วัน` : '', r.ind.basis ? `คิดจาก ${r.ind.basis}` : '', r.ind.note].filter(Boolean).join(' · '))}</span>`
      + (r.skip ? `<span class="small dc-warn">ยังใช้คำนวณไม่ได้: ${esc(r.skip)} · กด ✎ เพื่อเติม</span>` : '')
      + `</div><span class="dt-src">${r.ind.ref?.url && /^https:\/\//.test(r.ind.ref.url) ? `<a href="${esc(r.ind.ref.url)}" target="_blank" rel="noopener">${esc(srcOf(r.ind))}</a>` : esc(srcOf(r.ind))}</span>`
      + `<button type="button" class="dc-pen" data-dt-edit="${k}" aria-label="แก้ ${esc(r.ind.name)}">✎</button></li>`;
  let check = '';
  if (on.length) {
    const why = indsProblem(on), t = testDose({ ...(d || {}), indications: on }, [l]);
    check = why ? `<p class="small dc-err" data-dt-problem>${esc(why)}</p>`
      : `<details class="dc-test dt-check dt-${t.status}"${t.status === 'fail' ? ' open' : ''}><summary>ตรวจซ้ำ (ทดสอบสูตร): ${t.status === 'pass' ? '✓ ผ่านทุกน้ำหนักตัวอย่าง' : t.status === 'warn' ? `ผ่าน · มีข้อควรตรวจ ${t.issues.length} ข้อ` : '! ไม่ผ่าน · แก้ก่อนอนุมัติ'}</summary>${testHtml(t, esc)}</details>`;
  }
  const ok = on.length && !indsProblem(on) && testDose({ ...(d || {}), indications: on }, [l]).status !== 'fail';
  const mine = d && [l.dose_id, ...(l.ingredients || []).map((g) => g.dose_id)].includes(d.id), live = mine && d.active && !d.ai_draft;   // ข้อมูลที่จับคู่ตามชื่อ = ต้องยืนยันก่อน
  return (d ? `<p class="small muted">ข้อมูลคำนวณ: ${esc((x.t || '').replace(/^DOSE-\S+\s/, ''))}</p>${sharedNote(d, l)}` : '<p class="small muted">ยังไม่มีข้อมูลคำนวณ · ติ๊กข้อบ่งใช้จากแหล่งข้อมูลด้านล่าง หรือเพิ่มเอง</p>')
    + (rows.length ? `<ul class="dt-rows">${rows.map(rowHtml).join('')}</ul>` : '<p class="empty small">ยังไม่มีข้อบ่งใช้จากแหล่งข้อมูล · ผูก MIMS ในขั้นที่ 2 หรือเพิ่มเอง</p>')
    + (dt.editing === -1 ? `<div class="dt-ed" id="dtEd">${indBox({ per: 'dose' }, true)}<div class="dc-ed-foot"><button type="button" class="btn btn-p btn-sm" data-dt-apply>เพิ่มข้อนี้</button><button type="button" class="btn btn-o btn-sm" data-dt-cancel>ยกเลิก</button></div></div>`
      : `<div class="dc-ed-foot"><button type="button" class="btn btn-o btn-sm" data-dt-add>+ เพิ่มข้อบ่งใช้เอง</button><button type="button" class="btn btn-o btn-sm" data-dc-work="dose">ให้ AI ร่าง / แก้ละเอียด (หน้าทำงานทีละยา) ›</button></div>`)
    + check
    + `<div class="dc-ed-foot dt-act"><button type="button" class="btn btn-p btn-sm" data-dt-save="${live ? 'save' : 'approve'}"${ok ? '' : ' disabled'}>${live && l.active ? 'บันทึกการแก้ไข' : 'อนุมัติใช้คำนวณ'}</button>`
    + (live ? '' : `<button type="button" class="btn btn-o btn-sm" data-dt-save="draft"${on.length ? '' : ' disabled'}>บันทึกไว้ก่อน (ยังไม่ใช้คำนวณ)</button>`)
    + `<button type="button" class="dc-na-t" data-dc-na="dose">ยานี้ไม่ต้องคำนวณขนาดยา</button></div>`;
}
/** บันทึกข้อบ่งใช้ของยา l (ใช้ร่วมกับหน้าทำงานยา drug-work.js)
 *  rows = [{ ind, on, skip }] · approve = ใช้คำนวณ (ต้องผ่านตรวจซ้ำ) · save = แก้ข้อมูลที่ใช้อยู่ · draft = เก็บเป็นร่าง (ซ่อน)
 *  ข้อบ่งใช้ที่ไม่ได้ติ๊ก (ยกเว้นที่มาจาก MIMS · เก็บใน drug_mims อยู่แล้ว) → spare_inds · ผิดเงื่อนไข = throw Error ข้อความไทย → { sib } ยาที่ใช้ข้อมูลนี้ร่วม */
export async function saveDose(l, j, rows, mode) {
  const on = rows.filter((r) => r.on).map((r) => r.ind), off = rows.filter((r) => !r.on && !/^MIMS/.test(r.ind.ref?.label || '')).map((r) => (r.skip ? { ...r.ind, skip: r.skip } : r.ind));
  if (!on.length) throw new Error('ติ๊กข้อบ่งใช้ที่จะใช้อย่างน้อย 1 ข้อ');
  const d = j.dose.dose;
  if (mode !== 'draft') {
    const why = indsProblem(on); if (why) throw new Error(why);
    if (testDose({ ...(d || {}), indications: on }, [l]).status === 'fail') throw new Error('ผลตรวจซ้ำ (ทดสอบสูตร) ไม่ผ่าน · แก้ตามรายการก่อน');
  }
  const f = on[0], row = { indications: on, spare_inds: off.slice(0, 60), indication: f.name, per: f.per, mg_per_kg_min: f.fixed ? 0 : asMg(f, f.min), mg_per_kg_max: f.fixed ? 0 : asMg(f, f.max),
    dose_freq_per_day: f.times ?? null, max_mg_per_dose: asMg(f, f.cap ?? null), freq: f.freq ?? null, renal_note: f.renal ?? null, ai_draft: mode === 'draft', active: mode !== 'draft' };
  let id = d?.id;
  if (d) { const { error } = await sb.from('dose_drugs').update(row).eq('id', d.id); if (error) throw error; }
  else {
    const m = l.mims_id && (D.mims || []).find((x) => x.id === l.mims_id), name = (m?.name || String(l.name).replace(/\s+\d[\d.,/ ]*(MG|MCG|G|ML|%).*$/i, '')).slice(0, 120);
    const form = /เม็ด|แคปซูล/.test(cat(l)) ? 'ยาเม็ด' : /น้ำ/.test(cat(l)) ? 'ยาน้ำ' : 'อื่น ๆ';
    const { data, error } = await sb.from('dose_drugs').insert({ name, form, concs: [], sort: 0, ...row }).select().single();
    if (error) throw error;
    id = data.id;
  }
  // ยาตัวนี้ + ยาเม็ด/ยาน้ำตัวเดียวกันที่ยังไม่มีข้อมูลคำนวณ (MIMS เดียวกัน หรือชื่อสามัญเดียวกัน) ใช้ข้อมูลนี้ร่วมกัน
  const own = (x) => [x.dose_id, ...(x.ingredients || []).map((g) => g.dose_id)].filter(Boolean).length;
  const sib = D.locals.filter((x) => x.id !== l.id && !own(x) && !(x.link_na || []).includes('dose') && ((l.mims_id && x.mims_id === l.mims_id) || genericKey(x.name) === genericKey(l.name)));
  const links = [...(own(l) && l.dose_id === id ? [] : [l]), ...sib];
  for (const x of links) {
    const up = { dose_id: id, updated_at: new Date().toISOString(), ...(x.id === l.id && mode !== 'draft' && !l.active ? { active: true } : {}) };
    const { error } = await sb.from('local_drugs').update(up).eq('id', x.id); if (error) throw error;
  }
  if (mode !== 'draft' && !l.active && !links.includes(l)) await sb.from('local_drugs').update({ active: true }).eq('id', l.id);
  if (mode !== 'draft') { const { error } = await sb.rpc('approve_dose', { p_id: id }); if (error) throw error; }   // บันทึกผู้อนุมัติ (90 · ฐานข้อมูลตรวจกฎซ้ำ) แม้ข้อบ่งใช้ไม่เปลี่ยน
  return { sib };
}
async function saveDt(l, j, mode, btn) {
  busy(btn, true, 'กำลังบันทึก…');
  try {
    const { sib } = await saveDose(l, j, dt.rows, mode);
    toast(mode === 'draft' ? 'บันทึกเป็นร่างแล้ว (ยังไม่ใช้คำนวณ)' : mode === 'approve' ? `อนุมัติแล้ว · ใช้คำนวณได้${sib.length ? ` (ใช้ร่วมกับ ${sib.map((x) => x.name).join(', ')})` : ''}` : 'บันทึกแล้ว');
    dt = null; edit = null; focusK = 'dose';
    await reloadDrugData(); D = await drugData(); renderAll();
  } catch (err) { toast(errText(err), 'err'); } finally { busy(btn, false); }
}
/** แถวข้อบ่งใช้ของยา l จากทุกแหล่ง (ข้อมูลคำนวณเดิม · spare_inds · MIMS) → [{ ind, on, skip }] */
export function doseRows(l, j) { return buildDt(l, j).rows; }
/** ข้อมูลคำนวณใช้ร่วมหลายยา → บอกว่าแก้แล้วมีผลกับยาตัวไหนบ้าง */
function sharedNote(d, l) {
  const others = D.locals.filter((x) => x.id !== l.id && (x.dose_id === d.id || (x.ingredients || []).some((g) => g.dose_id === d.id)));
  return others.length ? `<p class="small muted">ข้อมูลคำนวณนี้ใช้ร่วมกับ ${others.length} ยา: ${esc(others.slice(0, 4).map((x) => x.name).join(', '))}${others.length > 4 ? ' …' : ''} · แก้แล้วมีผลทุกตัว</p>` : '';
}
function renderAll() { compute(); renderTop(); renderTable(); renderPanel(); }

/** แท็บข้อมูลยา: center = ศูนย์ข้อมูลยา · grid = ตารางแก้ไขยา (drug-grid.js) · help = วิธีใช้ */
export function showDrugTab(page) {
  $('#dcCenter').hidden = page !== 'center'; $('#dcHelp').hidden = page !== 'help'; $('#dcGrid').hidden = page !== 'grid'; $('#dcWork').hidden = page !== 'work'; $('#dcTrash').hidden = page === 'help';
  if (page === 'help') setDrawer(false);
  curPage = page;
}
let curPage = 'center';
/** หน้าที่อยู่ด้านหลังแผงเครื่องมือ (ปิดแผงแล้วกลับมาที่หน้านี้) */
export const drugPage = () => curPage;
export const pageHash = (p) => (p === 'center' ? '#/admin/drugs' : `#/admin/drugs/${p}`);

/* ---------- ใช้ร่วมกับตารางแก้ไขยา (drug-grid.js) · สถานะ/คู่ที่ระบบเสนอชุดเดียวกับศูนย์ข้อมูลยา ---------- */
export const DC = { K, SRC, KN, KS, SYM, SN, ROW, PER, UNITS, cellS, idv, isCombo };
export { judgeAll, suggest, applyRow, basesOf };
/** ยาทุกตัว + สถานะ (โหลดใหม่เมื่อ reload) */
export async function centerRows(reload = false) {
  if (reload || !D) {
    const [d, rj] = await Promise.all([drugData(), D ? null : sb.from('drug_link_rejects').select('local_id,kind,target')]);
    D = d; if (rj) rejects = rj.data || [];
  }
  compute(); return rowsCache;
}
/** เปิดยานี้ในแผงยาของศูนย์ข้อมูลยา (เรียกก่อนเปลี่ยนหน้าไป #/admin/drugs) */
export function focusDrug(id, k = null) {
  if (id !== sel) { dt = null; stepOpen = {}; }
  sel = id; focusK = k; edit = null; jump = true; filt = 'all';
  const q = $('#dcQ'); if (q) q.value = '';
}
/** ✗ ไม่ใช่คู่นี้ (จำไว้ ไม่เสนออีก) */
export async function rejectPair(l, k, target) {
  const row = { local_id: l.id, kind: k, target: String(target) };
  const { error } = await sb.from('drug_link_rejects').insert(row);
  if (error && !/duplicate|23505/.test(errText(error) + error.code)) throw error;
  rejects.push(row);
}
/** แผงเครื่องมือฐานข้อมูล: from = 'route' (ลิงก์ #/admin/drugs/<ส่วน>) | 'center' (จากแผงยา · บันทึกแล้วปิดเอง) */
export function setDrawer(open, from = null) {
  $('#dcDrawer').hidden = !open; $('#dcDrBack').hidden = !open;
  document.documentElement.classList.toggle('dc-dr-open', open);
  drawerFrom = open ? from : null;
  if (!open) approveAfter = null;
}
/** หน้าทำงานยา: เปิดเครื่องมือฐานข้อมูลที่ส่วนนั้น · บันทึกแล้วปิดเอง (เหตุการณ์ pcps:workback) */
export function openTools(sec) {
  setDrawer(true, 'work');
  const el = sec && document.querySelector(`[data-adr-sec="${sec}"]`);
  if (el) el.open = true;
}
/** เปิดยานี้ในหน้าทำงานทีละยา (part = drug | rpst | mims | fda | nlem | ddi | dose → เปิดส่วนนั้นให้) */
export function toWork(id, part = '') {
  try { sessionStorage.setItem('pcps_work_focus', part ? `${id}:${part}` : String(id)); } catch { /* ไม่เป็นไร */ }
  location.hash = '#/admin/drugs/work';
}
function closeDrawer() {
  const wasRoute = drawerFrom === 'route';
  setDrawer(false);
  if (wasRoute && location.hash !== pageHash(curPage)) location.hash = pageHash(curPage);
}
export async function initDrugCenter() {
  if (!bound) bind();
  try {   // ปุ่ม "แก้ไขข้อมูลนี้" ในหน้าข้อมูลยา (ยา รพ.สต.) → เปิดแผงยานั้น
    const [kind, id] = String(sessionStorage.getItem('pcps_drug_edit') || '').split(':');
    if (kind === 'local' && +id) { sessionStorage.removeItem('pcps_drug_edit'); sel = +id; focusK = null; }
  } catch { /* ไม่เป็นไร */ }
  try {
    const [d, rj] = await Promise.all([drugData(), sb.from('drug_link_rejects').select('local_id,kind,target')]);
    D = d; rejects = rj.data || [];
  } catch (err) { toast(errText(err), 'err'); $('#dcTable').innerHTML = '<p class="empty">โหลดข้อมูลยาไม่สำเร็จ กรุณาลองใหม่</p>'; return; }
  if ($('#dcCenter').hidden) return;   // เปิดหน้าอื่นอยู่ (ทำงานทีละยา/ตาราง) · ผูกปุ่มแผงเครื่องมือไว้อย่างเดียว
  renderAll();
  if (jump) { jump = false; $('#dcPanel').scrollIntoView({ block: 'start' }); }
}
function pick(id, k) {
  if (id !== sel) { dt = null; stepOpen = {}; }
  sel = id; focusK = k || null; edit = null;
  renderTable(); renderPanel();
  if (matchMedia('(max-width: 1100px)').matches) $('#dcPanel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  else if (k) $(`#dcSec-${k}`)?.scrollIntoView({ block: 'nearest' });
}
function openEdit(l, k) {
  if (k === 'test') { toWork(l.id, 'dose'); return; }   // ผลทดสอบมาจากข้อมูลคำนวณ → แก้ที่การ์ดขนาดยา (หน้าทำงานทีละยา)
  edit = edit?.k === k ? null : { k, refs: [...(l.mono_refs || [])], ddi: [...(l.ddi_ids || [])], q: '' };
  focusK = null; renderPanel();
  if (edit) { $(`#dcSec-${k}`)?.scrollIntoView({ block: 'nearest' }); $(`#dcSec-${k} input, #dcSec-${k} select`)?.focus({ preventScroll: true }); }
}
function bind() {
  bound = true;
  $('#dcDrClose').addEventListener('click', closeDrawer);
  document.addEventListener('click', (e) => { if (e.target.closest('[data-dw-new]')) { try { sessionStorage.setItem('pcps_work_focus', 'new'); } catch { /* ไม่เป็นไร */ } } }, true);   // + เพิ่มยา → หน้าทำงานทีละยา ช่องชื่อยาใหม่
  $('#dcDrBack').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#dcDrawer').hidden) closeDrawer(); });
  // รายการ "เพิ่มยา" ในแผงเครื่องมือ → เปิดยานั้นในศูนย์ข้อมูลยา
  $('#dcDrawer').addEventListener('click', (e) => { const b = e.target.closest('[data-dc-open]'); if (!b) return;
    if (curPage === 'work') { try { sessionStorage.setItem('pcps_work_focus', b.dataset.dcOpen); } catch { /* ไม่เป็นไร */ } setDrawer(false); if (location.hash !== '#/admin/drugs/work') location.hash = '#/admin/drugs/work'; else window.dispatchEvent(new CustomEvent('pcps:workback', { detail: 'pick' })); return; }   // หน้าทำงานทีละยา → เปิดยานั้น
    closeDrawer(); filt = 'all'; $('#dcQ').value = ''; renderTop(); pick(+b.dataset.dcOpen); });
  // บันทึกฟอร์มเต็มที่เปิดจากแผงยา → ปิดแผงเครื่องมือ กลับมาที่ยาเดิม (สถานะในตารางเปลี่ยนทันที)
  const back = async (k) => {
    if (drawerFrom === 'work') { setDrawer(false); window.dispatchEvent(new CustomEvent('pcps:workback', { detail: k })); return; }   // เปิดจากหน้าทำงานยา → กลับไปยาเดิม
    if (drawerFrom !== 'center') return;
    const ap = approveAfter; setDrawer(false);
    await reloadDrugData(); D = await drugData();
    const l = D.locals.find((x) => x.id === sel);
    if (ap && l && !l.active) { await save(l, { active: true }, 'อนุมัติแล้ว · ยาแสดงที่หน้าหลักและใช้คำนวณได้', 'dose'); return; }
    focusK = k; renderAll(); $('#dcPanel').scrollIntoView({ block: 'nearest' });
  };
  window.addEventListener('pcps:dosesaved', () => back('dose'));
  window.addEventListener('pcps:localsaved', () => back('str'));
  window.addEventListener('pcps:drugdata', async () => { if (!D) return; D = await drugData(); if (dt && dt.editing == null) dt = null; if (!$('#dcCenter').hidden) renderAll(); });   // ข้อมูลชุดใหม่หลังบันทึก (ที่นี่หรือส่วนฐานข้อมูลด้านล่าง)
  const onF = (e) => { const b = e.target.closest('[data-dc-f]'); if (!b) return; filt = filt === b.dataset.dcF ? 'all' : b.dataset.dcF; renderTop(); renderTable(); };
  $('#dcCards').addEventListener('click', onF); $('#dcRings').addEventListener('click', onF);
  $('#dcQ').addEventListener('input', renderTable);
  $('#dcScope').addEventListener('change', () => { scope = $('#dcScope').value; renderTop(); renderTable(); });
  $('#dcTable').addEventListener('click', (e) => { const b = e.target.closest('[data-dc-row]'); if (b) pick(+b.dataset.dcRow, b.dataset.dcK); });
  $('#dcBulk').addEventListener('click', bulk);
  $('#dcCheckBtn').addEventListener('click', () => { compute(); runCheck(rowsCache); });   // ตรวจข้อมูลขนาดยาทุกตัวในครั้งเดียว (dose-check.js)
  bindCheck();
  $('#dcPanel').addEventListener('input', (e) => { if (e.target.id === 'dcMonoQ') { edit.q = e.target.value; $('#dcMonoOut').innerHTML = monoPick(edit.q); } if (e.target.closest('#dtEd')) syncIndBoxes($('#dtEd')); });
  $('#dcPanel').addEventListener('change', (e) => { if (e.target.closest('#dtEd')) syncIndBoxes($('#dtEd')); });
  $('#dcPanel').addEventListener('toggle', (e) => { const st = e.target.closest?.('[data-dc-step]'); if (st && e.target === st) stepOpen[st.dataset.dcStep] = st.open; }, true);   // ขั้นที่ผู้ดูแลเปิด/ย่อเอง จำไว้ระหว่างแก้
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
  // ขั้นที่ 3: ตารางขนาดยา
  if (t.matches('[data-dt-on]')) { const row = dt.rows[+t.dataset.dtOn]; if (row) row.on = t.checked; renderPanel(); return; }
  if (B('[data-rmind]') && B('#dtEd')) { e.preventDefault(); if (dt.editing >= 0) dt.rows.splice(dt.editing, 1); dt.editing = null; renderPanel(); return; }
  if (B('[data-dt-edit]')) { dt.editing = +B('[data-dt-edit]').dataset.dtEdit; renderPanel(); syncIndBoxes($('#dtEd')); $('#dtEd')?.scrollIntoView({ block: 'nearest' }); return; }
  if (B('[data-dt-add]')) { dt.editing = -1; renderPanel(); syncIndBoxes($('#dtEd')); $('#dtEd')?.scrollIntoView({ block: 'nearest' }); return; }
  if (B('[data-dt-cancel]')) { dt.editing = null; renderPanel(); return; }
  if (B('[data-dt-apply]')) {
    let ind; try { [ind] = readInds($('#dtEd')); } catch (err) { toast(err.message, 'err'); return; }
    if (dt.editing >= 0) dt.rows[dt.editing] = { ind, on: true, skip: null }; else dt.rows.push({ ind, on: true, skip: null });
    dt.editing = null; renderPanel(); return;
  }
  if (B('[data-dt-save]')) return saveDt(l, r.j, B('[data-dt-save]').dataset.dtSave, B('[data-dt-save]'));
  if (B('[data-dc-edit]')) return openEdit(l, B('[data-dc-edit]').dataset.dcEdit);
  if (B('[data-dc-cancel]')) { edit = null; renderPanel(); return; }
  if (B('[data-dc-unmono]')) { const n = B('[data-dc-unmono]').dataset.dcUnmono; edit.refs = edit.refs.filter((x) => D.monos.find((m) => m.ref === x)?.name !== n); renderPanel(); return; }
  if (B('[data-dc-addmono]')) { const n = B('[data-dc-addmono]').dataset.dcAddmono; edit.refs = [...new Set([...edit.refs, ...D.monos.filter((m) => m.name === n).map((m) => m.ref)])]; edit.q = ''; renderPanel(); return; }
  if (B('[data-dc-unddi]')) { const i = B('[data-dc-unddi]').dataset.dcUnddi; edit.ddi = edit.ddi.filter((x) => x !== i); renderPanel(); return; }
  if (B('[data-dc-addddi]')) return addDdi();
  if (B('[data-dc-next]')) return pick(+B('[data-dc-next]').dataset.dcNext);
  if (B('[data-dc-work]')) { toWork(l.id, B('[data-dc-work]').dataset.dcWork); return; }   // แก้ละเอียด = หน้าทำงานทีละยา (เจ้าของเว็บ 21 ต.ค. · ภาพรวมผูกเร็ว / หน้าทำงานแก้ละเอียด)
  if (B('[data-dc-tool]')) { toWork(l.id, B('[data-dc-tool]').dataset.dcTool); return; }
  if (B('[data-dc-newdose]')) { toWork(l.id, 'dose'); return; }
  if (B('[data-dc-full]')) { toWork(l.id, B('[data-dc-full]').dataset.dcFull === 'dose' ? 'dose' : 'drug'); return; }
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
      if (!row?.sections?.length) { toast(`ไม่พบฉลาก "${g}" ใน openFDA · ลองค้น DailyMed ใน ⋯ เครื่องมือฐานข้อมูล › ฉลากยา`, 'err'); return; }
      const { error } = await sb.from('drug_fda_labels').upsert({ ...row, fetched_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw error;
      await reloadDrugData(true);
      await save(l, { fda_key: row.key }, `ดึงและผูกฉลาก "${row.title}" แล้ว`, 'fda');
    } catch (err) { toast(errText(err), 'err'); } finally { busy(btn, false); }
    return;
  }
  if (B('[data-dc-save]')) {
    const k = B('[data-dc-save]').dataset.dcSave, btn = B('[data-dc-save]'); let row = {};
    if (k === 'str') {   // ① ยาในเว็บแอพ: ชื่อ · รูปแบบ · ความแรง · คิดเป็น
      row.name = $('#dcName').value.trim(); row.category = $('#dcCat').value;
      if (!row.name) { toast('กรุณาใส่ชื่อยา', 'err'); return; }
      if ($('#dcStrAmt')) {
        const amt = +$('#dcStrAmt').value, [u, per] = $('#dcStrUnit').value.split('|'), asN = $('#dcAsName')?.value || '', asMgV = +($('#dcAsMg')?.value || 0);
        if (asN && !(asMgV > 0)) { toast(`กรอกปริมาณ ${asN} ที่คิดเป็น (มก.)`, 'err'); return; }
        if (asN && !(amt > 0)) { toast('กรอกความแรงของยาก่อน แล้วจึงใส่ "คิดเป็น"', 'err'); return; }
        row.strength = amt > 0 ? { mg: u === 'mcg' ? +(amt / 1000).toFixed(6) : amt, per, ...(u === 'mcg' ? { u: 'mcg', amt } : {}), ...(asN ? { as: { name: asN, mg: asMgV } } : {}) } : null;
      }
    }
    if (k === 'rpst') { row.code = $('#dcRpst').value || null; row.outside = !row.code; }
    if (k === 'nlem') row.mono_refs = edit.refs;
    if (k === 'fda') row.fda_key = $('#dcFda').value || null;
    if (k === 'mims') row.mims_id = idv($('#dcMims').value);
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
