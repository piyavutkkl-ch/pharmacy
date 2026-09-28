-- =====================================================================
--  ขั้นที่ 20: ขอสิทธิ์เจ้าหน้าที่ รพ.สต. ผ่านเว็บ — รันต่อจาก 20 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   ประชาชนที่ login ด้วย Google แล้ว ส่งคำขอ (ชื่อ, รพ.สต., ตำแหน่ง, เบอร์) → ผู้ดูแลอนุมัติ = เพิ่มใน staff_roster ให้เอง
--   อีเมลในคำขอระบบเติมจากบัญชีที่ login (ปลอมไม่ได้) · มีคำขอรออนุมัติได้คนละ 1 รายการ
-- =====================================================================

create table if not exists public.staff_requests (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  email        text not null,
  full_name    text not null check (char_length(btrim(full_name)) between 1 and 120),
  unit_id      smallint not null references public.units(id),
  position     text check (position is null or char_length(position) <= 120),
  phone        text check (phone is null or phone ~ '^[0-9][0-9 -]{7,14}$'),
  note         text check (note is null or char_length(note) <= 500),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note  text check (review_note is null or char_length(review_note) <= 500),
  reviewed_by  uuid references public.profiles(id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create unique index if not exists staff_requests_one_pending on public.staff_requests (user_id) where status = 'pending';

-- ไม่ใช้ security definer: ต้องรู้ว่าผู้เรียกเป็นหน้าเว็บ (current_user) · อ่านอีเมลของตัวเองได้ตาม RLS ของ profiles
create or replace function public.fill_staff_request()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.user_id := auth.uid();
    select lower(p.email) into new.email from public.profiles p where p.id = auth.uid();
    new.status := 'pending'; new.review_note := null; new.reviewed_by := null; new.reviewed_at := null; new.created_at := now();
  end if;
  return new;
end $$;
drop trigger if exists staff_requests_fill on public.staff_requests;
create trigger staff_requests_fill before insert on public.staff_requests
  for each row execute function public.fill_staff_request();
revoke execute on function public.fill_staff_request() from public, anon, authenticated;

alter table public.staff_requests enable row level security;
drop policy if exists sreq_read on public.staff_requests;
drop policy if exists sreq_insert on public.staff_requests;
drop policy if exists sreq_delete on public.staff_requests;
create policy sreq_read on public.staff_requests for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy sreq_insert on public.staff_requests for insert to authenticated
  with check (user_id = auth.uid() and public.my_role() = 'citizen');
create policy sreq_delete on public.staff_requests for delete to authenticated
  using ((user_id = auth.uid() and status = 'pending') or public.is_admin());
revoke all on public.staff_requests from anon, authenticated;
grant select, delete on public.staff_requests to authenticated;
grant insert (full_name, unit_id, position, phone, note) on public.staff_requests to authenticated;
grant all on public.staff_requests to service_role;

-- ผู้ดูแลอนุมัติ: เพิ่ม/เปิดใช้บัญชีใน staff_roster (trigger เดิมเปลี่ยนสิทธิ์ใน profiles ให้เอง)
create or replace function public.approve_staff_request(p_id bigint, p_unit smallint default null)
returns void language plpgsql security definer
set search_path = ''
as $$
declare r public.staff_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์' using errcode = '42501'; end if;
  select * into r from public.staff_requests where id = p_id;
  if not found or r.status <> 'pending' then raise exception 'ไม่พบคำขอที่รออนุมัติ'; end if;
  if exists (select 1 from public.staff_roster s where s.email = r.email and s.role = 'admin') then
    raise exception 'อีเมลนี้เป็นผู้ดูแลอยู่แล้ว';
  end if;
  insert into public.staff_roster (email, full_name, role, unit_id, phone, active)
  values (r.email, r.full_name, 'staff', coalesce(p_unit, r.unit_id), r.phone, true)
  on conflict (email) do update set full_name = excluded.full_name, role = 'staff', unit_id = excluded.unit_id,
                                    phone = coalesce(excluded.phone, public.staff_roster.phone), active = true;
  update public.staff_requests set status = 'approved', unit_id = coalesce(p_unit, r.unit_id),
         reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
end $$;

create or replace function public.reject_staff_request(p_id bigint, p_note text default null)
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์' using errcode = '42501'; end if;
  update public.staff_requests set status = 'rejected', review_note = nullif(btrim(coalesce(p_note, '')), ''),
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id and status = 'pending';
  if not found then raise exception 'ไม่พบคำขอที่รออนุมัติ'; end if;
end $$;
revoke execute on function public.approve_staff_request(bigint, smallint), public.reject_staff_request(bigint, text) from public, anon;
grant execute on function public.approve_staff_request(bigint, smallint), public.reject_staff_request(bigint, text) to authenticated;

select 'ok' as step_20_staff_requests;
