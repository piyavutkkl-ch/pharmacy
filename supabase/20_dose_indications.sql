-- =====================================================================
--  ขั้นที่ 19: ยา 1 ตัวมีได้หลายข้อบ่งใช้ ขนาดยาแยกกัน — รันต่อจาก 19 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   dose_drugs.indications = [{ name, per: 'dose'|'day', min, max, times, cap, freq, renal }, …]
--   ช่องเดิม (indication, mg_per_kg_min … renal_note) ยังเก็บค่าของข้อบ่งใช้แรก ให้หน้าเว็บรุ่นเก่าใช้ได้ระหว่าง deploy
-- =====================================================================

alter table public.dose_drugs add column if not exists indications jsonb not null default '[]';
alter table public.dose_drugs drop constraint if exists dose_drugs_indications_check;
alter table public.dose_drugs add constraint dose_drugs_indications_check
  check (jsonb_typeof(indications) = 'array' and jsonb_array_length(indications) <= 20);

-- ยาเดิม: ย้ายขนาดยาเดิมเป็นข้อบ่งใช้แรก
update public.dose_drugs
   set indications = jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
         'name', indication, 'per', per, 'min', mg_per_kg_min, 'max', mg_per_kg_max,
         'times', dose_freq_per_day, 'cap', max_mg_per_dose, 'freq', freq, 'renal', renal_note)))
 where indications = '[]'::jsonb;

-- รูปแบบยา (ใช้กรองรายการยา): ยาเก่าเดาจากความแรงที่มี
alter table public.dose_drugs add column if not exists form text not null default 'อื่น ๆ';
alter table public.dose_drugs drop constraint if exists dose_drugs_form_check;
alter table public.dose_drugs add constraint dose_drugs_form_check check (form in ('ยาน้ำ', 'ยาเม็ด', 'ครีม', 'อื่น ๆ'));
update public.dose_drugs set form = case
    when concs @> '[{}]' and exists (select 1 from jsonb_array_elements(concs) c where c ? 'mgPerTab') then 'ยาเม็ด'
    when exists (select 1 from jsonb_array_elements(concs) c where c ? 'mgPer5ml' or c ? 'mgPerMl') then 'ยาน้ำ'
    else 'อื่น ๆ' end
 where form = 'อื่น ๆ';

select 'ok' as step_19_dose_indications;
