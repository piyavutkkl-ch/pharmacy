-- =====================================================================
--  ขั้นที่ 85: ฐานข้อมูล MIMS + ขนาดยาแบบคงที่ · รันซ้ำได้ · เพิ่มอย่างเดียว (ไม่ลบข้อมูล)
--   drug_mims = ข้อมูลขนาดยาจาก MIMS Thailand ที่ผู้ดูแลนำเข้า (ไฟล์ mims_doses.json จาก Claude in Chrome · หน้า ข้อมูลยา › เครื่องมือฐานข้อมูล › ฐานข้อมูล MIMS)
--     MIMS เป็นข้อมูลสำหรับสมาชิก → อ่าน/แก้ได้เฉพาะผู้ดูแล (ไม่เปิดให้ประชาชน/เจ้าหน้าที่) · ขึ้นหน้าคำนวณได้เฉพาะตัวเลขขนาดยาที่เภสัชกรอนุมัติ + ลิงก์อ้างอิง
--     indications = ข้อบ่งใช้รูปแบบเดียวกับ dose_drugs.indications (+ skip = เหตุผลที่ยังคำนวณไม่ได้ เก็บไว้อ้างอิง)
--   local_drugs.mims_id = ยา รพ.สต./ยานอก ผูกกับข้อมูล MIMS · link_na / drug_link_rejects รับส่วน 'mims' เพิ่ม
--   รหัสในเว็บ MIMS-<อักษร>-<ลำดับ> (trigger เดียวกับ 82)
--   dose_inds_problem: ข้อบ่งใช้ fixed = true → min/max/cap/cap_day เป็นขนาดคงที่ (มก. หรือ mcg) ไม่คูณน้ำหนัก · note = หมายเหตุ (≤ 500)
-- =====================================================================

create table if not exists public.drug_mims (
  id          bigint generated always as identity primary key,
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  url         text check (url is null or (url ~ '^https://(www\.)?mims\.com/' and char_length(url) <= 300)),
  label       text not null default 'MIMS Thailand' check (char_length(label) between 1 and 120),
  indications jsonb not null default '[]' check (jsonb_typeof(indications) = 'array' and jsonb_array_length(indications) <= 40),
  note        text check (note is null or char_length(note) <= 2000),
  web_code    text,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists drug_mims_url on public.drug_mims (url) where url is not null;
create unique index if not exists drug_mims_web_code on public.drug_mims (web_code);
drop trigger if exists drug_mims_touch on public.drug_mims;
create trigger drug_mims_touch before update on public.drug_mims for each row execute function public.touch_updated_at();
alter table public.drug_mims enable row level security;
drop policy if exists mims_admin on public.drug_mims;
create policy mims_admin on public.drug_mims for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.drug_mims from anon, authenticated;
grant select, insert, update, delete on public.drug_mims to authenticated;
grant all on public.drug_mims to service_role;

alter table public.local_drugs add column if not exists mims_id bigint references public.drug_mims(id) on delete set null;

alter table public.local_drugs drop constraint if exists local_drugs_link_na_check;
alter table public.local_drugs add constraint local_drugs_link_na_check
  check (link_na <@ array['str', 'dose', 'nlem', 'fda', 'ddi', 'mims']::text[]);
alter table public.drug_link_rejects drop constraint if exists drug_link_rejects_kind_check;
alter table public.drug_link_rejects add constraint drug_link_rejects_kind_check
  check (kind in ('dose', 'nlem', 'fda', 'ddi', 'mims'));

-- รหัสยาในเว็บ (82) รองรับ drug_mims
create or replace function public.next_drug_code(p_table text, p_prefix text, p_letter text)
returns text language plpgsql
set search_path = ''
as $$
declare n int;
begin
  if p_table not in ('local_drugs', 'drug_monographs', 'drug_fda_labels', 'ddi_drugs', 'dose_drugs', 'drug_mims') then raise exception 'ตารางไม่ถูกต้อง'; end if;
  execute format('select coalesce(max((regexp_match(web_code, ''-(\d+)$''))[1]::int), 0) + 1 from public.%I where web_code like $1', p_table)
    into n using p_prefix || '-' || p_letter || '-%';
  return p_prefix || '-' || p_letter || '-' || lpad(n::text, 2, '0');
end $$;
revoke execute on function public.next_drug_code(text, text, text) from public, anon, authenticated;

create or replace function public.before_drug_code()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  j jsonb := to_jsonb(new);
  pre text := case tg_table_name
    when 'local_drugs' then case when (j ->> 'outside')::boolean then 'OUT' else 'SHPS' end
    when 'drug_monographs' then 'NLEM' when 'drug_fda_labels' then 'FDA' when 'ddi_drugs' then 'DDI' when 'drug_mims' then 'MIMS' else 'DOSE' end;
  nm text := case tg_table_name when 'drug_fda_labels' then j ->> 'generic' else j ->> 'name' end;
  same text;
begin
  if tg_op = 'UPDATE' and old.web_code is not null and split_part(old.web_code, '-', 1) = pre then
    new.web_code := old.web_code;   -- รหัสไม่เปลี่ยนเมื่อแก้ไข (แก้รหัสเองไม่ได้)
    return new;
  end if;
  if tg_table_name = 'drug_monographs' then
    select m.web_code into same from public.drug_monographs m
     where lower(m.name) = lower(nm) and m.web_code like 'NLEM-%' and m.id is distinct from (j ->> 'id')::int limit 1;
    if same is not null then new.web_code := same; return new; end if;
  end if;
  new.web_code := public.next_drug_code(tg_table_name, pre, public.drug_code_letter(nm));
  return new;
end $$;
revoke execute on function public.before_drug_code() from public, anon, authenticated;
drop trigger if exists drug_mims_code on public.drug_mims;
create trigger drug_mims_code before insert or update on public.drug_mims for each row execute function public.before_drug_code();

-- ข้อบ่งใช้: ขนาดคงที่ (fixed) + หมายเหตุ (note) · กฎเดียวกับ indsProblem ใน admin-settings.js
create or replace function public.dose_inds_problem(p jsonb)
returns text language plpgsql immutable
set search_path = ''
as $$
declare e jsonb; t jsonb; n int := 0; w text;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) = 0 then return 'ต้องมีข้อบ่งใช้อย่างน้อย 1 ข้อ'; end if;
  for e in select x from jsonb_array_elements(p) x loop
    n := n + 1; w := 'ข้อบ่งใช้ ' || n || ': ';
    if jsonb_typeof(e) <> 'object' then return w || 'รูปแบบข้อมูลไม่ถูกต้อง'; end if;
    if btrim(coalesce(e->>'name', '')) = '' then return w || 'ยังไม่มีชื่อข้อบ่งใช้'; end if;
    if coalesce(e->>'per', '') not in ('dose', 'day') then return w || 'ต้องระบุว่าเป็นขนาดต่อครั้งหรือต่อวัน'; end if;
    if coalesce(jsonb_typeof(e->'min'), '') <> 'number' or coalesce(jsonb_typeof(e->'max'), '') <> 'number' then return w || 'ต้องมีขนาดยาต่ำสุดและสูงสุดเป็นตัวเลข'; end if;
    if (e->>'min')::numeric < 0 then return w || 'ขนาดยาต้องไม่ติดลบ'; end if;
    if (e->>'max')::numeric <= 0 then return w || 'ขนาดยาสูงสุดต้องมากกว่า 0'; end if;
    if (e->>'max')::numeric < (e->>'min')::numeric then return w || 'ขนาดสูงสุดต้องไม่น้อยกว่าขนาดต่ำสุด'; end if;
    if (e->>'max')::numeric * (case when e->>'unit' = 'mcg' then 0.001 else 1 end) > 10000 then
      return w || case when e->>'fixed' = 'true' then 'ขนาดยาสูงเกินกว่าจะเป็นไปได้ (เกิน 10,000 มก.) · ตรวจหน่วยและจุดทศนิยม'
                       else 'ขนาดยาสูงเกินกว่าจะเป็นไปได้ (เกิน 10,000 มก./กก.) · ตรวจหน่วยและจุดทศนิยม' end;
    end if;
    if e->>'per' = 'day' and not (coalesce(jsonb_typeof(e->'times'), '') = 'number' and (e->>'times')::numeric in (1,2,3,4,5,6,7,8,9,10,11,12)) then
      return w || 'ขนาดต่อวันต้องระบุจำนวนครั้งที่แบ่งให้ (1–12 ครั้ง)';
    end if;
    if coalesce(jsonb_typeof(e->'times_alt'), 'null') not in ('null', 'array') then return w || 'จำนวนครั้งแบบอื่นไม่ถูกต้อง'; end if;
    if jsonb_typeof(e->'times_alt') = 'array' then
      for t in select y from jsonb_array_elements(e->'times_alt') y loop
        if not (jsonb_typeof(t) = 'number' and t::text::numeric in (1,2,3,4,5,6,7,8,9,10,11,12)) then return w || 'จำนวนครั้งแบบอื่นต้องเป็น 1–12'; end if;
      end loop;
    end if;
    if coalesce(jsonb_typeof(e->'cap'), 'null') <> 'null' and not (jsonb_typeof(e->'cap') = 'number' and (e->>'cap')::numeric > 0) then
      return w || 'ขนาดสูงสุดต่อครั้งต้องเป็นตัวเลขมากกว่า 0';
    end if;
    if coalesce(e->>'unit', 'mg') not in ('mg', 'mcg') then return w || 'หน่วยขนาดยาต้องเป็น มก. หรือ mcg'; end if;
    if coalesce(jsonb_typeof(e->'cap_day'), 'null') <> 'null' and not (jsonb_typeof(e->'cap_day') = 'number' and (e->>'cap_day')::numeric > 0) then
      return w || 'ขนาดสูงสุดต่อวันต้องเป็นตัวเลขมากกว่า 0';
    end if;
    if coalesce(jsonb_typeof(e->'fixed'), 'null') not in ('null', 'boolean') then return w || 'ชนิดขนาดยา (คงที่/ตามน้ำหนัก) ไม่ถูกต้อง'; end if;
    if coalesce(jsonb_typeof(e->'note'), 'null') not in ('null', 'string') or char_length(coalesce(e->>'note', '')) > 500 then return w || 'หมายเหตุต้องเป็นข้อความไม่เกิน 500 ตัวอักษร'; end if;
    if (coalesce(jsonb_typeof(e->'age_min'), 'null') <> 'null' and not (jsonb_typeof(e->'age_min') = 'number' and (e->>'age_min')::numeric between 0 and 120))
       or (coalesce(jsonb_typeof(e->'age_max'), 'null') <> 'null' and not (jsonb_typeof(e->'age_max') = 'number' and (e->>'age_max')::numeric between 0 and 120)) then
      return w || 'ช่วงอายุต้องเป็นตัวเลข 0–120 ปี';
    end if;
    if jsonb_typeof(e->'age_min') = 'number' and jsonb_typeof(e->'age_max') = 'number' and (e->>'age_max')::numeric <= (e->>'age_min')::numeric then
      return w || 'อายุสูงสุดต้องมากกว่าอายุต่ำสุด';
    end if;
  end loop;
  return null;
end $$;
grant execute on function public.dose_inds_problem(jsonb) to anon, authenticated;

select 'ok' as step_85_mims, (select count(*) from public.drug_mims) as mims_rows;
