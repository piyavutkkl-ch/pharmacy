-- =====================================================================
--  ขั้นที่ 4.3: หน้าผู้ดูแล (รันต่อจาก 05 · รันซ้ำได้)
--   1) ห้ามแก้/เพิ่ม/ลบเกณฑ์ของปีงบที่ผ่านไปแล้วผ่านหน้าเว็บ (ประวัติคะแนนต้องคงเดิม)
--   2) ผู้ดูแลตรวจหลักฐาน: ตั้งสถานะ none/submitted/approved/fix ได้ + บันทึกผู้ตรวจ
-- =====================================================================
create or replace function public.guard_criteria_items()
returns trigger language plpgsql
set search_path = ''
as $$
declare fy int := public.fiscal_year_of(current_date);
begin
  if current_user not in ('anon', 'authenticated') then
    return coalesce(new, old);
  end if;
  if (tg_op in ('UPDATE', 'DELETE') and old.fiscal_year < fy) or (tg_op in ('INSERT', 'UPDATE') and new.fiscal_year < fy) then
    raise exception 'เกณฑ์ของปีงบที่ผ่านไปแล้วแก้ไขไม่ได้ (เก็บไว้เป็นประวัติ)';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists criteria_items_guard on public.criteria_items;
create trigger criteria_items_guard before insert or update or delete on public.criteria_items
  for each row execute function public.guard_criteria_items();

select 'ok' as step_4_3;
