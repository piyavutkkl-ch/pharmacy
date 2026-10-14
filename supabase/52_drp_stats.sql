-- =====================================================================
--  ขั้นที่ 52: ผลการดำเนินงาน › กด "DRPs ที่พบ / ที่แก้ไขสำเร็จ" → แยกตามชนิด DRP · รันซ้ำได้ · เพิ่มอย่างเดียว
--   ตัวเลขรวมเท่านั้น (หน้าสาธารณะ · ไม่มีข้อมูลรายบุคคล ตาม PDPA) · นับเป็นจำนวนการเยี่ยมที่พบ DRP ชนิดนั้น / ที่แก้ไขสำเร็จ
--   เรียงจากพบมากไปน้อย
-- =====================================================================

create or replace function public.public_drp_stats(p_year int, p_unit smallint default null)
returns table (drp text, found int, resolved int)
language sql stable security definer
set search_path = ''
as $$
  select d, count(*)::int, (count(*) filter (where v.drp_resolved))::int
    from public.visits v, unnest(v.drps) d
   where v.fiscal_year = p_year and (p_unit is null or v.unit_id = p_unit)
   group by d
   order by 2 desc, 3 desc, 1
$$;
revoke execute on function public.public_drp_stats(int, smallint) from public;
grant execute on function public.public_drp_stats(int, smallint) to anon, authenticated;

select 'ok' as step_52_drp_stats;
