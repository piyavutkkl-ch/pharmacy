-- =====================================================================
--  ขั้นที่ 14: ข้อมูลผู้ป่วยเพิ่ม — สังกัด รพ.สต., ที่อยู่, เบอร์โทร + บันทึกเยี่ยมบ้านช่อง O (Objective) — รันต่อจาก 14 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   สังกัด (home_unit_id) = รพ.สต. ที่ผู้ป่วยมีรายชื่ออยู่ · สิทธิ์เห็นข้อมูลยังคุมด้วย unit_id (หน่วยที่ดูแล) เหมือนเดิม
--   ช่อง HN รพ.สต. เดิมยังเก็บไว้ (ข้อมูลเก่าไม่หาย) แต่หน้าเว็บไม่ให้กรอกแล้ว
-- =====================================================================

alter table public.patients add column if not exists home_unit_id smallint references public.units(id);
alter table public.patients add column if not exists address text;
alter table public.patients add column if not exists phone text;
alter table public.patients drop constraint if exists patients_address_check;
alter table public.patients add constraint patients_address_check check (address is null or char_length(address) <= 300);
alter table public.patients drop constraint if exists patients_phone_check;
alter table public.patients add constraint patients_phone_check check (phone is null or phone ~ '^[0-9][0-9 -]{7,14}$');

-- SOAP: O = Objective data (สิ่งที่ตรวจพบ/วัดได้ นอกจาก BP/DTX/น้ำหนัก)
alter table public.visits add column if not exists objective text;
alter table public.visits drop constraint if exists visits_objective_check;
alter table public.visits add constraint visits_objective_check check (objective is null or char_length(objective) <= 4000);

select 'ok' as step_14_patient_contact;
