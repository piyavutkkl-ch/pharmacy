-- =====================================================================
--  ขั้นที่ 12: ไฟล์ตัวอย่างหลักฐานต่อหัวข้อย่อยของเกณฑ์ (ผู้ดูแลแนบ · เจ้าหน้าที่ดู/ดาวน์โหลด) — รันต่อจาก 12 · รันซ้ำได้
--   เก็บใน bucket ส่วนตัว criteria-samples path = <ปีงบ>/<หัวข้อย่อย>/<ไฟล์> · รายการไฟล์อยู่ที่ criteria_items.evidence_samples
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('criteria-samples', 'criteria-samples', false, 5242880, array['application/pdf', 'image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists sample_read on storage.objects;
drop policy if exists sample_admin_insert on storage.objects;
drop policy if exists sample_admin_delete on storage.objects;
create policy sample_read on storage.objects for select to authenticated
  using (bucket_id = 'criteria-samples' and public.is_staff_or_admin());
create policy sample_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'criteria-samples' and public.is_admin());
create policy sample_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'criteria-samples' and public.is_admin());

-- [{ "path": "2570/1/…pdf", "name": "ตัวอย่างคำสั่ง.pdf" }, …] เหมือนกันทุกข้อในหัวข้อย่อยเดียวกัน
alter table public.criteria_items add column if not exists evidence_samples jsonb not null default '[]';
alter table public.criteria_items drop constraint if exists criteria_items_samples_check;
alter table public.criteria_items add constraint criteria_items_samples_check
  check (jsonb_typeof(evidence_samples) = 'array' and jsonb_array_length(evidence_samples) <= 10);

-- ขึ้นปีงบใหม่: คัดลอกไฟล์ตัวอย่างไปด้วย (อ้างไฟล์เดิม ไม่ต้องอัปโหลดใหม่)
create or replace function public.start_fiscal_year(p_year int)
returns int language plpgsql security definer
set search_path = ''
as $$
declare
  src int;
  n int;
begin
  if not public.is_admin() and auth.uid() is not null then
    raise exception 'เฉพาะผู้ดูแลเท่านั้น';
  end if;
  if exists (select 1 from public.criteria_years where fiscal_year = p_year) then
    return 0;
  end if;
  select max(fiscal_year) into src from public.criteria_years where fiscal_year < p_year;
  insert into public.criteria_years (fiscal_year, note)
  values (p_year, 'คัดลอกจากปีงบ ' || coalesce(src::text, '-'));
  insert into public.criteria_items (fiscal_year, topic_no, topic_title, sub_id, sub_label, evidence, evidence_samples, item_no, body, sort)
  select p_year, topic_no, topic_title, sub_id, sub_label, evidence, evidence_samples, item_no, body, sort
    from public.criteria_items where fiscal_year = src;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.start_fiscal_year(int) from public, anon;
grant execute on function public.start_fiscal_year(int) to authenticated;

select 'ok' as step_12_criteria_samples;
