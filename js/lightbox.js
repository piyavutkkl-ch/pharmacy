// แสดงรูปแบบฉลาด + กดขยายดูภาพเต็ม (ใช้ในหน้าอ่านข่าว / สรุปผลงานเยี่ยมบ้าน)
//   smartCover(box, src, alt): สัดส่วนใกล้เคียง A4 (แนวตั้ง–จัตุรัส–แนวนอน) → แสดงทั้งภาพไม่ครอบตัด
//                              ยาว/กว้างกว่า A4 มาก → ครอบตัดให้พอดีกรอบ A4 (แนวตั้งหรือแนวนอน) แต่กดดูภาพเต็มได้
//   imageCarousel(box, srcs, alt): หลายภาพ → เลื่อน/ปัดซ้าย-ขวา + ปุ่ม ‹ › + ตัวนับ (ภาพเดียว = smartCover ตามเดิม)
//   openLightbox(src, alt):    ภาพเต็มจอ · กดที่ภาพ = สลับดูขนาดจริง (เลื่อนดูได้) · ปิดด้วย Esc/ปุ่ม/คลิกพื้นหลัง
import { esc } from './util.js?v=4.4';

const A4 = Math.SQRT2;                  // 1.414 (ยาว/กว้าง)
const MIN = (1 / A4) * 0.85, MAX = A4 * 1.15;   // ช่วงที่ถือว่า "ใกล้เคียง A4" ≈ 0.60–1.63 (กว้าง/สูง)
const ZOOM_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/></svg>';

/** กรอบรูปที่ปรับสัดส่วนตามภาพ · คืน Promise ที่ resolve เป็น 'fit' | 'crop-tall' | 'crop-wide' เมื่อโหลดภาพแล้ว */
export function smartCover(box, src, alt = '') {
  box.classList.add('smart');
  box.classList.remove('fit', 'crop-tall', 'crop-wide');
  box.innerHTML = `<button type="button" class="cover-img" aria-label="ขยายดูภาพเต็ม"><img src="${esc(src)}" alt="${esc(alt)}"></button>`
    + `<button type="button" class="zoom-btn" aria-label="ขยายดูภาพเต็ม">${ZOOM_SVG}<span>ขยายภาพ</span></button>`;
  const img = box.querySelector('img');
  box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => openLightbox(src, alt)));
  return new Promise((resolve) => {
    const done = () => {
      const r = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : A4;
      const mode = r < MIN ? 'crop-tall' : r > MAX ? 'crop-wide' : 'fit';
      box.classList.add(mode);
      box.style.setProperty('--ar', String(mode === 'crop-tall' ? 1 / A4 : mode === 'crop-wide' ? A4 : r));
      box.classList.toggle('portrait', mode === 'crop-tall' || (mode === 'fit' && r < 1));
      resolve(mode);
    };
    if (img.complete && img.naturalWidth) done();
    else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', () => resolve('error'), { once: true }); }
  });
}

/** หลายภาพในกรอบเดียว: ภาพหลักอยู่กลาง ภาพข้าง ๆ โผล่ซ้าย-ขวาแบบจาง/เบลอ (บอกว่ามีหลายภาพ)
 *  กด ‹ › / กดภาพข้าง / ปัด / ลูกศรคีย์บอร์ด = เปลี่ยนภาพ · กดภาพกลาง = ขยายเต็มจอ (smartCover) */
export function imageCarousel(box, srcs, alt = '') {
  const list = srcs.filter(Boolean);
  if (list.length <= 1) return list.length ? smartCover(box, list[0], alt) : Promise.resolve(null);
  box.className = 'carousel'; box.removeAttribute('style');
  box.innerHTML = `<div class="car-track" tabindex="0" role="group" aria-roledescription="carousel" aria-label="${esc(alt)} · ${list.length} ภาพ เลื่อนซ้าย-ขวาได้">`
    + list.map((_, i) => `<div class="car-slide" aria-label="ภาพที่ ${i + 1} จาก ${list.length}"><div class="cover"></div></div>`).join('') + '</div>'
    + '<button type="button" class="car-btn prev" aria-label="ภาพก่อนหน้า">‹</button><button type="button" class="car-btn next" aria-label="ภาพถัดไป">›</button>'
    + `<div class="car-dots">${list.map((_, i) => `<button type="button" data-i="${i}" aria-label="ไปภาพที่ ${i + 1}"></button>`).join('')}</div><span class="car-n num" aria-live="polite"></span>`;
  const track = box.querySelector('.car-track'), slides = [...track.children];
  let at = 0;
  const cur = () => {   // ภาพที่อยู่กลางกรอบมากที่สุด
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = 0, dist = Infinity;
    slides.forEach((sl, i) => { const d = Math.abs(sl.offsetLeft + sl.offsetWidth / 2 - mid); if (d < dist) { dist = d; best = i; } });
    return best;
  };
  const go = (i, smooth = true) => {
    const sl = slides[Math.max(0, Math.min(list.length - 1, i))];
    track.scrollTo({ left: sl.offsetLeft - (track.clientWidth - sl.offsetWidth) / 2, behavior: smooth ? 'smooth' : 'auto' });
  };
  const show = () => {
    at = cur();
    box.querySelector('.car-n').textContent = `${at + 1}/${list.length}`;
    slides.forEach((sl, k) => { sl.classList.toggle('on', k === at); sl.setAttribute('aria-hidden', String(k !== at)); });
    box.querySelectorAll('.car-dots button').forEach((d, k) => d.classList.toggle('on', k === at));
    box.querySelector('.prev').disabled = at === 0; box.querySelector('.next').disabled = at === list.length - 1;
  };
  box.querySelector('.prev').addEventListener('click', () => go(at - 1));
  box.querySelector('.next').addEventListener('click', () => go(at + 1));
  box.querySelector('.car-dots').addEventListener('click', (e) => { const d = e.target.closest('[data-i]'); if (d) go(+d.dataset.i); });
  slides.forEach((sl, i) => sl.addEventListener('click', (e) => { if (i !== at) { e.preventDefault(); e.stopPropagation(); go(i); } }, true));   // ภาพข้าง = เลื่อนมากลาง (ยังไม่ขยาย)
  track.addEventListener('scroll', show, { passive: true });
  track.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1); } if (e.key === 'ArrowRight') { e.preventDefault(); go(at + 1); } });
  const ready = Promise.all(slides.map((sl, i) => smartCover(sl.firstChild, list[i], `${alt} — ภาพที่ ${i + 1}`)));
  requestAnimationFrame(() => { go(0, false); show(); });
  ready.then(() => { go(at, false); show(); });   // ขนาดภาพเปลี่ยนหลังโหลด → จัดภาพปัจจุบันกลางกรอบอีกครั้ง
  return ready;
}

let dlg = null;
export function openLightbox(src, alt = '') {
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.className = 'lightbox';
    dlg.setAttribute('aria-label', 'ภาพขนาดเต็ม');
    dlg.innerHTML = '<div class="lb-bar"><span class="small lb-hint">กดที่ภาพเพื่อดูขนาดจริง</span><button type="button" class="btn btn-o btn-sm lb-close">ปิด ✕</button></div><div class="lb-body"><img alt=""></div>';
    document.body.appendChild(dlg);
    dlg.querySelector('.lb-close').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.classList.contains('lb-body')) dlg.close(); });
    dlg.querySelector('img').addEventListener('click', () => {
      const full = dlg.classList.toggle('actual');
      dlg.querySelector('.lb-hint').textContent = full ? 'ขนาดจริง · เลื่อนดูได้ · กดที่ภาพเพื่อย่อให้พอดีจอ' : 'กดที่ภาพเพื่อดูขนาดจริง';
    });
  }
  dlg.classList.remove('actual');
  dlg.querySelector('.lb-hint').textContent = 'กดที่ภาพเพื่อดูขนาดจริง';
  const img = dlg.querySelector('img');
  img.src = src; img.alt = alt;
  if (!dlg.open) dlg.showModal();
}
