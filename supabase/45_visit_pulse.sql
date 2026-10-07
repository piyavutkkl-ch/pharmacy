-- =====================================================================
--  ขั้นที่ 44: บันทึกเยี่ยมบ้าน — ช่องชีพจร (pulse) — รันต่อจาก 44 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   ฟอร์มเลิกใช้ช่อง Medication reconciliation และ นัดครั้งถัดไป (ข้อมูลเดิมยังเก็บไว้ ไม่ลบ)
--   "ยาเหลือค้างที่บ้านเกินวันนัด 1 เดือน" (med_excess) ให้เจ้าหน้าที่ติ๊กเอง ไม่คำนวณจากวันนัด
-- =====================================================================

alter table public.visits add column if not exists pulse smallint;
alter table public.visits drop constraint if exists visits_pulse_check;
alter table public.visits add constraint visits_pulse_check check (pulse is null or pulse between 20 and 250);

-- รายละเอียดการเยี่ยมจากสรุปผลงาน: เพิ่มชีพจร (เงื่อนไขสิทธิ์เหมือนเดิมทุกอย่าง · 41_summary_visit_access.sql)
create or replace function public.summary_visit_detail(p_summary bigint, p_visit uuid)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare v public.visits; p public.patients; parts uuid[];
begin
  select s.participant_ids into parts from public.visit_summaries s
   where s.id = p_summary and exists (select 1 from public.summary_visits sv where sv.summary_id = s.id and sv.visit_id = p_visit);
  if not found then raise exception 'ไม่พบรายการเยี่ยมนี้ในสรุปผลงาน'; end if;
  select * into v from public.visits where id = p_visit;
  if v.id is null or not (public.is_admin() or public.is_staff_of(v.unit_id) or auth.uid() = any(parts)) then
    raise exception 'ไม่มีสิทธิ์ดูรายละเอียด (เฉพาะผู้ร่วมลง เจ้าหน้าที่ รพ.สต. ที่ดูแล และผู้ดูแล)' using errcode = '42501';
  end if;
  select * into p from public.patients where id = v.patient_id;
  insert into public.audit_log (actor_id, action, table_name, row_id, unit_id, patient_id, detail)
  values (auth.uid(), 'view', 'visits', v.id::text, v.unit_id, v.patient_id, 'รายละเอียดการเยี่ยมจากสรุปผลงาน #' || p_summary);
  return jsonb_build_object(
    'name', p.first_name || ' ' || p.last_name, 'unit_id', v.unit_id, 'visit_date', v.visit_date, 'age', v.age,
    'weight', v.weight, 'bp', v.bp, 'pulse', v.pulse, 'dtx', v.dtx, 'subjective', v.subjective, 'objective', v.objective, 'assessment', v.assessment,
    'plan', v.plan, 'med_list', v.med_list, 'med_excess', v.med_excess, 'med_note', v.med_note, 'drps', v.drps, 'drp_detail', v.drp_detail,
    'drp_resolved', v.drp_resolved, 'photos', cardinality(v.photo_paths),
    'own', public.is_admin() or public.is_staff_of(v.unit_id));
end $$;
revoke execute on function public.summary_visit_detail(bigint, uuid) from public, anon;
grant execute on function public.summary_visit_detail(bigint, uuid) to authenticated;

select 'ok' as step_44_visit_pulse;
