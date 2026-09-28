// ประชาชน (#/me): ข้อมูลส่วนตัว + แชทสอบถามเจ้าหน้าที่ รพ.สต. / ห้องยา รพ. แบบ real-time
// ต้องมีเบอร์โทรก่อนเริ่มแชท (RLS บังคับ) เพื่อให้เจ้าหน้าที่ติดต่อกลับได้
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, errText, busy } from '../util.js?v=4.4';
import { auth } from '../auth.js?v=4.4';
import { loadUnits } from '../data.js?v=4.4';
import { initStaffRequest } from './staff-request.js?v=4.4';
import { targetName, loadMessages, sendMessage, renderLog, openRoom, markRead, refreshMsgBadge, onConversationChange, chatPicker } from './chat.js?v=4.4';

const PHONE_RE = /^[0-9][0-9 -]{7,14}$/;
let convs = [], target, msgs = [], closeRoom = null, bound = false, units = [], pick = null;

export async function showMe(openRequest = false) {
  units = await loadUnits();
  const p = auth.profile;
  $('#meHello').textContent = 'สวัสดี ' + (p.full_name || '');
  if (!bound) { bound = true; bind(); }
  fillProfile();
  await loadConvs();
  if (target === undefined) target = convs[0]?.target_unit ?? p.home_unit_id ?? null;   // ห้องล่าสุด → หน่วยใกล้บ้าน → ห้องยา รพ.
  renderTargets();
  openTarget(target);
  initStaffRequest(openRequest);
}

/** ออกจากหน้า → ปิดการฟังข้อความ */
export function leaveMe() { closeRoom?.(); closeRoom = null; }

/* ---------- ข้อมูลส่วนตัว ---------- */
function fillProfile() {
  const p = auth.profile;
  $('#meUnit').innerHTML = '<option value="">— เลือก —</option>' + units.map((u) => `<option value="${u.id}">รพ.สต. ${esc(u.name)}</option>`).join('');
  $('#meName').value = p.full_name || ''; $('#meEmail').value = p.email; $('#mePhone').value = p.phone || '';
  $('#meAddr').value = p.address || ''; $('#meUnit').value = p.home_unit_id ?? '';
  syncHint();
}

async function saveProfile(e) {
  e.preventDefault();
  const m = $('#meMsg'), say = (t, ok) => { m.style.color = ok ? 'var(--success)' : 'var(--error)'; m.textContent = t; };
  const full_name = $('#meName').value.trim(), phone = $('#mePhone').value.trim();
  $('#meName').removeAttribute('aria-invalid'); $('#mePhone').removeAttribute('aria-invalid');
  if (!full_name) { say('กรุณากรอกชื่อ-นามสกุล'); $('#meName').setAttribute('aria-invalid', 'true'); $('#meName').focus(); return; }
  if (!PHONE_RE.test(phone)) { say('เบอร์โทรไม่ถูกต้อง (ตัวเลข 9–10 หลัก เช่น 0812345678)'); $('#mePhone').setAttribute('aria-invalid', 'true'); $('#mePhone').focus(); return; }
  const row = { full_name, phone, address: $('#meAddr').value.trim() || null, home_unit_id: $('#meUnit').value === '' ? null : +$('#meUnit').value };
  const btn = $('#meSave'); busy(btn, true, 'กำลังบันทึก…');
  const { error } = await sb.from('profiles').update(row).eq('id', auth.profile.id);
  busy(btn, false);
  if (error) { say(errText(error)); return; }
  Object.assign(auth.profile, row);
  $('#meHello').textContent = 'สวัสดี ' + full_name;
  say('บันทึกแล้ว', true);
  syncHint();
}

function syncHint() {
  const ok = !!auth.profile.phone;
  $('#meChatHint').textContent = ok ? '' : 'กรอกชื่อและเบอร์โทรในข้อมูลส่วนตัวก่อน เพื่อให้เจ้าหน้าที่ติดต่อกลับได้';
  $('#meInput').disabled = !ok; $('#meSend').disabled = !ok; $('#meFile').disabled = !ok; $('#meAttach').classList.toggle('is-disabled', !ok);
  $('[data-view="me"] .citizen-split').classList.toggle('ready', ok);   // มือถือ: กรอกข้อมูลครบแล้ว ให้แชทขึ้นก่อน
}

/* ---------- แชท ---------- */
async function loadConvs() {
  const { data } = await sb.from('conversations').select('id,target_unit,last_message_at,unread_citizen')
    .eq('citizen_id', auth.profile.id).order('last_message_at', { ascending: false, nullsFirst: false });
  convs = data || [];
}
const convOf = (t) => convs.find((c) => (c.target_unit ?? null) === (t ?? null));

function renderTargets() {
  const opts = [null, ...units.map((u) => u.id)];
  $('#meTargets').innerHTML = opts.map((t) => {
    const c = convOf(t), n = c?.unread_citizen || 0;
    return `<button type="button" data-t="${t ?? ''}" aria-current="${(t ?? null) === (target ?? null)}">${esc(t == null ? 'ห้องยา รพ.' : unitName(t))}${n ? ` <span class="badge num" style="position:static">${n}</span>` : ''}</button>`;
  }).join('');
  const cur = $('#meTargets [aria-current="true"]');
  if (cur) $('#meTargets').scrollLeft = cur.offsetLeft - $('#meTargets').offsetLeft - 8;   // เลื่อนให้เห็นปุ่มที่เลือก
}
const unitName = (id) => units.find((u) => u.id === id)?.name || '';

async function openTarget(t) {
  closeRoom?.(); closeRoom = null;
  target = t;
  $('#meChatTitle').textContent = 'ส่งถึง ' + targetName(t);
  const c = convOf(t);
  msgs = [];
  const empty = `ยังไม่มีข้อความ — พิมพ์คำถามเรื่องยาถึง${targetName(t)} ได้เลย เจ้าหน้าที่จะตอบในเวลาราชการ`;
  if (!c) { renderLog($('#meLog'), msgs, 'citizen', empty); return; }
  $('#meLog').innerHTML = '<div class="skeleton"></div>';
  try { msgs = await loadMessages(c.id); } catch (e) { $('#meLog').innerHTML = `<p class="chat-empty">${esc(errText(e))}</p>`; return; }
  if (target !== t) return;
  renderLog($('#meLog'), msgs, 'citizen', empty);
  if (c.unread_citizen) { await markRead(c.id); c.unread_citizen = 0; renderTargets(); refreshMsgBadge(); }
  listen(c);
}

function listen(c) {
  closeRoom = openRoom(c.id, (m) => {
    if (msgs.some((x) => x.id === m.id)) return;
    msgs.push(m); renderLog($('#meLog'), msgs, 'citizen', '');
    if (m.sender_role === 'staff') markRead(c.id).then(() => { c.unread_citizen = 0; renderTargets(); refreshMsgBadge(); });
  });
}

async function send(e) {
  e.preventDefault();
  const inp = $('#meInput'), body = inp.value.trim();
  const blob = await pick.ready();
  if (!body && !blob) return;
  if (/\b\d[\s-]?\d{4}[\s-]?\d{5}[\s-]?\d{2}[\s-]?\d\b/.test(body) && !confirm('ข้อความนี้อาจมีเลขบัตรประชาชน — ไม่จำเป็นต้องส่งทางแชท ต้องการส่งต่อหรือไม่?')) return;
  const btn = $('#meSend'); busy(btn, true, '…');
  try {
    let c = convOf(target);
    if (!c) {                                               // ข้อความแรก → เปิดห้องก่อน
      const ins = await sb.from('conversations').insert({ target_unit: target }).select('id,target_unit,last_message_at,unread_citizen').single();
      if (ins.error) {
        if (!/duplicate|already exists/i.test(ins.error.message)) throw ins.error;
        await loadConvs(); c = convOf(target);             // มีห้องอยู่แล้ว (เปิดจากอีกเครื่อง)
      } else { c = ins.data; convs.unshift(c); }
      listen(c);
    }
    const m = await sendMessage(c.id, body, blob);
    inp.value = ''; pick.reset();
    if (!msgs.some((x) => x.id === m.id)) msgs.push(m);
    renderLog($('#meLog'), msgs, 'citizen', '');
  } catch (err) { toast(errText(err), 'err'); }
  finally { busy(btn, false); syncHint(); inp.focus(); }
}

function bind() {
  $('#meForm').addEventListener('submit', saveProfile);
  $('#meChatForm').addEventListener('submit', send);
  pick = chatPicker($('#meFile'), $('#mePick'), $('#mePickNote'));
  $('#meTargets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    const t = b.dataset.t === '' ? null : +b.dataset.t;
    if (t === target) return;
    openTarget(t); renderTargets();
  });
  onConversationChange(async () => {                        // เจ้าหน้าที่ตอบห้องอื่น → อัปเดตตัวเลข
    if ($('[data-view="me"]').hidden) return;
    await loadConvs(); renderTargets();
  });
}
