-- =====================================================================
--  ขั้นที่ 26: กดถูกใจ + แสดงความคิดเห็นสั้น ๆ ได้โดยไม่ต้องเข้าสู่ระบบ — รันต่อจาก 26 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   ผู้ที่ไม่ได้ login: เบราว์เซอร์สร้างรหัสสุ่มประจำเครื่อง (token) → 1 เครื่อง กดถูกใจข่าวละ 1 ครั้ง (กดซ้ำ = ยกเลิก)
--   ตาราง news_anon_likes ไม่มีใครอ่าน/เขียนตรงได้ (RLS ไม่มี policy) · ใช้ผ่านฟังก์ชันเท่านั้น
--   กันกดรัว: เครื่อง/IP เดียวกดถูกใจได้ไม่เกิน 60 ครั้งต่อชั่วโมง (เก็บ IP แบบแฮช ไม่เก็บตัวจริง)
--   ผู้ที่ login แล้วใช้ news_likes เหมือนเดิม · ยอดรวม = news_likes + news_anon_likes (liked)
-- =====================================================================

create table if not exists public.news_anon_likes (
  news_id     uuid not null references public.news(id) on delete cascade,
  token       uuid not null,
  ip_hash     text,
  liked       boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (news_id, token)
);
create index if not exists news_anon_likes_ip on public.news_anon_likes (ip_hash, updated_at);

alter table public.news_anon_likes enable row level security;
revoke all on public.news_anon_likes from anon, authenticated;
grant all on public.news_anon_likes to service_role;

-- ยอดถูกใจรวม + ฉันกดถูกใจแล้วหรือยัง (login = ดูจาก news_likes · ไม่ login = ดูจาก token)
create or replace function public.news_like_state(p_news uuid, p_token uuid default null)
returns table (total int, mine boolean) language sql stable security definer
set search_path = ''
as $$
  select ((select count(*) from public.news_likes l where l.news_id = p_news)
        + (select count(*) from public.news_anon_likes a where a.news_id = p_news and a.liked))::int,
         exists (select 1 from public.news_likes l where l.news_id = p_news and l.user_id = auth.uid())
      or exists (select 1 from public.news_anon_likes a where a.news_id = p_news and a.token = p_token and a.liked)
$$;

create or replace function public.like_news_anon(p_news uuid, p_token uuid, p_on boolean)
returns int language plpgsql security definer
set search_path = ''
as $$
declare
  ip text;
  recent int;
begin
  if p_token is null then raise exception 'ไม่พบรหัสเครื่อง กรุณารีเฟรชหน้า'; end if;
  if not exists (select 1 from public.news n where n.id = p_news and n.status = 'published') then
    raise exception 'ไม่พบข่าวนี้';
  end if;
  begin
    ip := nullif(btrim(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1)), '');
  exception when others then ip := null;
  end;
  ip := case when ip is null then null else md5('pcps-like:' || ip) end;
  if p_on then
    select count(*) into recent from public.news_anon_likes a
     where a.updated_at > now() - interval '1 hour' and (a.token = p_token or (ip is not null and a.ip_hash = ip));
    if recent >= 60 then raise exception 'กดถูกใจถี่เกินไป กรุณารอสักครู่'; end if;
  end if;
  insert into public.news_anon_likes (news_id, token, ip_hash, liked) values (p_news, p_token, ip, p_on)
  on conflict (news_id, token) do update set liked = excluded.liked, ip_hash = coalesce(excluded.ip_hash, public.news_anon_likes.ip_hash), updated_at = now();
  return (select s.total from public.news_like_state(p_news, p_token) s);
end $$;

revoke execute on function public.news_like_state(uuid, uuid), public.like_news_anon(uuid, uuid, boolean) from public;
grant execute on function public.news_like_state(uuid, uuid), public.like_news_anon(uuid, uuid, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------
-- ความคิดเห็นแบบไม่ login: ไม่เกิน 15 ตัวอักษร (ยาวกว่านี้ต้อง login) · ชื่อแสดงเป็น "ผู้เยี่ยมชม"
--   กันสแปม: เครื่อง/IP เดียวส่งได้ไม่เกิน 5 ความคิดเห็นต่อ 10 นาที · ที่เก็บ token/IP แยกตาราง (ไม่มีใครอ่านได้)
-- ---------------------------------------------------------------------
create table if not exists public.news_anon_comment_log (
  comment_id  bigint primary key references public.news_comments(id) on delete cascade,
  token       uuid not null,
  ip_hash     text,
  created_at  timestamptz not null default now()
);
create index if not exists news_anon_comment_log_recent on public.news_anon_comment_log (created_at);
alter table public.news_anon_comment_log enable row level security;
revoke all on public.news_anon_comment_log from anon, authenticated;
grant all on public.news_anon_comment_log to service_role;

-- ผู้เขียน: login = ชื่อจากโปรไฟล์ (เดิม) · ไม่ login (มาจาก comment_news_anon เท่านั้น) = "ผู้เยี่ยมชม"
create or replace function public.fill_comment_author()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  new.author_id := auth.uid();
  if auth.uid() is null then
    new.author_name := 'ผู้เยี่ยมชม';
  else
    select coalesce(p.full_name, 'ผู้ใช้') into new.author_name from public.profiles p where p.id = auth.uid();
  end if;
  return new;
end $$;

create or replace function public.comment_news_anon(p_news uuid, p_body text, p_token uuid)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare
  b text := btrim(coalesce(p_body, ''));
  ip text;
  recent int;
  cid bigint;
begin
  if p_token is null then raise exception 'ไม่พบรหัสเครื่อง กรุณารีเฟรชหน้า'; end if;
  if char_length(b) < 1 then raise exception 'กรุณาพิมพ์ความคิดเห็น'; end if;
  if char_length(b) > 15 then raise exception 'กรุณาเข้าสู่ระบบเพื่อเขียนแสดงความเห็นมากขึ้น (ไม่ได้เข้าสู่ระบบ พิมพ์ได้ไม่เกิน 15 ตัวอักษร)'; end if;
  if not exists (select 1 from public.news n where n.id = p_news and n.status = 'published' and not n.comments_closed) then
    raise exception 'ข่าวนี้ปิดรับความคิดเห็นแล้ว';
  end if;
  begin
    ip := nullif(btrim(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1)), '');
  exception when others then ip := null;
  end;
  ip := case when ip is null then null else md5('pcps-comment:' || ip) end;
  select count(*) into recent from public.news_anon_comment_log l
   where l.created_at > now() - interval '10 minutes' and (l.token = p_token or (ip is not null and l.ip_hash = ip));
  if recent >= 5 then raise exception 'ส่งความคิดเห็นถี่เกินไป กรุณารอสักครู่'; end if;
  insert into public.news_comments (news_id, body) values (p_news, b) returning id into cid;
  insert into public.news_anon_comment_log (comment_id, token, ip_hash) values (cid, p_token, ip);
  return cid;
end $$;
revoke execute on function public.comment_news_anon(uuid, text, uuid) from public;
grant execute on function public.comment_news_anon(uuid, text, uuid) to anon, authenticated;

select 'ok' as step_26_anon_likes_comments;
