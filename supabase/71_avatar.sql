-- =====================================================================
--  ขั้นที่ 71: รูปประจำตัว (วงกลมหน้าชื่อ หัวหน้าเจ้าหน้าที่/ผู้ดูแล → กดแก้ข้อมูลส่วนตัว) · รันซ้ำได้ · เพิ่มอย่างเดียว
--   profiles.avatar_path = รูปที่อัปโหลดเอง public-images/avatars/<user id>/… (ไม่มี = ใช้รูปจาก Google avatar_url หรือตัวอักษรย่อ)
--   แก้ได้เฉพาะของตัวเอง (policy profiles_self_update เดิม + grant คอลัมน์นี้) · path ต้องอยู่ในโฟลเดอร์ของตัวเอง
-- =====================================================================

alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles drop constraint if exists profiles_avatar_path_check;
alter table public.profiles add constraint profiles_avatar_path_check
  check (avatar_path is null or avatar_path ~ ('^avatars/' || id::text || '/[A-Za-z0-9._-]{1,80}$'));
grant update (avatar_path) on public.profiles to authenticated;

-- อัปโหลดรูปลงโฟลเดอร์ของตัวเองเท่านั้น (ลบได้ด้วย img_delete เดิม: เจ้าของไฟล์/ผู้ดูแล)
drop policy if exists img_insert_avatar on storage.objects;
create policy img_insert_avatar on storage.objects for insert to authenticated
  with check (bucket_id = 'public-images' and (storage.foldername(name))[1] = 'avatars'
              and (storage.foldername(name))[2] = auth.uid()::text);

select 'ok' as step_71_avatar;
