-- =====================================================================
--  ขั้นที่ 36: AI แนะนำข้อมาตรฐานจาก "รายละเอียดผลงาน" — รันต่อจาก 36 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   ฐานข้อมูลเรียก Gemini (ฟรี) เองผ่าน pg_net แบบไม่รอผล: ai_match_start → (สักครู่) → ai_match_poll อ่านผล
--   คีย์ GEMINI_API_KEY เก็บเข้ารหัสใน Supabase Vault (ci-deploy ส่งจาก GitHub Secrets ด้วย ops.set_ai_key · ไม่มีใน repo / หน้าเว็บ)
--   ส่งให้ AI เฉพาะข้อความผลงาน (ข้อมูลสาธารณะ) + ข้อเกณฑ์ปีงบปัจจุบัน · ห้ามข้อมูลผู้ป่วย (หน้าเว็บเตือน)
--   ai_matches = ประวัติ/ผลการวิเคราะห์ (อ่านได้: ผู้ดูแล + เจ้าหน้าที่หน่วยนั้น + คนที่สั่ง) · เขียนผ่านฟังก์ชันเท่านั้น
--   จำกัด: คนละ 30 ครั้ง/วัน · รวมทั้งระบบ 300 ครั้ง/วัน (กันโควตาฟรีหมด)
-- =====================================================================

do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then create extension if not exists pg_net; end if;
exception when others then raise notice 'pg_net ใช้ไม่ได้: %', sqlerrm;
end $$;

create table if not exists public.ai_matches (
  id              bigint generated always as identity primary key,
  user_id         uuid default auth.uid() references public.profiles(id) on delete set null,
  unit_id         smallint references public.units(id),
  achievement_id  uuid references public.achievements(id) on delete cascade,
  fiscal_year     int not null,
  input           text not null check (char_length(input) <= 4000),
  request_id      bigint,
  status          text not null default 'pending' check (status in ('pending', 'done', 'error')),
  matches         jsonb not null default '[]',   -- [{item_id, item_no, reason}]
  note            text,
  created_at      timestamptz not null default now(),
  done_at         timestamptz
);
create index if not exists ai_matches_ach_idx on public.ai_matches (achievement_id, created_at desc);
create index if not exists ai_matches_user_idx on public.ai_matches (user_id, created_at desc);

alter table public.ai_matches enable row level security;
drop policy if exists aim_read on public.ai_matches;
create policy aim_read on public.ai_matches for select to authenticated
  using (public.is_admin() or user_id = auth.uid() or (unit_id is not null and public.is_staff_of(unit_id)));
revoke all on public.ai_matches from anon, authenticated;
grant select on public.ai_matches to authenticated;
grant all on public.ai_matches to service_role;

/** เริ่มวิเคราะห์ (เจ้าหน้าที่/ผู้ดูแล) → id · p_achievement = วิเคราะห์ผลงานที่บันทึกแล้ว (ผลขึ้นในรายการผลงาน) */
create or replace function public.ai_match_start(p_text text, p_achievement uuid default null)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare
  fy int := public.fiscal_year_of(current_date);
  u smallint; k text; model text; items text; prompt text; req bigint; new_id bigint;
begin
  if coalesce(public.my_role(), '') not in ('staff', 'admin') then raise exception 'ไม่มีสิทธิ์'; end if;
  p_text := btrim(coalesce(p_text, ''));
  if char_length(p_text) < 10 then raise exception 'กรุณาพิมพ์รายละเอียดผลงานก่อน (อย่างน้อย 10 ตัวอักษร)'; end if;
  if char_length(p_text) > 4000 then raise exception 'รายละเอียดยาวเกิน 4,000 ตัวอักษร'; end if;
  if p_achievement is not null then
    select a.unit_id into u from public.achievements a where a.id = p_achievement;
    if u is null or not (public.is_admin() or public.is_staff_of(u)) then raise exception 'ไม่มีสิทธิ์'; end if;
  else
    u := public.my_unit();
  end if;
  if (select count(*) from public.ai_matches m where m.user_id = auth.uid() and m.created_at > now() - interval '1 day') >= 30 then
    raise exception 'ใช้ AI ครบ 30 ครั้งของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;
  if (select count(*) from public.ai_matches m where m.created_at > now() - interval '1 day') >= 300 then
    raise exception 'ระบบ AI ใช้ครบโควตาของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;
  -- คีย์ต้องไม่หลุด: คิวคำขอของ pg_net (มี header คีย์) ต้องอ่านไม่ได้จากผู้ใช้เว็บ
  if to_regclass('net.http_request_queue') is null or has_table_privilege('authenticated', 'net.http_request_queue', 'select')
     or has_table_privilege('anon', 'net.http_request_queue', 'select') then
    raise exception 'ระบบ AI ยังไม่พร้อมใช้งาน';
  end if;
  select s.decrypted_secret into k from vault.decrypted_secrets s where s.name = 'gemini_api_key' limit 1;
  if coalesce(k, '') = '' then raise exception 'ระบบ AI ยังไม่พร้อมใช้งาน (ยังไม่ได้ตั้งคีย์)'; end if;

  select string_agg(format('ข้อ %s [%s%s] %s%s', c.item_no, c.topic_title, coalesce(' › ' || c.sub_label, ''), c.body,
                           coalesce(' (หลักฐาน: ' || c.evidence || ')', '')), E'\n' order by c.sort)
    into items from public.criteria_items c where c.fiscal_year = fy;
  if items is null then raise exception 'ยังไม่มีเกณฑ์มาตรฐานของปีงบ %', fy; end if;
  prompt := 'คุณเป็นเภสัชกรผู้ตรวจประเมินมาตรฐานงานเภสัชกรรมปฐมภูมิของ รพ.สต.' || E'\n'
    || 'อ่าน "ผลงาน" แล้วเลือกข้อมาตรฐานที่ผลงานนี้ใช้เป็นหลักฐานได้จริง (เลือกเฉพาะข้อที่เนื้อหาผลงานสอดคล้องชัดเจน ไม่เดา ไม่เกิน 5 ข้อ เรียงจากตรงที่สุด · ไม่มีข้อที่ตรง = matches ว่าง)' || E'\n'
    || 'ตอบเป็น JSON เท่านั้น: {"matches": [{"item_no": "เลขข้อตามรายการ", "reason": "เหตุผลสั้น ๆ ภาษาไทย ไม่เกิน 100 ตัวอักษร"}]}' || E'\n\n'
    || 'ข้อมาตรฐานปีงบ ' || fy || E':\n' || left(items, 40000) || E'\n\nผลงาน:\n' || p_text;
  model := coalesce((select nullif(btrim(t.body), '') from public.site_texts t where t.key = 'ai_match_model'), 'gemini-flash-latest');
  req := net.http_post(
    url := 'https://generativelanguage.googleapis.com/v1beta/models/' || model || ':generateContent',
    body := jsonb_build_object('contents', jsonb_build_array(jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', prompt)))),
                               'generationConfig', jsonb_build_object('responseMimeType', 'application/json', 'temperature', 0)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-goog-api-key', k),
    timeout_milliseconds := 90000);
  insert into public.ai_matches (user_id, unit_id, achievement_id, fiscal_year, input, request_id)
  values (auth.uid(), u, p_achievement, fy, p_text, req) returning id into new_id;
  return new_id;
end $$;

/** อ่านผล: ยังรอ → ตรวจคำตอบจาก pg_net · ได้แล้ว = แปลงเป็นข้อเกณฑ์ (เฉพาะข้อที่มีจริงในปีงบนั้น) */
create or replace function public.ai_match_poll(p_id bigint)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare r public.ai_matches; res record; txt text; j jsonb; m jsonb;
begin
  select * into r from public.ai_matches where id = p_id;
  if r.id is null or not (public.is_admin() or r.user_id = auth.uid() or (r.unit_id is not null and public.is_staff_of(r.unit_id))) then
    raise exception 'ไม่พบรายการนี้';
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
        update public.ai_matches set status = 'error', done_at = now(),
               note = case when res.status_code = 429 then 'AI มีผู้ใช้มาก/โควตาเต็ม กรุณาลองใหม่ภายหลัง'
                           when res.timed_out then 'AI ตอบช้าเกินไป กรุณาลองใหม่'
                           else 'AI ไม่ว่าง (รหัส ' || coalesce(res.status_code::text, '-') || ') กรุณาลองใหม่' end
         where id = r.id returning * into r;
      end if;
    elsif r.created_at < now() - interval '3 minutes' then
      update public.ai_matches set status = 'error', note = 'หมดเวลารอ AI กรุณาลองใหม่', done_at = now() where id = r.id returning * into r;
    end if;
  end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'matches', r.matches, 'note', r.note, 'achievement_id', r.achievement_id);
end $$;

/** ผูกผลวิเคราะห์ในฟอร์ม (ก่อนบันทึก) เข้ากับผลงานที่เพิ่งบันทึก → ขึ้นสถานะในรายการผลงาน */
create or replace function public.ai_match_link(p_id bigint, p_achievement uuid)
returns void language plpgsql security definer
set search_path = ''
as $$
declare u smallint;
begin
  select a.unit_id into u from public.achievements a where a.id = p_achievement;
  if u is null or not (public.is_admin() or public.is_staff_of(u)) then raise exception 'ไม่มีสิทธิ์'; end if;
  update public.ai_matches set achievement_id = p_achievement, unit_id = u where id = p_id and user_id = auth.uid();
  if not found then raise exception 'ไม่พบรายการนี้'; end if;
end $$;

revoke execute on function public.ai_match_start(text, uuid), public.ai_match_poll(bigint), public.ai_match_link(bigint, uuid) from public, anon;
grant execute on function public.ai_match_start(text, uuid), public.ai_match_poll(bigint), public.ai_match_link(bigint, uuid) to authenticated;

-- ci-deploy เรียกตัวนี้ส่งคีย์จาก GitHub Secrets เข้า Vault (schema ops ไม่เปิดผ่าน API ของเว็บ)
create schema if not exists ops;
revoke all on schema ops from public;
create or replace function ops.set_ai_key(p_key text)
returns void language plpgsql security definer
set search_path = ''
as $$
declare sid uuid;
begin
  if coalesce(btrim(p_key), '') = '' then return; end if;
  select s.id into sid from vault.secrets s where s.name = 'gemini_api_key';
  if sid is null then perform vault.create_secret(p_key, 'gemini_api_key', 'ช่อง AI แนะนำข้อมาตรฐาน (ตั้งจาก GitHub Secrets)');
  elsif (select d.decrypted_secret from vault.decrypted_secrets d where d.id = sid) is distinct from p_key then perform vault.update_secret(sid, p_key);
  end if;
end $$;
revoke all on function ops.set_ai_key(text) from public;

select 'ok' as step_36_ai_match;
