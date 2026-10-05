-- =====================================================================
--  ขั้นที่ 43: ระงับการแสดงผลงาน (ยังไม่ลบ) — รันต่อจาก 43 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   achievements.hidden = true → หน้าสาธารณะไม่เห็น (policy) · เจ้าหน้าที่ของหน่วยนั้น + ผู้ดูแลยังเห็น/แก้/เปิดแสดงอีกครั้งได้
--   ยังเป็นหลักฐานของข้อมาตรฐานที่ผูกไว้ (หน้ามาตรฐานของเจ้าหน้าที่/ผู้ดูแลยังเห็น)
-- =====================================================================

alter table public.achievements add column if not exists hidden boolean not null default false;

drop policy if exists ach_read on public.achievements;
create policy ach_read on public.achievements for select
  using (not hidden or public.is_admin() or public.is_staff_of(unit_id));

select 'ok' as step_43_achievement_hidden;
