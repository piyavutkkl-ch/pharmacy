-- =====================================================================
--  ขั้นที่ 82: รหัสยาในเว็บแอป แยกตามฐานข้อมูล · รันซ้ำได้ · เพิ่มอย่างเดียว (ไม่ลบข้อมูล)
--   รูปแบบ <ตัวย่อฐานข้อมูล>-<อักษรแรกของชื่อยา>-<ลำดับ> เช่น SHPS-A-01 (Albendazole ในบัญชียา รพ.สต.) · SHPS-I-01 (Ibuprofen)
--   SHPS = บัญชียา รพ.สต. · OUT = บัญชียานอก รพ.สต. · NLEM = บัญชียาหลักแห่งชาติ · FDA = ฉลาก openFDA · DDI = DDInter · DOSE = ข้อมูลคำนวณขนาดยา
--   อักษรแรก = ตัวอังกฤษตัวแรกของชื่อ (ชื่อไทยใช้ชื่ออังกฤษในวงเล็บ · ไม่มีตัวอังกฤษ = X) · ลำดับนับต่อในฐานข้อมูล+อักษรเดียวกัน
--   ระบบใส่เองตอนเพิ่ม (trigger) และไม่เปลี่ยนเมื่อแก้ชื่อ · ยาที่ย้ายระหว่างบัญชียา รพ.สต. ⇄ ยานอก ได้รหัสใหม่ของบัญชีนั้น
--   บัญชียาหลัก: ชื่อยาเดียวกัน (อยู่หลายกลุ่มยา) ใช้รหัสเดียวกัน
-- =====================================================================

alter table public.local_drugs add column if not exists web_code text;
alter table public.drug_monographs add column if not exists web_code text;
alter table public.drug_fda_labels add column if not exists web_code text;
alter table public.ddi_drugs add column if not exists web_code text;
alter table public.dose_drugs add column if not exists web_code text;
create unique index if not exists local_drugs_web_code on public.local_drugs (web_code);
create index if not exists drug_monographs_web_code on public.drug_monographs (web_code);
create unique index if not exists drug_fda_labels_web_code on public.drug_fda_labels (web_code);
create unique index if not exists ddi_drugs_web_code on public.ddi_drugs (web_code);
create unique index if not exists dose_drugs_web_code on public.dose_drugs (web_code);

/** อักษรแรกของชื่อยา: ตัวอังกฤษตัวแรกนอกวงเล็บ → ในวงเล็บ → X */
create or replace function public.drug_code_letter(p_name text)
returns text language sql immutable
set search_path = ''
as $$
  select coalesce(upper(substring(regexp_replace(coalesce(p_name, ''), '\([^()]*\)', ' ', 'g') from '[A-Za-z]')),
                  upper(substring(coalesce(p_name, '') from '[A-Za-z]')), 'X')
$$;

/** รหัสถัดไปของ <ตัวย่อ>-<อักษร> ในตาราง (นับต่อจากเลขสูงสุดที่มี) */
create or replace function public.next_drug_code(p_table text, p_prefix text, p_letter text)
returns text language plpgsql
set search_path = ''
as $$
declare n int;
begin
  if p_table not in ('local_drugs', 'drug_monographs', 'drug_fda_labels', 'ddi_drugs', 'dose_drugs') then raise exception 'ตารางไม่ถูกต้อง'; end if;
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
    when 'drug_monographs' then 'NLEM' when 'drug_fda_labels' then 'FDA' when 'ddi_drugs' then 'DDI' else 'DOSE' end;
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

drop trigger if exists local_drugs_code on public.local_drugs;
create trigger local_drugs_code before insert or update on public.local_drugs for each row execute function public.before_drug_code();
drop trigger if exists drug_monographs_code on public.drug_monographs;
create trigger drug_monographs_code before insert or update on public.drug_monographs for each row execute function public.before_drug_code();
drop trigger if exists drug_fda_labels_code on public.drug_fda_labels;
create trigger drug_fda_labels_code before insert or update on public.drug_fda_labels for each row execute function public.before_drug_code();
drop trigger if exists ddi_drugs_code on public.ddi_drugs;
create trigger ddi_drugs_code before insert or update on public.ddi_drugs for each row execute function public.before_drug_code();
drop trigger if exists dose_drugs_code on public.dose_drugs;
create trigger dose_drugs_code before insert or update on public.dose_drugs for each row execute function public.before_drug_code();

-- ข้อมูลเดิม: ใส่รหัสตามลำดับที่แสดง (ยาที่ยังไม่มีรหัสเท่านั้น · รันซ้ำไม่เปลี่ยนรหัสเดิม)
--   update ทีละแถว → trigger ด้านบนคำนวณรหัสให้ (web_code = null → ได้รหัสใหม่)
do $$
declare r record;
begin
  for r in select id from public.local_drugs where web_code is null order by outside, sort, id loop
    update public.local_drugs set web_code = null where id = r.id;
  end loop;
  for r in select id from public.drug_monographs where web_code is null order by sort, id loop
    update public.drug_monographs set web_code = null where id = r.id;
  end loop;
  for r in select id from public.drug_fda_labels where web_code is null order by generic, id loop
    update public.drug_fda_labels set web_code = null where id = r.id;
  end loop;
  for r in select id from public.ddi_drugs where web_code is null order by lower(name), id loop
    update public.ddi_drugs set web_code = null where id = r.id;
  end loop;
  for r in select id from public.dose_drugs where web_code is null order by sort, id loop
    update public.dose_drugs set web_code = null where id = r.id;
  end loop;
end $$;

select 'ok' as step_82_drug_codes,
  (select web_code from public.local_drugs where web_code like 'SHPS-A-%' order by web_code limit 1) as first_shps_a,
  (select count(*) from public.local_drugs where web_code is null) + (select count(*) from public.dose_drugs where web_code is null) as missing;
