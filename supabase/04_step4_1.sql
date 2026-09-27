-- =====================================================================
--  ขั้นที่ 4.1: ปรับฐานข้อมูลสำหรับหน้าเว็บจริง (รันต่อจาก 01–03 · รันซ้ำได้)
--   1) ตัวเลข DRPs หน้าแรก นับเป็น "จำนวนปัญหา" (ตรงกับต้นแบบ) ไม่ใช่จำนวนครั้งเยี่ยม
--   2) กันผู้ดูแลลบ/ปิด/ลดสิทธิ์บัญชีตัวเองผ่านหน้าเว็บ และต้องเหลือผู้ดูแลอย่างน้อย 1 คน
-- =====================================================================

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
    (select coalesce(sum(cardinality(drps)), 0) from v)::int,
    (select coalesce(sum(cardinality(drps)), 0) from v where drp_resolved)::int,
    (select count(distinct a.patient_id) from v a
       where a.med_excess
         and exists (select 1 from v b where b.patient_id = a.patient_id
                       and b.visit_date > a.visit_date and not b.med_excess))::int
$$;

-- หมายเหตุ: ต้องไม่เป็น security definer เพื่อให้ current_user บอกได้ว่าคำขอมาจากหน้าเว็บ
create or replace function public.guard_roster()
returns trigger language plpgsql
set search_path = ''
as $$
declare
  me text;
  admins_left int;
begin
  if current_user not in ('anon', 'authenticated') then
    return coalesce(new, old);          -- SQL Editor ทำได้ทุกอย่าง
  end if;
  select p.email into me from public.profiles p where p.id = auth.uid();

  if tg_op in ('UPDATE', 'DELETE') and old.email = me then
    if tg_op = 'DELETE' or new.role <> 'admin' or not new.active or new.email <> old.email then
      raise exception 'ไม่สามารถลบ ปิดใช้งาน หรือลดสิทธิ์บัญชีของตัวเองได้ — ให้ผู้ดูแลคนอื่นทำแทน';
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.role = 'admin' and old.active then
    select count(*) into admins_left from public.staff_roster s
     where s.role = 'admin' and s.active and s.email <> old.email;
    if admins_left = 0 and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active) then
      raise exception 'ต้องมีผู้ดูแลที่ใช้งานอยู่อย่างน้อย 1 คน';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  new.email := lower(btrim(new.email));
  return new;
end $$;

drop trigger if exists staff_roster_guard on public.staff_roster;
create trigger staff_roster_guard before insert or update or delete on public.staff_roster
  for each row execute function public.guard_roster();


select 'ok' as step_4_1;
