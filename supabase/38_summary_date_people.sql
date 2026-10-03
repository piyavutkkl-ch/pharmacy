-- =====================================================================
--  ขั้นที่ 37: สรุปผลงานเยี่ยมบ้าน — วันที่ + เจ้าหน้าที่ที่ร่วมลง — รันต่อจาก 37 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   summary_date = วันที่ของผลงาน (เดิม = วันที่บันทึก) · แสดงในรายการ/หน้าอ่าน/กรอบโปสเตอร์หน้าหลัก
--   participant_ids = เลือกจากรายชื่อผู้ดูแล + เจ้าหน้าที่ในระบบ (staff_directory) · participant_names เติมโดย trigger จาก profiles
--   (id ที่ไม่ใช่ผู้ดูแล/เจ้าหน้าที่ถูกตัดทิ้ง) → หน้าสาธารณะแสดงชื่อได้โดยไม่ต้องเปิดตาราง profiles
--   participant_others = ผู้ร่วมลงที่ไม่มีบัญชีในระบบ กรอกเอง "ชื่อ นามสกุล (ตำแหน่ง)" (≤ 20 คน · คนละ ≤ 150 ตัวอักษร)
-- =====================================================================

alter table public.visit_summaries add column if not exists summary_date date;
update public.visit_summaries set summary_date = (created_at at time zone 'Asia/Bangkok')::date where summary_date is null;
alter table public.visit_summaries alter column summary_date set default ((now() at time zone 'Asia/Bangkok')::date);
alter table public.visit_summaries alter column summary_date set not null;

alter table public.visit_summaries add column if not exists participant_ids uuid[] not null default '{}';
alter table public.visit_summaries add column if not exists participant_names text[] not null default '{}';
alter table public.visit_summaries add column if not exists participant_others text[] not null default '{}';
alter table public.visit_summaries drop constraint if exists visit_summaries_participants_check;
alter table public.visit_summaries add constraint visit_summaries_participants_check check (cardinality(participant_ids) <= 30 and cardinality(participant_others) <= 20);

create or replace function public.before_summary_people()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  select coalesce(array_agg(p.id order by x.n), '{}'), coalesce(array_agg(coalesce(nullif(btrim(p.full_name), ''), 'เจ้าหน้าที่') order by x.n), '{}')
    into new.participant_ids, new.participant_names
    from (select distinct on (u) u, n from unnest(new.participant_ids) with ordinality as t(u, n) order by u, n) x
    join public.profiles p on p.id = x.u and p.role in ('staff', 'admin');
  select coalesce(array_agg(left(v, 150) order by n), '{}') into new.participant_others
    from (select btrim(regexp_replace(o, '\s+', ' ', 'g')) v, n from unnest(new.participant_others) with ordinality as t(o, n)) y
   where v <> '';
  return new;
end $$;
revoke execute on function public.before_summary_people() from public, anon, authenticated;
drop trigger if exists visit_summaries_people on public.visit_summaries;
create trigger visit_summaries_people before insert or update on public.visit_summaries
  for each row execute function public.before_summary_people();

/** รายชื่อผู้ดูแล + เจ้าหน้าที่ (ให้เลือกผู้ร่วมลง) — เฉพาะผู้ดูแล/เจ้าหน้าที่เรียกได้ · ไม่มีอีเมล/เบอร์โทร */
create or replace function public.staff_directory()
returns table (id uuid, full_name text, role text, unit_id smallint)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if coalesce(public.my_role(), '') not in ('staff', 'admin') then raise exception 'ไม่มีสิทธิ์'; end if;
  return query select p.id, coalesce(nullif(btrim(p.full_name), ''), 'เจ้าหน้าที่'), p.role, p.unit_id
    from public.profiles p where p.role in ('staff', 'admin')
   order by (p.role <> 'admin'), p.unit_id nulls first, p.full_name;
end $$;
revoke execute on function public.staff_directory() from public, anon;
grant execute on function public.staff_directory() to authenticated;

select 'ok' as step_37_summary_date_people;
