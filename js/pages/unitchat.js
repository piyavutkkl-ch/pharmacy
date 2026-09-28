// แชท เจ้าหน้าที่ รพ.สต. ⇄ ผู้ดูแล (ขั้น 24) — ตาราง unit_chats + unit_messages, Supabase Realtime
//   1 รพ.สต. = 1 ห้อง · เจ้าหน้าที่ทุกคนของหน่วยเห็นห้องเดียวกัน · ผู้ดูแลเห็นทุกห้อง
//   mountUnitChat(slot, unit)   เจ้าหน้าที่: unit = หน่วยตัวเอง (ห้องเดียว) · ผู้ดูแล: unit = null (รายชื่อ รพ.สต. + ห้องที่เลือก)
//   ตัวเลขยังไม่อ่านบนเมนูรวมอยู่ใน refreshMsgBadge() ของ chat.js
import { sb } from '../supabase.js?v=4.4';
import { esc, thaiDate, toast, errText, busy, initials } from '../util.js?v=4.4';
import { auth } from '../auth.js?v=4.4';
import { loadUnits, unitName } from '../data.js?v=4.4';
import { onConversationChange, refreshMsgBadge } from './chat.js?v=4.4';

const time = (iso) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const COLS = 'id,unit_id,sender_id,sender_role,sender_name,body,created_at';

const HTML = (isAdmin) => `<div class="${isAdmin ? 'inbox' : 'uc-one'}">
  ${isAdmin ? '<div class="panel"><div class="panel-head"><h2>รพ.สต.</h2></div><div class="list uc-list"></div></div>' : ''}
  <div class="panel chat-panel">
    <div class="uc-head"></div>
    <div class="chat-log uc-log" role="log" aria-live="polite"></div>
    <form class="chat-form uc-form" novalidate><input class="input uc-input" maxlength="1000" placeholder="พิมพ์ข้อความ…" autocomplete="off" aria-label="พิมพ์ข้อความ" disabled><button class="btn btn-p btn-sm uc-send" type="submit" disabled>ส่ง</button></form>
    <p class="small muted">ห้องนี้เห็นเฉพาะเจ้าหน้าที่ รพ.สต. นั้นทุกคน และผู้ดูแล · ห้ามส่งข้อมูลระบุตัวผู้ป่วย (ใช้เมนูเยี่ยมบ้านแทน)</p>
  </div>
</div>`;

let uc = null;   // ห้องที่เปิดอยู่ (มีได้ทีละห้อง)

export function unmountUnitChat() { uc?.close?.(); uc?.off?.(); uc = null; }

export async function mountUnitChat(slot, unit = null) {
  const isAdmin = auth.profile.role === 'admin';
  const side = isAdmin ? 'admin' : 'staff';
  unmountUnitChat();
  const units = await loadUnits();
  slot.innerHTML = HTML(isAdmin);
  const el = (c) => slot.querySelector(c);
  const me = uc = { sel: isAdmin ? null : unit, msgs: [], close: null, off: null };
  const enable = (on) => { el('.uc-input').disabled = !on; el('.uc-send').disabled = !on; };

  function render() {
    const log = el('.uc-log');
    if (!me.msgs.length) { log.innerHTML = `<p class="chat-empty">${isAdmin ? 'ยังไม่มีข้อความ · เริ่มคุยกับ รพ.สต. นี้ได้เลย' : 'ยังไม่มีข้อความ · พิมพ์ถามผู้ดูแลได้เลย'}</p>`; return; }
    let prev = null;
    log.innerHTML = me.msgs.map((m) => {
      const mine = m.sender_role === side, day = !prev || !sameDay(prev.created_at, m.created_at) ? `<div class="chat-day">${esc(thaiDate(m.created_at))}</div>` : '';
      prev = m;
      const who = m.sender_id === auth.profile.id ? '' : `${esc(m.sender_name || (m.sender_role === 'admin' ? 'ผู้ดูแล' : 'เจ้าหน้าที่'))}${m.sender_role === 'admin' && !isAdmin ? ' (ผู้ดูแล)' : ''} · `;
      return `${day}<div class="bubble${mine ? ' me' : ''}" data-mid="${m.id}">${esc(m.body)}<span class="meta">${who}${time(m.created_at)}</span></div>`;
    }).join('');
    log.scrollTop = log.scrollHeight;
  }

  async function loadList() {
    if (!isAdmin) return;
    const { data, error } = await sb.from('unit_chats').select('unit_id,last_message_at,last_message_preview,unread_admin');
    if (me !== uc) return;
    if (error) { el('.uc-list').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
    const m = new Map(data.map((r) => [r.unit_id, r]));
    const last = (u) => m.get(u.id)?.last_message_at || '';
    const list = [...units].sort((a, b) => last(b).localeCompare(last(a)) || a.id - b.id);   // คุยล่าสุดขึ้นก่อน
    el('.uc-list').innerHTML = list.map((u) => {
      const r = m.get(u.id);
      return `<button type="button" class="li-btn${u.id === me.sel ? ' sel' : ''}" data-unit="${u.id}"><span class="avatar" style="width:34px;height:34px;font-size:12px">${esc(initials(u.name))}</span>`
        + `<span class="l" style="min-width:0;flex:1"><b>รพ.สต.${esc(u.name)}</b><span class="small muted conv-last">${esc(r?.last_message_preview || 'ยังไม่มีข้อความ')}</span>`
        + (r?.last_message_at ? `<span class="small muted">${esc(thaiDate(r.last_message_at))} ${time(r.last_message_at)}</span>` : '') + '</span>'
        + (r?.unread_admin ? `<span class="badge num" style="position:static">${r.unread_admin}</span>` : '') + '</button>';
    }).join('');
  }

  async function open(u) {
    me.close?.(); me.close = null;
    me.sel = u;
    slot.querySelectorAll('[data-unit]').forEach((b) => b.classList.toggle('sel', +b.dataset.unit === u));
    el('.uc-head').innerHTML = `<div class="chat-who"><b>${isAdmin ? 'รพ.สต.' + esc(unitName(u)) : 'ผู้ดูแลระบบ · โรงพยาบาลควนกาหลง'}</b><span class="small muted">${isAdmin ? 'คุยกับเจ้าหน้าที่ทุกคนของ รพ.สต. นี้' : 'ถาม/แจ้งเรื่องงานกับผู้ดูแล — เพื่อนร่วมงานใน รพ.สต. เห็นข้อความเดียวกัน'}</span></div>`;
    el('.uc-log').innerHTML = '<div class="skeleton"></div>';
    const { data, error } = await sb.from('unit_messages').select(COLS).eq('unit_id', u).order('created_at', { ascending: false }).limit(300);
    if (me !== uc || me.sel !== u) return;
    if (error) { el('.uc-log').innerHTML = `<p class="chat-empty">${esc(errText(error))}</p>`; return; }
    me.msgs = data.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id));
    render(); enable(true);
    if (isAdmin && window.matchMedia('(max-width: 819px)').matches) el('.chat-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const read = () => sb.rpc('mark_unit_chat_read', { p_unit: u }).then(() => { refreshMsgBadge(); loadList(); });
    read();
    const ch = sb.channel('unitchat-' + u)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'unit_messages', filter: `unit_id=eq.${u}` }, (p) => {
        if (me !== uc || me.msgs.some((x) => x.id === p.new.id)) return;
        me.msgs.push(p.new); render();
        if (p.new.sender_role !== side) read();
      })
      .subscribe();
    me.close = () => sb.removeChannel(ch);
  }

  el('.uc-form').onsubmit = async (e) => {
    e.preventDefault();
    const inp = el('.uc-input'), body = inp.value.trim();
    if (!body || me.sel == null) return;
    const btn = el('.uc-send'); busy(btn, true, '…');
    try {
      const { data, error } = await sb.from('unit_messages').insert({ unit_id: me.sel, body }).select(COLS).single();
      if (error) throw error;
      inp.value = '';
      if (!me.msgs.some((x) => x.id === data.id)) me.msgs.push(data);
      render();
    } catch (err) { toast(errText(err), 'err'); }
    finally { busy(btn, false); inp.focus(); }
  };

  if (isAdmin) {
    el('.uc-list').onclick = (e) => { const b = e.target.closest('[data-unit]'); if (b) open(+b.dataset.unit); };
    me.off = onConversationChange(loadList);
    el('.uc-head').innerHTML = '<p class="small muted">เลือก รพ.สต. ทางซ้ายเพื่อคุย</p>';
    el('.uc-log').innerHTML = '<p class="chat-empty">ยังไม่ได้เลือก รพ.สต.</p>';
    enable(false);
    await loadList();
  } else await open(unit);
}
