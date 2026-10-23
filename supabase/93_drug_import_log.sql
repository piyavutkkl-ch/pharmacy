-- =====================================================================
--  ขั้นที่ 93: ประวัติการนำเข้าไฟล์ข้อมูลยา (เจ้าของเว็บ 23 ต.ค. · หน้าตารางแก้ไขยา › ประวัติการนำเข้า)
--   เก็บเฉพาะรายละเอียดของไฟล์ (ชื่อ · สกุลไฟล์ · ขนาด · ระบบตรวจว่าเป็นฐานไหน · ผลบันทึก) ไม่เก็บตัวไฟล์
--     (ไฟล์ MIMS เป็นข้อมูลสมาชิก + พื้นที่ฟรีจำกัด) · ผู้ดูแลเท่านั้น · เพิ่มอย่างเดียว ไม่แก้/ลบ (เป็นประวัติ)
--   รันซ้ำได้ · เพิ่มตารางใหม่อย่างเดียว ไม่แตะข้อมูลเดิม
-- =====================================================================

create table if not exists public.drug_import_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  file_name   text not null check (char_length(file_name) between 1 and 200),
  file_ext    text not null default '' check (char_length(file_ext) <= 10),
  file_size   int not null default 0 check (file_size >= 0),
  kind        text not null check (kind in ('drugs', 'rpst', 'nlem', 'mims', 'mims_json', 'other')),   -- ฐานที่ระบบตรวจว่าไฟล์นี้เป็น
  how         text not null default '' check (how in ('', 'own', 'auto', 'ai', 'ocr')),   -- own = ไฟล์ส่งออกจากเว็บนี้ · auto = ตรวจในเครื่อง · ai = AI วิเคราะห์ · ocr = PDF ภาพ
  rows_ok     int not null default 0 check (rows_ok >= 0),
  rows_bad    int not null default 0 check (rows_bad >= 0),
  note        text not null default '' check (char_length(note) <= 500)
);
create index if not exists drug_import_log_at on public.drug_import_log (created_at desc);
alter table public.drug_import_log enable row level security;
drop policy if exists dil_read on public.drug_import_log;
create policy dil_read on public.drug_import_log for select to authenticated using (public.is_admin());
drop policy if exists dil_add on public.drug_import_log;
create policy dil_add on public.drug_import_log for insert to authenticated with check (public.is_admin() and created_by = auth.uid());
revoke all on public.drug_import_log from anon, authenticated;
grant select, insert on public.drug_import_log to authenticated;
grant all on public.drug_import_log to service_role;

select 'ok' as step_93_drug_import_log;
