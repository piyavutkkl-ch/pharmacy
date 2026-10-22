// กฎความปลอดภัยของข้อมูลขนาดยา (ผลตรวจ audit 22 ต.ค. 2569 · C1–C9) — ฟังก์ชันล้วน ไม่แตะหน้าเว็บ/ฐานข้อมูล
//   ใช้ที่: dose-test.js testDose (ทดสอบสูตร/อนุมัติ) · drug-work.js (การ์ดขนาดยา) · dose.js (หน้าคำนวณ: ข้อที่ไม่ผ่าน = ไม่แสดงตัวเลข)
//   ฐานข้อมูลตรวจซ้ำเฉพาะกฎโครงสร้าง (dose_rules_problem · 90_dose_rules.sql) ตอนยาจะแสดงในเครื่องคำนวณ
//   fail = ใช้คำนวณไม่ได้จนแก้ · warn = ผู้ดูแลต้องกดรับทราบทีละข้อก่อนกด "ตรวจตัวเลขกับฉลากแล้ว"
//   หลัก: เด็กห้ามได้ยามากกว่าผู้ใหญ่ · ทุกข้อต้องระบุช่วงอายุ (ไม่มีข้อเด็ก = ไม่ใช้ข้อผู้ใหญ่แทน) · ช่วงอายุ "ตั้งแต่…ถึงก่อน…" ไม่ขาดตอน
//         คิดตามน้ำหนักต้องมีเพดานชนิดเดียวกัน (ต่อครั้ง → ครั้งละไม่เกิน · ต่อวัน → วันละไม่เกิน) · ต่อครั้ง/ต่อวัน/จำนวนครั้ง ต้องตรงข้อความฉลาก
export const ADULT_AGE = 12;   // ข้อบ่งใช้ที่เริ่มตั้งแต่ 12 ปี = ขนาดผู้ใหญ่ (ใช้เทียบเพดานเด็ก)
const EPS = 1e-6;
const nf = (x) => (Number.isFinite(x) ? (+x.toFixed(3)).toLocaleString('en-US') : '–');
const U = (i) => (i.unit === 'mcg' ? 'mcg' : 'มก.');
const num = (s) => +String(s).replace(/,/g, '');
const yr = (x) => `${+(+x).toFixed(2)}`;
/** อายุสิ้นสุดตั้งแต่ 100 ปี = ไม่จำกัด (เว้นว่างได้เช่นกัน) */
export const OPEN_AGE = 100;
const ageTxt = (a, b) => (b == null || +b >= OPEN_AGE ? `${yr(a)} ปีขึ้นไป (ไม่จำกัด)` : `${yr(a)}–${yr(b)} ปี`);

/* ---------- อ่านข้อความฉลาก (quote) ---------- */
const UNIT_RE = '(mg|mcg|µg|micrograms?|milligrams?|g|grams?)';
const toUnit = (v, u, i) => {   // ค่าจากฉลาก → หน่วยของข้อบ่งใช้ (มก. หรือ mcg)
  const w = /^(mcg|µg|micro)/i.test(u) ? 'mcg' : /^g/i.test(u) ? 'g' : 'mg';
  const mg = w === 'mcg' ? v / 1000 : w === 'g' ? v * 1000 : v;
  return i.unit === 'mcg' ? mg * 1000 : mg;
};
const same = (a, b) => Math.abs(a - b) <= Math.max(EPS, Math.abs(b) * 0.001);
const DAYISH = /^\s*(?:\/\s*(?:day|d)\b|per\s+day|a\s+day|\/\s*24\s*h|per\s+24|(?:daily\s+)?(?:given\s+)?(?:in|into)\s+(?:\d+|two|three|four|five|six|divided)|divided|daily)/i;
const DOSEISH = /^\s*(?:\/\s*dose|per\s+dose|each\s+dose|(?:orally\s+)?every\s+\d|q\s*\d|once\s+(?:daily|a\s+day)|twice|three\s+times|four\s+times|as\s+a\s+single)/i;
/** ขนาดยาในข้อความ: [{ a, b, kg, kind: 'day'|'dose'|null }] (a/b แปลงเป็นหน่วยของข้อบ่งใช้แล้ว) */
export function quoteDoses(q, i) {
  const out = [], re = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)(?:\\s*(?:-|–|to)\\s*(\\d[\\d,]*(?:\\.\\d+)?))?\\s*${UNIT_RE}\\b(\\s*(?:\\/|per)\\s*kg(?:\\s+of\\s+body\\s+weight)?)?`, 'gi');
  let m;
  while ((m = re.exec(String(q || '')))) {
    const tail = String(q).slice(re.lastIndex, re.lastIndex + 45);
    const kg = !!m[4];
    let kind = null;
    if (kg ? DAYISH.test(tail) && !/^\s*once\s+(?:daily|a\s+day)/i.test(tail) : /^\s*(?:\/\s*(?:day|d)\b|per\s+day|a\s+day|\/\s*24\s*h|per\s+24)/i.test(tail)) kind = 'day';
    else if (DOSEISH.test(tail)) kind = 'dose';
    out.push({ a: toUnit(num(m[1]), m[3], i), b: toUnit(num(m[2] ?? m[1]), m[3], i), kg, kind });
  }
  return out;
}
const MAXW = '(?:max(?:imum)?|not\\s+(?:to\\s+)?exceed(?:ing)?|up\\s+to|no\\s+more\\s+than|should\\s+not\\s+exceed|do\\s+not\\s+exceed|ไม่เกิน|สูงสุด)';
/** ขนาดสูงสุดต่อวันที่ฉลากเขียนไว้ (หน่วยของข้อบ่งใช้) หรือ null */
export function quoteDayMax(q, i) {
  const s = String(q || '');
  const a = new RegExp(`${MAXW}[^.;]{0,50}?(\\d[\\d,]*(?:\\.\\d+)?)\\s*${UNIT_RE}\\b(?!\\s*(?:\\/|per)\\s*kg)\\s*(?:(?:\\/|per|a|in)\\s*(?:day|24\\s*h(?:ours?)?)|daily|\\/\\s*วัน|ต่อวัน)`, 'i').exec(s)
    || new RegExp(`max(?:imum)?\\s+(?:total\\s+)?daily\\s+(?:dose|dosage|amount)[^.;]{0,30}?(\\d[\\d,]*(?:\\.\\d+)?)\\s*${UNIT_RE}\\b(?!\\s*(?:\\/|per)\\s*kg)`, 'i').exec(s)
    || new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*${UNIT_RE}\\b\\s*(?:\\/|per)\\s*day\\s*\\(?\\s*max(?:imum)?`, 'i').exec(s);
  return a ? toUnit(num(a[1]), a[2], i) : null;
}
/** ขนาดสูงสุดต่อครั้งที่ฉลากเขียนไว้ หรือ null */
export function quoteDoseMax(q, i) {
  const a = new RegExp(`${MAXW}[^.;]{0,40}?(\\d[\\d,]*(?:\\.\\d+)?)\\s*${UNIT_RE}\\b(?!\\s*(?:\\/|per)\\s*kg)\\s*(?:\\/|per)\\s*dose`, 'i').exec(String(q || ''));
  return a ? toUnit(num(a[1]), a[2], i) : null;
}
const WORDN = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
/** จำนวนครั้งต่อวันที่ข้อความบอก (ฉลาก + ความถี่) → Set หรือ null (ไม่ได้บอก) */
export function freqHints(text) {
  const s = String(text || ''), out = new Set();
  const span = (lo, hi) => { for (let n = Math.round(24 / hi); n <= Math.round(24 / lo); n++) if (n >= 1 && n <= 12) out.add(n); };
  for (const m of s.matchAll(/every\s+(\d+(?:\.\d+)?)(?:\s*(?:-|–|to|or)\s*(\d+(?:\.\d+)?))?\s*h(?:ours?|rs?)?\b/gi)) { const a = +m[1], b = +(m[2] ?? m[1]); if (a > 0 && b > 0 && a <= 24 && b <= 24) span(Math.min(a, b), Math.max(a, b)); }
  for (const m of s.matchAll(/\bq\s*(\d+)(?:\s*-\s*(\d+))?\s*h\b/gi)) { const a = +m[1], b = +(m[2] ?? m[1]); if (a > 0 && b > 0 && a <= 24 && b <= 24) span(Math.min(a, b), Math.max(a, b)); }
  for (const m of s.matchAll(/ทุก\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*(?:ชั่วโมง|ชม)/g)) { const a = +m[1], b = +(m[2] ?? m[1]); if (a > 0 && b > 0 && a <= 24 && b <= 24) span(Math.min(a, b), Math.max(a, b)); }
  if (/once\s+(?:daily|a\s+day)|\bq\.?d\.?\b|single\s+daily\s+dose/i.test(s)) out.add(1);
  if (/twice\s+(?:daily|a\s+day)|two\s+times\s+(?:daily|a\s+day)|\bb\.?i\.?d\b/i.test(s)) out.add(2);
  if (/three\s+times\s+(?:daily|a\s+day)|\bt\.?i\.?d\b/i.test(s)) out.add(3);
  if (/four\s+times\s+(?:daily|a\s+day)|\bq\.?i\.?d\b/i.test(s)) out.add(4);
  for (const m of s.matchAll(/(?:in|into)\s+(\d|one|two|three|four|five|six)(?:\s*(?:to|or|-)\s*(\d|two|three|four|five|six))?\s+(?:equally\s+)?divided\s+doses/gi)) {
    const a = WORDN[m[1].toLowerCase()] ?? +m[1], b = m[2] ? WORDN[m[2].toLowerCase()] ?? +m[2] : a;
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) out.add(n);
  }
  for (const m of s.matchAll(/วันละ\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:ครั้ง|มื้อ)/g)) { const a = +m[1], b = +(m[2] ?? m[1]); for (let n = Math.min(a, b); n <= Math.max(a, b); n++) out.add(n); }
  return out.size ? out : null;
}
/** ช่วงอายุที่เขียนในชื่อข้อบ่งใช้ เช่น "0–3 เดือน", "2–5 ปี", "อายุ 12 ปีขึ้นไป" → { min, max, step } (ปี) หรือ null */
export function nameAge(name) {
  const s = String(name || '');
  const UNITS = [[/^(ปี|years?|yrs?|y)$/i, 1], [/^(เดือน|months?|mos?)$/i, 1 / 12], [/^(สัปดาห์|weeks?|wks?)$/i, 7 / 365], [/^(วัน|days?)$/i, 1 / 365]];
  const uOf = (u) => UNITS.find(([re]) => re.test(u))?.[1];
  let m = /(\d+(?:\.\d+)?)\s*(?:-|–|ถึง|to)\s*(?:<\s*)?(\d+(?:\.\d+)?)\s*(ปี|years?|yrs?|เดือน|months?|mos?|สัปดาห์|weeks?|วัน|days?)(?![a-zก-๙])/i.exec(s);
  // วัน/สัปดาห์ในชื่อมักเป็นระยะเวลาให้ยา (เช่น "ให้ 5–14 วัน") → นับเป็นอายุเฉพาะเมื่อมีคำว่าอายุ/ทารกนำหน้า
  if (m && /^(วัน|days?|สัปดาห์|weeks?)$/i.test(m[3]) && !/(อายุ|ทารก|age|newborn|neonat)\S*\s*$/i.test(s.slice(Math.max(0, m.index - 14), m.index))) m = null;
  if (m) { const f = uOf(m[3]); return { min: +m[1] * f, max: +m[2] * f, step: f }; }
  m = /(\d+(?:\.\d+)?)\s*(?:\+\s*)?(ปี|years?|เดือน|months?)\s*(?:ขึ้นไป|and\s+(?:over|older)|or\s+older)/i.exec(s) || /(\d+(?:\.\d+)?)\s*\+\s*(ปี|years?|เดือน|months?)/i.exec(s);   // "6 ปีขึ้นไป" · "6+ ปี"
  if (m) return { min: +m[1] * uOf(m[2]), max: null, step: uOf(m[2]) };
  m = /(?:≥|>=|อายุ\s*ตั้งแต่|ตั้งแต่|อายุ)\s*(\d+(?:\.\d+)?)\s*(ปี|years?|เดือน|months?)\s*(?:ขึ้นไป|and\s+(?:over|older)|or\s+older)?/i.exec(s);
  if (m && (/≥|>=|ตั้งแต่/.test(m[0]) || /ขึ้นไป|over|older/i.test(m[0]))) return { min: +m[1] * uOf(m[2]), max: null, step: uOf(m[2]) };
  m = /(?:<|ต่ำกว่า|น้อยกว่า|under|younger\s+than|less\s+than)\s*(\d+(?:\.\d+)?)\s*(ปี|years?|เดือน|months?)/i.exec(s);
  if (m) return { min: 0, max: +m[1] * uOf(m[2]), step: 0 };
  return null;
}

/* ---------- ขนาดสูงสุดที่ได้จริง (มก.) สำหรับเทียบเด็กกับผู้ใหญ่ — สูตรเดียวกับ doseNumbers (ช่วงบน) ---------- */
const toMg = (i, v) => (i.unit === 'mcg' ? v / 1000 : v);
const timesOf = (i) => [i.times, ...(i.times_alt || [])].map(Number).filter((t) => t >= 1);
/** ขนาดสูงสุดต่อครั้ง/ต่อวัน (มก.) ของข้อบ่งใช้ i ที่น้ำหนัก w · ไม่รู้ = null */
export function topMg(i, w) {
  if (!(typeof i.max === 'number' && i.max > 0)) return { dose: null, day: null };
  const base = i.fixed ? i.max : i.max * w;
  let dose, day;
  if (i.per === 'day') {
    const ts = timesOf(i); if (!ts.length) return { dose: null, day: null };
    day = +i.cap_day > 0 ? Math.min(base, +i.cap_day) : base;
    dose = day / Math.min(...ts);
    if (+i.cap > 0) dose = Math.min(dose, +i.cap);
  } else {
    dose = +i.cap > 0 ? Math.min(base, +i.cap) : base;
    day = +i.cap_day > 0 ? +i.cap_day : null;
  }
  return { dose: toMg(i, dose), day: day == null ? null : toMg(i, day) };
}
/** น้ำหนักตัวอย่างสูงสุดของช่วงอายุเด็ก (ตามเกณฑ์น้ำหนักเด็กโดยประมาณ) */
const childWeights = (i) => { const b = i.age_max != null ? +i.age_max : ADULT_AGE; return b <= 1 ? [3, 10] : b <= 2 ? [5, 15] : b <= 6 ? [10, 25] : b <= 12 ? [15, 45] : [20, 60]; };
const isAdult = (i) => i.age_min != null && +i.age_min >= ADULT_AGE;

/** เพดานที่คิดได้จากขนาดที่กรอกเอง (เฉพาะขนาดคงที่ · ขนาดสูงสุดคือเพดานอยู่แล้ว)
 *  ต่อวัน (แบ่งให้): วันละ ≤ max · ครั้งละ ≤ max ÷ จำนวนครั้งน้อยสุดที่เลือก (เช่น 50–150 มก./วัน แบ่ง 2 ครั้ง → ครั้งละ ≤ 75)
 *  ต่อครั้ง: ครั้งละ ≤ max · วันละ = คิดไม่ได้ (ขึ้นกับความถี่ เช่น ทุก 4–6 ชม. ต้องใช้เพดานต่อวันจากฉลาก)
 *  คิดตามน้ำหนัก (มก./กก.) = คิดไม่ได้ → null (ต้องใช้เพดานจากฉลาก หรือขนาดผู้ใหญ่) */
export function autoCaps(i) {
  if (!i?.fixed || !(typeof i.max === 'number' && i.max > 0)) return null;
  if (i.per === 'day') { const ts = timesOf(i); return { cap_day: i.max, cap: ts.length ? +(i.max / Math.min(...ts)).toFixed(3) : null, times: ts.length ? Math.min(...ts) : null }; }
  return { cap: i.max, cap_day: null, times: null };
}

/* ---------- กฎรายข้อบ่งใช้ ---------- */
/** ปัญหาของข้อบ่งใช้ i (ไม่ดูข้ออื่น) → [{ sev, code, text }] */
export function indRules(i) {
  const out = [], add = (sev, code, text, fix) => out.push({ sev, code, text, ...(fix ? { fix } : {}) });
  if (!i || typeof i !== 'object') return out;
  const q = String(i.quote || ''), hasNum = typeof i.min === 'number' && typeof i.max === 'number';
  // ① ช่วงอายุ: ทุกข้อต้องระบุ (ทุกอายุ = ตั้งแต่ 0 ปี) · ชื่อบอกอายุ = ช่องอายุต้องตรงกัน
  const na = nameAge(i.name);
  if (i.age_min == null) {
    add('fail', 'age_req', na ? `ชื่อข้อบ่งใช้ระบุอายุ (${String(i.name).trim()}) แต่ยังไม่ได้ใส่ช่วงอายุในช่องที่ระบบใช้กรอง · ใส่ "อายุตั้งแต่ … ถึงก่อน … ปี"`
      : 'ยังไม่ระบุช่วงอายุ · ต้องบอกว่าใช้กับอายุเท่าไร (ใช้ได้ทุกอายุ = ตั้งแต่ 0 ปี · ผู้ใหญ่ เช่น ตั้งแต่ 12 ปี)');
  } else if (na) {
    const okMin = same(+i.age_min, na.min) || Math.abs(+i.age_min - na.min) < 0.01;
    const okMax = na.max == null ? i.age_max == null || +i.age_max >= OPEN_AGE : i.age_max != null && (Math.abs(+i.age_max - na.max) < 0.01 || Math.abs(+i.age_max - (na.max + na.step)) < 0.01);
    if (!okMin || !okMax) add('fail', 'age_name', `ชื่อข้อบ่งใช้บอกอายุ ${ageTxt(na.min, na.max)} แต่ช่องอายุเป็น ${ageTxt(+i.age_min, i.age_max)} · แก้ช่องอายุให้ตรงชื่อ (กดปุ่มด้านล่าง) หรือแก้ชื่อข้อบ่งใช้`,
      { age_min: +(+na.min).toFixed(2), age_max: na.max == null ? null : +(+na.max).toFixed(2) });
  }
  if (!hasNum) return out;
  // ② เพดาน: คิดตามน้ำหนักต้องมีเพดานชนิดเดียวกับขนาดยา · ครั้งละต้องไม่มากกว่าวันละ
  if (!i.fixed && i.per === 'dose' && !(+i.cap > 0)) add('fail', 'cap_req', 'ขนาดตามน้ำหนักต่อครั้ง ต้องมีขนาดสูงสุดต่อครั้ง (ครั้งละไม่เกิน) · กันเด็กโต/ผู้ใหญ่ได้ยาเกินขนาด');
  if (!i.fixed && i.per === 'day' && !(+i.cap_day > 0)) {
    add('fail', 'capday_req', +i.cap > 0
      ? `ขนาดตามน้ำหนักต่อวัน ต้องมีขนาดสูงสุดต่อวัน (วันละไม่เกิน) · ตอนนี้มีแต่ "ครั้งละไม่เกิน ${nf(+i.cap)} ${U(i)}" ถ้าตัวเลขนี้คือเพดานต่อวันตามฉลาก ให้ย้ายไปช่อง "วันละไม่เกิน"`
      : 'ขนาดตามน้ำหนักต่อวัน ต้องมีขนาดสูงสุดต่อวัน (วันละไม่เกิน) · กันเด็กโต/ผู้ใหญ่ได้ยาเกินขนาด');
  }
  if (+i.cap > 0 && +i.cap_day > 0 && +i.cap > +i.cap_day + EPS) add('fail', 'cap_order', `ครั้งละไม่เกิน (${nf(+i.cap)}) มากกว่าวันละไม่เกิน (${nf(+i.cap_day)}) · ตรวจว่าใส่สลับช่องหรือไม่`);
  // ขนาดคงที่: เพดานคิดจากขนาดที่กรอกได้ → ช่องเพดานที่ไม่ตรง = ไม่มีผล (มากกว่า) หรือตัดขนาดที่กรอก (น้อยกว่า) · เสนอค่าที่คิดให้
  const ac = autoCaps(i);
  if (ac) {
    const how = i.per === 'day' ? `${nf(i.max)} ÷ ${ac.times} ครั้ง` : `ขนาดสูงสุด ${nf(i.max)}`;
    const fixCaps = { ...(ac.cap != null ? { cap: ac.cap } : {}), ...(ac.cap_day != null ? { cap_day: ac.cap_day } : {}) };
    const lbl = `ใช้เพดานที่คิดจากขนาด (${[ac.cap != null ? `ครั้งละ ≤ ${nf(ac.cap)}` : '', ac.cap_day != null ? `วันละ ≤ ${nf(ac.cap_day)}` : ''].filter(Boolean).join(' · ')} ${U(i)})`;
    if (ac.cap != null && +i.cap > ac.cap + EPS) add('warn', 'cap_split', `ครั้งละไม่เกิน ${nf(+i.cap)} ${U(i)} มากกว่าที่ให้ได้จริง (${how} = ${nf(ac.cap)} ${U(i)}) · ช่องนี้ไม่มีผล ใส่ค่าที่คิดให้เพื่อไม่ให้สับสน`, { ...fixCaps, label: lbl });
    else if (ac.cap_day != null && +i.cap_day > ac.cap_day + EPS) add('warn', 'cap_split', `วันละไม่เกิน ${nf(+i.cap_day)} ${U(i)} มากกว่าขนาดสูงสุดต่อวันที่กรอก (${nf(ac.cap_day)} ${U(i)}) · ช่องนี้ไม่มีผล`, { ...fixCaps, label: lbl });
    if ((ac.cap != null && +i.cap > 0 && +i.cap < ac.cap - EPS) || (ac.cap_day != null && +i.cap_day > 0 && +i.cap_day < ac.cap_day - EPS)) {
      add('warn', 'cap_below', `เพดานน้อยกว่าขนาดสูงสุดที่กรอก (${how} = ${nf(ac.cap ?? ac.cap_day)} ${U(i)}) · หน้าคำนวณจะตัดที่เพดาน ตรวจว่าขนาดสูงสุดหรือเพดานถูกต้อง`);
    }
  }
  // ③ ข้อความฉลาก: ต่อครั้ง/ต่อวัน · เพดาน · จำนวนครั้ง ต้องตรงกัน
  if (!q.trim()) add('warn', 'quote_none', 'ยังไม่มีข้อความอ้างอิงจากฉลาก/ตำรา (ที่มา) · ใส่เพื่อให้ตรวจย้อนได้ หรือให้ AI หาพร้อมลิงก์');
  else {
    const hits = quoteDoses(q, i).filter((x) => x.kg === !i.fixed && (same(x.a, i.min) || same(x.b, i.max) || same(x.a, i.max) || same(x.b, i.min)));
    const kinds = new Set(hits.map((x) => x.kind).filter(Boolean));
    if (kinds.size === 1) {
      if (kinds.has('day') && i.per !== 'day') add('fail', 'per_day', `ข้อความฉลากเป็นขนาดต่อวัน (${nf(i.min)}–${nf(i.max)} ${U(i)}${i.fixed ? '' : '/กก.'}/วัน) แต่บันทึกเป็น "ต่อครั้ง" · เปลี่ยนเป็นต่อวันและระบุวันละกี่ครั้ง`);
      if (kinds.has('dose') && i.per === 'day') add('fail', 'per_dose', 'ข้อความฉลากเป็นขนาดต่อครั้ง แต่บันทึกเป็น "ต่อวัน (แบ่งให้)" · ตรวจว่าตัวเลขเป็นต่อครั้งหรือต่อวัน');
    }
    const dMax = quoteDayMax(q, i);
    if (dMax != null) {
      if (!(+i.cap_day > 0) && +i.cap > 0 && same(+i.cap, dMax)) add('fail', 'cap_is_day', `ฉลากระบุขนาดสูงสุด ${nf(dMax)} ${U(i)}/วัน แต่ตัวเลขนี้อยู่ในช่อง "ครั้งละไม่เกิน" · ย้ายไปช่อง "วันละไม่เกิน"`);
      else if (!(+i.cap_day > 0)) add('fail', 'capday_quote', `ฉลากระบุขนาดสูงสุด ${nf(dMax)} ${U(i)}/วัน แต่ยังไม่ได้ใส่ช่อง "วันละไม่เกิน"`);
      else if (+i.cap_day > dMax + EPS) add('fail', 'capday_over', `วันละไม่เกิน ${nf(+i.cap_day)} ${U(i)} มากกว่าที่ฉลากระบุ (${nf(dMax)} ${U(i)}/วัน)`);
    }
    const pMax = quoteDoseMax(q, i);
    if (pMax != null && +i.cap > pMax + EPS) add('fail', 'cap_over', `ครั้งละไม่เกิน ${nf(+i.cap)} ${U(i)} มากกว่าที่ฉลากระบุ (${nf(pMax)} ${U(i)}/ครั้ง)`);
  }
  if (i.per === 'day') {
    const ts = timesOf(i), txt = `${q} ${i.freq || ''}`;
    if (ts.length && Math.max(...ts) < 2 && (/divided|in\s+(?:2|3|4|two|three|four)\s+doses/i.test(q) || /แบ่ง/.test(i.freq || ''))) {
      add('fail', 'divided', 'ฉลาก/ความถี่บอกให้แบ่งให้หลายครั้งต่อวัน (divided doses) แต่บันทึกวันละ 1 ครั้ง · ระบุวันละกี่ครั้งตามฉลาก');
    } else {
      const h = freqHints(txt);
      if (h && ts.length && !ts.some((t) => h.has(t))) add('fail', 'times', `ฉลาก/ความถี่บอกวันละ ${[...h].sort((a, b) => a - b).join(' หรือ ')} ครั้ง แต่บันทึกวันละ ${ts.join(' หรือ ')} ครั้ง`);
    }
  }
  // ④ ช่วงขนาดกว้างผิดปกติ = อาจรวมหลายข้อบ่งใช้/หลายช่วงอายุไว้ในข้อเดียว
  if (i.min > 0 && i.max / i.min > 4 + EPS) add('warn', 'wide', `ช่วงขนาดยากว้าง ${+(i.max / i.min).toFixed(1)} เท่า (${nf(i.min)}–${nf(i.max)}) · ตรวจว่าไม่ได้รวมหลายข้อบ่งใช้/หลายช่วงอายุไว้ในข้อเดียว`);
  return out;
}

/* ---------- กฎทั้งยา (ดูทุกข้อบ่งใช้รวมกัน) ---------- */
/** ปัญหาของทุกข้อบ่งใช้ → [{ k (ลำดับข้อ), sev, code, text, cross }] · cross = กฎที่ต้องดูข้ออื่นด้วย (ช่วงอายุขาดตอน · เด็กเกินผู้ใหญ่) */
export function drugRules(inds) {
  const list = Array.isArray(inds) ? inds : [], out = [];
  list.forEach((i, k) => indRules(i).forEach((x) => out.push({ k, ...x })));
  // ⑤ ช่วงอายุขาดตอน (เช่น 2–5 แล้ว 6–12 → อายุ 5.5 ปี ไม่มีขนาดยา) · ช่วง = ตั้งแต่ age_min ถึงก่อน age_max
  const bands = list.map((i, k) => ({ k, a: i?.age_min, b: i?.age_max })).filter((x) => x.a != null).map((x) => ({ k: x.k, a: +x.a, b: x.b == null ? Infinity : +x.b })).sort((x, y) => x.a - y.a || x.b - y.b);
  let end = null, endK = null;
  for (const x of bands) {
    if (end != null && Number.isFinite(end) && x.a > end + EPS) {
      const gap = x.a - end;
      if (gap <= 1 + EPS) out.push({ k: x.k, sev: 'fail', code: 'age_gap', cross: true, text: `ช่วงอายุขาดตอน ${yr(end)}–${yr(x.a)} ปี (เช่น อายุ ${yr(end + gap / 2)} ปี จะไม่มีขนาดยา) · ระบบใช้ช่วง "ตั้งแต่…ถึงก่อน…" เช่น 2–6 ปี แล้ว 6–12 ปี`,
        fix: { k: endK, age_max: +(+x.a).toFixed(2), label: `ต่อช่วงอายุข้อก่อนหน้าเป็น "ถึงก่อน ${yr(x.a)} ปี"` } });
      else out.push({ k: x.k, sev: 'warn', code: 'age_gap_wide', cross: true, text: `ไม่มีขนาดยาสำหรับอายุ ${yr(end)}–${yr(x.a)} ปี (หน้าคำนวณจะแจ้งว่าไม่มีข้อมูลสำหรับอายุนี้) · ตรวจว่าตั้งใจหรือไม่` });
    }
    if (end == null || x.b > end) { end = x.b; endK = x.k; }
  }
  // ⑥ เด็กห้ามได้ยามากกว่าผู้ใหญ่: ขนาดตามน้ำหนักของข้อเด็ก (ที่น้ำหนักสูงสุดของช่วงอายุ) ≤ ขนาดสูงสุดของข้อผู้ใหญ่
  const adults = list.filter((i) => i && isAdult(i));
  const aDose = Math.max(-Infinity, ...adults.map((i) => topMg(i, 70).dose).filter((x) => x != null));
  const aDay = Math.max(-Infinity, ...adults.map((i) => topMg(i, 70).day).filter((x) => x != null));
  if (adults.length) {   // เด็กตามน้ำหนักที่ยังไม่มีเพดาน → เสนอขนาดผู้ใหญ่สูงสุดของยานี้เป็นเพดาน (ผู้ดูแลกดใช้เอง)
    const inU = (i, v) => +(i.unit === 'mcg' ? v * 1000 : v).toFixed(3);
    for (const x of out) {
      const i = list[x.k]; if (!i || isAdult(i)) continue;
      if (x.code === 'cap_req' && Number.isFinite(aDose)) x.fix = { cap: inU(i, aDose), label: `ใช้ขนาดผู้ใหญ่สูงสุดเป็นเพดาน (ครั้งละ ≤ ${nf(inU(i, aDose))} ${U(i)})` };
      if (x.code === 'capday_req' && Number.isFinite(aDay)) x.fix = { cap_day: inU(i, aDay), label: `ใช้ขนาดผู้ใหญ่สูงสุดเป็นเพดาน (วันละ ≤ ${nf(inU(i, aDay))} ${U(i)})` };
    }
    list.forEach((i, k) => {
      if (!i || isAdult(i) || i.fixed || typeof i.max !== 'number') return;
      for (const w of childWeights(i)) {
        const t = topMg(i, w);
        if (Number.isFinite(aDose) && t.dose != null && t.dose > aDose * 1.001) {
          out.push({ k, sev: 'fail', code: 'child_over', cross: true, text: `เด็กน้ำหนัก ${w} กก. ได้สูงสุด ${nf(t.dose)} มก./ครั้ง มากกว่าขนาดผู้ใหญ่สูงสุดของยานี้ (${nf(aDose)} มก./ครั้ง) · เด็กต้องไม่ได้ยามากกว่าผู้ใหญ่ ใส่ "ครั้งละไม่เกิน"` }); break;
        }
        if (Number.isFinite(aDay) && t.day != null && t.day > aDay * 1.001) {
          out.push({ k, sev: 'fail', code: 'child_over_day', cross: true, text: `เด็กน้ำหนัก ${w} กก. ได้สูงสุด ${nf(t.day)} มก./วัน มากกว่าขนาดผู้ใหญ่สูงสุดของยานี้ (${nf(aDay)} มก./วัน) · ใส่ "วันละไม่เกิน"` }); break;
        }
      }
    });
  }
  return out;
}
/** ข้อบ่งใช้ที่ไม่ผ่านกฎ (fail) → Map(ลำดับข้อ → [ข้อความ]) · หน้าคำนวณไม่แสดงตัวเลขของข้อเหล่านี้ */
export function blockedInds(inds) {
  const m = new Map();
  for (const x of drugRules(inds)) if (x.sev === 'fail') m.set(x.k, [...(m.get(x.k) || []), x.text]);
  return m;
}
/** ข้อความกฎสำหรับส่งให้ AI (ให้ค่าที่เสนอผ่านกฎเดียวกัน) */
export const RULES_TEXT = 'ทุกข้อต้องมี age_min (ปี · ทุกอายุ = 0 · ผู้ใหญ่ เช่น 12) และ age_max เมื่อมีอายุสิ้นสุด (ช่วงแบบ "ตั้งแต่ age_min ถึงก่อน age_max" เช่น 2–6 แล้ว 6–12 ห้ามเว้นช่วง)'
  + ' · คิดตามน้ำหนักแบบ per "dose" ต้องมี cap (สูงสุดต่อครั้ง) · แบบ per "day" ต้องมี cap_day (สูงสุดต่อวัน) และ times (วันละกี่ครั้ง)'
  + ' · ฉลากเขียน mg/kg/day หรือ daily/divided = per "day" · ฉลากเขียน every 6 hours = times 4, every 8 hours = 3, every 12 hours = 2'
  + ' · เพดานต่อวันที่ฉลากเขียน (maximum … mg/day) ใส่ cap_day ห้ามใส่ cap · cap ต้องไม่มากกว่า cap_day · ขนาดเด็กต้องไม่เกินขนาดผู้ใหญ่';
