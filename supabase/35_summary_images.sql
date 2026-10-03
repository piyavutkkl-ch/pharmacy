-- =====================================================================
--  ขั้นที่ 34: สรุปผลงานเยี่ยมบ้าน — หลายภาพ + เลือก รพ.สต. ได้ — รันต่อจาก 34 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   gallery = ภาพเพิ่ม (ไม่เกิน 6 · ภาพแรกยังเป็น image_path) · ไม่มีช่อง PDF ในฟอร์มแล้ว (ไฟล์เดิมยังแสดง)
--   เจ้าหน้าที่เพิ่มสรุปให้ รพ.สต. ไหนก็ได้ (ข้อมูลสาธารณะ · ค่าเริ่มต้น = หน่วยตัวเอง) · แก้/ลบได้เมื่อเป็นหน่วยนั้นหรือเป็นคนเพิ่ม
--   รูปของเจ้าหน้าที่ยังอยู่ใต้ public-images/summaries/<หน่วยตัวเอง>/ (policy เดิม)
-- =====================================================================

alter table public.visit_summaries add column if not exists gallery text[] not null default '{}';
alter table public.visit_summaries drop constraint if exists visit_summaries_gallery_check;
alter table public.visit_summaries add constraint visit_summaries_gallery_check check (cardinality(gallery) <= 6);

drop policy if exists vsum_write on public.visit_summaries;
drop policy if exists vsum_insert on public.visit_summaries;
drop policy if exists vsum_update on public.visit_summaries;
drop policy if exists vsum_delete on public.visit_summaries;
create policy vsum_insert on public.visit_summaries for insert to authenticated
  with check (public.is_admin() or (public.my_role() = 'staff' and author_id = auth.uid()));
create policy vsum_update on public.visit_summaries for update to authenticated
  using (public.is_admin() or public.is_staff_of(unit_id) or author_id = auth.uid())
  with check (public.is_admin() or (public.my_role() = 'staff' and (public.is_staff_of(unit_id) or author_id = auth.uid())));
create policy vsum_delete on public.visit_summaries for delete to authenticated
  using (public.is_admin() or public.is_staff_of(unit_id) or author_id = auth.uid());

select 'ok' as step_34_summary_images;
