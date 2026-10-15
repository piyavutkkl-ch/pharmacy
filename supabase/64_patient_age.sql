-- =====================================================================
--  ขั้นที่ 64: ข้อมูลผู้ป่วย — กรอกอายุได้เมื่อไม่ทราบวันเกิด · รันซ้ำได้ · เพิ่มอย่างเดียว
--   patients.age_years = อายุ (ปี) ที่กรอก ณ วันที่ age_at · มีวันเกิด (birth_date) = ใช้วันเกิดคำนวณอายุแทน
--   หน้าเว็บแสดงอายุปัจจุบัน = age_years + จำนวนปีที่ผ่านไปตั้งแต่ age_at · สิทธิ์ตาม policy ของ patients เดิม
-- =====================================================================
alter table public.patients add column if not exists age_years smallint check (age_years is null or age_years between 0 and 130);
alter table public.patients add column if not exists age_at date;

select 'ok' as step_64_patient_age;
