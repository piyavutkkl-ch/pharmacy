// กราฟการเจริญเติบโตของเด็ก (สำนักโภชนาการ กรมอนามัย 2564) ในหน้าคำนวณขนาดยา — จุดแดงตามอายุ/น้ำหนัก/ส่วนสูงที่กรอก
//   0–5 ปี (WHO 2006): น้ำหนักตามอายุ · ความยาว/ส่วนสูงตามอายุ · น้ำหนักตามความยาว (0–2 ปี) / ส่วนสูง (2–5 ปี)
//   6–19 ปี (เกณฑ์เด็กไทย 2563): ส่วนสูงตามอายุ · น้ำหนักตามส่วนสูง · ภาพ + ตำแหน่งแกนจาก tools/growth/charts.py (js/growth-charts.js)
import { esc } from '../util.js?v=4.4';
import { GROWTH_CHARTS } from '../growth-charts.js?v=4.4';

let pick = '';   // กราฟที่ผู้ใช้เลือกล่าสุด (kind)
const chartOf = (sex, kind) => GROWTH_CHARTS.find((c) => c.sex === sex && c.kind === kind);

/** กราฟที่ใช้ได้กับค่าที่กรอก · months = อายุ (เดือน) หรือ null · w กก. · h ซม. */
export function growthOptions({ months, w, h, sex }) {
  const out = [], add = (kind, label, x, y) => { const c = chartOf(sex, kind); if (c) out.push({ c, kind, label, x, y }); };
  if (months != null && months > 228) return out;   // เกิน 19 ปี = ผู้ใหญ่
  if (months == null) {
    if (w > 0 && h > 0) add(h < 65 ? 'wfl' : h <= 120 ? 'wfh' : 'wfh619', 'น้ำหนักตามส่วนสูง', h, w);
  } else if (months < 72) {
    if (w > 0) add('wfa', 'น้ำหนักตามอายุ', months, w);
    if (h > 0) add('hfa', months < 24 ? 'ความยาวตามอายุ' : 'ส่วนสูงตามอายุ', months, h);
    if (w > 0 && h > 0) add(months < 24 ? 'wfl' : 'wfh', months < 24 ? 'น้ำหนักตามความยาว' : 'น้ำหนักตามส่วนสูง', h, w);
  } else {
    if (h > 0) add('hfa619', 'ส่วนสูงตามอายุ', months, h);
    if (w > 0 && h > 0) add('wfh619', 'น้ำหนักตามส่วนสูง', h, w);
  }
  return out;
}

/** ตำแหน่งจุด (สัดส่วนของภาพ 0–1) · ค่านอกกราฟ = ชิดขอบ + out */
export function dotOf(c, x, y) {
  const s = c.segs.find((g) => x >= g.x[0] && x <= g.x[1]) || (x < c.segs[0].x[0] ? c.segs[0] : c.segs[c.segs.length - 1]);
  const cx = Math.min(Math.max(x, s.x[0]), s.x[1]), cy = Math.min(Math.max(y, s.y[0]), s.y[1]);
  return { left: s.ax * cx + s.bx, top: s.ay * cy + s.by, out: cx !== x || cy !== y };
}

const pct = (v) => `${(v * 100).toFixed(2)}%`;
const fmt = (v) => (Math.round(v * 10) / 10).toLocaleString('th-TH');
function ageText(m) { const y = Math.floor(m / 12), r = Math.round(m - y * 12); return y ? `${y} ปี${r ? ` ${r} เดือน` : ''}` : `${r} เดือน`; }

/** วาดกราฟลงใน box (ไม่มีค่าที่ใช้ได้ = ซ่อน/บอกสิ่งที่ต้องกรอกเพิ่ม) */
export function renderGrowth(box, v) {
  const opts = growthOptions(v);
  if (!opts.length) {
    const kid = v.months == null ? v.w > 0 || v.h > 0 : v.months <= 228 && (v.w > 0 || v.h > 0);
    box.innerHTML = kid ? `<p class="small muted">${v.months == null ? 'ใส่อายุ (หรือทั้งน้ำหนักและส่วนสูง) เพื่อดูกราฟการเจริญเติบโต' : 'เด็กอายุ 6–19 ปี ใช้กราฟส่วนสูง · ใส่ส่วนสูงเพื่อดูกราฟการเจริญเติบโต'}</p>` : '';
    box.hidden = !kid; return;
  }
  box.hidden = false;
  const o = opts.find((x) => x.kind === pick) || opts[0], d = dotOf(o.c, o.x, o.y);
  const what = o.kind.startsWith('w') && o.kind !== 'wfa'
    ? `ส่วนสูง ${fmt(o.x)} ซม. · น้ำหนัก ${fmt(o.y)} กก.`
    : `อายุ ${ageText(o.x)} · ${o.kind === 'wfa' ? `น้ำหนัก ${fmt(o.y)} กก.` : `ส่วนสูง ${fmt(o.y)} ซม.`}`;
  const tabs = opts.length > 1 ? `<div class="unit-tabs gc-tabs" role="group" aria-label="เลือกกราฟ">${opts.map((x) => `<button type="button" data-gc="${x.kind}" aria-current="${x === o}">${esc(x.label)}</button>`).join('')}</div>` : '';
  const same = box.querySelector(`.gc-fig[data-id="${o.c.id}"]`);
  if (same && box.querySelectorAll('.gc-tabs button').length === opts.length) {   // กราฟเดิม: ขยับจุดอย่างเดียว (ภาพไม่กระพริบ)
    const dot = same.querySelector('.gc-dot');
    dot.style.left = pct(d.left); dot.style.top = pct(d.top); dot.classList.toggle('out', d.out);
    same.querySelector('.gc-what').textContent = what + (d.out ? ' (อยู่นอกช่วงกราฟ)' : '');
    return;
  }
  box.innerHTML = `<div class="gc-head"><b>กราฟการเจริญเติบโต · ${esc(o.c.title)} · เพศ${o.c.sex === 'f' ? 'หญิง' : 'ชาย'}</b></div>${tabs}`
    + `<figure class="gc-fig" data-id="${o.c.id}"><div class="gc-wrap"><img src="${o.c.img}" width="${o.c.w}" height="${o.c.h}" alt="${esc(o.c.title)} เพศ${o.c.sex === 'f' ? 'หญิง' : 'ชาย'}">`
    + `<span class="gc-dot${d.out ? ' out' : ''}" style="left:${pct(d.left)};top:${pct(d.top)}" aria-hidden="true"></span></div>`
    + `<figcaption class="small"><span class="gc-what">${esc(what)}${d.out ? ' (อยู่นอกช่วงกราฟ)' : ''}</span> · จุดแดง = เด็กคนนี้ · <a href="${o.c.img}" target="_blank" rel="noopener">เปิดภาพใหญ่</a>`
    + '<br><span class="muted">ที่มา: สำนักโภชนาการ กรมอนามัย พ.ศ. 2564 (0–5 ปี ตามมาตรฐาน WHO 2006 · 6–19 ปี ตามเกณฑ์อ้างอิงเด็กไทย 2563)</span></figcaption></figure>';
  box.onclick = (e) => { const b = e.target.closest('[data-gc]'); if (b) { pick = b.dataset.gc; box.innerHTML = ''; renderGrowth(box, v); } };
}
