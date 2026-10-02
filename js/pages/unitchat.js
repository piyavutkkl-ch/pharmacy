// แชท ผู้ดูแล ⇄ เจ้าหน้าที่ รพ.สต. แยกห้องรายคน (ขั้น 24 + 30) — ตาราง unit_messages (+ staff_id) + staff_threads, Supabase Realtime
//   1 เจ้าหน้าที่ = 1 ห้องกับผู้ดูแล (เพื่อนร่วมหน่วยไม่เห็น) · ข้อความเดิมที่ staff_id = null = ถึงทุกคนใน รพ.สต. (ก่อนแยกห้อง)
//   mountUnitChat(slot, unit)   เจ้าหน้าที่: ห้องของตัวเอง · ผู้ดูแล: แถบเลือก รพ.สต. ด้านบน → ซ้ายรายชื่อเจ้าหน้าที่ → ขวาห้องแชท
//   ตัวเลขยังไม่อ่าน (staff_threads แยกฝั่ง) ล้างด้วย mark_staff_thread_read · รวมบนเมนูใน refreshMsgBadge() ของ chat.js
import { sb } from '../supabase.js?v=4.4';
import { esc, thaiDate, toast, errText, busy, initials } from '../util.js?v=4.4';
import { auth } from '../auth.js?v=4.4';
import { loadUnits, unitName } from '../data.js?v=4.4';
import { onConversationChange, refreshMsgBadge } from './chat.js?v=4.4';

const time = (iso) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const byTime = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id);
const COLS = 'id,unit_id,staff_id,sender_id,sender_role,sender_name,body,created_at';

const CHAT = `<div class="panel chat-panel">
    <div class="uc-head"></div>
    <div class="chat-log uc-log" role="log" aria-live="polite"></div>
    <form class="chat-form uc-form" novalidate><input class="input uc-input" maxlength="1000" placeholder="พิมพ์ข้อความ…" autocomplete="off" aria-label="พิมพ์ข้อความ" disabled><button class="btn btn-p btn-sm uc-send" type="submit" disabled>ส่ง</button></form>
    <p class="small muted">ห้องนี้เห็นเฉพาะเจ้าหน้าที่คนนี้กับผู้ดูแล · ห้ามส่งข้อมูลระบุตัวผู้ป่วย (ใช้เมนูเยี่ยมบ้านแทน)</p>
  </div>`;
const HTML = (isAdmin) => (isAdmin
  ? `<div class="unit-tabs uc-units" role="group" aria-label="เลือก รพ.สต."></div>
     <div class="inbox"><div class="panel"><div class="panel-head"><h2 class="uc-list-title">เจ้าหน้าที่</h2></div><div class="list uc-list"></div></div>${CHAT}</div>`
  : `<div class="uc-one">${CHAT}</div>`);

let uc = null;   // ห้องที่เปิดอยู่ (มีได้ทีละห้อง)

export function unmountUnitChat() { uc?.close?.(); uc?.off?.(); uc = null; }

export async function mountUnitChat(slot, unit = null) {
  const isAdmin = auth.profile.role === 'admin';
  const side = isAdmin ? 'admin' : 'staff';
  unmountUnitChat();
  const units = await loadUnits();
  slot.innerHTML = HTML(isAdmin);
  const el = (c) => slot.querySelector(c);
  const me = uc = { unit: isAdmin ? null : unit, sel: isAdmin ? null : auth.profile.id, msgs: [], staff: [], threads: [], close: null, off: null };
  const enable = (on) => { el('.uc-input').disabled = !on; el('.uc-send').disabled = !on; };
  const staffName = (id) => me.staff.find((s) => s.id === id)?.full_name || me.staff.find((s) => s.id === id)?.email || 'เจ้าหน้าที่';

  function render() {
    const log = el('.uc-log');
    if (!me.msgs.length) { log.innerHTML = `<p class="chat-empty">${isAdmin ? 'ยังไม่มีข้อความ · เริ่มคุยกับเจ้าหน้าที่คนนี้ได้เลย' : 'ยังไม่มีข้อความ · พิมพ์ถามผู้ดูแลได้เลย'}</p>`; return; }
    let prev = null;
    log.innerHTML = me.msgs.map((m) => {
      const mine = m.sender_role === side, day = !prev || !sameDay(prev.created_at, m.created_at) ? `<div class="chat-day">${esc(thaiDate(m.created_at))}</div>` : '';
      prev = m;
      const who = m.sender_id === auth.profile.id ? '' : `${esc(m.sender_name || (m.sender_role === 'admin' ? 'ผู้ดูแล' : 'เจ้าหน้าที่'))}${m.sender_role === 'admin' && !isAdmin ? ' (ผู้ดูแล)' : ''} · `;
      const all = m.staff_id == null ? '<span class="chip c-off">ถึงทุกคนใน รพ.สต.</span> ' : '';
      return `${day}<div class="bubble${mine ? ' me' : ''}" data-mid="${m.id}">${esc(m.body)}<span class="meta">${all}${who}${time(m.created_at)}</span></div>`;
    }).join('');
    log.scrollTop = log.scrollHeight;
  }

  /* ---------- ผู้ดูแล: แถบ รพ.สต. + รายชื่อเจ้าหน้าที่ ---------- */
  async function loadList() {
    if (!isAdmin) return;
    const [t, p] = await Promise.all([
      sb.from('staff_threads').select('staff_id,unit_id,last_message_at,last_message_preview,unread_admin'),
      sb.from('profiles').select('id,full_name,email,unit_id').eq('role', 'staff'),
    ]);
    if (me !== uc) return;
    if (t.error || p.error) { el('.uc-list').innerHTML = `<p class="empty">${esc(errText(t.error || p.error))}</p>`; return; }
    me.threads = t.data; me.staff = p.data;
    const unread = (u) => me.threads.filter((x) => x.unit_id === u).reduce((s, x) => s + (x.unread_admin || 0), 0);
    if (me.unit == null) me.unit = (units.find((u) => unread(u.id)) || units[0])?.id ?? null;   // เปิดหน่วยที่มีข้อความค้างก่อน
    el('.uc-units').innerHTML = units.map((u) => `<button type="button" data-unit="${u.id}" aria-current="${u.id === me.unit}">${esc(u.name)}${unread(u.id) ? ` <span class="badge num">${unread(u.id)}</span>` : ''}</button>`).join('');
    const th = new Map(me.threads.map((x) => [x.staff_id, x]));
    const ids = new Set([...me.staff.filter((s) => s.unit_id === me.unit).map((s) => s.id), ...me.threads.filter((x) => x.unit_id === me.unit).map((x) => x.staff_id)]);
    const people = [...ids].map((id) => ({ id, name: staffName(id), t: th.get(id) }))
      .sort((a, b) => String(b.t?.last_message_at || '').localeCompare(String(a.t?.last_message_at || '')) || a.name.localeCompare(b.name, 'th'));
    el('.uc-list-title').textContent = `เจ้าหน้าที่ รพ.สต.${unitName(me.unit)}`;
    el('.uc-list').innerHTML = people.length ? people.map((x) => `<button type="button" class="li-btn${x.id === me.sel ? ' sel' : ''}" data-staff="${x.id}"><span class="avatar" style="width:34px;height:34px;font-size:12px">${esc(initials(x.name))}</span>`
      + `<span class="l" style="min-width:0;flex:1"><b>${esc(x.name)}</b><span class="small muted conv-last">${esc(x.t?.last_message_preview || 'ยังไม่มีข้อความ')}</span>`
      + (x.t?.last_message_at ? `<span class="small muted">${esc(thaiDate(x.t.last_message_at))} ${time(x.t.last_message_at)}</span>` : '') + '</span>'
      + (x.t?.unread_admin ? `<span class="badge num" style="position:static">${x.t.unread_admin}</span>` : '') + '</button>').join('')
      : '<p class="empty">ยังไม่มีบัญชีเจ้าหน้าที่ของ รพ.สต. นี้ (เพิ่มได้ที่ ตั้งค่า › บัญชีเจ้าหน้าที่)</p>';
  }
  function clearSel() {
    me.close?.(); me.close = null; me.sel = null; me.msgs = [];
    el('.uc-head').innerHTML = '<p class="small muted">เลือกเจ้าหน้าที่ทางซ้ายเพื่อคุย</p>';
    el('.uc-log').innerHTML = '<p class="chat-empty">ยังไม่ได้เลือกเจ้าหน้าที่</p>';
    enable(false);
  }

  /* ---------- เปิดห้อง: staffId = เจ้าหน้าที่ที่คุยด้วย ---------- */
  async function open(staffId) {
    me.close?.(); me.close = null;
    me.sel = staffId;
    const u = isAdmin ? me.unit : unit;
    if (isAdmin) slot.querySelectorAll('[data-staff]').forEach((b) => b.classList.toggle('sel', b.dataset.staff === staffId));
    el('.uc-head').innerHTML = isAdmin
      ? `<div class="chat-who"><b>${esc(staffName(staffId))}</b><span class="small muted">เจ้าหน้าที่ รพ.สต.${esc(unitName(u))} · ห้องส่วนตัวกับผู้ดูแล</span></div>`
      : '<div class="chat-who"><b>ผู้ดูแลระบบ · โรงพยาบาลควนกาหลง</b><span class="small muted">ถาม/แจ้งเรื่องงานกับผู้ดูแล — เห็นเฉพาะคุณกับผู้ดูแล</span></div>';
    el('.uc-log').innerHTML = '<div class="skeleton"></div>';
    const [own, all] = await Promise.all([   // ห้องของคนนี้ + ข้อความเดิมถึงทุกคนในหน่วย
      sb.from('unit_messages').select(COLS).eq('staff_id', staffId).order('created_at', { ascending: false }).limit(300),
      sb.from('unit_messages').select(COLS).eq('unit_id', u).is('staff_id', null).order('created_at', { ascending: false }).limit(100),
    ]);
    if (me !== uc || me.sel !== staffId) return;
    if (own.error || all.error) { el('.uc-log').innerHTML = `<p class="chat-empty">${esc(errText(own.error || all.error))}</p>`; return; }
    me.msgs = [...own.data, ...all.data].sort(byTime);
    render(); enable(true);
    if (isAdmin && window.matchMedia('(max-width: 819px)').matches) el('.chat-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    else el('.uc-input').focus({ preventScroll: true });
    const read = () => sb.rpc('mark_staff_thread_read', { p_staff: staffId }).then(() => { refreshMsgBadge(); loadList(); });
    read();
    const ch = sb.channel('unitchat-' + staffId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'unit_messages', filter: `staff_id=eq.${staffId}` }, (p) => {
        if (me !== uc || me.sel !== staffId || me.msgs.some((x) => x.id === p.new.id)) return;
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
      const row = isAdmin ? { unit_id: me.unit, staff_id: me.sel, body } : { unit_id: unit, body };   // เจ้าหน้าที่: ระบบเติม staff_id = ตัวเอง
      const { data, error } = await sb.from('unit_messages').insert(row).select(COLS).single();
      if (error) throw error;
      inp.value = '';
      if (!me.msgs.some((x) => x.id === data.id)) me.msgs.push(data);
      render();
    } catch (err) { toast(errText(err), 'err'); }
    finally { busy(btn, false); inp.focus(); }
  };

  if (isAdmin) {
    el('.uc-units').onclick = (e) => { const b = e.target.closest('[data-unit]'); if (!b || +b.dataset.unit === me.unit) return; me.unit = +b.dataset.unit; clearSel(); loadList(); };
    el('.uc-list').onclick = (e) => { const b = e.target.closest('[data-staff]'); if (b) open(b.dataset.staff); };
    me.off = onConversationChange(loadList);
    clearSel();
    await loadList();
  } else await open(auth.profile.id);
}
