-- =====================================================================
--  ขั้นที่ 105: แนบลิงก์ในเอกสาร (documents.link_url) · รันซ้ำได้ · เพิ่มอย่างเดียว
--   ผู้ดูแลสามารถโพสต์เอกสารเป็นไฟล์, ลิงก์ https://, หรือทั้งสองอย่างได้
--   บังคับลิงก์ต้องขึ้นต้นด้วย https:// (กัน XSS) · เปิดสิทธิ์ select ให้ anon สำหรับเอกสารสาธารณะ
-- =====================================================================

alter table public.documents add column if not exists link_url text;

alter table public.documents alter column file_path drop not null;
alter table public.documents alter column file_name drop not null;

alter table public.documents drop constraint if exists documents_link_url_check;
alter table public.documents add constraint documents_link_url_check
  check (link_url is null or (char_length(link_url) <= 1000 and link_url ~* '^https://'));

alter table public.documents drop constraint if exists documents_file_or_link_check;
alter table public.documents add constraint documents_file_or_link_check
  check ((file_path is not null and file_name is not null) or link_url is not null);

grant select (link_url) on public.documents to anon;

select 'ok' as step_105_documents_link;
