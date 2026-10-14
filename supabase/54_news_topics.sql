-- =====================================================================
--  ขั้นที่ 54: หมวดหมู่ข่าวตามเนื้อหา (นอกจาก 3 ประเภทเดิม) · AI (Gemini ฟรี) จัดหมวดให้อัตโนมัติ · รันซ้ำได้ · เพิ่มอย่างเดียว
--   news_topics = รายชื่อหมวด (ผู้ดูแลเพิ่ม/ลบได้ · ชุดแรกตั้งให้) · news.topic_ids = หมวดของข่าว (≤ 3)
--   ai_news_topics_start(): ข่าวที่ยังไม่มีหมวด (รวมข่าวเก่า) ครั้งละ ≤ 30 ข่าว → Gemini เลือกหมวดจากรายชื่อเท่านั้น
--   ai_news_topics_poll(): ใส่หมวดให้เฉพาะข่าวที่ยังไม่มีหมวด (ไม่ทับที่ผู้ดูแลแก้เอง · หมวดเดิมถูกลบ = นับว่ายังไม่มี) · AI ไม่ว่าง = ลองรุ่นสำรอง (49_ai_retry.sql)
--   ส่งให้ AI เฉพาะหัวข้อ + เนื้อข่าวที่เผยแพร่/ส่งตรวจ (ข้อมูลสาธารณะ ไม่มีข้อมูลผู้ป่วย)
-- =====================================================================

create table if not exists public.news_topics (
  id          smallint generated always as identity primary key,
  name        text not null unique check (char_length(btrim(name)) between 1 and 40),
  sort        smallint not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.news_topics enable row level security;
drop policy if exists ntopic_read on public.news_topics;
drop policy if exists ntopic_admin on public.news_topics;
create policy ntopic_read on public.news_topics for select using (true);
create policy ntopic_admin on public.news_topics for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.news_topics from anon, authenticated;
grant select on public.news_topics to anon, authenticated;
grant insert, update, delete on public.news_topics to authenticated;
grant all on public.news_topics to service_role;

-- ชุดแรก (ใส่เมื่อยังไม่มีหมวดเลย · ผู้ดูแลแก้ภายหลังได้)
insert into public.news_topics (name, sort)
select x.name, x.sort from (values
  ('โรคเรื้อรัง', 1), ('ยาเด็ก', 2), ('ความปลอดภัยด้านยา', 3), ('การใช้ยาอย่างสมเหตุผล', 4), ('สมุนไพรและผลิตภัณฑ์สุขภาพ', 5),
  ('วัคซีนและโรคติดเชื้อ', 6), ('ผู้สูงอายุ', 7), ('กิจกรรม รพ.สต.', 8), ('บริการและประชาสัมพันธ์', 9)) x(name, sort)
where not exists (select 1 from public.news_topics);

alter table public.news add column if not exists topic_ids smallint[] not null default '{}';
alter table public.news drop constraint if exists news_topic_ids_check;
alter table public.news add constraint news_topic_ids_check check (cardinality(topic_ids) <= 3);
create index if not exists news_topic_ids_idx on public.news using gin (topic_ids);

create table if not exists public.ai_topic_runs (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  news_ids    uuid[] not null,
  request_id  bigint,
  ai_job      bigint,
  sent_at     timestamptz,
  status      text not null default 'pending' check (status in ('pending', 'done', 'error')),
  note        text,
  tagged      int not null default 0,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
alter table public.ai_topic_runs enable row level security;
drop policy if exists atr_read on public.ai_topic_runs;
create policy atr_read on public.ai_topic_runs for select to authenticated using (public.is_admin());
revoke all on public.ai_topic_runs from anon, authenticated;
grant select on public.ai_topic_runs to authenticated;
grant all on public.ai_topic_runs to service_role;

/** เริ่มให้ AI จัดหมวดข่าวที่ยังไม่มีหมวด · ไม่มีข่าวค้าง = null · กำลังทำอยู่ = คืนรอบเดิม */
create or replace function public.ai_news_topics_start()
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare r public.ai_topic_runs; ids uuid[]; topics text; items text; k text; model text; prompt text; req bigint; new_id bigint;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into r from public.ai_topic_runs where status = 'pending' and coalesce(sent_at, created_at) > now() - interval '3 minutes' order by id desc limit 1;
  if r.id is not null then return r.id; end if;
  if (select count(*) from public.ai_topic_runs where created_at > now() - interval '1 day') >= 40 then
    raise exception 'ใช้ AI จัดหมวดครบ 40 ครั้งของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;
  select array_agg(id order by coalesce(published_at, created_at) desc) into ids from (
    select n.id, n.published_at, n.created_at from public.news n
     where not exists (select 1 from public.news_topics t where t.id = any(n.topic_ids))   -- ยังไม่มีหมวด (หรือหมวดเดิมถูกลบไปแล้ว)
       and n.status in ('published', 'pending')
     order by coalesce(n.published_at, n.created_at) desc limit 30) x;
  if ids is null then return null; end if;
  select string_agg('- ' || t.name, E'\n' order by t.sort, t.id) into topics from public.news_topics t;
  if topics is null then raise exception 'ยังไม่มีหมวดหมู่ข่าว กรุณาเพิ่มหมวดก่อน'; end if;
  k := public.ai_key();
  select string_agg(format('id: %s%sหัวข้อ: %s%sเนื้อหา: %s', n.id, E'\n', n.title, E'\n', left(regexp_replace(n.body, '\s+', ' ', 'g'), 400)), E'\n---\n')
    into items from public.news n where n.id = any(ids);
  prompt := 'จัดหมวดหมู่ข่าวของเว็บงานเภสัชกรรมปฐมภูมิ โรงพยาบาลชุมชน · แต่ละข่าวเลือก 1–2 หมวดที่ตรงที่สุด จากรายชื่อหมวดด้านล่างเท่านั้น (สะกดตรงตัว ห้ามตั้งหมวดใหม่)' || E'\n'
    || 'ถ้าไม่มีหมวดที่ตรงชัดเจน ให้เลือกหมวดที่ใกล้ที่สุด 1 หมวด' || E'\n'
    || 'ตอบเป็น JSON เท่านั้น: {"items": [{"id": "<id ของข่าว>", "topics": ["ชื่อหมวด"]}]}' || E'\n\n'
    || 'รายชื่อหมวด:' || E'\n' || topics || E'\n\nข่าว:\n' || items;
  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
  req := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
    body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                               'generationConfig', jsonb_build_object('responseMimeType', 'application/json', 'temperature', 0)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 90000);
  insert into public.ai_topic_runs (user_id, news_ids, request_id, ai_job, sent_at) values (auth.uid(), ids, req, public.ai_job_of(req), now()) returning id into new_id;
  return new_id;
end $$;

create or replace function public.ai_news_topics_poll(p_id bigint)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare r public.ai_topic_runs; res record; txt text; j jsonb; nreq bigint; cnt int;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into r from public.ai_topic_runs where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบรายการนี้'; end if;
  if r.status = 'pending' then
    select h.status_code, h.content, h.timed_out into res from net._http_response h where h.id = r.request_id;
    if found then
      if res.status_code = 200 then
        begin
          select string_agg(p->>'text', '') into txt
            from jsonb_array_elements(res.content::jsonb #> '{candidates,0,content,parts}') p where not coalesce((p->>'thought')::boolean, false);
          txt := btrim(coalesce(txt, ''));
          j := substring(txt from position('{' in txt) for length(txt) - position('{' in txt) - position('}' in reverse(txt)) + 2)::jsonb;
          with picked as (
            select case when e->>'id' ~ '^[0-9a-f-]{36}$' then (e->>'id')::uuid end nid,
                   (select array_agg(distinct t.id order by t.id) from jsonb_array_elements_text(case when jsonb_typeof(e->'topics') = 'array' then e->'topics' else '[]' end) w
                      join public.news_topics t on t.name = btrim(w)) tids
              from jsonb_array_elements(coalesce(j->'items', '[]')) e
             where (case when e->>'id' ~ '^[0-9a-f-]{36}$' then (e->>'id')::uuid end) = any(r.news_ids)),
          upd as (
            update public.news n set topic_ids = p.tids[1:3]
              from picked p where n.id = p.nid and cardinality(p.tids) > 0
               and not exists (select 1 from public.news_topics t where t.id = any(n.topic_ids))
            returning n.id)
          select count(*) into cnt from upd;
          update public.ai_topic_runs set status = 'done', tagged = cnt, done_at = now() where id = r.id returning * into r;
        exception when others then
          update public.ai_topic_runs set status = 'error', note = 'อ่านคำตอบของ AI ไม่ได้ กรุณาลองใหม่', done_at = now() where id = r.id returning * into r;
        end;
      else
        nreq := case when not coalesce(res.timed_out, false) then public.ai_resend(r.ai_job, res.status_code) end;
        if nreq is not null then
          update public.ai_topic_runs set request_id = nreq, sent_at = now() where id = r.id returning * into r;
        else
          update public.ai_topic_runs set status = 'error', note = public.ai_fail_note(res.status_code, coalesce(res.timed_out, false)), done_at = now() where id = r.id returning * into r;
        end if;
      end if;
    elsif coalesce(r.sent_at, r.created_at) < now() - interval '3 minutes' then
      update public.ai_topic_runs set status = 'error', note = 'หมดเวลารอ AI กรุณาลองใหม่', done_at = now() where id = r.id returning * into r;
    end if;
    if r.status <> 'pending' and r.ai_job is not null then update public.ai_jobs set body = null where id = r.ai_job; end if;
  end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'note', r.note, 'tagged', r.tagged, 'total', cardinality(r.news_ids));
end $$;

revoke execute on function public.ai_news_topics_start(), public.ai_news_topics_poll(bigint) from public, anon;
grant execute on function public.ai_news_topics_start(), public.ai_news_topics_poll(bigint) to authenticated;

select 'ok' as step_54_news_topics;
