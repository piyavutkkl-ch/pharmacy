# CLAUDE.md — คู่มือสำหรับ AI ที่มาแก้/พัฒนาโปรเจกต์นี้

Primary Care Pharmacy Services — เว็บงานเภสัชกรรมปฐมภูมิ โรงพยาบาลควนกาหลง จ.สตูล และ รพ.สต. 7 แห่ง
ผู้ใช้งาน 3 กลุ่ม: ประชาชนทั่วไป · เจ้าหน้าที่ รพ.สต. · ผู้ดูแล (โรงพยาบาล) · เนื้อหาหน้าเว็บเป็นภาษาไทยทั้งหมด

## ข้อบังคับ (ห้ามฝ่า)
- **ต้องฟรี 100%**: GitHub Pages (repo public) + Supabase Free + Google OAuth · ห้ามเพิ่มบริการที่ต้องจ่ายเงินหรือใส่บัตรเครดิต
- **ไม่มีขั้นตอน build**: HTML + CSS + ES modules ตรง ๆ, ไลบรารีโหลดจาก CDN (jsDelivr) · push ขึ้น `main` = ขึ้นเว็บ
- **ความลับห้ามอยู่ใน repo** (repo เป็น public): มีได้แค่ Supabase URL + publishable key ใน `js/config.js`
  ห้ามมี service_role / secret key / รหัสฐานข้อมูล / Google client secret
- **ความปลอดภัยอยู่ที่ฐานข้อมูล (RLS)** ไม่ใช่การซ่อนปุ่ม — ทุกตารางใหม่ต้อง `enable row level security` + policy + grant
- **ข้อมูลอ่อนไหว (PDPA)**: ข้อมูลผู้ป่วย/เยี่ยมบ้านเห็นได้เฉพาะเจ้าหน้าที่ รพ.สต. นั้น + ผู้ดูแล · หน้าสาธารณะแสดงได้แค่ตัวเลขสรุป
- **XSS**: ข้อความจากผู้ใช้/ฐานข้อมูลต้องผ่าน `esc()` (js/util.js) ก่อนใส่ `innerHTML` ทุกครั้ง
- **login ด้วย Google เท่านั้น** (trigger `handle_new_user` ปฏิเสธ provider อื่น)

## โครงสร้าง
```
index.html            โครงหน้าทั้งหมด: <section data-view="home|article|login|me|staff|admin|message">
privacy.html terms.html  หน้ากฎหมาย (Google ใช้ตรวจแอป — ห้ามลบ/ย้าย URL)
assets/app.css        design tokens (:root สี/เงา/ฟอนต์ + dark mode) + ทุก component — รีดีไซน์ที่ไฟล์นี้
js/config.js          SUPABASE_URL / SUPABASE_KEY (ค่าสาธารณะ)
js/supabase.js        client + publicImageUrl()
js/auth.js            session/profile/role, signIn(), signOut(), ROLE_HOME
js/data.js            ข้อมูลอ้างอิงที่ cache: units, ปีงบ, sortItems() เรียงข้อเกณฑ์
js/nav.js             เมนูข้าง/เมนูล่างจอ (มือถือ) + ปุ่ม "เพิ่มเติม", setCurrent()
js/util.js            esc, fiscalYearOf, thaiDate, toast, busy, errText, art()
js/main.js            hash router + แถบเมนู + ท้ายเว็บ (อ่านคอมเมนต์หัวไฟล์เพื่อดูเส้นทาง)
js/pages/news.js      สไลด์ข่าว, รายการข่าว, หน้าอ่านข่าว (ถูกใจ/ความคิดเห็น)
js/pages/dose.js      เครื่องคำนวณโดสยา (ตาราง dose_drugs)
js/pages/stats.js     ผลการดำเนินงาน, ผลงาน รพ.สต. + อันดับ, ช่องทางติดต่อ
js/pages/admin.js     ผู้ดูแล: โครงหน้า/เมนู (#/admin/<tab>[/<sub>]) + ตัวเลขงานค้าง + ข้อเสนอแนะ
js/pages/admin-news.js     ผู้ดูแล › ข่าว: ตรวจข่าวจาก รพ.สต. (อนุมัติ/ขอแก้/ไม่ผ่าน) + เขียน/แก้/ลบข่าว
js/pages/admin-review.js   ผู้ดูแล › ตรวจประเมิน: ตรวจหลักฐานราย รพ.สต., ความคืบหน้า, แก้เกณฑ์, เริ่มปีงบใหม่
js/pages/admin-settings.js ผู้ดูแล › ตั้งค่า: รายการยาเครื่องคำนวณโดส + ช่องทางติดต่อ รพ.สต.
js/pages/admin-staff.js    ผู้ดูแล › ตั้งค่า › บัญชีเจ้าหน้าที่ (staff_roster)
js/pages/chat.js      แชท real-time: mountInbox() กล่องข้อความเจ้าหน้าที่/ผู้ดูแล, startChatWatch() ตัวเลขข้อความใหม่บนเมนู
js/pages/me.js        ประชาชน (#/me): ข้อมูลส่วนตัว + แชทถาม รพ.สต./ห้องยา รพ. (ต้องมีเบอร์โทรก่อน)
js/pages/docs.js      เอกสารดาวน์โหลด: ผู้ดูแลอัปโหลด/แก้/แทนที่ไฟล์/ลบ, เจ้าหน้าที่ดาวน์โหลด (bucket documents)
js/pages/staff.js     เจ้าหน้าที่: โครงหน้า/เมนู + ข่าว (ส่งตรวจ) + ผลงาน + ข้อเสนอแนะ + ตัวเลขแจ้งเตือน
js/pages/criteria.js  เจ้าหน้าที่: ส่งหลักฐานเกณฑ์มาตรฐานรายข้อ (item_status + bucket evidence)
js/pages/visits.js    ผู้ป่วย + บันทึกเยี่ยมบ้าน (SOAP, รายการยา, DRPs) — mountVisits(slot, unit) ใช้ทั้งเจ้าหน้าที่และผู้ดูแล
js/upload.js          อัปโหลดไฟล์: ย่อรูปเป็น WebP ในเครื่องก่อน, ลิงก์ชั่วคราวไฟล์ส่วนตัว
supabase/*.sql        migration เรียงเลข รันใน Supabase SQL Editor ตามลำดับ (ไฟล์ใหม่ = เลขถัดไป)
tests/rls_test.py     ทดสอบสิทธิ์ฐานข้อมูลกับ Postgres ในเครื่อง (ดูหัวข้อทดสอบ)
tools/bump_version.py ติดเลขเวอร์ชันให้ CSS/JS (รันก่อน commit ทุกครั้ง)
```

## ฐานข้อมูล (Supabase, region Singapore)
- role มาจาก `staff_roster` (ผู้ดูแลเพิ่มอีเมลผ่านหน้าเว็บ) → trigger ใส่ใน `profiles.role/unit_id` · ผู้ใช้แก้ role เองไม่ได้
- ฟังก์ชันตรวจสิทธิ์ใน policy: `is_admin()`, `is_staff_of(unit)`, `my_role()`, `my_unit()`
- ปีงบประมาณ = พ.ศ. นับจาก 1 ต.ค. → `fiscal_year_of(date)` (SQL) และ `fiscalYearOf()` (JS) ต้องตรงกันเสมอ
- เกณฑ์มาตรฐานแยกชุดต่อปีงบ (`criteria_items.fiscal_year`) · ขึ้นปีใหม่ด้วย `start_fiscal_year(ปี)` · ห้ามแก้เกณฑ์ปีเก่า
- trigger guard: เจ้าหน้าที่ส่งข่าว/ผลงานได้แค่สถานะ pending/submitted, ผู้ดูแลลดสิทธิ์ตัวเองไม่ได้, ต้องมีผู้ดูแล ≥ 1
- Supabase โปรเจกต์ใหม่ **ไม่ grant ตารางให้อัตโนมัติ** → ตารางใหม่ต้อง `grant ... to authenticated/anon` เอง (ดู 03_grants.sql)
- เส้นทางไฟล์: รูปข่าว `news/<user id>/…`, รูปผลงาน `achievements/<unit>/…`, หลักฐาน `<ปีงบ>/<unit>/<ข้อ>/…`
- ไฟล์: bucket `public-images` (≤1 MB, สาธารณะ), `documents` (≤5 MB), `evidence` (≤2 MB, path `ปีงบ/unit/…`) รวมฟรี 1 GB

## แนวทางเขียนโค้ด
- **ทุกครั้งที่แก้ .js/.css ต้องรัน `python3 tools/bump_version.py <เวอร์ชันใหม่>` ก่อน commit** (ติด ?v= ให้ทุกไฟล์ กันเบราว์เซอร์ใช้ไฟล์เก่า — GitHub Pages ให้ cache 10 นาที) · import ไฟล์ในโปรเจกต์ต้องมี ?v= เหมือนกันทุกไฟล์ ไม่งั้นโมดูลจะถูกโหลดซ้ำเป็นคนละตัว
- ES modules, ไม่มี framework · ฟังก์ชันหน้าใหม่ใส่ `js/pages/<ชื่อ>.js` แล้วต่อเส้นทางใน `route()` ของ main.js
- สไตล์ใช้ class/token ใน app.css — หลีกเลี่ยง inline style ใหม่
- ทุกหน้าต้องมีสถานะ: กำลังโหลด (`.skeleton`), ว่าง (`.empty`), ผิดพลาด (`toast(…,'err')`), ปุ่มระหว่างรอ (`busy()`)
- มือถือ: ตรวจที่ 390px ห้ามมี scroll แนวนอน · ปุ่มกดสูง ≥ 44px
- ข้อความ UI ภาษาไทย สุภาพ สั้น

- ดึงชื่อผู้ใช้แบบ embed ต้องระบุชื่อ foreign key เสมอ เช่น `author:profiles!news_author_id_fkey(full_name)` — news↔profiles มีหลายเส้นทาง (news_likes, news_comments) ถ้าไม่ระบุ Supabase จะ error PGRST201
- แชท: ผู้ดูแลเปิดกล่องของ รพ.สต. ได้ แต่ห้ามเรียก mark_conversation_read (จะล้างตัวเลขยังไม่อ่านของหน่วยนั้น) · ปิด channel ทุกครั้งที่ออกจากหน้า (route() เรียก leaveMe/unmountInbox)
- id ใน index.html ใช้ร่วมทั้งหน้า ต้องไม่ซ้ำ — ตั้งคำนำหน้าตามส่วน (ar=หน้าอ่านข่าว, an=ผู้ดูแลข่าว, rv=ตรวจประเมิน, ad=เอกสารผู้ดูแล, sd=เอกสารเจ้าหน้าที่, df=ยา, ct=ติดต่อ, rf=บัญชี)

## การทดสอบ
- ฐานข้อมูล: ติดตั้ง Postgres 16 → สร้าง DB → รัน `tests/stub_new_default.sql`, `supabase/01…` แล้ว `03…` ขึ้นไปตามลำดับ → `python3 tests/rls_test.py` (ต้องผ่านทั้งหมด)
  (แก้ค่าเชื่อมต่อบรรทัด PSQL ในไฟล์ทดสอบให้ตรงกับเครื่อง)
- หน้าเว็บ: `python3 -m http.server` ในโฟลเดอร์ repo แล้วเปิด http://localhost:8000 (login จริงต้องเพิ่ม URL นี้ใน Supabase → URL Configuration → Redirect URLs)

## สถานะ (อัปเดตทุกครั้งที่ทำขั้นใหม่เสร็จ)
- [x] 1 ฐานข้อมูล + RLS · [x] 2 Google login · [x] 3 GitHub Pages
- [x] 4.1 หน้าสาธารณะ + login ตามสิทธิ์ + ผู้ดูแลจัดการบัญชีเจ้าหน้าที่ผ่านเว็บ
- [x] 4.2 เจ้าหน้าที่: ส่งข่าว, ผลงาน, ส่งหลักฐานเกณฑ์, เยี่ยมบ้าน, ข้อเสนอแนะ
- [x] 4.3 ผู้ดูแล: ตรวจข่าว/ผลงาน, ความคืบหน้า, ยา, ช่องทางติดต่อ, ปีงบใหม่, เอกสาร, ข้อเสนอแนะ
- [x] 4.4 ประชาชน: ข้อมูลส่วนตัว + แชท real-time (เมนู "ข้อความ" ของเจ้าหน้าที่/ผู้ดูแล)
- [ ] 5 GitHub Actions: กัน Supabase หยุดโปรเจกต์ + สำรองข้อมูลรายสัปดาห์ไป Google Drive กลาง
- ต้นแบบ UI เดิม (ใช้อ้างอิงหน้าตา/ฟีเจอร์ที่ยังไม่ย้าย): Claude Artifact "Primary Care Pharmacy Services" ของเจ้าของโปรเจกต์
