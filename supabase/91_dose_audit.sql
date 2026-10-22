-- =====================================================================
--  ขั้นที่ 91: AI ตรวจย้อนหลังข้อมูลขนาดยาที่อนุมัติแล้ว (เจ้าของเว็บ 22 ต.ค. 2569) · รันซ้ำได้ · เพิ่มอย่างเดียว (ไม่ลบข้อมูล)
--   ทุกคืน (00:00–05:59 น. เวลาไทย · ผ่าน ai_auto_tick ทุกนาที) AI หยิบยาที่อนุมัติแล้วทีละตัว เทียบทุกข้อบ่งใช้กับฉลาก OpenFDA+DailyMed ที่ผูกไว้
--   ตรวจซ้ำเมื่อยังไม่เคยตรวจ / อนุมัติใหม่หลังตรวจครั้งก่อน / ตรวจครั้งก่อนเกิน 30 วัน · ไม่มีฉลาก = ข้าม (ไม่ส่งข้อความ MIMS)
--   ผล → dose_drugs.audit_flags [{name, level, why, quote, at}] (ระบบใส่เท่านั้น · ประชาชนอ่านได้เพราะหน้าคำนวณใช้ตัดสินการแสดง)
--     level 'wrong' = ตัวเลขขัดกับฉลากชัดเจน + ข้อความฉลากที่อ้างมีอยู่จริง → หน้าคำนวณหยุดแสดงตัวเลขข้อนั้นทันทีจนเภสัชกรตรวจ (แบบ ข)
--     level 'doubt' = สงสัย / อ้างข้อความที่ไม่พบในฉลาก → ยังแสดงตามเดิม เตือนเฉพาะผู้ดูแล (แบบ ก)
--   ล้างธง: ผู้ดูแลกด "ตรวจแล้ว ข้อมูลถูกต้อง" (dose_audit_resolve) หรือแก้ข้อมูลแล้วอนุมัติใหม่ (trigger ล้างให้)
-- =====================================================================

alter table public.dose_drugs add column if not exists audit_flags jsonb not null default '[]';
alter table public.dose_drugs drop constraint if exists dose_drugs_audit_flags_check;
alter table public.dose_drugs add constraint dose_drugs_audit_flags_check check (jsonb_typeof(audit_flags) = 'array' and octet_length(audit_flags::text) <= 40000);

create table if not exists public.dose_audits (
  id          bigint generated always as identity primary key,
  dose_id     bigint references public.dose_drugs(id) on delete cascade,
  local_id    int references public.local_drugs(id) on delete set null,
  inds        jsonb not null default '[]',
  src         text,
  request_id  bigint,
  ai_job      bigint,
  sent_at     timestamptz,
  status      text not null default 'pending' check (status in ('pending', 'done', 'error')),
  result      jsonb,
  note        text,
  by_user     uuid,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists dose_audits_dose on public.dose_audits (dose_id, created_at desc);
alter table public.dose_audits enable row level security;
drop policy if exists dau_read on public.dose_audits;
create policy dau_read on public.dose_audits for select to authenticated using (public.is_admin());
revoke all on public.dose_audits from anon, authenticated;
grant select on public.dose_audits to authenticated;
grant all on public.dose_audits to service_role;

/** trigger อนุมัติ (90) + ธง AI ตรวจย้อนหลัง: ธงระบบใส่เท่านั้น · อนุมัติใหม่ = เภสัชกรตรวจแล้ว ล้างธง */
create or replace function public.before_dose_drugs_approve()
returns trigger language plpgsql
set search_path = ''
as $$
declare why text; approving boolean;
begin
  if tg_op = 'UPDATE' then
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
    if coalesce(current_setting('pcps.audit', true), '') <> '1' then new.audit_flags := old.audit_flags; end if;
  else new.approved_by := null; new.approved_at := null; new.audit_flags := '[]'; end if;
  approving := tg_op = 'UPDATE' and coalesce(current_setting('pcps.approve_dose', true), '') = new.id::text;
  if new.active and (tg_op = 'INSERT' or not old.active or old.ai_draft or new.indications is distinct from old.indications or approving) then
    why := coalesce(public.dose_inds_problem(new.indications), public.dose_rules_problem(new.indications));
    if why is not null then
      raise exception 'ข้อมูลขนาดยายังไม่ครบหรือไม่ผ่านกฎความปลอดภัย จึงยังแสดงในเครื่องคำนวณไม่ได้ · %', why using errcode = '23514';
    end if;
    if not new.ai_draft then new.approved_by := auth.uid(); new.approved_at := now(); new.audit_flags := '[]'; end if;
  end if;
  if not new.active then new.approved_by := null; new.approved_at := null; end if;
  return new;
end $$;

/** ยา รพ.สต. ที่ผูกข้อมูลคำนวณนี้และมีฉลาก OpenFDA (ใช้ตรวจย้อนหลัง) */
create or replace function public.dose_audit_local(p_dose bigint)
returns int language sql stable security definer
set search_path = ''
as $$
  select l.id from public.local_drugs l
   where l.fda_key is not null and l.trashed_at is null
     and (l.dose_id = p_dose or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(l.ingredients) = 'array' then l.ingredients else '[]' end) g where (g->>'dose_id')::bigint = p_dose))
   order by l.active desc, l.id limit 1
$$;

/** ส่งยา 1 ตัวให้ AI ตรวจย้อนหลัง → id ของรายการตรวจ (ไม่มีฉลาก = null) */
create or replace function public.dose_audit_send(p_dose bigint, p_user uuid default null)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare d record; lid int; src text; k text; model text; prompt text; nreq bigint; new_id bigint;
begin
  select x.id, x.name, x.indications into d from public.dose_drugs x where x.id = p_dose;
  if d.id is null then return null; end if;
  lid := public.dose_audit_local(p_dose);
  src := case when lid is not null then public.ai_dose_fix_src(lid) end;
  if btrim(coalesce(src, '')) = '' then return null; end if;
  k := public.ai_key();
  prompt := 'คุณเป็นเภสัชกรตรวจทานข้อมูลเครื่องคำนวณขนาดยาที่อนุมัติใช้งานแล้ว ของ รพ.สต. ในประเทศไทย' || E'\n'
    || 'เทียบข้อบ่งใช้แต่ละข้อ (JSON) กับ "ฉลากยา" ด้านล่างเท่านั้น แล้วตัดสินแต่ละข้อ:' || E'\n'
    || '- "wrong" = ตัวเลขขัดกับฉลากชัดเจน (เช่น ขนาดต่อวันบันทึกเป็นต่อครั้ง ตัวเลขต่างจากฉลาก เพดานผิดช่อง จำนวนครั้งต่อวันผิด ช่วงอายุผิด ขนาดเด็กเกินผู้ใหญ่) ต้องใส่ quote = ข้อความในฉลากตรงตัว (ภาษาอังกฤษ ≤ 300 ตัวอักษร) ที่แสดงว่าผิด' || E'\n'
    || '- "doubt" = สงสัย/ฉลากไม่ได้ระบุชัด/ต้องให้เภสัชกรดู · "ok" = ตรงกับฉลาก' || E'\n'
    || public.ai_dose_rules_text() || E'\n'
    || 'ห้ามเดา ห้ามใช้ความรู้นอกฉลาก · why = เหตุผลภาษาไทยสั้น ๆ บอกค่าที่ควรเป็นตามฉลาก' || E'\n'
    || 'ตอบเป็น JSON เท่านั้น: {"items": [{"name": "ชื่อข้อบ่งใช้ตรงตามที่ให้", "level": "wrong|doubt|ok", "why": "...", "quote": "..."}]}' || E'\n\n'
    || 'ยา: ' || d.name || E'\n'
    || 'ข้อบ่งใช้: ' || (select coalesce(jsonb_agg(e - 'ref' - 'checked'), '[]') from jsonb_array_elements(coalesce(d.indications, '[]')) e)::text || E'\n\n'
    || 'ฉลากยา (OpenFDA+DailyMed):' || E'\n' || src;
  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
  nreq := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
    body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                               'generationConfig', jsonb_build_object('responseMimeType', 'application/json', 'temperature', 0)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 120000);
  insert into public.dose_audits (dose_id, local_id, inds, src, request_id, ai_job, sent_at, by_user)
  values (p_dose, lid, coalesce(d.indications, '[]'), src, nreq, public.ai_job_of(nreq), now(), p_user)
  returning id into new_id;
  return new_id;
end $$;

/** อ่านคำตอบของรายการตรวจ → ติดธงในข้อมูลคำนวณ · คืน 'pending' | 'done' | 'hit' (AI ไม่ว่าง/ติดโควตา) | 'error' */
create or replace function public.dose_audit_process(p_id bigint)
returns text language plpgsql security definer
set search_path = ''
as $$
declare r public.dose_audits; res record; txt text; j jsonb; it jsonb; flags jsonb := '[]'; lvl text; q text; nm text; nreq bigint; out text := 'pending';
begin
  select * into r from public.dose_audits where id = p_id for update;
  if r.id is null or r.status <> 'pending' then return coalesce(r.status, 'error'); end if;
  select h.status_code, h.content, h.timed_out into res from net._http_response h where h.id = r.request_id;
  if found then
    if res.status_code = 200 then
      begin
        select string_agg(p->>'text', '') into txt
          from jsonb_array_elements(res.content::jsonb #> '{candidates,0,content,parts}') p where not coalesce((p->>'thought')::boolean, false);
        txt := btrim(coalesce(txt, ''));
        j := substring(txt from position('{' in txt) for length(txt) - position('{' in txt) - position('}' in reverse(txt)) + 2)::jsonb;
        for it in select x from jsonb_array_elements(case when jsonb_typeof(j->'items') = 'array' then j->'items' else '[]' end) x limit 40 loop
          nm := btrim(coalesce(it->>'name', ''));
          lvl := it->>'level';
          if lvl not in ('wrong', 'doubt') then continue; end if;
          -- ต้องเป็นชื่อข้อบ่งใช้ที่มีจริง (ณ ตอนส่งตรวจ)
          if not exists (select 1 from jsonb_array_elements(r.inds) e where btrim(e->>'name') = nm) then continue; end if;
          q := left(nullif(btrim(it->>'quote'), ''), 300);
          -- "ผิดชัดเจน" ต้องอ้างข้อความที่มีในฉลากจริง ไม่งั้นลดเป็น "สงสัย" (กัน AI กล่าวหาเกินจริง)
          if lvl = 'wrong' and (q is null or position(public.dose_norm(q) in public.dose_norm(r.src)) = 0) then lvl := 'doubt'; end if;
          flags := flags || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('name', left(nm, 200), 'level', lvl,
                     'why', left(coalesce(nullif(btrim(it->>'why'), ''), 'AI ตรวจย้อนหลังพบข้อสงสัย'), 300), 'quote', q, 'at', now())));
        end loop;
        update public.dose_audits set status = 'done', done_at = now(), result = jsonb_build_object('flags', flags) where id = r.id;
        -- ติดธงเฉพาะเมื่อข้อมูลยังเหมือนตอนส่งตรวจ (ผู้ดูแลแก้/อนุมัติใหม่ระหว่างนั้น = ผลเก่า ไม่ใช้)
        perform set_config('pcps.audit', '1', true);
        update public.dose_drugs set audit_flags = flags where id = r.dose_id and indications = r.inds and active;
        perform set_config('pcps.audit', '', true);
        out := 'done';
      exception when others then
        update public.dose_audits set status = 'error', done_at = now(), note = 'อ่านคำตอบของ AI ไม่ได้' where id = r.id;
        out := 'error';
      end;
    else
      nreq := case when not coalesce(res.timed_out, false) then public.ai_resend(r.ai_job, res.status_code) end;
      if nreq is not null then update public.dose_audits set request_id = nreq, sent_at = now() where id = r.id;
      else
        update public.dose_audits set status = 'error', done_at = now(), note = public.ai_fail_note(res.status_code, coalesce(res.timed_out, false)) where id = r.id;
        out := case when res.status_code in (429, 500, 503) then 'hit' else 'error' end;
      end if;
    end if;
  elsif coalesce(r.sent_at, r.created_at) < now() - interval '5 minutes' then
    update public.dose_audits set status = 'error', done_at = now(), note = 'หมดเวลารอ AI' where id = r.id;
    out := 'error';
  end if;
  if out <> 'pending' and r.ai_job is not null then update public.ai_jobs set body = null where id = r.ai_job; end if;
  return out;
end $$;

/** รอบอัตโนมัติ: อ่านคำตอบที่ค้าง → (กลางคืน · ไม่พัก) ส่งยาตัวถัดไปที่ถึงรอบตรวจ ทีละ 1 ตัว */
create or replace function public.dose_audit_tick(paused boolean, p_force boolean default false)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare p record; st text; hit boolean := false; nid bigint; dd bigint; hr int;
begin
  for p in select id from public.dose_audits where status = 'pending' order by id limit 5 loop
    st := public.dose_audit_process(p.id);
    if st = 'hit' then hit := true; end if;
  end loop;
  hr := extract(hour from now() at time zone 'Asia/Bangkok');
  if paused or hit or (not p_force and hr > 5) or exists (select 1 from public.dose_audits where status = 'pending') then
    return jsonb_build_object('hit', hit, 'sent', null);
  end if;
  select x.id into dd from public.dose_drugs x
   where x.active and not x.ai_draft and x.approved_at is not null and public.dose_audit_local(x.id) is not null
     and not exists (select 1 from public.dose_audits a where a.dose_id = x.id
                      and (a.status = 'pending' or (a.created_at > x.approved_at and a.created_at > now() - interval '30 days')))
   order by (select max(a.created_at) from public.dose_audits a where a.dose_id = x.id) nulls first, x.id
   limit 1;
  if dd is not null then nid := public.dose_audit_send(dd); end if;
  return jsonb_build_object('hit', false, 'sent', nid, 'dose', dd);
end $$;

/** ผู้ดูแล: ให้ AI ตรวจย้อนหลังยานี้ตอนนี้ */
create or replace function public.dose_audit_now(p_dose bigint)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare nid bigint;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  if (select count(*) from public.dose_audits a where a.by_user = auth.uid() and a.created_at > now() - interval '1 day') >= 30 then
    raise exception 'สั่งตรวจย้อนหลังครบ 30 ครั้งของวันนี้แล้ว · ระบบจะตรวจให้เองตอนกลางคืน';
  end if;
  if public.dose_audit_local(p_dose) is null then raise exception 'ยานี้ยังไม่ได้ผูกฉลาก OpenFDA+DailyMed จึงให้ AI ตรวจย้อนหลังไม่ได้ (ไม่ส่งข้อความ MIMS)'; end if;
  nid := public.dose_audit_send(p_dose, auth.uid());
  if nid is null then raise exception 'ไม่พบข้อความขนาดยาในฉลากของยานี้'; end if;
  return nid;
end $$;

/** ผู้ดูแล: ผลตรวจย้อนหลังรายการนี้ (อ่านคำตอบถ้ายังค้าง) */
create or replace function public.dose_audit_poll(p_id bigint)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare r public.dose_audits;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  perform public.dose_audit_process(p_id);
  select * into r from public.dose_audits where id = p_id;
  if r.id is null then raise exception 'ไม่พบรายการนี้'; end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'result', r.result, 'note', r.note,
                            'flags', (select audit_flags from public.dose_drugs where id = r.dose_id));
end $$;

/** ผู้ดูแล: ตรวจแล้ว ข้อมูลถูกต้อง → ล้างธงของข้อบ่งใช้นี้ (บันทึกในประวัติแก้ไขข้อมูลยาโดย trigger 79) */
create or replace function public.dose_audit_resolve(p_dose bigint, p_name text)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare f jsonb;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  perform set_config('pcps.audit', '1', true);
  update public.dose_drugs set audit_flags = (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(audit_flags) x where x->>'name' is distinct from p_name)
   where id = p_dose returning audit_flags into f;
  perform set_config('pcps.audit', '', true);
  if f is null then raise exception 'ไม่พบข้อมูลขนาดยานี้'; end if;
  return f;
end $$;

revoke execute on function public.dose_audit_local(bigint), public.dose_audit_send(bigint, uuid), public.dose_audit_process(bigint), public.dose_audit_tick(boolean, boolean) from public, anon, authenticated;
revoke execute on function public.dose_audit_now(bigint), public.dose_audit_poll(bigint), public.dose_audit_resolve(bigint, text) from public, anon;
grant execute on function public.dose_audit_now(bigint), public.dose_audit_poll(bigint), public.dose_audit_resolve(bigint, text) to authenticated;
grant execute on function public.dose_audit_tick(boolean, boolean) to service_role;

/** รอบอัตโนมัติเดิม (63) + ตรวจย้อนหลังขนาดยา (กลางคืน) · AI ไม่ว่าง = พักทุกงาน 30 นาที */
create or replace function public.ai_auto_tick()
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare pause timestamptz; paused boolean; t jsonb; d jsonb; a jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('ai_auto_tick')) then return jsonb_build_object('skip', true); end if;
  begin pause := (select s.body from public.site_texts s where s.key = 'ai_auto_pause')::timestamptz; exception when others then pause := null; end;
  paused := coalesce(pause > now(), false);
  t := public.ai_th_tick(paused);
  d := public.ai_dose_tick(paused);
  a := public.dose_audit_tick(paused);
  if (t->>'hit')::boolean or (d->>'hit')::boolean or (a->>'hit')::boolean then
    pause := now() + interval '30 minutes';
    insert into public.site_texts (key, body) values ('ai_auto_pause', pause::text)
      on conflict (key) do update set body = excluded.body, updated_at = now();
  end if;
  return jsonb_build_object('paused', case when pause > now() then pause end, 'th', t, 'dose', d, 'audit', a,
    'left', jsonb_build_object(
      'fda', (select count(*) from public.drug_fda_labels where sections_th is null and jsonb_array_length(sections) > 0),
      'ddi', (select count(*) from public.ddi_pairs where description_th is null and description <> ''),
      'dose', (select count(*) from public.local_drugs where active and dose_id is null and category ~ '(เม็ด|แคปซูล|น้ำรับประทาน|ผง|NCD|เรื้อรัง)' and coalesce(dose_ai_status, '') not in ('none', 'done'))));
end $$;
revoke execute on function public.ai_auto_tick() from public, anon, authenticated;
grant execute on function public.ai_auto_tick() to service_role;

/** ประวัติแก้ไขข้อมูลยา (79) + ธง AI ตรวจย้อนหลัง (ติดธง/ล้างธง = มีประวัติว่าใคร/เมื่อไร) */
create or replace function public.write_drug_history()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  keys text[] := case tg_table_name
    when 'dose_drugs' then array['name', 'form', 'indications', 'concs', 'active', 'ai_draft', 'per', 'mg_per_kg_min', 'mg_per_kg_max', 'max_mg_per_dose', 'dose_freq_per_day', 'renal_note', 'audit_flags']
    else array['name', 'strength', 'ingredients', 'dose_id', 'active', 'unit', 'category', 'outside'] end;
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  changed text[];
begin
  select coalesce(array_agg(k order by k), '{}') into changed from unnest(keys) k
   where (o -> k) is distinct from (n -> k);
  if tg_op = 'UPDATE' and cardinality(changed) = 0 then return null; end if;   -- เปลี่ยนแค่ช่องระบบ (updated_at ฯลฯ) ไม่บันทึก
  insert into public.drug_data_history (table_name, row_id, action, fields, old_values, new_values, changed_by)
  values (tg_table_name, coalesce((n ->> 'id'), (o ->> 'id'))::bigint, lower(tg_op), changed,
          (select jsonb_object_agg(k, o -> k) from unnest(changed) k where o is not null),
          (select jsonb_object_agg(k, n -> k) from unnest(changed) k where n is not null),
          auth.uid());
  return null;
end $$;
revoke execute on function public.write_drug_history() from public, anon, authenticated;

select 'ok' as step_91_dose_audit,
       (select count(*) from public.dose_drugs where active and approved_at is not null and public.dose_audit_local(id) is not null) as auditable;
