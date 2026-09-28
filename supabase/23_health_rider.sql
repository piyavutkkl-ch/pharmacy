-- =====================================================================
--  ขั้นที่ 22: Health Rider (หน้าหลัก) — แสดงผลงาน: ข้อความแนะนำ + ตัวเลขผลงานรายปีงบ × รพ.สต. — รันต่อจาก 22 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   ทุกคนอ่านได้ (ตัวเลขรวม ไม่มีข้อมูลรายบุคคล)
--   ผู้ดูแลแก้ได้ทุก รพ.สต. · เจ้าหน้าที่ รพ.สต. แก้ได้เฉพาะหน่วยตัวเอง · ข้อความแนะนำ = site_texts key 'rider_info' (ผู้ดูแล)
-- =====================================================================

create table if not exists public.rider_stats (
  fiscal_year  int not null check (fiscal_year between 2560 and 2700),
  unit_id      smallint not null references public.units(id),
  trips        int not null default 0 check (trips >= 0),
  clients      int not null default 0 check (clients >= 0),
  updated_at   timestamptz not null default now(),
  primary key (fiscal_year, unit_id)
);

insert into public.site_texts (key, body) values ('rider_info',
  'Health Rider ทีมเจ้าหน้าที่และจิตอาสา รพ.สต. นำยาและเวชภัณฑ์ไปส่งถึงบ้านผู้ป่วยที่เดินทางลำบาก' || chr(10) ||
  'ผลงานการให้บริการของแต่ละ รพ.สต. แสดงด้านล่าง')
on conflict (key) do nothing;

alter table public.rider_stats enable row level security;
drop policy if exists rstat_read on public.rider_stats;
drop policy if exists rstat_write on public.rider_stats;
create policy rstat_read on public.rider_stats for select using (true);
create policy rstat_write on public.rider_stats for all to authenticated
  using (public.is_admin() or public.is_staff_of(unit_id))
  with check (public.is_admin() or public.is_staff_of(unit_id));

grant select on public.rider_stats to anon;
grant select, insert, update, delete on public.rider_stats to authenticated;
grant all on public.rider_stats to service_role;

select 'ok' as step_22_health_rider;
