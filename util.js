// ตัวช่วยทั่วไป — ใช้ esc() กับทุกข้อความที่มาจากผู้ใช้/ฐานข้อมูลก่อนใส่ใน innerHTML เสมอ
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** ปีงบประมาณ (พ.ศ.) — เริ่ม 1 ต.ค. เช่น 1 ต.ค. 2569 = ปีงบ 2570 (ตรงกับ public.fiscal_year_of ในฐานข้อมูล) */
export function fiscalYearOf(d = new Date()) {
  const date = d instanceof Date ? d : new Date(d);
  return date.getFullYear() + 543 + (date.getMonth() >= 9 ? 1 : 0);
}

/** วันที่แบบไทย เช่น 26 ก.ย. 2569 */
export function thaiDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return ''; }
}

export function initials(name) {
  const p = String(name || '').trim().split(/\s+/);
  return ((p[0] || '')[0] || '') + ((p[1] || '')[0] || '');
}

let toastTimer = null;
/** ข้อความแจ้งผลสั้น ๆ มุมล่างจอ */
export function toast(text, kind = 'ok') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.className = 'toast' + (kind === 'err' ? ' err' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'err' ? 6000 : 3000);
}

/** ปุ่มระหว่างรอ: ปิดปุ่มกันกดซ้ำ + เปลี่ยนข้อความ */
export function busy(btn, on, text) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; if (text) btn.textContent = text; }
  else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
}

/** แปลง error ของ Supabase เป็นข้อความไทยที่อ่านเข้าใจ */
export function errText(error) {
  if (!error) return '';
  const m = error.message || String(error);
  if (/duplicate key|already exists/i.test(m)) return 'มีข้อมูลนี้อยู่แล้ว';
  if (/row-level security|permission denied/i.test(m)) return 'ไม่มีสิทธิ์ทำรายการนี้';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'เชื่อมต่อไม่ได้ กรุณาตรวจอินเทอร์เน็ต';
  return m;
}

/** ภาพประกอบ SVG เมื่อข่าว/ผลงานไม่มีรูป */
export function art(kind) {
  let o = '<svg viewBox="0 0 640 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">';
  if (kind === 'อบรม') {
    o += '<rect class="a-bg2" width="640" height="400"/><rect class="a-sheet" x="170" y="78" width="300" height="190" rx="14"/>'
      + '<circle class="a-s" cx="320" cy="173" r="38"/><polygon class="a-sheet" points="309,153 309,193 341,173"/>'
      + '<rect class="a-s" x="130" y="276" width="380" height="18" rx="9"/><circle class="a-p" cx="540" cy="100" r="10" opacity=".35"/>';
  } else if (kind === 'visit') {
    o += '<rect class="a-bg2" width="640" height="400"/><circle class="a-p" cx="100" cy="80" r="54" opacity=".12"/><circle class="a-s" cx="560" cy="330" r="46" opacity=".14"/>'
      + '<polygon class="a-s" points="320,66 466,182 174,182"/><rect class="a-sheet" x="200" y="182" width="240" height="168" rx="8"/>'
      + '<rect class="a-p" x="296" y="266" width="48" height="84" rx="4"/><rect class="a-line" x="222" y="204" width="46" height="40" rx="4"/><rect class="a-line" x="372" y="204" width="46" height="40" rx="4"/>'
      + '<circle class="a-ok" cx="320" cy="240" r="34"/><polyline class="a-mark" points="303,240 316,253 340,224"/>';
  } else if (kind === 'รายงาน') {
    o += '<rect class="a-bg3" width="640" height="400"/><rect class="a-sheet" x="150" y="60" width="340" height="280" rx="18"/>'
      + '<rect class="a-line" x="186" y="296" width="268" height="4" rx="2"/><rect class="a-p" x="200" y="220" width="36" height="76" rx="6"/><rect class="a-p" x="256" y="186" width="36" height="110" rx="6"/>'
      + '<rect class="a-p" x="312" y="200" width="36" height="96" rx="6"/><rect class="a-p" x="368" y="150" width="36" height="146" rx="6"/>'
      + '<polyline class="a-stroke" points="218,176 274,142 330,156 386,108 430,92"/><circle class="a-s" cx="430" cy="92" r="9"/>';
  } else {
    o += '<rect class="a-bg1" width="640" height="400"/><circle class="a-p" cx="110" cy="90" r="46" opacity=".12"/><circle class="a-p" cx="560" cy="330" r="70" opacity=".1"/>'
      + '<rect class="a-sheet" x="222" y="58" width="196" height="276" rx="16"/><rect class="a-p" x="222" y="58" width="196" height="46" rx="16"/><rect class="a-p" x="222" y="84" width="196" height="20"/>'
      + '<rect class="a-line" x="250" y="130" width="140" height="10" rx="5"/><rect class="a-line" x="250" y="158" width="110" height="10" rx="5"/><rect class="a-line" x="250" y="186" width="140" height="10" rx="5"/>'
      + '<circle class="a-ok" cx="410" cy="306" r="40"/><polyline class="a-mark" points="392,306 405,319 429,294"/>';
  }
  return o + '</svg>';
}
