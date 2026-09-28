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
const NUMERIC_ID = new Set(['feedback', 'messages', 'news_comments', 'criteria_items', 'item_status', 'dose_drugs', 'audit_log']);
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
    case 'messages': return convOk(db.conversations.find((c) => c.id === r.conversation_id));
    case 'patients': case 'visits': return isAdmin() || (isStaff() && r.unit_id === ME.unit_id);
    case 'item_status': return isAdmin() || (isStaff() && r.unit_id === ME.unit_id);
    case 'feedback': return isAdmin() || (ME && r.author_id === ME.id);
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
    case 'news_likes': row.user_id = ME.id; if (rows.some((l) => l.news_id === row.news_id && l.user_id === ME.id)) return 'duplicate key value violates unique constraint'; break;
    case 'documents': row.created_by = ME.id; row.version ??= 1; break;
    case 'patients': row.created_by = ME.id; break;
    case 'visits': row.unit_id = db.patients.find((p) => p.id === row.patient_id)?.unit_id; row.fiscal_year = fiscalYear(row.visit_date); row.created_by = ME.id; break;
    case 'dose_drugs': row.active ??= true; row.concs ??= []; row.sort ??= 0; break;
    case 'staff_roster':
      row.email = String(row.email).trim().toLowerCase(); row.active ??= true;
      if (rows.some((r) => r.email === row.email)) return 'duplicate key value violates unique constraint "staff_roster_pkey"';
      break;
    case 'conversations':
      if (!ME?.phone) return 'new row violates row-level security policy for table "conversations"';
      row.citizen_id = ME.id; row.unread_staff = 0; row.unread_citizen = 0; row.last_message_at = null;
      if (rows.some((c) => c.citizen_id === ME.id && (c.target_unit ?? null) === (row.target_unit ?? null))) return 'duplicate key value violates unique constraint';
      break;
    case 'messages': {
      const c = db.conversations.find((x) => x.id === row.conversation_id);
      if (!convOk(c)) return 'new row violates row-level security policy for table "messages"';
      Object.assign(row, { sender_id: ME.id, sender_role: c.citizen_id === ME.id ? 'citizen' : 'staff', sender_name: ME.full_name });
      Object.assign(c, { last_message_at: row.created_at, last_message_preview: String(row.body).slice(0, 120) });
      if (row.sender_role === 'citizen') c.unread_staff++; else c.unread_citizen++;
      break;
    }
  }
  return null;
}
function beforeUpdate(table, row, patch) {
  if (table === 'staff_roster' && row.email === ME?.email && (patch.active === false || (patch.role && patch.role !== 'admin')))
    return 'ไม่สามารถลบ ปิดใช้งาน หรือลดสิทธิ์บัญชีของตัวเองได้ — ให้ผู้ดูแลคนอื่นทำแทน';
  Object.assign(row, patch, { updated_at: now() });
  if (table === 'news' && isStaff()) row.status = 'pending';
  if (table === 'news' && patch.status === 'published' && !row.published_at) row.published_at = now();
  if (table === 'item_status' && isStaff()) row.status = 'submitted';
  return null;
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
    case 'mark_conversation_read': {
      const c = db.conversations.find((x) => x.id === a.p_conv);
      if (!convOk(c)) return err('ไม่มีสิทธิ์', 'P0001');
      if (c.citizen_id === ME.id) c.unread_citizen = 0; else c.unread_staff = 0;
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
  for (const ch of window.__channels) for (const [flt, cb] of ch.hs) {
    if (flt.table === table && (!flt.filter || flt.filter === `conversation_id=eq.${row.conversation_id}`)) cb({ new: row, eventType: 'INSERT' });
    if (flt.table === 'conversations' && table === 'messages') cb({ new: {}, eventType: 'UPDATE' });
  }
};

export function createClient(url, key) {
  log({ createClient: [url, key] });
  const session = ME ? { user: { id: ME.id, email: ME.email } } : null;
  const files = (window.__files = {});
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
        getPublicUrl: (p) => ({ data: { publicUrl: `https://img.test/${bucket}/${p}` } }),
        upload: async (path, blob, o = {}) => { log({ upload: bucket, path, size: blob.size, type: o.contentType }); files[`${bucket}/${path}`] = blob.size; return { data: { path }, error: null }; },
        remove: async (paths) => { log({ remove: bucket, paths }); return { data: null, error: null }; },
        move: async (from, to) => { log({ move: bucket, from, to }); return { data: null, error: null }; },
        createSignedUrl: async (p, sec, o) => { log({ signed: bucket, path: p, opts: o }); return { data: { signedUrl: `https://signed.test/${bucket}/${p}` }, error: null }; },
      }),
    },
  };
}
