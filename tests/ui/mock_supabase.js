// ตัวแทน supabase-js แบบจำลองในหน่วยความจำ — ใช้เฉพาะตอนทดสอบหน้าเว็บ (tests/ui/smoke.js)
// ระบบทดสอบส่งไฟล์นี้แทน https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm
// ข้อมูลตั้งต้นมาจาก tests/ui/fixtures.json (สร้างจากโครงสร้างจริงใน supabase/*.sql + tests/ui/seed.sql)
// เลือกผู้ใช้ด้วย ?mockrole=admin|staff|staff3|citizen|citizen2 (ไม่ใส่ = ยังไม่เข้าสู่ระบบ)
// สิ่งที่หน้าเว็บทดสอบอ่านได้: window.__db (ข้อมูล), window.__calls (ทุกคำสั่งที่เรียก), window.__emit(table,row) (จำลอง real-time)
const FIX = await (await fetch('/tests/ui/fixtures.json')).json();
const USERS = { admin: 'admin@hosp.th', staff: 's2@gmail.com', staff3: 's3@gmail.com', citizen: 'c1@gmail.com', citizen2: 'c2@gmail.com' };
const role = new URLSearchParams(location.search).get('mockrole');
const db = (window.__db = structuredClone(FIX));
const ME = role ? db.profiles.find((p) => p.email === USERS[role]) || null : null;
window.__calls = [];
window.__channels = [];
const log = (x) => window.__calls.push(x);
const now = () => new Date().toISOString();
const NUMERIC_ID = new Set(['ai_matches', 'unit_messages', 'visit_summaries', 'delivery_posters', 'staff_requests', 'feedback', 'messages', 'news_comments', 'criteria_items', 'item_status', 'dose_drugs', 'audit_log']);
const err = (message, code) => ({ data: null, error: { message, code } });
/* ---------- บันทึกการเข้าถึงข้อมูลผู้ป่วย (แทน trigger write_audit + log_patient_access) ---------- */
db.audit_log = (db.patients || []).map((pt, i) => ({ id: i + 1, at: pt.created_at, actor_id: pt.created_by, action: 'insert', table_name: 'patients', row_id: pt.id, unit_id: pt.unit_id, patient_id: pt.id, detail: null }));
function audit(action, table, r, detail = null) {
  if (!['patients', 'visits'].includes(table)) return;
  const pid = table === 'patients' ? r.id : r.patient_id;
  db.audit_log.push({ id: newId('audit_log'), at: now(), actor_id: ME?.id, action, table_name: table, row_id: r.id ?? null, unit_id: r.unit_id, patient_id: pid, detail });
}
const fiscalYear = (d) => { const x = new Date(d); return x.getFullYear() + 543 + (x.getMonth() >= 9 ? 1 : 0); };

/* ---------- RLS แบบย่อ (ให้หน้าเว็บเห็นข้อมูลใกล้เคียงของจริง) ---------- */
const isAdmin = () => ME?.role === 'admin';
const isStaff = () => ME?.role === 'staff';
const convOk = (c) => c && (isAdmin() || c.citizen_id === ME?.id || (isStaff() && c.target_unit === ME.unit_id));
function visible(t, r) {
  switch (t) {
    case 'news': return r.status === 'published' || isAdmin() || (ME && r.author_id === ME.id);
    case 'documents': return isAdmin() || (isStaff() && (r.for_unit == null || r.for_unit === ME.unit_id));
    case 'conversations': return convOk(r);
    case 'unit_chats': return isAdmin() || (isStaff() && r.unit_id === ME.unit_id);
    case 'unit_messages': return isAdmin() || (isStaff() && r.unit_id === ME.unit_id && (r.staff_id == null || r.staff_id === ME.id));
    case 'staff_threads': return isAdmin() || (ME && r.staff_id === ME.id);
    case 'messages': return convOk(db.conversations.find((c) => c.id === r.conversation_id));
    case 'patients': case 'visits': return isAdmin() || (isStaff() && r.unit_id === ME.unit_id);
    case 'item_status': return isAdmin() || (isStaff() && r.unit_id === ME.unit_id);
    case 'summary_visits': { const v = db.visits.find((x) => x.id === r.visit_id); return !!v && visible('visits', v); }
    case 'ai_matches': return isAdmin() || (ME && r.user_id === ME.id) || (isStaff() && r.unit_id === ME.unit_id);
    case 'feedback': return isAdmin() || (ME && r.author_id === ME.id);
    case 'staff_requests': return isAdmin() || (ME && r.user_id === ME.id);
    case 'staff_roster': return isAdmin() || (ME && r.email === ME.email);
    case 'profiles': return isAdmin() || (ME && r.id === ME.id) || (isStaff() && db.conversations.some((c) => c.citizen_id === r.id && c.target_unit === ME.unit_id));
    case 'dose_drugs': return r.active || isAdmin();
    default: return true;
  }
}

/* ---------- select: embed เช่น author:profiles!news_author_id_fkey(full_name) ---------- */
function embeds(table, cols) {
  const out = [];
  for (const m of String(cols || '').matchAll(/(\w+):(\w+)(?:!(\w+))?\(([^)]*)\)/g)) {
    const [, alias, target, hint] = m;
    let col = hint ? hint.replace(new RegExp(`^${table}_`), '').replace(/_fkey$/, '') : `${alias}_id`;
    if (!hint && alias === 'author') col = 'author_id';
    out.push({ alias, target, col });
  }
  return out;
}
function withEmbeds(table, rows, cols) {
  const ems = embeds(table, cols);
  if (!ems.length) return rows.map((r) => ({ ...r }));
  return rows.map((r) => {
    const o = { ...r };
    for (const e of ems) {
      const t = db[e.target]?.find((x) => x.id === r[e.col]);
      o[e.alias] = t && visible(e.target, t) ? { ...t } : null;
    }
    return o;
  });
}

/* ---------- ค่าเริ่มต้น/trigger แบบย่อ ---------- */
function newId(table) {
  if (NUMERIC_ID.has(table)) return (db[table] || []).reduce((m, r) => Math.max(m, +r.id || 0), 0) + 1;
  return crypto.randomUUID();
}
function bumpUnitChat(m) {
  const cs = db.unit_chats || (db.unit_chats = []);
  let c = cs.find((x) => x.unit_id === m.unit_id);
  if (!c) { c = { unit_id: m.unit_id, unread_unit: 0, unread_admin: 0 }; cs.push(c); }
  Object.assign(c, { last_message_at: m.created_at, last_message_preview: String(m.body).slice(0, 120) });
  if (m.sender_role === 'admin') c.unread_unit++; else c.unread_admin++;
  if (m.staff_id == null) return;   // ห้องรายคน (staff_threads) — แทน trigger after_unit_message
  const ts = db.staff_threads || (db.staff_threads = []);
  let t = ts.find((x) => x.staff_id === m.staff_id);
  if (!t) { t = { staff_id: m.staff_id, unit_id: m.unit_id, unread_staff: 0, unread_admin: 0 }; ts.push(t); }
  Object.assign(t, { unit_id: m.unit_id, last_message_at: m.created_at, last_message_preview: String(m.body).slice(0, 120) });
  if (m.sender_role === 'admin') t.unread_staff++; else t.unread_admin++;
}
function beforeInsert(table, row) {
  const rows = db[table] || (db[table] = []);
  if (!['news_likes', 'site_stats', 'staff_roster', 'criteria_years'].includes(table) && row.id == null) row.id = newId(table);
  row.created_at ??= now(); row.updated_at ??= now();
  switch (table) {
    case 'news':
      row.author_id = ME.id; row.view_count ??= 0; row.comments_closed ??= false; row.image_path ??= null;
      if (isStaff()) { row.status = 'pending'; row.unit_id = ME.unit_id; } else row.status ??= 'pending';
      if (row.status === 'published') row.published_at = now();
      break;
    case 'achievements': row.author_id = ME.id; break;
    case 'item_status': row.submitted_by = ME.id; row.submitted_at = now(); if (isStaff()) row.status = 'submitted'; row.evidence_paths ??= []; break;
    case 'feedback': row.author_id = ME?.id; row.source = isStaff() ? 'staff' : 'public'; row.unit_id = isStaff() ? ME.unit_id : null; break;
    case 'news_comments': row.author_id = ME.id; row.author_name = ME.full_name; break;
    case 'staff_requests':
      if (ME.role !== 'citizen') return 'new row violates row-level security policy for table "staff_requests"';
      if (rows.some((r) => r.user_id === ME.id && r.status === 'pending')) return 'duplicate key value violates unique constraint "staff_requests_one_pending"';
      Object.assign(row, { user_id: ME.id, email: ME.email, status: 'pending', review_note: null }); break;
    case 'news_likes': row.user_id = ME.id; if (rows.some((l) => l.news_id === row.news_id && l.user_id === ME.id)) return 'duplicate key value violates unique constraint'; break;
    case 'documents': row.created_by = ME.id; row.version ??= 1; break;
    case 'patients': row.created_by = ME.id; break;
    case 'visits': row.unit_id = db.patients.find((p) => p.id === row.patient_id)?.unit_id; row.fiscal_year = fiscalYear(row.visit_date); row.created_by = ME.id; break;
    case 'dose_drugs': row.active ??= true; row.concs ??= []; row.sort ??= 0; break;
    case 'visit_summaries': row.author_id = ME.id; row.gallery ??= []; row.created_at ??= now(); row.summary_date ??= now().slice(0, 10); summaryPeople(row); break;
    case 'staff_roster':
      row.email = String(row.email).trim().toLowerCase(); row.active ??= true;
      if (rows.some((r) => r.email === row.email)) return 'duplicate key value violates unique constraint "staff_roster_pkey"';
      break;
    case 'conversations':
      if (!ME?.phone) return 'new row violates row-level security policy for table "conversations"';
      row.citizen_id = ME.id; row.unread_staff = 0; row.unread_citizen = 0; row.last_message_at = null;
      if (rows.some((c) => c.citizen_id === ME.id && (c.target_unit ?? null) === (row.target_unit ?? null))) return 'duplicate key value violates unique constraint';
      break;
    case 'unit_messages': {   // แทน trigger before/after_unit_message
      if (!(isAdmin() || (isStaff() && row.unit_id === ME.unit_id))) return 'new row violates row-level security policy for table "unit_messages"';
      if (!String(row.body || '').trim()) return 'new row for relation "unit_messages" violates check constraint';
      Object.assign(row, { sender_id: ME.id, sender_role: isAdmin() ? 'admin' : 'staff', sender_name: ME.full_name });
      if (!isAdmin()) row.staff_id = ME.id;
      else if (row.staff_id != null) { const sp = db.profiles.find((x) => x.id === row.staff_id && x.role === 'staff'); if (!sp) return 'ไม่พบเจ้าหน้าที่คนนี้'; row.unit_id = sp.unit_id; }
      row.staff_id ??= null;
      bumpUnitChat(row);
      break;
    }
    case 'messages': {
      const c = db.conversations.find((x) => x.id === row.conversation_id);
      if (!convOk(c)) return 'new row violates row-level security policy for table "messages"';
      if (c.guest_key && row.image_path) return 'ห้องของผู้ไม่ได้ล็อกอิน ส่งรูปไม่ได้';
      Object.assign(row, { sender_id: ME.id, sender_role: c.citizen_id === ME.id ? 'citizen' : 'staff', sender_name: ME.full_name });
      row.body ??= ''; row.image_path ??= null;
      if (!String(row.body).trim() && !row.image_path) return 'new row for relation "messages" violates check constraint "messages_body_check"';
      Object.assign(c, { last_message_at: row.created_at, last_message_preview: String(row.body).trim() ? String(row.body).slice(0, 120) : 'ส่งรูปภาพ' });
      if (row.sender_role === 'citizen') { c.unread_staff++; c.trashed_at = null; } else c.unread_citizen++;
      break;
    }
  }
  return null;
}
function beforeUpdate(table, row, patch) {
  if (table === 'staff_roster' && row.email === ME?.email && (patch.active === false || (patch.role && patch.role !== 'admin')))
    return 'ไม่สามารถลบ ปิดใช้งาน หรือลดสิทธิ์บัญชีของตัวเองได้ — ให้ผู้ดูแลคนอื่นทำแทน';
  if (table === 'item_status' && isStaff()) delete patch.review_files;   // ไฟล์ของผู้ดูแล เจ้าหน้าที่แก้ไม่ได้
  const prev = row.status;
  Object.assign(row, patch, { updated_at: now() });
  if (table === 'news' && isStaff()) row.status = 'pending';
  if (table === 'news' && patch.status === 'published' && !row.published_at) row.published_at = now();
  if (table === 'news' && 'status' in patch) {
    if (['unpublished', 'deleted', 'rejected'].includes(row.status)) { if (prev !== row.status) { row.trashed_at = now(); row.prev_status = prev; } } else row.trashed_at = null;
  }
  if (table === 'item_status' && isStaff()) row.status = 'submitted';
  if (table === 'visit_summaries') summaryPeople(row);
  return null;
}
/** แทน trigger before_summary_people: เก็บเฉพาะผู้ดูแล/เจ้าหน้าที่ + เติมชื่อจาก profiles */
function summaryPeople(row) {
  const ps = [...new Set(row.participant_ids || [])].map((id) => db.profiles.find((p) => p.id === id && ['staff', 'admin'].includes(p.role))).filter(Boolean);
  const ro = (p) => db.staff_roster.find((r) => r.email === String(p.email || '').toLowerCase());
  row.participant_ids = ps.map((p) => p.id); row.participant_names = ps.map((p) => ro(p)?.full_name || p.full_name || 'เจ้าหน้าที่');
  row.participant_positions = ps.map((p) => ro(p)?.position || '');
  row.participant_others = (row.participant_others || []).map((x) => String(x).trim().replace(/\s+/g, ' ')).filter(Boolean).map((x) => x.slice(0, 150));
}

/* ---------- query builder ---------- */
function query(table) {
  const st = { table, op: 'select', cols: '*', filters: [], orders: [], limit: null, single: false, maybe: false, head: false, count: false, payload: null, ret: false };
  const f = (fn) => (c, v) => { st.filters.push([c, v, fn]); return api; };
  const api = {
    select(cols = '*', opts = {}) { if (st.op === 'select') st.cols = cols; else st.ret = true; st.retCols = cols; st.head = !!opts.head; st.count = !!opts.count; return api; },
    eq: f((a, b) => (a ?? null) === b), neq: f((a, b) => (a ?? null) !== b), is: f((a, b) => (a ?? null) === b),
    gt: f((a, b) => a > b), gte: f((a, b) => a >= b), lt: f((a, b) => a < b), lte: f((a, b) => a <= b),
    in(c, arr) { st.filters.push([c, arr, (a, b) => b.includes(a)]); return api; },
    ilike: f((a, b) => new RegExp('^' + String(b).replace(/%/g, '.*') + '$', 'i').test(a ?? '')),
    order(c, o = {}) { st.orders.push([c, o.ascending !== false, o.nullsFirst]); return api; },
    limit(n) { st.limit = n; return api; }, range(a, b) { st.range = [a, b]; return api; },
    single() { st.single = true; return api; }, maybeSingle() { st.maybe = true; return api; },
    insert(p) { st.op = 'insert'; st.payload = p; return api; }, upsert(p) { st.op = 'upsert'; st.payload = p; return api; },
    update(p) { st.op = 'update'; st.payload = p; return api; }, delete() { st.op = 'delete'; return api; },
    then(res, rej) { return Promise.resolve().then(() => run(st)).then(res, rej); },
  };
  return api;
}
function finish(st, rows) {
  if (st.single || st.maybe) {
    if (rows.length === 1) return { data: rows[0], error: null };
    if (st.maybe && !rows.length) return { data: null, error: null };
    return err(`JSON object requested, multiple (or no) rows returned`, 'PGRST116');
  }
  return { data: rows, error: null };
}
function run(st) {
  const { table } = st;
  log({ table, op: st.op, payload: st.payload, filters: st.filters.map(([c, v]) => [c, v]) });
  const rows = db[table] || (db[table] = []);
  const match = (r) => st.filters.every(([c, v, fn]) => fn(r[c], v));
  if (st.op === 'insert' || st.op === 'upsert') {
    if (!ME) return err('new row violates row-level security policy', '42501');
    const list = (Array.isArray(st.payload) ? st.payload : [st.payload]).map((p) => ({ ...structuredClone(p) }));
    for (const r of list) { const e = beforeInsert(table, r); if (e) return err(e, /duplicate/.test(e) ? '23505' : '42501'); }
    const PK = { site_texts: ['key'], delivery_stats: ['fiscal_year', 'unit_id'], rider_stats: ['fiscal_year', 'unit_id'], rider_units: ['unit_id'] }[table];
    if (st.op === 'upsert' && PK) for (const r of list) { const i = rows.findIndex((x) => PK.every((k) => x[k] === r[k])); if (i >= 0) rows.splice(i, 1); }
    rows.push(...list);
    list.forEach((r) => audit('insert', table, r));
    return finish(st, st.ret ? withEmbeds(table, list, st.retCols) : []);
  }
  if (st.op === 'update') {
    const hit = rows.filter((r) => match(r) && visible(table, r));
    for (const r of hit) { const e = beforeUpdate(table, r, structuredClone(st.payload)); if (e) return err(e, 'P0001'); audit('update', table, r, Object.keys(st.payload).sort().join(',')); }
    return finish(st, st.ret ? withEmbeds(table, hit, st.retCols) : []);
  }
  if (st.op === 'delete') {
    if (table === 'staff_roster' && rows.some((r) => match(r) && r.email === ME?.email)) return err('ไม่สามารถลบบัญชีของตัวเองได้', 'P0001');
    rows.filter((r) => match(r) && visible(table, r)).forEach((r) => audit('delete', table, r, table === 'patients' ? `ชื่อ ${r.first_name} ${r.last_name}` : null));
    db[table] = rows.filter((r) => !(match(r) && visible(table, r)));
    return { data: null, error: null };
  }
  let out = rows.filter((r) => match(r) && visible(table, r));
  for (const [c, asc, nf] of [...st.orders].reverse()) {
    out = [...out].sort((a, b) => {
      const x = a[c] ?? null, y = b[c] ?? null;
      if (x === y) return 0;
      if (x === null) return nf ?? !asc ? -1 : 1;
      if (y === null) return nf ?? !asc ? 1 : -1;
      return (x < y ? -1 : 1) * (asc ? 1 : -1);
    });
  }
  if (st.head) return { data: null, count: out.length, error: null };
  const count = out.length;
  if (st.range) out = out.slice(st.range[0], st.range[1] + 1);
  if (st.limit != null) out = out.slice(0, st.limit);
  const res = finish(st, withEmbeds(table, out, st.cols));
  if (st.count) res.count = count;
  return res;
}

/* ---------- ฟังก์ชันในฐานข้อมูล (rpc) ---------- */
function rpc(name, a = {}) {
  log({ rpc: name, args: a });
  switch (name) {
    case 'public_tracking_stats': {
      const v = db.visits.filter((x) => x.fiscal_year === a.p_year && (a.p_unit == null || x.unit_id === a.p_unit));
      const drps = (list) => list.reduce((s, x) => s + (x.drps?.length || 0), 0);
      return { data: [{ visits: v.length, drps_found: drps(v), drps_resolved: drps(v.filter((x) => x.drp_resolved)), excess_resolved: 0 }], error: null };
    }
    case 'public_unit_scores': {
      const items = new Set(db.criteria_items.filter((i) => i.fiscal_year === a.p_year).map((i) => i.id));
      return { data: db.units.map((u) => ({ unit_id: u.id, unit_name: u.name, score: db.item_status.filter((s) => s.unit_id === u.id && s.status === 'approved' && items.has(s.item_id)).length, max_score: items.size }))
        .sort((x, y) => y.score - x.score || x.unit_id - y.unit_id), error: null };
    }
    case 'bump_home_views': { const s = db.site_stats.find((x) => x.key === 'home_views'); s.count = (+s.count || 0) + 1; return { data: s.count, error: null }; }
    case 'bump_news_view': { const n = db.news.find((x) => x.id === a.p_news); if (n) n.view_count++; return { data: null, error: null }; }
    case 'start_fiscal_year': {
      if (!isAdmin()) return err('ไม่มีสิทธิ์', '42501');
      if (db.criteria_items.some((i) => i.fiscal_year === a.p_year)) return err(`ปีงบ ${a.p_year} มีเกณฑ์อยู่แล้ว`, 'P0001');
      const src = db.criteria_items.filter((i) => i.fiscal_year === a.p_year - 1);
      let id = newId('criteria_items');
      src.forEach((i) => db.criteria_items.push({ ...i, id: id++, fiscal_year: a.p_year }));
      db.criteria_years.push({ fiscal_year: a.p_year, created_at: now() });
      return { data: src.length, error: null };
    }
    case 'bump_doc_download': {
      const st = (db.document_stats ||= []), r = st.find((x) => x.doc_id === a.p_doc);
      if (r) r.downloads++; else st.push({ doc_id: a.p_doc, downloads: 1 });
      return { data: (r || st[st.length - 1]).downloads, error: null };
    }
    case 'approve_staff_request': case 'reject_staff_request': {
      if (!isAdmin()) return err('ไม่มีสิทธิ์', '42501');
      const r = db.staff_requests.find((x) => x.id === a.p_id && x.status === 'pending');
      if (!r) return err('ไม่พบคำขอที่รออนุมัติ', 'P0001');
      if (name === 'reject_staff_request') { Object.assign(r, { status: 'rejected', review_note: a.p_note || null }); return { data: null, error: null }; }
      Object.assign(r, { status: 'approved', unit_id: a.p_unit ?? r.unit_id });
      db.staff_roster.push({ email: r.email, full_name: r.full_name, role: 'staff', unit_id: r.unit_id, phone: r.phone, active: true, created_at: now(), updated_at: now() });
      return { data: null, error: null };
    }
    case 'withdraw_item_status': {
      const s = db.item_status.find((x) => x.id === a.p_id);
      if (!s || !(isStaff() && s.unit_id === ME.unit_id)) return err('ไม่มีสิทธิ์', '42501');
      if (s.status !== 'submitted') return err('ยกเลิกได้เฉพาะข้อที่ส่งแล้วและยังรอตรวจ', 'P0001');
      s.status = s.review_comment && s.reviewed_at ? 'fix' : 'none'; s.submitted_at = null;
      return { data: s.status, error: null };
    }
    case 'mark_conversation_read': {
      const c = db.conversations.find((x) => x.id === a.p_conv);
      if (!convOk(c)) return err('ไม่มีสิทธิ์', 'P0001');
      if (c.citizen_id === ME.id) c.unread_citizen = 0; else c.unread_staff = 0;
      return { data: null, error: null };
    }
    case 'news_like_state': {   // แทน news_like_state(): ถูกใจของผู้ login + ของเครื่องที่ไม่ login
      const anon = (db.news_anon_likes || []).filter((x) => x.news_id === a.p_news && x.liked);
      const logged = (db.news_likes || []).filter((x) => x.news_id === a.p_news);
      return { data: [{ total: anon.length + logged.length, mine: logged.some((x) => x.user_id === ME?.id) || anon.some((x) => x.token === a.p_token) }], error: null };
    }
    case 'like_news_anon': {
      const n = db.news.find((x) => x.id === a.p_news && x.status === 'published');
      if (!n || !a.p_token) return err('ไม่พบข่าวนี้', 'P0001');
      const L = db.news_anon_likes || (db.news_anon_likes = []);
      const r = L.find((x) => x.news_id === a.p_news && x.token === a.p_token);
      if (r) r.liked = a.p_on; else L.push({ news_id: a.p_news, token: a.p_token, liked: a.p_on });
      return { data: L.filter((x) => x.news_id === a.p_news && x.liked).length + (db.news_likes || []).filter((x) => x.news_id === a.p_news).length, error: null };
    }
    case 'comment_news_anon': {
      const b = String(a.p_body || '').trim(), n = db.news.find((x) => x.id === a.p_news && x.status === 'published' && !x.comments_closed);
      if (!b) return err('กรุณาพิมพ์ความคิดเห็น', 'P0001');
      if ([...b].length > 15) return err('กรุณาเข้าสู่ระบบเพื่อเขียนแสดงความเห็นมากขึ้น (ไม่ได้เข้าสู่ระบบ พิมพ์ได้ไม่เกิน 15 ตัวอักษร)', 'P0001');
      if (!n) return err('ข่าวนี้ปิดรับความคิดเห็นแล้ว', 'P0001');
      const row = { id: newId('news_comments'), news_id: a.p_news, author_id: null, author_name: 'ผู้เยี่ยมชม', body: b, created_at: now() };
      db.news_comments.push(row);
      return { data: row.id, error: null };
    }
    case 'purge_guest_chats': return { data: 0, error: null };
    case 'guest_chat_send': {   // แทน guest_chat_send(): แชทแบบไม่ต้องล็อกอิน (≤15 ตัวอักษร · วันละ 20 ข้อความ)
      if (ME) return err('เข้าสู่ระบบแล้ว กรุณาใช้แชทในหน้า "ของฉัน"', 'P0001');
      const name = String(a.p_name || '').trim(), b = String(a.p_body || '').trim(), k = 'g:' + a.p_token;
      if (!a.p_token) return err('ไม่พบรหัสเครื่อง กรุณารีเฟรชหน้า', 'P0001');
      if (!name || [...name].length > 30) return err('กรุณาใส่ชื่อเล่น (ไม่เกิน 30 ตัวอักษร)', 'P0001');
      if (!b) return err('กรุณาพิมพ์ข้อความ', 'P0001');
      if ([...b].length > 15) return err('กรุณาเข้าสู่ระบบเพื่อแชทต่อ (ยังไม่ได้ล็อกอิน พิมพ์ได้ข้อความละไม่เกิน 15 ตัวอักษร)', 'P0001');
      const mine = new Set(db.conversations.filter((c) => c.guest_key === k).map((c) => c.id));
      if (db.messages.filter((m) => mine.has(m.conversation_id) && m.sender_role === 'citizen' && Date.now() - Date.parse(m.created_at) < 864e5).length >= 20)
        return err('กรุณาเข้าสู่ระบบเพื่อแชทต่อ (ยังไม่ได้ล็อกอิน ส่งได้วันละ 20 ข้อความ)', 'P0001');
      let c = db.conversations.find((x) => x.guest_key === k && (x.target_unit ?? null) === (a.p_target ?? null));
      if (!c) { c = { id: crypto.randomUUID(), citizen_id: null, target_unit: a.p_target ?? null, guest_key: k, guest_name: name, unread_staff: 0, unread_citizen: 0, last_message_at: null, trashed_at: null, created_at: now() }; db.conversations.push(c); }
      c.guest_name = name;
      const row = { id: newId('messages'), conversation_id: c.id, sender_id: null, sender_role: 'citizen', sender_name: name, body: b, image_path: null, created_at: now() };
      db.messages.push(row);
      Object.assign(c, { last_message_at: row.created_at, last_message_preview: b, trashed_at: null }); c.unread_staff++;
      return { data: { id: row.id, sender_role: 'citizen', sender_name: name, body: b, created_at: row.created_at }, error: null };
    }
    case 'guest_chat_fetch': {
      const c = db.conversations.find((x) => x.guest_key === 'g:' + a.p_token && (x.target_unit ?? null) === (a.p_target ?? null));
      if (!c) return { data: [], error: null };
      c.unread_citizen = 0;
      const list = db.messages.filter((m) => m.conversation_id === c.id).sort((x, y) => (x.created_at < y.created_at ? -1 : x.created_at > y.created_at ? 1 : x.id - y.id));
      return { data: list.map(({ id, sender_role, sender_name, body, created_at }) => ({ id, sender_role, sender_name, body, created_at })), error: null };
    }
    case 'guest_chat_list':
      return { data: db.conversations.filter((x) => x.guest_key === 'g:' + a.p_token).map((c) => ({ target_unit: c.target_unit ?? null, unread: c.unread_citizen, last_message_at: c.last_message_at })), error: null };
    case 'transfer_patient': {   // แทน transfer_patient(): ย้ายผู้ป่วย + บันทึกเยี่ยมไปหน่วยใหม่
      const pt = db.patients.find((x) => x.id === a.p_patient);
      if (!pt) return err('ไม่พบผู้ป่วย', 'P0001');
      if (!(isAdmin() || (isStaff() && pt.unit_id === ME.unit_id))) return err('ไม่มีสิทธิ์', 'P0001');
      if (!db.units.some((u) => u.id === a.p_unit)) return err('ไม่พบ รพ.สต. ปลายทาง', 'P0001');
      Object.assign(pt, { unit_id: a.p_unit, home_unit_id: a.p_unit });
      db.visits.filter((v) => v.patient_id === pt.id).forEach((v) => { v.unit_id = a.p_unit; });
      audit('update', 'patients', pt, 'home_unit_id,unit_id');
      return { data: a.p_unit, error: null };
    }
    case 'trash_conversation': {
      const c = db.conversations.find((x) => x.id === a.p_conv);
      if (!convOk(c) || c.citizen_id === ME.id || !(isAdmin() || isStaff())) return err('ไม่มีสิทธิ์', 'P0001');
      c.trashed_at = a.p_trash ? now() : null; if (a.p_trash) c.unread_staff = 0;
      return { data: c.trashed_at, error: null };
    }
    case 'mark_staff_thread_read': {
      const t = (db.staff_threads || []).find((x) => x.staff_id === a.p_staff);
      if (!(isAdmin() || (isStaff() && a.p_staff === ME.id))) return err('ไม่มีสิทธิ์', 'P0001');
      if (t) { if (isAdmin()) t.unread_admin = 0; else t.unread_staff = 0; }
      return { data: null, error: null };
    }
    case 'mark_unit_chat_read': {
      const c = (db.unit_chats || []).find((x) => x.unit_id === a.p_unit);
      if (!(isAdmin() || (isStaff() && a.p_unit === ME.unit_id))) return err('ไม่มีสิทธิ์', 'P0001');
      if (c) { if (isAdmin()) c.unread_admin = 0; else c.unread_unit = 0; }
      return { data: null, error: null };
    }
    case 'log_patient_access': {
      const u = a.p_patient ? db.patients.find((x) => x.id === a.p_patient)?.unit_id : a.p_unit;
      if (!(isAdmin() || (isStaff() && u === ME.unit_id))) return err('ไม่มีสิทธิ์', '42501');
      audit(a.p_patient ? 'view' : 'list', 'patients', { id: a.p_patient ?? null, unit_id: u });
      return { data: null, error: null };
    }
    case 'admin_audit_log': {
      if (!isAdmin()) return err('ไม่มีสิทธิ์', '42501');
      const q = (a.p_q || '').trim().toLowerCase();
      const out = db.audit_log.map((r) => {
        const pt = db.patients.find((x) => x.id === r.patient_id), pr = db.profiles.find((x) => x.id === r.actor_id);
        return { ...r, unit_name: db.units.find((x) => x.id === r.unit_id)?.name ?? null, patient_name: pt ? `${pt.first_name} ${pt.last_name}` : null,
          actor_name: pr?.full_name ?? null, actor_email: pr?.email ?? null, actor_role: pr?.role ?? null };
      }).filter((r) => (!a.p_unit || r.unit_id === a.p_unit)
        && (!a.p_action || r.action === a.p_action || (a.p_action === 'read' && ['list', 'view'].includes(r.action)))
        && (!a.p_from || r.at.slice(0, 10) >= a.p_from) && (!a.p_to || r.at.slice(0, 10) <= a.p_to)
        && (!q || `${r.patient_name} ${r.actor_name} ${r.actor_email} ${r.detail}`.toLowerCase().includes(q)))
        .sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : y.id - x.id));
      return { data: out.slice(a.p_offset || 0, (a.p_offset || 0) + (a.p_limit || 200)).map((r) => ({ ...r, total: out.length })), error: null };
    }
    /* แทน ai_match_* (37_ai_match.sql): ตอบ "รอ" 1 รอบก่อนได้ผล · จับคู่ข้อเกณฑ์ด้วยตัวอักษร 3 ตัวที่ซ้ำกัน (ของจริงใช้ Gemini) */
    case 'ai_match_start': {
      if (!isStaff() && !isAdmin()) return err('ไม่มีสิทธิ์', '42501');
      const t = String(a.p_text || '').trim();
      if (t.length < 10) return err('กรุณาพิมพ์รายละเอียดผลงานก่อน (อย่างน้อย 10 ตัวอักษร)', 'P0001');
      const ach = a.p_achievement && db.achievements.find((x) => x.id === a.p_achievement);
      const L = (db.ai_matches ||= []), row = { id: newId('ai_matches'), user_id: ME.id, unit_id: ach ? ach.unit_id : ME.unit_id, achievement_id: a.p_achievement || null,
        fiscal_year: fiscalYear(now()), input: t, status: 'pending', matches: [], note: null, created_at: now(), polls: 0 };
      L.push(row); return { data: row.id, error: null };
    }
    case 'ai_match_poll': {
      const r = (db.ai_matches || []).find((x) => x.id === a.p_id);
      if (!r || !(isAdmin() || r.user_id === ME?.id || (isStaff() && r.unit_id === ME.unit_id))) return err('ไม่พบรายการนี้', 'P0001');
      if (r.status === 'pending' && ++r.polls >= 2) {
        const g = (x) => { const c = String(x).replace(/\s+/g, ''), o = new Set(); for (let i = 0; i + 3 <= c.length; i++) o.add(c.slice(i, i + 3)); return o; };
        const gi = g(r.input);
        r.matches = db.criteria_items.filter((i) => i.fiscal_year === r.fiscal_year)
          .map((i) => { const gb = g(i.body); let n = 0; gb.forEach((x) => { if (gi.has(x)) n++; }); return { i, sc: gb.size ? n / gb.size : 0 }; })
          .filter((x) => x.sc >= 0.2).sort((x, y) => y.sc - x.sc).slice(0, 3)
          .map(({ i }) => ({ item_id: i.id, item_no: i.item_no, reason: `ผลงานสอดคล้องกับ "${i.body.slice(0, 40)}"` }));
        r.status = 'done'; r.done_at = now();
      }
      return { data: { id: r.id, status: r.status, matches: r.matches, note: r.note, achievement_id: r.achievement_id }, error: null };
    }
    case 'staff_directory': {
      if (!isStaff() && !isAdmin()) return err('ไม่มีสิทธิ์', '42501');
      const ro = (email) => db.staff_roster.find((r) => r.email === String(email || '').toLowerCase());
      const joined = db.profiles.filter((p) => ['staff', 'admin'].includes(p.role)).map((p) => ({ id: p.id, full_name: ro(p.email)?.full_name || p.full_name || 'เจ้าหน้าที่', role: p.role, unit_id: p.unit_id, joined: true, position: ro(p.email)?.position || null }));
      const pending = db.staff_roster.filter((r) => r.active && !db.profiles.some((p) => String(p.email || '').toLowerCase() === r.email)).map((r) => ({ id: null, full_name: r.full_name, role: r.role, unit_id: r.unit_id, joined: false, position: r.position || null }));
      return { data: [...joined, ...pending].sort((a, b) => (a.role !== 'admin') - (b.role !== 'admin') || (a.unit_id ?? 0) - (b.unit_id ?? 0) || a.full_name.localeCompare(b.full_name, 'th')), error: null };
    }
    /* แทน summary_visit_list/detail (41_summary_visit_access.sql): ทุกเจ้าหน้าที่เห็นรายการ · ชื่อเต็ม/รายละเอียด = ผู้ร่วมลง/หน่วยที่ดูแล/ผู้ดูแล */
    case 'summary_visit_list': case 'summary_visit_detail': {
      if (!isStaff() && !isAdmin()) return err('ไม่มีสิทธิ์', '42501');
      const s = db.visit_summaries.find((x) => x.id === a.p_summary);
      const okFor = (v) => isAdmin() || (isStaff() && v.unit_id === ME.unit_id) || (s?.participant_ids || []).includes(ME.id);
      const links = (db.summary_visits || []).filter((l) => s && l.summary_id === s.id);
      if (name === 'summary_visit_detail') {
        const v = links.some((l) => l.visit_id === a.p_visit) && db.visits.find((x) => x.id === a.p_visit);
        if (!v) return err('ไม่พบรายการเยี่ยมนี้ในสรุปผลงาน', 'P0001');
        if (!okFor(v)) return err('ไม่มีสิทธิ์ดูรายละเอียด (เฉพาะผู้ร่วมลง เจ้าหน้าที่ รพ.สต. ที่ดูแล และผู้ดูแล)', '42501');
        const p = db.patients.find((x) => x.id === v.patient_id);
        return { data: { ...v, name: `${p.first_name} ${p.last_name}`, photos: (v.photo_paths || []).length, own: isAdmin() || (isStaff() && v.unit_id === ME.unit_id) }, error: null };
      }
      return { data: links.map((l) => {
        const v = db.visits.find((x) => x.id === l.visit_id), p = v && db.patients.find((x) => x.id === v.patient_id);
        if (!p) return null;
        const ok = okFor(v);
        return { visit_id: v.id, visit_date: v.visit_date, unit_id: v.unit_id, display_name: ok ? `${p.first_name} ${p.last_name}` : `${p.first_name.trim()}****`, can_open: ok };
      }).filter(Boolean).sort((x, y) => String(y.visit_date).localeCompare(String(x.visit_date))), error: null };
    }
    case 'summary_patient_count': {
      const vs = (db.summary_visits || []).filter((l) => l.summary_id === a.p_summary).map((l) => db.visits.find((v) => v.id === l.visit_id)?.patient_id).filter(Boolean);
      return { data: new Set(vs).size, error: null };
    }
    case 'ai_match_link': {
      const r = (db.ai_matches || []).find((x) => x.id === a.p_id && x.user_id === ME?.id), ach = db.achievements.find((x) => x.id === a.p_achievement);
      if (!r || !ach) return err('ไม่พบรายการนี้', 'P0001');
      Object.assign(r, { achievement_id: ach.id, unit_id: ach.unit_id }); return { data: null, error: null };
    }
    default: return err(`function ${name} not found in mock`, 'PGRST202');
  }
}

/* ---------- real-time ---------- */
window.__emit = (table, row) => {
  if (table === 'messages') {
    db.messages.push(row);
    const c = db.conversations.find((x) => x.id === row.conversation_id);
    if (c) { c.last_message_at = row.created_at; c.last_message_preview = row.body; if (row.sender_role === 'citizen') c.unread_staff++; else c.unread_citizen++; }
  }
  if (table === 'unit_messages') { db.unit_messages.push(row); bumpUnitChat(row); }
  for (const ch of window.__channels) for (const [flt, cb] of ch.hs) {
    if (flt.table === table && (!flt.filter || flt.filter === `conversation_id=eq.${row.conversation_id}` || flt.filter === `unit_id=eq.${row.unit_id}` || flt.filter === `staff_id=eq.${row.staff_id}`)) cb({ new: row, eventType: 'INSERT' });
    if (flt.table === 'conversations' && table === 'messages') cb({ new: {}, eventType: 'UPDATE' });
    if ((flt.table === 'unit_chats' || flt.table === 'staff_threads') && table === 'unit_messages') cb({ new: {}, eventType: 'UPDATE' });
  }
};

export function createClient(url, key) {
  log({ createClient: [url, key] });
  const session = ME ? { user: { id: ME.id, email: ME.email } } : null;
  const files = (window.__files = {}), blobs = new Map();
  const PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#dce4e8"/><text x="200" y="160" font-size="22" text-anchor="middle" fill="#4f636d">ไฟล์ตัวอย่าง</text></svg>');
  const blobUrl = (key) => { const b = blobs.get(key); if (!b) return null; b.url ??= URL.createObjectURL(b.blob); return b.url; };
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOAuth: async (a) => { log({ oauth: a }); return { error: null }; },
      signOut: async () => { log({ signout: true }); return { error: null }; },
    },
    from: query,
    rpc: async (n, a) => rpc(n, a),
    channel(name) {
      const ch = { name, hs: [], on(type, flt, cb) { ch.hs.push([flt, cb]); return ch; }, subscribe() { window.__channels.push(ch); log({ subscribe: name }); return ch; } };
      return ch;
    },
    removeChannel(ch) { window.__channels = window.__channels.filter((x) => x !== ch); log({ unsubscribe: ch.name }); },
    storage: {
      from: (bucket) => ({
        getPublicUrl: (p) => ({ data: { publicUrl: blobUrl(`${bucket}/${p}`) || `https://img.test/${bucket}/${p}` } }),
        upload: async (path, blob, o = {}) => { log({ upload: bucket, path, size: blob.size, type: o.contentType }); files[`${bucket}/${path}`] = blob.size; blobs.set(`${bucket}/${path}`, { blob }); return { data: { path }, error: null }; },
        remove: async (paths) => { log({ remove: bucket, paths }); return { data: null, error: null }; },
        move: async (from, to) => { log({ move: bucket, from, to }); return { data: null, error: null }; },
        createSignedUrl: async (p, sec, o) => { log({ signed: bucket, path: p, opts: o }); return { data: { signedUrl: blobUrl(`${bucket}/${p}`) || PLACEHOLDER }, error: null }; },
      }),
    },
  };
}
