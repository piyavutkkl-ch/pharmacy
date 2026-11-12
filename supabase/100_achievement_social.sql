-- =====================================================================
--  ขั้นที่ 100: หน้าผลงาน กดถูกใจ แชร์ แสดงความคิดเห็น (ทั้งผู้ที่ล็อกอินและไม่ล็อกอิน)
--   - view_count: จำนวนผู้เข้าชม (bump_achievement_view)
--   - achievement_likes / achievement_anon_likes: ถูกใจ (achievement_like_state, like_achievement_anon)
--   - achievement_comments / achievement_anon_comment_log: ความคิดเห็น (comment_achievement_anon)
--   - comments_closed: ผู้ดูแลปิดรับความคิดเห็น
-- =====================================================================

alter table public.achievements add column if not exists view_count bigint not null default 0;
alter table public.achievements add column if not exists comments_closed boolean not null default false;

-- 1) เพิ่มยอดผู้เข้าชม
create or replace function public.bump_achievement_view(p_achievement uuid)
returns void language sql security definer
set search_path = ''
as $$ update public.achievements set view_count = view_count + 1 where id = p_achievement and not hidden $$;

-- 2) ถูกใจผลงาน: สมาชิก (achievement_likes) + ไม่ได้ login (achievement_anon_likes)
create table if not exists public.achievement_likes (
  achievement_id uuid not null references public.achievements(id) on delete cascade,
  user_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (achievement_id, user_id)
);

create table if not exists public.achievement_anon_likes (
  achievement_id uuid not null references public.achievements(id) on delete cascade,
  token          uuid not null,
  ip_hash        text,
  liked          boolean not null default true,
  updated_at     timestamptz not null default now(),
  primary key (achievement_id, token)
);
create index if not exists achievement_anon_likes_ip on public.achievement_anon_likes (ip_hash, updated_at);

-- ยอดถูกใจรวม + ฉันกดถูกใจแล้วหรือยัง
create or replace function public.achievement_like_state(p_achievement uuid, p_token uuid default null)
returns table (total int, mine boolean) language sql stable security definer
set search_path = ''
as $$
  select ((select count(*) from public.achievement_likes l where l.achievement_id = p_achievement)
        + (select count(*) from public.achievement_anon_likes a where a.achievement_id = p_achievement and a.liked))::int,
         exists (select 1 from public.achievement_likes l where l.achievement_id = p_achievement and l.user_id = auth.uid())
      or exists (select 1 from public.achievement_anon_likes a where a.achievement_id = p_achievement and a.token = p_token and a.liked)
$$;

create or replace function public.like_achievement_anon(p_achievement uuid, p_token uuid, p_on boolean)
returns int language plpgsql security definer
set search_path = ''
as $$
declare
  ip text;
  recent int;
begin
  if p_token is null then raise exception 'ไม่พบรหัสเครื่อง กรุณารีเฟรชหน้า'; end if;
  if not exists (select 1 from public.achievements a where a.id = p_achievement and not a.hidden) then
    raise exception 'ไม่พบผลงานนี้';
  end if;
  begin
    ip := nullif(btrim(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1)), '');
  exception when others then ip := null;
  end;
  ip := case when ip is null then null else md5('pcps-like:' || ip) end;
  if p_on then
    select count(*) into recent from public.achievement_anon_likes a
     where a.updated_at > now() - interval '1 hour' and (a.token = p_token or (ip is not null and a.ip_hash = ip));
    if recent >= 60 then raise exception 'กดถูกใจถี่เกินไป กรุณารอสักครู่'; end if;
  end if;
  insert into public.achievement_anon_likes (achievement_id, token, ip_hash, liked) values (p_achievement, p_token, ip, p_on)
  on conflict (achievement_id, token) do update set liked = excluded.liked, ip_hash = coalesce(excluded.ip_hash, public.achievement_anon_likes.ip_hash), updated_at = now();
  return (select s.total from public.achievement_like_state(p_achievement, p_token) s);
end $$;

-- 3) ความคิดเห็นผลงาน: สมาชิก + ไม่ได้ login
create table if not exists public.achievement_comments (
  id             bigint generated always as identity primary key,
  achievement_id uuid not null references public.achievements(id) on delete cascade,
  author_id      uuid default auth.uid() references public.profiles(id) on delete set null,
  author_name    text,
  body           text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at     timestamptz not null default now()
);
create index if not exists achievement_comments_ach_idx on public.achievement_comments (achievement_id, created_at);

drop trigger if exists achievement_comments_author on public.achievement_comments;
create trigger achievement_comments_author before insert on public.achievement_comments
  for each row execute function public.fill_comment_author();

create table if not exists public.achievement_anon_comment_log (
  comment_id  bigint primary key references public.achievement_comments(id) on delete cascade,
  token       uuid not null,
  ip_hash     text,
  created_at  timestamptz not null default now()
);
create index if not exists achievement_anon_comment_log_recent on public.achievement_anon_comment_log (created_at);

-- rate limit: ใช้ร่วมกับ rate_limit_guard
create or replace function public.rate_limit_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if tg_table_name = 'news_comments' then
    select count(*) into n from public.news_comments c where c.author_id = auth.uid() and c.created_at > now() - interval '10 minutes';
    if n >= 10 then raise exception 'แสดงความคิดเห็นถี่เกินไป กรุณารอสักครู่' using errcode = 'P0001'; end if;
  elsif tg_table_name = 'achievement_comments' then
    select count(*) into n from public.achievement_comments c where c.author_id = auth.uid() and c.created_at > now() - interval '10 minutes';
    if n >= 10 then raise exception 'แสดงความคิดเห็นถี่เกินไป กรุณารอสักครู่' using errcode = 'P0001'; end if;
  elsif tg_table_name = 'feedback' then
    select count(*) into n from public.feedback f where f.author_id = auth.uid() and f.created_at > now() - interval '1 hour';
    if n >= 10 then raise exception 'ส่งข้อเสนอแนะถี่เกินไป กรุณาลองใหม่ภายหลัง' using errcode = 'P0001'; end if;
  elsif tg_table_name = 'conversations' then
    select count(*) into n from public.conversations c where c.citizen_id = auth.uid() and c.created_at > now() - interval '1 day';
    if n >= 5 then raise exception 'เปิดห้องสนทนาใหม่ได้ไม่เกิน 5 ห้องต่อวัน' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;

drop trigger if exists achievement_comments_rate on public.achievement_comments;
create trigger achievement_comments_rate before insert on public.achievement_comments for each row execute function public.rate_limit_guard();

create or replace function public.comment_achievement_anon(p_achievement uuid, p_body text, p_token uuid)
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
  if not exists (select 1 from public.achievements a where a.id = p_achievement and not a.hidden and not a.comments_closed) then
    raise exception 'ผลงานนี้ปิดรับความคิดเห็นแล้ว';
  end if;
  begin
    ip := nullif(btrim(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1)), '');
  exception when others then ip := null;
  end;
  ip := case when ip is null then null else md5('pcps-comment:' || ip) end;
  select count(*) into recent from public.achievement_anon_comment_log l
   where l.created_at > now() - interval '10 minutes' and (l.token = p_token or (ip is not null and l.ip_hash = ip));
  if recent >= 5 then raise exception 'ส่งความคิดเห็นถี่เกินไป กรุณารอสักครู่'; end if;
  insert into public.achievement_comments (achievement_id, body) values (p_achievement, b) returning id into cid;
  insert into public.achievement_anon_comment_log (comment_id, token, ip_hash) values (cid, p_token, ip);
  return cid;
end $$;

-- 4) RLS & สิทธิ์
alter table public.achievement_likes enable row level security;
alter table public.achievement_anon_likes enable row level security;
alter table public.achievement_comments enable row level security;
alter table public.achievement_anon_comment_log enable row level security;

revoke all on public.achievement_anon_likes from anon, authenticated;
grant all on public.achievement_anon_likes to service_role;

revoke all on public.achievement_anon_comment_log from anon, authenticated;
grant all on public.achievement_anon_comment_log to service_role;

-- likes policies
drop policy if exists ach_likes_read on public.achievement_likes;
create policy ach_likes_read on public.achievement_likes for select using (true);

drop policy if exists ach_likes_insert on public.achievement_likes;
create policy ach_likes_insert on public.achievement_likes for insert to authenticated with check (user_id = auth.uid());

drop policy if exists ach_likes_delete on public.achievement_likes;
create policy ach_likes_delete on public.achievement_likes for delete to authenticated using (user_id = auth.uid());

-- comments policies
drop policy if exists ach_comments_read on public.achievement_comments;
create policy ach_comments_read on public.achievement_comments for select using (true);

drop policy if exists ach_comments_insert on public.achievement_comments;
create policy ach_comments_insert on public.achievement_comments for insert to authenticated
  with check (author_id = auth.uid() and char_length(btrim(body)) between 1 and 1000);

drop policy if exists ach_comments_delete on public.achievement_comments;
create policy ach_comments_delete on public.achievement_comments for delete to authenticated
  using (public.is_admin() or author_id = auth.uid());

-- grants
grant select (id, achievement_id, author_name, body, created_at) on public.achievement_comments to anon;
grant select, insert, delete on public.achievement_comments to authenticated;
grant select, insert, delete on public.achievement_likes to authenticated;
revoke select on public.achievement_likes from anon;

revoke execute on function public.achievement_like_state(uuid, uuid),
                           public.like_achievement_anon(uuid, uuid, boolean),
                           public.comment_achievement_anon(uuid, text, uuid),
                           public.bump_achievement_view(uuid) from public;

grant execute on function public.achievement_like_state(uuid, uuid),
                          public.like_achievement_anon(uuid, uuid, boolean),
                          public.comment_achievement_anon(uuid, text, uuid),
                          public.bump_achievement_view(uuid)
  to anon, authenticated;

select 'ok' as step_100_achievement_social;
