-- =====================================================================
--  ขั้นที่ 41: สรุปผลงานเยี่ยมบ้าน — นับผู้ลงเยี่ยมตามตำแหน่ง + จำนวนผู้ป่วยที่เยี่ยม — รันต่อจาก 41 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   staff_roster.position = ตำแหน่ง (ผู้ดูแลกรอกในบัญชีเจ้าหน้าที่ เช่น เภสัชกร, พยาบาลวิชาชีพ)
--   visit_summaries.participant_positions = ตำแหน่งของผู้ร่วมลงในระบบ (เรียงตาม participant_names · trigger เติมจากบัญชีเจ้าหน้าที่)
--     ผู้ร่วมลงที่กรอกเอง "ชื่อ นามสกุล (ตำแหน่ง)" → หน้าเว็บอ่านตำแหน่งจากวงเล็บ
--   summary_patient_count(id) = จำนวนผู้ป่วยที่เยี่ยม (นับจากรายการเยี่ยมที่เชื่อมโยง) — ตัวเลขสรุปอย่างเดียว ทุกคนอ่านได้
-- =====================================================================

alter table public.staff_roster add column if not exists position text;
alter table public.staff_roster drop constraint if exists staff_roster_position_check;
alter table public.staff_roster add constraint staff_roster_position_check check (position is null or char_length(position) <= 60);
alter table public.visit_summaries add column if not exists participant_positions text[] not null default '{}';

drop function if exists public.staff_directory();
create function public.staff_directory()
returns table (id uuid, full_name text, role text, unit_id smallint, joined boolean, "position" text)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if coalesce(public.my_role(), '') not in ('staff', 'admin') then raise exception 'ไม่มีสิทธิ์'; end if;
  return query
  select d.id, d.full_name, d.role, d.unit_id, d.joined, d.pos from (
    select p.id, coalesce(nullif(btrim(r.full_name), ''), nullif(btrim(p.full_name), ''), 'เจ้าหน้าที่') as full_name, p.role, p.unit_id, true as joined,
           nullif(btrim(r.position), '') as pos
      from public.profiles p left join public.staff_roster r on r.email = lower(p.email)
     where p.role in ('staff', 'admin')
    union all
    select null::uuid, btrim(r.full_name), r.role, r.unit_id, false, nullif(btrim(r.position), '')
      from public.staff_roster r
     where r.active and not exists (select 1 from public.profiles p where lower(p.email) = r.email)
  ) d
  order by (d.role <> 'admin'), d.unit_id nulls first, d.full_name;
end $$;
revoke execute on function public.staff_directory() from public, anon;
grant execute on function public.staff_directory() to authenticated;

create or replace function public.before_summary_people()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  select coalesce(array_agg(p.id order by x.n), '{}'),
         coalesce(array_agg(coalesce(nullif(btrim(r.full_name), ''), nullif(btrim(p.full_name), ''), 'เจ้าหน้าที่') order by x.n), '{}'),
         coalesce(array_agg(coalesce(nullif(btrim(r.position), ''), '') order by x.n), '{}')
    into new.participant_ids, new.participant_names, new.participant_positions
    from (select distinct on (u) u, n from unnest(new.participant_ids) with ordinality as t(u, n) order by u, n) x
    join public.profiles p on p.id = x.u and p.role in ('staff', 'admin')
    left join public.staff_roster r on r.email = lower(p.email);
  select coalesce(array_agg(left(v, 150) order by n), '{}') into new.participant_others
    from (select btrim(regexp_replace(o, '\s+', ' ', 'g')) v, n from unnest(new.participant_others) with ordinality as t(o, n)) y
   where v <> '';
  return new;
end $$;
revoke execute on function public.before_summary_people() from public, anon, authenticated;
update public.visit_summaries set participant_ids = participant_ids;   -- เติมตำแหน่งให้สรุปที่มีอยู่แล้ว (trigger)

/** จำนวนผู้ป่วยที่เยี่ยมในสรุปผลงาน (ตัวเลขอย่างเดียว · ไม่มีชื่อ) */
create or replace function public.summary_patient_count(p_summary bigint)
returns int language sql stable security definer
set search_path = ''
as $$
  select count(distinct v.patient_id)::int
    from public.summary_visits sv join public.visits v on v.id = sv.visit_id
   where sv.summary_id = p_summary
$$;
revoke execute on function public.summary_patient_count(bigint) from public;
grant execute on function public.summary_patient_count(bigint) to anon, authenticated;

select 'ok' as step_41_summary_counts;
