-- =====================================================================
--  ขั้นที่ 79: ประวัติการแก้ไขข้อมูลขนาดยา/ความแรงยา (audit F-13) · รันซ้ำได้ · เพิ่มอย่างเดียว (ไม่ลบข้อมูล)
--   drug_data_history: ทุกครั้งที่เพิ่ม/แก้/ลบ dose_drugs หรือแก้ความแรง/สารสำคัญ/การผูกข้อมูลคำนวณของ local_drugs
--   เก็บ ใคร (changed_by) · เมื่อไร · ช่องที่เปลี่ยน · ค่าก่อน/หลัง (เฉพาะช่องข้อมูลยา · ไม่มีข้อมูลผู้ป่วย)
--   ผู้ดูแลอ่านได้อย่างเดียว · ไม่มีใครเพิ่ม/แก้/ลบเองได้ (เขียนผ่าน trigger security definer เท่านั้น)
-- =====================================================================

create table if not exists public.drug_data_history (
  id          bigint generated always as identity primary key,
  table_name  text not null check (table_name in ('dose_drugs', 'local_drugs')),
  row_id      bigint not null,
  action      text not null check (action in ('insert', 'update', 'delete')),
  fields      text[] not null default '{}',
  old_values  jsonb,
  new_values  jsonb,
  changed_by  uuid references public.profiles(id) on delete set null,
  changed_at  timestamptz not null default now()
);
create index if not exists drug_data_history_row on public.drug_data_history (table_name, row_id, changed_at desc);

alter table public.drug_data_history enable row level security;
drop policy if exists ddh_admin_read on public.drug_data_history;
create policy ddh_admin_read on public.drug_data_history for select to authenticated using (public.is_admin());
revoke all on public.drug_data_history from anon, authenticated;
grant select on public.drug_data_history to authenticated;

create or replace function public.write_drug_history()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  keys text[] := case tg_table_name
    when 'dose_drugs' then array['name', 'form', 'indications', 'concs', 'active', 'ai_draft', 'per', 'mg_per_kg_min', 'mg_per_kg_max', 'max_mg_per_dose', 'dose_freq_per_day', 'renal_note']
    else array['name', 'strength', 'ingredients', 'dose_id', 'active', 'unit', 'category'] end;
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  changed text[];
begin
  select coalesce(array_agg(k order by k), '{}') into changed from unnest(keys) k
   where (o -> k) is distinct from (n -> k);
  if tg_op = 'UPDATE' and cardinality(changed) = 0 then return null; end if;   -- เปลี่ยนแค่ช่องระบบ (updated_at ฯลฯ) ไม่บันทึก
  insert into public.drug_data_history (table_name, row_id, action, fields, old_values, new_values, changed_by)
  values (tg_table_name, coalesce((n ->> 'id'), (o ->> 'id'))::bigint, lower(tg_op), changed,
          (select jsonb_object_agg(k, o -> k) from unnest(changed) k where o is not null),
          (select jsonb_object_agg(k, n -> k) from unnest(changed) k where n is not null),
          auth.uid());
  return null;
end $$;
revoke execute on function public.write_drug_history() from public, anon, authenticated;

drop trigger if exists dose_drugs_history on public.dose_drugs;
create trigger dose_drugs_history after insert or update or delete on public.dose_drugs
  for each row execute function public.write_drug_history();
drop trigger if exists local_drugs_history on public.local_drugs;
create trigger local_drugs_history after update or delete on public.local_drugs
  for each row execute function public.write_drug_history();

select 'ok' as step_79_drug_data_history;
