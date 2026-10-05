-- =====================================================================
--  ขั้นที่ 39: รายชื่อผู้ร่วมลง (staff_directory) รวมคนที่ผู้ดูแลเพิ่มในบัญชีเจ้าหน้าที่แล้วแต่ยังไม่เคยเข้าสู่ระบบ — รันต่อจาก 39 · รันซ้ำได้
--   เดิมดึงจาก profiles อย่างเดียว (มีหลังเข้าสู่ระบบครั้งแรก) → คนที่เพิ่งเพิ่มไม่ขึ้นให้เลือก
--   ชื่อที่แสดงใช้ชื่อในบัญชีเจ้าหน้าที่ (staff_roster ที่ผู้ดูแลตั้ง) ก่อนชื่อจากบัญชี Google
--   คนที่ยังไม่เคยเข้าระบบไม่มี id → หน้าเว็บเก็บเป็นชื่อใน participant_others · joined = false
--   ไม่มีอีเมล/เบอร์โทรในผลลัพธ์
-- =====================================================================

drop function if exists public.staff_directory();
create function public.staff_directory()
returns table (id uuid, full_name text, role text, unit_id smallint, joined boolean)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if coalesce(public.my_role(), '') not in ('staff', 'admin') then raise exception 'ไม่มีสิทธิ์'; end if;
  return query
  select d.id, d.full_name, d.role, d.unit_id, d.joined from (
    select p.id, coalesce(nullif(btrim(r.full_name), ''), nullif(btrim(p.full_name), ''), 'เจ้าหน้าที่') as full_name, p.role, p.unit_id, true as joined
      from public.profiles p left join public.staff_roster r on r.email = lower(p.email)
     where p.role in ('staff', 'admin')
    union all
    select null::uuid, btrim(r.full_name), r.role, r.unit_id, false
      from public.staff_roster r
     where r.active and not exists (select 1 from public.profiles p where lower(p.email) = r.email)
  ) d
  order by (d.role <> 'admin'), d.unit_id nulls first, d.full_name;
end $$;
revoke execute on function public.staff_directory() from public, anon;
grant execute on function public.staff_directory() to authenticated;

-- ชื่อผู้ร่วมลงที่เก็บในสรุป: ใช้ชื่อในบัญชีเจ้าหน้าที่ก่อน (ตรงกับรายการที่เลือก)
create or replace function public.before_summary_people()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  select coalesce(array_agg(p.id order by x.n), '{}'),
         coalesce(array_agg(coalesce(nullif(btrim(r.full_name), ''), nullif(btrim(p.full_name), ''), 'เจ้าหน้าที่') order by x.n), '{}')
    into new.participant_ids, new.participant_names
    from (select distinct on (u) u, n from unnest(new.participant_ids) with ordinality as t(u, n) order by u, n) x
    join public.profiles p on p.id = x.u and p.role in ('staff', 'admin')
    left join public.staff_roster r on r.email = lower(p.email);
  select coalesce(array_agg(left(v, 150) order by n), '{}') into new.participant_others
    from (select btrim(regexp_replace(o, '\s+', ' ', 'g')) v, n from unnest(new.participant_others) with ordinality as t(o, n)) y
   where v <> '';
  return new;
end $$;
revoke execute on function public.before_summary_people() from public, anon, authenticated;

select 'ok' as step_39_staff_directory_roster;
