-- =====================================================================
--  ขั้นที่ 49: AI ไม่ว่าง (503/500/429 ฯลฯ) → ลองใหม่เองด้วย AI รุ่นสำรอง ก่อนแจ้งผู้ใช้ · รันซ้ำได้
--   ① จำคำขอที่ส่ง Gemini ไว้ในตาราง ai_jobs (ส่วนตัว · ไม่มีคีย์ · ล้างเนื้อหาเมื่อได้ผล)
--      ด้วย trigger ตอนสร้างรายการ ai_matches / ai_news_checks (ฟังก์ชัน *_start เดิมไม่ต้องแก้)
--   ② ai_match_poll / ai_news_check_poll: ได้คำตอบที่ไม่ใช่ 200 → ส่งใหม่ด้วยรุ่นถัดไป (ไม่เกิน 4 รุ่น)
--      ลำดับรุ่น = ai_match_model → ai_match_models (ช่อง AI บันทึกให้) → รุ่นสำรองที่ตั้งไว้
--   ③ ครบทุกรุ่นแล้วยังไม่ว่าง → แจ้งเป็นภาษาไทยว่า AI ไม่ว่างชั่วคราว
-- =====================================================================

create table if not exists public.ai_jobs (
  id          bigint generated always as identity primary key,
  body        bytea,                       -- เนื้อคำขอ (ไม่มีคีย์ · คีย์อยู่ใน header ซึ่งไม่เก็บ) · ล้างเมื่อเสร็จ
  models      text[] not null,
  try         smallint not null default 1,
  timeout_ms  int not null default 90000,
  created_at  timestamptz not null default now()
);
alter table public.ai_jobs enable row level security;   -- ไม่มี policy = หน้าเว็บอ่าน/เขียนไม่ได้ (ใช้ผ่านฟังก์ชันของระบบเท่านั้น)
revoke all on public.ai_jobs from anon, authenticated;
grant all on public.ai_jobs to service_role;

alter table public.ai_matches add column if not exists ai_job bigint;
alter table public.ai_matches add column if not exists sent_at timestamptz;
alter table public.ai_news_checks add column if not exists ai_job bigint;
alter table public.ai_news_checks add column if not exists sent_at timestamptz;

/** ลำดับรุ่น AI ที่จะลอง (รุ่นแรก = รุ่นที่ใช้ส่งครั้งแรก) · ไม่ซ้ำ · ไม่เกิน 4 รุ่น */
create or replace function public.ai_models(p_first text)
returns text[] language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(m order by o), '{}') from (
    select m, min(o) o from unnest(
      array[p_first]
      || coalesce(string_to_array((select replace(t.body, ' ', '') from public.site_texts t where t.key = 'ai_match_models'), ','), '{}')
      || array['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest']
    ) with ordinality u(m, o)
    where m ~ '^[a-z0-9][a-z0-9.\-]{1,60}$'
    group by m order by min(o) limit 4) x
$$;
revoke execute on function public.ai_models(text) from public, anon, authenticated;

/** ตอนสร้างรายการ: จำคำขอที่เพิ่งเข้าคิว pg_net ไว้ (คิวจะถูกลบเมื่อส่งแล้ว) */
create or replace function public.ai_job_capture()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare q record;
begin
  if new.request_id is not null and new.ai_job is null and to_regclass('net.http_request_queue') is not null then
    execute 'select url, body, timeout_milliseconds from net.http_request_queue where id = $1' into q using new.request_id;
    if q.url is not null then
      insert into public.ai_jobs (body, models, timeout_ms)
      values (q.body, public.ai_models(substring(q.url from '/models/([^/:]+):')), coalesce(q.timeout_milliseconds, 90000))
      returning id into new.ai_job;
    end if;
  end if;
  new.sent_at := coalesce(new.sent_at, now());
  return new;
end $$;
revoke execute on function public.ai_job_capture() from public, anon, authenticated;

drop trigger if exists ai_matches_job on public.ai_matches;
create trigger ai_matches_job before insert on public.ai_matches for each row execute function public.ai_job_capture();
drop trigger if exists ai_news_checks_job on public.ai_news_checks;
create trigger ai_news_checks_job before insert on public.ai_news_checks for each row execute function public.ai_job_capture();

/** ส่งคำขอเดิมใหม่ด้วยรุ่นถัดไป → เลขคำขอใหม่ · ไม่มีรุ่นเหลือ/คีย์ใช้ไม่ได้ = null */
create or replace function public.ai_resend(p_job bigint, p_status int)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare j public.ai_jobs; k text;
begin
  if p_job is null or p_status in (401, 403) then return null; end if;   -- คีย์ใช้ไม่ได้ = ลองรุ่นอื่นก็ไม่ช่วย
  select * into j from public.ai_jobs where id = p_job for update;
  if j.id is null or j.body is null or j.try >= coalesce(array_length(j.models, 1), 0) then return null; end if;
  begin k := public.ai_key(); exception when others then return null; end;
  update public.ai_jobs set try = try + 1 where id = j.id;
  return net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || j.models[j.try + 1] || ':generateContent',
    body := convert_from(j.body, 'utf8')::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := j.timeout_ms);
end $$;
revoke execute on function public.ai_resend(bigint, int) from public, anon, authenticated;

/** ข้อความแจ้งเมื่อ AI ไม่สำเร็จ (ลองครบทุกรุ่นแล้ว) */
create or replace function public.ai_fail_note(p_status int, p_timed_out boolean)
returns text language sql immutable
set search_path = ''
as $$
  select case when p_status = 429 then 'AI มีผู้ใช้มาก/โควตาเต็ม (ลองรุ่นสำรองแล้ว) กรุณาลองใหม่ภายหลัง'
              when p_timed_out then 'AI ตอบช้าเกินไป กรุณาลองใหม่'
              when p_status in (401, 403) then 'คีย์ AI ใช้ไม่ได้ (รหัส ' || p_status || ') กรุณาแจ้งผู้ดูแลระบบ'
              when p_status >= 500 or p_status is null then 'AI ของ Google ไม่ว่างชั่วคราว (รหัส ' || coalesce(p_status::text, '-') || ' · ลองรุ่นสำรองแล้ว) กรุณาลองใหม่อีกสักครู่'
              else 'AI ไม่ว่าง (รหัส ' || p_status || ') กรุณาลองใหม่' end
$$;

/** เหมือน 37_ai_match.sql + ลองรุ่นสำรองเมื่อไม่สำเร็จ */
create or replace function public.ai_match_poll(p_id bigint)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare r public.ai_matches; res record; txt text; j jsonb; m jsonb; nreq bigint;
begin
  select * into r from public.ai_matches where id = p_id;
  if r.id is null or not (public.is_admin() or r.user_id = auth.uid() or (r.unit_id is not null and public.is_staff_of(r.unit_id))) then
    raise exception 'ไม่พบรายการนี้';
  end if;
  if r.status = 'pending' then
    select * into r from public.ai_matches where id = p_id for update;   -- กันหลายหน้าจอส่งซ้ำพร้อมกัน
  end if;
  if r.status = 'pending' then
    select h.status_code, h.content, h.timed_out, h.error_msg into res from net._http_response h where h.id = r.request_id;
    if found then
      if res.status_code = 200 then
        begin
          select string_agg(p->>'text', '') into txt
            from jsonb_array_elements(res.content::jsonb #> '{candidates,0,content,parts}') p where not coalesce((p->>'thought')::boolean, false);
          txt := regexp_replace(btrim(coalesce(txt, '')), '^```(json)?\s*|\s*```$', '', 'g');
          j := substring(txt from position('{' in txt))::jsonb;
          select coalesce(jsonb_agg(jsonb_build_object('item_id', c.id, 'item_no', c.item_no, 'reason', left(coalesce(e.v->>'reason', ''), 200)) order by e.n), '[]')
            into m
            from jsonb_array_elements(coalesce(j->'matches', '[]')) with ordinality as e(v, n)
            join public.criteria_items c on c.fiscal_year = r.fiscal_year and c.item_no = btrim(regexp_replace(e.v->>'item_no', '^ข้อ\s*', ''))
           where e.n <= 5;
          update public.ai_matches set status = 'done', matches = m, done_at = now() where id = r.id returning * into r;
        exception when others then
          update public.ai_matches set status = 'error', note = 'อ่านคำตอบของ AI ไม่ได้ กรุณาลองใหม่', done_at = now() where id = r.id returning * into r;
        end;
      else
        nreq := case when not coalesce(res.timed_out, false) then public.ai_resend(r.ai_job, res.status_code) end;
        if nreq is not null then
          update public.ai_matches set request_id = nreq, sent_at = now() where id = r.id returning * into r;
        else
          update public.ai_matches set status = 'error', done_at = now(), note = public.ai_fail_note(res.status_code, coalesce(res.timed_out, false))
           where id = r.id returning * into r;
        end if;
      end if;
    elsif coalesce(r.sent_at, r.created_at) < now() - interval '3 minutes' then
      update public.ai_matches set status = 'error', note = 'หมดเวลารอ AI กรุณาลองใหม่', done_at = now() where id = r.id returning * into r;
    end if;
    if r.status <> 'pending' and r.ai_job is not null then update public.ai_jobs set body = null where id = r.ai_job; end if;
  end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'matches', r.matches, 'note', r.note, 'achievement_id', r.achievement_id);
end $$;

/** เหมือน 47_ai_news_check.sql + ลองรุ่นสำรองเมื่อไม่สำเร็จ */
create or replace function public.ai_news_check_poll(p_id bigint)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare r public.ai_news_checks; res record; txt text; j jsonb; items jsonb; nreq bigint;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into r from public.ai_news_checks where id = p_id for update;
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
          if not coalesce((j->>'pdf_read')::boolean, true) then
            update public.ai_news_checks set status = 'error', note = 'AI เปิดอ่านไฟล์ PDF ต้นฉบับไม่ได้ กรุณาลองใหม่ภายหลัง', done_at = now() where id = r.id returning * into r;
          else
            select coalesce(jsonb_agg(jsonb_build_object('n', (e->>'n')::int,
                     'ai_answer', left(coalesce(e->>'ai_answer', ''), 400),
                     'match', case when e->>'match' in ('yes', 'no', 'not_found') then e->>'match' else 'not_found' end,
                     'page', case when e->>'page' ~ '^\d{1,4}$' then (e->>'page')::int end,
                     'explain', left(coalesce(e->>'explain', ''), 600),
                     'answer_rewrite', left(coalesce(e->>'answer_rewrite', ''), 200),
                     'distractors', coalesce((select jsonb_agg(left(btrim(d), 200)) from jsonb_array_elements_text(case when jsonb_typeof(e->'distractors') = 'array' then e->'distractors' else '[]' end) d where btrim(d) <> ''), '[]'))
                     order by (e->>'n')::int), '[]')
              into items from jsonb_array_elements(coalesce(j->'items', '[]')) e where e->>'n' ~ '^\d{1,2}$' and (e->>'n')::int between 1 and r.points;
            update public.ai_news_checks set status = 'done', done_at = now(), result = jsonb_build_object('pdf_read', true, 'items', items)
             where id = r.id returning * into r;
          end if;
        exception when others then
          update public.ai_news_checks set status = 'error', note = 'อ่านคำตอบของ AI ไม่ได้ กรุณาลองใหม่', done_at = now() where id = r.id returning * into r;
        end;
      else
        nreq := case when not coalesce(res.timed_out, false) then public.ai_resend(r.ai_job, res.status_code) end;
        if nreq is not null then
          update public.ai_news_checks set request_id = nreq, sent_at = now() where id = r.id returning * into r;
        else
          update public.ai_news_checks set status = 'error', done_at = now(), note = public.ai_fail_note(res.status_code, coalesce(res.timed_out, false))
           where id = r.id returning * into r;
        end if;
      end if;
    elsif coalesce(r.sent_at, r.created_at) < now() - interval '4 minutes' then
      update public.ai_news_checks set status = 'error', note = 'หมดเวลารอ AI กรุณาลองใหม่', done_at = now() where id = r.id returning * into r;
    end if;
    if r.status <> 'pending' and r.ai_job is not null then update public.ai_jobs set body = null where id = r.ai_job; end if;
  end if;
  return jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status, 'result', r.result, 'note', r.note, 'points', r.points);
end $$;

revoke execute on function public.ai_match_poll(bigint), public.ai_news_check_poll(bigint) from public, anon;
grant execute on function public.ai_match_poll(bigint), public.ai_news_check_poll(bigint) to authenticated;

select 'ok' as step_49_ai_retry;
