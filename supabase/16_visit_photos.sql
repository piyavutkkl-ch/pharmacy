-- =====================================================================
--  ขั้นที่ 15: บันทึกเยี่ยมบ้าน — หมายเหตุรายการยาที่เหลือ + รูปถ่ายไม่เกิน 5 รูป — รันต่อจาก 15 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   รูปเป็นข้อมูลผู้ป่วย (PDPA) → bucket ส่วนตัว visit-photos path = <unit>/<patient id>/<ไฟล์>.webp
--   เห็นได้เฉพาะเจ้าหน้าที่ รพ.สต. นั้น + ผู้ดูแล (เหมือนตาราง visits)
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visit-photos', 'visit-photos', false, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create or replace function public.can_access_unit_folder(p_name text)
returns boolean language plpgsql stable security definer
set search_path = ''
as $$
begin
  return public.is_admin() or public.is_staff_of(split_part(p_name, '/', 1)::smallint);
exception when others then
  return false;
end $$;
revoke execute on function public.can_access_unit_folder(text) from public;
grant execute on function public.can_access_unit_folder(text) to anon, authenticated;

drop policy if exists visitphoto_read on storage.objects;
drop policy if exists visitphoto_insert on storage.objects;
drop policy if exists visitphoto_delete on storage.objects;
create policy visitphoto_read on storage.objects for select to authenticated
  using (bucket_id = 'visit-photos' and public.can_access_unit_folder(name));
create policy visitphoto_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'visit-photos' and public.can_access_unit_folder(name));
create policy visitphoto_delete on storage.objects for delete to authenticated
  using (bucket_id = 'visit-photos' and public.can_access_unit_folder(name));

alter table public.visits add column if not exists med_note text;
alter table public.visits add column if not exists photo_paths text[] not null default '{}';
alter table public.visits drop constraint if exists visits_med_note_check;
alter table public.visits add constraint visits_med_note_check check (med_note is null or char_length(med_note) <= 2000);
alter table public.visits drop constraint if exists visits_photo_paths_check;
alter table public.visits add constraint visits_photo_paths_check check (cardinality(photo_paths) <= 5);

select 'ok' as step_15_visit_photos;
