// คำนวณสารน้ำ (#dosePaneFluid): เตรียม Dextrose ความเข้มข้นที่ไม่มีในคลัง จากถุงที่มี + 50% Dextrose (+ 3% NaCl ถ้าต้องการเพิ่มเกลือ)
//   วิธีที่ 1 (แนะนำ): ดูดออกก่อนแล้วเติม → ปริมาตรเท่าเดิม · วิธีที่ 2: เติมโดยไม่ดูดออก → ปริมาตรเพิ่ม · ปรับ NaCl ด้วย = แก้สมการ 2 ตัวแปร (50%D a มล. + 3% NaCl b มล.)
//   แต่ละขั้นมีภาพประกอบ (SVG วาดในหน้า) · ท้ายช่อง = ตารางเตรียมน้ำเกลือที่ใช้บ่อย (คำนวณด้วยสูตรเดียวกัน)
import { $, esc } from '../util.js?v=4.4';

const D50 = 50, NACL_ADD = 3;   // % ของยาที่ใช้เติม
const NAME = { 0: 'W', 0.9: 'S', 0.45: 'N/2', 0.3: 'N/3', 0.225: 'N/4', 0.18: 'N/5' };
const nLabel = (n) => NAME[+(+n).toFixed(3)] ?? `NaCl ${fmt(n, 3)}%`;
const fmt = (x, dp = 1) => String(+(+x).toFixed(dp));
const bagName = (d, n) => `${+d ? `${fmt(d)}%D` : 'น้ำเกลือ'}${+n ? ` - ${nLabel(n)}` : +d ? ' - W' : ' (W)'}`;
const syr = (ml) => (ml > 50 ? ` (syringe 50 มล. ${Math.ceil(ml / 50)} ครั้ง)` : '');

/** วิธีที่ 1: ดูดออก x แล้วเติม 50%D x · ปริมาตรคงเดิม */
export function method1(d1, d2, n, v) {
  const x = Math.round(((d2 - d1) * v) / (D50 - d1));
  return { x, vol: v, d: (D50 * x + d1 * (v - x)) / v, n: (n * (v - x)) / v };
}
/** วิธีที่ 2: เติม 50%D y โดยไม่ดูดออก · ปริมาตรเพิ่มเป็น v + y */
export function method2(d1, d2, n, v) {
  const y = Math.round(((d2 - d1) * v) / (D50 - d2)), vol = v + y;
  return { y, vol, d: (D50 * y + d1 * v) / vol, n: (n * v) / vol };
}
/** ปรับทั้ง Dextrose และ NaCl: ดูดออก a+b แล้วเติม 50%D a + 3% NaCl b (ปริมาตรคงเดิม) · null = ทำไม่ได้ */
export function methodNaCl(d1, d2, n1, n2, v) {
  const E = (d2 - d1) * v, F = (n2 - n1) * v, det = (D50 - d1) * (NACL_ADD - n1) - d1 * n1;
  if (!det) return null;
  const a = Math.round((E * (NACL_ADD - n1) + d1 * F) / det), b = Math.round(((D50 - d1) * F + n1 * E) / det);
  if (a < 0 || b < 0 || a + b >= v) return null;
  const rest = v - a - b;
  return { a, b, out: a + b, vol: v, d: (D50 * a + d1 * rest) / v, n: (NACL_ADD * b + n1 * rest) / v };
}

/* ---------- ภาพประกอบขั้นตอน (SVG) ---------- */
function bagSvg(level, label) {
  const top = 30 + (1 - Math.max(0.15, Math.min(1, level))) * 70;
  return `<svg class="fx-svg" viewBox="0 0 120 150" role="img" aria-label="${esc(label)}"><rect x="52" y="4" width="16" height="10" rx="3" class="fx-line"/>`
    + `<path d="M24 14h72a8 8 0 0 1 8 8v86a12 12 0 0 1-12 12H28a12 12 0 0 1-12-12V22a8 8 0 0 1 8-8z" class="fx-line"/>`
    + `<path d="M18 ${top}h84v70a10 10 0 0 1-10 10H28a10 10 0 0 1-10-10z" class="fx-fill"/><path d="M54 120h12v18H54z" class="fx-line"/>`
    + `<text x="60" y="66" class="fx-t">${esc(label)}</text></svg>`;
}
function syringeSvg(ml, what, out) {
  return `<svg class="fx-svg" viewBox="0 0 150 110" role="img" aria-label="${esc(`${out ? 'ดูดออก' : 'เติม'} ${what} ${ml} มล.`)}">`
    + '<rect x="30" y="30" width="80" height="26" rx="4" class="fx-line"/><rect x="34" y="34" width="44" height="18" rx="2" class="fx-fill"/>'
    + '<path d="M110 43h22M8 43h22M8 33v20" class="fx-line"/><path d="M78 30v26" class="fx-line"/>'
    + (out ? '<path d="M120 70 H40 m10 -8 l-10 8 l10 8" class="fx-arrow"/>' : '<path d="M30 70 H110 m-10 -8 l10 8 l-10 8" class="fx-arrow"/>')
    + `<text x="75" y="98" class="fx-t">${out ? 'ดูดออก' : 'เติม'} ${ml} มล.</text></svg>`;
}
const mixSvg = (label) => '<svg class="fx-svg" viewBox="0 0 120 150" role="img" aria-label="ผสมให้เข้ากัน">'
  + bagSvg(0.85, label).replace(/^<svg[^>]*>|<\/svg>$/g, '')
  + '<path d="M6 60a40 40 0 0 1 20-34m-8 0 8 0 0 8M114 90a40 40 0 0 1-20 34m8 0-8 0 0-8" class="fx-arrow"/></svg>';
const step = (n, svg, title, text) => `<li class="fx-step"><div class="fx-pic">${svg}</div><div><b>${n}. ${title}</b><p class="small">${text}</p></div></li>`;

function card(title, rec, steps, result, warn) {
  return `<section class="mono-card fx-card"><h4>${title}${rec ? ' <span class="chip c-on">แนะนำ</span>' : ''}</h4><ol class="fx-steps">${steps.join('')}</ol>`
    + `<p class="fx-res">${result}</p>${warn}</section>`;
}
const peripheralWarn = (d) => (d > 12.5 + 1e-9 ? '<p class="small fx-warn">Dextrose เกิน 12.5% ควรให้ทางหลอดเลือดดำใหญ่ (central line) · ระวังหลอดเลือดอักเสบเมื่อให้ทางหลอดเลือดส่วนปลาย</p>' : '');

export function renderFluid() {
  const d1 = +$('#fxD1').value, n1 = +$('#fxN1').value, v = Math.round(+$('#fxV').value), d2 = +$('#fxD2').value, nSel = $('#fxN2').value;
  const out = $('#fxOut');
  renderTable(n1);
  if (!(v > 0) || !(d2 >= 0)) { out.innerHTML = '<p class="small muted">กรอกปริมาตรถุงและความเข้มข้นที่ต้องการ</p>'; return; }
  if (d2 >= D50) { out.innerHTML = '<p class="small fx-warn">Dextrose ที่ต้องการต้องน้อยกว่า 50%</p>'; return; }
  const from = bagName(d1, n1), n2 = nSel === 'same' ? n1 : +nSel;
  const to = bagName(d2, n2);
  const head = `<p class="fx-goal"><b>${esc(from)} ${v} มล.</b> → <b>${esc(to)}</b></p>`;
  if (nSel !== 'same' && Math.abs(n2 - n1) > 1e-9) {
    const m = methodNaCl(d1, d2, n1, n2, v);
    if (!m) { out.innerHTML = head + '<p class="small fx-warn">ทำไม่ได้ด้วยวิธีเติม 50%D + 3% NaCl (เช่น ต้องการเกลือน้อยกว่าถุงเดิม หรือ Dextrose ต่ำกว่าเดิม) · เลือกถุงตั้งต้นอื่น</p>'; return; }
    out.innerHTML = head + card('เติม 50% Dextrose และ 3% NaCl', true, [
      step(1, bagSvg(1, `${fmt(d1)}%D`), 'เตรียมถุง', `${esc(from)} ${v} มล.`),
      step(2, syringeSvg(m.out, 'น้ำเกลือ', true), 'ดูดน้ำเกลือออก', `ดูดออก <b>${m.out} มล.</b>${syr(m.out)} ทิ้ง`),
      step(3, syringeSvg(m.a, '50% Dextrose', false), 'เติม 50% Dextrose', `เติม <b>${m.a} มล.</b>${syr(m.a)}`),
      step(4, syringeSvg(m.b, '3% NaCl', false), 'เติม 3% NaCl', `เติม <b>${m.b} มล.</b>${syr(m.b)}`),
      step(5, mixSvg(`${fmt(m.d)}%D`), 'ผสมให้เข้ากัน + ติดฉลาก', 'พลิกถุงกลับไปมา 5–10 ครั้ง · ติดฉลากชื่อสารน้ำ วันเวลาที่เตรียม และผู้เตรียม'),
    ], `ได้ Dextrose <b>${fmt(m.d, 2)}%</b> · NaCl <b>${fmt(m.n, 3)}%</b> (${esc(nLabel(+m.n.toFixed(3)))}) · ปริมาตร ${v} มล.`, peripheralWarn(m.d));
    return;
  }
  if (d2 <= d1) { out.innerHTML = head + '<p class="small fx-warn">ความเข้มข้นที่ต้องการต้องมากกว่าถุงที่มี (วิธีนี้ใช้เพิ่มความเข้มข้นด้วย 50% Dextrose)</p>'; return; }
  const a = method1(d1, d2, n1, v), b = method2(d1, d2, n1, v);
  out.innerHTML = head
    + card('วิธีที่ 1 ดูดน้ำเกลือออกก่อน แล้วเติม 50% Dextrose', true, [
      step(1, bagSvg(1, `${fmt(d1)}%D`), 'เตรียมถุง', `${esc(from)} ${v} มล.`),
      step(2, syringeSvg(a.x, 'น้ำเกลือ', true), 'ดูดน้ำเกลือออก', `ดูดออก <b>${a.x} มล.</b>${syr(a.x)} ทิ้ง`),
      step(3, syringeSvg(a.x, '50% Dextrose', false), 'เติม 50% Dextrose', `เติม <b>${a.x} มล.</b>${syr(a.x)} (เท่ากับที่ดูดออก)`),
      step(4, mixSvg(`${fmt(a.d)}%D`), 'ผสมให้เข้ากัน + ติดฉลาก', 'พลิกถุงกลับไปมา 5–10 ครั้ง · ติดฉลากชื่อสารน้ำ วันเวลาที่เตรียม และผู้เตรียม'),
    ], `ได้ Dextrose <b>${fmt(a.d, 2)}%</b> · NaCl ${fmt(a.n, 3)}% · ปริมาตร <b>${v} มล.</b> (เท่าเดิม)`, peripheralWarn(a.d))
    + card('วิธีที่ 2 เติม 50% Dextrose โดยไม่ดูดออก', false, [
      step(1, bagSvg(0.85, `${fmt(d1)}%D`), 'เตรียมถุง', `${esc(from)} ${v} มล.`),
      step(2, syringeSvg(b.y, '50% Dextrose', false), 'เติม 50% Dextrose', `เติม <b>${b.y} มล.</b>${syr(b.y)}`),
      step(3, mixSvg(`${fmt(b.d)}%D`), 'ผสมให้เข้ากัน + ติดฉลาก', 'พลิกถุงกลับไปมา 5–10 ครั้ง · ติดฉลาก'),
    ], `ได้ Dextrose <b>${fmt(b.d, 2)}%</b> · NaCl ${fmt(b.n, 3)}% · ปริมาตรรวม <b>${b.vol} มล.</b> (ถุงต้องจุได้)`, peripheralWarn(b.d) + '<p class="small muted">เกลือจะจางลงเล็กน้อยเพราะปริมาตรเพิ่ม</p>');
}

/* ---------- ตารางเตรียมน้ำเกลือที่ใช้บ่อย (ถุง 1000 มล. · ชนิดเกลือตามถุงที่เลือก) ---------- */
const ROWS1 = [[7.5, 5], [10, 5], [12.5, 5], [12.5, 10], [15, 10], [17.5, 10], [20, 10]];
const ROWS2 = [[7.5, 5], [10, 5], [12.5, 5], [12.5, 10], [15, 10]];
function renderTable(n) {
  const nl = +n ? ` - ${nLabel(n)}` : '';
  const row = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  $('#fxTable').innerHTML = `<p class="small muted">ชนิดเกลือตามถุงที่เลือกด้านบน (${esc(+n ? nLabel(n) : 'W')}) · ปริมาตร 50%D ปัดเป็นจำนวนเต็มเพื่อดูดด้วย syringe</p>`
    + `<h5>วิธีที่ 1 ดูดน้ำเกลือออกก่อน แล้วเติม 50% Dextrose (ได้ปริมาตรรวม 1000 มล.)</h5><div class="table-wrap"><table class="fx-tbl"><thead><tr><th>ที่ต้องการ</th><th>ถุงที่ใช้ผสม</th><th>ดูดออก</th><th>เติม 50%D</th><th>% Dextrose จริง</th></tr></thead><tbody>`
    + ROWS1.map(([d2, d1]) => { const m = method1(d1, d2, n, 1000); return row([`${fmt(d2)}%D${nl}`, `${d1}%D${nl}`, `${m.x} มล.`, `${m.x} มล.`, `${fmt(m.d, 2)}%`]); }).join('')
    + '</tbody></table></div>'
    + `<h5>วิธีที่ 2 เติม 50% Dextrose โดยไม่ดูดออก</h5><div class="table-wrap"><table class="fx-tbl"><thead><tr><th>ที่ต้องการ</th><th>ถุงที่ใช้ผสม</th><th>เติม 50%D</th><th>ปริมาตรรวม</th><th>% Dextrose จริง</th></tr></thead><tbody>`
    + ROWS2.map(([d2, d1]) => { const m = method2(d1, d2, n, 1000); return row([`${fmt(d2)}%D${nl}`, `${d1}%D${nl}`, `${m.y} มล.`, `${m.vol} มล.`, `${fmt(m.d, 2)}%`]); }).join('')
    + '</tbody></table></div>'
    + '<p class="small muted">ใช้ได้กับน้ำเกลือชนิดอื่น (D-S, D-N/3, D-N/4, D-N/5) ด้วยวิธีเดียวกัน · รูปแบบตารางอ้างอิงจาก "วิธีการเตรียมน้ำเกลือความเข้มข้นที่ไม่มีในบัญชียาโรงพยาบาล"</p>';
}

let bound = false;
export function initFluid() {
  if (!bound) {
    bound = true;
    ['#fxD1', '#fxN1', '#fxN2'].forEach((s) => $(s).addEventListener('change', renderFluid));
    ['#fxV', '#fxD2'].forEach((s) => $(s).addEventListener('input', renderFluid));
  }
  renderFluid();
}
