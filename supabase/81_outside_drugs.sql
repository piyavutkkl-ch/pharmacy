-- =====================================================================
--  ขั้นที่ 81: ฐานข้อมูลบัญชียานอก รพ.สต. · รันซ้ำได้ · เพิ่มอย่างเดียว (ไม่ลบข้อมูล)
--   local_drugs.outside = true → ยาที่ไม่มีในบัญชียา รพ.สต. (เช่น ยาจากโรงพยาบาลที่ผู้ป่วยใช้ที่บ้าน)
--   ใช้ตารางเดียวกับยา รพ.สต. → ผูกบัญชียาหลัก / ฉลาก openFDA / ขนาดยา / DDInter ได้เหมือนกัน
--   ยาที่ระบบเพิ่มจาก "เพิ่มหลายรายการ" สร้างเป็น outside + active = false (ซ่อนจนผู้ดูแลตรวจ) · สิทธิ์เดิมของ local_drugs (ทุกคนอ่านยาที่แสดง · ผู้ดูแลแก้)
-- =====================================================================

alter table public.local_drugs add column if not exists outside boolean not null default false;

-- ประวัติแก้ไขข้อมูลยา (79): บันทึกการย้ายยาเข้า/ออกบัญชียานอก รพ.สต. ด้วย
create or replace function public.write_drug_history()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  keys text[] := case tg_table_name
    when 'dose_drugs' then array['name', 'form', 'indications', 'concs', 'active', 'ai_draft', 'per', 'mg_per_kg_min', 'mg_per_kg_max', 'max_mg_per_dose', 'dose_freq_per_day', 'renal_note']
    else array['name', 'strength', 'ingredients', 'dose_id', 'active', 'unit', 'category', 'outside'] end;
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

select 'ok' as step_81_outside_drugs, (select count(*) from public.local_drugs where outside) as outside_drugs;
