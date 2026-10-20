-- =====================================================================
--  ขั้นที่ 84: วันที่ทำ/นำเสนอผลงาน (achievements.work_date) · รันซ้ำได้ · เพิ่มอย่างเดียว (ไม่ลบข้อมูล)
--   ปฏิทินผลการดำเนินงานวางผลงานตามวันที่นี้ (เดิมใช้วันที่โพสต์ created_at) · เจ้าหน้าที่/ผู้ดูแลเลือกในฟอร์มผลงาน
--   ผลงานเดิม = วันที่โพสต์ (เวลาไทย) · ไม่กรอก = วันนี้
-- =====================================================================

alter table public.achievements add column if not exists work_date date;
update public.achievements set work_date = (created_at at time zone 'Asia/Bangkok')::date where work_date is null;
alter table public.achievements alter column work_date set default ((now() at time zone 'Asia/Bangkok')::date);
alter table public.achievements alter column work_date set not null;
alter table public.achievements drop constraint if exists achievements_work_date_check;
alter table public.achievements add constraint achievements_work_date_check check (work_date between date '2015-01-01' and date '2100-12-31');
create index if not exists achievements_work_date on public.achievements (work_date);

select 'ok' as step_84_achievement_work_date, (select count(*) from public.achievements where work_date is null) as missing;
