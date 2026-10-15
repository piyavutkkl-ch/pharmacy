#!/usr/bin/env python3
"""สร้าง supabase/57_drug_monographs.sql จาก tools/nlem/nlem2569.json (ผลของ parse.py) — รันซ้ำได้ ไม่ทับรายการที่ผู้ดูแลแก้แล้ว"""
import json, pathlib, re

root = pathlib.Path(__file__).resolve().parents[2]
drugs = json.loads((root / 'tools/nlem/nlem2569.json').read_text(encoding='utf-8'))
rows = [{'ref': f"2569:{d['sub_code']}:{d['no']}", 'group_no': d['group_no'], 'group_name': d['group'], 'sub_code': d['sub_code'],
         'sub_name': d['sub'], 'no': d['no'], 'name': d['name'], 'flags': d['flags'], 'forms': d['forms'], 'sections': d['sections'],
         'page': d['page'], 'sort': i + 1} for i, d in enumerate(drugs)]
data = '[\n' + ',\n'.join(json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in rows) + '\n]'
assert '$nlem$' not in data
assert not re.search(r'drop\s+(table|schema|database|column)|truncate\s|delete\s+from', data, re.I)

sql = f"""-- =====================================================================
--  ขั้นที่ 57: ข้อมูลยา (monograph) จากบัญชียาหลักแห่งชาติ พ.ศ. ๒๕๖๙ · รันซ้ำได้ · เพิ่มอย่างเดียว
--   ที่มา: ประกาศคณะกรรมการพัฒนาระบบยาแห่งชาติ เรื่อง บัญชียาหลักแห่งชาติ พ.ศ. ๒๕๖๙
--          ราชกิจจานุเบกษา เล่ม ๑๔๓ ตอนพิเศษ ๘๕ ง (๓๐ มี.ค. ๒๕๖๙) https://ratchakitcha.soc.go.th/documents/111371.pdf
--   ภาคผนวก 1 บัญชียาสำหรับโรงพยาบาลฯ: กลุ่มยา · รูปแบบยา · บัญชี (b/s/ex/R1/R2) · เงื่อนไข · คำเตือนและข้อควรระวัง · คำแนะนำ · หมายเหตุ
--   ไฟล์นี้สร้างด้วย tools/nlem/build_sql.py (อย่าแก้มือ) · ข้อมูลสาธารณะ ใครก็อ่านได้ · ผู้ดูแลแก้ได้
--   ใส่ข้อมูลแบบ on conflict do nothing → รันซ้ำไม่ทับรายการที่ผู้ดูแลแก้แล้ว
-- =====================================================================

create table if not exists public.drug_monographs (
  id          int generated always as identity primary key,
  ref         text not null unique,                 -- <ปีบัญชี>:<กลุ่มย่อย>:<ลำดับ> เช่น 2569:1.3:7
  group_no    smallint not null,
  group_name  text not null,
  sub_code    text not null,
  sub_name    text not null default '',
  no          smallint not null,
  name        text not null check (char_length(btrim(name)) between 1 and 300),
  flags       text[] not null default '{{}}',          -- ยากำพร้า / ยาเสพติดให้โทษ / วัตถุออกฤทธิ์ฯ
  forms       jsonb not null default '[]' check (jsonb_typeof(forms) = 'array'),      -- [{{form, acct}}]
  sections    jsonb not null default '[]' check (jsonb_typeof(sections) = 'array'),   -- [{{title, body: [ย่อหน้า]}}]
  page        smallint,                              -- หน้าใน PDF ต้นฉบับ
  sort        int not null default 0,
  updated_at  timestamptz not null default now()
);
create index if not exists drug_monographs_name_idx on public.drug_monographs (lower(name));

alter table public.drug_monographs enable row level security;
drop policy if exists dmono_read on public.drug_monographs;
drop policy if exists dmono_admin on public.drug_monographs;
create policy dmono_read on public.drug_monographs for select using (true);
create policy dmono_admin on public.drug_monographs for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.drug_monographs from anon, authenticated;
grant select on public.drug_monographs to anon, authenticated;
grant insert, update, delete on public.drug_monographs to authenticated;
grant all on public.drug_monographs to service_role;

insert into public.drug_monographs (ref, group_no, group_name, sub_code, sub_name, no, name, flags, forms, sections, page, sort)
select x.ref, x.group_no, x.group_name, x.sub_code, x.sub_name, x.no, x.name, x.flags, x.forms, x.sections, x.page, x.sort
  from jsonb_to_recordset($nlem${data}$nlem$::jsonb)
    as x(ref text, group_no smallint, group_name text, sub_code text, sub_name text, no smallint, name text,
         flags text[], forms jsonb, sections jsonb, page smallint, sort int)
on conflict (ref) do nothing;

select 'ok' as step_57_drug_monographs, count(*) as drugs from public.drug_monographs;
"""
(root / 'supabase/57_drug_monographs.sql').write_text(sql, encoding='utf-8')
print('rows', len(rows))
