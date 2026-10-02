-- =====================================================================
--  ขั้นที่ 32: ย้ายผู้ป่วยตาม "สังกัด รพ.สต." — รันต่อจาก 32 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   เปลี่ยนสังกัด = ย้ายผู้ป่วย (และบันทึกเยี่ยมทั้งหมด) ไปอยู่ในรายชื่อของ รพ.สต. นั้น → transfer_patient()
--   เจ้าหน้าที่หน่วยเดิม/ผู้ดูแลย้ายได้ · หลังย้าย หน่วยเดิมไม่เห็นข้อมูลอีก (PDPA) · audit บันทึกเอง (trigger write_audit)
--   ที่อยู่แยกช่อง (address_parts) · รูปเยี่ยมบ้านเดิมอยู่ใต้โฟลเดอร์หน่วยเดิม → สิทธิ์เปิด/ลบตามหน่วยที่ดูแลผู้ป่วยตอนนี้ (can_access_patient_photo) · หน่วยเดิมไม่เห็นแล้ว
-- =====================================================================

create or replace function public.transfer_patient(p_patient uuid, p_unit smallint)
returns smallint language plpgsql security definer
set search_path = ''
as $$
declare cur smallint;
begin
  select p.unit_id into cur from public.patients p where p.id = p_patient;
  if cur is null then raise exception 'ไม่พบผู้ป่วย'; end if;
  if not (public.is_admin() or public.is_staff_of(cur)) then raise exception 'ไม่มีสิทธิ์'; end if;
  if not exists (select 1 from public.units u where u.id = p_unit) then raise exception 'ไม่พบ รพ.สต. ปลายทาง'; end if;
  update public.patients set unit_id = p_unit, home_unit_id = p_unit where id = p_patient;
  update public.visits set unit_id = p_unit where patient_id = p_patient and unit_id <> p_unit;   -- trigger visit_set_unit ยืนยันหน่วยจากผู้ป่วย
  return p_unit;
end $$;
revoke execute on function public.transfer_patient(uuid, smallint) from public, anon;
grant execute on function public.transfer_patient(uuid, smallint) to authenticated;

-- รูปเยี่ยมบ้าน <unit>/<patient>/… : เปิด/ลบได้ทั้งตามโฟลเดอร์หน่วย และตามหน่วยที่ดูแลผู้ป่วยตอนนี้ (หลังย้ายสังกัด)
create or replace function public.can_access_patient_photo(p_name text)
returns boolean language plpgsql stable security definer
set search_path = ''
as $$
declare u smallint;
begin
  select p.unit_id into u from public.patients p where p.id = split_part(p_name, '/', 2)::uuid;
  if not found then return public.can_access_unit_folder(p_name); end if;   -- ไม่พบผู้ป่วย = ใช้สิทธิ์ตามโฟลเดอร์เดิม
  return public.is_admin() or public.is_staff_of(u);                         -- ผู้ป่วยอยู่หน่วยไหน หน่วยนั้นเห็น (หน่วยเดิมไม่เห็นแล้ว)
exception when others then
  return false;
end $$;
revoke execute on function public.can_access_patient_photo(text) from public;
grant execute on function public.can_access_patient_photo(text) to anon, authenticated;

drop policy if exists visitphoto_read on storage.objects;
drop policy if exists visitphoto_delete on storage.objects;
create policy visitphoto_read on storage.objects for select to authenticated
  using (bucket_id = 'visit-photos' and public.can_access_patient_photo(name));
create policy visitphoto_delete on storage.objects for delete to authenticated
  using (bucket_id = 'visit-photos' and public.can_access_patient_photo(name));

-- ที่อยู่ผู้ป่วยแยกช่อง: {no เลขที่, moo หมู่, tambon ตำบล, amphoe อำเภอ, province จังหวัด, zip รหัสไปรษณีย์}
--   address (ข้อความเดิม) ยังเก็บเป็นที่อยู่เต็มที่ประกอบจากช่องย่อย (ใช้แสดง/ค้นหา · ข้อมูลเก่าไม่หาย)
alter table public.patients add column if not exists address_parts jsonb;
alter table public.patients drop constraint if exists patients_address_parts_check;
alter table public.patients add constraint patients_address_parts_check
  check (address_parts is null or (jsonb_typeof(address_parts) = 'object' and char_length(address_parts::text) <= 800));

select 'ok' as step_32_patient_transfer;
