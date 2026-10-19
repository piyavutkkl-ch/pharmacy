-- =====================================================================
--  ขั้นที่ 73: อนุมัติข้อมูลขนาดยา (audit F-04) · รันซ้ำได้ · เพิ่มอย่างเดียว (ไม่ลบข้อมูล)
--   1) ฐานข้อมูลตรวจ indications ก่อนยาจะแสดงในเครื่องคำนวณ (active) — กันร่าง AI/ข้อมูลไม่ครบขึ้นหน้าสาธารณะ
--      ตรวจเฉพาะตอนเพิ่มยาที่แสดง / เปลี่ยนเป็นแสดง / อนุมัติร่าง / แก้ indications ของยาที่แสดง (ยาเดิมที่ไม่ได้แก้ไม่ถูกบล็อก)
--   2) บันทึกผู้อนุมัติ approved_by / approved_at (ระบบใส่เอง · ผู้ใช้กำหนดเองไม่ได้)
--      ร่าง AI → ไม่ใช่ร่าง (ai_draft true → false) = อนุมัติ · ผู้ดูแลเพิ่มยาเองที่ไม่ใช่ร่าง = ผู้เพิ่มเป็นผู้อนุมัติ
-- =====================================================================

alter table public.dose_drugs add column if not exists approved_by uuid references public.profiles(id) on delete set null;
alter table public.dose_drugs add column if not exists approved_at timestamptz;

/** ข้อบ่งใช้ที่ใช้คำนวณได้หรือไม่ → null = ใช้ได้ · ข้อความ = เหตุผลภาษาไทย (กฎเดียวกับ readInds ใน admin-settings.js) */
create or replace function public.dose_inds_problem(p jsonb)
returns text language plpgsql immutable
set search_path = ''
as $$
declare e jsonb; t jsonb; n int := 0; w text;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) = 0 then return 'ต้องมีข้อบ่งใช้อย่างน้อย 1 ข้อ'; end if;
  for e in select x from jsonb_array_elements(p) x loop
    n := n + 1; w := 'ข้อบ่งใช้ ' || n || ': ';
    if jsonb_typeof(e) <> 'object' then return w || 'รูปแบบข้อมูลไม่ถูกต้อง'; end if;
    if btrim(coalesce(e->>'name', '')) = '' then return w || 'ยังไม่มีชื่อข้อบ่งใช้'; end if;
    if coalesce(e->>'per', '') not in ('dose', 'day') then return w || 'ต้องระบุว่าเป็นขนาดต่อครั้งหรือต่อวัน'; end if;
    if coalesce(jsonb_typeof(e->'min'), '') <> 'number' or coalesce(jsonb_typeof(e->'max'), '') <> 'number' then return w || 'ต้องมีขนาดยาต่ำสุดและสูงสุดเป็นตัวเลข'; end if;
    if (e->>'min')::numeric < 0 then return w || 'ขนาดยาต้องไม่ติดลบ'; end if;
    if (e->>'max')::numeric <= 0 then return w || 'ขนาดยาสูงสุดต้องมากกว่า 0'; end if;
    if (e->>'max')::numeric < (e->>'min')::numeric then return w || 'ขนาดสูงสุดต้องไม่น้อยกว่าขนาดต่ำสุด'; end if;
    if e->>'per' = 'day' and not (coalesce(jsonb_typeof(e->'times'), '') = 'number' and (e->>'times')::numeric in (1,2,3,4,5,6,7,8,9,10,11,12)) then
      return w || 'ขนาดต่อวันต้องระบุจำนวนครั้งที่แบ่งให้ (1–12 ครั้ง)';
    end if;
    if coalesce(jsonb_typeof(e->'times_alt'), 'null') not in ('null', 'array') then return w || 'จำนวนครั้งแบบอื่นไม่ถูกต้อง'; end if;
    if jsonb_typeof(e->'times_alt') = 'array' then
      for t in select y from jsonb_array_elements(e->'times_alt') y loop
        if not (jsonb_typeof(t) = 'number' and t::text::numeric in (1,2,3,4,5,6,7,8,9,10,11,12)) then return w || 'จำนวนครั้งแบบอื่นต้องเป็น 1–12'; end if;
      end loop;
    end if;
    if coalesce(jsonb_typeof(e->'cap'), 'null') <> 'null' and not (jsonb_typeof(e->'cap') = 'number' and (e->>'cap')::numeric > 0) then
      return w || 'ขนาดสูงสุดต่อครั้งต้องเป็นตัวเลขมากกว่า 0';
    end if;
    if coalesce(e->>'unit', 'mg') not in ('mg', 'mcg') then return w || 'หน่วยขนาดยาต้องเป็น มก. หรือ mcg'; end if;
  end loop;
  return null;
end $$;
grant execute on function public.dose_inds_problem(jsonb) to anon, authenticated;

create or replace function public.before_dose_drugs_approve()
returns trigger language plpgsql
set search_path = ''
as $$
declare why text;
begin
  -- ผู้อนุมัติ: ระบบใส่เท่านั้น
  if tg_op = 'UPDATE' then new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  else new.approved_by := null; new.approved_at := null; end if;
  if not new.ai_draft and (tg_op = 'INSERT' or old.ai_draft) then
    new.approved_by := auth.uid(); new.approved_at := now();
  end if;
  -- ยาที่จะแสดงในเครื่องคำนวณ: ข้อมูลขนาดยาต้องครบ
  if new.active and (tg_op = 'INSERT' or not old.active or old.ai_draft or new.indications is distinct from old.indications) then
    why := public.dose_inds_problem(new.indications);
    if why is not null then
      raise exception 'ข้อมูลขนาดยายังไม่ครบหรือไม่ถูกต้อง จึงยังแสดงในเครื่องคำนวณไม่ได้ · %', why using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists dose_drugs_approve on public.dose_drugs;
create trigger dose_drugs_approve before insert or update on public.dose_drugs
  for each row execute function public.before_dose_drugs_approve();

select 'ok' as step_73_dose_approval,
       (select count(*) from public.dose_drugs where active and public.dose_inds_problem(indications) is not null) as active_rows_need_review;
