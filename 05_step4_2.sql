-- =====================================================================
--  ขั้นที่ 4.2: หน้าเจ้าหน้าที่ รพ.สต. (รันต่อจาก 04 · รันซ้ำได้)
--  เจ้าหน้าที่ รพ.สต. เดียวกันลบรูปผลงาน / ไฟล์หลักฐานของหน่วยตัวเองได้ (เช่น เพื่อนร่วมงานอัปโหลดไว้)
--  (ผลงาน/หลักฐานที่ผู้ดูแลอนุมัติแล้ว หน้าเว็บจะไม่ให้ลบไฟล์)
-- =====================================================================
drop policy if exists img_delete on storage.objects;
create policy img_delete on storage.objects for delete to authenticated
  using (bucket_id = 'public-images' and (
       public.is_admin()
    or owner_id = auth.uid()::text
    or ((storage.foldername(name))[1] = 'achievements' and (storage.foldername(name))[2] = public.my_unit()::text
        and public.my_role() = 'staff')));

drop policy if exists ev_delete on storage.objects;
create policy ev_delete on storage.objects for delete to authenticated
  using (bucket_id = 'evidence' and (
       public.is_admin()
    or (public.my_role() = 'staff' and (storage.foldername(name))[2] = public.my_unit()::text)));

select 'ok' as step_4_2;
