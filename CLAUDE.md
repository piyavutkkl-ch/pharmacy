# CLAUDE.md — คู่มือสำหรับ AI ที่มาแก้/พัฒนาโปรเจกต์นี้

Primary Care Pharmacy Services — เว็บงานเภสัชกรรมปฐมภูมิ โรงพยาบาลควนกาหลง จ.สตูล และ รพ.สต. 7 แห่ง
ผู้ใช้งาน 3 กลุ่ม: ประชาชนทั่วไป · เจ้าหน้าที่ รพ.สต. · ผู้ดูแล (โรงพยาบาล) · เนื้อหาหน้าเว็บเป็นภาษาไทยทั้งหมด
เจ้าของเว็บสั่งงานผ่าน Claude เป็นหลัก (ไม่ใช่นักพัฒนา) — ตอบเป็นภาษาไทย สั้น ชัด บอกเฉพาะสิ่งที่เขาต้องทำจริง ๆ

## วิธีทำงาน (ทุกคำขอ)
1. อ่านไฟล์นี้ + โค้ดส่วนที่เกี่ยวข้องก่อนแก้ · ถ้าคำขอกำกวมจนทำผิดทางได้ ให้ถามสั้น ๆ 1 คำถาม
2. แก้โค้ด (ตามแนวทางด้านล่าง) · ฟีเจอร์ใหม่ต้องเพิ่มการทดสอบใน `tests/ui/smoke.js` (และ `tests/rls_test.py` ถ้าแตะสิทธิ์ฐานข้อมูล)
3. รัน `bash tests/run_all.sh` จนผ่าน · เปลี่ยนหน้าตา → เปิดดูภาพใน `tests/ui/shots/` (390/768/1280 px) ก่อนส่ง
4. commit ข้อความภาษาไทยสั้น ๆ แล้ว push ไป branch ที่ขึ้นต้นด้วย `claude/` (หรือ `main`) — branch ชื่ออื่นระบบจะไม่ทำต่อให้
5. GitHub Actions `ci-deploy.yml` ทำต่อเองทั้งหมด: ทดสอบซ้ำ → รวมเข้า main → อัปเดตฐานข้อมูล (ถ้ามี SQL ใหม่ · สำรองก่อน) → ขึ้นเว็บ → ตรวจว่าเว็บจริงเป็นรุ่นใหม่
6. ตรวจผลรอบ Actions แล้วสรุปให้เจ้าของเว็บ: เปลี่ยนอะไร · ขึ้นเว็บแล้วหรือยัง · มีอะไรที่เขาต้องทำเองไหม (ปกติไม่มี)
   ถ้า Actions ไม่ผ่าน → อ่าน log แก้แล้ว push ใหม่เอง ไม่ต้องให้เจ้าของเว็บทำอะไร
   ถ้าแก้ไฟล์ใน `.github/workflows/` → GitHub ไม่ให้ Actions รวมเข้า main เอง (รอบ branch ขึ้นคำเตือน) → หลังรอบ branch ผ่าน ให้ Claude `git push origin HEAD:main` เอง
- **หน้าตัวอย่างให้เจ้าของเว็บ comment** (Claude Artifact ส่วนตัว https://claude.ai/artifact/CrNmmT6iY7Mf23APtw4WTp · ข้อมูลสมมติ + ชื่อสมมติ):
  `python3 tools/preview/build.py` → publish `_preview/index.html` ด้วย `url` เดิม, `root: _preview`, `files` = ทุกไฟล์ใน _preview ยกเว้น index.html/local.html
  อ่าน comment ด้วย ArtifactComments (url เดิม) → แก้โค้ดจริง + ทดสอบ → publish หน้าตัวอย่างใหม่ → ตอบ/resolve thread · ขึ้นเว็บจริง (push) เมื่อเจ้าของเว็บบอกเท่านั้น
  ข้อจำกัดหน้าตัวอย่าง: confirm() ยืนยันเอง, ดาวน์โหลดไฟล์ไม่ได้, ลิงก์ตรงไปหน้าย่อยไม่ได้ (ใช้แถบเลือกบทบาทบนสุด)
- สิ่งที่ Claude ทำแทนไม่ได้ (บอกเจ้าของเว็บเป็นขั้นตอนสั้น ๆ): ตั้งค่าใน Supabase Dashboard (Auth/Providers/URL), Google Cloud Console, GitHub Settings/Secrets
- ย้อนเว็บกลับรุ่นก่อน: `git revert <commit>` แล้ว push (ฐานข้อมูลย้อนเองไม่ได้ — ใช้ไฟล์ SQL ใหม่แก้ หรือ restore ตาม docs/BACKUP.md)

## ข้อบังคับ (ห้ามฝ่า)
- **ต้องฟรี 100%**: GitHub Pages (repo public) + Supabase Free + Google OAuth · ห้ามเพิ่มบริการที่ต้องจ่ายเงินหรือใส่บัตรเครดิต
- **ไม่มีขั้นตอน build**: HTML + CSS + ES modules ตรง ๆ, ไลบรารีโหลดจาก CDN (jsDelivr) · ขึ้นเว็บผ่าน `ci-deploy.yml` เท่านั้น (ต้องผ่านการทดสอบ)
- **ความลับห้ามอยู่ใน repo** (repo เป็น public): มีได้แค่ Supabase URL + publishable key ใน `js/config.js`
  ห้ามมี service_role / secret key / รหัสฐานข้อมูล / Google client secret
- **ความปลอดภัยอยู่ที่ฐานข้อมูล (RLS)** ไม่ใช่การซ่อนปุ่ม — ทุกตารางใหม่ต้อง `enable row level security` + policy + grant
- **ข้อมูลอ่อนไหว (PDPA)**: ข้อมูลผู้ป่วย/เยี่ยมบ้านเห็นได้เฉพาะเจ้าหน้าที่ รพ.สต. นั้น + ผู้ดูแล · หน้าสาธารณะแสดงได้แค่ตัวเลขสรุป
- **XSS**: ข้อความจากผู้ใช้/ฐานข้อมูลต้องผ่าน `esc()` (js/util.js) ก่อนใส่ `innerHTML` ทุกครั้ง
- **login ด้วย Google เท่านั้น** (trigger `handle_new_user` ปฏิเสธ provider อื่น)
- **คำสั่งที่ลบข้อมูลจริง** (drop table/column, truncate, delete from ใน SQL ใหม่) ต้องถามเจ้าของเว็บในแชทก่อนเสมอ
  เมื่อเขายืนยันแล้วจึงใส่บรรทัด `-- confirmed-destructive: <เหตุผล>` ในไฟล์ SQL (ไม่มีบรรทัดนี้ ระบบจะไม่ยอมรัน)
- ห้ามขอ/รับค่าลับทางแชท ถ้าเจ้าของเว็บเผลอส่งมา ให้เตือนให้เปลี่ยนค่านั้นใหม่ และห้ามนำไปใส่ในไฟล์ใด ๆ

## โครงสร้าง
```
index.html            โครงหน้าทั้งหมด: <section data-view="home|article|login|me|staff|admin|message">
privacy.html terms.html  หน้ากฎหมาย (Google ใช้ตรวจแอป — ห้ามลบ/ย้าย URL)
assets/app.css        design tokens (:root สี/เงา/ฟอนต์ + dark mode) + ทุก component — รีดีไซน์ที่ไฟล์นี้
js/config.js          SUPABASE_URL / SUPABASE_KEY (ค่าสาธารณะ)
js/supabase.js        client + publicImageUrl()
js/auth.js            session/profile/role (+ position จาก staff_roster), signIn(), signOut(), refreshProfile(), ROLE_HOME · ชื่อในบัญชีเจ้าหน้าที่ ⇄ profiles.full_name ซิงก์กัน (43_roster_name_sync.sql)
js/data.js            ข้อมูลอ้างอิงที่ cache: units, ปีงบ, sortItems() เรียงข้อเกณฑ์
js/nav.js             เมนูข้าง/เมนูล่างจอ (มือถือ) + ปุ่ม "เพิ่มเติม", setCurrent()
js/theme.js           ปุ่มโหมดมืด/สว่าง ขวาบน (จำใน localStorage 'pcps_theme' · ค่าเริ่ม = ตามเครื่อง · <head> ใส่ data-theme ก่อนวาดหน้า)
js/util.js            esc, fiscalYearOf, thaiDate, toast, busy, errText, art(), deviceToken() (รหัสเครื่อง localStorage 'pcps_device')
js/lightbox.js        smartCover() รูปหน้าอ่านข่าว/สรุปผลงาน: ใกล้ A4 (แนวตั้ง–แนวนอน) ไม่ครอบตัด · ยาว/กว้างกว่า A4 มากครอบตัด · openLightbox() ภาพเต็มจอ/ขนาดจริง
js/profile.js         หน้าต่างข้อมูลส่วนตัว (กดชื่อบนแถบเมนู · ทุกบทบาท) openProfile(), saveMyProfile() → เหตุการณ์ 'pcps:profile'
js/main.js            hash router + แถบเมนู + ท้ายเว็บ (อ่านคอมเมนต์หัวไฟล์เพื่อดูเส้นทาง)
js/pages/news.js      สไลด์ข่าว, รายการข่าว, หน้าอ่านข่าว (ถูกใจ/ความคิดเห็น — ไม่ login ก็ได้: ถูกใจผ่าน like_news_anon, ความเห็น ≤15 ตัวอักษรผ่าน comment_news_anon · รหัสเครื่อง localStorage 'pcps_device' · ผู้ดูแลลบความเห็นได้)
js/pages/dose.js      เครื่องคำนวณโดสยา (ตาราง dose_drugs)
js/pages/stats.js     ผลการดำเนินงาน (+ แถว "ผลงานด้านเภสัชกรรมปฐมภูมิ" จากตาราง achievements ตาม รพ.สต./ปีงบ), ผลงาน รพ.สต. + อันดับ, ช่องทางติดต่อ · หน้าอ่านผลงาน #/achievement/<id> showAchievement() · ผลงานที่ระงับการแสดง (achievements.hidden · 44_achievement_hidden.sql) ไม่ขึ้นหน้าสาธารณะ
js/pages/admin.js     ผู้ดูแล: โครงหน้า/เมนู (#/admin/<tab>[/<sub>]) + ตัวเลขงานค้าง + ข้อเสนอแนะ (ตั้งค่า › ข้อเสนอแนะ) + ผลงาน รพ.สต. (ทุกหน่วย · เลือก/เปลี่ยน รพ.สต. ในฟอร์ม → staff.js mountAch(slot,'all'))
js/pages/admin-news.js     ผู้ดูแล › ข่าว: เขียน/แก้ข่าว + ตรวจข่าวจาก รพ.สต. + ข่าวที่หยุดเผยแพร่ (หยุดเผยแพร่/ลบ/ไม่ผ่าน เรียกคืนได้ 30 วัน)
js/pages/admin-ai.js       ผู้ดูแล › ข่าว › ช่อง AI: สถานะ/ประวัติ (ai_news_log), สวิตช์เผยแพร่ทันที (site_texts ai_news_auto), ปุ่มสร้างข่าวตอนนี้ (ai_news_request)
js/pages/news-form.js      ฟอร์มข่าวใช้ร่วม (sn/an): ประเภท ข่าว/ประชาสัมพันธ์/ความรู้, รูปหลายรูป ≤7 (ย่อ ≤ A4 · × ลบทีละรูป · รูปแรก=image_path ที่เหลือ=gallery), PDF แนบ (bucket news-files)
js/pages/admin-review.js   ผู้ดูแล › ตรวจประเมิน: ตรวจหลักฐาน (ย้อนกลับผลตรวจ, แนบไฟล์กลับ), แก้เกณฑ์ (ข้อใหญ่/หัวข้อย่อย/ไฟล์ตัวอย่าง), ปีงบ (เริ่ม/ซ่อน/ลบปีว่าง)
js/pages/admin-settings.js ผู้ดูแล › ตั้งค่า: รายการยาเครื่องคำนวณโดส + ช่องทางติดต่อ รพ.สต.
js/pages/admin-staff.js    ผู้ดูแล › ตั้งค่า › บัญชีเจ้าหน้าที่ (staff_roster)
js/pages/admin-audit.js    ผู้ดูแล › ตั้งค่า › ประวัติการเข้าถึงข้อมูลผู้ป่วย (PDPA · admin_audit_log() + ดาวน์โหลด CSV)
js/pages/chat.js      แชท real-time: mountInbox() กล่องข้อความเจ้าหน้าที่/ผู้ดูแล (ลบห้องลงถัง กู้คืน 30 วัน · ผู้ดูแลลบถาวรเมื่อครบ), startChatWatch() ตัวเลขข้อความใหม่บนเมนู
js/pages/unitchat.js  แชท ผู้ดูแล ⇄ เจ้าหน้าที่ รพ.สต. แยกห้องรายคน (unit_messages.staff_id + staff_threads · 31_staff_threads.sql): #/staff/messages/admin, #/admin/messages/units (แถบ รพ.สต. → รายชื่อเจ้าหน้าที่ → ห้อง) · mountUnitChat(slot, unit)
js/pages/me.js        ประชาชน (#/me): ข้อมูลส่วนตัว + แชทถาม รพ.สต./ห้องยา รพ. (ต้องมีเบอร์โทรก่อน) · ปลายทาง = เลือก รพ.สต. เท่านั้น (ห้องยา รพ. เดิมอ่านได้อย่างเดียว · ผู้ดูแลเข้าไปช่วยตอบในกล่องของ รพ.สต. ได้)
                      ไม่ล็อกอินก็แชทได้ (guest_chat_* ใน 30_guest_chat.sql): ชื่อเล่น · ≤15 ตัวอักษร/ข้อความ · 20 ข้อความ/เครื่อง/วัน · ไม่มีรูป · ลบเองเมื่อเงียบ 7 วัน (purge_guest_chats ← กล่องข้อความ + keepalive)
js/pages/staff-request.js  ขอสิทธิ์เจ้าหน้าที่: ประชาชนส่งคำขอ (#/me/request) → ผู้ดูแลอนุมัติใน ตั้งค่า › บัญชีเจ้าหน้าที่ (approve_staff_request เพิ่ม staff_roster)
js/pages/docs.js      เอกสารดาวน์โหลด: ผู้ดูแลอัปโหลด/แก้/แทนที่ไฟล์/ลบ, เจ้าหน้าที่ดาวน์โหลด (bucket documents)
js/pages/staff.js     เจ้าหน้าที่: โครงหน้า/เมนู (ข่าว › ข้อความ › เยี่ยมบ้าน › ผลงาน › มาตรฐาน › เอกสาร › ข้อเสนอแนะ) + ข่าว (ส่งตรวจ) + ผลงาน + ข้อเสนอแนะ + ตัวเลขแจ้งเตือน
                      ผลงาน: AI แนะนำข้อมาตรฐานจากรายละเอียด (ai_match_start/poll/link · 37_ai_match.sql: ฐานข้อมูลเรียก Gemini ผ่าน pg_net · คีย์ใน Supabase Vault ที่ ci-deploy ส่งจาก GitHub Secrets ด้วย ops.set_ai_key · รุ่นจาก site_texts ai_match_model) · สถานะ AI ในรายการผลงาน
js/pages/criteria.js  เจ้าหน้าที่: ส่งหลักฐานเกณฑ์มาตรฐานรายข้อ (item_status + bucket evidence) + ผลงานที่ผูกข้อนั้น (achievements.item_ids · 36_achievement_items.sql · ไม่ต้องส่งตรวจ)
js/pages/delivery.js  บริการจัดส่งยาถึงบ้าน (#/delivery): โปสเตอร์/ข้อความ/สถิติ + ผู้ดูแล › ตั้งค่า › จัดส่งยาถึงบ้าน
js/pages/rider.js     Health Rider: ผลงานแสดงในช่องบริการจัดส่งยาถึงบ้าน (#hrBlock · #/rider เลื่อนไปที่นั่น · ไม่มีปุ่มเมนูแยก) + แท็บกรอก/นำเข้า Excel mountRiderEditor(slot) — ผู้ดูแลกรอกทุกหน่วย (เมนูเจ้าหน้าที่ไม่มี Health Rider แล้ว)
js/pages/summaries.js สรุปผลงานเยี่ยมบ้าน one page summary ราย รพ.สต.×ปีงบ (หลายภาพ: image_path + gallery · เลือก รพ.สต. ได้ · 35_summary_images.sql · วันที่ summary_date + ผู้ร่วมลง participant_ids/names จาก staff_directory() (รวมคนในบัญชีเจ้าหน้าที่ที่ยังไม่เคยเข้าระบบ → เก็บเป็นชื่อ · 40_staff_directory_roster.sql) + participant_others กรอกเอง · 38_summary_date_people.sql · เชื่อมโยงรายการเยี่ยม summary_visits (39_summary_visits.sql · RLS อ้าง visits = เห็นเฉพาะผู้มีสิทธิ์ · หน้าอ่านแสดงเฉพาะเจ้าหน้าที่/ผู้ดูแล + log_patient_access · ลิงก์ #/staff|admin/visits/<visit id> · เจ้าหน้าที่ทุกคนเห็นรายการแบบ "ชื่อจริง****" ผ่าน summary_visit_list · ชื่อเต็ม+รายละเอียด (summary_visit_detail) = ผู้ร่วมลง/หน่วยที่ดูแล/ผู้ดูแล · 41_summary_visit_access.sql) · นับผู้ลงเยี่ยมตามตำแหน่ง (staff_roster.position · participant_positions · ตำแหน่งในวงเล็บของชื่อที่กรอกเอง) + summary_patient_count · 42_summary_counts.sql): กรอบโปสเตอร์ 10:7 ในผลการดำเนินงาน (loadSummaryList + renderSummaryPoster สลับภาพ), หน้าอ่าน #/summary/<id>, ฟอร์มในหน้าเยี่ยมบ้าน mountSummaries(slot, unit)
js/pages/visits.js    ผู้ป่วย + บันทึกเยี่ยมบ้าน (SOAP: S/O/A(assessment)/P, รายการยา + วิธีใช้ (med_list.how), DRPs) — mountVisits(slot, unit) ใช้ทั้งเจ้าหน้าที่และผู้ดูแล
                      สังกัด รพ.สต. = หน่วยที่ดูแล: เปลี่ยนแล้วย้ายผู้ป่วย+บันทึกเยี่ยมด้วย rpc transfer_patient (33_patient_transfer.sql) · ผู้ดูแลมีช่อง ALL = โรงพยาบาล รวมทุกชื่อ
                      ที่อยู่แยกช่อง patients.address_parts {no,moo,tambon,amphoe,province,zip} + address (ข้อความเต็ม)
js/upload.js          อัปโหลดไฟล์: ย่อรูปเป็น WebP (imagePicker แสดงตัวอย่างทันที), ภาพย่อไฟล์ fileCard/hydrateSigned, ลิงก์ชั่วคราวไฟล์ส่วนตัว
supabase/NN_*.sql     migration เรียงเลข · ไฟล์ใหม่ = เลขถัดไป → ระบบรันบน Supabase ให้เองหลังทดสอบผ่าน (tools/db/migrate.sh)
.github/workflows/    ci-deploy (ทดสอบ→รวม→ฐานข้อมูล→ขึ้นเว็บ) · keepalive (กัน Supabase หลับ) · backup (สำรองรายสัปดาห์) · restore (กู้) · ai-news (ช่อง AI เช็กทุกชั่วโมง ทำวันละ 1 ข่าว)
tools/ai_news/        run.mjs ข่าวจากบทความ CCPE: เลือกบทความ → PDF → Gemini (ฟรี · pro ก่อน flash) ① วิเคราะห์ข้อเท็จจริง+เลขหน้า ② เขียนข่าว ③ ตรวจทานเทียบ PDF แก้ซ้ำ ≤3 รอบ (ยังผิด = รอผู้ดูแลตรวจ) → templates.mjs ภาพแม่แบบ 3 ภาพ (ไม่ใช้ AI วาดภาพ ตามเจ้าของเว็บ) → บันทึกข่าว · --check / --offline
tools/db/migrate.sh   รัน SQL ใหม่บน Supabase (จดไว้ใน ops.schema_migrations · สำรองก่อน · กันคำสั่งลบข้อมูลที่ไม่ได้ยืนยัน)
tools/backup/         สคริปต์สำรอง/กู้ข้อมูล (bash + Python มาตรฐาน) — วิธีตั้งค่าอยู่ใน docs/BACKUP.md
tools/preview/build.py สร้างหน้าตัวอย่าง (_preview/ · Supabase จำลอง + ชื่อสมมติ · ตรวจว่าไม่มีชื่อจริงหลุด)
tools/bump_version.py ติด ?v= กันแคช — ระบบ deploy เรียกให้เองกับสำเนาที่ขึ้นเว็บ (ไม่ต้องรันเอง)
tests/run_all.sh      ทดสอบทั้งหมด (คำสั่งเดียว) · static_checks.py · db/ (RLS) · ui/ (หน้าเว็บ) · ai_news/ (ช่อง AI แบบไม่ใช้เน็ต) · backup/ (สำรอง/กู้)
tests/ui/             smoke.js (Playwright) + mock_supabase.js (Supabase จำลอง) + seed.sql → fixtures.json (ข้อมูลตัวอย่าง)
.claude/settings.json ตอนเริ่ม session ติดตั้ง Postgres/Playwright ให้ (tests/setup_env.sh)
```

## ฐานข้อมูล (Supabase, region Singapore)
- role มาจาก `staff_roster` (ผู้ดูแลเพิ่มอีเมลผ่านหน้าเว็บ) → trigger ใส่ใน `profiles.role/unit_id` · ผู้ใช้แก้ role เองไม่ได้
- ฟังก์ชันตรวจสิทธิ์ใน policy: `is_admin()`, `is_staff_of(unit)`, `my_role()`, `my_unit()`
- ปีงบประมาณ = พ.ศ. นับจาก 1 ต.ค. → `fiscal_year_of(date)` (SQL) และ `fiscalYearOf()` (JS) ต้องตรงกันเสมอ
- เกณฑ์มาตรฐานแยกชุดต่อปีงบ (`criteria_items.fiscal_year`) · ขึ้นปีใหม่ด้วย `start_fiscal_year(ปี)` · ห้ามแก้เกณฑ์ปีเก่า
- PDPA audit: `audit_log` เพิ่ม/แก้/ลบ patients/visits บันทึกด้วย trigger `write_audit()` (เก็บชื่อช่องที่แก้ ไม่เก็บค่า) · การเปิดดูบันทึกด้วย `log_patient_access(unit, patient)` ที่ visits.js เรียก · ไม่มีใครแก้/ลบ/เพิ่มเองได้ · ผู้ดูแลอ่านผ่าน `admin_audit_log()`
  หน้าใหม่ที่แสดงข้อมูลผู้ป่วยรายคนต้องเรียก `log_patient_access` ด้วย
- trigger guard: เจ้าหน้าที่ส่งข่าว/ผลงานได้แค่สถานะ pending/submitted, ผู้ดูแลลดสิทธิ์ตัวเองไม่ได้, ต้องมีผู้ดูแล ≥ 1
- Supabase โปรเจกต์ใหม่ **ไม่ grant ตารางให้อัตโนมัติ** → ตารางใหม่ต้อง `grant ... to authenticated/anon` เอง (ดู 03_grants.sql)
- เส้นทางไฟล์: รูปข่าว `news/<user id>/…`, รูปผลงาน `achievements/<unit>/…`, โปสเตอร์ `delivery/…`, สรุปเยี่ยมบ้าน `summaries/<unit>/…`, หลักฐาน `<ปีงบ>/<unit>/<ข้อ>/…`
- ไฟล์: bucket `public-images` (≤1 MB, สาธารณะ), `documents` (≤5 MB), `evidence` (≤2 MB, path `ปีงบ/unit/…`), `news-files` (PDF ≤5 MB สาธารณะ, `<uid>/…`),
  `chat-images` (≤1 MB ส่วนตัว, `<conversation id>/…`), `criteria-samples` (≤5 MB ส่วนตัว, ผู้ดูแลอัปโหลด), `visit-photos` (≤1 MB ส่วนตัว PDPA, `<unit>/<patient>/…`) รวมฟรี 1 GB
- ช่อง AI: ข่าวจาก AI = news.ai_generated + gallery (ภาพเพิ่ม ≤6) + source_url/source_title (อ้างอิง) + source_file_url (ลิงก์ดาวน์โหลด PDF ต้นฉบับ CCPE showfile.php · ไม่เก็บสำเนา · 29_ai_news_pdf.sql) · ค่าเริ่มต้นเข้าคิวรอตรวจ · ai_news_log เขียนได้เฉพาะ secret key
  ค่าลับ GitHub Secrets: GEMINI_API_KEY (เจ้าของเว็บสร้างเองที่ aistudio.google.com — ฟรี ไม่ใส่บัตร) + SUPABASE_SECRET_KEY · Gemini free tier อาจใช้ข้อมูลที่ส่งไปพัฒนาโมเดล → ส่งได้แค่บทความสาธารณะ ห้ามส่งข้อมูลผู้ป่วย
- ข่าว: สถานะ pending/fix/rejected/published/unpublished/deleted · ถังข่าว (unpublished/deleted/rejected) มี trashed_at — หน้าผู้ดูแลลบถาวรเมื่อครบ 30 วัน

## แนวทางเขียนโค้ด
- import ไฟล์ในโปรเจกต์ต้องมี `?v=` เหมือนกันทุกไฟล์ (ตอนนี้ `?v=4.4` — ไฟล์ใหม่ให้ใช้ค่าเดียวกัน) ไม่งั้นโมดูลถูกโหลดซ้ำเป็นคนละตัว
  ตอน deploy ระบบเปลี่ยนเป็นเลขรุ่นจริงให้เอง (วันที่-commit) จึงไม่ต้อง bump เอง · static_checks.py ตรวจให้
- ES modules, ไม่มี framework · ฟังก์ชันหน้าใหม่ใส่ `js/pages/<ชื่อ>.js` แล้วต่อเส้นทางใน `route()` ของ main.js
- สไตล์ใช้ class/token ใน app.css — หลีกเลี่ยง inline style ใหม่
- ทุกหน้าต้องมีสถานะ: กำลังโหลด (`.skeleton`), ว่าง (`.empty`), ผิดพลาด (`toast(…,'err')`), ปุ่มระหว่างรอ (`busy()`)
- มือถือ: ตรวจที่ 390px ห้ามมี scroll แนวนอน · ปุ่มกดสูง ≥ 44px
- ข้อความ UI ภาษาไทย สุภาพ สั้น
- SQL ใหม่: เพิ่มได้อย่างเดียวเป็นหลัก (add column/table/policy) ให้หน้าเว็บรุ่นเก่ายังทำงานได้ระหว่าง deploy · เขียนให้รันซ้ำได้ (`if not exists`, `create or replace`, `drop … if exists` ก่อนสร้าง policy/trigger)
  ตารางใหม่ต้องมี RLS + policy + grant + ทดสอบใน rls_test.py · แก้โครงสร้างแล้วต้องอัปเดต tests/ui/seed.sql ถ้า seed พัง

- ดึงชื่อผู้ใช้แบบ embed ต้องระบุชื่อ foreign key เสมอ เช่น `author:profiles!news_author_id_fkey(full_name)` — news↔profiles มีหลายเส้นทาง (news_likes, news_comments) ถ้าไม่ระบุ Supabase จะ error PGRST201
- แชท: ผู้ดูแลเปิดกล่องของ รพ.สต. ได้ แต่ห้ามเรียก mark_conversation_read (จะล้างตัวเลขยังไม่อ่านของหน่วยนั้น) · ปิด channel ทุกครั้งที่ออกจากหน้า (route() เรียก leaveMe/unmountInbox/unmountUnitChat)
  แชทเจ้าหน้าที่⇄ผู้ดูแล: 1 เจ้าหน้าที่ = 1 ห้อง (เพื่อนร่วมหน่วยไม่เห็น) · ตัวนับ staff_threads แยกฝั่ง ล้างด้วย mark_staff_thread_read · staff_id null = ข้อความเดิมถึงทุกคนในหน่วย
- GitHub Actions: repo สาธารณะ ใครก็อ่าน log ได้ — ห้าม echo ข้อมูลจริง/ค่าลับ ห้าม upload artifact ที่มีข้อมูล ค่าลับอยู่ใน GitHub Secrets เท่านั้น
- id ใน index.html ใช้ร่วมทั้งหน้า ต้องไม่ซ้ำ — ตั้งคำนำหน้าตามส่วน (ar=หน้าอ่านข่าว, an=ผู้ดูแลข่าว, rv=ตรวจประเมิน, ad=เอกสารผู้ดูแล, sd=เอกสารเจ้าหน้าที่, df=ยา, ct=ติดต่อ, rf=บัญชี, dl/da=จัดส่งยาถึงบ้าน, hr=Health Rider, vs/sm=สรุปเยี่ยมบ้าน)

## การทดสอบ
- `bash tests/run_all.sh` = ทุกอย่าง (ต้องผ่านก่อน push) · ในเครื่องที่ไม่มี Postgres/Playwright จะข้ามขั้นนั้นพร้อมเตือน แต่บน Actions ห้ามข้าม
- ย่อย: `python3 tests/static_checks.py` · `bash tests/db/run.sh` · `bash tests/ui/make_fixtures.sh && node tests/ui/smoke.js` · `bash tests/backup/run.sh`
- ผู้ใช้จำลองในการทดสอบหน้าเว็บ: `?mockrole=admin|staff|staff3|citizen|citizen2` (ดูหัว mock_supabase.js)
- ทดสอบกับ Supabase จริงไม่ได้จากเครื่อง Claude — ใช้ mock + Postgres ในเครื่อง ส่วนของจริงตรวจหลังขึ้นเว็บ

## สถานะ (อัปเดตทุกครั้งที่ทำขั้นใหม่เสร็จ)
- [x] 1 ฐานข้อมูล + RLS · [x] 2 Google login · [x] 3 GitHub Pages
- [x] 4.1 หน้าสาธารณะ + login ตามสิทธิ์ + ผู้ดูแลจัดการบัญชีเจ้าหน้าที่ผ่านเว็บ
- [x] 4.2 เจ้าหน้าที่: ส่งข่าว, ผลงาน, ส่งหลักฐานเกณฑ์, เยี่ยมบ้าน, ข้อเสนอแนะ
- [x] 4.3 ผู้ดูแล: ตรวจข่าว/ผลงาน, ความคืบหน้า, ยา, ช่องทางติดต่อ, ปีงบใหม่, เอกสาร, ข้อเสนอแนะ
- [x] 4.4 ประชาชน: ข้อมูลส่วนตัว + แชท real-time (เมนู "ข้อความ" ของเจ้าหน้าที่/ผู้ดูแล)
- [x] 5 GitHub Actions: กัน Supabase หยุดโปรเจกต์ + สำรองข้อมูลรายสัปดาห์ไป Google Drive กลาง (docs/BACKUP.md)
- [x] 6 ระบบอัตโนมัติ: Claude แก้ → ทดสอบ → push → Actions ทดสอบ/รวม/อัปเดตฐานข้อมูล/ขึ้นเว็บเอง
- [x] 7 PDPA: บันทึกการเปิดดู/เพิ่ม/แก้/ลบข้อมูลผู้ป่วย + หน้าผู้ดูแลค้นย้อนหลัง/ดาวน์โหลด CSV (08_audit_access.sql)
- [x] 8 ช่อง AI ข่าวจากบทความ CCPE (28_ai_news.sql + 29_ai_news_pdf.sql + ai-news.yml) — ตั้ง GEMINI_API_KEY แล้ว · ทำงานจริงแล้ว

## งานค้าง (ทำแล้วลบบรรทัดออก)
- ต้นแบบ UI เดิม (ใช้อ้างอิงหน้าตา/ฟีเจอร์ที่ยังไม่ย้าย): Claude Artifact "Primary Care Pharmacy Services" ของเจ้าของโปรเจกต์
