-- =====================================================================
--  ขั้นที่ 10: แนบไฟล์ PDF กับข่าว (ผู้อ่านดาวน์โหลดได้) — รันต่อจาก 10 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   bucket สาธารณะ news-files (PDF ≤ 5 MB) path = <user id>/<ไฟล์>.pdf · ข่าวเผยแพร่แล้วใครก็เปิดไฟล์ได้
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('news-files', 'news-files', true, 5242880, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists newsfile_read on storage.objects;
drop policy if exists newsfile_insert on storage.objects;
drop policy if exists newsfile_delete on storage.objects;
create policy newsfile_read on storage.objects for select
  using (bucket_id = 'news-files');
create policy newsfile_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'news-files' and public.is_staff_or_admin()
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy newsfile_delete on storage.objects for delete to authenticated
  using (bucket_id = 'news-files' and (public.is_admin() or owner_id = auth.uid()::text));

alter table public.news add column if not exists file_path text;
alter table public.news add column if not exists file_name text;
alter table public.news drop constraint if exists news_file_name_check;
alter table public.news add constraint news_file_name_check check (file_name is null or char_length(file_name) <= 200);

select 'ok' as step_10_news_files;
