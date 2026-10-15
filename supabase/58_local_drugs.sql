-- =====================================================================
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
  mono_refs   text[] not null default '{}' check (cardinality(mono_refs) <= 30),
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
  from jsonb_to_recordset($rpst$[
{"code":"1010042","name":"ALBENDAZOLE 200 MG TAB","category":"ยาเม็ด/แคปซูล","pack_size":"100","unit":"TAB","mono_refs":["2569:5.5:1"],"sort":1},
{"code":"1600050","name":"AMITYIPTYLINE 10 MG","category":"ยาเม็ด/แคปซูล","pack_size":"500","unit":"TAB","mono_refs":["2569:4.3:1","2569:4.7.2:1","2569:4.7.3.2:1"],"sort":2},
{"code":"1010110","name":"AMOXICILLIN 500 MG","category":"ยาเม็ด/แคปซูล","pack_size":"500","unit":"CAP","mono_refs":["2569:5.1.1:1"],"sort":3},
{"code":"1900160","name":"CALCIUM CARBONATE 1000 MG","category":"ยาเม็ด/แคปซูล","pack_size":"500","unit":"TAB","mono_refs":["2569:9.5:2"],"sort":4},
{"code":"1010280","name":"COTRIMOXAZOLE TAB","category":"ยาเม็ด/แคปซูล","pack_size":"500","unit":"TAB","mono_refs":["2569:5.1.8:1"],"sort":5},
{"code":"1700140","name":"CPM 4 MG","category":"ยาเม็ด/แคปซูล","pack_size":"1000","unit":"TAB","mono_refs":["2569:3.4:3"],"sort":6},
{"code":"1050130","name":"CYPROHEPTADINE 4 MG","category":"ยาเม็ด/แคปซูล","pack_size":"1000","unit":"TAB","mono_refs":["2569:4.7.3.2:2","2569:16.9:9"],"sort":7},
{"code":"1700090","name":"DEXTROMETHORPHAN 15 MG","category":"ยาเม็ด/แคปซูล","pack_size":"1000","unit":"TAB","mono_refs":["2569:3.6.1:1"],"sort":8},
{"code":"1500070","name":"DICLOFENAC 25 MG","category":"ยาเม็ด/แคปซูล","pack_size":"1000","unit":"TAB","mono_refs":["2569:10.1.1:2"],"sort":9},
{"code":"1010190","name":"DICLOXACILLIN 250 MG","category":"ยาเม็ด/แคปซูล","pack_size":"500","unit":"CAP","mono_refs":["2569:5.1.1:6"],"sort":10},
{"code":"1100091","name":"DICYCLOMINE 10 MG","category":"ยาเม็ด/แคปซูล","pack_size":"1000","unit":"TAB","mono_refs":["2569:1.2:1"],"sort":11},
{"code":"1050210","name":"DIMENHYDRINATE 50 MG","category":"ยาเม็ด/แคปซูล","pack_size":"1000","unit":"TAB","mono_refs":["2569:4.5.2:2"],"sort":12},
{"code":"1100120","name":"DOMPERIDONE 10 MG","category":"ยาเม็ด/แคปซูล","pack_size":"500","unit":"TAB","mono_refs":["2569:1.2:2","2569:4.5.1:1"],"sort":13},
{"code":"1900120","name":"FERROUS FUMARATE 200 MG","category":"ยาเม็ด/แคปซูล","pack_size":"500","unit":"TAB","mono_refs":["2569:9.5:5","2569:9.6:1"],"sort":14},
{"code":"1900080","name":"FOLIC ACID","category":"ยาเม็ด/แคปซูล","pack_size":"1000","unit":"TAB","mono_refs":["2569:9.1.2:1","2569:9.3:1","2569:9.6:3"],"sort":15},
{"code":"1700132","name":"GLYCERYL GUAIACOLATE 100 MO","category":"ยาเม็ด/แคปซูล","pack_size":"500","unit":"TAB","mono_refs":["2569:3.6.2:2"],"sort":16},
{"code":"1700170","name":"HYDROXYZINE 10 MG","category":"ยาเม็ด/แคปซูล","pack_size":"1000","unit":"TAB","mono_refs":["2569:3.4:5","2569:4.1:7"],"sort":17},
{"code":"1500040","name":"IBUPROFEN 400 MG","category":"ยาเม็ด/แคปซูล","pack_size":"500","unit":"TAB","mono_refs":["2569:4.6:2","2569:4.7.3.1:2","2569:10.1.1:3"],"sort":18},
{"code":"1200070","name":"LYNESTRENOL 0.5 MG (dailyton)","category":"ยาเม็ด/แคปซูล","pack_size":"20","unit":"แผง (28tab)","mono_refs":["2569:7.3:3"],"sort":19},
{"code":"1010011","name":"METRONIDAZOLE 400 MG","category":"ยาเม็ด/แคปซูล","pack_size":"500","unit":"TAB","mono_refs":["2569:5.1.7:1","2569:5.4.2:1"],"sort":20},
{"code":"1900020","name":"MTV TAB","category":"ยาเม็ด/แคปซูล","pack_size":"1000","unit":"TAB","mono_refs":["2569:9.3:2","2569:9.3:3","2569:9.3:4","2569:9.3:5"],"sort":21},
{"code":"1500051","name":"NAPROXEN 250 MG","category":"ยาเม็ด/แคปซูล","pack_size":"250","unit":"TAB","mono_refs":["2569:10.1.1:5"],"sort":22},
{"code":"1010270","name":"NORFLOXACIN 400 MG","category":"ยาเม็ด/แคปซูล","pack_size":"100","unit":"TAB","mono_refs":["2569:5.1.6:1"],"sort":23},
{"code":"1050030","name":"PARACETAMOL 325 MG","category":"ยาเม็ด/แคปซูล","pack_size":"1000","unit":"TAB","mono_refs":["2569:4.6:3","2569:4.7.3.1:3"],"sort":24},
{"code":"1050042","name":"PARACETAMOL 500 MG (FOIL)","category":"ยาเม็ด/แคปซูล","pack_size":"500","unit":"TAB","mono_refs":["2569:4.6:3","2569:4.7.3.1:3"],"sort":25},
{"code":"1200110","name":"R-DEN","category":"ยาเม็ด/แคปซูล","pack_size":"50","unit":"แผง (28tab)","mono_refs":[],"sort":26},
{"code":"1010071","name":"ROXITHROMYCIN 150 MG","category":"ยาเม็ด/แคปซูล","pack_size":"100","unit":"TAB","mono_refs":["2569:5.1.5:3"],"sort":27},
{"code":"1700030","name":"SALBUTAMOL 2 MG","category":"ยาเม็ด/แคปซูล","pack_size":"1000","unit":"TAB","mono_refs":["2569:3.1.1:2"],"sort":28},
{"code":"1100070","name":"SIMETHICONE 80 MG","category":"ยาเม็ด/แคปซูล","pack_size":"500","unit":"TAB","mono_refs":["2569:1.1:3"],"sort":29},
{"code":"1900150","name":"TRIFERDINE 150 MG","category":"ยาเม็ด/แคปซูล","pack_size":"30","unit":"TAB","mono_refs":["2569:9.6:5"],"sort":30},
{"code":"1900030","name":"VITAMIN B COMPLEX","category":"ยาเม็ด/แคปซูล","pack_size":"1000","unit":"TAB","mono_refs":["2569:9.3:11","2569:9.3:12"],"sort":31},
{"code":"1900050","name":"VITAMIN C 50 MG","category":"ยาเม็ด/แคปซูล","pack_size":"1000","unit":"TAB","mono_refs":["2569:9.3:13","2569:9.3:14"],"sort":32},
{"code":"1100180","name":"ORS เด็ก","category":"ยาผง","pack_size":"100","unit":"ของ","mono_refs":["2569:1.4:2"],"sort":33},
{"code":"1010041","name":"ALBENDAZOLE SUSP.(400MG/20N","category":"ยาน้ำรับประทาน","pack_size":"1","unit":"BOT","mono_refs":["2569:5.5:1"],"sort":34},
{"code":"1010120","name":"AMOXICILLIN DRY SYRUP (60ML)","category":"ยาน้ำรับประทาน","pack_size":"","unit":"BOT","mono_refs":["2569:5.1.1:1"],"sort":35},
{"code":"1010290","name":"COTRIMOXAZOLE SUSP (60ML)","category":"ยาน้ำรับประทาน","pack_size":"1","unit":"BOT","mono_refs":["2569:5.1.8:1"],"sort":36},
{"code":"1700150","name":"CPM SYRUP (60ML)","category":"ยาน้ำรับประทาน","pack_size":"1","unit":"BOT","mono_refs":["2569:3.4:3"],"sort":37},
{"code":"1010191","name":"DICLOXACILLIN DRY SYRUP (60M","category":"ยาน้ำรับประทาน","pack_size":"1","unit":"BOT","mono_refs":["2569:5.1.1:6"],"sort":38},
{"code":"1100130","name":"DOMPERIDONE SUSP (30ML)","category":"ยาน้ำรับประทาน","pack_size":"1","unit":"BOT","mono_refs":["2569:1.2:2","2569:4.5.1:1"],"sort":39},
{"code":"1010080","name":"ERYTHROMYCIN DRY SYRUP (60M","category":"ยาน้ำรับประทาน","pack_size":"1","unit":"BOT","mono_refs":["2569:5.1.5:1","2569:5.1.5:2"],"sort":40},
{"code":"2040075","name":"FERROUS SULFATE (60 ML BOT)","category":"ยาน้ำรับประทาน","pack_size":"1","unit":"BOT","mono_refs":["2569:9.5:6","2569:9.6:2"],"sort":41},
{"code":"1700131","name":"GUAFENESIN SYRUP (60ML)","category":"ยาน้ำรับประทาน","pack_size":"1","unit":"BOT","mono_refs":["2569:3.6.2:2"],"sort":42},
{"code":"1100101","name":"HYOSCINE-N-BUTYLBROMIDE SYR","category":"ยาน้ำรับประทาน","pack_size":"1","unit":"BOT","mono_refs":["2569:1.2:3"],"sort":43},
{"code":"1100170","name":"MILK OF MAGNESIA (60ML)","category":"ยาน้ำรับประทาน","pack_size":"1","unit":"BOT","mono_refs":["2569:1.6:5","2569:9.5:8"],"sort":44},
{"code":"1900010","name":"MTV SYRUP (60ML) (เก็บในตู้เย็น)","category":"ยาน้ำรับประทาน","pack_size":"1","unit":"BOT","mono_refs":["2569:9.3:2","2569:9.3:3","2569:9.3:4","2569:9.3:5"],"sort":45},
{"code":"1050060","name":"PARACETAMOL SYRUP (60ML)","category":"ยาน้ำรับประทาน","pack_size":"1","unit":"BOT","mono_refs":["2569:4.6:3","2569:4.7.3.1:3"],"sort":46},
{"code":"1700040","name":"SALBUTAMOL SYRUP (60ML)","category":"ยาน้ำรับประทาน","pack_size":"1","unit":"BOT","mono_refs":["2569:3.1.1:2"],"sort":47},
{"code":"1300032","name":"Diphtheria-Tetanus Vaccine (dTT","category":"ยาฉีด","pack_size":"1","unit":"VIAL","mono_refs":["2569:14:4"],"sort":48},
{"code":"1400020","name":"LIDOCAINE 1% WITHOUT EPINEPH","category":"ยาฉีด","pack_size":"1","unit":"VIAL","mono_refs":["2569:15.2:2"],"sort":49},
{"code":"1200080","name":"MEDROXYPROGESTERONE INJ. 15","category":"ยาฉีด","pack_size":"1","unit":"AMP","mono_refs":["2569:6.4.1:5","2569:7.3:4"],"sort":50},
{"code":"1800020","name":"D-5-N/2 1000 ML","category":"สารน้ำ","pack_size":"1","unit":"BOT","mono_refs":["2569:9.2:2"],"sort":51},
{"code":"1800062","name":"NSS 0.9% 100 ML","category":"สารน้ำ","pack_size":"20","unit":"BOT","mono_refs":["2569:9.2:9","2569:12.2.2:2","2569:12.3.5:4"],"sort":52},
{"code":"1800061","name":"NSS 0.9% 1000 ML","category":"สารน้ำ","pack_size":"1","unit":"BOT","mono_refs":["2569:9.2:9","2569:12.2.2:2","2569:12.3.5:4"],"sort":53},
{"code":"1020010","name":"ALCOHOL 70% 450 ML","category":"ยาใช้ภายนอก","pack_size":"1","unit":"BOT","mono_refs":["2569:5.6:2"],"sort":54},
{"code":"1020011","name":"ALCOHOL 95% (450ML)","category":"ยาใช้ภายนอก","pack_size":"1","unit":"BOT","mono_refs":["2569:5.6:2"],"sort":55},
{"code":"1700180","name":"AMMONIA SOLUTION (450ML)","category":"ยาใช้ภายนอก","pack_size":"1","unit":"BOT","mono_refs":[],"sort":56},
{"code":"1070030","name":"BENZYL BENZOATE LOTION (60M","category":"ยาใช้ภายนอก","pack_size":"1","unit":"BOT","mono_refs":["2569:13.1.3:1"],"sort":57},
{"code":"1070070","name":"CALAMINE LOTION (60ML)","category":"ยาใช้ภายนอก","pack_size":"1","unit":"BOT","mono_refs":["2569:13.3:1"],"sort":58},
{"code":"1090010","name":"CHLORAMPHENICOL EYE DROP","category":"ยาใช้ภายนอก","pack_size":"1","unit":"BOT","mono_refs":["2569:11.1.1:2","2569:12.1.1:1"],"sort":59},
{"code":"1090020","name":"CHLORAMPHENICOL EYE OINT (50","category":"ยาใช้ภายนอก","pack_size":"1","unit":"หลอด","mono_refs":["2569:11.1.1:2","2569:12.1.1:1"],"sort":60},
{"code":"1070020","name":"CLOTRIMAZOLE CREAM (5GM)","category":"ยาใช้ภายนอก","pack_size":"1","unit":"หลอด","mono_refs":["2569:7.2:1","2569:12.1.2:3","2569:12.3.2:1","2569:13.1.2:2"],"sort":61},
{"code":"1090040","name":"HISTA-OPH ED","category":"ยาใช้ภายนอก","pack_size":"1","unit":"BOT","mono_refs":["2569:11.2:1"],"sort":62},
{"code":"1020070","name":"HYDROGEN PEROXIDE (450ML)","category":"ยาใช้ภายนอก","pack_size":"1","unit":"BOT","mono_refs":["2569:5.6:4","2569:12.3.5:3"],"sort":63},
{"code":"1050020","name":"METHYLSALICYLATE CREAM","category":"ยาใช้ภายนอก","pack_size":"1","unit":"หลอก","mono_refs":["2569:10.3.1:1"],"sort":64},
{"code":"1800200","name":"NSS IRRIGATION 1000 ML","category":"ยาใช้ภายนอก","pack_size":"1","unit":"BOT","mono_refs":["2569:9.2:9","2569:12.2.2:2","2569:12.3.5:4"],"sort":65},
{"code":"1020031","name":"POVIDONE IODINE SOL (30 ML)","category":"ยาใช้ภายนอก","pack_size":"1","unit":"BOT","mono_refs":["2569:5.6:7"],"sort":66},
{"code":"1020032","name":"POVIDONE IODINE SOLUTION 4501","category":"ยาใช้ภายนอก","pack_size":"","unit":"BOT","mono_refs":["2569:5.6:7"],"sort":67},
{"code":"1070081","name":"SILVERDERM CREAM (25 GM)","category":"ยาใช้ภายนอก","pack_size":"1","unit":"หลอด","mono_refs":["2569:13.1.1:3"],"sort":68},
{"code":"1070060","name":"TA CREAM 0.1% (5GM)","category":"ยาใช้ภายนอก","pack_size":"1","unit":"หลอด","mono_refs":["2569:6.3:6","2569:12.3.1:7","2569:13.4:8"],"sort":69},
{"code":"1070061","name":"TA LOTION 30 ml","category":"ยาใช้ภายนอก","pack_size":"1","unit":"BOT","mono_refs":["2569:6.3:6","2569:12.3.1:7","2569:13.4:8"],"sort":70},
{"code":"1070010","name":"WHITFIELD'S OINTMENT (15GM)","category":"ยาใช้ภายนอก","pack_size":"1","unit":"หลอด","mono_refs":["2569:13.1.2:1"],"sort":71},
{"code":"1060020","name":"TA ORAL PASTE","category":"ยาป้ายปาก","pack_size":"50","unit":"ซอง","mono_refs":["2569:6.3:6","2569:12.3.1:7","2569:13.4:8"],"sort":72},
{"code":"1700081","name":"BERODUAL SOLUTION (20ML)","category":"ยาพ่นใช้กับเครื่องพ่นในรพสต.","pack_size":"1","unit":"BOT","mono_refs":["2569:3.1.2:1"],"sort":73},
{"code":"1700060","name":"SALBUTAMOL SOLUTION (20ML)","category":"ยาพ่นใช้กับเครื่องพ่นในรพสต.","pack_size":"1","unit":"BOT","mono_refs":["2569:3.1.1:2"],"sort":74},
{"code":"1700190","name":"ADRENALINE INJ.(1ML/AMP)","category":"ยาใน Emergency box drug","pack_size":"1","unit":"AMP","mono_refs":["2569:2.7.3:1","2569:12.3.5:1"],"sort":75},
{"code":"1700160","name":"CPM INJ.(10MG/1ML)","category":"ยาใน Emergency box drug","pack_size":"1","unit":"AMP","mono_refs":["2569:3.4:3"],"sort":76},
{"code":"1000289","name":"DEXAMETHASONE (4MG/1ML)","category":"ยาใน Emergency box drug","pack_size":"2","unit":"AMP","mono_refs":["2569:6.3:1","2569:8.2:1"],"sort":77},
{"code":"1800011","name":"GLUCOSE 50% INJ. 50 ML","category":"ยาใน Emergency box drug","pack_size":"1","unit":"AMP","mono_refs":["2569:9.2:2"],"sort":78},
{"code":"1040030","name":"ISOSORBIDE DINITRATE 5 MG (ยา","category":"ยาใน Emergency box drug","pack_size":"10","unit":"TABLET","mono_refs":["2569:2.6.1:2"],"sort":79},
{"code":"1500100","name":"ALLOPURINOL 100 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"500","unit":"TAB","mono_refs":["2569:10.1.3:1"],"sort":80},
{"code":"1040074","name":"AMLODIPINE 5 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"100","unit":"TAB","mono_refs":["2569:2.6.2:1"],"sort":81},
{"code":"1500012","name":"ASPIRIN 81 MG TABLET","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"1000","unit":"TAB","mono_refs":["2569:2.9:1","2569:4.6:1","2569:4.7.3.1:1","2569:10.1.1:1"],"sort":82},
{"code":"1500110","name":"COLCHICINE 0.6 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"500","unit":"TAB","mono_refs":["2569:10.1.3:2"],"sort":83},
{"code":"1040150","name":"DOXAZOSIN 2 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"500","unit":"TAB","mono_refs":["2569:2.5.3:2","2569:7.4.1:1"],"sort":84},
{"code":"1040090","name":"ENALAPRIL 20 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"1000","unit":"TAB","mono_refs":["2569:2.5.4:1"],"sort":85},
{"code":"1040080","name":"ENALAPRIL 5 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"1000","unit":"TAB","mono_refs":["2569:2.5.4:1"],"sort":86},
{"code":"1040100","name":"FUROSEMIDE 40 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"500","unit":"TAB","mono_refs":["2569:2.2:1"],"sort":87},
{"code":"1040120","name":"GEMFIBROZIL 300 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"500","unit":"CAP","mono_refs":["2569:2.12:1"],"sort":88},
{"code":"1080022","name":"GLIPIZIDE 5 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"500","unit":"TAB","mono_refs":["2569:6.1.2:2"],"sort":89},
{"code":"1040111","name":"HCTZ 25 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"500","unit":"TAB","mono_refs":["2569:2.2:2"],"sort":90},
{"code":"1040041","name":"HYDRALAZINE HCL 25 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"500","unit":"TAB","mono_refs":["2569:2.5.1:1"],"sort":91},
{"code":"1080031","name":"INSULIN MIX 70/30 PENFIL","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"5","unit":"AMP","mono_refs":["2569:6.1.1:1"],"sort":92},
{"code":"1040040","name":"ISOSORBIDE DINITRATE 10 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"500","unit":"TAB","mono_refs":["2569:2.6.1:2"],"sort":93},
{"code":"1040075","name":"LOSARTAN 50 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"300","unit":"TAB","mono_refs":["2569:2.5.5:1"],"sort":94},
{"code":"1080020","name":"METFORMIN 500 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"500","unit":"TAB","mono_refs":["2569:6.1.2:3"],"sort":95},
{"code":"1040104","name":"METHYLDOPA 250 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"500","unit":"TAB","mono_refs":["2569:2.5.2:1"],"sort":96},
{"code":"2600010","name":"METOPROLOL 100 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"500","unit":"TAB","mono_refs":["2569:2.4:2"],"sort":97},
{"code":"1040072","name":"NIFEDIPINE 20 MG SR","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"100","unit":"TAB","mono_refs":["2569:2.6.2:9","2569:7.1.3:1"],"sort":98},
{"code":"1080023","name":"PIOGLITAZONE 30 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"500","unit":"TAB","mono_refs":["2569:6.1.2:4"],"sort":99},
{"code":"1040060","name":"PROPRANOLOL 40 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"1000","unit":"TAB","mono_refs":["2569:2.4:3","2569:4.7.3.2:3","2569:4.9:4"],"sort":100},
{"code":"1080050","name":"PROPYLTHIOURACIL 50 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"1000","unit":"TAB","mono_refs":["2569:6.2.2:2"],"sort":101},
{"code":"1040161","name":"SIMVASTATIN 20 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"100","unit":"TAB","mono_refs":["2569:2.12:3"],"sort":102},
{"code":"1100081","name":"SODAMINT 300 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"1000","unit":"TAB","mono_refs":["2569:9.2:8","2569:12.1.3:2","2569:16.9:6","2569:16.10:4"],"sort":103},
{"code":"1040140","name":"SPIRONOLACTONE 25 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"500","unit":"TAB","mono_refs":["2569:2.2:4"],"sort":104},
{"code":"1700011","name":"THEOPHYLLINE 200 MG CR","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"100","unit":"TAB","mono_refs":["2569:3.1.3:2"],"sort":105},
{"code":"1080060","name":"THYROXINE SODIUM 100 MCG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"500","unit":"TAB","mono_refs":["2569:6.2.1:1"],"sort":106},
{"code":"1040071","name":"VERAPAMIL 40 MG","category":"ยาโรคเรื้อรังคลินิก NCD รับต่อจาก รพ.","pack_size":"500","unit":"TAB","mono_refs":["2569:2.6.2:7"],"sort":107},
{"code":"1920010","name":"ขมิ้นชัน 500 MG CAP (ละงูผลิต)","category":"ยาสมุนไพร","pack_size":"100","unit":"CAP","mono_refs":[],"sort":108},
{"code":"1920050","name":"เพชรสังมาต แคปซูล (ละงูผลิต)","category":"ยาสมุนไพร","pack_size":"100","unit":"CAP","mono_refs":[],"sort":109},
{"code":"1920020","name":"ฟ้าทะลายโจร แคปซูล (ละงูผลิต)","category":"ยาสมุนไพร","pack_size":"100","unit":"CAP","mono_refs":[],"sort":110},
{"code":"1920080","name":"มะขามแขก 400 MG CAP (ละงูผลิต)","category":"ยาสมุนไพร","pack_size":"500","unit":"CAP","mono_refs":[],"sort":111},
{"code":"1920070","name":"ยาแก้ไอมะขามป้อม","category":"ยาสมุนไพร","pack_size":"1","unit":"BOT","mono_refs":[],"sort":112},
{"code":"1920060","name":"ยาเถาวัลย์เปรียง 400 mg (ละงูผลิต)","category":"ยาสมุนไพร","pack_size":"500","unit":"CAP","mono_refs":[],"sort":113},
{"code":"1920016","name":"ยาธาตุอบเชย","category":"ยาสมุนไพร","pack_size":"1","unit":"BOT","mono_refs":[],"sort":114},
{"code":"1930080","name":"ยาหม่องไพล 30G/ขวด (ละงูผลิต)","category":"ยาสมุนไพร","pack_size":"1","unit":"BOT","mono_refs":[],"sort":115},
{"code":"1920040","name":"ยาอมมะแว้ง รสบ๊วย","category":"ยาสมุนไพร","pack_size":"20","unit":"ซอง","mono_refs":[],"sort":116},
{"code":"1920013","name":"เหลืองปิดสมุทร 400 MG (ละงูผลิต)","category":"ยาสมุนไพร","pack_size":"90","unit":"CAP","mono_refs":[],"sort":117}
]$rpst$::jsonb)
    as x(code text, name text, category text, pack_size text, unit text, mono_refs text[], sort int)
on conflict (code) do nothing;

select 'ok' as step_58_local_drugs, count(*) as drugs, count(*) filter (where cardinality(mono_refs) > 0) as linked from public.local_drugs;
