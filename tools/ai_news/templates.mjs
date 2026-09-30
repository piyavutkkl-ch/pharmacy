// แม่แบบภาพประกอบข่าว AI 3 แบบ (HTML → Chromium ถ่ายภาพเป็น JPEG) — ตัวหนังสือไทยพิมพ์ด้วยฟอนต์จริง จึงไม่เพี้ยนแบบภาพวาด AI
//   infographic(d, art)  ภาพที่ 1 อินโฟกราฟิกสำหรับประชาชน (A4 แนวตั้ง 1240×1754)
//   comic(d, arts)       ภาพที่ 2 การ์ตูน 3 ช่อง (A4 แนวนอน 1754×1240)
//   clinical(d)          ภาพที่ 3 แผนภูมิ + ตารางสำหรับบุคลากร (กว้าง 1240 · สูงตามเนื้อหา 1240–1754)
//   art = data URL ภาพวาดจาก AI (ถ้ามี) · ไม่มี = ใช้อีโมจิ/ลายกราฟิกแทน
export const SIZES = { infographic: [1240, 1754], comic: [1754, 1240], clinical: [1240, 1754] };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FONT = '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600;700&display=swap" rel="stylesheet">';
const BASE = `*{box-sizing:border-box;margin:0;padding:0}html,body{width:100%;height:100%}
body{font-family:'IBM Plex Sans Thai','Noto Sans Thai','Tlwg Typist',sans-serif;color:#16313f;-webkit-font-smoothing:antialiased}
.brand{font-size:22px;font-weight:600;letter-spacing:.02em;opacity:.85}`;
const page = (css, body) => `<!doctype html><html lang="th"><head><meta charset="utf-8">${FONT}<style>${BASE}${css}</style></head><body>${body}</body></html>`;
const BRAND = process.env.AI_NEWS_BRAND || 'งานเภสัชกรรมปฐมภูมิ · โรงพยาบาลควนกาหลง';   // หน้าตัวอย่างใช้ชื่อสมมติ (tools/preview/build.py)

/** ภาพที่ 1: อินโฟกราฟิก (Slate Blue & Teal + Coral) */
export function infographic(d, art = '') {
  const pts = (d.points || []).slice(0, 4);
  return page(`
body{background:linear-gradient(160deg,#e9f7f5 0%,#f5fbff 55%,#fff4ef 100%);padding:70px 76px;display:flex;flex-direction:column;gap:34px}
.top{display:flex;justify-content:space-between;align-items:center;color:#2d5a73}
.pill{background:#1f8a84;color:#fff;border-radius:999px;padding:10px 26px;font-size:24px;font-weight:600}
h1{font-size:74px;line-height:1.18;color:#1d3b53;font-weight:700}
.sub{font-size:34px;line-height:1.5;color:#2f6f7f}
.hero{height:470px;border-radius:40px;overflow:hidden;background:radial-gradient(circle at 30% 30%,#bfeee8,#8fc9e6 60%,#6f9ec9);display:grid;place-items:center;box-shadow:0 20px 50px rgba(29,59,83,.18)}
.hero img{width:100%;height:100%;object-fit:cover}
.hero .emo{font-size:230px;filter:drop-shadow(0 12px 18px rgba(0,0,0,.18))}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:26px;flex:1}
.card{background:#fff;border-radius:30px;padding:30px 32px;box-shadow:0 10px 30px rgba(29,59,83,.1);border-top:10px solid #1f8a84;display:flex;flex-direction:column;gap:12px}
.card:nth-child(2n){border-top-color:#f28c6f}
.card .e{font-size:58px;line-height:1}
.card h3{font-size:34px;color:#1d3b53;line-height:1.3}
.card p{font-size:27px;line-height:1.55;color:#34566a}
.note{background:#1d3b53;color:#e8f6f4;border-radius:26px;padding:24px 32px;font-size:26px;line-height:1.5}`,
  `<div class="top"><span class="brand">${esc(BRAND)}</span><span class="pill">ความรู้เรื่องยา</span></div>
<div><h1>${esc(d.headline)}</h1><p class="sub">${esc(d.subhead)}</p></div>
<div class="hero">${art ? `<img src="${art}" alt="">` : `<span class="emo">${esc(d.hero_emoji || '💊')}</span>`}</div>
<div class="grid">${pts.map((p) => `<div class="card"><span class="e">${esc(p.emoji || '✅')}</span><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></div>`).join('')}</div>
<div class="note">${esc(d.note || 'ปรึกษาเภสัชกรหรือแพทย์ก่อนใช้ยาทุกครั้ง')}</div>`);
}

/** ภาพที่ 2: การ์ตูน 3 ช่อง (โทนสีน้ำอบอุ่น + ลายเส้นหมึก) */
export function comic(d, arts = []) {
  const panels = (d.panels || []).slice(0, 3);
  return page(`
body{background:#fbf3e4;padding:56px 60px;display:flex;flex-direction:column;gap:28px}
.top{display:flex;justify-content:space-between;align-items:baseline;color:#6b4a2b}
h1{font-size:54px;color:#3d2a18}
.row{display:grid;grid-template-columns:repeat(3,1fr);gap:30px;flex:1}
.p{position:relative;background:#fffdf8;border:6px solid #2b2118;border-radius:18px;box-shadow:8px 8px 0 #2b2118;display:flex;flex-direction:column;overflow:hidden}
.n{position:absolute;top:14px;left:14px;background:#2b2118;color:#fbf3e4;width:52px;height:52px;border-radius:50%;display:grid;place-items:center;font-size:28px;font-weight:700;z-index:2}
.scene{flex:1;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,#ffe9c7,#f6d3a8 60%,#e9b98a);min-height:0}
.p:nth-child(2) .scene{background:radial-gradient(circle at 50% 40%,#d9f3ff,#a9d8f0 60%,#7fb8de)}
.p:nth-child(3) .scene{background:radial-gradient(circle at 50% 40%,#e2fbe4,#b6e8bd 60%,#87cf98)}
.scene img{width:100%;height:100%;object-fit:cover}
.scene .emo{font-size:150px;letter-spacing:6px}
.bubble{position:absolute;left:20px;right:20px;top:84px;background:#fff;border:4px solid #2b2118;border-radius:28px;padding:18px 22px;font-size:30px;line-height:1.4;font-weight:600;color:#2b2118;box-shadow:4px 4px 0 rgba(43,33,24,.25)}
.cap{background:#2b2118;color:#fbf3e4;padding:18px 22px;font-size:26px;line-height:1.45;min-height:150px}`,
  `<div class="top"><h1>${esc(d.title || 'การ์ตูนชวนรู้เรื่องยา')}</h1><span class="brand">${esc(BRAND)}</span></div>
<div class="row">${panels.map((p, i) => `<div class="p"><span class="n">${i + 1}</span>
<div class="scene">${arts[i] ? `<img src="${arts[i]}" alt="">` : `<span class="emo">${esc(p.emoji || '💊')}</span>`}</div>
${p.speech ? `<div class="bubble">“${esc(p.speech)}”</div>` : ''}<div class="cap">${esc(p.caption)}</div></div>`).join('')}</div>`);
}

/** ภาพที่ 3: แผนภูมิการตัดสินใจ + ตารางเปรียบเทียบ (มินิมอล อ่านเร็ว) */
export function clinical(d) {
  const flow = (d.flow || []).slice(0, 6), t = d.table || {}, cols = (t.columns || []).slice(0, 4), rows = (t.rows || []).slice(0, 7);
  return page(`
html,body{height:auto}
body{background:#f7fafc;padding:64px 70px;display:flex;flex-direction:column;gap:30px;color:#1c2b36}
.top{display:flex;justify-content:space-between;align-items:center;color:#4a6272}
.tag{border:2px solid #3b6e8f;color:#3b6e8f;border-radius:999px;padding:8px 22px;font-size:22px;font-weight:600}
h1{font-size:54px;line-height:1.25;color:#17324a}
h2{font-size:30px;color:#3b6e8f;letter-spacing:.02em;margin-bottom:14px}
.flow{display:flex;flex-direction:column;gap:0}
.step{display:grid;grid-template-columns:64px 1fr;gap:20px;align-items:start}
.dot{width:64px;height:64px;border-radius:18px;background:#17324a;color:#fff;display:grid;place-items:center;font-size:30px;font-weight:700}
.step:nth-child(odd) .dot{background:#1f8a84}
.box{background:#fff;border:2px solid #dbe6ee;border-radius:18px;padding:16px 22px}
.box b{display:block;font-size:28px;line-height:1.35}
.box span{display:block;font-size:24px;line-height:1.5;color:#4a6272;margin-top:4px}
.arrow{margin-left:26px;height:22px;border-left:4px solid #b9ccd9}
table{width:100%;border-collapse:separate;border-spacing:0;background:#fff;border:2px solid #dbe6ee;border-radius:18px;overflow:hidden;font-size:23px;line-height:1.4}
th{background:#17324a;color:#fff;text-align:left;padding:14px 16px;font-weight:600}
td{padding:12px 16px;border-top:1px solid #e6eef4;vertical-align:top}
tr:nth-child(even) td{background:#f3f8fb}
.notes{font-size:22px;line-height:1.55;color:#4a6272}
.notes li{margin-left:28px}`,
  `<div class="top"><span class="brand">${esc(BRAND)}</span><span class="tag">สำหรับบุคลากรทางการแพทย์</span></div>
<h1>${esc(d.title)}</h1>
${flow.length ? `<section><h2>แนวทางการตัดสินใจ</h2><div class="flow">${flow.map((s, i) => `${i ? '<div class="arrow"></div>' : ''}<div class="step"><span class="dot">${i + 1}</span><div class="box"><b>${esc(s.step)}</b>${s.detail ? `<span>${esc(s.detail)}</span>` : ''}</div></div>`).join('')}</div></section>` : ''}
${cols.length && rows.length ? `<section><h2>${esc(t.caption || 'ตารางสรุป')}</h2><table><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${cols.map((_, j) => `<td>${esc((r || [])[j] ?? '')}</td>`).join('')}</tr>`).join('')}</table></section>` : ''}
${(d.notes || []).length ? `<ul class="notes">${d.notes.slice(0, 4).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`);
}
