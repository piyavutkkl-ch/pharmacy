-- =====================================================================
--  ขั้นที่ 46: ผู้ดูแลยกเลิกรายการขอตรวจ (หลักฐานเกณฑ์มาตรฐาน) → ถังขยะ เก็บ 30 วัน · รันซ้ำได้
--   ยกเลิก = สถานะกลับเป็น "ยังไม่ส่ง" + จำไว้ใน trashed_at/trashed_status (รายละเอียด/ไฟล์ยังอยู่)
--   กู้คืน = กลับเป็นสถานะเดิม (รอตรวจ) · ลบถาวร (ครบ 30 วัน หรือกดเอง) = ล้างรายละเอียด/ไฟล์ของคำขอนั้น
--   เจ้าหน้าที่ส่งใหม่ หรือผู้ดูแลตรวจข้อนั้น → ออกจากถังเอง
-- =====================================================================

alter table public.item_status add column if not exists trashed_at timestamptz;
alter table public.item_status add column if not exists trashed_status text;

-- เหมือน 14_review_files.sql + เคลียร์ถังเมื่อส่งใหม่/ตรวจ · เจ้าหน้าที่ตั้งค่าถังเองไม่ได้
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
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      new.trashed_at := null;
      new.trashed_status := null;
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
    new.trashed_at := null;
    new.trashed_status := null;
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

-- ยกเลิกรายการขอตรวจ (เฉพาะข้อที่รอตรวจ) → ถังขยะ
create or replace function public.trash_item_status(p_id bigint)
returns void language plpgsql security definer
set search_path = ''
as $$
declare s public.item_status%rowtype;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์' using errcode = '42501'; end if;
  select * into s from public.item_status where id = p_id;
  if not found then raise exception 'ไม่พบรายการ'; end if;
  if s.status <> 'submitted' then raise exception 'ยกเลิกได้เฉพาะรายการที่รอตรวจ'; end if;
  update public.item_status set trashed_status = s.status, status = 'none', trashed_at = now(), updated_at = now() where id = p_id;
end $$;

-- กู้คืนจากถังขยะ → สถานะเดิม (รอตรวจ)
create or replace function public.restore_item_status(p_id bigint)
returns void language plpgsql security definer
set search_path = ''
as $$
declare s public.item_status%rowtype;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์' using errcode = '42501'; end if;
  select * into s from public.item_status where id = p_id;
  if not found or s.trashed_at is null then raise exception 'ไม่พบรายการในถังขยะ'; end if;
  update public.item_status set status = coalesce(s.trashed_status, 'submitted'), trashed_at = null, trashed_status = null, updated_at = now() where id = p_id;
end $$;

-- ลบถาวร: ล้างรายละเอียด/ไฟล์ของคำขอที่อยู่ในถัง · คืนรายชื่อไฟล์ให้หน้าเว็บลบออกจาก storage
create or replace function public.purge_item_status(p_id bigint)
returns text[] language plpgsql security definer
set search_path = ''
as $$
declare s public.item_status%rowtype;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์' using errcode = '42501'; end if;
  select * into s from public.item_status where id = p_id;
  if not found or s.trashed_at is null then raise exception 'ไม่พบรายการในถังขยะ'; end if;
  update public.item_status set detail = null, evidence_paths = '{}', submitted_at = null, submitted_by = null,
    trashed_at = null, trashed_status = null, updated_at = now() where id = p_id;
  return s.evidence_paths;
end $$;

revoke execute on function public.trash_item_status(bigint) from public, anon;
revoke execute on function public.restore_item_status(bigint) from public, anon;
revoke execute on function public.purge_item_status(bigint) from public, anon;
grant execute on function public.trash_item_status(bigint) to authenticated;
grant execute on function public.restore_item_status(bigint) to authenticated;
grant execute on function public.purge_item_status(bigint) to authenticated;

select 'ok' as step_46_review_trash;
