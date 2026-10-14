// หมวดหมู่ข่าวตามเนื้อหา (54_news_topics.sql): news_topics + news.topic_ids (≤ 3)
//   ผู้ดูแล › ข่าว: กล่อง "หมวดหมู่ข่าวตามเนื้อหา" เพิ่ม/ลบหมวด · เปิดหน้าแล้ว AI (Gemini ฟรี) จัดหมวดข่าวที่ยังไม่มีหมวดให้เอง (ai_news_topics_start/poll)
//   ฟอร์มแก้ไขข่าว (an): ติ๊กหมวดเอง · รายการข่าว/หน้าข่าวทั้งหมด: ป้ายหมวด + กรองตามหมวด
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, errText, busy } from '../util.js?v=4.4';

export const MAX_TOPICS = 3;
let topics = null, loading = null;
export function loadTopics(force = false) {
  if (topics && !force) return Promise.resolve(topics);
  if (!loading || force) {
    loading = sb.from('news_topics').select('id,name,sort').order('sort').order('id')
      .then(({ data, error }) => { loading = null; topics = error ? [] : data || []; return topics; });
  }
  return loading;
}
const known = (ids) => (ids || []).map((id) => (topics || []).find((t) => t.id === id)).filter(Boolean);
export const topicChips = (ids) => known(ids).map((t) => `<span class="chip c-sub nt-chip">${esc(t.name)}</span>`).join('');
export const hasTopic = (n) => known(n.topic_ids).length > 0;
/** ตัวเลือกกรองหมวด: all = ทุกหมวด · none = ยังไม่มีหมวด · <id> */
export function topicOptions(sel, withNone = false) {
  const cur = sel.value || 'all';
  sel.innerHTML = '<option value="all">ทุกหมวดเนื้อหา</option>' + (topics || []).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')
    + (withNone ? '<option value="none">ยังไม่มีหมวด</option>' : '');
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : 'all';
}
export const topicMatch = (n, v) => v === 'all' || (v === 'none' ? !hasTopic(n) : (n.topic_ids || []).includes(+v));

/* ---------- ฟอร์มแก้ไขข่าว: ติ๊กหมวด (≤ 3) ---------- */
export function renderTopicPick(box, ids = []) {
  const on = new Set(ids || []);
  box.innerHTML = (topics || []).map((t) => `<label class="nt-opt"><input type="checkbox" value="${t.id}"${on.has(t.id) ? ' checked' : ''}> ${esc(t.name)}</label>`).join('')
    || '<span class="small muted">ยังไม่มีหมวด · เพิ่มได้ในกล่อง "หมวดหมู่ข่าวตามเนื้อหา"</span>';
  box.onchange = (e) => {
    const picked = box.querySelectorAll('input:checked');
    if (picked.length > MAX_TOPICS) { e.target.checked = false; toast(`เลือกหมวดได้ไม่เกิน ${MAX_TOPICS} หมวด`, 'err'); }
  };
}
export const pickedTopics = (box) => [...box.querySelectorAll('input:checked')].map((x) => +x.value).slice(0, MAX_TOPICS);

/* ---------- ผู้ดูแล: กล่องจัดการหมวด + ให้ AI จัดหมวด ---------- */
let bound = false, running = false, onChange = () => {};
export async function mountTopicAdmin(changed) {
  onChange = changed || onChange;
  if (!bound) {
    bound = true;
    $('#ntAdd').addEventListener('click', addTopic);
    $('#ntName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTopic(); } });
    $('#ntList').addEventListener('click', delTopic);
    $('#ntAi').addEventListener('click', () => runAi(false));
  }
  await loadTopics(true);
  renderAdmin();
}
function renderAdmin() {
  $('#ntList').innerHTML = topics.length ? topics.map((t) => `<span class="chip c-sub nt-item">${esc(t.name)}<button type="button" class="nt-x" data-del-topic="${t.id}" aria-label="ลบหมวด ${esc(t.name)}">×</button></span>`).join('')
    : '<p class="empty">ยังไม่มีหมวด · เพิ่มหมวดด้านล่าง</p>';
}
async function addTopic() {
  const name = $('#ntName').value.trim();
  if (!name) { $('#ntName').focus(); return; }
  if (topics.some((t) => t.name === name)) { toast('มีหมวดนี้แล้ว', 'err'); return; }
  const btn = $('#ntAdd'); busy(btn, true, 'กำลังเพิ่ม…');
  const { error } = await sb.from('news_topics').insert({ name, sort: topics.length ? Math.max(...topics.map((t) => t.sort)) + 1 : 1 });
  busy(btn, false);
  if (error) { toast(errText(error), 'err'); return; }
  $('#ntName').value = ''; toast('เพิ่มหมวดแล้ว');
  await loadTopics(true); renderAdmin(); onChange();
}
async function delTopic(e) {
  const b = e.target.closest('[data-del-topic]'); if (!b) return;
  const t = topics.find((x) => x.id === +b.dataset.delTopic);
  if (!t || !confirm(`ลบหมวด "${t.name}"?\nข่าวที่อยู่หมวดนี้จะไม่มีหมวดนี้แล้ว (ข่าวไม่ถูกลบ) · ข่าวที่ไม่เหลือหมวดเลย AI จะจัดหมวดใหม่ให้`)) return;
  const { error } = await sb.from('news_topics').delete().eq('id', t.id);
  if (error) { toast(errText(error), 'err'); return; }
  toast('ลบหมวดแล้ว'); await loadTopics(true); renderAdmin(); onChange();
}
/** ให้ AI จัดหมวดข่าวที่ยังไม่มีหมวด · auto = เรียกเองตอนเปิดหน้า (เงียบถ้าไม่มีข่าวค้าง/AI ไม่พร้อม) */
export async function runAi(auto = true) {
  if (running) return;
  const msg = $('#ntMsg'), btn = $('#ntAi');
  running = true; if (!auto) busy(btn, true, 'AI กำลังจัดหมวด…');
  try {
    const { data: id, error } = await sb.rpc('ai_news_topics_start');
    if (error) throw error;
    if (id == null) { if (!auto) { msg.style.color = 'var(--success)'; msg.textContent = 'ทุกข่าวมีหมวดแล้ว'; } return; }
    msg.style.color = ''; msg.textContent = 'AI กำลังจัดหมวดข่าวที่ยังไม่มีหมวด…';
    let r = { status: 'pending' };
    for (let i = 0; r.status === 'pending' && i < 80; i++) {
      await new Promise((ok) => setTimeout(ok, 2500));
      const { data, error: e2 } = await sb.rpc('ai_news_topics_poll', { p_id: id });
      if (e2) throw e2;
      r = data;
    }
    if (r.status === 'done') { msg.style.color = 'var(--success)'; msg.textContent = `AI จัดหมวดแล้ว ${r.tagged} ข่าว · ตรวจ/แก้หมวดได้ที่ปุ่ม "แก้ไข" ของแต่ละข่าว`; onChange(); }
    else { msg.style.color = 'var(--error)'; msg.textContent = r.note || 'AI ยังจัดหมวดไม่เสร็จ กรุณาลองใหม่'; }
  } catch (err) { if (!auto) { msg.style.color = 'var(--error)'; msg.textContent = errText(err); } }
  finally { running = false; if (!auto) busy(btn, false); }
}
