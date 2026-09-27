-- =====================================================================
--  Primary Care Pharmacy Services · โรงพยาบาลควนกาหลง จ.สตูล
--  ขั้นที่ 1: โครงฐานข้อมูล + สิทธิ์ (RLS) สำหรับ Supabase (แพ็กเกจฟรี)
--
--  วิธีใช้: Supabase > SQL Editor > New query > วางทั้งไฟล์ > Run
--  (ใช้กับโปรเจกต์ใหม่ รันครั้งเดียว)
--
--  หลักการ
--   • ทุกตารางเปิด Row Level Security — หน้าเว็บใช้ publishable key ได้อย่างปลอดภัย
--   • role มาจากตาราง staff_roster ที่ผู้ดูแลลงทะเบียนอีเมลไว้ (ไม่มี = ประชาชน)
--   • ผู้ใช้แก้ role / รพ.สต. ของตัวเองไม่ได้
--   • ปีงบประมาณ = ปี พ.ศ. นับจาก 1 ต.ค. (เช่น 1 ต.ค. 2569 = ปีงบ 2570)
--   • เกณฑ์มาตรฐานเก็บแยกชุดต่อปีงบ แก้ปีนี้ไม่กระทบคะแนนปีเก่า
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0) ฟังก์ชันพื้นฐาน
-- ---------------------------------------------------------------------
create or replace function public.fiscal_year_of(d date)
returns int language sql immutable
set search_path = ''
as $$
  select extract(year from d)::int + 543
         + case when extract(month from d) >= 10 then 1 else 0 end
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;


-- ---------------------------------------------------------------------
-- 1) หน่วยบริการ (รพ.สต.) + ช่องทางติดต่อ
-- ---------------------------------------------------------------------
create table public.units (
  id          smallint primary key,
  name        text not null unique,
  phone       text,
  address     text,
  note        text,
  image_path  text,
  sort        smallint not null default 0,
  updated_at  timestamptz not null default now()
);

insert into public.units (id, name, sort) values
  (0, 'ควนกาหลง', 0),
  (1, 'กระทูน', 1),
  (2, 'ทุ่งนุ้ย', 2),
  (3, 'ควนบ่อทอง', 3),
  (4, 'อุใดเจริญ', 4),
  (5, 'บ้านผัง 34', 5),
  (6, 'เหนือคลอง', 6);


-- ---------------------------------------------------------------------
-- 2) ผู้ใช้ · สิทธิ์
-- ---------------------------------------------------------------------
-- รายชื่อเจ้าหน้าที่/ผู้ดูแล ที่ผู้ดูแลลงทะเบียนอีเมล Google ไว้ล่วงหน้า
create table public.staff_roster (
  email       text primary key check (email = lower(btrim(email)) and email like '%@%'),
  full_name   text not null,
  role        text not null check (role in ('staff', 'admin')),
  unit_id     smallint references public.units(id),
  phone       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint staff_needs_unit check (role = 'admin' or unit_id is not null)
);

-- โปรไฟล์ของทุกคนที่ login (สร้างอัตโนมัติจาก trigger)
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  full_name     text check (full_name is null or char_length(full_name) <= 120),
  avatar_url    text,
  role          text not null default 'citizen' check (role in ('citizen', 'staff', 'admin')),
  unit_id       smallint references public.units(id),
  phone         text check (phone is null or phone ~ '^[0-9][0-9 -]{7,14}$'),
  address       text check (address is null or char_length(address) <= 200),
  home_unit_id  smallint references public.units(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger staff_roster_touch before update on public.staff_roster
  for each row execute function public.touch_updated_at();

-- ตัวช่วยตรวจสิทธิ์ (security definer → อ่าน profiles ได้โดยไม่วน RLS)
create or replace function public.my_role()
returns text language sql stable security definer
set search_path = ''
as $$ select p.role from public.profiles p where p.id = auth.uid() $$;

create or replace function public.my_unit()
returns smallint language sql stable security definer
set search_path = ''
as $$ select p.unit_id from public.profiles p where p.id = auth.uid() $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = ''
as $$ select coalesce((select p.role = 'admin' from public.profiles p where p.id = auth.uid()), false) $$;

create or replace function public.is_staff_of(u smallint)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'staff' and p.unit_id = u)
$$;

create or replace function public.is_staff_or_admin()
returns boolean language sql stable security definer
set search_path = ''
as $$ select coalesce((select p.role in ('staff', 'admin') from public.profiles p where p.id = auth.uid()), false) $$;

-- สร้างโปรไฟล์เมื่อมีคน login ครั้งแรก (รับเฉพาะ Google)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  r public.staff_roster%rowtype;
begin
  if coalesce(new.raw_app_meta_data ->> 'provider', '') <> 'google' then
    raise exception 'รองรับการเข้าสู่ระบบด้วย Google เท่านั้น';
  end if;

  select * into r from public.staff_roster s
   where s.email = lower(new.email) and s.active;

  insert into public.profiles (id, email, full_name, avatar_url, role, unit_id, phone)
  values (
    new.id,
    lower(new.email),
    coalesce(r.full_name, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(r.role, 'citizen'),
    r.unit_id,
    r.phone
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- เมื่อผู้ดูแลเพิ่ม/แก้/ลบรายชื่อ → อัปเดต role ของคนที่เคย login แล้ว
create or replace function public.sync_roster_to_profile()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and (tg_op = 'DELETE' or old.email <> new.email) then
    update public.profiles set role = 'citizen', unit_id = null where email = old.email;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.active then
      update public.profiles
         set role = new.role, unit_id = new.unit_id,
             full_name = coalesce(full_name, new.full_name)
       where email = new.email;
    else
      update public.profiles set role = 'citizen', unit_id = null where email = new.email;
    end if;
  end if;
  return null;
end $$;

create trigger staff_roster_sync
  after insert or update or delete on public.staff_roster
  for each row execute function public.sync_roster_to_profile();


-- ---------------------------------------------------------------------
-- 3) ข่าวประชาสัมพันธ์ (เจ้าหน้าที่ส่ง → ผู้ดูแลตรวจ → เผยแพร่)
-- ---------------------------------------------------------------------
create table public.news (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(btrim(title)) between 1 and 200),
  tag              text not null default 'ประกาศ' check (tag in ('ประกาศ', 'อบรม', 'รายงาน')),
  body             text not null check (char_length(body) between 1 and 20000),
  image_path       text,
  status           text not null default 'pending'
                     check (status in ('pending', 'fix', 'rejected', 'published')),
  unit_id          smallint references public.units(id),   -- null = ผู้ดูแลเขียนเอง
  author_id        uuid default auth.uid() references public.profiles(id) on delete set null,
  review_comment   text,
  comments_closed  boolean not null default false,
  view_count       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  published_at     timestamptz
);
create index news_status_pub_idx on public.news (status, published_at desc);

create or replace function public.guard_news()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  -- ใช้กฎนี้เฉพาะคำขอจากหน้าเว็บ (ฟังก์ชันระบบ เช่น ตัวนับผู้อ่าน ไม่ถูกบังคับ)
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    -- เจ้าหน้าที่: ส่งตรวจได้อย่างเดียว แก้ช่องของผู้ดูแลไม่ได้
    new.status := 'pending';
    new.unit_id := public.my_unit();
    new.author_id := auth.uid();
    new.comments_closed := false;
    new.published_at := null;
    if tg_op = 'UPDATE' then
      new.review_comment := old.review_comment;
      new.view_count := old.view_count;
      new.created_at := old.created_at;
    else
      new.review_comment := null;
      new.view_count := 0;
    end if;
  end if;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then
    new.published_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger news_guard before insert or update on public.news
  for each row execute function public.guard_news();

create table public.news_comments (
  id           bigint generated always as identity primary key,
  news_id      uuid not null references public.news(id) on delete cascade,
  author_id    uuid default auth.uid() references public.profiles(id) on delete set null,
  author_name  text,
  body         text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at   timestamptz not null default now()
);
create index news_comments_news_idx on public.news_comments (news_id, created_at);

create table public.news_likes (
  news_id     uuid not null references public.news(id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (news_id, user_id)
);

create or replace function public.fill_comment_author()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  new.author_id := auth.uid();
  select coalesce(p.full_name, 'ผู้ใช้') into new.author_name from public.profiles p where p.id = auth.uid();
  return new;
end $$;
create trigger news_comments_author before insert on public.news_comments
  for each row execute function public.fill_comment_author();

-- ตัวนับผู้เข้าชม (เรียกได้โดยไม่ต้อง login)
create table public.site_stats (
  key    text primary key,
  count  bigint not null default 0
);
insert into public.site_stats (key) values ('home_views');

create or replace function public.bump_home_views()
returns bigint language sql security definer
set search_path = ''
as $$ update public.site_stats set count = count + 1 where key = 'home_views' returning count $$;

create or replace function public.bump_news_view(p_news uuid)
returns void language sql security definer
set search_path = ''
as $$ update public.news set view_count = view_count + 1 where id = p_news and status = 'published' $$;


-- ---------------------------------------------------------------------
-- 4) ผลงานมาตรฐานความปลอดภัยด้านยา ในรพ.สต. (เจ้าหน้าที่เผยแพร่เองได้)
-- ---------------------------------------------------------------------
create table public.achievements (
  id          uuid primary key default gen_random_uuid(),
  unit_id     smallint not null references public.units(id),
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  body        text check (body is null or char_length(body) <= 10000),
  image_path  text,
  author_id   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger achievements_touch before update on public.achievements
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 5) เกณฑ์มาตรฐาน (แยกชุดต่อปีงบ) + สถานะการส่ง/ตรวจ ของแต่ละ รพ.สต.
-- ---------------------------------------------------------------------
create table public.criteria_years (
  fiscal_year  int primary key check (fiscal_year between 2560 and 2700),
  note         text,
  created_at   timestamptz not null default now()
);

create table public.criteria_items (
  id           bigint generated always as identity primary key,
  fiscal_year  int not null references public.criteria_years(fiscal_year) on delete cascade,
  topic_no     smallint not null,
  topic_title  text not null,
  sub_id       text not null,
  sub_label    text,
  evidence     text,               -- หลักฐาน/เอกสารที่ต้องใช้ในการดู
  item_no      text not null,      -- เช่น 3.2.1
  body         text not null,
  sort         int not null,
  unique (fiscal_year, item_no)
);
create index criteria_items_year_idx on public.criteria_items (fiscal_year, sort);

create table public.item_status (
  id              bigint generated always as identity primary key,
  item_id         bigint not null references public.criteria_items(id) on delete cascade,
  unit_id         smallint not null references public.units(id),
  status          text not null default 'none' check (status in ('none', 'submitted', 'approved', 'fix')),
  detail          text check (detail is null or char_length(detail) <= 4000),
  evidence_paths  text[] not null default '{}',
  submitted_by    uuid references public.profiles(id) on delete set null,
  submitted_at    timestamptz,
  reviewed_by     uuid references public.profiles(id) on delete set null,
  reviewed_at     timestamptz,
  review_comment  text,
  updated_at      timestamptz not null default now(),
  unique (item_id, unit_id)
);
create index item_status_unit_idx on public.item_status (unit_id);

create or replace function public.guard_item_status()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    null;  -- SQL Editor / ฟังก์ชันระบบ
  elsif public.is_admin() then
    if tg_op = 'INSERT' or new.status is distinct from old.status or new.review_comment is distinct from old.review_comment then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    end if;
  else
    -- เจ้าหน้าที่: ส่ง/ส่งแก้ได้อย่างเดียว ตั้ง "อนุมัติ" เองไม่ได้ และส่งย้อนหลังในปีงบที่ปิดแล้วไม่ได้
    if (select ci.fiscal_year from public.criteria_items ci where ci.id = new.item_id)
         < public.fiscal_year_of(current_date) then
      raise exception 'ปีงบประมาณนี้ปิดแล้ว ส่งหลักฐานเพิ่มไม่ได้';
    end if;
    new.status := 'submitted';
    new.submitted_by := auth.uid();
    new.submitted_at := now();
    if tg_op = 'UPDATE' then
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
      new.review_comment := old.review_comment;
      new.item_id := old.item_id;
      new.unit_id := old.unit_id;
    else
      new.reviewed_by := null;
      new.reviewed_at := null;
      new.review_comment := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger item_status_guard before insert or update on public.item_status
  for each row execute function public.guard_item_status();

-- ผู้ดูแลขึ้นปีงบใหม่: คัดลอกเกณฑ์จากปีล่าสุดก่อนหน้า (ปีเก่าไม่เปลี่ยน)
create or replace function public.start_fiscal_year(p_year int)
returns int language plpgsql security definer
set search_path = ''
as $$
declare
  src int;
  n int;
begin
  if not public.is_admin() and auth.uid() is not null then
    raise exception 'เฉพาะผู้ดูแลเท่านั้น';
  end if;
  if exists (select 1 from public.criteria_years where fiscal_year = p_year) then
    return 0;
  end if;
  select max(fiscal_year) into src from public.criteria_years where fiscal_year < p_year;
  insert into public.criteria_years (fiscal_year, note)
  values (p_year, 'คัดลอกจากปีงบ ' || coalesce(src::text, '-'));
  insert into public.criteria_items (fiscal_year, topic_no, topic_title, sub_id, sub_label, evidence, item_no, body, sort)
  select p_year, topic_no, topic_title, sub_id, sub_label, evidence, item_no, body, sort
    from public.criteria_items where fiscal_year = src;
  get diagnostics n = row_count;
  return n;
end $$;

-- คะแนนรวมรายหน่วย (ตัวเลขสรุป — หน้าแรกดูได้โดยไม่ต้อง login)
create or replace function public.public_unit_scores(p_year int)
returns table (unit_id smallint, unit_name text, score int, max_score int)
language sql stable security definer
set search_path = ''
as $$
  with items as (select id from public.criteria_items where fiscal_year = p_year)
  select u.id, u.name,
         count(s.id) filter (where s.status = 'approved')::int,
         (select count(*) from items)::int
    from public.units u
    left join public.item_status s on s.unit_id = u.id and s.item_id in (select id from items)
   group by u.id, u.name
   order by 3 desc, u.sort
$$;


-- ---------------------------------------------------------------------
-- 6) เยี่ยมบ้าน: ผู้ป่วย + บันทึกการเยี่ยม (ข้อมูลอ่อนไหว — เฉพาะ รพ.สต. นั้น + ผู้ดูแล)
-- ---------------------------------------------------------------------
create table public.patients (
  id           uuid primary key default gen_random_uuid(),
  unit_id      smallint not null references public.units(id),
  first_name   text not null check (char_length(btrim(first_name)) between 1 and 80),
  last_name    text not null check (char_length(btrim(last_name)) between 1 and 80),
  national_id  text check (national_id is null or national_id ~ '^[0-9]{13}$'),
  birth_date   date,
  hn_hospital  text,
  hn_unit      text,
  coverage     text check (coverage is null or coverage in
                 ('ประชาชนทั่วไป', 'บัตรทอง (สปสช.)', 'ข้าราชการ/รัฐวิสาหกิจ', 'ประกันสังคม', 'อื่นๆ')),
  created_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index patients_unit_idx on public.patients (unit_id);
create trigger patients_touch before update on public.patients
  for each row execute function public.touch_updated_at();

create table public.visits (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references public.patients(id) on delete cascade,
  unit_id        smallint not null references public.units(id),   -- เติมอัตโนมัติจากผู้ป่วย
  visit_date     date not null,
  fiscal_year    int generated always as (public.fiscal_year_of(visit_date)) stored,
  age            smallint check (age is null or age between 0 and 130),
  weight         numeric(5,1) check (weight is null or weight between 0 and 400),
  bp             text,
  dtx            text,
  subjective     text,
  med_reconcile  text,
  med_list       jsonb not null default '[]' check (jsonb_typeof(med_list) = 'array'),
  med_excess     boolean not null default false,   -- ยาเหลือค้างที่บ้านเกิน 1 เดือน
  drps           text[] not null default '{}',
  drp_detail     text,
  drp_resolved   boolean not null default false,
  plan           text,
  next_appt      date,
  med_until      date,
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index visits_patient_idx on public.visits (patient_id, visit_date desc);
create index visits_unit_year_idx on public.visits (unit_id, fiscal_year);

create or replace function public.visit_set_unit()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  select p.unit_id into new.unit_id from public.patients p where p.id = new.patient_id;
  if new.unit_id is null then
    raise exception 'ไม่พบผู้ป่วย';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger visits_set_unit before insert or update on public.visits
  for each row execute function public.visit_set_unit();

-- ตัวเลขสรุปผลการดำเนินงาน (หน้าแรก ไม่ต้อง login — ไม่มีข้อมูลรายบุคคล)
create or replace function public.public_tracking_stats(p_year int, p_unit smallint default null)
returns table (visits int, drps_found int, drps_resolved int, excess_resolved int)
language sql stable security definer
set search_path = ''
as $$
  with v as (
    select * from public.visits
     where fiscal_year = p_year and (p_unit is null or unit_id = p_unit)
  )
  select
    (select count(*) from v)::int,
    (select count(*) from v where cardinality(drps) > 0)::int,
    (select count(*) from v where cardinality(drps) > 0 and drp_resolved)::int,
    (select count(distinct a.patient_id) from v a
       where a.med_excess
         and exists (select 1 from v b where b.patient_id = a.patient_id
                       and b.visit_date > a.visit_date and not b.med_excess))::int
$$;


-- ---------------------------------------------------------------------
-- 7) กล่องข้อความ ประชาชน ⇄ เจ้าหน้าที่ รพ.สต. / ห้องยา รพ.
-- ---------------------------------------------------------------------
create table public.conversations (
  id                    uuid primary key default gen_random_uuid(),
  citizen_id            uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  target_unit           smallint references public.units(id),   -- null = โรงพยาบาล (ห้องยา)
  last_message_at       timestamptz,
  last_message_preview  text,
  unread_staff          int not null default 0,
  unread_citizen        int not null default 0,
  created_at            timestamptz not null default now()
);
create unique index conversations_one_per_target
  on public.conversations (citizen_id, coalesce(target_unit, -1));
create index conversations_target_idx on public.conversations (target_unit, last_message_at desc);

create table public.messages (
  id               bigint generated always as identity primary key,
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  sender_id        uuid default auth.uid() references public.profiles(id) on delete set null,
  sender_role      text not null default 'citizen' check (sender_role in ('citizen', 'staff')),
  sender_name      text,
  body             text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at       timestamptz not null default now()
);
create index messages_conv_idx on public.messages (conversation_id, created_at);

create or replace function public.can_access_conversation(c_id uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
     where c.id = c_id
       and (c.citizen_id = auth.uid()
            or public.is_admin()
            or (public.my_role() = 'staff' and c.target_unit = public.my_unit()))
  )
$$;

create or replace function public.before_message()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  c public.conversations%rowtype;
  recent int;
begin
  select * into c from public.conversations where id = new.conversation_id;
  new.sender_id := auth.uid();
  new.sender_role := case when c.citizen_id = auth.uid() then 'citizen' else 'staff' end;
  select coalesce(p.full_name, 'ผู้ใช้') into new.sender_name from public.profiles p where p.id = auth.uid();
  new.created_at := now();
  -- กันส่งถี่เกินไป: ไม่เกิน 10 ข้อความต่อนาทีต่อคน
  select count(*) into recent from public.messages m
   where m.sender_id = auth.uid() and m.created_at > now() - interval '1 minute';
  if recent >= 10 then
    raise exception 'ส่งข้อความถี่เกินไป กรุณารอสักครู่';
  end if;
  return new;
end $$;
create trigger messages_before before insert on public.messages
  for each row execute function public.before_message();

create or replace function public.after_message()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  update public.conversations
     set last_message_at = new.created_at,
         last_message_preview = left(new.body, 120),
         unread_staff   = unread_staff   + case when new.sender_role = 'citizen' then 1 else 0 end,
         unread_citizen = unread_citizen + case when new.sender_role = 'staff'   then 1 else 0 end
   where id = new.conversation_id;
  return null;
end $$;
create trigger messages_after after insert on public.messages
  for each row execute function public.after_message();

-- ล้างตัวเลข "ยังไม่อ่าน" เมื่อเปิดห้องแชท
create or replace function public.mark_conversation_read(p_conv uuid)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  c public.conversations%rowtype;
begin
  select * into c from public.conversations where id = p_conv;
  if not found or not public.can_access_conversation(p_conv) then
    raise exception 'ไม่มีสิทธิ์';
  end if;
  if c.citizen_id = auth.uid() then
    update public.conversations set unread_citizen = 0 where id = p_conv;
  else
    update public.conversations set unread_staff = 0 where id = p_conv;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 8) เอกสารดาวน์โหลด (ผู้ดูแลอัปโหลด → เจ้าหน้าที่ดาวน์โหลด)
-- ---------------------------------------------------------------------
create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(btrim(title)) between 1 and 160),
  category      text not null default 'อื่น ๆ'
                  check (category in ('แบบฟอร์ม', 'คู่มือ / แนวทาง', 'หนังสือสั่งการ / ประกาศ', 'อื่น ๆ')),
  for_unit      smallint references public.units(id),   -- null = ทุก รพ.สต.
  note          text check (note is null or char_length(note) <= 240),
  file_path     text not null,
  file_name     text not null,
  file_size     bigint,
  content_type  text,
  version       int not null default 1,
  created_by    uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger documents_touch before update on public.documents
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 9) ข้อเสนอแนะถึงทีมพัฒนา (ท้ายเว็บ + จากเจ้าหน้าที่)
-- ---------------------------------------------------------------------
create table public.feedback (
  id          bigint generated always as identity primary key,
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  source      text not null default 'public' check (source in ('public', 'staff')),
  unit_id     smallint references public.units(id),
  author_id   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create or replace function public.fill_feedback()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare r text; u smallint;
begin
  select p.role, p.unit_id into r, u from public.profiles p where p.id = auth.uid();
  new.author_id := auth.uid();
  new.source := case when r = 'staff' then 'staff' else 'public' end;
  new.unit_id := case when r = 'staff' then u else null end;
  new.created_at := now();
  return new;
end $$;
create trigger feedback_fill before insert on public.feedback
  for each row execute function public.fill_feedback();


-- ---------------------------------------------------------------------
-- 10) รายการยาในเครื่องคำนวณโดส (ผู้ดูแลแก้ไข)
-- ---------------------------------------------------------------------
create table public.dose_drugs (
  id                  bigint generated always as identity primary key,
  name                text not null,
  indication          text,
  mg_per_kg_min       numeric not null check (mg_per_kg_min >= 0),
  mg_per_kg_max       numeric not null check (mg_per_kg_max >= mg_per_kg_min),
  per                 text not null check (per in ('dose', 'day')),
  max_mg_per_dose     numeric,
  dose_freq_per_day   smallint,
  freq                text,
  renal_note          text,
  concs               jsonb not null default '[]' check (jsonb_typeof(concs) = 'array'),
  sort                int not null default 0,
  active              boolean not null default true,
  updated_at          timestamptz not null default now()
);
create trigger dose_drugs_touch before update on public.dose_drugs
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 11) บันทึกการเปลี่ยนแปลงข้อมูลสำคัญ (PDPA)
-- ---------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  action      text not null,
  table_name  text not null,
  row_id      text
);
create index audit_log_at_idx on public.audit_log (at desc);

create or replace function public.write_audit()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare rid text;
begin
  rid := case when tg_op = 'DELETE' then to_jsonb(old) ->> 'id' else to_jsonb(new) ->> 'id' end;
  if tg_table_name = 'staff_roster' then
    rid := case when tg_op = 'DELETE' then old.email else new.email end;
  end if;
  insert into public.audit_log (actor_id, action, table_name, row_id)
  values (auth.uid(), lower(tg_op), tg_table_name, rid);
  return null;
end $$;

create trigger audit_patients     after insert or update or delete on public.patients     for each row execute function public.write_audit();
create trigger audit_visits       after insert or update or delete on public.visits       for each row execute function public.write_audit();
create trigger audit_documents    after insert or update or delete on public.documents    for each row execute function public.write_audit();
create trigger audit_staff_roster after insert or update or delete on public.staff_roster for each row execute function public.write_audit();
create trigger audit_item_status  after update on public.item_status for each row execute function public.write_audit();


-- =====================================================================
-- 12) ROW LEVEL SECURITY
-- =====================================================================
alter table public.units            enable row level security;
alter table public.staff_roster     enable row level security;
alter table public.profiles         enable row level security;
alter table public.news             enable row level security;
alter table public.news_comments    enable row level security;
alter table public.news_likes       enable row level security;
alter table public.site_stats       enable row level security;
alter table public.achievements     enable row level security;
alter table public.criteria_years   enable row level security;
alter table public.criteria_items   enable row level security;
alter table public.item_status      enable row level security;
alter table public.patients         enable row level security;
alter table public.visits           enable row level security;
alter table public.conversations    enable row level security;
alter table public.messages         enable row level security;
alter table public.documents        enable row level security;
alter table public.feedback         enable row level security;
alter table public.dose_drugs       enable row level security;
alter table public.audit_log        enable row level security;

-- ข้อมูลอ่อนไหว: ปิดสิทธิ์ของผู้ที่ยังไม่ login ทั้งตาราง (ชั้นป้องกันที่ 2 นอกจาก RLS)
revoke all on public.staff_roster, public.profiles, public.item_status, public.patients, public.visits,
              public.conversations, public.messages, public.documents, public.feedback, public.audit_log
  from anon;

-- profiles: ผู้ใช้แก้ได้เฉพาะชื่อ เบอร์ ที่อยู่ หน่วยใกล้บ้าน (แก้ role/รพ.สต. ไม่ได้)
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name, phone, address, home_unit_id) on public.profiles to authenticated;
-- conversations: ตัวนับเปลี่ยนผ่าน trigger / ฟังก์ชันเท่านั้น
revoke update on public.conversations from authenticated;
-- messages / audit_log / feedback: ห้ามแก้ย้อนหลัง
revoke update on public.messages, public.audit_log, public.feedback from authenticated;
revoke insert, delete on public.audit_log from authenticated;

-- units (ช่องทางติดต่อ)
create policy units_read on public.units for select using (true);
create policy units_admin_write on public.units for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- staff_roster
create policy roster_admin_all on public.staff_roster for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy roster_self_read on public.staff_roster for select to authenticated
  using (email = (select p.email from public.profiles p where p.id = auth.uid()));

-- profiles
create policy profiles_self_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin()
         or (public.my_role() = 'staff' and exists (
               select 1 from public.conversations c
                where c.citizen_id = profiles.id and c.target_unit = public.my_unit())));
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- news
create policy news_read on public.news for select
  using (status = 'published' or author_id = auth.uid() or public.is_admin());
create policy news_insert on public.news for insert to authenticated
  with check (public.is_staff_or_admin());
create policy news_update on public.news for update to authenticated
  using (public.is_admin() or (author_id = auth.uid() and status in ('pending', 'fix')))
  with check (public.is_admin() or author_id = auth.uid());
create policy news_delete on public.news for delete to authenticated
  using (public.is_admin() or (author_id = auth.uid() and status <> 'published'));

-- news_comments / likes
create policy comments_read on public.news_comments for select
  using (exists (select 1 from public.news n where n.id = news_id and n.status = 'published'));
create policy comments_insert on public.news_comments for insert to authenticated
  with check (exists (select 1 from public.news n
                       where n.id = news_id and n.status = 'published' and not n.comments_closed));
create policy comments_delete on public.news_comments for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());
create policy likes_read on public.news_likes for select using (true);
create policy likes_insert on public.news_likes for insert to authenticated with check (user_id = auth.uid());
create policy likes_delete on public.news_likes for delete to authenticated using (user_id = auth.uid());

-- site_stats (อ่านได้ทุกคน · เพิ่มค่าผ่านฟังก์ชันเท่านั้น)
create policy stats_read on public.site_stats for select using (true);

-- achievements
create policy ach_read on public.achievements for select using (true);
create policy ach_write on public.achievements for insert to authenticated
  with check (public.is_admin() or public.is_staff_of(unit_id));
create policy ach_update on public.achievements for update to authenticated
  using (public.is_admin() or public.is_staff_of(unit_id))
  with check (public.is_admin() or public.is_staff_of(unit_id));
create policy ach_delete on public.achievements for delete to authenticated
  using (public.is_admin() or public.is_staff_of(unit_id));

-- criteria
create policy crit_years_read on public.criteria_years for select using (true);
create policy crit_years_admin on public.criteria_years for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy crit_items_read on public.criteria_items for select using (true);
create policy crit_items_admin on public.criteria_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy status_read on public.item_status for select to authenticated
  using (public.is_admin() or public.is_staff_of(unit_id));
create policy status_insert on public.item_status for insert to authenticated
  with check (public.is_admin() or public.is_staff_of(unit_id));
create policy status_update on public.item_status for update to authenticated
  using (public.is_admin() or (public.is_staff_of(unit_id) and status <> 'approved'))
  with check (public.is_admin() or public.is_staff_of(unit_id));
create policy status_delete on public.item_status for delete to authenticated
  using (public.is_admin());

-- patients / visits (เฉพาะ รพ.สต. เดียวกัน + ผู้ดูแล)
create policy patients_rw on public.patients for all to authenticated
  using (public.is_admin() or public.is_staff_of(unit_id))
  with check (public.is_admin() or public.is_staff_of(unit_id));
create policy visits_rw on public.visits for all to authenticated
  using (public.is_admin() or public.is_staff_of(unit_id))
  with check (public.is_admin() or public.is_staff_of(unit_id));

-- conversations / messages
create policy conv_read on public.conversations for select to authenticated
  using (citizen_id = auth.uid() or public.is_admin()
         or (public.my_role() = 'staff' and target_unit = public.my_unit()));
create policy conv_insert on public.conversations for insert to authenticated
  with check (citizen_id = auth.uid()
              and exists (select 1 from public.profiles p where p.id = auth.uid() and p.phone is not null));
create policy conv_delete on public.conversations for delete to authenticated
  using (public.is_admin());
create policy msg_read on public.messages for select to authenticated
  using (public.can_access_conversation(conversation_id));
create policy msg_insert on public.messages for insert to authenticated
  with check (public.can_access_conversation(conversation_id));

-- documents
create policy docs_read on public.documents for select to authenticated
  using (public.is_admin() or (public.my_role() = 'staff' and (for_unit is null or for_unit = public.my_unit())));
create policy docs_admin on public.documents for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- feedback
create policy fb_insert on public.feedback for insert to authenticated with check (true);
create policy fb_read on public.feedback for select to authenticated
  using (public.is_admin() or author_id = auth.uid());
create policy fb_delete on public.feedback for delete to authenticated using (public.is_admin());

-- dose_drugs
create policy dose_read on public.dose_drugs for select using (active or public.is_admin());
create policy dose_admin on public.dose_drugs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- audit_log
create policy audit_admin_read on public.audit_log for select to authenticated using (public.is_admin());


-- ---------------------------------------------------------------------
-- 13) สิทธิ์เรียกฟังก์ชัน
-- ---------------------------------------------------------------------
revoke execute on function public.start_fiscal_year(int), public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.start_fiscal_year(int), public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.bump_home_views(), public.bump_news_view(uuid),
                          public.public_unit_scores(int), public.public_tracking_stats(int, smallint)
  to anon, authenticated;
revoke execute on function public.handle_new_user(), public.sync_roster_to_profile(), public.write_audit(),
                           public.before_message(), public.after_message(), public.fill_feedback(),
                           public.fill_comment_author(), public.visit_set_unit()
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 14) Realtime (แชท + ตัวเลขยังไม่อ่าน) — RLS ยังคุมว่าใครเห็นอะไร
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.messages, public.conversations;


-- ---------------------------------------------------------------------
-- 15) ที่เก็บไฟล์ (Supabase Storage 1 GB ฟรี)
--   public-images : รูปข่าว / ผลงาน / รพ.สต.   (เปิดสาธารณะ, ≤ 1 MB, รูปเท่านั้น)
--   documents     : เอกสารดาวน์โหลด            (ส่วนตัว, ≤ 5 MB)
--   evidence      : หลักฐานเกณฑ์มาตรฐาน        (ส่วนตัว, ≤ 2 MB)  path = ปีงบ/รพ.สต./ข้อ/ไฟล์
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('public-images', 'public-images', true,  1048576, array['image/webp', 'image/jpeg', 'image/png']),
  ('documents',     'documents',     false, 5242880, array['application/pdf', 'image/jpeg', 'image/png', 'text/csv', 'text/plain']),
  ('evidence',      'evidence',      false, 2097152, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

-- public-images: news/<uid>/…  achievements/<unit>/…  units/<unit>/…
create policy img_read on storage.objects for select
  using (bucket_id = 'public-images');
create policy img_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'public-images' and (
       public.is_admin()
    or ((storage.foldername(name))[1] = 'news' and (storage.foldername(name))[2] = auth.uid()::text
        and public.is_staff_or_admin())
    or ((storage.foldername(name))[1] = 'achievements' and (storage.foldername(name))[2] = public.my_unit()::text
        and public.my_role() = 'staff')));
create policy img_delete on storage.objects for delete to authenticated
  using (bucket_id = 'public-images' and (public.is_admin() or owner_id = auth.uid()::text));

-- documents: all/…  หรือ <unit>/…
create policy docfile_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (
       public.is_admin()
    or (public.my_role() = 'staff' and (storage.foldername(name))[1] in ('all', public.my_unit()::text))));
create policy docfile_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.is_admin());
create policy docfile_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'documents' and public.is_admin());
create policy docfile_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.is_admin());

-- evidence: <ปีงบ>/<unit>/…
create policy ev_read on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and (
       public.is_admin()
    or (public.my_role() = 'staff' and (storage.foldername(name))[2] = public.my_unit()::text)));
create policy ev_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and (
       public.is_admin()
    or (public.my_role() = 'staff' and (storage.foldername(name))[2] = public.my_unit()::text)));
create policy ev_delete on storage.objects for delete to authenticated
  using (bucket_id = 'evidence' and (public.is_admin() or owner_id = auth.uid()::text));

-- =====================================================================
-- 16) ข้อมูลเริ่มต้น: เกณฑ์มาตรฐานปีงบ 2569 (64 ข้อ) → คัดลอกเป็นปีงบ 2570 · รายการยาคำนวณโดส
-- =====================================================================
insert into public.criteria_years (fiscal_year, note) values (2569, 'คู่มือมาตรฐานหน่วยบริการปฐมภูมิ พ.ศ. 2568–2570 ส่วนที่ 7');
insert into public.criteria_items (fiscal_year, topic_no, topic_title, sub_id, sub_label, evidence, item_no, body, sort) values
  (2569, 1, '1. การจัดบริการเภสัชกรรม และการใช้ยาอย่างสมเหตุผล (RDU)', '1', 'การบริหารจัดการระบบยา', 'คำสั่งคณะกรรมการเภสัชกรรมและการบำบัดระดับอำเภอ · แผนปฏิบัติการ/Gantt chart · สมุดเยี่ยม/ผลปฏิบัติงาน · คู่มือ/สื่อการใช้ยา', '1.1', 'มีคำสั่งแต่งตั้งคณะกรรมการเภสัชกรรมและการบำบัด ในการจัดการระบบยาระดับอำเภอ', 1),
  (2569, 1, '1. การจัดบริการเภสัชกรรม และการใช้ยาอย่างสมเหตุผล (RDU)', '1', 'การบริหารจัดการระบบยา', 'คำสั่งคณะกรรมการเภสัชกรรมและการบำบัดระดับอำเภอ · แผนปฏิบัติการ/Gantt chart · สมุดเยี่ยม/ผลปฏิบัติงาน · คู่มือ/สื่อการใช้ยา', '1.2', 'มีแผนปฏิบัติการงานเภสัชกรรมปฐมภูมิประจำปี และปฏิบัติงานจริงตามแผน อย่างน้อย 4 ครั้งต่อปี', 2),
  (2569, 1, '1. การจัดบริการเภสัชกรรม และการใช้ยาอย่างสมเหตุผล (RDU)', '1', 'การบริหารจัดการระบบยา', 'คำสั่งคณะกรรมการเภสัชกรรมและการบำบัดระดับอำเภอ · แผนปฏิบัติการ/Gantt chart · สมุดเยี่ยม/ผลปฏิบัติงาน · คู่มือ/สื่อการใช้ยา', '1.3', 'มีการสนับสนุนวิชาการจากเภสัชกร รพ.แม่ข่าย ได้แก่ การจัดอบรมวิชาการ, คู่มือ/สื่อการใช้ยาในหน่วยบริการปฐมภูมิ', 3),
  (2569, 2, '2. การคัดเลือก การส่งมอบยาที่ปลอดภัยและมีคุณภาพ', '2.1', 'มียาใช้อย่างเหมาะสมและเพียงพอ', 'บัญชีรายการยาของหน่วยบริการปฐมภูมิ · ตรวจสอบ Emergency box และยาช่วยชีวิต · คู่มือ/แนวทางการใช้ยาช่วยชีวิต · หลักเกณฑ์การสั่งใช้ยา', '2.1.1', 'มีบัญชีรายการยาประจำหน่วยบริการปฐมภูมิ', 4),
  (2569, 2, '2. การคัดเลือก การส่งมอบยาที่ปลอดภัยและมีคุณภาพ', '2.1', 'มียาใช้อย่างเหมาะสมและเพียงพอ', 'บัญชีรายการยาของหน่วยบริการปฐมภูมิ · ตรวจสอบ Emergency box และยาช่วยชีวิต · คู่มือ/แนวทางการใช้ยาช่วยชีวิต · หลักเกณฑ์การสั่งใช้ยา', '2.1.2', 'มียาช่วยชีวิตในหน่วยบริการปฐมภูมิ และคู่มือการใช้ยาช่วยชีวิต', 5),
  (2569, 2, '2. การคัดเลือก การส่งมอบยาที่ปลอดภัยและมีคุณภาพ', '2.1', 'มียาใช้อย่างเหมาะสมและเพียงพอ', 'บัญชีรายการยาของหน่วยบริการปฐมภูมิ · ตรวจสอบ Emergency box และยาช่วยชีวิต · คู่มือ/แนวทางการใช้ยาช่วยชีวิต · หลักเกณฑ์การสั่งใช้ยา', '2.1.3', 'มีหลักเกณฑ์หรือขอบเขตในการสั่งใช้ยาที่สอดคล้องกับศักยภาพผู้สั่งใช้ยา', 6),
  (2569, 2, '2. การคัดเลือก การส่งมอบยาที่ปลอดภัยและมีคุณภาพ', '2.2', 'การเฝ้าระวังการใช้ยาในผู้ป่วยแพ้ยา/เสี่ยงสูง', 'ฐานข้อมูลผู้ป่วยแพ้ยา/เสี่ยงสูง · การตั้ง Pop-up เตือน · family folder ติดสติ๊กเกอร์ · แนวทางประเมิน/ส่งต่อผู้ป่วยแพ้ยา', '2.2.1', 'มีฐานข้อมูลผู้ป่วยแพ้ยา', 7),
  (2569, 2, '2. การคัดเลือก การส่งมอบยาที่ปลอดภัยและมีคุณภาพ', '2.2', 'การเฝ้าระวังการใช้ยาในผู้ป่วยแพ้ยา/เสี่ยงสูง', 'ฐานข้อมูลผู้ป่วยแพ้ยา/เสี่ยงสูง · การตั้ง Pop-up เตือน · family folder ติดสติ๊กเกอร์ · แนวทางประเมิน/ส่งต่อผู้ป่วยแพ้ยา', '2.2.2', 'มีฐานข้อมูลผู้ป่วยที่ใช้ยาเสี่ยงสูง', 8),
  (2569, 2, '2. การคัดเลือก การส่งมอบยาที่ปลอดภัยและมีคุณภาพ', '2.2', 'การเฝ้าระวังการใช้ยาในผู้ป่วยแพ้ยา/เสี่ยงสูง', 'ฐานข้อมูลผู้ป่วยแพ้ยา/เสี่ยงสูง · การตั้ง Pop-up เตือน · family folder ติดสติ๊กเกอร์ · แนวทางประเมิน/ส่งต่อผู้ป่วยแพ้ยา', '2.2.3', 'มีระบบสารสนเทศช่วยแจ้งเตือน/ให้ข้อมูลความปลอดภัยในการสั่งใช้ยาที่ผู้ป่วยแพ้ หรือยาที่มีความเสี่ยงสูง', 9),
  (2569, 2, '2. การคัดเลือก การส่งมอบยาที่ปลอดภัยและมีคุณภาพ', '2.2', 'การเฝ้าระวังการใช้ยาในผู้ป่วยแพ้ยา/เสี่ยงสูง', 'ฐานข้อมูลผู้ป่วยแพ้ยา/เสี่ยงสูง · การตั้ง Pop-up เตือน · family folder ติดสติ๊กเกอร์ · แนวทางประเมิน/ส่งต่อผู้ป่วยแพ้ยา', '2.2.4', 'มีแนวทางการประเมินประวัติแพ้ยาและการออกบัตรแพ้ยาเบื้องต้นในหน่วยบริการ โดยได้รับคำแนะนำปรึกษาจากเภสัชกรโรงพยาบาล', 10),
  (2569, 2, '2. การคัดเลือก การส่งมอบยาที่ปลอดภัยและมีคุณภาพ', '2.2', 'การเฝ้าระวังการใช้ยาในผู้ป่วยแพ้ยา/เสี่ยงสูง', 'ฐานข้อมูลผู้ป่วยแพ้ยา/เสี่ยงสูง · การตั้ง Pop-up เตือน · family folder ติดสติ๊กเกอร์ · แนวทางประเมิน/ส่งต่อผู้ป่วยแพ้ยา', '2.2.5', 'มีแนวทางการส่งต่อผู้ป่วยแพ้ยาไปโรงพยาบาล', 11),
  (2569, 2, '2. การคัดเลือก การส่งมอบยาที่ปลอดภัยและมีคุณภาพ', '2.2', 'การเฝ้าระวังการใช้ยาในผู้ป่วยแพ้ยา/เสี่ยงสูง', 'ฐานข้อมูลผู้ป่วยแพ้ยา/เสี่ยงสูง · การตั้ง Pop-up เตือน · family folder ติดสติ๊กเกอร์ · แนวทางประเมิน/ส่งต่อผู้ป่วยแพ้ยา', '2.2.6', 'ควรมีระบบข้อมูลที่สามารถเชื่อมโยงกับฐานข้อมูลโรงพยาบาล เรื่องการแพ้ยา', 12),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.1', 'สถานที่จัดเก็บยาและเวชภัณฑ์ตามมาตรฐาน (เกณฑ์คลังยา)', 'คำสั่ง/บันทึกมอบหมายถือกุญแจคลังคนละดอก · แนวทางเปิด-ปิดคลังยา (หน่วยไม่มีคลังยา=3 คะแนน มีคลังยา=4 คะแนน)', '3.1.1', 'ประตูมีกุญแจล็อค 2 ชั้น', 13),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.1', 'สถานที่จัดเก็บยาและเวชภัณฑ์ตามมาตรฐาน (เกณฑ์คลังยา)', 'คำสั่ง/บันทึกมอบหมายถือกุญแจคลังคนละดอก · แนวทางเปิด-ปิดคลังยา (หน่วยไม่มีคลังยา=3 คะแนน มีคลังยา=4 คะแนน)', '3.1.2', 'มีแนวทางการเปิด/ปิดคลังยาชัดเจน', 14),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.1', 'สถานที่จัดเก็บยาและเวชภัณฑ์ตามมาตรฐาน (เกณฑ์คลังยา)', 'คำสั่ง/บันทึกมอบหมายถือกุญแจคลังคนละดอก · แนวทางเปิด-ปิดคลังยา (หน่วยไม่มีคลังยา=3 คะแนน มีคลังยา=4 คะแนน)', '3.1.3', 'ไม่พบยาและเวชภัณฑ์วางบนพื้นโดยตรง', 15),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.1', 'สถานที่จัดเก็บยาและเวชภัณฑ์ตามมาตรฐาน (เกณฑ์คลังยา)', 'คำสั่ง/บันทึกมอบหมายถือกุญแจคลังคนละดอก · แนวทางเปิด-ปิดคลังยา (หน่วยไม่มีคลังยา=3 คะแนน มีคลังยา=4 คะแนน)', '3.1.4', 'มีการแยกประเภทยา เวชภัณฑ์ที่มิใช่ยา (วชย.) วัสดุการแพทย์ (วสด.) และวัสดุอื่นๆ ชัดเจน', 16),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.2', 'การควบคุมสถานที่/ตู้เก็บยา', 'คลัง/ตู้ยาไม่มีกลิ่นอับชื้น ยาไม่ถูกแสงแดด · เครื่องวัดอุณหภูมิ/ความชื้นสภาพดี สอบเทียบไม่เกิน 2 ปี', '3.2.1', 'มีการบันทึกอุณหภูมิเป็นปัจจุบัน และอุณหภูมิอยู่ในช่วง 20-30°C', 17),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.2', 'การควบคุมสถานที่/ตู้เก็บยา', 'คลัง/ตู้ยาไม่มีกลิ่นอับชื้น ยาไม่ถูกแสงแดด · เครื่องวัดอุณหภูมิ/ความชื้นสภาพดี สอบเทียบไม่เกิน 2 ปี', '3.2.2', 'มีการบันทึกความชื้นเป็นปัจจุบัน และความชื้นสัมพัทธ์ไม่เกิน 60%', 18),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.2', 'การควบคุมสถานที่/ตู้เก็บยา', 'คลัง/ตู้ยาไม่มีกลิ่นอับชื้น ยาไม่ถูกแสงแดด · เครื่องวัดอุณหภูมิ/ความชื้นสภาพดี สอบเทียบไม่เกิน 2 ปี', '3.2.3', 'คลังเวชภัณฑ์หรือตู้เก็บยา สามารถป้องกันสัตว์และแมลงได้', 19),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.2', 'การควบคุมสถานที่/ตู้เก็บยา', 'คลัง/ตู้ยาไม่มีกลิ่นอับชื้น ยาไม่ถูกแสงแดด · เครื่องวัดอุณหภูมิ/ความชื้นสภาพดี สอบเทียบไม่เกิน 2 ปี', '3.2.4', 'คลังเวชภัณฑ์หรือตู้เก็บยา ไม่มีแสงแดดส่องถึง', 20),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.2', 'การควบคุมสถานที่/ตู้เก็บยา', 'คลัง/ตู้ยาไม่มีกลิ่นอับชื้น ยาไม่ถูกแสงแดด · เครื่องวัดอุณหภูมิ/ความชื้นสภาพดี สอบเทียบไม่เกิน 2 ปี', '3.2.5', 'มีเทอร์โมมิเตอร์ที่ได้มาตรฐาน และมีผลการรับรองผ่านการสอบเทียบมาแล้วไม่เกิน 2 ปี', 21),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.3', 'การควบคุมและเบิกจ่ายเวชภัณฑ์', 'รบ.301/วภ.6/stock card/ทะเบียนคุมการเบิกจ่าย · ขั้นตอนรับเข้า-จ่ายออก · ตรวจนับยาในคลัง 10 รายการ', '3.3.1', 'สุ่ม stock card นับยา 10 รายการจำนวนถูกต้องครบถ้วน', 22),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.3', 'การควบคุมและเบิกจ่ายเวชภัณฑ์', 'รบ.301/วภ.6/stock card/ทะเบียนคุมการเบิกจ่าย · ขั้นตอนรับเข้า-จ่ายออก · ตรวจนับยาในคลัง 10 รายการ', '3.3.2', 'มีใบเบิกยาจากคลังยาโรงพยาบาล/กองเภสัชกรรมและมีการลงนามครบถ้วน (ผู้เบิก ผู้จ่าย ผู้รับ ผู้อนุมัติ)', 23),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.3', 'การควบคุมและเบิกจ่ายเวชภัณฑ์', 'รบ.301/วภ.6/stock card/ทะเบียนคุมการเบิกจ่าย · ขั้นตอนรับเข้า-จ่ายออก · ตรวจนับยาในคลัง 10 รายการ', '3.3.3', 'มีใบเบิกยาจากคลังยาโรงพยาบาล/กองเภสัชกรรมสอดคล้องกับ stock card และมีระบบควบคุมกำกับการรับเข้า-จ่ายออกที่ตรวจสอบได้', 24),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.3', 'การควบคุมและเบิกจ่ายเวชภัณฑ์', 'รบ.301/วภ.6/stock card/ทะเบียนคุมการเบิกจ่าย · ขั้นตอนรับเข้า-จ่ายออก · ตรวจนับยาในคลัง 10 รายการ', '3.3.4', 'มีใบเบิกยาจากคลังยาหน่วยบริการปฐมภูมิ ไปยังจุดจ่ายยา และมีการลงนามครบถ้วน (เฉพาะหน่วยที่แยกคลังเวชภัณฑ์กับจุดจ่ายยา)', 25),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.3', 'การควบคุมและเบิกจ่ายเวชภัณฑ์', 'รบ.301/วภ.6/stock card/ทะเบียนคุมการเบิกจ่าย · ขั้นตอนรับเข้า-จ่ายออก · ตรวจนับยาในคลัง 10 รายการ', '3.3.5', 'ใบเบิกยาจากคลังยาหน่วยบริการปฐมภูมิ สอดคล้องกับ stock card (เฉพาะหน่วยที่แยกคลังเวชภัณฑ์กับจุดจ่ายยา)', 26),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.4', 'การสำรองยาและเวชภัณฑ์เพียงพอ', 'สุ่ม รบ.301/วภ.6/Stock card/ทะเบียนคุมการเบิกจ่าย · ใบเบิกยาฉุกเฉินจากคลังยาโรงพยาบาล', '3.4.1', 'ไม่มียาขาด stock ในคลังยาหรือจุดจ่ายยา', 27),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.5', 'ระบบควบคุมยาหมดอายุ', 'สุ่มดูวันหมดอายุและลักษณะภายนอกของยา/เวชภัณฑ์ที่มิใช่ยา (สุ่ม 10 รายการ)', '3.5.1', 'มีระบบหรือแนวทางที่ช่วยตรวจสอบวันหมดอายุของเวชภัณฑ์ เช่น ระบบรหัสสีบอกปีหมดอายุ', 28),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.5', 'ระบบควบคุมยาหมดอายุ', 'สุ่มดูวันหมดอายุและลักษณะภายนอกของยา/เวชภัณฑ์ที่มิใช่ยา (สุ่ม 10 รายการ)', '3.5.2', 'ไม่พบยาและเวชภัณฑ์ที่มิใช่ยาเสื่อมสภาพ หรือหมดอายุ', 29),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.5', 'ระบบควบคุมยาหมดอายุ', 'สุ่มดูวันหมดอายุและลักษณะภายนอกของยา/เวชภัณฑ์ที่มิใช่ยา (สุ่ม 10 รายการ)', '3.5.3', 'มีการระบุวันเปิด/วันหมดอายุของยา multiple dose และยา pre-pack', 30),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.5', 'ระบบควบคุมยาหมดอายุ', 'สุ่มดูวันหมดอายุและลักษณะภายนอกของยา/เวชภัณฑ์ที่มิใช่ยา (สุ่ม 10 รายการ)', '3.5.4', 'มีการจัดเรียงยาแบบ First Expired First Use', 31),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.6', 'ตู้เย็นเก็บยาตามมาตรฐาน', 'ตรวจสอบเทอร์โมมิเตอร์ในตู้เย็น · ใบบันทึกการวัดอุณหภูมิตู้เย็น', '3.6.1', 'มีการบันทึกอุณหภูมิสม่ำเสมอเป็นปัจจุบัน และอุณหภูมิอยู่ในช่วง 2-8°C', 32),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.6', 'ตู้เย็นเก็บยาตามมาตรฐาน', 'ตรวจสอบเทอร์โมมิเตอร์ในตู้เย็น · ใบบันทึกการวัดอุณหภูมิตู้เย็น', '3.6.2', 'การจัดเก็บยาในตู้เย็นเป็นระเบียบเรียบร้อย และเป็นไปตามหลักวิชาการ', 33),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.6', 'ตู้เย็นเก็บยาตามมาตรฐาน', 'ตรวจสอบเทอร์โมมิเตอร์ในตู้เย็น · ใบบันทึกการวัดอุณหภูมิตู้เย็น', '3.6.3', 'มีเทอร์โมมิเตอร์ที่ได้มาตรฐาน และมีผลการรับรองผ่านการสอบเทียบมาแล้วไม่เกิน 2 ปี', 34),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.6', 'ตู้เย็นเก็บยาตามมาตรฐาน', 'ตรวจสอบเทอร์โมมิเตอร์ในตู้เย็น · ใบบันทึกการวัดอุณหภูมิตู้เย็น', '3.6.4', 'ไม่เก็บยาและวัคซีนปะปนกัน', 35),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.6', 'ตู้เย็นเก็บยาตามมาตรฐาน', 'ตรวจสอบเทอร์โมมิเตอร์ในตู้เย็น · ใบบันทึกการวัดอุณหภูมิตู้เย็น', '3.6.5', 'ไม่มีอาหารและเครื่องดื่ม', 36),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.6', 'ตู้เย็นเก็บยาตามมาตรฐาน', 'ตรวจสอบเทอร์โมมิเตอร์ในตู้เย็น · ใบบันทึกการวัดอุณหภูมิตู้เย็น', '3.6.6', 'ฝาตู้เย็นมีขวดน้ำสีหรือเติมเกลือ หรือปิดโฟม เพื่อควบคุมอุณหภูมิ', 37),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.7', 'ตู้เย็นเก็บวัคซีนตามมาตรฐาน', 'ตรวจสอบจากเทอร์โมมิเตอร์ในตู้เย็น · ใบบันทึกการวัดอุณหภูมิตู้เย็นและช่องแช่แข็ง', '3.7.1', 'มีการบันทึกอุณหภูมิสม่ำเสมอเป็นปัจจุบัน อุณหภูมิตู้เย็นช่วง 2-8°C และช่องแช่แข็งระหว่าง -20°C ถึง -10°C', 38),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.7', 'ตู้เย็นเก็บวัคซีนตามมาตรฐาน', 'ตรวจสอบจากเทอร์โมมิเตอร์ในตู้เย็น · ใบบันทึกการวัดอุณหภูมิตู้เย็นและช่องแช่แข็ง', '3.7.2', 'การจัดเก็บวัคซีนเป็นระเบียบเรียบร้อย และเป็นไปตามหลักวิชาการ', 39),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.7', 'ตู้เย็นเก็บวัคซีนตามมาตรฐาน', 'ตรวจสอบจากเทอร์โมมิเตอร์ในตู้เย็น · ใบบันทึกการวัดอุณหภูมิตู้เย็นและช่องแช่แข็ง', '3.7.3', 'มีเทอร์โมมิเตอร์ที่ได้มาตรฐาน และมีผลการรับรองผ่านการสอบเทียบมาแล้วไม่เกิน 2 ปี', 40),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.7', 'ตู้เย็นเก็บวัคซีนตามมาตรฐาน', 'ตรวจสอบจากเทอร์โมมิเตอร์ในตู้เย็น · ใบบันทึกการวัดอุณหภูมิตู้เย็นและช่องแช่แข็ง', '3.7.4', 'ไม่เก็บยาและวัคซีนปะปนกัน', 41),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.7', 'ตู้เย็นเก็บวัคซีนตามมาตรฐาน', 'ตรวจสอบจากเทอร์โมมิเตอร์ในตู้เย็น · ใบบันทึกการวัดอุณหภูมิตู้เย็นและช่องแช่แข็ง', '3.7.5', 'ไม่มีอาหารและเครื่องดื่ม', 42),
  (2569, 3, '3. คลังยาและเวชภัณฑ์ หรือ ตู้เก็บยา', '3.7', 'ตู้เย็นเก็บวัคซีนตามมาตรฐาน', 'ตรวจสอบจากเทอร์โมมิเตอร์ในตู้เย็น · ใบบันทึกการวัดอุณหภูมิตู้เย็นและช่องแช่แข็ง', '3.7.6', 'ฝาตู้เย็นมีขวดน้ำสีหรือเติมเกลือ หรือปิดโฟม เพื่อควบคุมอุณหภูมิ', 43),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.1', 'การส่งมอบยาให้ผู้ป่วยถูกต้องเหมาะสม', 'ซองยา/ฉลากยา · สาธิตการจ่ายยา · แนวทางปฏิบัติตามมาตรฐาน 5R', '4.1.1', 'มีการส่งมอบยาที่ถูกต้องตามมาตรฐาน ทั้งที่สถานบริการ และที่บ้าน', 44),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.1', 'การส่งมอบยาให้ผู้ป่วยถูกต้องเหมาะสม', 'ซองยา/ฉลากยา · สาธิตการจ่ายยา · แนวทางปฏิบัติตามมาตรฐาน 5R', '4.1.2', 'ซองยาที่ส่งมอบมีข้อมูลครบถ้วน (ชื่อสถานบริการ ชื่อ-สกุลผู้ป่วย ชื่อยาแบบ generic name รูปแบบ/ความแรงยา ข้อบ่งใช้ วิธีใช้ ข้อควรระวัง วันหมดอายุ)', 45),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.2', 'การเฝ้าระวังความคลาดเคลื่อนทางยา', 'แบบบันทึก/รายงานอุบัติการณ์ความคลาดเคลื่อนทางยา · แนวทางป้องกันความคลาดเคลื่อนทางยา', '4.2.1', 'มีการบันทึกอุบัติการณ์ความคลาดเคลื่อนทางยา (Medication Error)', 46),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.2', 'การเฝ้าระวังความคลาดเคลื่อนทางยา', 'แบบบันทึก/รายงานอุบัติการณ์ความคลาดเคลื่อนทางยา · แนวทางป้องกันความคลาดเคลื่อนทางยา', '4.2.2', 'มีการนำอุบัติการณ์ความคลาดเคลื่อนทางยามาทบทวนวิเคราะห์หาสาเหตุ เพื่อหาแนวทางป้องกัน', 47),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.3', 'เครื่องมือ/แนวทางส่งเสริมการใช้ยาสมเหตุผล', 'ฉลากยาตามมาตรฐาน RDU · ฉลากช่วย เช่น วิธีหยอดตา/ยาเหน็บ/ผสมยาผงแห้งเด็ก · สื่อส่งเสริมการใช้ยา', '4.3.1', 'มีแนวทางปฏิบัติในการใช้ยาของหน่วยบริการปฐมภูมิ', 48),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.3', 'เครื่องมือ/แนวทางส่งเสริมการใช้ยาสมเหตุผล', 'ฉลากยาตามมาตรฐาน RDU · ฉลากช่วย เช่น วิธีหยอดตา/ยาเหน็บ/ผสมยาผงแห้งเด็ก · สื่อส่งเสริมการใช้ยา', '4.3.2', 'มีฉลากยาเสริมตามมาตรฐาน (ฉลากภาษาไทย และฉลากแนะนำผลข้างเคียง)', 49),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.3', 'เครื่องมือ/แนวทางส่งเสริมการใช้ยาสมเหตุผล', 'ฉลากยาตามมาตรฐาน RDU · ฉลากช่วย เช่น วิธีหยอดตา/ยาเหน็บ/ผสมยาผงแห้งเด็ก · สื่อส่งเสริมการใช้ยา', '4.3.3', 'มีฉลากช่วยแนะนำการใช้ยา เช่น ยาเทคนิคพิเศษ', 50),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.3', 'เครื่องมือ/แนวทางส่งเสริมการใช้ยาสมเหตุผล', 'ฉลากยาตามมาตรฐาน RDU · ฉลากช่วย เช่น วิธีหยอดตา/ยาเหน็บ/ผสมยาผงแห้งเด็ก · สื่อส่งเสริมการใช้ยา', '4.3.4', 'มีสื่อส่งเสริมการใช้ยาที่สมเหตุผลและปลอดภัย', 51),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.4', 'การส่งเสริมการใช้ยาอย่างสมเหตุผล', 'เอกสารแนวทางการใช้ยาปฏิชีวนะ (URI/AD/แผลสด) · คู่มือ/สื่อการสอนบุคลากร · ข้อมูลร้อยละจากโปรแกรม HDC/43 แฟ้ม', '4.4.1', 'มีแนวทางการใช้ยาปฏิชีวนะในโรคติดเชื้อทางเดินหายใจส่วนบน (URI)', 52),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.4', 'การส่งเสริมการใช้ยาอย่างสมเหตุผล', 'เอกสารแนวทางการใช้ยาปฏิชีวนะ (URI/AD/แผลสด) · คู่มือ/สื่อการสอนบุคลากร · ข้อมูลร้อยละจากโปรแกรม HDC/43 แฟ้ม', '4.4.2', 'มีแนวทางการใช้ยาปฏิชีวนะในโรคท้องร่วงเฉียบพลัน (AD)', 53),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.4', 'การส่งเสริมการใช้ยาอย่างสมเหตุผล', 'เอกสารแนวทางการใช้ยาปฏิชีวนะ (URI/AD/แผลสด) · คู่มือ/สื่อการสอนบุคลากร · ข้อมูลร้อยละจากโปรแกรม HDC/43 แฟ้ม', '4.4.3', 'มีแนวทางการใช้ยาปฏิชีวนะในบาดแผลสดจากอุบัติเหตุ (FTW)', 54),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.4', 'การส่งเสริมการใช้ยาอย่างสมเหตุผล', 'เอกสารแนวทางการใช้ยาปฏิชีวนะ (URI/AD/แผลสด) · คู่มือ/สื่อการสอนบุคลากร · ข้อมูลร้อยละจากโปรแกรม HDC/43 แฟ้ม', '4.4.4', 'ร้อยละการใช้ยาปฏิชีวนะในโรคติดเชื้อทางเดินหายใจส่วนบน ไม่เกินร้อยละ 20', 55),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.4', 'การส่งเสริมการใช้ยาอย่างสมเหตุผล', 'เอกสารแนวทางการใช้ยาปฏิชีวนะ (URI/AD/แผลสด) · คู่มือ/สื่อการสอนบุคลากร · ข้อมูลร้อยละจากโปรแกรม HDC/43 แฟ้ม', '4.4.5', 'ร้อยละการใช้ยาปฏิชีวนะในโรคท้องร่วงเฉียบพลัน ไม่เกินร้อยละ 20', 56),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.4', 'การส่งเสริมการใช้ยาอย่างสมเหตุผล', 'เอกสารแนวทางการใช้ยาปฏิชีวนะ (URI/AD/แผลสด) · คู่มือ/สื่อการสอนบุคลากร · ข้อมูลร้อยละจากโปรแกรม HDC/43 แฟ้ม', '4.4.6', 'มีแนวทางการใช้ยาในกลุ่มโรค NCD', 57),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.4', 'การส่งเสริมการใช้ยาอย่างสมเหตุผล', 'เอกสารแนวทางการใช้ยาปฏิชีวนะ (URI/AD/แผลสด) · คู่มือ/สื่อการสอนบุคลากร · ข้อมูลร้อยละจากโปรแกรม HDC/43 แฟ้ม', '4.4.7', 'มีแนวทางการเฝ้าระวังการใช้ยาในหญิงตั้งครรภ์/หญิงให้นมบุตร', 58),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.4', 'การส่งเสริมการใช้ยาอย่างสมเหตุผล', 'เอกสารแนวทางการใช้ยาปฏิชีวนะ (URI/AD/แผลสด) · คู่มือ/สื่อการสอนบุคลากร · ข้อมูลร้อยละจากโปรแกรม HDC/43 แฟ้ม', '4.4.8', 'มีแนวทางการเฝ้าระวังการใช้ยาในผู้ป่วยไตเรื้อรัง ระดับ 3 ขึ้นไป', 59),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.4', 'การส่งเสริมการใช้ยาอย่างสมเหตุผล', 'เอกสารแนวทางการใช้ยาปฏิชีวนะ (URI/AD/แผลสด) · คู่มือ/สื่อการสอนบุคลากร · ข้อมูลร้อยละจากโปรแกรม HDC/43 แฟ้ม', '4.4.9', 'มีแนวทางการใช้ยากลุ่ม NSAIDs อย่างปลอดภัยและสมเหตุผล', 60),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.4', 'การส่งเสริมการใช้ยาอย่างสมเหตุผล', 'เอกสารแนวทางการใช้ยาปฏิชีวนะ (URI/AD/แผลสด) · คู่มือ/สื่อการสอนบุคลากร · ข้อมูลร้อยละจากโปรแกรม HDC/43 แฟ้ม', '4.4.10', 'มีแนวทางการสั่งใช้ยา metformin เพื่อป้องกันภาวะ MALA', 61),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.5', 'การติดตามใช้ยาผู้ป่วยโรคเรื้อรังที่บ้าน', 'บันทึกข้อมูลเยี่ยมบ้านใน Family folder หรือวิธีอื่นใด (ต้องมีเภสัชกรร่วมทีม หรือ Tele pharmacy)', '4.5.1', 'มีการกำหนดกลุ่มเป้าหมายในการติดตามการใช้ยาและผลิตภัณฑ์สุขภาพของผู้ป่วยโรคเรื้อรัง', 62),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.5', 'การติดตามใช้ยาผู้ป่วยโรคเรื้อรังที่บ้าน', 'บันทึกข้อมูลเยี่ยมบ้านใน Family folder หรือวิธีอื่นใด (ต้องมีเภสัชกรร่วมทีม หรือ Tele pharmacy)', '4.5.2', 'มีการติดตามเยี่ยม/ให้คำปรึกษาทางโทรศัพท์หรือไลน์ และแนะนำการใช้ยาต่อเนื่องที่บ้าน โดยเภสัชกร', 63),
  (2569, 4, '4. การใช้ยาอย่างปลอดภัยและมีความสมเหตุผล', '4.5', 'การติดตามใช้ยาผู้ป่วยโรคเรื้อรังที่บ้าน', 'บันทึกข้อมูลเยี่ยมบ้านใน Family folder หรือวิธีอื่นใด (ต้องมีเภสัชกรร่วมทีม หรือ Tele pharmacy)', '4.5.3', 'มีการบันทึกข้อมูลการเยี่ยมบ้านผู้ป่วยใน Family folder หรือวิธีการอื่นใด', 64);

select public.start_fiscal_year(2570);

insert into public.dose_drugs (name, indication, mg_per_kg_min, mg_per_kg_max, per, max_mg_per_dose, dose_freq_per_day, freq, renal_note, concs, sort) values
  ('พาราเซตามอล (Paracetamol)', 'ลดไข้ บรรเทาอาการปวด', 10, 15, 'dose', 1000, null, 'ทุก 4–6 ชั่วโมง เมื่อมีไข้/ปวด (ไม่เกิน 4 ครั้ง/วัน)', 'ไม่จำเป็นต้องปรับขนาดยาในผู้ป่วยไตเสื่อมทั่วไป · หาก CrCl < 10 มล./นาที ควรยืดช่วงเวลาให้ยาเป็นทุก 8 ชั่วโมง', '[{"label":"ยาน้ำ 120 มก./5 มล.","mgPer5ml":120},{"label":"ยาน้ำ 250 มก./5 มล.","mgPer5ml":250},{"label":"เม็ด 500 มก.","mgPerTab":500}]'::jsonb, 1),
  ('อะม็อกซีซิลลิน (Amoxicillin)', 'การติดเชื้อแบคทีเรียทั่วไป เช่น หูชั้นกลางอักเสบ ไซนัสอักเสบ ทอนซิลอักเสบ', 25, 50, 'day', null, 3, 'แบ่งให้วันละ 3 มื้อ', 'CrCl 10–30 มล./นาที: ให้ทุก 12 ชั่วโมง · CrCl < 10 มล./นาที: ให้ทุก 24 ชั่วโมง', '[{"label":"ยาน้ำ 125 มก./5 มล.","mgPer5ml":125},{"label":"ยาน้ำ 250 มก./5 มล.","mgPer5ml":250},{"label":"แคปซูล 500 มก.","mgPerTab":500}]'::jsonb, 2),
  ('ไอบูโพรเฟน (Ibuprofen)', 'ลดไข้ บรรเทาอาการปวดและอักเสบ', 5, 10, 'dose', 400, null, 'ทุก 6–8 ชั่วโมง', 'หลีกเลี่ยงหรือใช้ด้วยความระมัดระวังใน CrCl < 30 มล./นาที เนื่องจากอาจทำให้การทำงานของไตแย่ลง', '[{"label":"ยาน้ำ 100 มก./5 มล.","mgPer5ml":100},{"label":"เม็ด 200 มก.","mgPerTab":200}]'::jsonb, 3),
  ('ยาน้ำแก้ไอ CPM (Chlorpheniramine)', 'บรรเทาอาการแพ้ น้ำมูกไหล คัดจมูก', 0.35, 0.35, 'day', null, 3, 'แบ่งให้วันละ 3 มื้อ', 'ผู้ป่วยไตเสื่อมรุนแรงควรพิจารณาลดขนาดยาหรือยืดช่วงเวลาให้ยา', '[{"label":"ยาน้ำ 2 มก./5 มล.","mgPer5ml":2}]'::jsonb, 4),
  ('ออร์ซาลิต/ORS (ผงเกลือแร่)', 'ทดแทนน้ำและเกลือแร่จากอาการท้องเสีย/ภาวะขาดน้ำ', 50, 100, 'day', null, 1, 'มล. ต่อวัน ทดแทนน้ำที่เสียไป (คำนวณเป็น มล./กก./วัน ไม่ใช่ มก.)', 'ผู้ป่วยไตวายควรระมัดระวังภาวะน้ำเกิน ปรับปริมาณตามดุลยพินิจแพทย์', '[{"label":"ORS ชง 1 ซอง/200 มล. (ประมาณ)","mgPer5ml":null}]'::jsonb, 5);
-- =====================================================================
--  ขั้นที่ 1.3: เปิดสิทธิ์ให้หน้าเว็บเรียกตารางได้ (Data API grants)
--  Supabase โปรเจกต์ใหม่ไม่เปิดสิทธิ์ตารางให้อัตโนมัติแล้ว จึงต้องรันไฟล์นี้
--  ความปลอดภัยรายแถวยังคุมด้วย RLS เหมือนเดิม — รันซ้ำได้ ไม่เสียหาย
-- =====================================================================

grant usage on schema public to anon, authenticated, service_role;

-- ระบบหลังบ้าน (Edge Functions / สำรองข้อมูล) ใช้ได้ทุกตาราง
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- ผู้ที่ login แล้ว: อ่าน/เขียนได้ แต่ถูกกรองด้วย RLS ทุกแถว
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ข้อจำกัดเพิ่มเติม (ชั้นป้องกันนอกจาก RLS)
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name, phone, address, home_unit_id) on public.profiles to authenticated;
revoke update on public.conversations from authenticated;
revoke update on public.messages, public.feedback from authenticated;
revoke insert, update, delete on public.audit_log from authenticated;
revoke insert, update, delete on public.site_stats from authenticated;

-- ผู้ที่ยังไม่ login: อ่านได้เฉพาะข้อมูลสาธารณะ
grant select on public.units, public.news, public.news_comments, public.news_likes, public.site_stats,
               public.achievements, public.criteria_years, public.criteria_items, public.dose_drugs
  to anon;

-- ฟังก์ชันตรวจสิทธิ์ที่กฎ RLS เรียกใช้
grant execute on function public.fiscal_year_of(date), public.my_role(), public.my_unit(), public.is_admin(),
                          public.is_staff_of(smallint), public.is_staff_or_admin(),
                          public.can_access_conversation(uuid)
  to anon, authenticated;

-- ฟังก์ชันที่หน้าเว็บเรียก
grant execute on function public.bump_home_views(), public.bump_news_view(uuid),
                          public.public_unit_scores(int), public.public_tracking_stats(int, smallint)
  to anon, authenticated;
grant execute on function public.start_fiscal_year(int), public.mark_conversation_read(uuid) to authenticated;

-- ตรวจผล: ควรเห็น authenticated มีสิทธิ์ SELECT บน profiles = true
select has_table_privilege('authenticated', 'public.profiles', 'SELECT') as authenticated_can_read_profiles,
       has_table_privilege('anon', 'public.patients', 'SELECT')          as anon_can_read_patients_should_be_false;
