-- =====================================================================
--  ขั้นที่ 16: ซ่อน / ลบ ปีงบประมาณของเกณฑ์ — รันต่อจาก 16 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   ซ่อน: เจ้าหน้าที่และหน้าสาธารณะไม่เห็นปีนั้น (ข้อมูลยังอยู่ครบ เลิกซ่อนได้)
--   ลบ: ทำได้เฉพาะปีที่ยังไม่มีการส่งหลักฐาน/ผลตรวจเลย (กันข้อมูลหาย) · ปีที่ผ่านไปแล้วลบไม่ได้ (กฎเดิมของเกณฑ์)
-- =====================================================================

alter table public.criteria_years add column if not exists hidden boolean not null default false;

create or replace function public.guard_criteria_year_delete()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') and exists (
       select 1 from public.item_status s join public.criteria_items ci on ci.id = s.item_id
        where ci.fiscal_year = old.fiscal_year
          and (s.status <> 'none' or cardinality(s.evidence_paths) > 0 or s.detail is not null)) then
    raise exception 'ปีงบ % มีการส่งหลักฐานหรือผลตรวจแล้ว ลบไม่ได้ — ใช้ "ซ่อนปีงบ" แทน', old.fiscal_year;
  end if;
  return old;
end $$;
drop trigger if exists criteria_years_delete_guard on public.criteria_years;
create trigger criteria_years_delete_guard before delete on public.criteria_years
  for each row execute function public.guard_criteria_year_delete();

select 'ok' as step_16_year_hide;
