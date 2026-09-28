-- =====================================================================
--  ขั้นที่ 21: บริการจัดส่งยาถึงบ้าน (หน้าหลัก) — โปสเตอร์ + ข้อความแนะนำ + สถิติการจัดส่ง — รันต่อจาก 21 · รันซ้ำได้ · เพิ่มอย่างเดียว
--   ทุกคนอ่านได้ (ไม่มีข้อมูลรายบุคคล) · ผู้ดูแลแก้ได้ · รูปโปสเตอร์อยู่ใน public-images/delivery/…
-- =====================================================================

create table if not exists public.delivery_posters (
  id          bigint generated always as identity primary key,
  title       text check (title is null or char_length(title) <= 200),
  image_path  text not null,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);

-- ข้อความหน้าเว็บที่ผู้ดูแลแก้ได้ (key เช่น 'delivery_info')
create table if not exists public.site_texts (
  key         text primary key check (key ~ '^[a-z_]{1,40}$'),
  body        text not null default '' check (char_length(body) <= 5000),
  updated_at  timestamptz not null default now()
);
insert into public.site_texts (key, body) values ('delivery_info',
  'บริการจัดส่งยาถึงบ้านสำหรับผู้ป่วยโรคเรื้อรังที่อาการคงที่ ไม่ต้องเดินทางมารับยาที่โรงพยาบาล' || chr(10) ||
  'ติดต่อขอรับบริการได้ที่ รพ.สต. ใกล้บ้าน หรือห้องยาโรงพยาบาล')
on conflict (key) do nothing;

-- สถิติการจัดส่ง (ผู้ดูแลกรอกรายปีงบ × รพ.สต.)
create table if not exists public.delivery_stats (
  fiscal_year  int not null check (fiscal_year between 2560 and 2700),
  unit_id      smallint not null references public.units(id),
  deliveries   int not null default 0 check (deliveries >= 0),
  patients     int not null default 0 check (patients >= 0),
  updated_at   timestamptz not null default now(),
  primary key (fiscal_year, unit_id)
);

alter table public.delivery_posters enable row level security;
alter table public.site_texts enable row level security;
alter table public.delivery_stats enable row level security;
drop policy if exists dposter_read on public.delivery_posters;
drop policy if exists dposter_admin on public.delivery_posters;
drop policy if exists stext_read on public.site_texts;
drop policy if exists stext_admin on public.site_texts;
drop policy if exists dstat_read on public.delivery_stats;
drop policy if exists dstat_admin on public.delivery_stats;
create policy dposter_read on public.delivery_posters for select using (true);
create policy dposter_admin on public.delivery_posters for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy stext_read on public.site_texts for select using (true);
create policy stext_admin on public.site_texts for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy dstat_read on public.delivery_stats for select using (true);
create policy dstat_admin on public.delivery_stats for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.delivery_posters, public.site_texts, public.delivery_stats to anon;
grant select, insert, update, delete on public.delivery_posters, public.site_texts, public.delivery_stats to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant all on public.delivery_posters, public.site_texts, public.delivery_stats to service_role;

select 'ok' as step_21_delivery;
