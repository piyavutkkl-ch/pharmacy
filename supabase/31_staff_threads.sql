-- =====================================================================
--  ขั้นที่ 30: แชท ผู้ดูแล ⇄ เจ้าหน้าที่ รพ.สต. แยกห้องรายคน — รันต่อจาก 30 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   เดิม 1 รพ.สต. = 1 ห้อง (ทุกคนในหน่วยเห็นกัน) → ใหม่ 1 เจ้าหน้าที่ = 1 ห้องกับผู้ดูแล (เห็นเฉพาะเจ้าตัว + ผู้ดูแล)
--   unit_messages.staff_id = เจ้าหน้าที่ที่ห้องนั้นคุยด้วย · null = ข้อความเดิมถึงทุกคนใน รพ.สต. (ก่อนแยกห้อง · ทุกคนในหน่วยยังเห็น)
--   staff_threads = ตัวนับยังไม่อ่านแยกฝั่งรายคน (trigger) · ล้างด้วย mark_staff_thread_read
--   หน้าเว็บรุ่นเก่า (ส่งโดยไม่ระบุ staff_id) ยังใช้ได้ระหว่าง deploy: ผู้ดูแลส่งถึงทุกคนในหน่วย · เจ้าหน้าที่ระบบเติม staff_id ให้เอง
-- =====================================================================

alter table public.unit_messages add column if not exists staff_id uuid references public.profiles(id) on delete cascade;
create index if not exists unit_messages_staff_idx on public.unit_messages (staff_id, created_at);
-- ข้อความเดิมที่เจ้าหน้าที่ส่ง → เป็นของห้องคนนั้น (ข้อความเดิมจากผู้ดูแลยังถึงทุกคนในหน่วย)
update public.unit_messages set staff_id = sender_id
 where staff_id is null and sender_role = 'staff' and sender_id is not null;

create table if not exists public.staff_threads (
  staff_id              uuid primary key references public.profiles(id) on delete cascade,
  unit_id               smallint not null references public.units(id),
  last_message_at       timestamptz,
  last_message_preview  text,
  unread_staff          int not null default 0,   -- ข้อความจากผู้ดูแลที่เจ้าหน้าที่คนนี้ยังไม่อ่าน
  unread_admin          int not null default 0    -- ข้อความจากเจ้าหน้าที่คนนี้ที่ผู้ดูแลยังไม่อ่าน
);
insert into public.staff_threads (staff_id, unit_id, last_message_at, last_message_preview)
select distinct on (m.staff_id) m.staff_id, m.unit_id, m.created_at, left(m.body, 120)
  from public.unit_messages m where m.staff_id is not null
 order by m.staff_id, m.created_at desc
on conflict (staff_id) do nothing;

create or replace function public.before_unit_message()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare recent int; u smallint;
begin
  new.sender_id := auth.uid();
  new.sender_role := case when public.is_admin() then 'admin' else 'staff' end;
  select coalesce(p.full_name, 'ผู้ใช้') into new.sender_name from public.profiles p where p.id = auth.uid();
  new.created_at := now();
  if new.sender_role = 'staff' then
    new.staff_id := auth.uid();                                  -- เจ้าหน้าที่ส่งได้เฉพาะห้องของตัวเอง
  elsif new.staff_id is not null then                           -- ผู้ดูแลส่งถึงเจ้าหน้าที่คนนั้น (หน่วยตามบัญชีของเขา)
    select p.unit_id into u from public.profiles p where p.id = new.staff_id and p.role = 'staff';
    if u is null then raise exception 'ไม่พบเจ้าหน้าที่คนนี้'; end if;
    new.unit_id := u;
  end if;
  select count(*) into recent from public.unit_messages m
   where m.sender_id = auth.uid() and m.created_at > now() - interval '1 minute';
  if recent >= 10 then raise exception 'ส่งข้อความถี่เกินไป กรุณารอสักครู่'; end if;
  return new;
end $$;

create or replace function public.after_unit_message()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.unit_chats as c (unit_id, last_message_at, last_message_preview, unread_unit, unread_admin)
  values (new.unit_id, new.created_at, left(new.body, 120),
          case when new.sender_role = 'admin' then 1 else 0 end, case when new.sender_role = 'staff' then 1 else 0 end)
  on conflict (unit_id) do update
     set last_message_at = excluded.last_message_at,
         last_message_preview = excluded.last_message_preview,
         unread_unit  = c.unread_unit  + excluded.unread_unit,
         unread_admin = c.unread_admin + excluded.unread_admin;
  if new.staff_id is not null then
    insert into public.staff_threads as t (staff_id, unit_id, last_message_at, last_message_preview, unread_staff, unread_admin)
    values (new.staff_id, new.unit_id, new.created_at, left(new.body, 120),
            case when new.sender_role = 'admin' then 1 else 0 end, case when new.sender_role = 'staff' then 1 else 0 end)
    on conflict (staff_id) do update
       set unit_id = excluded.unit_id,
           last_message_at = excluded.last_message_at,
           last_message_preview = excluded.last_message_preview,
           unread_staff = t.unread_staff + excluded.unread_staff,
           unread_admin = t.unread_admin + excluded.unread_admin;
  end if;
  return null;
end $$;
revoke execute on function public.before_unit_message(), public.after_unit_message() from public, anon, authenticated;

create or replace function public.mark_staff_thread_read(p_staff uuid)
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  if public.is_admin() then
    update public.staff_threads set unread_admin = 0 where staff_id = p_staff and unread_admin > 0;
  elsif p_staff = auth.uid() and public.my_role() = 'staff' then
    update public.staff_threads set unread_staff = 0 where staff_id = p_staff and unread_staff > 0;
  else
    raise exception 'ไม่มีสิทธิ์';
  end if;
end $$;
revoke execute on function public.mark_staff_thread_read(uuid) from public, anon;
grant execute on function public.mark_staff_thread_read(uuid) to authenticated;

-- เจ้าหน้าที่เห็นเฉพาะห้องของตัวเอง (+ ข้อความเดิมถึงทุกคนในหน่วย) · ผู้ดูแลเห็นทั้งหมด
drop policy if exists umsg_read on public.unit_messages;
create policy umsg_read on public.unit_messages for select to authenticated
  using (public.is_admin() or (public.is_staff_of(unit_id) and (staff_id is null or staff_id = auth.uid())));
grant insert (unit_id, body, staff_id) on public.unit_messages to authenticated;

alter table public.staff_threads enable row level security;
drop policy if exists sthread_read on public.staff_threads;
create policy sthread_read on public.staff_threads for select to authenticated
  using (public.is_admin() or staff_id = auth.uid());
revoke all on public.staff_threads from anon, authenticated;
grant select on public.staff_threads to authenticated;
grant all on public.staff_threads to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'staff_threads') then
    alter publication supabase_realtime add table public.staff_threads;
  end if;
end $$;

select 'ok' as step_30_staff_threads;
