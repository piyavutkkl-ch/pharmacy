-- =====================================================================
--  ขั้นที่ 104: โพสต์ประชาสัมพันธ์บริการจัดส่งยาถึงบ้าน (delivery_posts) — รันซ้ำได้ · เพิ่มอย่างเดียว
--   แทนส่วนโปสเตอร์เดิมให้เป็นโพสต์คล้ายข่าวประชาสัมพันธ์ (หัวข้อ · รูปหลายรูป · เนื้อหา · แนบลิงก์/วิดีโอ)
--   ย้ายโปสเตอร์เดิมจาก delivery_posters มาเป็นโพสต์เริ่มต้นอัตโนมัติ (ไม่ลบตารางเดิม)
--   ทุกคนอ่านได้ · ผู้ดูแลเพิ่ม/แก้ไข/ลบได้ · บังคับลิงก์ต้องขึ้นต้นด้วย https:// (กัน XSS)
-- =====================================================================

create or replace function public.delivery_links_ok(p jsonb)
returns boolean language plpgsql immutable as $$
declare
  el jsonb;
  u text;
  lbl text;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return false; end if;
  if jsonb_array_length(p) > 10 then return false; end if;
  for el in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(el) <> 'object' then return false; end if;
    u := el->>'url';
    lbl := coalesce(el->>'label', '');
    if u is null or char_length(u) > 1000 or u !~* '^https://' then return false; end if;
    if char_length(lbl) > 200 then return false; end if;
  end loop;
  return true;
end $$;

create table if not exists public.delivery_posts (
  id                  bigint generated always as identity primary key,
  title               text not null check (char_length(trim(title)) between 1 and 200),
  body                text not null default '' check (char_length(body) <= 5000),
  image_path          text,
  gallery             text[] not null default '{}' check (cardinality(gallery) <= 6),
  links               jsonb not null default '[]'::jsonb check (public.delivery_links_ok(links)),
  sort                int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  migrated_poster_id  bigint unique
);

-- ย้ายโปสเตอร์เดิมมาเป็นโพสต์เริ่มต้น (รันซ้ำได้ ไม่ซ้ำซ้อน)
insert into public.delivery_posts (title, body, image_path, sort, created_at, updated_at, migrated_poster_id)
select
  coalesce(nullif(trim(p.title), ''), 'บริการจัดส่งยาถึงบ้าน'),
  '',
  p.image_path,
  p.sort,
  p.created_at,
  p.created_at,
  p.id
from public.delivery_posters p
on conflict (migrated_poster_id) do nothing;

alter table public.delivery_posts enable row level security;
drop policy if exists dpost_read on public.delivery_posts;
drop policy if exists dpost_admin on public.delivery_posts;
create policy dpost_read on public.delivery_posts for select using (true);
create policy dpost_admin on public.delivery_posts for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.delivery_posts to anon;
grant select, insert, update, delete on public.delivery_posts to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant all on public.delivery_posts to service_role;

select 'ok' as step_104_delivery_posts;
