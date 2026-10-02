// ผู้ดูแล › ข่าว › ช่อง AI: ข่าวจากบทความวิชาการ CCPE วันละ 1 ข่าว (งานจริงทำใน GitHub Actions: tools/ai_news/run.mjs)
//   ตั้งค่า (site_texts): ai_news_auto = on|off (เผยแพร่ทันที / รอตรวจ) · ai_news_request = เวลาที่กด "สร้างข่าวตอนนี้" (ระบบเช็กทุกชั่วโมง)
//   ประวัติ: ai_news_log (ผู้ดูแลอ่านได้อย่างเดียว · 10 ครั้งล่าสุด · ย่อไว้เป็นค่าเริ่มต้น กดเปิดดูได้) · ข่าวที่ได้เข้าคิว "รอตรวจ" ด้านล่างเหมือนข่าวจาก รพ.สต.
import { sb } from '../supabase.js?v=4.4';
import { $, esc, thaiDate, toast, errText, busy } from '../util.js?v=4.4';

const STATUS = { done: ['สร้างข่าวแล้ว', 'c-ok'], skipped: ['ไม่มีบทความใหม่', 'c-off'], error: ['ไม่สำเร็จ', 'c-fix'] };
const NEWS = { pending: 'รอตรวจ', published: 'เผยแพร่แล้ว', rejected: 'ไม่ใช้', unpublished: 'หยุดเผยแพร่', deleted: 'ลบแล้ว', fix: 'รอแก้' };
const time = (iso) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
let bound = false, settings = {};

export async function initAiPanel() {
  if (!bound) {
    bound = true;
    $('#aiAuto').addEventListener('change', toggleAuto);
    $('#aiNow').addEventListener('click', requestNow);
  }
  $('#aiLog').innerHTML = '<div class="skeleton"></div>';
  const [s, l] = await Promise.all([
    sb.from('site_texts').select('key,body').in('key', ['ai_news_auto', 'ai_news_request']),
    sb.from('ai_news_log').select('id,article_id,title,news_id,status,note,created_at').order('created_at', { ascending: false }).limit(10),
  ]);
  settings = Object.fromEntries((s.data || []).map((r) => [r.key, r.body]));
  $('#aiAuto').checked = settings.ai_news_auto === 'on';
  if (l.error) { $('#aiLog').innerHTML = `<p class="empty">${esc(errText(l.error))}</p>`; return; }
  const logs = l.data, ids = logs.map((x) => x.news_id).filter(Boolean);
  const n = ids.length ? await sb.from('news').select('id,title,status').in('id', ids) : { data: [] };
  const news = new Map((n.data || []).map((x) => [x.id, x]));
  const last = logs[0], req = settings.ai_news_request;
  const waiting = req && !isNaN(Date.parse(req)) && (!last || Date.parse(req) > Date.parse(last.created_at));
  $('#aiStatus').className = 'small ai-status' + (last?.status === 'error' && !waiting ? ' err-text' : '');
  $('#aiStatus').textContent = waiting ? 'รับคำสั่งแล้ว · ระบบจะสร้างข่าวภายใน 1 ชั่วโมง'
    : !last ? 'ยังไม่เคยทำงาน · ระบบเริ่มทำทุกวันหลัง 06:00 น. (ต้องตั้งค่าคีย์ GEMINI_API_KEY ใน GitHub ก่อน)'
      : `ทำงานล่าสุด ${thaiDate(last.created_at)} ${time(last.created_at)} น. · ${STATUS[last.status]?.[0] || last.status}${last.status === 'error' && last.note ? ': ' + last.note : ''}`;
  $('#aiLogCount').textContent = logs.length ? `(${logs.length} ครั้งล่าสุด)` : '';
  $('#aiLog').innerHTML = logs.length ? logs.map((x) => {
    const [label, cls] = STATUS[x.status] || [x.status, 'c-off'], nw = news.get(x.news_id);
    return `<div class="li"><div class="l"><b>${esc(nw?.title || x.title || 'ไม่มีบทความใหม่')}</b>`
      + `<span class="small muted">${esc(thaiDate(x.created_at))} ${time(x.created_at)} น.${x.title && nw ? ' · จากบทความ: ' + esc(x.title) : ''}${x.status === 'error' && x.note ? ' · ' + esc(x.note) : ''}</span></div>`
      + `<div class="row-btns" style="align-items:center"><span class="chip ${cls}">${label}</span>${nw ? `<span class="chip c-sub">${NEWS[nw.status] || esc(nw.status)}</span>${nw.status === 'published' ? `<a class="btn btn-o btn-sm" href="#/news/${nw.id}">ดูข่าว</a>` : ''}` : ''}</div></div>`;
  }).join('') : '<p class="empty">ยังไม่มีประวัติ</p>';
}

async function saveSetting(key, body) {
  const { error } = await sb.from('site_texts').upsert({ key, body, updated_at: new Date().toISOString() });
  if (error) throw error;
  settings[key] = body;
}

async function toggleAuto(e) {
  const on = e.target.checked;
  if (on && !confirm('เผยแพร่ข่าวจาก AI ทันทีโดยไม่ต้องตรวจ?\nAI อาจสรุปตัวเลขหรือขนาดยาผิดได้ — แนะนำให้ตรวจก่อนเผยแพร่')) { e.target.checked = false; return; }
  try { await saveSetting('ai_news_auto', on ? 'on' : 'off'); toast(on ? 'ข่าวจาก AI จะเผยแพร่ทันที (ติดป้าย "สรุปโดย AI")' : 'ข่าวจาก AI จะรอผู้ดูแลตรวจก่อนเผยแพร่'); }
  catch (err) { e.target.checked = !on; toast(errText(err), 'err'); }
}

async function requestNow() {
  const btn = $('#aiNow'); busy(btn, true, 'กำลังส่งคำสั่ง…');
  try { await saveSetting('ai_news_request', new Date().toISOString()); toast('รับคำสั่งแล้ว · ข่าวใหม่จะมาภายใน 1 ชั่วโมง'); initAiPanel(); }
  catch (err) { toast(errText(err), 'err'); }
  finally { busy(btn, false); }
}
