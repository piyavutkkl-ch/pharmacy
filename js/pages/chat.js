// แชท ประชาชน ⇄ เจ้าหน้าที่ รพ.สต. / ห้องยา รพ. (ตาราง conversations + messages, Supabase Realtime)
//   ห้องแชท 1 ห้อง = ประชาชน 1 คน × ปลายทาง 1 แห่ง (target_unit = รพ.สต., null = ห้องยา รพ.)
//   ใครเห็นอะไร คุมด้วย RLS: ประชาชนเห็นของตัวเอง · เจ้าหน้าที่เห็นของหน่วยตัวเอง · ผู้ดูแลเห็นทั้งหมด
//   ตัวเลข "ยังไม่อ่าน" ฐานข้อมูลนับให้ (trigger) และล้างด้วย rpc mark_conversation_read
//
//   mountInbox(slot, target)   กล่องข้อความฝั่งเจ้าหน้าที่/ผู้ดูแล (ใช้ทั้ง staff.js และ admin.js)
//   startChatWatch()           ฟังการเปลี่ยนแปลงห้องแชทแบบ real-time → อัปเดตตัวเลขบนเมนู
//   ถังขยะ: เจ้าหน้าที่/ผู้ดูแลลบห้องลงถัง (trash_conversation) กู้คืนได้ 30 วัน · ครบแล้วหน้าผู้ดูแลลบถาวรให้เอง
import { sb } from '../supabase.js?v=4.4';
import { $, esc, thaiDate, toast, errText, busy, initials } from '../util.js?v=4.4';
import { auth } from '../auth.js?v=4.4';
import { loadUnits, unitName } from '../data.js?v=4.4';
import { imagePicker, uploadChatImage, hydrateSigned, openPrivateFile, removeFiles } from '../upload.js?v=4.4';

export const targetName = (t) => (t == null ? 'ห้องยา โรงพยาบาลควนกาหลง' : 'รพ.สต. ' + unitName(t));
const time = (iso) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

/* ---------- ข้อความ ---------- */
export async function loadMessages(convId) {
  const { data, error } = await sb.from('messages').select('id,sender_id,sender_role,sender_name,body,image_path,created_at')
    .eq('conversation_id', convId).order('created_at', { ascending: false }).limit(300);
  if (error) throw error;
  return data.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id));   // เก่า → ใหม่
}

/** ส่งข้อความ (body ว่างได้ถ้ามีรูป) · blob = รูปที่ย่อแล้วจาก imagePicker → อัปโหลดเข้า chat-images/<ห้อง>/ ก่อน */
export async function sendMessage(convId, body, blob = null) {
  const row = { conversation_id: convId, body: body || '' };
  if (blob) row.image_path = await uploadChatImage(blob, convId);
  const { data, error } = await sb.from('messages').insert(row).select('id,sender_id,sender_role,sender_name,body,image_path,created_at').single();
  if (error) throw error;
  return data;
}

/** ปุ่มแนบรูปในฟอร์มแชท: form ต้องมี .chat-file (input file) · box = .chat-pick (มี img + ปุ่ม .chat-pick-x) · note = .chat-pick-note */
export function chatPicker(input, box, note) {
  const pick = imagePicker(input, box, note);
  box.querySelector('.chat-pick-x').addEventListener('click', () => pick.reset());
  return pick;
}

const IMG_BTN = (m) => `<button type="button" class="chat-img" data-file="${esc(m.image_path)}" data-bucket="chat-images" aria-label="เปิดรูปขนาดเต็ม"><img data-signed="chat-images|${esc(m.image_path)}" alt="รูปที่ส่งในแชท"></button>`;

/** วาดข้อความ · side = 'citizen' (มุมมองประชาชน) หรือ 'staff' (มุมมองเจ้าหน้าที่) */
export function renderLog(logEl, msgs, side, emptyText) {
  if (!msgs.length) { logEl.innerHTML = `<p class="chat-empty">${esc(emptyText)}</p>`; return; }
  let prev = null;
  logEl.innerHTML = msgs.map((m) => {
    const mine = m.sender_role === side;
    const day = !prev || !sameDay(prev.created_at, m.created_at) ? `<div class="chat-day">${esc(thaiDate(m.created_at))}</div>` : '';
    prev = m;
    const who = m.sender_role === 'staff' && side === 'citizen' ? `${esc(m.sender_name || 'เจ้าหน้าที่')} · ` : (mine && side === 'staff' && m.sender_id !== auth.profile?.id ? `${esc(m.sender_name || '')} · ` : '');
    return `${day}<div class="bubble${mine ? ' me' : ''}${m.image_path ? ' has-img' : ''}" data-mid="${m.id}">${m.image_path ? IMG_BTN(m) : ''}${m.body ? esc(m.body) : ''}<span class="meta">${who}${time(m.created_at)}</span></div>`;
  }).join('');
  logEl.scrollTop = logEl.scrollHeight;
  logEl.onclick = (e) => { const b = e.target.closest('[data-file]'); if (b) openPrivateFile(b).catch((err) => toast(errText(err), 'err')); };
  hydrateSigned(logEl).then(() => logEl.querySelectorAll('.chat-img img').forEach((i) => {
    if (i.complete) logEl.scrollTop = logEl.scrollHeight; else i.addEventListener('load', () => { logEl.scrollTop = logEl.scrollHeight; }, { once: true });
  }));
}

/** เปิดห้องแบบ real-time: onNew(message) เมื่อมีข้อความใหม่ · คืนฟังก์ชันปิดห้อง */
export function openRoom(convId, onNew) {
  const ch = sb.channel('room-' + convId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, (p) => onNew(p.new))
    .subscribe();
  return () => sb.removeChannel(ch);
}

export const markRead = (convId) => sb.rpc('mark_conversation_read', { p_conv: convId });

/* ---------- ตัวเลขบนเมนู + real-time ทั้งระบบ ---------- */
const listeners = new Set();
let watching = null, lastTotal = null;

/** ให้หน้าอื่นรู้เมื่อห้องแชทมีการเปลี่ยนแปลง (เช่น รีเฟรชรายการ) */
export function onConversationChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function refreshMsgBadge() {
  const p = auth.profile; if (!p) return;
  let q, col, el;
  if (p.role === 'citizen') { q = sb.from('conversations').select('unread_citizen').eq('citizen_id', p.id); col = 'unread_citizen'; el = $('#navMsgBadge'); }
  else if (p.role === 'staff') { q = sb.from('conversations').select('unread_staff').eq('target_unit', p.unit_id); col = 'unread_staff'; el = $('#stfMsgBadge'); }
  else { q = sb.from('conversations').select('unread_staff').is('target_unit', null); col = 'unread_staff'; el = $('#admMsgBadge'); }
  // แชทกับผู้ดูแล (unit_chats): เจ้าหน้าที่ = unread_unit ของหน่วยตัวเอง · ผู้ดูแล = unread_admin ทุกหน่วย
  const uq = p.role === 'staff' ? sb.from('unit_chats').select('unread_unit').eq('unit_id', p.unit_id) : p.role === 'admin' ? sb.from('unit_chats').select('unread_admin') : null;
  const [{ data }, u] = await Promise.all([q, uq || Promise.resolve({ data: [] })]);
  const ucol = p.role === 'staff' ? 'unread_unit' : 'unread_admin';
  const unitUnread = (u.data || []).reduce((s, r) => s + (r[ucol] || 0), 0);
  const citizen = (data || []).reduce((s, r) => s + (r[col] || 0), 0), total = citizen + unitUnread;
  if (el) el.textContent = total ? String(total) : '';
  document.querySelectorAll('[data-uc-badge]').forEach((b) => { b.textContent = unitUnread ? String(unitUnread) : ''; });
  document.querySelectorAll('[data-citizen-badge]').forEach((b) => { b.textContent = citizen ? String(citizen) : ''; });
  if (lastTotal !== null && total > lastTotal && !location.hash.includes('messages') && !location.hash.startsWith('#/me')) toast('มีข้อความใหม่ — เปิดเมนู "ข้อความ" เพื่ออ่าน');
  lastTotal = total;
}

let timer = null;
const changed = () => { clearTimeout(timer); timer = setTimeout(() => { refreshMsgBadge(); listeners.forEach((fn) => fn()); }, 300); };
export function startChatWatch() {
  if (watching || !auth.profile) return;
  watching = sb.channel('conversations-' + auth.profile.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, changed)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'unit_chats' }, changed)   // แชทกับผู้ดูแล
    .subscribe();
  refreshMsgBadge();
}
export function stopChatWatch() { if (watching) sb.removeChannel(watching); watching = null; lastTotal = null; }

/* ================= กล่องข้อความ (เจ้าหน้าที่ / ผู้ดูแล) ================= */
const INBOX_HTML = `<div class="inbox">
  <div class="panel"><div class="panel-head"><h2 class="ib-title">ผู้ที่ทักเข้ามา</h2><span class="small muted ib-count"></span><button type="button" class="btn btn-o btn-sm ib-trash-btn">ถังขยะ</button></div><div class="list ib-list"></div></div>
  <div class="panel chat-panel">
    <div class="ib-head"><p class="small muted">เลือกรายชื่อทางซ้ายเพื่ออ่านและตอบกลับ</p></div>
    <div class="chat-log ib-log" role="log" aria-live="polite"></div>
    <div class="chat-pick" hidden><img alt="รูปที่จะส่ง"><button type="button" class="btn btn-o btn-sm chat-pick-x">ยกเลิกรูป</button></div>
    <form class="chat-form ib-form" novalidate><label class="btn btn-o btn-sm chat-attach" title="แนบรูป"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg><span class="sr-only">แนบรูป</span><input type="file" accept="image/*" class="sr-only chat-file ib-file" disabled></label><input class="input ib-input" maxlength="1000" placeholder="พิมพ์ตอบกลับ…" autocomplete="off" aria-label="พิมพ์ตอบกลับ" disabled><button class="btn btn-p btn-sm ib-send" type="submit" disabled>ส่ง</button></form>
    <span class="small muted chat-pick-note"></span>
    <p class="small muted">ข้อความเป็นข้อมูลส่วนบุคคล เห็นเฉพาะผู้ถาม เจ้าหน้าที่หน่วยนั้น และผู้ดูแล · ห้ามขอเลขบัตรประชาชนทางแชท</p>
  </div>
</div>`;

let ib = null;   // สถานะกล่องข้อความที่เปิดอยู่ (มีได้ทีละกล่อง)
const KEEP_DAYS = 30, DAY = 86_400_000;
const daysLeft = (c) => Math.max(0, Math.ceil(KEEP_DAYS - (Date.now() - new Date(c.trashed_at)) / DAY));

/** target: หมายเลข รพ.สต. หรือ null = ห้องยา รพ. */
export async function mountInbox(slot, target) {
  await loadUnits();
  ib?.close?.(); ib?.off?.();
  if (!slot.querySelector('.inbox')) slot.innerHTML = INBOX_HTML;
  const el = (c) => slot.querySelector(c);
  ib = { slot, target, convs: [], sel: null, msgs: [], close: null, off: null, trash: false };
  const isAdmin = auth.profile.role === 'admin';
  const me = ib;
  if (!slot.__pick) slot.__pick = chatPicker(el('.ib-file'), el('.chat-pick'), el('.chat-pick-note'));
  const pick = slot.__pick; pick.reset();
  const enable = (on) => { el('.ib-input').disabled = !on; el('.ib-send').disabled = !on; el('.ib-file').disabled = !on; el('.chat-attach').classList.toggle('is-disabled', !on); };
  // ผู้ดูแลเปิดดูกล่องของ รพ.สต. ได้ แต่ไม่ล้างตัวเลขยังไม่อ่านของหน่วยนั้น
  const mayMarkRead = auth.profile.role === 'staff' || target == null;

  async function loadList() {
    let q = sb.from('conversations').select('id,target_unit,last_message_at,last_message_preview,unread_staff,trashed_at,citizen:profiles!conversations_citizen_id_fkey(full_name,email,phone,address,home_unit_id)');
    q = target == null ? q.is('target_unit', null) : q.eq('target_unit', target);
    const { data, error } = await q.order('last_message_at', { ascending: false, nullsFirst: false }).limit(200);
    if (me !== ib) return;
    if (error) { el('.ib-list').innerHTML = `<p class="empty">โหลดไม่สำเร็จ: ${esc(errText(error))}</p>`; return; }
    let all = data.filter((c) => c.last_message_at);
    const expired = all.filter((c) => c.trashed_at && daysLeft(c) === 0);
    if (isAdmin && expired.length) { await purge(expired); all = all.filter((c) => !expired.includes(c)); }   // ครบ 30 วัน → ลบถาวร
    const trashed = all.filter((c) => c.trashed_at);
    me.convs = me.trash ? trashed : all.filter((c) => !c.trashed_at);
    el('.ib-title').textContent = me.trash ? 'ห้องที่ลบแล้ว (กู้คืนได้ 30 วัน)' : 'ผู้ที่ทักเข้ามา';
    el('.ib-trash-btn').textContent = me.trash ? '← กลับกล่องข้อความ' : `ถังขยะ${trashed.length ? ` (${trashed.length})` : ''}`;
    el('.ib-count').textContent = me.convs.length ? `${me.convs.length} คน` : '';
    el('.ib-list').innerHTML = me.convs.length ? me.convs.map((c) => {
      const n = c.citizen?.full_name || c.citizen?.email || 'ไม่ระบุชื่อ';
      return `<button type="button" class="li-btn${c.id === me.sel?.id ? ' sel' : ''}" data-conv="${c.id}"><span class="avatar" style="width:34px;height:34px;font-size:12px">${esc(initials(n))}</span>`
        + `<span class="l" style="min-width:0;flex:1"><b>${esc(n)}</b><span class="small muted conv-last">${esc(c.last_message_preview || '')}</span><span class="small muted">${me.trash ? `ลบถาวรในอีก ${daysLeft(c)} วัน` : `${esc(thaiDate(c.last_message_at))} ${time(c.last_message_at)}`}</span></span>`
        + (c.unread_staff ? `<span class="badge num" style="position:static">${c.unread_staff}</span>` : '') + '</button>';
    }).join('') : `<p class="empty">${me.trash ? 'ไม่มีห้องที่ลบไว้' : `ยังไม่มีผู้ทักเข้ามาที่${esc(targetName(target))}`}</p>`;
  }

  async function select(id) {
    const c = me.convs.find((x) => x.id === id); if (!c) return;
    me.close?.();
    me.sel = c;
    slot.querySelectorAll('[data-conv]').forEach((b) => b.classList.toggle('sel', b.dataset.conv === id));
    const p = c.citizen || {};
    el('.ib-head').innerHTML = `<div class="chat-who"><b>${esc(p.full_name || p.email || 'ไม่ระบุชื่อ')}</b>`
      + `<span class="small muted">${p.phone ? `โทร <a href="tel:${esc(p.phone.replace(/[^0-9]/g, ''))}">${esc(p.phone)}</a>` : 'ไม่มีเบอร์โทร'}`
      + `${p.home_unit_id != null ? ' · ใกล้ รพ.สต. ' + esc(unitName(p.home_unit_id)) : ''}${p.address ? ' · ' + esc(p.address) : ''}</span></div>`
      + `<div class="row-btns ib-acts">${me.trash ? `<button type="button" class="btn btn-p btn-sm" data-restore>กู้คืน</button>${isAdmin ? '<button type="button" class="btn btn-no btn-sm" data-purge>ลบถาวร</button>' : ''}`
        : '<button type="button" class="btn btn-o btn-sm" data-trash title="ย้ายลงถังขยะ กู้คืนได้ภายใน 30 วัน">ลบห้องนี้</button>'}</div>`;
    el('.ib-log').innerHTML = '<div class="skeleton"></div>';
    try { me.msgs = await loadMessages(id); } catch (e) { el('.ib-log').innerHTML = `<p class="chat-empty">${esc(errText(e))}</p>`; return; }
    if (me !== ib || me.sel?.id !== id) return;
    renderLog(el('.ib-log'), me.msgs, 'staff', 'ยังไม่มีข้อความ');
    enable(!me.trash);   // ห้องในถัง: อ่านได้อย่างเดียว (กู้คืนก่อนจึงตอบได้)
    if (me.trash) return;
    if (window.matchMedia('(max-width: 819px)').matches) el('.chat-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    else el('.ib-input').focus({ preventScroll: true });
    if (mayMarkRead && c.unread_staff) { await markRead(id); c.unread_staff = 0; loadList(); refreshMsgBadge(); }
    me.close = openRoom(id, (m) => {
      if (me.msgs.some((x) => x.id === m.id)) return;
      me.msgs.push(m); renderLog(el('.ib-log'), me.msgs, 'staff', '');
      if (mayMarkRead && m.sender_role === 'citizen') markRead(id).then(refreshMsgBadge);
    });
  }

  /** ลบถาวร (ผู้ดูแล): รูปในแชทก่อน แล้วลบห้อง (ข้อความลบตามอัตโนมัติ) */
  async function purge(list) {
    const ids = list.map((c) => c.id);
    const { data: imgs } = await sb.from('messages').select('image_path').in('conversation_id', ids);
    const { error } = await sb.from('conversations').delete().in('id', ids);
    if (error) { toast(errText(error), 'err'); return false; }
    const paths = (imgs || []).map((m) => m.image_path).filter(Boolean);
    if (paths.length) removeFiles('chat-images', paths);
    return true;
  }
  function clearSel() {
    me.close?.(); me.close = null; me.sel = null; me.msgs = [];
    el('.ib-head').innerHTML = '<p class="small muted">เลือกรายชื่อทางซ้ายเพื่ออ่านและตอบกลับ</p>';
    el('.ib-log').innerHTML = '<p class="chat-empty">ยังไม่ได้เลือกห้องสนทนา</p>';
    enable(false);
  }
  el('.ib-head').onclick = async (e) => {
    const c = me.sel; if (!c) return;
    const who = c.citizen?.full_name || c.citizen?.email || 'ผู้ใช้';
    const act = e.target.closest('[data-trash],[data-restore],[data-purge]'); if (!act) return;
    if (act.hasAttribute('data-purge')) {
      if (!confirm(`ลบห้องสนทนากับ ${who} ถาวร?\nข้อความและรูปทั้งหมดจะหายทั้งสองฝั่ง กู้คืนไม่ได้`)) return;
      busy(act, true, '…'); const ok = await purge([c]); busy(act, false);
      if (ok) { toast('ลบถาวรแล้ว'); clearSel(); loadList(); }
      return;
    }
    const trash = act.hasAttribute('data-trash');
    if (trash && !confirm(`ลบห้องสนทนากับ ${who}?\nย้ายไปถังขยะ กู้คืนได้ภายใน 30 วัน (ผู้ถามยังเห็นข้อความของตัวเอง · ถ้าเขาส่งข้อความใหม่ ห้องจะกลับมาเอง)`)) return;
    busy(act, true, '…');
    const { error } = await sb.rpc('trash_conversation', { p_conv: c.id, p_trash: trash });
    busy(act, false);
    if (error) { toast(errText(error), 'err'); return; }
    toast(trash ? 'ย้ายลงถังขยะแล้ว · กู้คืนได้ภายใน 30 วัน' : 'กู้คืนแล้ว'); clearSel(); loadList(); refreshMsgBadge();
  };
  el('.ib-trash-btn').onclick = () => { me.trash = !me.trash; clearSel(); loadList(); };
  el('.ib-list').onclick = (e) => { const b = e.target.closest('[data-conv]'); if (b) select(b.dataset.conv); };
  el('.ib-form').onsubmit = async (e) => {
    e.preventDefault();
    const inp = el('.ib-input'), body = inp.value.trim();
    if (!me.sel) return;
    const btn = el('.ib-send'); busy(btn, true, '…');
    try {
      const blob = await pick.ready();
      if (!body && !blob) return;
      const m = await sendMessage(me.sel.id, body, blob);
      inp.value = ''; pick.reset();
      if (!me.msgs.some((x) => x.id === m.id)) me.msgs.push(m);
      renderLog(el('.ib-log'), me.msgs, 'staff', '');
    } catch (err) { toast(errText(err), 'err'); }
    finally { busy(btn, false); inp.focus(); }
  };
  me.off = onConversationChange(loadList);
  el('.ib-head').innerHTML = '<p class="small muted">เลือกรายชื่อทางซ้ายเพื่ออ่านและตอบกลับ</p>';
  el('.ib-log').innerHTML = '<p class="chat-empty">ยังไม่ได้เลือกห้องสนทนา</p>';
  enable(false);
  await loadList();
}

/** ปิดห้องที่เปิดค้าง (เมื่อออกจากหน้าข้อความ) */
export function unmountInbox() { ib?.close?.(); ib?.off?.(); ib = null; }
