-- =====================================================================
--  ขั้นที่ 103: สรุปผลงานเยี่ยมบ้าน — กรอกจำนวนผู้ป่วยที่เยี่ยมเองได้ (ถ้าไม่กรอก นับจากรายชื่อที่ติ๊กลงเยี่ยม)
--   visit_summaries.patient_count = จำนวนผู้ป่วยที่เยี่ยมที่กรอกเอง (null = นับจากรายการเยี่ยมที่เชื่อมโยง summary_visits)
--   summary_patient_count(p_summary) = คืน patient_count ที่กรอกเอง (> 0) หรือนับ distinct patient_id จาก summary_visits
-- =====================================================================

alter table public.visit_summaries add column if not exists patient_count int;
alter table public.visit_summaries drop constraint if exists visit_summaries_patient_count_check;
alter table public.visit_summaries add constraint visit_summaries_patient_count_check
  check (patient_count is null or (patient_count >= 0 and patient_count <= 10000));

create or replace function public.summary_patient_count(p_summary bigint)
returns int language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select s.patient_count from public.visit_summaries s where s.id = p_summary and s.patient_count is not null and s.patient_count > 0),
    (select count(distinct v.patient_id)::int
       from public.summary_visits sv join public.visits v on v.id = sv.visit_id
      where sv.summary_id = p_summary),
    0
  )
$$;
revoke execute on function public.summary_patient_count(bigint) from public;
grant execute on function public.summary_patient_count(bigint) to anon, authenticated;

select 'ok' as step_103_summary_patient_count;
