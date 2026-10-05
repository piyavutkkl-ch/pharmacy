-- =====================================================================
--  ขั้นที่ 42: ชื่อในบัญชีเจ้าหน้าที่ ⇄ ชื่อที่แสดงบนเว็บ (profiles.full_name) ให้ตรงกัน — รันต่อจาก 42 · รันซ้ำได้ · ไม่ลบข้อมูล
--   เดิม: ผู้ดูแลแก้ชื่อในบัญชีเจ้าหน้าที่ แต่ชื่อบนแถบเมนู/หัวหน้า ("สวัสดี …") ยังเป็นชื่อจาก Google
--   ใหม่: ผู้ดูแลแก้ชื่อในบัญชี → ชื่อบนเว็บของคนนั้นเปลี่ยนตาม · เจ้าตัวแก้ชื่อในหน้าต่างข้อมูลส่วนตัว → ชื่อในบัญชีเจ้าหน้าที่เปลี่ยนตาม
--   ตำแหน่ง (staff_roster.position) หน้าเว็บอ่านจากบัญชีของตัวเอง (เจ้าหน้าที่อ่านแถวของตัวเองได้อยู่แล้ว)
--   แก้ชื่อ/ตำแหน่งในบัญชี → สรุปผลงานเยี่ยมบ้านที่มีคนนั้นเป็นผู้ร่วมลง อัปเดตชื่อ/ตำแหน่ง (นับตามตำแหน่ง) ตามทันที
-- =====================================================================

create or replace function public.sync_roster_to_profile()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and (tg_op = 'DELETE' or old.email <> new.email) then
    update public.profiles set role = 'citizen', unit_id = null where email = old.email;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.active then
      update public.profiles
         set role = new.role, unit_id = new.unit_id,
             full_name = case when tg_op = 'INSERT' or old.full_name is distinct from new.full_name or full_name is null
                              then new.full_name else full_name end
       where email = new.email;
    else
      update public.profiles set role = 'citizen', unit_id = null where email = new.email;
    end if;
    if tg_op = 'INSERT' or old.full_name is distinct from new.full_name or old.position is distinct from new.position then
      -- trigger before_summary_people เติมชื่อ/ตำแหน่งใหม่ให้สรุปที่มีคนนี้เป็นผู้ร่วมลง
      update public.visit_summaries s set participant_ids = s.participant_ids
       where exists (select 1 from public.profiles p where lower(p.email) = new.email and p.id = any(s.participant_ids));
    end if;
  end if;
  return null;
end $$;

create or replace function public.sync_profile_name_to_roster()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  update public.staff_roster set full_name = new.full_name
   where email = lower(new.email) and full_name is distinct from new.full_name and coalesce(btrim(new.full_name), '') <> '';
  return null;
end $$;
revoke execute on function public.sync_profile_name_to_roster() from public, anon, authenticated;
drop trigger if exists profiles_name_to_roster on public.profiles;
create trigger profiles_name_to_roster after update of full_name on public.profiles
  for each row when (old.full_name is distinct from new.full_name and new.role in ('staff', 'admin'))
  execute function public.sync_profile_name_to_roster();

-- ครั้งเดียว: ให้ชื่อบนเว็บของเจ้าหน้าที่/ผู้ดูแลตรงกับชื่อในบัญชีเจ้าหน้าที่ (ผู้ดูแลตั้งไว้)
update public.profiles p set full_name = r.full_name
  from public.staff_roster r
 where r.email = lower(p.email) and r.active and p.role in ('staff', 'admin') and p.full_name is distinct from r.full_name;

select 'ok' as step_42_roster_name_sync;
