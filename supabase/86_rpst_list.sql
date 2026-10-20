-- =====================================================================
--  ขั้นที่ 86: ฐานข้อมูลบัญชียา รพ.สต. แยกจาก "ยาในเว็บแอพ" · รันซ้ำได้ · เพิ่มอย่างเดียว (ไม่ลบข้อมูล)
--   rpst_list = บัญชียา รพ.สต. (รหัสยาโรงพยาบาล · ชื่อ · หมวด · ขนาดบรรจุ · หน่วย) เป็นแหล่งข้อมูลขั้นที่ 2 เหมือน MIMS / ฉลาก / บัญชียาหลัก
--   ยาในเว็บแอพ = local_drugs (ขั้นที่ 1: ชื่อ · รูปแบบ · ความแรง) ผูกกับบัญชีด้วยรหัสเดียวกัน (local_drugs.code = rpst_list.code)
--     ไม่มีรหัสในบัญชี = ยานอก รพ.สต. (local_drugs.outside)
--   ข้อมูลเดิม: ยา รพ.สต. ทุกตัวที่มีรหัส → ใส่ในบัญชีให้ (ไม่ทับรายการที่มีอยู่แล้ว)
--   ผู้ดูแลอ่าน/แก้ได้เท่านั้น (ชื่อยาสาธารณะดูได้จาก local_drugs อยู่แล้ว)
--   dose_drugs.spare_inds = ข้อบ่งใช้จากแหล่งข้อมูลที่เภสัชกรยังไม่เลือกใช้ (เก็บไว้ ไม่ใช้คำนวณ)
-- =====================================================================

create table if not exists public.rpst_list (
  id          bigint generated always as identity primary key,
  code        text not null unique check (char_length(btrim(code)) between 1 and 30),
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  category    text not null default 'อื่น ๆ' check (char_length(category) between 1 and 100),
  pack_size   text not null default '' check (char_length(pack_size) <= 40),
  unit        text not null default '' check (char_length(unit) <= 40),
  sort        int not null default 0,
  in_list     boolean not null default true,   -- false = ไม่อยู่ในไฟล์บัญชีล่าสุดที่นำเข้า (เก็บไว้ ไม่ลบ)
  updated_at  timestamptz not null default now()
);
drop trigger if exists rpst_list_touch on public.rpst_list;
create trigger rpst_list_touch before update on public.rpst_list for each row execute function public.touch_updated_at();
alter table public.rpst_list enable row level security;
drop policy if exists rpst_admin on public.rpst_list;
create policy rpst_admin on public.rpst_list for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.rpst_list from anon, authenticated;
grant select, insert, update, delete on public.rpst_list to authenticated;
grant all on public.rpst_list to service_role;

insert into public.rpst_list (code, name, category, pack_size, unit, sort)
select l.code, l.name, l.category, l.pack_size, l.unit, l.sort
  from public.local_drugs l
 where l.code is not null and not l.outside
on conflict (code) do nothing;

alter table public.dose_drugs add column if not exists spare_inds jsonb not null default '[]'
  check (jsonb_typeof(spare_inds) = 'array' and jsonb_array_length(spare_inds) <= 60);

select 'ok' as step_86_rpst_list, (select count(*) from public.rpst_list) as rpst_rows;
