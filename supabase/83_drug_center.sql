-- =====================================================================
--  ขั้นที่ 83: ศูนย์ข้อมูลยา (ผู้ดูแล › ข้อมูลยา) · รันซ้ำได้ · เพิ่มอย่างเดียว (ไม่ลบข้อมูล)
--   local_drugs.link_na = ส่วนที่ "ไม่ใช้กับยานี้" (ผู้ดูแลกำหนด) → ไม่นับเป็นข้อมูลขาด เช่น ยาทาไม่ต้องมีขนาดยาคำนวณ
--     ค่า: str (ความแรง) · dose (ขนาดยา) · nlem (บัญชียาหลัก) · fda (ฉลาก) · ddi (DDInter)
--   drug_link_rejects = คู่ที่ระบบเสนอแล้วผู้ดูแลกด "✗ ไม่ใช่" → ไม่เสนอคู่นั้นอีก · ผู้ดูแลเท่านั้น
-- =====================================================================

alter table public.local_drugs add column if not exists link_na text[] not null default '{}';
alter table public.local_drugs drop constraint if exists local_drugs_link_na_check;
alter table public.local_drugs add constraint local_drugs_link_na_check
  check (link_na <@ array['str', 'dose', 'nlem', 'fda', 'ddi']::text[]);

create table if not exists public.drug_link_rejects (
  id          bigint generated always as identity primary key,
  local_id    int not null references public.local_drugs(id) on delete cascade,
  kind        text not null check (kind in ('dose', 'nlem', 'fda', 'ddi')),
  target      text not null check (char_length(target) between 1 and 200),
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (local_id, kind, target)
);
alter table public.drug_link_rejects enable row level security;
drop policy if exists dlr_admin on public.drug_link_rejects;
create policy dlr_admin on public.drug_link_rejects for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.drug_link_rejects from anon, authenticated;
grant select, insert, delete on public.drug_link_rejects to authenticated;
grant all on public.drug_link_rejects to service_role;

select 'ok' as step_83_drug_center;
