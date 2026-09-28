-- =====================================================================
--  ขั้นที่ 24: แชท เจ้าหน้าที่ รพ.สต. ⇄ ผู้ดูแล (โรงพยาบาล) — รันต่อจาก 24 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   1 รพ.สต. = 1 ห้อง (unit_chats) · เห็น/ส่งได้เฉพาะเจ้าหน้าที่หน่วยนั้น + ผู้ดูแล · Realtime
--   ชื่อผู้ส่ง/บทบาท/เวลา ระบบเติมให้เอง (trigger) · ตัวเลขยังไม่อ่านแยกฝั่ง รพ.สต. / ผู้ดูแล ล้างด้วย mark_unit_chat_read
-- =====================================================================

create table if not exists public.unit_chats (
  unit_id               smallint primary key references public.units(id),
  last_message_at       timestamptz,
  last_message_preview  text,
  unread_unit           int not null default 0,   -- ข้อความจากผู้ดูแลที่ รพ.สต. ยังไม่อ่าน
  unread_admin          int not null default 0    -- ข้อความจาก รพ.สต. ที่ผู้ดูแลยังไม่อ่าน
);

create table if not exists public.unit_messages (
  id           bigint generated always as identity primary key,
  unit_id      smallint not null references public.units(id),
  sender_id    uuid default auth.uid() references public.profiles(id) on delete set null,
  sender_role  text not null default 'staff' check (sender_role in ('staff', 'admin')),
  sender_name  text,
  body         text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at   timestamptz not null default now()
);
create index if not exists unit_messages_unit_idx on public.unit_messages (unit_id, created_at);

-- เติมผู้ส่ง/เวลาเอง + กันส่งถี่ (security definer เพื่ออ่าน profiles และนับข้อความ)
create or replace function public.before_unit_message()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare recent int;
begin
  new.sender_id := auth.uid();
  new.sender_role := case when public.is_admin() then 'admin' else 'staff' end;
  select coalesce(p.full_name, 'ผู้ใช้') into new.sender_name from public.profiles p where p.id = auth.uid();
  new.created_at := now();
  select count(*) into recent from public.unit_messages m
   where m.sender_id = auth.uid() and m.created_at > now() - interval '1 minute';
  if recent >= 10 then raise exception 'ส่งข้อความถี่เกินไป กรุณารอสักครู่'; end if;
  return new;
end $$;
drop trigger if exists unit_messages_before on public.unit_messages;
create trigger unit_messages_before before insert on public.unit_messages
  for each row execute function public.before_unit_message();

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
  return null;
end $$;
drop trigger if exists unit_messages_after on public.unit_messages;
create trigger unit_messages_after after insert on public.unit_messages
  for each row execute function public.after_unit_message();

create or replace function public.mark_unit_chat_read(p_unit smallint)
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  if public.is_admin() then
    update public.unit_chats set unread_admin = 0 where unit_id = p_unit;
  elsif public.is_staff_of(p_unit) then
    update public.unit_chats set unread_unit = 0 where unit_id = p_unit;
  else
    raise exception 'ไม่มีสิทธิ์';
  end if;
end $$;
revoke execute on function public.mark_unit_chat_read(smallint) from public, anon;
grant execute on function public.mark_unit_chat_read(smallint) to authenticated;

alter table public.unit_chats enable row level security;
alter table public.unit_messages enable row level security;
drop policy if exists uchat_read on public.unit_chats;
drop policy if exists umsg_read on public.unit_messages;
drop policy if exists umsg_insert on public.unit_messages;
create policy uchat_read on public.unit_chats for select to authenticated
  using (public.is_admin() or public.is_staff_of(unit_id));
create policy umsg_read on public.unit_messages for select to authenticated
  using (public.is_admin() or public.is_staff_of(unit_id));
create policy umsg_insert on public.unit_messages for insert to authenticated
  with check (public.is_admin() or public.is_staff_of(unit_id));

-- หน้าเว็บส่งได้แค่ห้อง + ข้อความ · ห้องและตัวนับเปลี่ยนผ่าน trigger/ฟังก์ชันเท่านั้น · ห้ามแก้/ลบข้อความย้อนหลัง
revoke all on public.unit_chats, public.unit_messages from anon, authenticated;
grant select on public.unit_chats, public.unit_messages to authenticated;
grant insert (unit_id, body) on public.unit_messages to authenticated;
grant all on public.unit_chats, public.unit_messages to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'unit_messages') then
      alter publication supabase_realtime add table public.unit_messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'unit_chats') then
      alter publication supabase_realtime add table public.unit_chats;
    end if;
  end if;
end $$;

select 'ok' as step_24_unit_chat;
