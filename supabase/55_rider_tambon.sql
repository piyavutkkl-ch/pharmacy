-- =====================================================================
--  ขั้นที่ 55: ผลงาน Health Rider แยกตามตำบล (ตามหัวข้อไฟล์ "ประวัติรายการจัดส่งยา") · รันซ้ำได้ · เพิ่มอย่างเดียว
--   นับเฉพาะรายการบริการขนส่ง "rider": ส่งสำเร็จ (ครั้ง) · ผู้รับบริการ (คน) · ยกเลิก (ครั้ง) · ส่งฟรี (ครั้ง) ราย ปีงบ × ตำบล
--   ผู้ดูแลกรอกเอง หรือนำเข้าจากไฟล์ (อ่านในเครื่อง · เก็บเฉพาะตัวเลขรวม ไม่มีข้อมูลรายบุคคล) · ทุกคนอ่านได้
--   ตาราง rider_stats เดิม (ราย รพ.สต.) ยังอยู่ — หน้าหลักใช้แสดงปีงบที่ยังไม่มีข้อมูลรายตำบล
-- =====================================================================

create table if not exists public.rider_tambon_stats (
  fiscal_year  int not null check (fiscal_year between 2560 and 2700),
  tambon       text not null check (char_length(btrim(tambon)) between 1 and 60 and tambon !~ '[0-9]{6,}'),
  delivered    int not null default 0 check (delivered >= 0),
  clients      int not null default 0 check (clients >= 0),
  cancelled    int not null default 0 check (cancelled >= 0),
  free         int not null default 0 check (free >= 0),
  updated_at   timestamptz not null default now(),
  primary key (fiscal_year, tambon)
);
alter table public.rider_tambon_stats enable row level security;
drop policy if exists rtam_read on public.rider_tambon_stats;
drop policy if exists rtam_admin on public.rider_tambon_stats;
create policy rtam_read on public.rider_tambon_stats for select using (true);
create policy rtam_admin on public.rider_tambon_stats for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.rider_tambon_stats from anon, authenticated;
grant select on public.rider_tambon_stats to anon, authenticated;
grant insert, update, delete on public.rider_tambon_stats to authenticated;
grant all on public.rider_tambon_stats to service_role;

select 'ok' as step_55_rider_tambon;
