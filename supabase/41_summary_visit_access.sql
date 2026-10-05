-- =====================================================================
--  ขั้นที่ 40: รายการเยี่ยมในสรุปผลงาน — เจ้าหน้าที่ทุกคนเห็นรายการ (ชื่อย่อ) · ผู้ร่วมลงเปิดดูรายละเอียดได้ — รันต่อจาก 40 · รันซ้ำได้
--   เจ้าของเว็บกำหนด (แบบ ข): เจ้าหน้าที่ทุก รพ.สต. เห็นรายการเยี่ยมของสรุปผลงานเป็น "ชื่อจริง****" (ไม่แสดงนามสกุล) + วันที่
--   ชื่อเต็ม + รายละเอียดการเยี่ยม: ผู้ร่วมลงของสรุปนั้น (participant_ids) + เจ้าหน้าที่ รพ.สต. ที่ดูแลผู้ป่วย + ผู้ดูแล
--   ย่อชื่อที่ฐานข้อมูล (ชื่อเต็มไม่ถูกส่งไปเครื่องคนที่ไม่มีสิทธิ์) · เปิดดูชื่อเต็ม/รายละเอียด = บันทึก audit_log ทุกครั้ง
--   ผู้ร่วมลงต่าง รพ.สต. ดูได้เฉพาะครั้งเยี่ยมที่เชื่อมโยงในสรุปนั้น (ไม่เห็นรูปถ่าย/ประวัติอื่นของผู้ป่วย)
-- =====================================================================

create or replace function public.summary_visit_list(p_summary bigint)
returns table (visit_id uuid, visit_date date, unit_id smallint, display_name text, can_open boolean)
language plpgsql security definer
set search_path = ''
as $$
declare parts uuid[];
begin
  if coalesce(public.my_role(), '') not in ('staff', 'admin') then raise exception 'ไม่มีสิทธิ์' using errcode = '42501'; end if;
  select s.participant_ids into parts from public.visit_summaries s where s.id = p_summary;
  if not found then return; end if;
  -- บันทึกการเห็นชื่อเต็ม (PDPA)
  insert into public.audit_log (actor_id, action, table_name, row_id, unit_id, patient_id, detail)
  select auth.uid(), 'view', 'visits', v.id::text, v.unit_id, v.patient_id, 'รายการเยี่ยมในสรุปผลงาน #' || p_summary
    from public.summary_visits sv join public.visits v on v.id = sv.visit_id
   where sv.summary_id = p_summary and (public.is_admin() or public.is_staff_of(v.unit_id) or auth.uid() = any(parts));
  return query
  select v.id, v.visit_date, v.unit_id,
         case when ok then p.first_name || ' ' || p.last_name else btrim(p.first_name) || '****' end,
         ok
    from public.summary_visits sv
    join public.visits v on v.id = sv.visit_id
    join public.patients p on p.id = v.patient_id
    cross join lateral (select (public.is_admin() or public.is_staff_of(v.unit_id) or auth.uid() = any(parts)) as ok) x
   where sv.summary_id = p_summary
   order by v.visit_date desc, p.first_name;
end $$;

/** รายละเอียดการเยี่ยม 1 ครั้งจากสรุปผลงาน (อ่านอย่างเดียว) — เฉพาะผู้ร่วมลง / เจ้าหน้าที่ รพ.สต. ที่ดูแล / ผู้ดูแล */
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
    'weight', v.weight, 'bp', v.bp, 'dtx', v.dtx, 'subjective', v.subjective, 'objective', v.objective, 'assessment', v.assessment,
    'plan', v.plan, 'med_list', v.med_list, 'med_excess', v.med_excess, 'med_note', v.med_note, 'drps', v.drps, 'drp_detail', v.drp_detail,
    'drp_resolved', v.drp_resolved, 'next_appt', v.next_appt, 'photos', cardinality(v.photo_paths),
    'own', public.is_admin() or public.is_staff_of(v.unit_id));
end $$;

revoke execute on function public.summary_visit_list(bigint), public.summary_visit_detail(bigint, uuid) from public, anon;
grant execute on function public.summary_visit_list(bigint), public.summary_visit_detail(bigint, uuid) to authenticated;

select 'ok' as step_40_summary_visit_access;
