-- =====================================================================
--  ขั้นที่ 11: เจ้าหน้าที่ยกเลิกการส่งหลักฐานที่ยังรอตรวจได้ — รันต่อจาก 11 · รันซ้ำได้
--   ยกเลิกแล้ว: รายละเอียด/ไฟล์ยังอยู่ (แก้ต่อแล้วส่งใหม่ได้) · สถานะกลับเป็น "ยังไม่ส่ง" หรือ "ต้องแก้ไข" ถ้าผู้ดูแลเคยขอแก้
-- =====================================================================

create or replace function public.withdraw_item_status(p_id bigint)
returns text language plpgsql security definer
set search_path = ''
as $$
declare
  s public.item_status%rowtype;
  back text;
begin
  select * into s from public.item_status where id = p_id;
  if not found or not public.is_staff_of(s.unit_id) then
    raise exception 'ไม่มีสิทธิ์' using errcode = '42501';
  end if;
  if s.status <> 'submitted' then
    raise exception 'ยกเลิกได้เฉพาะข้อที่ส่งแล้วและยังรอตรวจ';
  end if;
  if (select ci.fiscal_year from public.criteria_items ci where ci.id = s.item_id) < public.fiscal_year_of(current_date) then
    raise exception 'ปีงบประมาณนี้ปิดแล้ว';
  end if;
  back := case when s.review_comment is not null and s.reviewed_at is not null then 'fix' else 'none' end;
  update public.item_status set status = back, submitted_at = null, updated_at = now() where id = p_id;
  return back;
end $$;
revoke execute on function public.withdraw_item_status(bigint) from public, anon;
grant execute on function public.withdraw_item_status(bigint) to authenticated;

select 'ok' as step_11_criteria_withdraw;
