-- =====================================================================
--  ขั้นที่ 69: ค้นฉลากยาจาก DailyMed (NLM สหรัฐฯ · ฟรี ไม่ใช้คีย์) · รันซ้ำได้ · เพิ่มอย่างเดียว
--   DailyMed ไม่อนุญาตให้เบราว์เซอร์เรียกตรง (ไม่มี CORS) → ฐานข้อมูลเรียกผ่าน pg_net ให้ผู้ดูแล
--   dailymed_search(q) → รหัสคำขอ · dailymed_result(id) → {status, data: [{title, setid, published_date, spl_version}]}
--   หน้าผู้ดูแล › ฐานข้อมูลฉลากยา: เลือกฉลาก (ผู้ผลิต/รูปแบบ) จาก DailyMed → นำเข้าผ่าน openFDA ด้วย set_id (ฉลากชุดเดียวกัน)
--   ส่งเฉพาะชื่อยา (ข้อมูลสาธารณะ) · dailymed_requests ไม่มี policy = หน้าเว็บอ่าน/เขียนตรงไม่ได้
-- =====================================================================

create table if not exists public.dailymed_requests (
  id          bigint primary key,
  query       text not null check (char_length(query) between 2 and 80),
  created_at  timestamptz not null default now()
);
alter table public.dailymed_requests enable row level security;
revoke all on public.dailymed_requests from anon, authenticated;
grant all on public.dailymed_requests to service_role;

create or replace function public.dailymed_search(p_q text)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare q text := lower(regexp_replace(btrim(coalesce(p_q, '')), '\s+', ' ', 'g')); req bigint;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  if q !~ '^[a-z0-9][a-z0-9 .,()/+-]{1,79}$' then raise exception 'กรุณาพิมพ์ชื่อยาภาษาอังกฤษ เช่น amoxicillin'; end if;
  if (select count(*) from public.dailymed_requests where created_at > now() - interval '1 day') >= 300 then
    raise exception 'ค้น DailyMed ครบ 300 ครั้งของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;
  if to_regclass('net.http_request_queue') is null then raise exception 'ระบบยังไม่พร้อมเรียกข้อมูลภายนอก (pg_net)'; end if;
  req := net.http_get('https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json',
                      params := jsonb_build_object('drug_name', q, 'pagesize', '30'), timeout_milliseconds := 20000);
  insert into public.dailymed_requests (id, query) values (req, q);
  delete from public.dailymed_requests where created_at < now() - interval '7 days';   -- ล้างคำค้นเก่า (ตารางของระบบ)
  return req;
end $$;

create or replace function public.dailymed_result(p_id bigint)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare r public.dailymed_requests; res record; data jsonb;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into r from public.dailymed_requests where id = p_id;
  if r.id is null then raise exception 'ไม่พบคำค้นนี้'; end if;
  select h.status_code, h.content, h.timed_out into res from net._http_response h where h.id = p_id;
  if not found then
    return jsonb_build_object('status', case when r.created_at < now() - interval '1 minute' then 'error' else 'pending' end, 'query', r.query);
  end if;
  if res.status_code is distinct from 200 then
    return jsonb_build_object('status', 'error', 'query', r.query, 'code', res.status_code);
  end if;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('title', left(e->>'title', 300), 'setid', left(e->>'setid', 60),
                                                 'published_date', left(e->>'published_date', 20), 'spl_version', e->'spl_version') order by n), '[]')
      into data
      from jsonb_array_elements(coalesce(res.content::jsonb->'data', '[]')) with ordinality t(e, n)
     where n <= 30 and coalesce(e->>'setid', '') ~ '^[A-Za-z0-9-]{8,60}$';
  exception when others then data := '[]';
  end;
  return jsonb_build_object('status', 'done', 'query', r.query, 'data', data);
end $$;

revoke execute on function public.dailymed_search(text), public.dailymed_result(bigint) from public, anon;
grant execute on function public.dailymed_search(text), public.dailymed_result(bigint) to authenticated;

select 'ok' as step_69_dailymed;
