-- =====================================================================
--  ขั้นที่ 70: หน้า "ดาวน์โหลดเอกสาร" (#/documents · ปุ่มท้ายเว็บ) · รันซ้ำได้ · เพิ่มอย่างเดียว
--   documents.is_public = ผู้ดูแลเลือกให้ทุกคนดาวน์โหลดได้ (ไม่ต้องล็อกอิน) · ใช้ได้เฉพาะเอกสาร "ทุก รพ.สต." (for_unit is null)
--   เอกสารเดิมยังเป็นของเจ้าหน้าที่เท่านั้นจนผู้ดูแลเลือก · เจ้าหน้าที่/ผู้ดูแลเห็นตามสิทธิ์เดิม (policy เดิมไม่เปลี่ยน)
--   documents.item_ids = ข้อมาตรฐาน (criteria_items.id) ที่เอกสารนี้เกี่ยวข้อง → หน้ามาตรฐานของเจ้าหน้าที่แสดงให้ดาวน์โหลดในข้อนั้น
-- =====================================================================

alter table public.documents add column if not exists is_public boolean not null default false;
alter table public.documents add column if not exists item_ids bigint[] not null default '{}';
alter table public.documents drop constraint if exists documents_item_ids_check;
alter table public.documents add constraint documents_item_ids_check check (cardinality(item_ids) <= 40);

create or replace function public.before_document_items()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.item_ids := coalesce((select array_agg(distinct x order by x) from unnest(new.item_ids) x
                             where exists (select 1 from public.criteria_items c where c.id = x)), '{}');
  return new;
end $$;
drop trigger if exists documents_items on public.documents;
create trigger documents_items before insert or update of item_ids on public.documents
  for each row execute function public.before_document_items();

drop policy if exists docs_public_read on public.documents;
create policy docs_public_read on public.documents for select to anon, authenticated
  using (is_public and for_unit is null);
grant select (id, title, category, for_unit, note, file_path, file_name, file_size, content_type, version, updated_at, is_public, item_ids)
  on public.documents to anon;

-- ไฟล์: อ่าน (สร้างลิงก์ดาวน์โหลดชั่วคราว) ได้เฉพาะไฟล์ของเอกสารที่เผยแพร่
drop policy if exists docfile_public_read on storage.objects;
create policy docfile_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'documents' and exists (
    select 1 from public.documents d where d.file_path = name and d.is_public and d.for_unit is null));

-- จำนวนดาวน์โหลด: ทุกคนเห็นของเอกสารที่ตัวเองเห็น (RLS ของ documents) · เพิ่มได้ผ่าน bump_doc_download เท่านั้น
drop policy if exists docstats_read on public.document_stats;
create policy docstats_read on public.document_stats for select to anon, authenticated
  using (exists (select 1 from public.documents d where d.id = doc_id));
grant select on public.document_stats to anon;

create or replace function public.bump_doc_download(p_doc uuid)
returns int language plpgsql security definer
set search_path = ''
as $$
declare n int;
begin
  if not exists (select 1 from public.documents d where d.id = p_doc
                  and ((d.is_public and d.for_unit is null) or public.is_admin()
                       or (public.my_role() = 'staff' and (d.for_unit is null or d.for_unit = public.my_unit())))) then
    raise exception 'ไม่มีสิทธิ์' using errcode = '42501';
  end if;
  insert into public.document_stats (doc_id, downloads) values (p_doc, 1)
  on conflict (doc_id) do update set downloads = public.document_stats.downloads + 1
  returning downloads into n;
  return n;
end $$;
revoke execute on function public.bump_doc_download(uuid) from public;
grant execute on function public.bump_doc_download(uuid) to anon, authenticated;

select 'ok' as step_70_public_docs;
