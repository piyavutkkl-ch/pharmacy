// ผู้ดูแล › ข่าว › ช่อง AI: ข่าวจากบทความวิชาการ CCPE วันละ 1 ข่าว (งานจริงทำใน GitHub Actions: tools/ai_news/run.mjs)
//   ตั้งค่าสร้างภาพ (Vault + site_texts ผ่าน rpc ai_image_settings_get/save):
//     - Google AI Studio API Key (เก็บใน Vault 'ai_image_api_key')
//     - AI Model สร้างภาพ ('ai_image_model') + Prompt สร้างภาพ ('ai_image_prompt')
//     - ระบบล็อกค่าค้างไว้ ('ai_image_locked'): ล็อก = ช่องกรอก disabled ค้างค่าเดิมไว้ จนกว่าจะกดเลื่อนเป็นแก้ไข
//   ตั้งค่าอัตโนมัติ (site_texts): ai_news_auto = on|off (เผยแพร่ทันที / รอตรวจ) · ai_news_request = เวลาที่กด "สร้างข่าวตอนนี้"
//   ประวัติ: ai_news_log (ผู้ดูแลอ่านได้อย่างเดียว · 10 ครั้งล่าสุด · ย่อไว้เป็นค่าเริ่มต้น กดเปิดดูได้)
import { sb } from '../supabase.js?v=4.4';
import { $, esc, thaiDate, toast, errText, busy } from '../util.js?v=4.4';

export const DEFAULT_IMAGE_PROMPT = 'Create ONLY ONE single tall portrait poster divided into 3 clearly separated sections stacked from top to bottom, with thin subtle divider lines. Flat modern vector graphic design, highly aesthetic and professional medical illustration.\n'
  + 'SECTION 1 (top - Executive Summary for patients & clinic front): An informative medical infographic poster. Clean minimalist layout, clear visual hierarchy, modern healthcare vector icons, core mechanism, and key tips.\n'
  + 'SECTION 2 (middle - Humorous 3-panel comic): A funny 3-panel comic strip in 2D hand-drawn editorial cartoon style with speech bubbles. Panel 1: Cute organ or pill character dealing with health stress. Panel 2: Discovering new medication/lifestyle solution with energetic spark. Panel 3: Happy healthy outcome with smiling patient. Humorous and lighthearted.\n'
  + 'SECTION 3 (bottom - Clinical Guideline & Matrix for healthcare staff): A professional clinical flowchart and structured decision matrix. Step-by-step decision tree, dosage/management comparison tables, color-coded sections, crisp and readable typography.\n'
  + 'Important: Use short, correctly spelled keywords and labels only. Highly organized, vibrant, zero visual clutter.';

const STATUS = { done: ['สร้างข่าวแล้ว', 'c-ok'], skipped: ['ไม่มีบทความใหม่', 'c-off'], error: ['ไม่สำเร็จ', 'c-fix'] };
const NEWS = { pending: 'รอตรวจ', published: 'เผยแพร่แล้ว', rejected: 'ไม่ใช้', unpublished: 'หยุดเผยแพร่', deleted: 'ลบแล้ว', fix: 'รอแก้' };
const time = (iso) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
let bound = false, settings = {}, editingUnlocked = false;
let imgSettings = { api_key: '', model: 'gemini-2.5-flash-image', prompt: DEFAULT_IMAGE_PROMPT, locked: true };

function applyLockState(locked) {
  const isLocked = !!locked;
  if ($('#aiImgLock')) $('#aiImgLock').checked = isLocked;
  if ($('#aiImgKey')) $('#aiImgKey').disabled = isLocked;
  if ($('#aiImgModel')) $('#aiImgModel').disabled = isLocked;
  if ($('#aiImgPrompt')) $('#aiImgPrompt').disabled = isLocked;
  if ($('#aiImgSave')) $('#aiImgSave').hidden = isLocked;
  if ($('#aiImgLockChip')) {
    $('#aiImgLockChip').textContent = isLocked ? 'ล็อกค่าไว้' : 'แก้ไขได้';
    $('#aiImgLockChip').className = 'chip ' + (isLocked ? 'c-ok' : 'c-warn');
  }
  if ($('#aiImgLockText')) {
    $('#aiImgLockText').textContent = isLocked ? 'ล็อกค้างไว้ (เลื่อนเพื่อแก้ไข)' : 'โหมดแก้ไข (เลื่อนกลับเพื่อล็อก)';
  }
}

function toggleShowKey() {
  const inp = $('#aiImgKey'), btn = $('#aiImgKeyShow');
  if (!inp || !btn) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.textContent = show ? 'ซ่อน' : 'แสดง';
  btn.setAttribute('aria-pressed', String(show));
}

async function onToggleLock(e) {
  const wantLock = e.target.checked;
  if (!wantLock) {
    editingUnlocked = true;
    applyLockState(false);
    if ($('#aiImgMsg')) $('#aiImgMsg').textContent = 'เปิดโหมดแก้ไขแล้ว · แก้ไข API Key, โมเดล หรือ Prompt แล้วกด "บันทึก & ล็อกค่า" หรือเลื่อนสวิตช์กลับเพื่อล็อก';
    return;
  }
  await saveImageSettings(true);
}

export async function saveImageSettings(lockAfter = true) {
  const btn = $('#aiImgSave');
  const api_key = ($('#aiImgKey')?.value || '').trim();
  const model = $('#aiImgModel')?.value || 'gemini-2.5-flash-image';
  const prompt = ($('#aiImgPrompt')?.value || '').trim() || DEFAULT_IMAGE_PROMPT;
  if ($('#aiImgPrompt')) $('#aiImgPrompt').value = prompt;
  if (btn && !btn.hidden) busy(btn, true, 'กำลังบันทึก…');
  try {
    const { data, error } = await sb.rpc('ai_image_settings_save', {
      p_api_key: api_key,
      p_model: model,
      p_prompt: prompt,
      p_locked: lockAfter,
    });
    if (error) throw error;
    imgSettings = {
      api_key: data?.api_key ?? api_key,
      model: data?.model || model,
      prompt: data?.prompt || prompt,
      locked: lockAfter,
    };
    editingUnlocked = !lockAfter;
    applyLockState(lockAfter);
    if ($('#aiImgMsg')) $('#aiImgMsg').textContent = 'บันทึกและล็อกค่า API Key, โมเดล และ Prompt สร้างภาพเรียบร้อยแล้ว';
    toast('บันทึกและล็อกค่าตั้งสร้างภาพ AI แล้ว');
    return true;
  } catch (err) {
    toast(errText(err), 'err');
    return false;
  } finally {
    if (btn) busy(btn, false);
  }
}

/** หากผู้ดูแลเปิดโหมดแก้ไขค้างไว้แล้วกด Gen ภาพ หรือกดสร้างข่าวตอนนี้ ให้บันทึกและล็อกค่าที่กรอกไว้ก่อนใช้ทันที */
export async function ensureAiImageSettingsSaved() {
  if ($('#aiImgLock') && !$('#aiImgLock').checked) {
    await saveImageSettings(true);
  }
  return imgSettings;
}

export function getAiImageSettings() {
  return imgSettings;
}

export async function initAiPanel() {
  if (!bound) {
    bound = true;
    $('#aiAuto').addEventListener('change', toggleAuto);
    $('#aiNow').addEventListener('click', requestNow);
    $('#aiImgLock')?.addEventListener('change', onToggleLock);
    $('#aiImgSave')?.addEventListener('click', () => saveImageSettings(true));
    $('#aiImgKeyShow')?.addEventListener('click', toggleShowKey);
  }
  $('#aiLog').innerHTML = '<div class="skeleton"></div>';
  const [s, l, imgRes] = await Promise.all([
    sb.from('site_texts').select('key,body').in('key', ['ai_news_auto', 'ai_news_request']),
    sb.from('ai_news_log').select('id,article_id,title,news_id,status,note,created_at').order('created_at', { ascending: false }).limit(10),
    sb.rpc('ai_image_settings_get'),
  ]);
  if (!imgRes.error && imgRes.data && !editingUnlocked) {
    const d = imgRes.data;
    imgSettings = {
      api_key: d.api_key ?? '',
      model: d.model || 'gemini-2.5-flash-image',
      prompt: d.prompt || DEFAULT_IMAGE_PROMPT,
      locked: d.locked !== false,
    };
    if ($('#aiImgKey')) $('#aiImgKey').value = imgSettings.api_key;
    if ($('#aiImgModel')) {
      const sel = $('#aiImgModel');
      if (![...sel.options].some((o) => o.value === imgSettings.model)) {
        const opt = document.createElement('option');
        opt.value = imgSettings.model;
        opt.textContent = imgSettings.model;
        sel.appendChild(opt);
      }
      sel.value = imgSettings.model;
    }
    if ($('#aiImgPrompt')) $('#aiImgPrompt').value = imgSettings.prompt;
    applyLockState(imgSettings.locked);
  } else if (!editingUnlocked) {
    if ($('#aiImgPrompt') && !$('#aiImgPrompt').value) $('#aiImgPrompt').value = imgSettings.prompt;
    applyLockState(imgSettings.locked);
  }
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
    : !last ? 'ยังไม่เคยทำงาน · ระบบเริ่มทำทุกวันหลัง 06:00 น. (ตั้งค่า API Key ด้านบนได้เลย)'
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
  try {
    await ensureAiImageSettingsSaved();
    await saveSetting('ai_news_request', new Date().toISOString());
    toast('รับคำสั่งแล้ว · ข่าวใหม่พร้อมภาพ AI จะมาภายใน 1 ชั่วโมง');
    initAiPanel();
  }
  catch (err) { toast(errText(err), 'err'); }
  finally { busy(btn, false); }
}
