// ทดสอบสูตรขนาดยาก่อนเปิดใช้ (ศูนย์ข้อมูลยา · ระยะ 3)
//   ใช้สูตรเดียวกับหน้าคำนวณ (dose.js doseNumbers) คิดทุกข้อบ่งใช้ × น้ำหนักตัวอย่าง × ความแรงของยาที่ผูกไว้
//   น้ำหนักตัวอย่างตามช่วงอายุของข้อบ่งใช้: เด็กอย่างเดียว (อายุไม่เกิน 12 ปี) 5 · 10 · 20 · 40 กก. · ตั้งแต่ 12 ปี 40 · 60 · 80 กก. · ไม่ระบุ 5 · 10 · 20 · 40 · 60 กก.
//   ขนาดคงที่ (fixed) ไม่ขึ้นกับน้ำหนัก → ทดสอบแถวเดียว
//   ผลแต่ละข้อ: fail = คำนวณไม่ได้ หรือจำนวนเม็ด/มล. มากผิดปกติตั้งแต่น้ำหนักน้อยสุด (น่าจะกรอกหน่วย/จุดทศนิยมผิด) → อนุมัติไม่ได้จนแก้
//                มากผิดปกติเฉพาะน้ำหนักมาก = warn (ควรใส่ขนาดสูงสุด/ช่วงอายุ)
//                warn = ควรตรวจ (ถูกจำกัดเพดานตั้งแต่น้ำหนักน้อยสุด · น้อยเกินตวง · แบ่งเม็ดไม่ลงตัว · หลายเม็ดต่อครั้ง · ไม่มีขนาดสูงสุด) → อนุมัติได้
//   เกณฑ์ตัวเลข (LIMITS) เป็นค่าเริ่มต้นสำหรับจับการกรอกผิด ไม่ใช่เกณฑ์ทางคลินิก · เภสัชกรปรับได้ที่นี่
import { doseNumbers, concOf, strengthOf, indsOf } from './dose.js?v=4.4';

export const LIMITS = { failTabs: 20, failMl: 100, warnTabs: 5 };
const W_CHILD = [5, 10, 20, 40], W_ADULT = [40, 60, 80], W_ALL = [5, 10, 20, 40, 60];
/** น้ำหนักตัวอย่างของข้อบ่งใช้นี้ */
export function testWeights(i) {
  if (i.fixed) return [0];   // 0 = ไม่ขึ้นกับน้ำหนัก
  const aMin = i.age_min != null ? +i.age_min : null, aMax = i.age_max != null ? +i.age_max : null;
  if (aMin != null && aMin >= 12) return W_ADULT;
  if (aMax != null && aMax <= 12) return W_CHILD;
  return W_ALL;
}
const PER_TH = { tab: 'มก./เม็ด', '5ml': 'มก./5 มล.', ml: 'มก./มล.' };
const n2 = (x) => (Number.isFinite(x) ? (x >= 10 ? Math.round(x) : x >= 1 ? +x.toFixed(1) : +x.toPrecision(2)) : '–');
const wt = (w) => (w ? `น้ำหนัก ${w} กก.` : 'ขนาดคงที่');
const rg = (a, b) => (n2(a) === n2(b) ? `${n2(a)}` : `${n2(a)}–${n2(b)}`);

/** ความแรงที่ใช้ทดสอบ: ยา รพ.สต. ที่ผูกไว้ (อ่านจาก strength/ingredients/ชื่อ) · ไม่มี = ความแรงทั่วไปของข้อมูลคำนวณ (concs) */
export function testConcs(d, locals = []) {
  const out = [];
  for (const l of locals) {
    const st = strengthOf(l);
    if (st) { const c = concOf(st, `${l.name}`); const fixed = (l.ingredients || []).find((x) => x.dose_id && x.dose_id === d.id); if (fixed && c.ings) c.fixed = fixed.name; c.lname = l.name; out.push({ c, label: l.name, local: l }); }
    else out.push({ c: null, label: l.name, local: l, why: 'ยังไม่มีความแรง' });
  }
  if (!out.length) (d.concs || []).forEach((c) => out.push({ c, label: `${c.label} (ความแรงทั่วไป)` }));
  return out;
}

/** ทดสอบข้อมูลคำนวณ d กับยาที่ใช้ข้อมูลนี้ → { status: pass|warn|fail, issues: [{ sev, text }], rows: [{ ind, w, dose, units: [{ label, text, sev }] }] } */
export function testDose(d, locals = []) {
  const inds = indsOf(d), concs = testConcs(d, locals), issues = [], rows = [];
  const add = (sev, text) => { if (!issues.some((x) => x.text === text)) issues.push({ sev, text }); };
  if (!inds.length) add('fail', 'ยังไม่มีข้อบ่งใช้');
  inds.forEach((i, k) => {
    const name = `ข้อบ่งใช้ ${k + 1}${i.name ? ` (${i.name})` : ''}`, U = i.unit === 'mcg' ? 'mcg' : 'มก.';
    if (!(typeof i.min === 'number' && typeof i.max === 'number' && i.max > 0 && i.max >= i.min)) { add('fail', `${name}: ขนาดยาต่ำสุด/สูงสุดไม่ถูกต้อง`); return; }
    if (i.per === 'day' && !(i.times >= 1)) { add('fail', `${name}: ขนาดต่อวันแต่ไม่ระบุจำนวนครั้ง จึงคิดขนาดต่อครั้งไม่ได้`); return; }
    if (!i.fixed && !(+i.cap > 0) && !(+i.cap_day > 0)) add('warn', `${name}: ยังไม่มีขนาดสูงสุด (ต่อครั้งหรือต่อวัน)`);
    const ws = testWeights(i), times = i.per === 'day' ? [i.times, ...(i.times_alt || [])].map(Number).filter((t) => t >= 1) : [null];
    times.forEach((t) => {
      const ii = t ? { ...i, times: t } : i, tag = times.length > 1 ? ` · วันละ ${t} ครั้ง` : '';
      let first = null;
      ws.forEach((w) => {
        const base = doseNumbers(ii, w, null);   // fixed: w = 0 ไม่ใช้
        if (!Number.isFinite(base.hi) || !(base.hi > 0)) { add('fail', `${name}${tag}: ${wt(w)} คำนวณขนาดยาไม่ได้`); return; }
        if (first == null) first = base;
        const units = concs.map(({ c, label, why }) => {
          if (!c) return { label, text: why || 'ไม่มีความแรง', sev: 'warn' };
          const r = doseNumbers(ii, w, c);
          if (r.comboMissing) return { label, text: 'ยาสูตรผสม: ไม่ระบุว่าคิดจากสารใด', sev: 'fail' };
          if (r.basisMissing) { add('fail', `${name}: คิดจาก ${i.basis} แต่ ${label} ยังไม่ได้ระบุว่าคิดเป็น ${i.basis} กี่ มก. (กรอกช่อง "คิดเป็น" ในขั้นที่ 1 ข้อมูลยา)`); return { label, text: `ไม่มีปริมาณ ${i.basis}`, sev: 'fail' }; }
          const v = r.vol; if (!v) return { label, text: '–', sev: 'warn' };
          const u = v.u === 'tab' ? 'เม็ด' : 'มล.';
          let sev = 'ok';
          const huge = (v.u === 'tab' && v.b > LIMITS.failTabs) || (v.u === 'ml' && v.b > LIMITS.failMl);
          if (huge && w === ws[0]) { sev = 'fail'; add('fail', `${name}${tag}: ${wt(w)} ได้ ${rg(v.a, v.b)} ${u}/ครั้ง จาก ${label} · มากผิดปกติ ตรวจหน่วย (มก./mcg) และจุดทศนิยม`); }
          else if (huge) { sev = 'warn'; add('warn', `${name}${tag}: ${wt(w)} ได้ ${rg(v.a, v.b)} ${u}/ครั้ง จาก ${label} · มากเกินใช้จริง ควรใส่ขนาดสูงสุดต่อครั้งหรือช่วงอายุของข้อบ่งใช้`); }
          else if (v.tiny) { sev = 'warn'; add('warn', `${name}${tag}: ${wt(w)} ปริมาณน้อยเกินตวง/แบ่งจาก ${label}`); }
          else if (v.u === 'tab' && v.b > LIMITS.warnTabs) { sev = 'warn'; add('warn', `${name}${tag}: ${wt(w)} ใช้ ${rg(v.a, v.b)} เม็ดต่อครั้งจาก ${label}`); }
          else if (v.frac) sev = 'warn';
          return { label, text: `${rg(v.a, v.b)} ${u}`, sev };
        });
        rows.push({ ind: `${name}${tag}`, w, dose: `${rg(base.lo, base.hi)} ${U}${base.capped || base.dayCapped ? ' (ถึงเพดาน)' : ''}`, units });
      });
      if (first && !i.fixed && (first.capped || first.dayCapped)) add('warn', `${name}${tag}: ถึงขนาดสูงสุดตั้งแต่น้ำหนัก ${ws[0]} กก. · ตรวจว่าขนาดสูงสุดกรอกหน่วยถูก (${U})`);
    });
  });
  if (rows.some((r) => r.units.some((u) => u.sev === 'warn' && /เม็ด$/.test(u.text)))) add('warn', 'บางน้ำหนักแบ่งเม็ดไม่ลงตัว (½ หรือ ¼ เม็ด) · พิจารณายาน้ำ หรือใช้จำนวนที่แบ่งได้ใกล้เคียง');
  const status = issues.some((x) => x.sev === 'fail') ? 'fail' : issues.length ? 'warn' : 'pass';
  return { status, issues, rows, concs: concs.map((x) => x.label) };
}

/** ตารางผลทดสอบ (HTML · ข้อความผ่าน esc ที่ผู้เรียกส่งมา) */
export function testHtml(t, esc) {
  const icon = { pass: '✓', warn: '●', fail: '!' }[t.status];
  const head = { pass: 'ผ่านการทดสอบสูตร', warn: 'ผ่าน · มีข้อควรตรวจ', fail: 'ไม่ผ่าน · แก้ก่อนอนุมัติ' }[t.status];
  const byInd = [...new Set(t.rows.map((r) => r.ind))];
  return `<div class="dt dt-${t.status}" data-dose-test="${t.status}"><p class="dt-h"><b>${icon} ${head}</b><span class="small muted"> · คิดด้วยสูตรเดียวกับหน้าคำนวณ · น้ำหนักตัวอย่างตามช่วงอายุของข้อบ่งใช้</span></p>`
    + (t.issues.length ? `<ul class="dt-issues">${t.issues.map((x) => `<li class="dt-${x.sev}">${esc(x.text)}</li>`).join('')}</ul>` : '')
    + byInd.map((ind) => { const rs = t.rows.filter((r) => r.ind === ind);
      return `<div class="dt-tbl"><table><caption>${esc(ind)}</caption><thead><tr><th>น้ำหนัก</th><th>ขนาดยา/ครั้ง</th>${t.concs.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>`
        + rs.map((r) => `<tr><td>${r.w ? `${r.w} กก.` : 'ทุกน้ำหนัก'}</td><td>${esc(r.dose)}</td>${r.units.map((u) => `<td class="dt-${u.sev}">${esc(u.text)}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>'; }).join('')
    + '</div>';
}
