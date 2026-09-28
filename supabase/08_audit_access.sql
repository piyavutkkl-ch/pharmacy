-- =====================================================================
--  ขั้นที่ 7: บันทึกการเข้าถึงข้อมูลผู้ป่วย (PDPA) — รันต่อจาก 07 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   1) audit_log เก็บเพิ่ม: รพ.สต., ผู้ป่วย, ช่องที่ถูกแก้ (เก็บแค่ชื่อช่อง ไม่เก็บค่าเดิม/ค่าใหม่)
--   2) บันทึก "เปิดดู" (รายชื่อผู้ป่วย / ข้อมูลผู้ป่วยรายคน) ผ่าน log_patient_access() ที่หน้าเว็บเรียก
--   3) ผู้ดูแลค้นย้อนหลังผ่าน admin_audit_log() — ไม่มีใครแก้หรือลบบันทึกได้ (รวมผู้ดูแล)
-- =====================================================================

alter table public.audit_log
  add column if not exists unit_id    smallint,
  add column if not exists patient_id uuid,      -- ไม่ผูก FK: ลบผู้ป่วยแล้วบันทึกต้องยังอยู่
  add column if not exists detail     text;
create index if not exists audit_log_patient_idx on public.audit_log (patient_id, at desc);
create index if not exists audit_log_actor_idx   on public.audit_log (actor_id, at desc);
create index if not exists audit_log_unit_idx    on public.audit_log (unit_id, at desc);

-- บันทึกเดิม (ก่อนไฟล์นี้): เติม รพ.สต./ผู้ป่วย ให้ค้นย้อนหลังได้
update public.audit_log a set unit_id = p.unit_id, patient_id = p.id
  from public.patients p
 where a.table_name = 'patients' and a.patient_id is null and a.row_id = p.id::text;
update public.audit_log a set unit_id = v.unit_id, patient_id = v.patient_id
  from public.visits v
 where a.table_name = 'visits' and a.patient_id is null and a.row_id = v.id::text;

create or replace function public.write_audit()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  rid text := r ->> 'id';
  u smallint;
  pid uuid;
  d text;
begin
  if tg_table_name = 'staff_roster' then
    rid := r ->> 'email';
  end if;
  if tg_table_name in ('patients', 'visits') then
    u := (r ->> 'unit_id')::smallint;
    pid := (case when tg_table_name = 'patients' then r ->> 'id' else r ->> 'patient_id' end)::uuid;
    if tg_op = 'DELETE' and tg_table_name = 'patients' then
      d := 'ชื่อ ' || coalesce(r ->> 'first_name', '') || ' ' || coalesce(r ->> 'last_name', '');   -- ลบแล้วยังรู้ว่าใคร
    end if;
  end if;
  if tg_op = 'UPDATE' then
    select string_agg(k, ',' order by k) into d
      from jsonb_object_keys(r) as k
     where k not in ('updated_at', 'fiscal_year') and (r -> k) is distinct from (to_jsonb(old) -> k);
  end if;
  insert into public.audit_log (actor_id, action, table_name, row_id, unit_id, patient_id, detail)
  values (auth.uid(), lower(tg_op), tg_table_name, rid, u, pid, d);
  return null;
end $$;

-- หน้าเว็บเรียกเมื่อเปิดรายชื่อผู้ป่วยของ รพ.สต. (p_patient = null) หรือเปิดข้อมูลผู้ป่วยรายคน
-- คนเดิมเปิดรายการเดิมซ้ำภายใน 10 นาที นับเป็นครั้งเดียว (กันบันทึกล้น)
create or replace function public.log_patient_access(p_unit smallint, p_patient uuid default null)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  u smallint := p_unit;
  act text := case when p_patient is null then 'list' else 'view' end;
begin
  if auth.uid() is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '42501';
  end if;
  if p_patient is not null then
    select p.unit_id into u from public.patients p where p.id = p_patient;
    if u is null then return; end if;
  end if;
  if not (public.is_admin() or public.is_staff_of(u)) then
    raise exception 'ไม่มีสิทธิ์' using errcode = '42501';
  end if;
  if exists (select 1 from public.audit_log a
              where a.actor_id = auth.uid() and a.action = act and a.unit_id = u
                and a.patient_id is not distinct from p_patient and a.at > now() - interval '10 minutes') then
    return;
  end if;
  insert into public.audit_log (actor_id, action, table_name, row_id, unit_id, patient_id)
  values (auth.uid(), act, 'patients', p_patient::text, u, p_patient);
end $$;

-- ผู้ดูแล: ค้นประวัติการเข้าถึงข้อมูลผู้ป่วย/เยี่ยมบ้าน (วันที่ตามเวลาไทย)
--   p_action: null = ทั้งหมด · 'read' = เปิดดู (list+view) · 'insert' | 'update' | 'delete'
create or replace function public.admin_audit_log(
  p_from date default null, p_to date default null, p_unit smallint default null,
  p_action text default null, p_q text default null, p_limit int default 200, p_offset int default 0)
returns table (id bigint, at timestamptz, action text, table_name text, row_id text,
               unit_id smallint, unit_name text, patient_id uuid, patient_name text,
               actor_id uuid, actor_name text, actor_email text, actor_role text, detail text, total bigint)
language plpgsql stable security definer
set search_path = ''
as $$
declare q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if not public.is_admin() then
    raise exception 'ไม่มีสิทธิ์' using errcode = '42501';
  end if;
  return query
  select a.id, a.at, a.action, a.table_name, a.row_id, a.unit_id, un.name, a.patient_id,
         nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
         a.actor_id, pr.full_name, pr.email, pr.role, a.detail, count(*) over ()
    from public.audit_log a
    left join public.units un on un.id = a.unit_id
    left join public.patients p on p.id = a.patient_id
    left join public.profiles pr on pr.id = a.actor_id
   where a.table_name in ('patients', 'visits')
     and (p_from is null or a.at >= (p_from::timestamp at time zone 'Asia/Bangkok'))
     and (p_to is null or a.at < ((p_to + 1)::timestamp at time zone 'Asia/Bangkok'))
     and (p_unit is null or a.unit_id = p_unit)
     and (p_action is null or a.action = p_action or (p_action = 'read' and a.action in ('list', 'view')))
     and (q is null or concat_ws(' ', p.first_name, p.last_name, p.hn_unit, p.hn_hospital, pr.full_name, pr.email, a.detail) ilike '%' || q || '%')
   order by a.at desc, a.id desc
   limit least(greatest(coalesce(p_limit, 200), 1), 5000) offset greatest(coalesce(p_offset, 0), 0);
end $$;

revoke execute on function public.log_patient_access(smallint, uuid) from public, anon;
revoke execute on function public.admin_audit_log(date, date, smallint, text, text, int, int) from public, anon;
grant execute on function public.log_patient_access(smallint, uuid) to authenticated;
grant execute on function public.admin_audit_log(date, date, smallint, text, text, int, int) to authenticated;
revoke execute on function public.write_audit() from public, anon, authenticated;

-- ย้ำ: บันทึกแก้/ลบไม่ได้ และเพิ่มเองไม่ได้ (ต้องผ่าน trigger / log_patient_access เท่านั้น)
revoke insert, update, delete on public.audit_log from authenticated, anon;

select 'ok' as step_7_audit,
       has_function_privilege('anon', 'public.admin_audit_log(date,date,smallint,text,text,int,int)', 'EXECUTE') as anon_can_read_log_should_be_false;
