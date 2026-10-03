-- =====================================================================
--  ขั้นที่ 35: ผลงาน ↔ ข้อมาตรฐาน — รันต่อจาก 35 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   achievements.item_ids = ข้อเกณฑ์ (criteria_items.id) ที่ผลงานนี้สอดคล้อง (เลือกได้หลายข้อ ≤ 40)
--   หน้า "มาตรฐาน" แสดงผลงานเป็นหลักฐานของข้อนั้นอัตโนมัติ · ไม่เปลี่ยนสถานะ item_status (ไม่ต้องส่งให้ผู้ดูแลตรวจ)
--   สิทธิ์ใช้ policy เดิมของ achievements (ผู้ดูแล / เจ้าหน้าที่ของหน่วยนั้น) · ข้อที่ไม่มีอยู่จริงถูกตัดทิ้ง
-- =====================================================================

alter table public.achievements add column if not exists item_ids bigint[] not null default '{}';
alter table public.achievements drop constraint if exists achievements_item_ids_check;
alter table public.achievements add constraint achievements_item_ids_check check (cardinality(item_ids) <= 40);
create index if not exists achievements_item_ids_idx on public.achievements using gin (item_ids);

create or replace function public.before_achievement_items()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.item_ids := coalesce((select array_agg(distinct x order by x) from unnest(new.item_ids) x
                             where exists (select 1 from public.criteria_items c where c.id = x)), '{}');
  return new;
end $$;
drop trigger if exists achievements_items on public.achievements;
create trigger achievements_items before insert or update of item_ids on public.achievements
  for each row execute function public.before_achievement_items();

select 'ok' as step_35_achievement_items;
