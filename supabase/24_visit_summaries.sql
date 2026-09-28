-- =====================================================================
--  ขั้นที่ 23: สรุปผลงานเยี่ยมบ้าน (ภาพ A4 one-page summary ราย รพ.สต. × ปีงบ) — รันต่อจาก 23 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   เจ้าหน้าที่ รพ.สต. เพิ่ม/แก้/ลบของหน่วยตัวเองจากหน้าเยี่ยมบ้าน · ผู้ดูแลจัดการได้ทุกหน่วย · เผยแพร่ที่หน้าหลักทันที (เหมือนผลงาน)
--   รูปอยู่ใน public-images/summaries/<unit>/… · PDF แนบอยู่ใน news-files/<user id>/… (ใช้ policy เดิมของข่าว)
--   ห้ามมีข้อมูลระบุตัวผู้ป่วยในภาพ (หน้าเว็บเตือนตอนอัปโหลด)
-- =====================================================================

create table if not exists public.visit_summaries (
  id           bigint generated always as identity primary key,
  unit_id      smallint not null references public.units(id),
  fiscal_year  int not null check (fiscal_year between 2560 and 2700),
  title        text not null check (char_length(btrim(title)) between 1 and 200),
  body         text not null default '' check (char_length(body) <= 5000),
  image_path   text not null,
  file_path    text,
  file_name    text check (file_name is null or char_length(file_name) <= 200),
  author_id    uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists visit_summaries_unit_year on public.visit_summaries (unit_id, fiscal_year);

alter table public.visit_summaries enable row level security;
drop policy if exists vsum_read on public.visit_summaries;
drop policy if exists vsum_write on public.visit_summaries;
create policy vsum_read on public.visit_summaries for select using (true);
create policy vsum_write on public.visit_summaries for all to authenticated
  using (public.is_admin() or public.is_staff_of(unit_id))
  with check (public.is_admin() or public.is_staff_of(unit_id));

grant select on public.visit_summaries to anon;
grant select, insert, update, delete on public.visit_summaries to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant all on public.visit_summaries to service_role;

-- รูปสรุปของเจ้าหน้าที่: public-images/summaries/<หน่วยตัวเอง>/… (ผู้ดูแลอัปโหลด/ลบได้ทุกที่อยู่แล้ว)
drop policy if exists img_insert_summary on storage.objects;
drop policy if exists img_delete_summary on storage.objects;
create policy img_insert_summary on storage.objects for insert to authenticated
  with check (bucket_id = 'public-images' and (storage.foldername(name))[1] = 'summaries'
    and (storage.foldername(name))[2] = public.my_unit()::text and public.my_role() = 'staff');
create policy img_delete_summary on storage.objects for delete to authenticated
  using (bucket_id = 'public-images' and (storage.foldername(name))[1] = 'summaries'
    and (storage.foldername(name))[2] = public.my_unit()::text and public.my_role() = 'staff');

select 'ok' as step_23_visit_summaries;
