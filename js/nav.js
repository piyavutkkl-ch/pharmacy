// เมนูด้านข้าง (จอใหญ่) / เมนูล่างจอ (มือถือ) — ปุ่ม "เพิ่มเติม" เปิดเมนูที่เหลือบนมือถือ
import { $$ } from './util.js?v=4.3.1';

export function closeMoreSheets() {
  $$('.sidenav.more-open').forEach((n) => { n.classList.remove('more-open'); n.querySelector('.more-btn')?.setAttribute('aria-expanded', 'false'); });
}

/** ทำเครื่องหมายเมนูที่เลือก (attr เช่น 'data-admin-tab') */
export function setCurrent(attr, value) {
  $$(`[${attr}]`).forEach((a) => { if (a.getAttribute(attr) === value) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  closeMoreSheets();
}

export function bindMoreSheets() {
  $$('.sidenav .more-btn').forEach((btn) => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const nav = btn.closest('.sidenav'), open = !nav.classList.contains('more-open');
    closeMoreSheets();
    if (open) { nav.classList.add('more-open'); btn.setAttribute('aria-expanded', 'true'); nav.querySelector('.more-group a')?.focus(); }
  }));
  document.addEventListener('click', (e) => { if (!e.target.closest('.more-group')) closeMoreSheets(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMoreSheets(); });
}
