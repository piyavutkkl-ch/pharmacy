#!/usr/bin/env python3
"""ฉลากยาสหรัฐฯ จาก openFDA (https://open.fda.gov/apis/drug/label/ · ข้อมูลสาธารณะ) ของยา รพ.สต. → supabase/59_fda_labels.sql
   ยาแต่ละรายการค้นด้วยชื่อสามัญที่สหรัฐฯ ใช้ + ช่องทางให้ยา (ตาราง FDA) → เลือกฉลากที่ข้อมูลครบที่สุด → เก็บเฉพาะหัวข้อสำคัญ (ตัดยาวเกิน)
   ใช้: python3 tools/nlem/fda_labels.py   (ต้องต่อเน็ต · ไม่ต้องใช้คีย์ · ≤240 ครั้ง/นาที) → เขียน supabase/59_fda_labels.sql
   หัวข้อ/การตัดความยาวต้องตรงกับ FDA_SECTIONS ใน js/pages/admin-drugs.js (ปุ่มดึงใหม่ในหน้าผู้ดูแล)"""
import json, pathlib, re, sys, time, urllib.parse, urllib.request

root = pathlib.Path(__file__).resolve().parents[2]
O, T, INJ, OPH, INH = 'ORAL', 'TOPICAL', 'INTRAVENOUS', 'OPHTHALMIC', 'RESPIRATORY (INHALATION)'
# รหัสยาใน รพ. → (ชื่อสามัญในสหรัฐฯ, ช่องทางให้ยา[, ชื่อการค้า]) · ไม่ใส่: แคลเซียมคาร์บอเนต/แอลกอฮอล์ (ฉลากสหรัฐฯ ใช้คนละข้อบ่งใช้) · ไม่มีในตาราง = ไม่มีฉลากในสหรัฐฯ (เช่น domperidone, roxithromycin, lynestrenol) หรือยาสมุนไพร/ยาผสมเฉพาะไทย
FDA = {
    '1010042': ('albendazole', O), '1600050': ('amitriptyline hydrochloride', O), '1010110': ('amoxicillin', O), '1010280': ('sulfamethoxazole and trimethoprim', O), '1700140': ('chlorpheniramine maleate', O), '1050130': ('cyproheptadine hydrochloride', O),
    '1700090': ('dextromethorphan hydrobromide', O), '1500070': ('diclofenac sodium', O), '1010190': ('dicloxacillin sodium', O),
    '1100091': ('dicyclomine hydrochloride', O), '1050210': ('dimenhydrinate', O), '1900120': ('ferrous fumarate', O), '1900080': ('folic acid', O),
    '1700132': ('guaifenesin', O), '1700170': ('hydroxyzine hydrochloride', O), '1500040': ('ibuprofen', O), '1010011': ('metronidazole', O),
    '1500051': ('naproxen', O), '1010270': ('norfloxacin', O), '1050030': ('acetaminophen', O), '1050042': ('acetaminophen', O),
    '1700030': ('albuterol sulfate', O), '1100070': ('simethicone', O), '1900050': ('ascorbic acid', O),
    '1010041': ('albendazole', O), '1010120': ('amoxicillin', O), '1010290': ('sulfamethoxazole and trimethoprim', O), '1700150': ('chlorpheniramine maleate', O),
    '1010191': ('dicloxacillin sodium', O), '1010080': ('erythromycin ethylsuccinate', O), '2040075': ('ferrous sulfate', O), '1700131': ('guaifenesin', O),
    '1100170': ('magnesium hydroxide', O), '1050060': ('acetaminophen', O), '1700040': ('albuterol sulfate', O),
    '1300032': ('tetanus and diphtheria toxoids adsorbed', 'INTRAMUSCULAR'), '1400020': ('lidocaine hydrochloride', 'INFILTRATION'),
    '1200080': ('medroxyprogesterone acetate', 'INTRAMUSCULAR'), '1800020': ('dextrose monohydrate and sodium chloride', INJ),
    '1800062': ('sodium chloride', INJ), '1800061': ('sodium chloride', INJ), '1070070': ('calamine', T), '1070020': ('clotrimazole', T), '1020070': ('hydrogen peroxide', T), '1050020': ('methyl salicylate', T),
    '1800200': ('sodium chloride', 'IRRIGATION'), '1020031': ('povidone-iodine', T), '1020032': ('povidone-iodine', T),
    '1070081': ('silver sulfadiazine', T), '1070060': ('triamcinolone acetonide', T), '1070061': ('triamcinolone acetonide', T),
    '1060020': ('triamcinolone acetonide', 'DENTAL'), '1700060': ('albuterol sulfate', INH), '1700190': ('epinephrine', 'INTRAMUSCULAR'),
    '1000289': ('dexamethasone sodium phosphate', INJ), '1800011': ('dextrose monohydrate', INJ), '1040030': ('isosorbide dinitrate', O),
    '1500100': ('allopurinol', O), '1040074': ('amlodipine besylate', O), '1500012': ('aspirin', O), '1500110': ('colchicine', O),
    '1040150': ('doxazosin mesylate', O), '1040090': ('enalapril maleate', O), '1040080': ('enalapril maleate', O), '1040100': ('furosemide', O),
    '1040120': ('gemfibrozil', O), '1080022': ('glipizide', O), '1040111': ('hydrochlorothiazide', O), '1040041': ('hydralazine hydrochloride', O),
    '1080031': ('insulin human', 'SUBCUTANEOUS', 'humulin 70/30'), '1040040': ('isosorbide dinitrate', O), '1040075': ('losartan potassium', O),
    '1080020': ('metformin hydrochloride', O), '1040104': ('methyldopa', O), '2600010': ('metoprolol tartrate', O), '1040072': ('nifedipine', O),
    '1080023': ('pioglitazone hydrochloride', O), '1040060': ('propranolol hydrochloride', O), '1080050': ('propylthiouracil', O),
    '1040161': ('simvastatin', O), '1100081': ('sodium bicarbonate', O), '1040140': ('spironolactone', O), '1700011': ('theophylline', O),
    '1080060': ('levothyroxine sodium', O), '1040071': ('verapamil hydrochloride', O),
}
SECTIONS = [  # (หัวข้อไทย, ช่องใน openFDA ที่รวมกัน)
    ('ข้อบ่งใช้', ['indications_and_usage']),
    ('ขนาดยาและวิธีใช้', ['dosage_and_administration']),
    ('ข้อห้ามใช้', ['contraindications', 'do_not_use']),
    ('คำเตือนกรอบดำ', ['boxed_warning']),
    ('คำเตือนและข้อควรระวัง', ['warnings_and_cautions', 'warnings', 'precautions', 'ask_doctor', 'ask_doctor_or_pharmacist', 'when_using', 'stop_use']),
    ('อาการไม่พึงประสงค์', ['adverse_reactions']),
    ('ยาตีกัน', ['drug_interactions']),
    ('การใช้ในหญิงตั้งครรภ์/ให้นมบุตร เด็ก ผู้สูงอายุ', ['pregnancy', 'lactation', 'nursing_mothers', 'pregnancy_or_breast_feeding', 'pediatric_use', 'geriatric_use']),
    ('การได้รับยาเกินขนาด', ['overdosage']),
    ('การเก็บรักษา', ['storage_and_handling']),
]
MAX = 2500   # ตัวอักษรต่อหัวข้อ (ฉลากเต็มอ่านต่อที่ DailyMed)


def get(url):
    for i in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {'results': []}
            time.sleep(2 ** i)
        except Exception:
            time.sleep(2 ** i)
    return {'results': []}


def clean(t):
    t = re.sub(r'\s+', ' ', t).strip()
    t = re.sub(r'^\d+(\.\d+)*\s+[A-Z][A-Z &/,\-]+\s+', '', t)          # ตัดเลขหัวข้อ เช่น "2 DOSAGE AND ADMINISTRATION"
    t = re.sub(r'^(INDICATIONS (AND|&) USAGE|DOSAGE (AND|&) ADMINISTRATION|CONTRAINDICATIONS|WARNINGS( AND PRECAUTIONS)?|PRECAUTIONS|ADVERSE REACTIONS|DRUG INTERACTIONS|OVERDOSAGE|PREGNANCY|NURSING MOTHERS|PEDIATRIC USE|GERIATRIC USE|LACTATION|Uses|Directions|Warnings|Do not use|Ask a doctor[a-z ]*|Stop use[a-z ]*|When using[a-z ]*|If pregnant or breast-feeding,?|Storage and Handling|HOW SUPPLIED)[:\s]+', '', t, flags=re.I)
    return t


def sections_of(lab):
    out = []
    for title, keys in SECTIONS:
        parts = [clean(' '.join(lab[k])) for k in keys if lab.get(k)]
        body = ' '.join(p for p in parts if p)
        if not body:
            continue
        if len(body) > MAX:
            cut = body[:MAX]
            body = cut[:max(cut.rfind('. '), MAX - 300) + 1].strip() + ' …'
        out.append({'title': title, 'body': body})
    return out


def score(lab, generic):
    o = lab.get('openfda', {})
    gn = [g.lower() for g in o.get('generic_name', [])]
    s = len(sections_of(lab)) * 10
    s += 30 if gn == [generic] else 0                                  # ตัวยาเดี่ยว ตรงชื่อ
    s += 15 if 'HUMAN PRESCRIPTION DRUG' in o.get('product_type', []) else 0
    s -= 25 if re.search(r'bacteriostatic', ' '.join(o.get('brand_name', [])), re.I) else 0   # น้ำเกลือผสมยา ไม่ใช่สารน้ำ
    s += int(lab.get('effective_time', '0')[:4] or 0) / 1000
    return s


HOMEO = re.compile(r'homeopath|\bHPUS\b', re.I)


def best(generic, route, brand=None):
    q = f'openfda.generic_name:"{generic}"+AND+openfda.route:"{route}"' + (f'+AND+openfda.brand_name:"{brand}"' if brand else '')
    data = get('https://api.fda.gov/drug/label.json?search=' + urllib.parse.quote(q, safe=':+"') + '&limit=50')
    labs = [l for l in data.get('results', []) if generic in [g.lower() for g in l.get('openfda', {}).get('generic_name', [])]
            and not HOMEO.search(json.dumps(l))]   # ไม่เอายาโฮมีโอพาธีย์
    if not labs:
        return None
    lab = max(labs, key=lambda l: score(l, generic))
    o = lab.get('openfda', {})
    return {'generic': generic, 'route': route, 'title': (o.get('brand_name') or o.get('generic_name') or [generic])[0][:200],
            'set_id': lab.get('set_id'), 'effective': lab.get('effective_time'), 'sections': sections_of(lab)}


SQL_HEAD = """-- =====================================================================
--  ขั้นที่ 59: ข้อมูลจากฉลากยาสหรัฐฯ (openFDA drug label · ข้อมูลสาธารณะ ภาษาอังกฤษ) ของยา รพ.สต. · รันซ้ำได้ · เพิ่มอย่างเดียว
--   https://open.fda.gov/apis/drug/label/ · หัวข้อ: ข้อบ่งใช้ ขนาดยา ข้อห้ามใช้ คำเตือน อาการไม่พึงประสงค์ ยาตีกัน กลุ่มพิเศษ ยาเกินขนาด การเก็บรักษา (ตัดยาว ≤2,500 ตัวอักษร/หัวข้อ)
--   ไฟล์นี้สร้างด้วย tools/nlem/fda_labels.py (อย่าแก้มือ) · ใครก็อ่านได้ · ผู้ดูแลดึงใหม่/แก้/ลบได้ (ตั้งค่า › ฐานข้อมูลยา)
--   local_drugs.fda_key → drug_fda_labels.key · ใส่ข้อมูลแบบไม่ทับที่ผู้ดูแลแก้แล้ว
-- =====================================================================

create table if not exists public.drug_fda_labels (
  id          int generated always as identity primary key,
  key         text not null unique check (char_length(key) between 1 and 200),   -- <ชื่อสามัญ>|<ช่องทางให้ยา>[|<ชื่อการค้า>]
  generic     text not null,
  route       text not null default '',
  brand       text,
  title       text not null default '',
  set_id      text,                    -- ฉลากเต็มที่ DailyMed
  effective   text,                    -- วันที่ปรับปรุงฉลาก YYYYMMDD
  sections    jsonb not null default '[]' check (jsonb_typeof(sections) = 'array' and octet_length(sections::text) <= 60000),
  fetched_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.drug_fda_labels enable row level security;
drop policy if exists dfda_read on public.drug_fda_labels;
drop policy if exists dfda_admin on public.drug_fda_labels;
create policy dfda_read on public.drug_fda_labels for select using (true);
create policy dfda_admin on public.drug_fda_labels for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.drug_fda_labels from anon, authenticated;
grant select on public.drug_fda_labels to anon, authenticated;
grant insert, update, delete on public.drug_fda_labels to authenticated;
grant all on public.drug_fda_labels to service_role;

alter table public.local_drugs add column if not exists fda_key text check (fda_key is null or char_length(fda_key) <= 200);
"""


def write_sql(found):
    rows = [{'key': k, 'generic': v['generic'], 'route': v['route'], 'brand': v.get('brand'), 'title': v['title'], 'set_id': v['set_id'],
             'effective': v['effective'], 'sections': v['sections']} for k, v in sorted(found.items())]
    links = [{'code': c, 'key': '|'.join([g, r, *b])} for c, (g, r, *b) in FDA.items() if '|'.join([g, r, *b]) in found]
    data = '[\n' + ',\n'.join(json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in rows) + '\n]'
    ldata = json.dumps(links, ensure_ascii=False, separators=(',', ':'))
    for x in (data, ldata):
        assert '$fda$' not in x and not re.search(r'drop\s+(table|schema|database|column)|truncate\s|delete\s+from', x, re.I)
    sql = SQL_HEAD + f"""
insert into public.drug_fda_labels (key, generic, route, brand, title, set_id, effective, sections)
select x.key, x.generic, x.route, x.brand, x.title, x.set_id, x.effective, x.sections
  from jsonb_to_recordset($fda${data}$fda$::jsonb)
    as x(key text, generic text, route text, brand text, title text, set_id text, effective text, sections jsonb)
on conflict (key) do nothing;

-- ผูกยา รพ.สต. กับฉลาก (เฉพาะรายการที่ยังไม่ได้ผูก)
update public.local_drugs l set fda_key = x.key
  from jsonb_to_recordset($fda${ldata}$fda$::jsonb) as x(code text, key text)
 where l.code = x.code and l.fda_key is null;

select 'ok' as step_59_fda_labels, (select count(*) from public.drug_fda_labels) as labels, (select count(*) from public.local_drugs where fda_key is not null) as linked;
"""
    (root / 'supabase/59_fda_labels.sql').write_text(sql, encoding='utf-8')
    print('labels', len(rows), 'linked codes', len(links), file=sys.stderr)


if __name__ == '__main__':
    found, miss = {}, []
    for code, (g, r, *b) in FDA.items():
        k = '|'.join([g, r, *b])
        if k in found or k in miss:
            continue
        lab = best(g, r, *b)
        if lab and lab['sections']:
            lab['brand'] = b[0] if b else None
            found[k] = lab
        else:
            miss.append(k)
        print(('OK  ' if k in found else 'MISS') + f' {k}' + (f" · {found[k]['title']}" if k in found else ''), file=sys.stderr)
        time.sleep(0.3)
    write_sql(found)
