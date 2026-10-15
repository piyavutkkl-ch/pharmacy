#!/usr/bin/env python3
"""รายการยา รพ.สต. อำเภอควนกาหลง (tools/nlem/rpst_drugs.txt จากเจ้าของเว็บ) → supabase/58_local_drugs.sql
   ผูกยาแต่ละรายการกับ monograph บัญชียาหลักแห่งชาติ (drug_monographs.ref) ตามตาราง LINK ด้านล่าง (ชื่อในบัญชี · ตรวจด้วยคน)
   รายการที่ไม่แน่ใจ = ไม่ผูก (ผู้ดูแลผูกเองในหน้า ตั้งค่า › ฐานข้อมูลยา)"""
import json, pathlib, re

root = pathlib.Path(__file__).resolve().parents[2]
nlem = json.loads((root / 'tools/nlem/nlem2569.json').read_text(encoding='utf-8'))
refs = {}
for d in nlem:
    refs.setdefault(d['name'], []).append(f"2569:{d['sub_code']}:{d['no']}")

# รหัสยาใน รพ. → ชื่อยาในบัญชียาหลักแห่งชาติ
LINK = {
    '1010042': ['Albendazole'], '1600050': ['Amitriptyline hydrochloride'], '1010110': ['Amoxicillin trihydrate'],
    '1900160': ['Calcium carbonate'], '1010280': ['Sulfamethoxazole + Trimethoprim (Co-trimoxazole)'],
    '1700140': ['Chlorpheniramine maleate (Chlorphenamine maleate)'], '1050130': ['Cyproheptadine hydrochloride'],
    '1700090': ['Dextromethorphan hydrobromide'], '1500070': ['Diclofenac sodium'], '1010190': ['Dicloxacillin sodium'],
    '1100091': ['Dicycloverine hydrochloride (Dicyclomine hydrochloride)'], '1050210': ['Dimenhydrinate'], '1100120': ['Domperidone'],
    '1900120': ['Ferrous fumarate'], '1900080': ['Folic acid'], '1700132': ['Glyceryl guaiacolate'], '1700170': ['Hydroxyzine hydrochloride'],
    '1500040': ['Ibuprofen'], '1200070': ['Lynestrenol'], '1010011': ['Metronidazole'], '1900020': ['Multivitamins'], '1500051': ['Naproxen'],
    '1010270': ['Norfloxacin'], '1050030': ['Paracetamol (Acetaminophen)'], '1050042': ['Paracetamol (Acetaminophen)'],
    '1010071': ['Roxithromycin'], '1700030': ['Salbutamol sulfate'], '1100070': ['Simeticone (Simethicone)'],
    '1900150': ['Ferrous salt + Folic acid + Potassium Iodide'], '1900030': ['Vitamin B complex'], '1900050': ['Vitamin C'],
    '1100180': ['Oral rehydration salts (ORS)'],
    '1010041': ['Albendazole'], '1010120': ['Amoxicillin trihydrate'], '1010290': ['Sulfamethoxazole + Trimethoprim (Co-trimoxazole)'],
    '1700150': ['Chlorpheniramine maleate (Chlorphenamine maleate)'], '1010191': ['Dicloxacillin sodium'], '1100130': ['Domperidone'],
    '1010080': ['Erythromycin estolate', 'Erythromycin stearate or succinate'], '2040075': ['Ferrous sulfate'],
    '1700131': ['Glyceryl guaiacolate'], '1100101': ['Hyoscine butylbromide (Hyoscine-n-butylbromide)'], '1100170': ['Magnesium hydroxide'],
    '1900010': ['Multivitamins'], '1050060': ['Paracetamol (Acetaminophen)'], '1700040': ['Salbutamol sulfate'],
    '1300032': ['Diphtheria-Tetanus vaccine'], '1400020': ['Lidocaine hydrochloride'], '1200080': ['Medroxyprogesterone acetate'],
    '1800020': ['Glucose with/without sodium chloride'], '1800062': ['Sodium chloride'], '1800061': ['Sodium chloride'],
    '1020010': ['Ethyl alcohol'], '1020011': ['Ethyl alcohol'], '1070030': ['Benzyl benzoate'], '1070070': ['Calamine'],
    '1090010': ['Chloramphenicol'], '1090020': ['Chloramphenicol'], '1070020': ['Clotrimazole'],
    '1090040': ['Antazoline hydrochloride + Tetrahydrozoline hydrochloride'], '1020070': ['Hydrogen peroxide'],
    '1050020': ['Methyl salicylate cream compound'], '1800200': ['Sodium chloride'], '1020031': ['Povidone-iodine'], '1020032': ['Povidone-iodine'],
    '1070081': ['Sulfadiazine silver (Silver sulfadiazine)'], '1070060': ['Triamcinolone acetonide'], '1070061': ['Triamcinolone acetonide'],
    '1070010': ['Benzoic acid + Salicylic acid (Whitfield’s ointment)'], '1060020': ['Triamcinolone acetonide'],
    '1700081': ['Ipratropium bromide + Fenoterol hydrobromide'], '1700060': ['Salbutamol sulfate'],
    '1700190': ['Epinephrine (Adrenaline)'], '1700160': ['Chlorpheniramine maleate (Chlorphenamine maleate)'], '1000289': ['Dexamethasone'],
    '1800011': ['Glucose with/without sodium chloride'], '1040030': ['Isosorbide dinitrate'],
    '1500100': ['Allopurinol'], '1040074': ['Amlodipine besilate'], '1500012': ['Aspirin (Acetylsalicylic acid)'], '1500110': ['Colchicine'],
    '1040150': ['Doxazosin mesilate'], '1040090': ['Enalapril maleate'], '1040080': ['Enalapril maleate'], '1040100': ['Furosemide'],
    '1040120': ['Gemfibrozil'], '1080022': ['Glipizide'], '1040111': ['Hydrochlorothiazide (HCTZ)'], '1040041': ['Hydralazine hydrochloride'],
    '1080031': ['Biphasic isophane insulin (Soluble insulin + Isophane insulin)'], '1040040': ['Isosorbide dinitrate'],
    '1040075': ['Losartan potassium'], '1080020': ['Metformin hydrochloride'], '1040104': ['Methyldopa'], '2600010': ['Metoprolol tartrate'],
    '1040072': ['Nifedipine'], '1080023': ['Pioglitazone hydrochloride'], '1040060': ['Propranolol hydrochloride'],
    '1080050': ['Propylthiouracil'], '1040161': ['Simvastatin'], '1100081': ['Sodium bicarbonate'], '1040140': ['Spironolactone'],
    '1700011': ['Theophylline'], '1080060': ['Levothyroxine sodium (L-thyroxine sodium)'], '1040071': ['Verapamil hydrochloride'],
}
GREEK = str.maketrans('ΑΒΕΗΙΚΜΝΟΡΤΧ', 'ABEHIKMNOPTX')   # ตัวอักษรกรีกหน้าตาเหมือนอังกฤษในไฟล์ต้นฉบับ

rows, cat = [], 'อื่น ๆ'
for line in (root / 'tools/nlem/rpst_drugs.txt').read_text(encoding='utf-8').splitlines():
    line = line.strip()
    if line.startswith('###'):
        cat = line.lstrip('#').strip(); continue
    m = re.match(r'^\d+\.\s*(\d+)\s*-\s*(.+?)\s*\|\s*ขนาดบรรจุ:\s*(.*?)\s*\|\s*หน่วย:\s*(.*)$', line)
    if not m:
        continue
    code, name, pack, unit = m.groups()
    names = LINK.get(code, [])
    for n in names:
        assert n in refs, (code, n)
    rows.append({'code': code, 'name': name.translate(GREEK), 'category': cat, 'pack_size': '' if pack == '-' else pack, 'unit': unit,
                 'mono_refs': [r for n in names for r in refs[n]], 'sort': len(rows) + 1})
assert len({r['code'] for r in rows}) == len(rows)
data = '[\n' + ',\n'.join(json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in rows) + '\n]'
assert '$rpst$' not in data

sql = f"""-- =====================================================================
--  ขั้นที่ 58: รายการยา รพ.สต. อำเภอควนกาหลง (ฐานข้อมูลยาภายในอำเภอ) · รันซ้ำได้ · เพิ่มอย่างเดียว
--   ยาแต่ละรายการผูกกับข้อมูลยา (monograph) บัญชียาหลักแห่งชาติ ผ่าน mono_refs → drug_monographs.ref (57_drug_monographs.sql)
--   ไฟล์นี้สร้างด้วย tools/nlem/local_drugs.py (อย่าแก้มือ) · ใครก็อ่านได้ (รายการยา ไม่มีข้อมูลผู้ป่วย) · ผู้ดูแลเพิ่ม/แก้/ลบได้
--   ใส่ข้อมูลแบบ on conflict (code) do nothing → รันซ้ำไม่ทับที่ผู้ดูแลแก้แล้ว
-- =====================================================================

create table if not exists public.local_drugs (
  id          int generated always as identity primary key,
  code        text unique check (code is null or char_length(code) between 1 and 30),   -- รหัสยาใน รพ.
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  category    text not null default 'อื่น ๆ' check (char_length(category) between 1 and 100),
  pack_size   text not null default '' check (char_length(pack_size) <= 40),
  unit        text not null default '' check (char_length(unit) <= 40),
  mono_refs   text[] not null default '{{}}' check (cardinality(mono_refs) <= 30),
  note        text check (note is null or char_length(note) <= 2000),
  sort        int not null default 0,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

alter table public.local_drugs enable row level security;
drop policy if exists ldrug_read on public.local_drugs;
drop policy if exists ldrug_admin on public.local_drugs;
create policy ldrug_read on public.local_drugs for select using (active or public.is_admin());
create policy ldrug_admin on public.local_drugs for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.local_drugs from anon, authenticated;
grant select on public.local_drugs to anon, authenticated;
grant insert, update, delete on public.local_drugs to authenticated;
grant all on public.local_drugs to service_role;

insert into public.local_drugs (code, name, category, pack_size, unit, mono_refs, sort)
select x.code, x.name, x.category, x.pack_size, x.unit, x.mono_refs, x.sort
  from jsonb_to_recordset($rpst${data}$rpst$::jsonb)
    as x(code text, name text, category text, pack_size text, unit text, mono_refs text[], sort int)
on conflict (code) do nothing;

select 'ok' as step_58_local_drugs, count(*) as drugs, count(*) filter (where cardinality(mono_refs) > 0) as linked from public.local_drugs;
"""
(root / 'supabase/58_local_drugs.sql').write_text(sql, encoding='utf-8')
print('rows', len(rows), 'linked', sum(1 for r in rows if r['mono_refs']), 'unlinked:', [r['name'] for r in rows if not r['mono_refs']])
