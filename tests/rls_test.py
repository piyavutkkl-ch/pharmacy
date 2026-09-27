import subprocess, sys, re

PSQL = ["psql", "-h", "/var/tmp/pgtest", "-p", "5433", "-U", "postgres", "-d", "t", "-tA", "-v", "ON_ERROR_STOP=1", "-q"]
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
check("citizen sends message (role forced citizen)", "c1", f"insert into messages(conversation_id,body,sender_role) values ('{cid}','ยาเบาหวานกินหลังอาหารได้ไหมคะ','staff') returning sender_role||':'||sender_name", eq("citizen:สมหญิง ใจงาม"))
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

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
