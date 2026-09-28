-- =====================================================================
--  ขั้นที่ 13: ผู้ดูแลแนบไฟล์กลับไปพร้อมความเห็นตอนตรวจหลักฐาน — รันต่อจาก 13 · รันซ้ำได้
--   ไฟล์อยู่ใน bucket evidence (<ปีงบ>/<unit>/<ข้อ>/admin/…) — เห็นเฉพาะเจ้าหน้าที่หน่วยนั้น + ผู้ดูแล (policy เดิม)
-- =====================================================================

alter table public.item_status add column if not exists review_files text[] not null default '{}';

-- เหมือนเดิม + เจ้าหน้าที่แก้ review_files ไม่ได้ (เป็นของผู้ดูแล)
create or replace function public.guard_item_status()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    null;  -- SQL Editor / ฟังก์ชันระบบ
  elsif public.is_admin() then
    if tg_op = 'INSERT' or new.status is distinct from old.status or new.review_comment is distinct from old.review_comment then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    end if;
  else
    -- เจ้าหน้าที่: ส่ง/ส่งแก้ได้อย่างเดียว ตั้ง "อนุมัติ" เองไม่ได้ และส่งย้อนหลังในปีงบที่ปิดแล้วไม่ได้
    if (select ci.fiscal_year from public.criteria_items ci where ci.id = new.item_id)
         < public.fiscal_year_of(current_date) then
      raise exception 'ปีงบประมาณนี้ปิดแล้ว ส่งหลักฐานเพิ่มไม่ได้';
    end if;
    new.status := 'submitted';
    new.submitted_by := auth.uid();
    new.submitted_at := now();
    if tg_op = 'UPDATE' then
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
      new.review_comment := old.review_comment;
      new.review_files := old.review_files;
      new.item_id := old.item_id;
      new.unit_id := old.unit_id;
    else
      new.reviewed_by := null;
      new.reviewed_at := null;
      new.review_comment := null;
      new.review_files := '{}';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

select 'ok' as step_13_review_files;
