"""Audit (Phase 1 · ไม่แก้ระบบจริง): สิทธิ์ฐานข้อมูล + AI Data Pipeline ของข้อมูลขนาดยา บน Postgres ในเครื่อง (ฐาน audit_dose · ไม่ใช่ Supabase จริง)
ใช้:  bash audit/dose/db_audit.sh   (สร้างฐานใหม่จาก supabase/*.sql แล้วรันไฟล์นี้)
คำตอบ openFDA/RxNorm/Gemini ทั้งหมดเป็นข้อความจำลองในไฟล์นี้ (ไม่ได้เรียกเน็ต · ไม่มีคีย์จริง · ไม่มีข้อมูลผู้ป่วย)
"""
import json, os, subprocess, sys

PSQL = ["psql", os.environ["TEST_DB_URL"], "-X", "-tA", "-v", "ON_ERROR_STOP=1", "-q"]
U = {"admin": "00000000-0000-0000-0000-00000000000a", "s2": "00000000-0000-0000-0000-0000000000b2", "c1": "00000000-0000-0000-0000-0000000000c1"}
OUT = []


def run(sql, who=None):
    pre = {"anon": "set local role anon;", "service": "set local role service_role;"}.get(who, "")
    if who in U:
        pre = f"set local role authenticated; set local request.jwt.claim.sub = '{U[who]}';"
    p = subprocess.run(PSQL, input=f"begin; {pre} {sql}; commit;", capture_output=True, text=True)
    return p.returncode == 0, (p.stdout.strip() if p.returncode == 0 else p.stderr.strip().splitlines()[0] if p.stderr.strip() else "error")


def val(sql, who=None):
    ok, o = run(sql, who)
    return o.splitlines()[-1].strip() if ok and o else ("ERR: " + o if not ok else "")


def T(cid, title, risk, fn, inp, expected, ref, rationale, actual, result):
    OUT.append(dict(id=cid, title=title, risk=risk, fn=fn, input=inp, expected=expected, unit="-", ref=ref, rationale=rationale, actual=actual, result=result))
    print(f"{result:<10} {cid:<7} [{risk}] {title} → {str(actual)[:150]}")


# ---------- ตั้งค่า (เหมือน tests/rls_test.py) ----------
run("""
insert into staff_roster(email, full_name, role, unit_id) values ('admin@hosp.th','ผู้ดูแลทดสอบ','admin',null), ('s2@gmail.com','เจ้าหน้าที่ทดสอบ','staff',2);
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values
 ('%(admin)s','admin@hosp.th','{"full_name":"A"}','{"provider":"google"}'),
 ('%(s2)s','s2@gmail.com','{"full_name":"S"}','{"provider":"google"}'),
 ('%(c1)s','c1@gmail.com','{"full_name":"C"}','{"provider":"google"}');
""" % U)
run("select ops.set_ai_key('audit-dummy-key')")

DRAFT = """insert into dose_drugs(name,indication,mg_per_kg_min,mg_per_kg_max,per,indications,concs,active,ai_draft,ai_source)
 values ('AUDIT-DRAFT','x',10,20,'day','[{"name":"syn","per":"day","min":20,"max":10}]','[]',false,true,'AI ร่าง · ยังไม่ผ่านการตรวจ') returning id"""

# ---------- สิทธิ์ (RLS) ----------
d = val(DRAFT, "admin")
T("DB-01", "ประชาชน/ไม่ล็อกอินไม่เห็นร่าง AI", "Critical", "RLS dose_read", "anon select ร่าง", "0 แถว", "56_dose_ai_drafts.sql", "ร่างต้องไม่ถึงผู้ใช้",
  val(f"select count(*) from dose_drugs where id={d}", "anon"), "PASS" if val(f"select count(*) from dose_drugs where id={d}", "anon") == "0" else "FAIL")
r = val(f"update dose_drugs set active=true, ai_draft=false where id={d} returning id", "s2")
T("DB-02", "เจ้าหน้าที่อนุมัติร่างเองไม่ได้", "Critical", "RLS dose_admin", "staff update active=true", "0 แถว/ปฏิเสธ", "01 dose_admin policy", "อนุมัติได้เฉพาะผู้ดูแล",
  r or "0 แถว", "PASS" if r in ("", ) or r.startswith("ERR") else "FAIL")
r = val(f"update dose_drugs set active=true, ai_draft=false where id={d} returning id", "anon")
T("DB-03", "ไม่ล็อกอินอนุมัติร่างไม่ได้", "Critical", "grant/RLS", "anon update", "ปฏิเสธ", "03_grants.sql", "", r or "0 แถว", "PASS" if r == "" or r.startswith("ERR") else "FAIL")
r = val(f"update dose_drugs set active=true where id={d} returning id", "admin")
T("DB-04", "ห้าม active ขณะยังเป็นร่าง (constraint)", "High", "check not (ai_draft and active)", "admin set active=true (ai_draft ยัง true)", "ปฏิเสธ", "56_dose_ai_drafts.sql", "", r, "PASS" if r.startswith("ERR") else "FAIL")
r = val(f"update dose_drugs set active=true, ai_draft=false where id={d} returning active", "admin")
T("DB-05", "อนุมัติร่างที่ข้อมูลผิด (min>max, per=day ไม่มี times)", "Critical", "dose_drugs ไม่มี check ของ indications",
  "indications=[{per:day,min:20,max:10}] (ช่องเดิม mg_per_kg_* มี check แต่ indications ไม่มี) → active", "ฐานข้อมูลปฏิเสธข้อมูลขนาดยาที่ไม่สมบูรณ์/ขัดแย้ง", "ข้อกำหนด AI pipeline ขั้นตรวจก่อนใช้",
  "ปุ่มอนุมัติคลิกเดียว (UI-20) + ฐานข้อมูลไม่ตรวจ = ข้อมูลผิดถึงผู้ใช้ได้", f"active={r}", "FAIL" if r == "t" else "PASS")
r = val("""update dose_drugs set indications='[{"name":"syn","per":"dose","min":-5,"max":10}]' where id=1 returning id""", "admin")
T("DB-06a", "บันทึกขนาดยาติดลบ (−5 มก./กก.) ในยาที่แสดงอยู่", "High", "dose_inds_problem (73)", "admin update", "ปฏิเสธ", "ข้อกำหนด 3.4 ค่านอกช่วง", "",
  f"บันทึกได้ id={r}" if r == "1" else r[:120], "FAIL" if r == "1" else "PASS")
r = val("""update dose_drugs set indications='[{"name":"syn","per":"dose","min":1,"max":100000}]' where id=1 returning id""", "admin")
T("DB-06b", "บันทึกขนาดยาสูงผิดปกติ (100000 มก./กก.) ในยาที่แสดงอยู่", "High", "ไม่มีเพดานความสมเหตุสมผล (F-12)", "admin update", "ปฏิเสธ/ติดธงค่าเกินช่วง",
  "ข้อกำหนด 3.4 ค่านอกช่วง", "ต้องมีเพดานตามนโยบายเภสัชกร", f"บันทึกได้ id={r}" if r == "1" else r[:120], "FAIL" if r == "1" else "PASS")
run("""update dose_drugs set indications='[{"name":"syn","per":"dose","min":10,"max":15,"cap":1000}]' where id=1""", "admin")
n0 = val("select count(*) from audit_log")
run("""update dose_drugs set indications='[{"name":"syn","per":"dose","min":10,"max":15,"cap":1000}]' where id=1""", "admin")
n1 = val("select count(*) from audit_log")
T("DB-07", "แก้ขนาดยาหลังอนุมัติ → มีบันทึกการแก้ไข", "High", "write_audit() ไม่ได้ผูกกับ dose_drugs", "admin แก้ indications ของยาที่แสดงอยู่", "audit_log +1 (ใคร/เมื่อไร/ช่องใด)",
  "ข้อกำหนด AI pipeline: เปลี่ยนหลังอนุมัติต้องตรวจสอบย้อนหลังได้", "ไม่มีหลักฐานว่าใครเปลี่ยนตัวเลข", f"audit_log ก่อน {n0} หลัง {n1}", "FAIL" if n0 == n1 else "PASS")
cols = val("select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema='public' and table_name='dose_drugs'")
has = any(c in cols.split(",") for c in ("reviewed_by", "approved_by", "reviewed_at", "approved_at", "version"))
T("DB-08", "บันทึกผู้อนุมัติ/เวลาอนุมัติ/รุ่นข้อมูล", "High", "โครงสร้าง dose_drugs", "information_schema", "มีช่อง reviewed_by/approved_at/version", "ข้อกำหนด AI pipeline ขั้นอนุมัติ",
  "มีแค่ updated_at", cols, "PASS" if has else "FAIL")
hist = val("select count(*) from information_schema.tables where table_schema='public' and table_name ~ '^dose_drugs?_(history|versions?|audit)$'")
T("DB-09", "ประวัติรุ่นข้อมูลขนาดยา (ย้อนดูค่าก่อนแก้)", "Medium", "schema", "หาตาราง dose_drugs_history/versions", "มี", "ข้อกำหนด AI pipeline", "", f"พบ {hist} ตาราง", "PASS" if hist != "0" else "FAIL")
ok_age = val("""select (public.dose_inds_problem('[{"name":"x","per":"dose","min":1,"max":2,"age_min":12,"age_max":2}]') is not null and public.dose_inds_problem('[{"name":"x","per":"dose","min":1,"max":2,"cap_day":0}]') is not null and public.dose_inds_problem('[{"name":"x","per":"day","min":1,"max":2,"times":2,"age_min":1,"age_max":12,"cap_day":100}]') is null)::text""")
T("DB-10", "ข้อบ่งใช้รองรับช่วงอายุ/ขนาดสูงสุดต่อวัน (ระบบตรวจค่า)", "High", "indications jsonb + dose_inds_problem (76)", "ช่วงอายุ 12–2 · cap_day 0 · ค่าถูก",
  "ปฏิเสธช่วงอายุผิด/เพดานต่อวัน ≤ 0 · รับค่าถูก (ช่องทางให้ยา route ยังไม่มี — เครื่องคำนวณใช้กับยารับประทาน)", "ข้อกำหนด 3.4", "age_min/age_max/cap_day อยู่ใน indications",
  f"ตรวจถูกต้อง={ok_age}", "PASS" if ok_age == "true" else "FAIL")
for who in ("s2", "anon"):
    r = val("select ai_dose_start('amoxicillin')", who)
    T(f"DB-11{'a' if who == 's2' else 'b'}", f"{who} เรียก AI ร่างขนาดยาไม่ได้", "High", "ai_dose_start is_admin()", who, "ปฏิเสธ", "56_dose_ai_drafts.sql", "", r[:80], "PASS" if r.startswith("ERR") else "FAIL")

# ---------- AI pipeline (คำตอบจำลอง) ----------
RX = '{"drugGroup":{"conceptGroup":[{"tty":"SCD","conceptProperties":[{"name":"auditcillin 250 MG/5ML Oral Suspension"}]}]}}'
LABEL = lambda dosage, eff="20250101": json.dumps({"results": [{"openfda": {"brand_name": ["Auditbrand"], "generic_name": ["AUDITCILLIN"]}, "effective_time": eff, "set_id": "audit-set",
                                                      "dosage_and_administration": [dosage], "indications_and_usage": ["Infections."]}]})
GEM = lambda obj: json.dumps({"candidates": [{"content": {"parts": [{"text": json.dumps(obj, ensure_ascii=False)}]}}]}, ensure_ascii=False)


def pipeline(label_txt, ai_obj, eff="20250101", gem_raw=None, fda_status=200, rx_status=200):
    """admin เริ่ม → ใส่คำตอบ RxNorm/openFDA → poll → ใส่คำตอบ Gemini → poll → คืน result"""
    i = val("select ai_dose_start('auditcillin')", "admin")
    run(f"insert into net._http_response(id,status_code,content) select rx_req, {rx_status}, $q${RX}$q$ from ai_dose_drafts where id={i}")
    run(f"insert into net._http_response(id,status_code,content) select fda_req, {fda_status}, $q${LABEL(label_txt, eff)}$q$ from ai_dose_drafts where id={i}")
    st = val(f"select ai_dose_poll({i})->>'status'", "admin")
    if st == "pending":
        body = gem_raw if gem_raw is not None else GEM(ai_obj)
        run(f"insert into net._http_response(id,status_code,content) select request_id, 200, $q${body}$q$ from ai_dose_drafts where id={i}")
        val(f"select ai_dose_poll({i})", "admin")
    ok, o = run(f"select coalesce(result::text,'{{}}') || '§' || coalesce(note,'') || '§' || status from ai_dose_drafts where id={i}")
    res, note, status = (o.split("§") + ["", "", ""])[:3]
    return i, (json.loads(res) if res and res != "" else {}), note, status


L1 = "Pediatric patients: 25 mg/kg/day in divided doses every 12 hours."
i, res, note, st = pipeline(L1, {"indications": [{"name": "ติดเชื้อ", "per": "day", "min": 50, "max": 50, "times": 2, "quote": "50 mg/kg/day in divided doses every 12 hours"}]})
ai = res.get("ai") or []
T("AI-01", "AI ตอบตัวเลขที่ไม่มีในฉลาก (hallucination) + quote ที่ไม่มีในฉลาก", "Critical", "ai_dose_step (66) รับ quote โดยไม่เทียบกับข้อความฉลาก",
  "ฉลาก 25 mg/kg/day · AI ตอบ 50 + quote '50 mg/kg/day…'", "ปฏิเสธข้อ (quote ไม่อยู่ในฉลาก)", "prompt สั่งให้ quote ตรงตัว แต่ไม่มีการตรวจ", "ร่างผิด 2 เท่าเข้าคิวรอตรวจโดยดูเหมือนมีหลักฐาน",
  json.dumps(ai, ensure_ascii=False)[:150], "FAIL" if any(x.get("min") == 50 for x in ai) else "PASS")
L2 = "Infants: 10 mcg/kg/day once daily."
i, res, note, st = pipeline(L2, {"indications": [{"name": "syn", "unit": "mg", "per": "day", "min": 10, "max": 10, "times": 1, "quote": "10 mcg/kg/day once daily"}]})
ai = res.get("ai") or []
T("AI-02", "AI ใส่หน่วยผิด (mg แต่ quote เป็น mcg/kg)", "Critical", "ai_dose_step: unit='mcg' เฉพาะเมื่อ AI บอก mcg หรือไม่บอกหน่วย", "unit=mg, quote '10 mcg/kg/day'",
  "unit = mcg หรือปฏิเสธข้อที่หน่วยขัดกับ quote", "ฉลาก (จำลอง)", "เกินขนาด 1000 เท่าถ้าอนุมัติ", json.dumps(ai, ensure_ascii=False)[:150],
  "FAIL" if ai and ai[0].get("unit") != "mcg" else "PASS")
i, res, note, st = pipeline("Children: 5000 mg/kg per dose.", {"indications": [{"name": "syn", "per": "dose", "min": 5000, "max": 5000, "quote": "5000 mg/kg per dose"}]})
ai = res.get("ai") or []
T("AI-03", "ตัวเลขเป็นไปไม่ได้ (5000 มก./กก./ครั้ง)", "High", "ai_dose_step ตรวจแค่เป็นตัวเลขและ max≥min", "min=max=5000", "ปฏิเสธ/ติดธงค่าเกินช่วง", "ข้อกำหนด 3.4",
  "ไม่มีเพดานความสมเหตุสมผล", json.dumps(ai, ensure_ascii=False)[:120], "FAIL" if ai else "PASS")
i, res, note, st = pipeline(L1, None, gem_raw='{"candidates":[]}')
T("AI-04", "API ตอบว่าง (candidates = [])", "High", "ai_dose_step exception/0 ข้อ", "Gemini 200 แต่ว่าง", "ไม่สร้างร่าง + บอกเหตุผล", "", "", f"ai={res.get('ai')} note={note[:60]}",
  "PASS" if not res.get("ai") and note else "FAIL")
i, res, note, st = pipeline(L1, None, fda_status=500, rx_status=500)
T("AI-05", "openFDA/RxNorm ล่ม (500)", "Medium", "ai_dose_step", "rx=500 fda=500", "status=error + ข้อความ", "", "", f"{st} · {note[:60]}", "PASS" if st == "error" else "FAIL")
i, res, note, st = pipeline(L1, {"indications": [{"name": "ติดเชื้อ", "per": "day", "min": 25, "max": 25, "times": 2, "quote": "25 mg/kg/day in divided doses every 12 hours"}]}, eff="19990101")
T("AI-06", "แหล่งข้อมูลเก่า (ฉลากฉบับ 1999)", "Medium", "ai_dose_step/dose_ref", "effective_time=19990101", "ติดธง/เตือนว่าฉลากเก่า", "ข้อกำหนด AI pipeline: outdated source",
  "เก็บวันที่ไว้ในที่มา แต่ไม่ตรวจ/ไม่เตือน", f"label.effective={res.get('label', {}).get('effective')} · ai {len(res.get('ai') or [])} ข้อ · ไม่มีธงเตือน", "FAIL" if res.get("ai") else "PASS")
fq = val(f"select url from net.http_request_queue where id=(select fda_req from ai_dose_drafts where id={i})")
T("AI-07", "ค้นฉลาก openFDA กรองช่องทางให้ยา/รูปแบบ", "High", "ai_dose_fda (50) limit 1", "URL คำขอ", "กรอง route=ORAL หรือเลือกจากหลายฉลาก", "50_ai_dose.sql",
  "limit=1 ไม่กรอง route → อาจได้ฉลากยาฉีด/ยาภายนอก", fq[:150], "FAIL" if "route" not in fq.lower() else "PASS")
# convert: per=day ไม่มี times → ร่างที่ไม่มีจำนวนครั้ง
ok, o = run("""insert into ai_dose_drafts(query, status, stage, auto_name, result) values ('auditnotimes','done','ai','AUDITNOTIMES',
 '{"rx":[],"label":{"dosage":"Children: 20 mg/kg/day.","generic":"auditnotimes"},"ai":[{"name":"syn","per":"day","min":20,"max":20,"quote":"20 mg/kg/day"}]}') returning id""")
cid = o.splitlines()[-1] if ok else ""
outc = val(f"select ai_dose_convert({cid})") if ok else "ERR insert: " + o
row = val("select coalesce(indications->0->>'times','null') || ':' || per || ':' || ai_draft || ':' || coalesce(draft_issue, 'ไม่มีธง') from dose_drugs where name='AUDITNOTIMES'")
T("AI-08", "ร่างต่อวันที่ไม่มีจำนวนครั้ง (times = null) ผ่านการแปลงเป็นร่าง", "High", "ai_dose_convert (67)", "ai=[{per:day, times ไม่มี}]", "ไม่สร้างร่าง หรือติดธงข้อมูลไม่ครบ",
  "ข้อกำหนด 3.4 ความถี่", "ร่างนี้ + ปุ่มอนุมัติคลิกเดียว = เครื่องคำนวณแสดง 'วันละครั้ง' (UI-04)", f"{outc} · times:per:ai_draft:ธง = {row}", "FAIL" if row.startswith("null:day") and row.endswith("ไม่มีธง") else "PASS")
body = val(f"select convert_from(body,'utf8') from net.http_request_queue where id=(select request_id from ai_dose_drafts where id={i})")
T("AI-09", "ข้อมูลที่ส่งให้ Gemini มีเฉพาะชื่อยา+ฉลาก (ไม่มีข้อมูลผู้ป่วย/คีย์)", "High", "ai_dose_step prompt", "body ของคำขอ", "ไม่มีคีย์ ไม่มีข้อมูลผู้ป่วย", "CLAUDE.md (Gemini free tier)", "",
  f"มีคีย์ในเนื้อหา={'audit-dummy-key' in body} · ยาว {len(body)} ตัวอักษร", "PASS" if body and "audit-dummy-key" not in body else "FAIL")

n = lambda r: sum(1 for x in OUT if x["result"] == r)
print(f"\ndb: PASS {n('PASS')} · FAIL {n('FAIL')} · UNVERIFIED {n('UNVERIFIED')} (ทั้งหมด {len(OUT)})")
if "--json" in sys.argv:
    json.dump({"cases": OUT}, open(sys.argv[sys.argv.index("--json") + 1], "w"), ensure_ascii=False, indent=1)
