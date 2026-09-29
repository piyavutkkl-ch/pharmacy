// โหมดมืด/สว่าง (ปุ่มขวาบน) — จำค่าที่เลือกไว้ในเครื่อง (localStorage 'pcps_theme') · ยังไม่เลือก = ตามการตั้งค่าของเครื่อง
// ค่าที่จำไว้ถูกใส่ตั้งแต่ <head> ของ index.html (กันจอกะพริบ) · สีทั้งหมดอยู่ที่ :root[data-theme] ใน app.css
import { $ } from './util.js?v=4.4';

const KEY = 'pcps_theme';
const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
export const isDark = () => (document.documentElement.dataset.theme || (systemDark() ? 'dark' : 'light')) === 'dark';

function label() {
  const btn = $('#themeBtn'); if (!btn) return;
  const dark = isDark();
  btn.setAttribute('aria-label', dark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด');
  btn.title = dark ? 'โหมดสว่าง' : 'โหมดมืด';
  btn.setAttribute('aria-pressed', String(dark));
}

export function bindTheme() {
  const btn = $('#themeBtn'); if (!btn) return;
  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch {}
    label();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', label);
  label();
}
