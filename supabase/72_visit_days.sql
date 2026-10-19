-- =====================================================================
--  ขั้นที่ 72: ปฏิทินผลงานเยี่ยมบ้านรายวัน (ผลการดำเนินงาน › เลือกเดือน) · รันซ้ำได้ · เพิ่มอย่างเดียว
--   public_visit_days(from, to, unit) → วันละ 1 แถว: จำนวนการเยี่ยม + DRPs ที่พบ/แก้ไขสำเร็จ (ตัวเลขรวมเท่านั้น ไม่มีข้อมูลรายบุคคล)
--   ทุกคนเรียกได้ (เหมือน public_tracking_stats) · ช่วงวันที่ ≤ 62 วัน · รายชื่อผู้ป่วยรายวันยังดูได้เฉพาะเจ้าหน้าที่/ผู้ดูแลผ่าน RLS ของ visits
-- =====================================================================

create or replace function public.public_visit_days(p_from date, p_to date, p_unit smallint default null)
returns table (day date, visits int, drps_found int, drps_resolved int)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 62 วัน)';
  end if;
  return query
    select v.visit_date, count(*)::int,
           coalesce(sum(cardinality(v.drps)), 0)::int,
           coalesce(sum(cardinality(v.drps)) filter (where v.drp_resolved), 0)::int
      from public.visits v
     where v.visit_date between p_from and p_to and (p_unit is null or v.unit_id = p_unit)
     group by v.visit_date
     order by v.visit_date;
end $$;
revoke execute on function public.public_visit_days(date, date, smallint) from public;
grant execute on function public.public_visit_days(date, date, smallint) to anon, authenticated;

select 'ok' as step_72_visit_days;
