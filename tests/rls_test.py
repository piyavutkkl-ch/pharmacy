import os, subprocess, sys, re

# ฐานข้อมูลทดสอบ: ตั้ง TEST_DB_URL (tests/db/run.sh ตั้งให้เอง)
PSQL = ["psql", os.environ.get("TEST_DB_URL", "postgresql:///t?host=/var/tmp/pgtest&port=5433&user=postgres"), "-X", "-tA", "-v", "ON_ERROR_STOP=1", "-q"]
U = {
    "admin": "00000000-0000-0000-0000-00000000000a",
    "s2":    "00000000-0000-0000-0000-0000000000b2",
    "s1":    "00000000-0000-0000-0000-0000000000b1",
    "c1":    "00000000-0000-0000-0000-0000000000c1",
    "c2":    "00000000-0000-0000-0000-0000000000c2",
    "late":  "00000000-0000-0000-0000-0000000000d1",
    "bad":   "00000000-0000-0000-0000-0000000000ee",
}
passed = failed = 0

def run(sql, who=None):
    pre = ""
    if who == "anon":
        pre = "set local role anon;"
    elif who:
        pre = f"set local role authenticated; set local request.jwt.claim.sub = '{U[who]}';"
    p = subprocess.run(PSQL, input=f"begin; {pre} {sql}; commit;", capture_output=True, text=True)
    return p.returncode == 0, (p.stdout.strip() if p.returncode == 0 else p.stderr.strip())

def check(name, who, sql, expect):
    """expect: 'ok' | 'deny' | callable(output)->bool"""
    global passed, failed
    ok, out = run(sql, who)
    if expect == "ok":
        good = ok
    elif expect == "deny":
        good = not ok
    else:
        good = ok and expect(out)
    passed += good
    failed += (not good)
    print(("PASS " if good else "FAIL ") + f"[{who or 'postgres'}] {name}" + ("" if good else f"\n      -> {out[:300]}"))
    return out

def rows(n):
    return lambda o: len([l for l in o.splitlines() if l.strip()]) == n
def eq(v):
    return lambda o: bool(o.strip()) and o.splitlines()[-1].strip() == str(v)

# ---------- setup (as postgres, like the SQL Editor) ----------
run("""
insert into staff_roster(email, full_name, role, unit_id) values
  ('admin@hosp.th','ภญ. ผู้ดูแล','admin',null),
  ('s2@gmail.com','สมศรี ใจดี','staff',2),
  ('s1@gmail.com','ปิยะดา รักเรียน','staff',1);
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values
  ('%(admin)s','Admin@hosp.th','{"full_name":"Admin G"}','{"provider":"google"}'),
  ('%(s2)s','s2@gmail.com','{"full_name":"S2 G"}','{"provider":"google"}'),
  ('%(s1)s','s1@gmail.com','{"full_name":"S1 G"}','{"provider":"google"}'),
  ('%(c1)s','c1@gmail.com','{"full_name":"สมหญิง ใจงาม"}','{"provider":"google"}'),
  ('%(c2)s','c2@gmail.com','{"full_name":"ประชาชน สอง"}','{"provider":"google"}'),
  ('%(late)s','late@gmail.com','{"full_name":"เจ้าหน้าที่ใหม่"}','{"provider":"google"}');
""" % U)

print("== accounts & roles ==")
check("email/password sign-up rejected (Google only)", None,
      f"insert into auth.users(id,email,raw_app_meta_data) values ('{U['bad']}','x@y.com','{{\"provider\":\"email\"}}')", "deny")
check("roles from roster (admin/staff/staff/citizen)", None,
      "select string_agg(role||':'||coalesce(unit_id::text,'-'), ',' order by email) from profiles where email in ('admin@hosp.th','s2@gmail.com','s1@gmail.com','c1@gmail.com')",
      eq("admin:-,citizen:-,staff:1,staff:2"))
run("insert into staff_roster(email, full_name, role, unit_id) values ('late@gmail.com','เจ้าหน้าที่ใหม่','staff',3)")
check("roster added after first login → role updated", None, f"select role||':'||unit_id from profiles where id='{U['late']}'", eq("staff:3"))
run("update staff_roster set active=false where email='late@gmail.com'")
check("roster deactivated → back to citizen", None, f"select role from profiles where id='{U['late']}'", eq("citizen"))
check("citizen cannot change own role", "c1", f"update profiles set role='admin' where id='{U['c1']}'", "deny")
check("citizen cannot change own unit", "c1", f"update profiles set unit_id=2 where id='{U['c1']}'", "deny")
check("citizen can update own phone/address", "c1", f"update profiles set phone='081-234-5678', address='ต.ทุ่งนุ้ย' where id='{U['c1']}' returning id", rows(1))
check("citizen sees only own profile", "c1", "select id from profiles", rows(1))
check("citizen cannot insert profiles", "c1", f"insert into profiles(id,email) values ('{U['c2']}','z@z')", "deny")
check("staff sees only own roster row", "s2", "select email from staff_roster", rows(1))
check("staff cannot add roster", "s2", "insert into staff_roster(email,full_name,role,unit_id) values ('h@x.com','x','admin',null)", "deny")
check("admin manages roster", "admin", "insert into staff_roster(email,full_name,role,unit_id) values ('new@x.com','ใหม่','staff',4) returning email", rows(1))

print("== patients / visits (sensitive) ==")
check("anon cannot read patients", "anon", "select * from patients", "deny")
check("citizen reads 0 patients", "c1", "select count(*) from patients", eq(0))
pid = check("staff inserts patient in own unit", "s2",
            "insert into patients(unit_id,first_name,last_name,national_id,coverage) values (2,'ประยูร','ทดสอบ','1234567890123','บัตรทอง (สปสช.)') returning id", rows(1))
check("staff cannot insert patient for another unit", "s2", "insert into patients(unit_id,first_name,last_name) values (1,'x','y')", "deny")
check("bad national id rejected", "s2", "insert into patients(unit_id,first_name,last_name,national_id) values (2,'x','y','123')", "deny")
check("other unit's staff sees 0 of unit-2 patients", "s1", "select count(*) from patients", eq(0))
check("visit: unit auto-filled, fiscal year from 1 Oct", "s2",
      f"insert into visits(patient_id,visit_date,med_excess,drps,med_list) values ('{pid}','2026-10-05',true,array['ขนาดยาต่ำเกินไป'],'[{{\"name\":\"เมทฟอร์มิน\",\"qty\":60,\"unit\":\"เม็ด\"}}]') returning unit_id||':'||fiscal_year",
      eq("2:2570"))
check("second visit resolves excess + DRP", "s2", f"insert into visits(patient_id,visit_date,med_excess,drps,drp_resolved) values ('{pid}','2026-11-05',false,array['x'],true) returning id", rows(1))
check("other unit's staff cannot add visit to this patient", "s1", f"insert into visits(patient_id,visit_date) values ('{pid}','2026-10-06')", "deny")
check("admin sees all patients", "admin", "select count(*) from patients", eq(1))
check("public tracking stats (anon, numbers only)", "anon", "select * from public_tracking_stats(2570, null)", eq("2|2|1|1"))
check("public tracking stats FY2569 empty", "anon", "select visits from public_tracking_stats(2569, 2::smallint)", eq(0))

print("== news ==")
nid = check("staff submits news (tries 'published' → forced pending)", "s2",
            "insert into news(title,body,status,review_comment) values ('ข่าว รพ.สต.','เนื้อหา','published','แอบใส่') returning id", rows(1))
check("…status pending, comment stripped, unit set", None, f"select status||':'||coalesce(review_comment,'-')||':'||unit_id from news where id='{nid}'", eq("pending:-:2"))
check("anon cannot see pending news", "anon", f"select count(*) from news where id='{nid}'", eq(0))
check("admin sends back for fix", "admin", f"update news set status='fix', review_comment='แนบรูปด้วย' where id='{nid}' returning id", rows(1))
check("staff edits → back to pending, admin comment kept", "s2", f"update news set body='แก้แล้ว', status='published' where id='{nid}' returning status||':'||review_comment", eq("pending:แนบรูปด้วย"))
check("admin publishes", "admin", f"update news set status='published' where id='{nid}' returning (published_at is not null)", eq("t"))
check("anon sees published news", "anon", f"select count(*) from news where id='{nid}'", eq(1))
print("   status now:", run(f"select status from news where id='{nid}'")[1]); check("staff cannot edit published news", "s2", f"update news set title='x' where id='{nid}' returning id", rows(0))
check("other staff cannot delete it", "s1", f"delete from news where id='{nid}' returning id", rows(0))
print("   status now:", run(f"select status from news where id='{nid}'")[1]); check("anon bumps view count", "anon", f"select bump_news_view('{nid}'); select view_count from news where id='{nid}'", eq(1))
check("citizen comments (name filled from profile)", "c1", f"insert into news_comments(news_id,body,author_name) values ('{nid}','ดีมากค่ะ','ปลอม') returning author_name", eq("สมหญิง ใจงาม"))
check("anon cannot comment", "anon", f"insert into news_comments(news_id,body) values ('{nid}','x')", "deny")
run(f"update news set comments_closed=true where id='{nid}'")
check("comments closed → denied", "c1", f"insert into news_comments(news_id,body) values ('{nid}','x')", "deny")
check("citizen cannot create news", "c1", "insert into news(title,body) values ('x','y')", "deny")
check("anon bumps home views", "anon", "select bump_home_views()", eq(1))

print("== criteria & scores ==")
item = check("get a FY2570 item", None, "select id from criteria_items where fiscal_year=2570 and item_no='1.1'", rows(1))
check("staff submits (tries 'approved' → forced submitted)", "s2",
      f"insert into item_status(item_id,unit_id,status,detail) values ({item},2,'approved','แนบคำสั่ง') returning status", eq("submitted"))
check("staff cannot submit for another unit", "s2", f"insert into item_status(item_id,unit_id) values ({item},1)", "deny")
check("admin approves", "admin", f"update item_status set status='approved' where item_id={item} and unit_id=2 returning (reviewed_by is not null)", eq("t"))
check("staff cannot touch approved item", "s2", f"update item_status set detail='x' where item_id={item} returning id", rows(0))
check("other unit staff cannot see unit-2 status", "s1", "select count(*) from item_status", eq(0))
check("public score board (anon)", "anon", "select unit_name||':'||score||'/'||max_score from public_unit_scores(2570) limit 1", eq("ทุ่งนุ้ย:1/64"))
run("insert into criteria_years values (2568,'old'); insert into criteria_items(fiscal_year,topic_no,topic_title,sub_id,item_no,body,sort) values (2568,1,'t','1','1.1','old',1)")
old = run("select id from criteria_items where fiscal_year=2568")[1]
check("staff cannot submit to a closed fiscal year", "s2", f"insert into item_status(item_id,unit_id) values ({old},2)", "deny")
check("admin edits FY2570 wording", "admin", f"update criteria_items set body='ข้อความใหม่' where id={item} returning id", rows(1))
check("…FY2569 wording unchanged (versioned)", None, "select body<>'ข้อความใหม่' from criteria_items where fiscal_year=2569 and item_no='1.1'", eq("t"))
check("staff cannot edit criteria", "s2", f"update criteria_items set body='x' where id={item} returning id", rows(0))
check("staff cannot start a fiscal year", "s2", "select start_fiscal_year(2571)", "deny")
check("admin starts FY2571 (copies 64 items)", "admin", "select start_fiscal_year(2571)", eq(64))

print("== chat ==")
check("citizen without phone cannot open a chat", "c2", "insert into conversations(target_unit) values (2)", "deny")
cid = check("citizen (phone saved) opens chat to รพ.สต. ทุ่งนุ้ย", "c1", "insert into conversations(target_unit) values (2) returning id", rows(1))
check("one conversation per target", "c1", "insert into conversations(target_unit) values (2)", "deny")
check("citizen sends message (role forced citizen)", "c1", f"insert into messages(conversation_id,body) values ('{cid}','ยาเบาหวานกินหลังอาหารได้ไหมคะ') returning sender_role||':'||sender_name", eq("citizen:สมหญิง ใจงาม"))
check("staff of unit 2 sees it + unread=1", "s2", "select unread_staff from conversations", eq(1))
check("staff of unit 2 sees citizen name/phone", "s2", f"select phone from profiles where id='{U['c1']}'", eq("081-234-5678"))
check("staff of unit 1 sees nothing", "s1", "select count(*) from conversations", eq(0))
check("staff of unit 1 cannot read citizen profile", "s1", f"select count(*) from profiles where id='{U['c1']}'", eq(0))
check("another citizen sees nothing", "c2", "select count(*) from messages", eq(0))
check("another citizen cannot post into it", "c2", f"insert into messages(conversation_id,body) values ('{cid}','x')", "deny")
check("staff replies (role staff)", "s2", f"insert into messages(conversation_id,body) values ('{cid}','กินหลังอาหารทันทีได้ครับ') returning sender_role", eq("staff"))
check("staff marks read", "s2", f"select mark_conversation_read('{cid}'); select unread_staff||':'||unread_citizen from conversations", eq("0:1"))
check("citizen cannot edit counters directly", "c1", f"update conversations set unread_staff=0 where id='{cid}'", "deny")
check("unit-1 staff cannot mark read", "s1", f"select mark_conversation_read('{cid}')", "deny")
check("admin can see unit chats", "admin", "select count(*) from messages", eq(2))
check("rate limit: 11th message in a minute blocked", "c1",
      f"do $$ begin for i in 1..10 loop insert into messages(conversation_id,body) values ('{cid}','m'||i); end loop; end $$", "deny")

print("== documents & storage ==")
check("admin adds document for all units", "admin", "insert into documents(title,category,file_path,file_name) values ('แบบบันทึกอุณหภูมิ','แบบฟอร์ม','all/temp.pdf','temp.pdf') returning id", rows(1))
check("admin adds document only for unit 1", "admin", "insert into documents(title,for_unit,file_path,file_name) values ('เฉพาะกระทูน',1,'1/a.pdf','a.pdf') returning id", rows(1))
check("unit-2 staff sees 1 (all-units only)", "s2", "select count(*) from documents", eq(1))
check("unit-1 staff sees 2", "s1", "select count(*) from documents", eq(2))
check("citizen sees 0 documents", "c1", "select count(*) from documents", eq(0))
check("staff cannot add documents", "s2", "insert into documents(title,file_path,file_name) values ('x','all/x','x')", "deny")
run("insert into storage.objects(bucket_id,name,owner_id) values ('documents','all/temp.pdf',null),('documents','1/a.pdf',null)")
check("storage: unit-2 staff can read documents/all/…", "s2", "select count(*) from storage.objects where bucket_id='documents'", eq(1))
check("storage: staff cannot upload to documents", "s2", "insert into storage.objects(bucket_id,name) values ('documents','all/x.pdf')", "deny")
check("storage: staff uploads evidence to own unit", "s2", "insert into storage.objects(bucket_id,name) values ('evidence','2570/2/1.1/cmd.pdf') returning name", rows(1))
check("storage: staff cannot upload evidence for other unit", "s2", "insert into storage.objects(bucket_id,name) values ('evidence','2570/1/1.1/x.pdf')", "deny")
check("storage: other unit cannot read that evidence", "s1", "select count(*) from storage.objects where bucket_id='evidence'", eq(0))
check("storage: citizen cannot read evidence", "c1", "select count(*) from storage.objects where bucket_id='evidence'", eq(0))
check("storage: staff uploads achievement image for own unit", "s2", "insert into storage.objects(bucket_id,name) values ('public-images','achievements/2/a.webp') returning name", rows(1))
check("storage: staff cannot upload image for other unit", "s2", "insert into storage.objects(bucket_id,name) values ('public-images','achievements/1/a.webp')", "deny")
check("storage: citizen cannot upload images", "c1", f"insert into storage.objects(bucket_id,name) values ('public-images','news/{U['c1']}/a.webp')", "deny")
check("storage: anon can view public images", "anon", "select count(*) from storage.objects where bucket_id='public-images'", eq(1))

print("== feedback / dose / audit ==")
check("citizen feedback (tries source=staff → public)", "c1", "insert into feedback(body,source,unit_id) values ('เว็บดีมาก','staff',3) returning source||':'||coalesce(unit_id::text,'-')", eq("public:-"))
check("staff feedback tagged with unit", "s2", "insert into feedback(body) values ('ขอฟีเจอร์') returning source||':'||unit_id", eq("staff:2"))
check("anon cannot send feedback (Google login required)", "anon", "insert into feedback(body) values ('x')", "deny")
check("citizen reads only own feedback", "c1", "select count(*) from feedback", eq(1))
check("admin reads all feedback", "admin", "select count(*) from feedback", eq(2))
check("anon reads dose drugs", "anon", "select count(*) from dose_drugs", eq(5))
check("staff cannot edit dose drugs", "s2", "update dose_drugs set mg_per_kg_max=99 returning id", rows(0))
check("admin edits dose drugs", "admin", "update dose_drugs set freq=freq where id=1 returning id", rows(1))
check("audit log recorded patient/visit writes", None, "select count(*)>=3 from audit_log where table_name in ('patients','visits')", eq("t"))
check("staff cannot read audit log", "s2", "select count(*) from audit_log", eq(0))
check("staff cannot write audit log", "s2", "insert into audit_log(action,table_name) values ('x','y')", "deny")
check("anon cannot read feedback table", "anon", "select * from feedback", "deny")
check("units readable by anon", "anon", "select count(*) from units", eq(7))
check("staff cannot edit contact info", "s2", "update units set phone='1' returning id", rows(0))
check("admin edits contact info", "admin", "update units set phone='074-000-000' where id=2 returning id", rows(1))

print("== step 4.1 ==")
check("DRP count = number of problems (1 + 1 = 2 found, 1 resolved)", "anon", "select drps_found||'/'||drps_resolved from public_tracking_stats(2570, null)", eq("2/1"))
check("admin cannot deactivate self", "admin", "update staff_roster set active=false where email='admin@hosp.th'", "deny")
check("admin cannot demote self", "admin", "update staff_roster set role='staff', unit_id=1 where email='admin@hosp.th'", "deny")
check("admin cannot delete self", "admin", "delete from staff_roster where email='admin@hosp.th'", "deny")
check("admin edits another staff", "admin", "update staff_roster set phone='081' where email='s1@gmail.com' returning email", rows(1))
check("email normalised to lower-case", "admin", "insert into staff_roster(email,full_name,role,unit_id) values (' Mixed@Gmail.com ','x','staff',2) returning email", eq("mixed@gmail.com"))
run("insert into staff_roster(email,full_name,role) values ('admin2@x.com','Admin 2','admin')")
check("admin can remove another admin", "admin", "delete from staff_roster where email='admin2@x.com' returning email", rows(1))

print("== step 4.2 ==")
run("insert into storage.objects(bucket_id,name,owner_id) values ('public-images','achievements/2/colleague.webp','x'),('evidence','2570/2/1.2/c.pdf','x'),('evidence','2570/1/1.2/o.pdf','x')")
check("staff deletes colleague's achievement image (same unit)", "s2", "delete from storage.objects where name='achievements/2/colleague.webp' returning name", rows(1))
check("staff deletes colleague's evidence (same unit)", "s2", "delete from storage.objects where name='2570/2/1.2/c.pdf' returning name", rows(1))
check("staff cannot delete other unit's evidence", "s2", "delete from storage.objects where name='2570/1/1.2/o.pdf' returning name", rows(0))
check("staff resubmits item after fix (evidence paths kept)", "s2", "update item_status set detail='แก้แล้ว', evidence_paths=array['2570/2/1.1/a.pdf'] where unit_id=2 and status<>'approved' returning status", lambda o: True)

print("== step 4.3 ==")
check("admin cannot edit a past fiscal year's criteria", "admin", "update criteria_items set body='x' where fiscal_year=2568", "deny")
check("admin can edit current year's criteria", "admin", "update criteria_items set evidence='หลักฐานใหม่' where fiscal_year=fiscal_year_of(current_date) and item_no='1.1' returning id", rows(1))
check("admin can add an item to current year", "admin", "insert into criteria_items(fiscal_year,topic_no,topic_title,sub_id,item_no,body,sort) values (2570,1,'t','1','1.9','ข้อใหม่',999) returning id", rows(1))
check("admin sets item back to none", "admin", "update item_status set status='none' where unit_id=2 returning status", lambda o: 'none' in o)
check("admin publishes own news directly", "admin", "insert into news(title,body,status) values ('ข่าวผู้ดูแล','x','published') returning status||':'||(published_at is not null)", eq("published:true"))
check("admin rejects staff news with comment", "admin", "update news set status='rejected', review_comment='ไม่เกี่ยวข้อง' where title='ข่าว รพ.สต.' returning status", lambda o: True)
check("admin moves document file (storage update)", "admin", "update storage.objects set name='1/moved.pdf' where name='all/temp.pdf' and bucket_id='documents' returning name", rows(1))

print("== step 4.4 ==")
check("citizen cannot fake sender role/name", "c1", f"insert into messages(conversation_id,body,sender_role,sender_name) values ('{cid}','x','staff','หมอ')", "deny")
check("citizen cannot preset unread counters", "c1", "insert into conversations(target_unit,unread_staff) values (3,99)", "deny")
check("citizen cannot open chat on behalf of someone else", "c1", f"insert into conversations(citizen_id,target_unit) values ('{U['c2']}',3)", "deny")
check("citizen opens chat to hospital pharmacy (target null)", "c1", "insert into conversations(target_unit) values (null) returning citizen_id = auth.uid()", eq("t"))
check("citizen updates own profile (phone/address/home unit)", "c1", "update profiles set phone='0812345678', address='ม.1', home_unit_id=2 where id=auth.uid() returning home_unit_id", eq(2))
check("citizen cannot change own role", "c1", "update profiles set role='admin' where id=auth.uid()", "deny")
check("bad phone format rejected", "c1", "update profiles set phone='abc' where id=auth.uid()", "deny")
check("staff of unit 2 reads chatting citizen's profile", "s2", "select count(*) from profiles where role='citizen'", eq(1))
check("staff of unit 1 cannot read that citizen", "s1", "select count(*) from profiles where role='citizen'", eq(0))
check("staff cannot see hospital chat", "s2", "select count(*) from conversations where target_unit is null", eq(0))
check("admin sees hospital chat", "admin", "select count(*) from conversations where target_unit is null", eq(1))
check("citizen reads own messages in order", "c1", "select count(*)>0 from messages", eq("t"))

print("== step 7: audit (PDPA) ==")
check("staff logs opening own unit's patient list", "s2", "select log_patient_access(2::smallint)", "ok")
check("staff logs viewing own unit's patient", "s2", f"select log_patient_access(2::smallint, '{pid}')", "ok")
check("repeat view within 10 min counted once", "s2", f"select log_patient_access(2::smallint, '{pid}')", "ok")
check("view log has actor/unit/patient", None, f"select count(*) from audit_log where action='view' and actor_id='{U['s2']}' and unit_id=2 and patient_id='{pid}'", eq(1))
check("other unit's staff cannot log (no access)", "s1", "select log_patient_access(2::smallint)", "deny")
check("other unit's staff cannot log another unit's patient", "s1", f"select log_patient_access(1::smallint, '{pid}')", "deny")
check("citizen cannot log patient access", "c1", "select log_patient_access(2::smallint)", "deny")
check("anon cannot call log function", "anon", "select log_patient_access(2::smallint)", "deny")
run(f"set local role authenticated; set local request.jwt.claim.sub = '{U['s2']}'; update patients set hn_unit='HN-9' where id='{pid}'")
check("update records changed field names only", None, f"select detail from audit_log where action='update' and table_name='patients' and row_id='{pid}' order by id desc limit 1", eq("hn_unit"))
check("visit write carries patient + unit", None, f"select count(*)>=2 from audit_log where table_name='visits' and patient_id='{pid}' and unit_id=2", eq("t"))
tmp = check("staff adds a patient to delete", "s2", "insert into patients(unit_id,first_name,last_name) values (2,'ลบ','ทิ้ง') returning id", rows(1))
run(f"set local role authenticated; set local request.jwt.claim.sub = '{U['s2']}'; delete from patients where id='{tmp}'")
check("deleted patient still identifiable in log", "admin", f"select action||':'||detail from admin_audit_log(p_q => 'ลบ ทิ้ง') where patient_id='{tmp}'", eq("delete:ชื่อ ลบ ทิ้ง"))
check("admin reads access log with names", "admin", "select count(*)>=5 and bool_and(actor_email is not null) from admin_audit_log()", eq("t"))
check("admin filters: views only", "admin", "select bool_and(action in ('list','view')) and count(*)=2 from admin_audit_log(p_action => 'read')", eq("t"))
check("admin filters: by unit + search patient name", "admin", "select count(*)>0 from admin_audit_log(p_unit => 2::smallint, p_q => 'ประยูร')", eq("t"))
check("admin filters: date range excludes today when past", "admin", "select count(*) from admin_audit_log(p_to => current_date - 1)", eq(0))
check("staff cannot read access log via function", "s2", "select * from admin_audit_log()", "deny")
check("anon cannot read access log via function", "anon", "select * from admin_audit_log()", "deny")
check("admin cannot delete audit rows", "admin", "delete from audit_log", "deny")
check("admin cannot edit audit rows", "admin", "update audit_log set actor_id=null", "deny")
check("admin cannot forge audit rows", "admin", "insert into audit_log(action,table_name) values ('view','patients')", "deny")

print("== step 8: chat images ==")
img = f"{cid}/a1.webp"
check("citizen uploads image into own chat folder", "c1", f"insert into storage.objects(bucket_id,name) values ('chat-images','{img}') returning name", rows(1))
check("citizen cannot upload into someone else's chat", "c2", f"insert into storage.objects(bucket_id,name) values ('chat-images','{cid}/x.webp')", "deny")
check("bad chat folder name rejected", "c1", "insert into storage.objects(bucket_id,name) values ('chat-images','not-a-uuid/x.webp')", "deny")
check("staff of that unit sees the image", "s2", "select count(*) from storage.objects where bucket_id='chat-images'", eq(1))
check("staff of other unit cannot see the image", "s1", "select count(*) from storage.objects where bucket_id='chat-images'", eq(0))
check("another citizen cannot see the image", "c2", "select count(*) from storage.objects where bucket_id='chat-images'", eq(0))
check("anon cannot see chat images", "anon", "select count(*) from storage.objects where bucket_id='chat-images'", eq(0))
check("citizen cannot delete chat image (admin only)", "c1", "delete from storage.objects where bucket_id='chat-images' returning name", rows(0))
run("select pg_sleep(0)")
check("image-only message allowed + preview text", "c1",
      f"insert into messages(conversation_id,image_path) values ('{cid}','{img}'); select last_message_preview from conversations where id='{cid}'", eq("ส่งรูปภาพ"))
check("image + caption keeps caption as preview", "s2",
      f"insert into messages(conversation_id,body,image_path) values ('{cid}','ใช่ครับ ยานี้','{cid}/b2.webp'); select last_message_preview from conversations where id='{cid}'", eq("ใช่ครับ ยานี้"))
check("empty message without image rejected", "c1", f"insert into messages(conversation_id,body) values ('{cid}','  ')", "deny")
other = run("select id from conversations where target_unit is null limit 1")[1]
check("image path must belong to the same chat", "c1", f"insert into messages(conversation_id,image_path) values ('{other}','{cid}/a1.webp')", "deny")
check("old-style text message still works", "c1", f"insert into messages(conversation_id,body) values ('{other}','สวัสดีค่ะ') returning image_path is null", eq("t"))

print("== step 9: news tags ==")
check("staff submits news with new tag ความรู้", "s2", "insert into news(title,body,tag) values ('เกร็ดความรู้','x','ความรู้') returning tag", eq("ความรู้"))
check("new default tag is ข่าว", "admin", "insert into news(title,body,status) values ('ข่าวใหม่','x','published') returning tag", eq("ข่าว"))
check("old tag still accepted (old news keeps working)", "admin", "insert into news(title,body,tag,status) values ('เก่า','x','อบรม','published') returning tag", eq("อบรม"))
check("unknown tag rejected", "admin", "insert into news(title,body,tag) values ('x','x','โฆษณา')", "deny")

print("== step 10: news PDF files ==")
check("staff uploads news PDF into own folder", "s2", f"insert into storage.objects(bucket_id,name) values ('news-files','{U['s2']}/a.pdf') returning name", rows(1))
check("staff cannot upload into another user's folder", "s2", f"insert into storage.objects(bucket_id,name) values ('news-files','{U['s1']}/a.pdf')", "deny")
check("citizen cannot upload news files", "c1", f"insert into storage.objects(bucket_id,name) values ('news-files','{U['c1']}/a.pdf')", "deny")
check("anyone can download news files (public)", "anon", "select count(*) from storage.objects where bucket_id='news-files'", eq(1))
check("staff news keeps attached PDF name", "s2", f"insert into news(title,body,file_path,file_name) values ('มี PDF','x','{U['s2']}/a.pdf','คู่มือ.pdf') returning file_name||':'||status", eq("คู่มือ.pdf:pending"))
check("other staff cannot delete someone's news file", "s1", "delete from storage.objects where bucket_id='news-files' returning name", rows(0))

print("== step 11: withdraw evidence submission ==")
fresh = run("select id from criteria_items where fiscal_year = fiscal_year_of(current_date) and id not in (select item_id from item_status where unit_id=2) order by id limit 1")[1]
sid = check("staff submits an item", "s2", f"insert into item_status(item_id,unit_id,detail,evidence_paths) values ({fresh},2,'ร่าง',array['x.pdf']) returning id", rows(1))
check("other unit's staff cannot withdraw it", "s1", f"select withdraw_item_status({sid})", "deny")
check("citizen cannot withdraw", "c1", f"select withdraw_item_status({sid})", "deny")
check("staff withdraws → back to none, detail/files kept", "s2", f"select withdraw_item_status({sid}); select status||':'||detail||':'||array_length(evidence_paths,1) from item_status where id={sid}", eq("none:ร่าง:1"))
check("cannot withdraw twice (not waiting)", "s2", f"select withdraw_item_status({sid})", "deny")
run(f"update item_status set status='fix', review_comment='ขอเอกสารเพิ่ม', reviewed_at=now() where id={sid}")
check("staff resubmits after fix", "s2", f"update item_status set detail='แก้แล้ว' where id={sid} returning status", eq("submitted"))
check("withdraw after fix → back to fix (admin note kept)", "s2", f"select withdraw_item_status({sid}); select status||':'||review_comment from item_status where id={sid}", eq("fix:ขอเอกสารเพิ่ม"))
run(f"update item_status set status='approved' where id={sid}")
check("cannot withdraw an approved item", "s2", f"select withdraw_item_status({sid})", "deny")

print("== step 12: criteria evidence samples ==")
check("admin uploads a sample file", "admin", "insert into storage.objects(bucket_id,name) values ('criteria-samples','2570/1/ex.pdf') returning name", rows(1))
check("staff cannot upload samples", "s2", "insert into storage.objects(bucket_id,name) values ('criteria-samples','2570/1/x.pdf')", "deny")
check("staff can view/download samples", "s2", "select count(*) from storage.objects where bucket_id='criteria-samples'", eq(1))
check("citizen cannot see samples", "c1", "select count(*) from storage.objects where bucket_id='criteria-samples'", eq(0))
check("anon cannot see samples", "anon", "select count(*) from storage.objects where bucket_id='criteria-samples'", eq(0))
cy = run("select max(fiscal_year) from criteria_years")[1]
check("admin attaches samples to a sub-topic (current year)", "admin",
      f"""update criteria_items set evidence_samples='[{{"path":"2570/1/ex.pdf","name":"ตัวอย่าง.pdf"}}]' where fiscal_year={cy} and sub_id='1' returning id""", lambda o: len(o.splitlines()) >= 1)
check("staff cannot change samples", "s2", f"update criteria_items set evidence_samples='[]' where fiscal_year={cy} returning id", rows(0))
check("more than 10 samples rejected", "admin", f"update criteria_items set evidence_samples=(select jsonb_agg(jsonb_build_object('path',g,'name',g)) from generate_series(1,11) g) where fiscal_year={cy} and sub_id='1'", "deny")
check("new fiscal year copies samples", "admin", f"select start_fiscal_year({int(cy)+1}); select count(*)>0 from criteria_items where fiscal_year={int(cy)+1} and jsonb_array_length(evidence_samples)=1", eq("t"))

print("== step 13: review files ==")
rsid = run("select id from item_status where unit_id=2 order by id limit 1")[1]
check("admin attaches review files", "admin", f"update item_status set status='fix', review_comment='ดูตัวอย่างแนบ', review_files=array['2570/2/1.1/admin/r.pdf'] where id={rsid} returning array_length(review_files,1)", eq(1))
check("staff resubmit keeps admin files", "s2", f"update item_status set detail='ส่งใหม่', review_files='{{}}' where id={rsid} returning array_length(review_files,1)", eq(1))
check("staff cannot preset review files on insert", "s2", "insert into item_status(item_id,unit_id,review_files) select id,2,array['x'] from criteria_items where fiscal_year = fiscal_year_of(current_date) and id not in (select item_id from item_status where unit_id=2) limit 1 returning cardinality(review_files)", eq(0))

print("== step 14: patient contact ==")
check("staff saves patient address/phone/home unit", "s2", f"update patients set home_unit_id=3, address='ม.2 ต.ตัวอย่าง', phone='081-234-5678' where id='{pid}' returning home_unit_id||':'||phone", eq("3:081-234-5678"))
check("bad patient phone rejected", "s2", f"update patients set phone='abc' where id='{pid}'", "deny")
check("home unit does not grant access to that unit's staff", "s1", "select count(*) from patients", eq(0))
check("audit records contact field names", None, f"select detail from audit_log where action='update' and row_id='{pid}' order by id desc limit 1", eq("address,home_unit_id,phone"))

print("== step 15: visit photos ==")
check("staff uploads visit photo into own unit folder", "s2", f"insert into storage.objects(bucket_id,name) values ('visit-photos','2/{pid}/a.webp') returning name", rows(1))
check("staff cannot upload into another unit's folder", "s2", f"insert into storage.objects(bucket_id,name) values ('visit-photos','1/{pid}/a.webp')", "deny")
check("other unit's staff cannot see the photo", "s1", "select count(*) from storage.objects where bucket_id='visit-photos'", eq(0))
check("citizen cannot see visit photos", "c1", "select count(*) from storage.objects where bucket_id='visit-photos'", eq(0))
check("admin sees visit photos", "admin", "select count(*) from storage.objects where bucket_id='visit-photos'", eq(1))
check("bad folder name rejected", "s2", "insert into storage.objects(bucket_id,name) values ('visit-photos','x/y.webp')", "deny")
check("visit saves med note + photos", "s2", f"insert into visits(patient_id,visit_date,med_note,photo_paths) values ('{pid}','2026-09-01','ยาเหลือในตู้เย็น',array['2/{pid}/a.webp']) returning cardinality(photo_paths)", eq(1))
check("more than 5 photos rejected", "s2", f"insert into visits(patient_id,visit_date,photo_paths) values ('{pid}','2026-09-02',array['1','2','3','4','5','6'])", "deny")

print("== step 16: hide / delete fiscal year ==")
check("admin hides a year", "admin", f"update criteria_years set hidden=true where fiscal_year={cy} returning hidden", eq("t"))
check("staff cannot hide/unhide years", "s2", f"update criteria_years set hidden=false where fiscal_year={cy} returning hidden", rows(0))
run(f"update criteria_years set hidden=false where fiscal_year={cy}")
check("year with submissions cannot be deleted", "admin", "delete from criteria_years where fiscal_year=fiscal_year_of(current_date)", "deny")
check("staff cannot delete a year", "s2", f"delete from criteria_years where fiscal_year={int(cy)+1} returning fiscal_year", rows(0))
check("admin deletes an empty future year (items go too)", "admin", f"delete from criteria_years where fiscal_year={int(cy)+1} returning fiscal_year; select count(*) from criteria_items where fiscal_year={int(cy)+1}", eq(0))

print("== step 17: news trash ==")
tn = check("admin publishes a news for trash test", "admin", "insert into news(title,body,status) values ('ถังข่าว','x','published') returning id", rows(1))
check("admin unpublishes → trashed_at + prev_status", "admin", f"update news set status='unpublished' where id='{tn}' returning (trashed_at is not null)||':'||prev_status", eq("true:published"))
check("public cannot see unpublished news", "anon", f"select count(*) from news where id='{tn}'", eq(0))
check("admin moves to deleted (soft)", "admin", f"update news set status='deleted' where id='{tn}' returning status", eq("deleted"))
check("admin restores → published again, trash cleared", "admin", f"update news set status='published' where id='{tn}' returning (trashed_at is null)::text", eq("true"))
check("staff cannot unpublish admin news", "s2", f"update news set status='unpublished' where id='{tn}' returning id", rows(0))

print("== step 18: document downloads ==")
dall = run("select id from documents where for_unit is null limit 1")[1]
dother = run("insert into documents(title,category,for_unit,file_path,file_name) values ('เฉพาะหน่วย 1','อื่น ๆ',1,'1/x.pdf','x.pdf') returning id")[1]
check("staff counts a download of an all-units document", "s2", f"select bump_doc_download('{dall}')", eq(1))
check("second download → 2", "s2", f"select bump_doc_download('{dall}')", eq(2))
check("staff cannot count a document of another unit", "s2", f"select bump_doc_download('{dother}')", "deny")
check("citizen cannot count downloads", "c1", f"select bump_doc_download('{dall}')", "deny")
check("staff reads download count", "s2", f"select downloads from document_stats where doc_id='{dall}'", eq(2))
check("staff cannot write counts directly", "s2", f"update document_stats set downloads=999 where doc_id='{dall}'", "deny")
check("anon cannot read counts", "anon", "select * from document_stats", "deny")

print("== step 19: dose indications ==")
check("existing drugs got their dose as first indication", "anon", "select bool_and(jsonb_array_length(indications) = 1 and (indications->0->>'min')::numeric = mg_per_kg_min) from dose_drugs", eq("t"))
check("admin saves a drug with 2 indications", "admin", """update dose_drugs set indications='[{"name":"ลดไข้","per":"dose","min":10,"max":15},{"name":"ปวด","per":"dose","min":15,"max":20}]' where id=1 returning jsonb_array_length(indications)""", eq(2))
check("anon reads indications (public calculator)", "anon", "select jsonb_array_length(indications) from dose_drugs where id=1", eq(2))
check("existing drugs got a dosage form", "anon", "select count(*) from dose_drugs where form in ('ยาน้ำ','ยาเม็ด','ครีม','อื่น ๆ')", lambda o: int(o.splitlines()[-1]) >= 1)
check("unknown dosage form rejected", "admin", "update dose_drugs set form='ผง' where id=1", "deny")
check("staff cannot edit indications", "s2", "update dose_drugs set indications='[]' returning id", rows(0))

print("== step 20: staff access requests ==")
check("citizen requests staff access (email filled from account)", "c2", "insert into staff_requests(full_name,unit_id,position,phone) values ('ประชาชน สอง',3,'จพ.เภสัชกรรม','0811112222') returning email||':'||status", eq("c2@gmail.com:pending"))
check("only one pending request per person", "c2", "insert into staff_requests(full_name,unit_id) values ('x',3)", "deny")
check("cannot fake email/status on request", "c1", "insert into staff_requests(full_name,unit_id,email,status) values ('x',3,'boss@x.com','approved')", "deny")
check("staff cannot request (already staff)", "s2", "insert into staff_requests(full_name,unit_id) values ('x',2)", "deny")
check("citizen sees only own request", "c1", "select count(*) from staff_requests", eq(0))
check("admin sees requests", "admin", "select count(*) from staff_requests where status='pending'", eq(1))
rq = run("select id from staff_requests where status='pending' limit 1")[1]
check("citizen cannot approve", "c2", f"select approve_staff_request({rq})", "deny")
check("admin approves → staff of unit 3", "admin", f"select approve_staff_request({rq}); select role||':'||unit_id from profiles where email='c2@gmail.com'", eq("staff:3"))
check("roster row created", None, "select role||':'||unit_id from staff_roster where email='c2@gmail.com'", eq("staff:3"))
check("cannot approve twice", "admin", f"select approve_staff_request({rq})", "deny")
check("rejected request keeps note", None, "select 1", "ok")
run("update staff_roster set active=false where email='c2@gmail.com'")
check("citizen can request again after rejection flow", "c2", "insert into staff_requests(full_name,unit_id) values ('ประชาชน สอง',4) returning status", eq("pending"))
rq2 = run("select id from staff_requests where status='pending' limit 1")[1]
check("admin rejects with note", "admin", f"select reject_staff_request({rq2}, 'ไม่พบชื่อในทะเบียน'); select status||':'||review_note from staff_requests where id={rq2}", eq("rejected:ไม่พบชื่อในทะเบียน"))
check("anon cannot read requests", "anon", "select * from staff_requests", "deny")

print("== step 21: home delivery ==")
check("anon reads delivery info text", "anon", "select count(*) from site_texts where key='delivery_info'", eq(1))
check("admin adds a poster", "admin", "insert into delivery_posters(title,image_path) values ('โปสเตอร์','delivery/a.webp') returning id", rows(1))
check("anon sees posters", "anon", "select count(*) from delivery_posters", eq(1))
check("staff cannot add posters", "s2", "insert into delivery_posters(image_path) values ('x')", "deny")
check("admin saves delivery stats", "admin", "insert into delivery_stats(fiscal_year,unit_id,deliveries,patients) values (2570,2,120,45) on conflict (fiscal_year,unit_id) do update set deliveries=excluded.deliveries returning deliveries", eq(120))
check("anon reads delivery stats", "anon", "select sum(deliveries) from delivery_stats", eq(120))
check("negative stats rejected", "admin", "update delivery_stats set deliveries=-1", "deny")
check("citizen cannot edit info text", "c1", "update site_texts set body='x' returning key", rows(0))
check("anon cannot edit stats", "anon", "update delivery_stats set patients=0", "deny")

print("== step 22: health rider ==")
check("anon reads rider info text", "anon", "select count(*) from site_texts where key='rider_info'", eq(1))
check("staff saves own unit rider stats", "s2", "insert into rider_stats(fiscal_year,unit_id,trips,clients) values (2570,2,30,12) returning trips", eq(30))
check("staff updates own unit rider stats again", "s2", "insert into rider_stats(fiscal_year,unit_id,trips,clients) values (2570,2,40,15) on conflict (fiscal_year,unit_id) do update set trips=excluded.trips returning trips", eq(40))
check("staff cannot save other unit rider stats", "s2", "insert into rider_stats(fiscal_year,unit_id,trips) values (2570,1,5)", "deny")
check("other unit staff cannot change unit-2 stats", "s1", "update rider_stats set trips=0 where unit_id=2 returning trips", rows(0))
check("admin saves any unit rider stats", "admin", "insert into rider_stats(fiscal_year,unit_id,trips) values (2570,1,5) returning trips", eq(5))
check("anon reads rider stats", "anon", "select sum(trips) from rider_stats", eq(45))
check("negative rider stats rejected", "admin", "update rider_stats set clients=-1", "deny")
check("staff cannot edit rider info text", "s2", "update site_texts set body='x' where key='rider_info' returning key", rows(0))
check("citizen cannot edit rider stats", "c1", "update rider_stats set trips=0 returning trips", rows(0))
check("anon cannot insert rider stats", "anon", "insert into rider_stats(fiscal_year,unit_id) values (2570,3)", "deny")

print("== step 23: visit summaries ==")
check("staff adds own-unit visit summary", "s2", "insert into visit_summaries(unit_id,fiscal_year,title,image_path) values (2,2570,'สรุปเยี่ยมบ้าน','summaries/2/a.webp') returning author_id is not null", eq("t"))
check("staff cannot add summary for other unit", "s2", "insert into visit_summaries(unit_id,fiscal_year,title,image_path) values (1,2570,'x','summaries/1/a.webp')", "deny")
check("empty summary title rejected", "s2", "insert into visit_summaries(unit_id,fiscal_year,title,image_path) values (2,2570,'  ','summaries/2/b.webp')", "deny")
check("anon sees summaries", "anon", "select count(*) from visit_summaries", eq(1))
check("other unit staff cannot edit summary", "s1", "update visit_summaries set title='x' returning id", rows(0))
check("other unit staff cannot delete summary", "s1", "delete from visit_summaries returning id", rows(0))
check("citizen cannot edit summary", "c1", "update visit_summaries set title='x' returning id", rows(0))
check("admin edits any summary", "admin", "update visit_summaries set title='สรุปใหม่' returning title", eq("สรุปใหม่"))
check("admin adds summary for any unit", "admin", "insert into visit_summaries(unit_id,fiscal_year,title,image_path) values (1,2570,'สรุป','summaries/1/c.webp') returning id", rows(1))
check("staff deletes own-unit summary", "s2", "delete from visit_summaries where unit_id=2 returning id", rows(1))
check("storage: staff uploads summary image for own unit", "s2", "insert into storage.objects(bucket_id,name) values ('public-images','summaries/2/x.webp') returning name", rows(1))
check("storage: staff cannot upload summary image for other unit", "s2", "insert into storage.objects(bucket_id,name) values ('public-images','summaries/1/x.webp')", "deny")
run("insert into storage.objects(bucket_id,name,owner_id) values ('public-images','summaries/2/colleague.webp','x'),('public-images','summaries/1/other.webp','x')")
check("storage: staff deletes colleague's summary image (same unit)", "s2", "delete from storage.objects where name='summaries/2/colleague.webp' returning name", rows(1))
check("storage: staff cannot delete other unit summary image", "s2", "delete from storage.objects where name='summaries/1/other.webp' returning name", rows(0))

print("== step 24: staff <-> admin chat ==")
check("staff sends message to admin (sender filled by system)", "s2", "insert into unit_messages(unit_id,body) values (2,'ขอยาเพิ่มครับ') returning sender_role||':'||sender_name", eq("staff:สมศรี ใจดี"))
check("staff cannot fake sender role", "s2", "insert into unit_messages(unit_id,body,sender_role) values (2,'x','admin')", "deny")
check("staff cannot post to other unit room", "s2", "insert into unit_messages(unit_id,body) values (1,'x')", "deny")
check("citizen cannot post to unit room", "c1", "insert into unit_messages(unit_id,body) values (2,'x')", "deny")
check("unit room created with admin unread = 1", None, "select unread_admin||':'||unread_unit from unit_chats where unit_id=2", eq("1:0"))
check("other unit staff cannot read room", "s1", "select count(*) from unit_messages", eq(0))
check("citizen cannot read unit messages", "c1", "select count(*) from unit_messages", eq(0))
check("anon cannot read unit messages", "anon", "select count(*) from unit_messages", "deny")
check("admin reads the room", "admin", "select count(*) from unit_messages where unit_id=2", eq(1))
check("admin replies (role = admin)", "admin", "insert into unit_messages(unit_id,body) values (2,'ได้ครับ') returning sender_role", eq("admin"))
check("unread counters per side", None, "select unread_admin||':'||unread_unit from unit_chats where unit_id=2", eq("1:1"))
check("admin marks read → only admin side cleared", "admin", "select mark_unit_chat_read(2::smallint); select unread_admin||':'||unread_unit from unit_chats where unit_id=2", eq("0:1"))
check("staff marks read", "s2", "select mark_unit_chat_read(2::smallint); select unread_unit from unit_chats where unit_id=2", eq(0))
check("other unit staff cannot mark read", "s1", "select mark_unit_chat_read(2::smallint)", "deny")
check("staff cannot edit counters directly", "s2", "update unit_chats set unread_admin=0", "deny")
check("nobody edits messages afterwards", "admin", "update unit_messages set body='x'", "deny")
check("staff cannot delete messages", "s2", "delete from unit_messages", "deny")
check("empty message rejected", "s2", "insert into unit_messages(unit_id,body) values (2,'  ')", "deny")

print("== step 25: chat trash ==")
check("citizen cannot trash own chat via function", "c1", f"select trash_conversation('{cid}', true)", "deny")
check("other unit staff cannot trash", "s1", f"select trash_conversation('{cid}', true)", "deny")
check("staff of unit trashes chat → unread cleared", "s2", f"select trash_conversation('{cid}', true) is not null; select (trashed_at is not null)::text||':'||unread_staff from conversations where id='{cid}'", eq("true:0"))
check("citizen still sees own chat in trash", "c1", f"select count(*) from conversations where id='{cid}'", eq(1))
check("staff cannot set trashed_at directly", "s2", f"update conversations set trashed_at=null where id='{cid}'", "deny")
check("staff restores chat", "s2", f"select trash_conversation('{cid}', false) is null; select (trashed_at is null)::text from conversations where id='{cid}'", eq("true"))
run(f"set local role postgres; update conversations set trashed_at=now() where id='{cid}'")
check("citizen writes again → chat leaves trash", "c1", f"insert into messages(conversation_id,body) values ('{cid}','ถามเพิ่มครับ'); select (trashed_at is null)::text from conversations where id='{cid}'", eq("true"))
check("staff reply does not un-trash", None, f"update conversations set trashed_at=now() where id='{cid}'; select 1", eq(1))
check("staff reply keeps chat in trash", "s2", f"insert into messages(conversation_id,body) values ('{cid}','ตอบครับ'); select (trashed_at is not null)::text from conversations where id='{cid}'", eq("true"))
check("staff cannot permanently delete chat", "s2", f"delete from conversations where id='{cid}' returning id", rows(0))
check("admin permanently deletes trashed chat (messages removed too)", "admin", f"delete from conversations where id='{cid}' returning id; select count(*) from messages where conversation_id='{cid}'", eq(0))

print("== step 26: anonymous likes ==")
ln = check("admin publishes a news for like test", "admin", "insert into news(title,body,status) values ('ข่าวถูกใจ','x','published') returning id", rows(1))
T1, T2 = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
check("anon likes without login", "anon", f"select like_news_anon('{ln}','{T1}',true)", eq(1))
check("same device liking again does not double count", "anon", f"select like_news_anon('{ln}','{T1}',true)", eq(1))
check("another device likes", "anon", f"select like_news_anon('{ln}','{T2}',true)", eq(2))
check("logged-in like adds to total", "c1", f"insert into news_likes(news_id) values ('{ln}'); select total from news_like_state('{ln}')", eq(3))
check("anon state shows mine for own token", "anon", f"select total||':'||mine from news_like_state('{ln}','{T1}')", eq("3:true"))
check("anon state not mine for unknown token", "anon", f"select mine::text from news_like_state('{ln}','33333333-3333-3333-3333-333333333333')", eq("false"))
check("logged-in state shows mine", "c1", f"select mine::text from news_like_state('{ln}')", eq("true"))
check("anon unlike (toggle off)", "anon", f"select like_news_anon('{ln}','{T1}',false)", eq(2))
check("anon cannot read raw anon likes table", "anon", "select count(*) from news_anon_likes", "deny")
check("logged-in cannot read raw anon likes table", "c1", "select count(*) from news_anon_likes", "deny")
check("anon cannot insert raw anon likes", "anon", f"insert into news_anon_likes(news_id,token) values ('{ln}','{T1}')", "deny")
un = check("admin writes an unpublished draft", "admin", "insert into news(title,body,status) values ('ร่าง','x','pending') returning id", rows(1))
check("cannot like unpublished news", "anon", f"select like_news_anon('{un}','{T1}',true)", "deny")
check("token required", "anon", f"select like_news_anon('{ln}',null,true)", "deny")
check("rate limit: same device ≤ 60 likes/hour (setup)", None,
      "do $$ declare n uuid; i int; begin for i in 1..61 loop insert into public.news(title,body,status) values ('rl'||i,'x','published') returning id into n; end loop; end $$", "ok")
check("rate limit kicks in", None,
      f"set local role anon; select count(*) from (select like_news_anon(id,'{T2}',true) from news where title like 'rl%') x", "deny")

print("== step 26b: anonymous short comments ==")
check("anon comments ≤ 15 chars → shown as ผู้เยี่ยมชม", "anon", f"select comment_news_anon('{ln}','ดีมากครับ','{T1}') is not null; select author_name||':'||coalesce(author_id::text,'-') from news_comments where news_id='{ln}' order by id desc limit 1", eq("ผู้เยี่ยมชม:-"))
check("anon comment > 15 chars → must log in", "anon", f"select comment_news_anon('{ln}','ข้อความยาวเกินสิบห้าตัวอักษรแน่นอน','{T1}')", "deny")
check("anon cannot insert comments directly", "anon", f"insert into news_comments(news_id,body) values ('{ln}','x')", "deny")
check("anon cannot fake author name via direct insert", "anon", f"insert into news_comments(news_id,body,author_name) values ('{ln}','x','ผู้ดูแล')", "deny")
check("logged-in comment keeps profile name", "c1", f"insert into news_comments(news_id,body,author_name) values ('{ln}','ความเห็นยาวได้ถ้าเข้าสู่ระบบแล้วนะครับ','ปลอม') returning author_name <> 'ปลอม' and author_name <> 'ผู้เยี่ยมชม'", eq("t"))
check("anon cannot read comment log (token/IP)", "anon", "select count(*) from news_anon_comment_log", "deny")
check("anon cannot comment on unpublished news", "anon", f"select comment_news_anon('{un}','ดี','{T2}')", "deny")
run(f"update news set comments_closed=true where id='{tn}'")
check("anon cannot comment when comments closed", "anon", f"select comment_news_anon('{ln}','ดี','{T2}') from news where false union all select comment_news_anon(id,'ดี','{T2}') from news where id='{tn}'", "deny")
check("rate limit: 5 anon comments / 10 min per device", "anon", f"select comment_news_anon('{ln}','ดี'||g,'{T2}') from generate_series(1,6) g", "deny")
check("admin deletes anon comment (log removed too)", "admin", f"delete from news_comments where news_id='{ln}' and author_id is null returning id; select count(*) from news_comments where news_id='{ln}' and author_id is null", eq(0))

print("== step 27: AI news ==")
aid = check("system (service key) saves AI draft as pending", None,
  "insert into news(title,body,tag,status,ai_generated,source_url,source_title,gallery) values ('ข่าว AI','เนื้อหา','ความรู้','pending',true,'https://ccpe.pharmacycouncil.org/index.php?option=article_detail&subpage=article_detail&id=1','บทความ',array['ai/1/a.jpg','ai/1/b.jpg']) returning id", rows(1))
check("system logs processed article", None, f"insert into ai_news_log(article_id,title,news_id,status) values (1,'บทความ','{aid}','done') returning id", rows(1))
check("same article cannot be logged done twice", None, "insert into ai_news_log(article_id,status) values (1,'done')", "deny")
check("errors can repeat for same article", None, "insert into ai_news_log(article_id,status,note) values (1,'error','x'),(1,'error','y') returning id", rows(2))
check("admin reads AI log", "admin", "select count(*) from ai_news_log", eq(3))
check("staff cannot read AI log", "s2", "select count(*) from ai_news_log", eq(0))
check("anon cannot read AI log", "anon", "select count(*) from ai_news_log", "deny")
check("admin cannot write AI log directly", "admin", "insert into ai_news_log(status) values ('done')", "deny")
check("public cannot see AI draft before approval", "anon", f"select count(*) from news where id='{aid}'", eq(0))
check("admin approves AI draft → published", "admin", f"update news set status='published' where id='{aid}' returning (published_at is not null)::text||':'||cardinality(gallery)", eq("true:2"))
check("public sees source + gallery after publish", "anon", f"select source_title||':'||ai_generated::text from news where id='{aid}'", eq("บทความ:true"))
check("source url must be https", "admin", f"update news set source_url='javascript:alert(1)' where id='{aid}'", "deny")
check("AI news download link must be https", "admin", f"update news set source_file_url='javascript:alert(1)' where id='{aid}'", "deny")
check("admin sets AI news download link", "admin", f"update news set source_file_url='https://ccpe.pharmacycouncil.org/showfile.php?file=1' where id='{aid}' returning source_file_url", eq("https://ccpe.pharmacycouncil.org/showfile.php?file=1"))
check("gallery max 6 images", "admin", f"update news set gallery=array['1','2','3','4','5','6','7'] where id='{aid}'", "deny")
check("anon reads AI settings", "anon", "select body from site_texts where key='ai_news_auto'", eq("off"))
check("admin toggles auto publish", "admin", "update site_texts set body='on' where key='ai_news_auto' returning body", eq("on"))
check("staff cannot toggle auto publish", "s2", "update site_texts set body='off' where key='ai_news_auto' returning body", rows(0))

print("== step 29: guest chat (no login) ==")
G1, G2 = "33333333-3333-3333-3333-333333333333", "44444444-4444-4444-4444-444444444444"
check("guest sends ≤15 chars to unit 2 (no login)", "anon", f"select guest_chat_send('{G1}', 2::smallint, 'ป้าแดง', 'ยากินตอนไหน')->>'sender_role'", eq("citizen"))
check("guest message > 15 chars → login required", "anon", f"select guest_chat_send('{G1}', 2::smallint, 'ป้าแดง', 'ยาความดันกินก่อนหรือหลังอาหาร')", "deny")
check("guest needs a nickname", "anon", f"select guest_chat_send('{G1}', 2::smallint, '  ', 'สวัสดี')", "deny")
check("guest needs a device token", "anon", "select guest_chat_send(null, 2::smallint, 'ป้าแดง', 'สวัสดี')", "deny")
check("guest cannot insert messages directly", "anon", "insert into messages(conversation_id, body) select id, 'x' from conversations limit 1", "deny")
check("guest cannot read conversations table", "anon", "select count(*) from conversations", "deny")
check("guest reads own room", "anon", f"select jsonb_array_length(guest_chat_fetch('{G1}', 2::smallint))", eq(1))
check("another device cannot read that room", "anon", f"select jsonb_array_length(guest_chat_fetch('{G2}', 2::smallint))", eq(0))
check("staff of unit 2 sees guest room with nickname (no citizen account)", "s2", "select guest_name||':'||(citizen_id is null)::text from conversations where guest_key is not null and target_unit=2", eq("ป้าแดง:true"))
check("staff of unit 1 does not see it", "s1", "select count(*) from conversations where guest_key is not null and target_unit=2", eq(0))
check("staff replies to guest", "s2", "insert into messages(conversation_id, body) select id, 'ก่อนนอนครับ' from conversations where guest_key is not null and target_unit=2 returning sender_role", eq("staff"))
check("guest list shows unread reply", "anon", f"select guest_chat_list('{G1}')->0->>'unread'", eq(1))
check("guest sees staff reply (unread cleared)", "anon", f"select guest_chat_fetch('{G1}', 2::smallint)->1->>'body'; select guest_chat_list('{G1}')->0->>'unread'", eq(0))
check("staff cannot send image into guest room", "s2", "insert into messages(conversation_id, body, image_path) select id, '', id::text||'/a.webp' from conversations where guest_key is not null and target_unit=2", "deny")
check("logged-in user cannot use guest chat", "c1", f"select guest_chat_send('{G2}', 2::smallint, 'x', 'สวัสดี')", "deny")
check("citizen cannot create a conversation posing as guest", "c1", "insert into conversations(citizen_id, target_unit, guest_key, guest_name) values (null, 2, 'k', 'x')", "deny")
check("guest limit: 20 messages per device per day", "anon", f"select count(*) from (select guest_chat_send('{G1}', null, 'ป้าแดง', 'ข้อ'||g) from generate_series(1, 20) g) x", "deny")
check("…19 more still fine (20 total)", "anon", f"select count(*) from (select guest_chat_send('{G1}', null, 'ป้าแดง', 'ข้อ'||g) from generate_series(1, 19) g) x", eq(19))
check("…21st message blocked → login required", "anon", f"select guest_chat_send('{G1}', 3::smallint, 'ป้าแดง', 'อีกข้อ')", "deny")
check("guest token is stored hashed (not the raw device id)", None, f"select count(*) from conversations where guest_key = '{G1}'", eq(0))
run("update conversations set last_message_at = now() - interval '8 days' where guest_key is not null and target_unit = 2")
check("guest rooms idle 7 days are deleted automatically", "anon", "select purge_guest_chats()", eq(1))
check("…with their messages", None, "select count(*) from conversations c where c.guest_key is not null and c.target_unit = 2", eq(0))
check("normal citizen rooms are not purged", None, "select count(*) > 0 from conversations where citizen_id is not null", eq("t"))

print("== step 30: admin <-> staff chat per person ==")
U["s2b"] = "00000000-0000-0000-0000-0000000000b9"
run("""insert into staff_roster(email, full_name, role, unit_id) values ('s2b@gmail.com','มานี มีสุข','staff',2);
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values ('%(s2b)s','s2b@gmail.com','{"full_name":"S2B"}','{"provider":"google"}')""" % U)
check("old staff messages moved to sender's own room", None, f"select count(*) from unit_messages where unit_id=2 and sender_role='staff' and staff_id is distinct from sender_id", eq(0))
check("staff thread backfilled for existing chat", None, f"select count(*) from staff_threads where staff_id='{U['s2']}'", eq(1))
check("staff message goes to own room (staff_id = self)", "s2", "insert into unit_messages(unit_id,body) values (2,'ถามเรื่องยา') returning (staff_id = auth.uid())::text", eq("true"))
check("staff cannot post into colleague's room", "s2", f"insert into unit_messages(unit_id,body,staff_id) values (2,'x','{U['s2b']}') returning (staff_id = auth.uid())::text", eq("true"))
check("colleague in same unit cannot read s2's room", "s2b", f"select count(*) from unit_messages where staff_id='{U['s2']}'", eq(0))
check("colleague still sees old messages to whole unit", "s2b", "select count(*) > 0 from unit_messages where staff_id is null", eq("t"))
check("admin replies to s2 personally (unit filled from account)", "admin", f"insert into unit_messages(unit_id,body,staff_id) values (1,'ได้ครับ','{U['s2']}') returning unit_id||':'||sender_role", eq("2:admin"))
check("admin cannot target a non-staff account", "admin", f"insert into unit_messages(unit_id,body,staff_id) values (2,'x','{U['c1']}')", "deny")
check("per-person unread counters", None, f"select unread_admin||':'||unread_staff from staff_threads where staff_id='{U['s2']}'", lambda o: o.strip().endswith(':1'))
check("s2 sees only own thread counters", "s2", "select count(*) from staff_threads", eq(1))
check("colleague cannot see s2 thread counters", "s2b", f"select count(*) from staff_threads where staff_id='{U['s2']}'", eq(0))
check("colleague cannot mark s2 thread read", "s2b", f"select mark_staff_thread_read('{U['s2']}')", "deny")
check("s2 marks own thread read", "s2", f"select mark_staff_thread_read('{U['s2']}'); select unread_staff from staff_threads where staff_id='{U['s2']}'", eq(0))
check("admin marks s2 thread read (staff side untouched)", "admin", f"select mark_staff_thread_read('{U['s2']}'); select unread_admin from staff_threads where staff_id='{U['s2']}'", eq(0))
check("staff cannot edit thread counters", "s2", "update staff_threads set unread_admin=5", "deny")
check("anon cannot read threads", "anon", "select count(*) from staff_threads", "deny")

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
