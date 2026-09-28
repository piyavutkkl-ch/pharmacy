-- =====================================================================
--  ขั้นที่ 18: นับจำนวนดาวน์โหลดเอกสาร — รันต่อจาก 18 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   แยกตาราง document_stats (ไม่แตะ documents → วันที่ "ปรับปรุง" และบันทึก audit ไม่เปลี่ยนทุกครั้งที่มีคนโหลด)
--   เพิ่มตัวเลขได้ทางเดียวผ่าน bump_doc_download() — ต้องมีสิทธิ์เห็นเอกสารนั้น
-- =====================================================================

create table if not exists public.document_stats (
  doc_id     uuid primary key references public.documents(id) on delete cascade,
  downloads  int not null default 0
);
alter table public.document_stats enable row level security;
drop policy if exists docstats_read on public.document_stats;
create policy docstats_read on public.document_stats for select to authenticated
  using (exists (select 1 from public.documents d where d.id = doc_id));   -- เห็นเฉพาะของเอกสารที่ตัวเองเห็น (RLS ของ documents)
revoke all on public.document_stats from anon, authenticated;
grant select on public.document_stats to authenticated;
grant all on public.document_stats to service_role;

create or replace function public.bump_doc_download(p_doc uuid)
returns int language plpgsql security definer
set search_path = ''
as $$
declare n int;
begin
  if not exists (select 1 from public.documents d where d.id = p_doc
                  and (public.is_admin() or (public.my_role() = 'staff' and (d.for_unit is null or d.for_unit = public.my_unit())))) then
    raise exception 'ไม่มีสิทธิ์' using errcode = '42501';
  end if;
  insert into public.document_stats (doc_id, downloads) values (p_doc, 1)
  on conflict (doc_id) do update set downloads = public.document_stats.downloads + 1
  returning downloads into n;
  return n;
end $$;
revoke execute on function public.bump_doc_download(uuid) from public, anon;
grant execute on function public.bump_doc_download(uuid) to authenticated;

select 'ok' as step_18_doc_downloads;
