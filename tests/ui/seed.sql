-- ข้อมูลตัวอย่างสำหรับทดสอบหน้าเว็บ (tests/ui) — ใช้กับฐานข้อมูลทดสอบเท่านั้น ห้ามรันใน Supabase จริง
-- ผู้ใช้ทดสอบ: admin@hosp.th (ผู้ดูแล) · s2@gmail.com (รพ.สต. 2) · s3@gmail.com (รพ.สต. 3) · c1@gmail.com (ประชาชน มีเบอร์) · c2@gmail.com (ประชาชน ยังไม่กรอกเบอร์)
insert into public.staff_roster(email, full_name, role, unit_id, phone) values
  ('admin@hosp.th', 'ภก.ผู้ดูแล ระบบ', 'admin', null, null),
  ('s2@gmail.com', 'สมศรี ใจดี', 'staff', 2, '0811111111'),
  ('s3@gmail.com', 'วิชัย ขยัน', 'staff', 3, null);
insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@hosp.th', '{"full_name":"Admin"}', '{"provider":"google"}'),
  ('00000000-0000-0000-0000-0000000000b2', 's2@gmail.com', '{"full_name":"S2"}', '{"provider":"google"}'),
  ('00000000-0000-0000-0000-0000000000b3', 's3@gmail.com', '{"full_name":"S3"}', '{"provider":"google"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'c1@gmail.com', '{"full_name":"สมหญิง ใจงาม"}', '{"provider":"google"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'c2@gmail.com', '{"full_name":"ประชาชน สอง"}', '{"provider":"google"}');
update public.profiles set phone = '0812345678', address = 'ม.3 ต.ทุ่งนุ้ย', home_unit_id = 2 where email = 'c1@gmail.com';
update public.units set phone = '074-000-222', address = 'ต.ทุ่งนุ้ย อ.ควนกาหลง', note = 'เปิด 08.30–16.30 น.' where id = 2;

-- ผู้ดูแล: ข่าวที่เผยแพร่ + เอกสาร
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
insert into public.news(title, tag, body, status, comments_closed, view_count, published_at) values
  ('ปรับปรุงแบบฟอร์มส่งผลงาน ปีงบประมาณ 2570', 'ประกาศ', 'ย่อหน้าแรก' || chr(10) || 'ย่อหน้าที่สอง', 'published', false, 12, now() - interval '2 days'),
  ('อบรมการจัดเก็บยาใน รพ.สต.', 'อบรม', 'รายละเอียดการอบรม', 'published', true, 5, now() - interval '9 days'),
  ('สรุปผลการเยี่ยมบ้านไตรมาส 4', 'รายงาน', 'สรุปผลการดำเนินงาน', 'published', false, 0, now() - interval '20 days');
insert into public.documents(title, category, for_unit, note, file_path, file_name, file_size, content_type, version) values
  ('แบบบันทึกอุณหภูมิตู้เย็นเก็บยา', 'แบบฟอร์ม', null, null, 'all/1-a.pdf', 'แบบบันทึกอุณหภูมิ.pdf', 120000, 'application/pdf', 1),
  ('คู่มือจัดการยา รพ.สต. ทุ่งนุ้ย', 'คู่มือ / แนวทาง', 2, 'ฉบับปรับปรุง', '2/1-b.pdf', 'manual.pdf', 2400000, 'application/pdf', 2),
  ('ประกาศเฉพาะ รพ.สต. กระทูน', 'หนังสือสั่งการ / ประกาศ', 1, null, '1/1-c.pdf', 'notice.pdf', 5000, 'application/pdf', 1);
commit;

-- เจ้าหน้าที่ รพ.สต. 2
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
insert into public.news(title, tag, body, status, unit_id, review_comment) values
  ('ข่าวของ รพ.สต. ทุ่งนุ้ย (รอแก้)', 'ประกาศ', 'เนื้อหา', 'fix', 2, 'กรุณาแก้ชื่อเรื่องให้ชัดเจน');
insert into public.achievements(unit_id, title, body) values (2, 'ตู้เย็นเก็บยาได้มาตรฐาน', 'ควบคุมอุณหภูมิ 2–8 °C ทุกวัน');
insert into public.item_status(item_id, unit_id, status, detail, evidence_paths, submitted_at)
  select id, 2, 'approved', 'คำสั่งแต่งตั้งที่ 12/2569', array['2569/2/1.1/a.pdf'], now() - interval '10 days'
    from public.criteria_items where fiscal_year = 2569 and item_no = '1.1';
insert into public.item_status(item_id, unit_id, status, detail, submitted_at, review_comment)
  select id, 2, 'fix', 'แผนงาน', now() - interval '8 days', 'แนบ Gantt chart ด้วย'
    from public.criteria_items where fiscal_year = 2569 and item_no = '1.2';
insert into public.patients(id, unit_id, first_name, last_name, national_id, birth_date, hn_hospital, hn_unit, coverage) values
  ('00000000-0000-0000-0000-0000000d0001', 2, 'ประยูร', 'ทดสอบ', '1234567890123', '1950-05-01', '001', '77', 'บัตรทอง (สปสช.)');
insert into public.visits(patient_id, unit_id, visit_date, subjective, med_list, med_excess, drps, drp_resolved)
  values ('00000000-0000-0000-0000-0000000d0001', 2, current_date - 30, 'ปวดเข่า',
          '[{"name":"Metformin","qty":30,"unit":"เม็ด"}]', true, array['ขนาดยาต่ำเกินไป (Dosage too low)'], false);
insert into public.feedback(body) values ('อยากให้มีแจ้งเตือนวันนัด');
commit;

-- เจ้าหน้าที่ รพ.สต. 3: ข่าวรอตรวจ + หลักฐานรอตรวจ
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
insert into public.news(title, tag, body, status, unit_id) values
  ('รณรงค์คืนยาเหลือใช้', 'ประกาศ', 'ชวนประชาชนนำยาเหลือใช้มาคืน' || chr(10) || 'ที่ รพ.สต.', 'pending', 3);
insert into public.achievements(unit_id, title) values (3, 'จัดตู้ยาตามหลัก FEFO');
insert into public.item_status(item_id, unit_id, status, detail, evidence_paths, submitted_at)
  select id, 3, 'submitted', 'มีทะเบียนคุมยา', array['2569/3/' || item_no || '/x.pdf'], now() - interval '2 days'
    from public.criteria_items where fiscal_year = 2569 and item_no in ('1.3', '2.1.1');
commit;

-- ประชาชน: ความคิดเห็น, ถูกใจ, แชท
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
insert into public.news_comments(news_id, body) select id, 'ขอบคุณสำหรับข้อมูลค่ะ' from public.news where title like 'ปรับปรุงแบบฟอร์ม%';
insert into public.news_likes(news_id) select id from public.news where title like 'ปรับปรุงแบบฟอร์ม%';
insert into public.conversations(id, target_unit) values
  ('00000000-0000-0000-0000-0000000c0001', 2), ('00000000-0000-0000-0000-0000000c0002', null);
insert into public.messages(conversation_id, body) values
  ('00000000-0000-0000-0000-0000000c0001', 'ยาเบาหวานกินหลังอาหารได้ไหมคะ'),
  ('00000000-0000-0000-0000-0000000c0002', 'ยาแก้ไอกินกี่วันคะ');
insert into public.feedback(body) values ('เว็บใช้งานง่ายดีค่ะ');
commit;
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
insert into public.messages(conversation_id, body) values ('00000000-0000-0000-0000-0000000c0002', 'กินจนหายไอ ไม่เกิน 7 วันครับ');
commit;
