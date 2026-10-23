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
js/lightbox.js        smartCover() รูปหน้าอ่านข่าว/สรุปผลงาน: ใกล้ A4 (แนวตั้ง–แนวนอน) ไม่ครอบตัด · ยาว/กว้างกว่า A4 มากครอบตัด · imageCarousel() หลายภาพ (หน้าอ่านข่าว/สรุปผลงาน): ภาพหลักกลาง ภาพข้างจาง/เบลอ กด ‹ › หรือกดภาพข้างเพื่อเปลี่ยน · openLightbox() ภาพเต็มจอ/ขนาดจริง
js/profile.js         หน้าต่างข้อมูลส่วนตัว (กดรูปวงกลม/ชื่อ "สวัสดี …" ที่หัวหน้าประชาชน/เจ้าหน้าที่/ผู้ดูแล [data-edit-profile] · ทุกบทบาท) openProfile(), saveMyProfile() → เหตุการณ์ 'pcps:profile'
                      รูปประจำตัว profiles.avatar_path (public-images/avatars/<uid>/ · 71_avatar.sql) ไม่มี = รูป Google avatar_url · paintAvatars() [data-my-avatar] · ชื่อบนแถบเมนูบน (#profileBtn) = ลิงก์ไปหน้าเมนูตามสิทธิ์ (ROLE_HOME)
js/main.js            hash router + แถบเมนู (ช่องเดียว "ชื่อ - สิทธิ" = ลิงก์หน้าเมนูตามสิทธิ์) + ท้ายเว็บ · กดหัวข้อหน้าแรก/ปุ่มท้ายเว็บ [data-panel-link] ซ้ำ = ย่อปิด (อ่านคอมเมนต์หัวไฟล์เพื่อดูเส้นทาง)
js/pages/news.js      สไลด์ข่าว (ข่าวสลับผลงาน รพ.สต. ที่โพสต์ · loadAchSlides · รูปแนวนอน = พอดีกรอบ+พื้นหลังเบลอ · แนวตั้ง = เต็มกรอบเลื่อนบน↔ล่างสุ่ม · slideCover/fitSlideImg), รายการข่าวหน้าแรก (6 กล่อง 3×2 สุ่มทุกครั้งที่เปิดเว็บ · shuffled · ปุ่ม ‹ › ซ้าย-ขวา ดูข่าวชุดละ 6 ถัดไป/ก่อนหน้า วนรอบ) + หน้าข่าวทั้งหมด #/news/all (ค้นหา/หมวด/จัดเรียง · showAllNews), หน้าอ่านข่าว (ถูกใจ/ความคิดเห็น — ไม่ login ก็ได้: ถูกใจผ่าน like_news_anon, ความเห็น ≤15 ตัวอักษรผ่าน comment_news_anon · รหัสเครื่อง localStorage 'pcps_device' · ผู้ดูแลลบความเห็นได้)
js/pages/dose.js      ข้อมูลยา / คำนวณขนาดยา (ตัวเลขคิดใน doseNumbers() ฟังก์ชันล้วน · ใช้ร่วมกับ dose-test.js · ขนาดคงที่ indications[].fixed = ไม่คูณน้ำหนัก (85) · basis ตรงกับ strength.as ("คิดเป็น" · sameBasis) = คิดเม็ดจาก as.mg · basis ที่ยาไม่ได้ระบุปริมาณ = basisMissing ไม่คิดเม็ด · note = หมายเหตุ) · 4 ส่วน #doseTabs: คำนวณขนาดยา (#dosePaneCalc) · ข้อมูลยา (#dosePaneInfo) · คำนวณสารน้ำ (#dosePaneFluid → fluid.js) · Drug interaction (#dosePaneDdi → ddi.js)
                      คำนวณ: อายุ(ปี/เดือน) → น้ำหนัก (บังคับ) → ส่วนสูง → เพศ · ไม่ได้ชั่งน้ำหนัก = ประมาณจากเกณฑ์ WHO 2006 (กรมอนามัย · 0–5 ปี · js/growth.js จาก tools/growth/build.py)
                        แบ่งให้ได้หลายแบบ: indications[].times (แบบที่ 1) + times_alt [แบบอื่น] เช่น วันละ 1 หรือ 3 ครั้ง → ผลคำนวณแยกทีละแบบ (ผู้ดูแลกรอก "1, 3")
                        เม็ดที่แบ่งไม่ลงตัว ½/¼ = เตือน [data-tab-fraction] · ยา รพ.สต. ที่จับคู่ข้อมูลขนาดยาจากชื่อ = "จับคู่ตามชื่อ" + เตือน [data-auto-match] · ความแรง "100 MG/ML" อ่านได้ · ฉลาก AI เก่ากว่า 10 ปีติดธง label_old (80)
                        ตัวเลขไม่ถูกปัดจนเป็น 0: ขนาดยา < 1 แสดง 2 หลักนัยสำคัญ (drng/fx) · มล./เม็ดที่ปัดแล้วเป็น 0 = เตือน [data-too-small]
                        ขนาดต่อวันที่ไม่ระบุจำนวนครั้ง = ไม่เดาว่าวันละครั้ง → [data-dose-incomplete] ข้อมูลไม่ครบ + ขนาดรวมต่อวัน · ร่าง AI มีธง dose_drugs.draft_issue (75_dose_draft_issue.sql)
                        ช่วงอายุ indications[].age_min/age_max (ปี · "ตั้งแต่ age_min ถึงต่ำกว่า age_max") อายุนอกช่วง = ไม่แสดงขนาดยา [data-age-out] ย่อรวมไว้ท้าย [data-age-others] · ข้อที่ตรงอายุขึ้นก่อน
                        มีช่วงอายุแต่ไม่กรอกอายุ = ไม่แสดงตัวเลข [data-age-need] · ไม่มีข้อตรงอายุ = [data-age-none] (ห้ามใช้ขนาดของช่วงอายุอื่นแทน) · cap_day ขนาดสูงสุดต่อวัน (76_dose_inds_age.sql)
                        ข้อที่ไม่ผ่านกฎ dose-rules.js = ไม่แสดงตัวเลข [data-rule-block] (ผู้ดูแลเห็นเหตุผล + ลิงก์หน้าโปรไฟล์ยา) · ผู้ดูแลเห็นยาที่ยังไม่อนุมัติ [data-unapproved] (ประชาชน/เจ้าหน้าที่ไม่เห็น · 90)
                        เพดานต่อครั้ง indications[].cap ใช้ทั้งแบบต่อครั้งและต่อวันที่แบ่งให้ · ถูกจำกัด = ข้อความ [data-capped] บอกขนาดตามน้ำหนักเดิม + รวมต่อวันสูงสุด
                        หน่วยขนาดยา: indications[].unit = 'mcg' (ไม่มี = มก.) → คำนวณเป็น mcg แล้ว ÷1000 ก่อนเทียบความแรง · ช่องเดิม mg_per_kg_* เก็บเป็น มก. เสมอ (65_dose_mcg.sql · AI ร่างบอก unit)
                        ยาสูตรผสม (66_combo_drugs.sql · 68): local_drugs.ingredients [{name, mg, per, u/amt (mcg), dose_id รายสาร, auto = ระบบใส่ รอทวนสอบ}] · ฟอร์มยา รพ.สต. กรอกแถวละสาร (#ldIngs · ยาเดี่ยว 1 แถว = strength + dose_id) (co-trimoxazole 400/80 · 200/40 ต่อ 5 มล.) + indications[].basis = สารที่ใช้คิดขนาดยา → คิดเม็ด/มล. จากสารนั้น + บอกปริมาณสารทุกตัว · ไม่มี basis = เตือน ไม่คิดจำนวนเม็ด
                        ข้อบ่งใช้ที่ AI กรอก: quote (ข้อความจากฉลาก) + ref {label, url DailyMed} (67_dose_ref.sql · refOfLabel) แสดงในกล่องข้อบ่งใช้ (.ai-src) และ "ที่มา" ในหน้าคำนวณ
                        ใต้ผลคำนวณ #doseLabel = "ขนาดยาและวิธีใช้" จากฉลาก openFDA ของยา รพ.สต. ที่ผูกกับยาที่เลือก (labelDose)
                        กราฟการเจริญเติบโต #doseGrowth (js/pages/growth-chart.js): ภาพกราฟกรมอนามัย 2564 assets/growth/*.jpg + จุดแดงตามอายุ/น้ำหนัก/ส่วนสูง · ตำแหน่งแกน js/growth-charts.js ← tools/growth/charts.py <โฟลเดอร์ PDF> (0–5 ปี กรอบจากเส้นในไฟล์ · 6–19 ปี จากตัวเลขบนแกน)
                        รายชื่อยา = ยา รพ.สต. ที่มีข้อมูลคำนวณ (local_drugs.dose_id หรือจับคู่ชื่อ) · ความแรง = ยา รพ.สต. (local_drugs.strength หรืออ่านจากชื่อ "500 MG" · ชื่อยาสูตรผสม "400/80 MG" ไม่อ่าน (comboName) ต้องกรอก ingredients) · 60_drug_calc_th.sql
                        ไต: CrCl Cockcroft-Gault ตาม MDCalc (ใส่ส่วนสูง → BMI<18.5 น้ำหนักจริง · ปกติ IBW · ≥25 AdjBW) หรือ eGFR CKD-EPI 2021 (อายุ <18 ปี = Bedside Schwartz) · kidney() · Cr หน่วย มก./ดล. หรือ µmol/L (#doseCrUnit ÷88.4) · ช่วงค่าที่เป็นไปได้ LIM (น้ำหนัก 0.3–300 · อายุ ≤120 · ส่วนสูง 20–250 · Cr 0.1–20 มก./ดล.) นอกช่วง = ไม่คำนวณ [data-input-range] · เด็ก < 18 ปีไม่ใช้ CG (ให้ใช้ eGFR) · ทารก < 1 ปีไม่ใช้ Schwartz · ส่วนสูง < 152 ซม. เตือน IBW · ไต ≥ 60 ข้อความเป็นกลาง [data-renal-ok] · ติ๊กปรับตามไตแต่คำนวณไม่ได้ = สถานะ unknown เตือน "ยังประเมินการทำงานของไตไม่ได้" + เหตุผล (ห้ามถือว่าไตปกติ)
                      ข้อมูลยา: ตัวกรองแหล่งข้อมูล #doseScope ทั้งหมด/ยา รพ.สต. (เริ่มต้น)/ยานอก รพ.สต. (local_drugs.outside · 81)/บัญชียาหลัก · ยานอกที่แสดงแล้วใช้ในเครื่องคำนวณ (ป้าย "ยานอก รพ.สต.") + Drug interaction (กลุ่มท้าย) ได้ · ยา รพ.สต. (local_drugs · 58) / บัญชียาหลักแห่งชาติ 2569 (drug_monographs · 57 · โหลดทีละ ≤1000 แถว)
                        เลือกยา → monograph + ฉลากยาสหรัฐฯ openFDA (drug_fda_labels · 59 · local_drugs.fda_key · ภาษาไทยจาก AI sections_th + ต้นฉบับอังกฤษพับไว้) + ขนาดยาจากเครื่องคำนวณ
                        ผู้ดูแลเห็นปุ่ม "แก้ไขข้อมูลนี้" → sessionStorage 'pcps_drug_edit' → เปิดฟอร์มใน #/admin/drugs/db
js/pages/ddi.js       Drug interaction: เทียบยา รพ.สต. เป็นคอลัมน์ (≤4 · + เพิ่ม/× ลบ · แต่ละส่วนระดับเดียวกันด้วย CSS subgrid) · ภาพเส้นทางยา HTML (ให้ยา→ตับ/CYP + รูปที่ได้ ออกฤทธิ์/ไม่ออกฤทธิ์ (MET · metText)→ออกฤทธิ์→ขับออก) + โครงสร้าง PubChem + กลไก/เภสัชจลนศาสตร์ (ฉลาก openFDA)
                      ด้านบน = แจ้งเตือนคู่ interaction (ddi_pairs · 61_ddi.sql · DDInter CC BY-NC-SA 4.0 · ต้องแสดงที่มา) กดดูภาพตำแหน่ง/เอนไซม์ + คำอธิบาย/การจัดการ (ไทยจาก AI · อังกฤษพับไว้)
                      CYP = ค่าทำนาย ADMETlab 2.0 ที่ DDInter แสดง (≥0.7) ไม่ใช่ข้อมูลยืนยัน · เฉพาะยาที่ใช้ทั้งระบบ (local_drugs.ddi_ids · ยาทาภายนอก/ยาสมุนไพรไม่รวม)
js/pages/fluid.js     คำนวณสารน้ำ: เตรียม Dextrose จากถุงที่มี + 50%D (วิธีที่ 1 ดูดออกก่อน · วิธีที่ 2 ไม่ดูดออก) หรือ + 3% NaCl ด้วย (สมการ 2 ตัวแปร) · เกลือน้อยกว่าถุงเดิม = เจือจางด้วยน้ำกลั่น (methodWater) · ภาพขั้นตอน SVG · ตารางที่ใช้บ่อยท้ายช่อง
js/pages/stats.js     ผลการดำเนินงาน (เลือกเดือนใต้ปีงบ #trkMonthTabs → ปฏิทินผลงานเยี่ยมบ้าน #trkCal วงกลม = วันที่มีการเยี่ยม/สรุปผลงาน/ผลงาน → กดวัน #trkDay: ตัวเลขรวม public_visit_days (72_visit_days.sql) + สรุปผลงาน/ผลงานวันนั้น + รายชื่อเฉพาะเจ้าหน้าที่-ผู้ดูแล (RLS + log_patient_access) · กดตัวเลข → DRPs แยกชนิด public_drp_stats (52_drp_stats.sql · ตัวเลขรวม) / รายการเยี่ยมเฉพาะเจ้าหน้าที่-ผู้ดูแล (RLS + log_patient_access)) (+ แถว "ผลงานด้านเภสัชกรรมปฐมภูมิ" จากตาราง achievements ตาม รพ.สต./ปีงบ), ผลงาน รพ.สต. (#/achievements) + อันดับเกณฑ์มาตรฐาน (อยู่ในช่องผลการดำเนินงาน ใต้แถวผลงาน · initLeaderboard), ช่องทางติดต่อ · หน้าอ่านผลงาน #/achievement/<id> showAchievement() · ปฏิทิน/รายการผลงานใช้วันที่ทำผลงาน achievements.work_date (84 · ฟอร์มผลงาน #saDate · สรุปเยี่ยมบ้าน = summary_date) · ผลงานที่ระงับการแสดง (achievements.hidden · 44_achievement_hidden.sql) ไม่ขึ้นหน้าสาธารณะ
js/pages/admin.js     ผู้ดูแล: โครงหน้า/เมนู (#/admin/<tab>[/<sub>] · ข้อมูลยา #/admin/drugs[/ai|dose|local|nlem|fda|ddi|db] = ส่วนเรียงแนวตั้ง ย่อ/ขยายได้ (<details data-adr-sec> · ลิงก์เปิด+เลื่อนไปส่วนนั้น) + เลือกยา รพ.สต. ด้านบน #adrQ → ทุกส่วนแสดงเฉพาะยานั้น (admin-drugs.js setPick · ส่วนคำนวณ/ร่าง AI รับผ่าน 'pcps:drugpick') · Health Rider + จัดส่งยาถึงบ้าน #/admin/rider[/delivery] · ลิงก์ settings/dose|drugs|delivery เดิมพาไปที่ใหม่) + ตัวเลขงานค้าง + ข้อเสนอแนะ (ตั้งค่า › ข้อเสนอแนะ) + ผลงาน รพ.สต. (ทุกหน่วย · เลือก/เปลี่ยน รพ.สต. ในฟอร์ม → staff.js mountAch(slot,'all'))
js/pages/admin-news.js     ผู้ดูแล › ข่าว: กล่องบนสุด = ข่าวรอตรวจ (รพ.สต. + AI) + กล่องตรวจ/แก้ไขกล่องเดียว (ฟอร์ม aq* · อนุมัติ/บันทึก/ขอแก้ไข/ไม่ผ่าน · ข่าวที่เผยแพร่แล้วที่มี PDF กด "แบบทดสอบ" เปิดกล่องเดียวกัน openReview(id,'published')) + ช่อง AI (ย่อได้) · เขียน/แก้ข่าวที่เผยแพร่ (an*) + ข่าวที่หยุดเผยแพร่ (เรียกคืนได้ 30 วัน)
js/pages/news-quiz.js      ข่าวที่มี PDF ต้นฉบับ (47_ai_news_check.sql): แบบทดสอบสำหรับผู้อ่าน (news_quiz · ผู้ดูแลตั้งคำถาม/เฉลยเอง ไม่ใช่ข้อสอบสภาฯ)
                           → AI ลองตอบจาก PDF + บอกเหตุผลถ้าเฉลยไม่ตรง + เรียบเรียง/เติมตัวเลือกผิด → ท้ายหน้าอ่านข่าว renderReaderQuiz()
                           ตรวจด้วยข้อความ PDF ที่ช่อง AI ถอดเก็บไว้ (news_sources · ผู้ดูแลอ่านได้เท่านั้น) ถ้ายังไม่มี = Gemini เปิดลิงก์ PDF
                           แบบทดสอบ: กล่องข้อความละ 1 ข้อ (คำถาม/ก. ข. ค./(ถูก)/อธิบาย:) → "ฉบับที่จะเผยแพร่" แก้ได้ + ติ๊ก ✓ ข้อที่ถูก (บันทึกจากฉบับนี้)
                           ห้ามทำระบบล็อกอิน/ดึงข้อสอบหรือผลสอบจาก CCPE (ตกลงกับเจ้าของเว็บแล้ว)
                           ฟังก์ชันที่เรียก Gemini ผ่าน pg_net ใช้ public.ai_key() ตรวจความพร้อม + บอกสาเหตุ (48_ai_ready.sql · ไม่ยอมเรียกเฉพาะเมื่อ schema net เปิดผ่าน API)
                           AI ไม่ว่าง (503/500/429…) → *_poll ส่งคำขอเดิมใหม่ด้วยรุ่นสำรองเอง ≤4 รุ่น (49_ai_retry.sql · ai_jobs จำคำขอผ่าน trigger · ลำดับ ai_match_model → site_texts ai_match_models (ช่อง AI บันทึก) → รุ่นสำรองตายตัว)
js/pages/news-topics.js    หมวดหมู่ข่าวตามเนื้อหา (54_news_topics.sql · news_topics + news.topic_ids ≤3): ผู้ดูแลเพิ่ม/ลบหมวด · เปิดหน้าข่าวแล้ว AI จัดหมวดข่าวที่ยังไม่มีหมวดเอง (ai_news_topics_start/poll · ไม่ทับที่ผู้ดูแลแก้) · กรองในหน้าผู้ดูแล/ข่าวทั้งหมด
js/pages/admin-ai.js       ผู้ดูแล › ข่าว › ช่อง AI: สถานะ/ประวัติ (ai_news_log), สวิตช์เผยแพร่ทันที (site_texts ai_news_auto), ปุ่มสร้างข่าวตอนนี้ (ai_news_request)
js/pages/news-form.js      ฟอร์มข่าวใช้ร่วม (sn/an): ประเภท ข่าว/ประชาสัมพันธ์/ความรู้, รูปหลายรูป ≤7 (ย่อ ≤ A4 · × ลบทีละรูป · รูปแรก=image_path ที่เหลือ=gallery), PDF แนบ (bucket news-files)
js/pages/admin-review.js   ผู้ดูแล › ตรวจประเมิน: ตรวจหลักฐาน (ย้อนกลับผลตรวจ, แนบไฟล์กลับ, ยกเลิกคำขอตรวจ → ถังขยะ 30 วัน กู้คืน/ลบถาวร · item_status.trashed_at + trash/restore/purge_item_status · 46_review_trash.sql), แก้เกณฑ์ (ข้อใหญ่/หัวข้อย่อย/ไฟล์ตัวอย่าง), ปีงบ (เริ่ม/ซ่อน/ลบปีว่าง)
js/pages/admin-settings.js ผู้ดูแล › ข้อมูลยา › คำนวณขนาดยา (#/admin/drugs/dose เพิ่มทีละตัว · แท็บ ai = ร่างขนาดยาจาก AI + เพิ่มหลายรายการ · แท็บฐานข้อมูล local/nlem/fda/ddi แยกกัน · ฉลากยา fda มีค้น DailyMed (69_dailymed.sql · dailymed_search/result ผ่าน pg_net → นำเข้าผ่าน openFDA ด้วย set_id) · /db เดิม = local · dose_drugs) + ตั้งค่า › ช่องทางติดต่อ รพ.สต.
                           เพิ่มหลายรายการ (วางรายชื่อยา · คิวจำใน localStorage 'pcps_dose_queue'): กรอกทีละตัว หรือ "ให้ AI ดึงข้อมูลยาเก็บเป็นร่างทั้งหมด" → dose_drugs.ai_draft (ซ่อนเสมอ · constraint ห้าม active จนผู้ดูแลตรวจ · 56_dose_ai_drafts.sql)
                           อนุมัติร่าง = ผ่านฟอร์มตรวจเท่านั้น (ไม่มีปุ่มคลิกเดียว) · 73_dose_approval.sql: trigger ตรวจ indications (dose_inds_problem = indsProblem ใน JS) ก่อนยาแสดง + approved_by/approved_at (ระบบใส่เอง) · รายการยาเตือนยาที่แสดงอยู่แต่ข้อมูลไม่ครบ
                           ประวัติแก้ไขข้อมูลยา drug_data_history (79 · trigger dose_drugs + ความแรง/สารสำคัญ/dose_id ของ local_drugs · ใคร/เมื่อไร/ค่าเดิม→ใหม่ · ผู้ดูแลอ่านอย่างเดียว) · ปุ่ม "ประวัติ" [data-hist] ในรายการยา
                           เพดานความสมเหตุสมผล (78_dose_plausible.sql): เกิน 10,000 มก./กก. = บันทึกไม่ได้ · เกิน dose_soft_max() (ค่าเริ่ม 500 · site_texts dose_soft_max_mg_per_kg) = AI ไม่ใช้ + ฟอร์มถามยืนยัน (SOFT_MAX) · ค้นฉลาก openFDA เฉพาะ route ORAL ใหม่สุดก่อน (77)
                           คำตอบ AI ร่างขนาดยาถูกตรวจกับข้อความฉลากจริง (74_ai_dose_verify.sql · trigger บน ai_dose_drafts: quote อยู่ในฉลาก · ต่อ กก. · ตัวเลข/หน่วยตรง quote · cap พบในฉลาก) ไม่ผ่าน → result.ai_rejected + why (ไม่สร้างร่าง · หน้าช่วยกรอกแสดง [data-ai-rejected])
                           ปุ่ม "ช่วยกรอกจากฐานข้อมูลยา" (50_ai_dose.sql · ai_dose_start/poll): ฐานข้อมูลดึง RxNorm (ความแรง) + ฉลากยา openFDA ผ่าน pg_net → Gemini ร่างขนาดยา มก./กก. พร้อมข้อความอ้างอิง → ผู้ดูแลเลือกใส่ฟอร์ม ตรวจเองก่อนบันทึก (ระบบไม่บันทึกเอง) · ชื่อไทย→ใช้ชื่ออังกฤษในวงเล็บ (paracetamol→acetaminophen ฯลฯ)
js/pages/dose-rules.js     กฎความปลอดภัยข้อมูลขนาดยา (ผลตรวจ audit 22 ต.ค. 2569 · ฟังก์ชันล้วน · ทดสอบใน tests/clinical/rules.test.mjs): indRules/drugRules/blockedInds
                           fail: ทุกข้อต้องมี age_min (ทุกอายุ = 0) · ชื่อบอกอายุ = ช่องอายุต้องตรง · ตามน้ำหนักต่อครั้งต้องมี cap · ต่อวันต้องมี cap_day · cap ≤ cap_day
                                 ฉลาก (quote) mg/kg/day ↔ per · divided/every N h ↔ times · เพดานต่อวันในฉลากต้องอยู่ cap_day · ช่วงอายุขาดตอน ≤ 1 ปี · เด็ก (ตามน้ำหนัก) ห้ามเกินขนาดผู้ใหญ่ (age_min ≥ 12)
                           อายุใส่ค่าเดียวได้: age_max ว่าง หรือ ≥ OPEN_AGE (100) = ไม่จำกัด · ชื่อ "≥11 ปี"/"6 ปีขึ้นไป"/"6+ ปี" อ่านเป็นไม่จำกัด · age_name/age_gap มี fix → หน้าโปรไฟล์ยาแสดงปุ่มแก้คลิกเดียว [data-dw-agefix] (ใช้อายุตามชื่อ / ต่อช่วงข้อก่อนหน้า)
                           warn (ต้องติ๊กรับทราบทีละข้อ): ไม่มี quote · ช่วงขนาดกว้าง > 4 เท่า · ช่วงอายุว่าง > 1 ปี · SQL dose_rules_problem (90) = กฎโครงสร้างชุดเดียวกัน (ไม่อ่าน quote)
js/pages/dose-check.js     ตรวจข้อมูลขนาดยาทุกตัวครั้งเดียว (ภาพรวม ปุ่ม #dcCheckBtn → กล่อง #dcCheck · checkAll = testDose + กฎ ต่อข้อมูลคำนวณ 1 ชุด · ไม่ใช้ AI)
                           ปุ่มเดียว = ตรวจเสร็จ → ถามยืนยัน → AI เติมข้อมูลทุกข้อที่ไม่ผ่าน [data-ck-ai-all] ทีละข้อ: ฉลาก OpenFDA ก่อน ไม่พอ (none/left) = ค้นจากเว็บ · ผลอยู่ใน ai_dose_fixes → เปิดยาในหน้าโปรไฟล์ยา = เติมลงการ์ดให้เลย (fillCard · [data-dw-filled] · ย้อนกลับได้ [data-dw-undo] · ยังไม่บันทึก · loadSavedFixes ชื่อข้อบ่งใช้ตรงกัน 14 วัน)
                           ไม่บันทึกลงข้อมูลคำนวณเอง: แก้ข้อบ่งใช้ของยาที่แสดงอยู่ = อนุมัติ (90) ต้องเป็นเภสัชกรกด
                           หน้าโปรไฟล์ยา: แถบ [data-dw-chkall] สรุปไม่ผ่าน/ควรตรวจ + ปุ่ม "ตรวจยานี้ + ให้ AI เติมข้อมูลทุกข้อที่ไม่ผ่าน" [data-dw-aiall] (เติมลงการ์ดเลย) · ไม่บันทึกเอง ผู้ดูแลตรวจ/อนุมัติ
js/pages/dose-test.js      ทดสอบสูตรขนาดยา (ศูนย์ข้อมูลยา ระยะ 3) + drugRules (ไม่ผ่านกฎ = fail): testDose(d, locals) คิดทุกข้อบ่งใช้ × น้ำหนักตัวอย่าง (testWeights ตามช่วงอายุ) × ความแรงยา รพ.สต. ที่ผูก ด้วย dose.js doseNumbers() (สูตรเดียวกับหน้าคำนวณ)
                           fail = คำนวณไม่ได้/ขนาดผิด/ต่อวันไม่มีจำนวนครั้ง/สูตรผสมไม่มี basis/เกิน LIMITS ตั้งแต่น้ำหนักน้อยสุด → ช่อง "ทดสอบสูตร" ในศูนย์ข้อมูลยาเป็น ! + ไม่มีปุ่มอนุมัติ · ฟอร์มขนาดยา (#dfTestBtn/#dfTestOut) บันทึกแบบแสดงไม่ได้
                           LIMITS (20 เม็ด · 100 มล. · เตือน 5 เม็ด) = ค่าตั้งต้นจับการกรอกผิด ไม่ใช่เกณฑ์ทางคลินิก · testHtml() ตารางผล
js/pages/drug-work.js      ผู้ดูแล › ข้อมูลยา › โปรไฟล์ยา (ชื่อเดิม "ทำงานทีละยา" · #/admin/drugs/work · แท็บที่ 2 · ที่แก้ละเอียดทุกอย่างของยา 1 ตัว · #dcWork · เจ้าของเว็บ 21 ต.ค. "จบในหน้าเดียว · ใช้รูป/สัญลักษณ์"): ซ้าย = รายการยา (#dwQ ค้นหา · กรอง ยังไม่เสร็จ/พร้อมใช้/ทั้งหมด · #dwNew ชื่อยาใหม่ → สร้างยา (active false) + ดึงฉลาก + AI ร่างการ์ด)
                           หัวยา (วงกลมครบกี่ส่วน · แก้ชื่อ/รูปแบบ/ความแรง/คิดเป็นในที่ · แถบ 5 ขั้น · ปุ่ม "ถัดไป" = todo()) → แหล่งข้อมูล 5 ชิป (ผูก/เปลี่ยนในที่ · คู่ที่ระบบเสนอ · MIMS วางข้อความ) → การ์ดขนาดยา (ปุ่มรูป อายุ/วิธีคิด/ต่อครั้ง-ต่อวัน/วันละกี่ครั้ง · ช่อง Min/Max · หน่วยตามต้นฉบับ) + ต้นฉบับข้างกัน (OpenFDA+DailyMed / MIMS · ไฮไลต์ quote · เลือกข้อความ = ที่มา) + ผลคำนวณสด (doseNumbers)
                           ทุกการ์ดทดสอบสูตร + กฎความปลอดภัย (testDose + drugRules ข้ามข้อ) ทันที: ผ่าน → "ตรวจตัวเลขกับฉลากแล้ว" · เตือน = ติ๊กรับทราบทีละข้อ [data-dw-ack] ก่อน · ไม่ผ่าน = ไม่มีปุ่มตรวจแล้ว
                           ไม่ผ่าน/เตือน → "ให้ AI ตรวจกับฉลาก" (ai_dose_fix_start · 87/90 · เฉพาะฉลาก OpenFDA · ตรวจ quote/ตัวเลขกับฉลาก) หรือ "ให้ AI ค้นจากเว็บพร้อมลิงก์" (ai_dose_web_start · 90 · Gemini + Google Search ฟรี · ลิงก์ = groundingChunks จริง + ลิงก์ที่ AI ระบุเฉพาะเว็บที่ค้นเจอ · ไม่มีลิงก์ = ไม่ใช้)
                           ห้ามส่งข้อความ MIMS ให้ AI · ผลมี left = กฎที่ยังขาด · ผู้ดูแลกดใช้แล้วเปิดลิงก์ตรวจเอง (ที่มา [data-dw-ref])
                           หัวยา: ปุ่ม "ซ่อนยานี้/แสดงยานี้" [data-dw-hide] (local_drugs.active) + "ลบยานี้" [data-dw-deldrug] (ถัง 7 วัน) · ยาที่แสดงอยู่แต่ไม่มีผู้อนุมัติ = ปุ่ม "อนุมัติใช้คำนวณ" (saveDose → approve_dose)
                           แถบล่าง: บันทึกร่าง (การ์ดที่ตรวจแล้วเก็บ checked:true) / อนุมัติใช้คำนวณ (ตรวจครบ + ทดสอบผ่าน) → saveDose() ใน drug-center.js (ชุดเดียวกับแผงยาเดิม) · เปิดยาจากที่อื่น: sessionStorage 'pcps_work_focus' (ตาราง/แผงเครื่องมือ) หรือ 'pcps_drug_edit'
                           หัวยา: "✎" ความแรง = ตัวแก้ข้อมูลยาละเอียด (drugEditor: ชื่อ · รูปแบบ · สารสำคัญแถวละสาร (ingsRow) · คิดเป็น · บรรจุ · หน่วยนับ · หมายเหตุ · แสดง) · "ประวัติแก้ไข" (drug_data_history ยานี้ + ข้อมูลคำนวณ) · "ลบยานี้" = ย้ายลงถัง (drug-trash.js)
                           แหล่งข้อมูล: กดชื่อที่ผูก / "✎ แก้ไขรายละเอียด" = ตัวแก้ในแผง (dbEditorHtml/saveDb: rpst_list · drug_mims (หัวข้อ ## ) · drug_fda_labels (อังกฤษ/ไทย + AI แปลไทย ai_fda_th) · drug_monographs · ddi_drugs + คู่ ddi_pairs ของยานี้ (แก้/ AI แปล ai_ddi_th)) พร้อมรายการยา/รหัสที่ผูกข้อมูลนั้น (แก้แล้วมีผลทุกตัว) · "ดูในตาราง ›" = ตารางทีละฐาน (pcps_grid_focus 'id:ฐาน')
                           ฉลาก: ดึง openFDA + ค้น DailyMed นำเข้าและผูกในแผง (dailymed_search/result · fetchFdaBySetId) · บัญชี รพ.สต. ไม่พบ = เพิ่มรายการใน rpst_list แล้วผูก (addRpst) · ต้นฉบับ "แก้ไขข้อมูล" = ตัวแก้ในแผง · ไม่ต้องเปิดเครื่องมือฐานข้อมูล
                           มาจากภาพรวม/ตาราง: pcps_work_focus 'id:ส่วน' (drug | rpst | mims | fda | nlem | ddi | dose · 'new' = ช่องชื่อยาใหม่) → applyPart() เปิดส่วนนั้นให้
js/pages/drug-trash.js     ถังยาที่ลบ (88_drug_trash.sql · local_drugs.trashed_at): ลบยาทุกที่ (หน้าทำงาน · ตาราง · เครื่องมือ) = trashDrug() ย้ายลงถัง · RLS ซ่อนจากประชาชน/เจ้าหน้าที่ทันที · กล่อง #dcTrash ใต้หน้าข้อมูลยา เรียกคืนได้ 7 วัน · ครบแล้วหน้าผู้ดูแลลบถาวรเอง (purgeOld)
                           drugData().locals = ยาที่ไม่อยู่ในถัง · .trashed = ยาในถัง · หน้าคำนวณ/DDI กรอง trashed_at ด้วย (ผู้ดูแลอ่านได้ทุกแถว)
js/pages/mims-text.js      parseMimsText(): ข้อความหน้า MIMS ที่วาง หรือ PDF ที่พิมพ์หน้าเว็บ (ต่อบรรทัดที่ตัดตามความกว้างคอลัมน์ joinWrapped · ตัวอักษรเพี้ยน fixLig e!ect→effect · ชื่อการค้าที่หลุดท้ายหน้า → Brands · ทดสอบ tests/clinical/mims-text.test.mjs ข้อความสมมติ) → หัวข้อ (HEADS · ตัดลิงก์/เลขหน้า/โฆษณา/ท้ายหน้า · Brands) + การ์ดข้อบ่งใช้ (route → ข้อบ่งใช้ → Adult:/Child: · ไม่เดาตัวเลข skip รอกรอก) → admin-mims.js saveMimsText() → drug_mims.sections (87) · ทดสอบใช้ข้อความสมมติเท่านั้น
js/pages/drug-center.js    ผู้ดูแล › ข้อมูลยา › ภาพรวม = ศูนย์ข้อมูลยา (#/admin/drugs = หน้าแรก · /center ก็ได้ · แท็บ #dcTabs ภาพรวม | โปรไฟล์ยา | ตารางแก้ไขยา | วิธีใช้ · ดูขาดอะไร + ผูกเร็วจากฐานที่มี · ปุ่มแก้ไข/ฟอร์มเต็ม/ขนาดยา [data-dc-work] → toWork(id, ส่วน) หน้าโปรไฟล์ยา #/admin/drugs/help = หน้าแยก #dcHelp · แผงเครื่องมือเปิดทับหน้าที่เปิดอยู่ล่าสุด drugPage()/pageHash())
                           การ์ดสถานะ 5 (กรอง) + วงกลม/คอลัมน์ 7 ส่วน K = ข้อมูลยา · บัญชี รพ.สต. · MIMS · ฉลาก · บัญชียาหลัก · DDInter · ขนาดยา (MIMS ไม่บังคับ = KREQ ไม่นับ · ยังไม่ผูกแสดง ○) + ตารางยาละแถว (✓●✗!– · ปัญหาหนักก่อน) + แผงขวา
                           แผงยา 3 ขั้น (stepBox · ขั้นที่เสร็จย่อไว้ · stepOpen จำที่ผู้ดูแลเปิดเอง): ① ยาในเว็บแอพ (ชื่อ · รูปแบบ = category · ความแรง + "คิดเป็น" strength.as {name, mg} เมื่อข้อบ่งใช้คิดจากสารเฉพาะ เช่น Elemental iron)
                             ② แหล่งข้อมูล SRC (การ์ดละแหล่ง secHtml: บัญชียา รพ.สต. (local_drugs.code = rpst_list.code · ไม่มี = ยานอก) · MIMS · ฉลากยาสหรัฐฯ DailyMed/openFDA (fda) · บัญชียาหลัก · DDInter)
                             ③ ขนาดยา doseHtml/buildDt: แถวข้อบ่งใช้จากข้อมูลคำนวณเดิม (ติ๊กไว้) + dose_drugs.spare_inds + MIMS (drug_mims.indications) · ติ๊ก/แก้ด้วย indBox (admin-settings) · ตรวจซ้ำ testDose · saveDt อนุมัติ/บันทึก/เก็บร่าง → อัปเดตหรือสร้าง dose_drugs + ผูกยานี้และยาเม็ด/ยาน้ำชื่อสามัญหรือ MIMS เดียวกันที่ยังไม่มีข้อมูล (ผู้ดูแลไม่ต้องเลือก DOSE-xx)
                           สถานะ "ต้องแก้ไข" (เดิม "ผิดพลาด" · F-02) = ส่วนบังคับใดเป็น err · judge() ใส่ codes → whyOf() เหตุผล WHY (ช่วงอายุ · เพดาน · ต่อครั้ง/ต่อวัน · ทดสอบสูตร · ข้อมูลไม่ครบ · ร่างไม่ครบ · AI ขัดฉลาก · สูตรผสม · บัญชี · ฉลากหาย)
                           กล่อง "งานที่ต้องทำต่อ" #dcTodo (จำนวนตามเหตุผล · กด = กรอง why:<code>) + ป้ายเหตุผลในแถว [data-dc-why] · ชั้นแสดงผล ไม่เปลี่ยนเกณฑ์ (testDose ส่ง code ของกฎต่อ)
                           judge() สถานะต่อส่วน (ขนาดยารวมผลทดสอบสูตร: ไม่ผ่าน = err) · na = กลุ่มยาไม่ต้องมี หรือ local_drugs.link_na (83_drug_center.sql)
                           คู่ที่ระบบเสนอ suggest(): หลักฐาน + ความมั่นใจ · ✓ ได้เมื่อ ≥85% และหลักฐานตรงทุกข้อ · ✗ → drug_link_rejects (ผู้ดูแลเท่านั้น) · ปุ่มยืนยันคู่ที่มั่นใจสูงทีละหลายรายการ · ระบบไม่ผูกเอง
                           ใช้ข้อมูลจาก admin-drugs.js drugData()/reloadDrugData() · เหตุการณ์ 'pcps:drugdata' = วาดใหม่
                           หน้าเดียว: ฐานข้อมูลเดิม 7 ส่วน (ai/dose/local/outside/nlem/fda/ddi) อยู่ในแผงด้านขวา "เครื่องมือฐานข้อมูล" #dcDrawer (setDrawer) · ลิงก์ #/admin/drugs/<ส่วน>|tools เปิดแผง (ลิงก์เล็ก #dcToolsBtn มุมขวาแถบแท็บ #dcTabs · ยังจำเป็นสำหรับงานที่ตารางแก้ไขยาทำไม่ได้: เพิ่ม/ลบยา · สารสำคัญยาสูตรผสม · ขนาดยา · นำเข้า/ดึง/แปลทั้งฐาน) · ปุ่ม "+ เพิ่มยา" (#dcAddBtn · #dgAddBtn) = ส่วน ai
                           แผงยา → ฟอร์มเต็ม (ขนาดยา/ฟอร์มยา) เปิดในแผงเครื่องมือ · บันทึกแล้ว (pcps:dosesaved/pcps:localsaved) ปิดเอง กลับมาที่ยาเดิม · "อนุมัติใช้คำนวณ" (ร่าง AI = ผ่านฟอร์มตรวจ) · "ถัดไป ›"
                           ผูกบัญชียาหลัก/ฉลาก/DDInter ที่แผงยาที่เดียว (ช่องเดิมในฟอร์มยา #ldLinkFold และกล่องในฟอร์มขนาดยาซ่อนไว้ · เหลือ "ยาที่ใช้ข้อมูลคำนวณนี้") · ปุ่ม "แก้ไขข้อมูลนี้" ของยา รพ.สต. ในหน้าข้อมูลยา → แผงยานั้น
js/pages/drug-grid.js      ผู้ดูแล › ข้อมูลยา › ตารางแก้ไขยา (#/admin/drugs/grid · แท็บใน #dcTabs · #dcGrid): Tabulator 6.3.1 (MIT · jsDelivr โหลดเมื่อเปิดหน้า · ทดสอบ = tests/ui/node_modules (setup_env.sh) · หน้าตัวอย่าง = สำเนา _preview/vendor)
                           ยา 1 แถว · คลิกช่อง = แก้ → บันทึก local_drugs ทันที (ชื่อ · รูปแบบ · ความแรง/หน่วย · คิดเป็น (ต้องครบสาร+มก.) · ผูก rpst/mims/fda/nlem/ddi) · ขนาดยาไม่แก้ในตาราง → กดช่อง = หน้าโปรไฟล์ยา (pcps_work_focus)
                           เลือกฐานที่แสดง #dgDbs: หลายฐานพร้อมกัน / ทีละฐาน (+ รายละเอียด · เหตุผล · คู่ที่ระบบเสนอ ✓/✗) · ปุ่ม ① รายการยาบนเว็บ · จำใน localStorage 'pcps_drug_grid' · สถานะ/คู่เสนอ = drug-center.js (DC, centerRows, suggest)
                           หน้าตาราง = ฐานข้อมูลพร้อมนำเข้า/ส่งออก (drug-io.js) · ลิงก์ "เครื่องมือฐานข้อมูล (แบบเดิม)" #dcToolsBtn อยู่ในแถบ .dg-io หน้านี้เท่านั้น · กล่อง "นำเข้าฐานข้อมูลทั้งไฟล์" (#dgBulkSlot ย้าย #rlImportFold/#mmImportFold มาจากแผงเครื่องมือ) · หมวดยา #dgCats
                           ช่องสารสำคัญ (_ings) → กล่อง #dgIng เพิ่ม/ลดสาร + ความแรงรายสาร (ingsRow: 1 สาร = ยาเดี่ยว strength · ≥ 2 = ingredients · คง dose_id รายสารตามชื่อ) · คอลัมน์ท้าย "ลบรายการยานี้" = ย้ายลงถัง
                           list editor ค้นหาได้ (autocomplete ไม่รองรับ multiselect → nlem/ddi เลือก = เพิ่ม · ✓ = เอาออก) · ช่องค้นหาเลือกข้อความเดิมทั้งหมดตอนเริ่มแก้ (พิมพ์แทนที่)
                           แทนฟอร์มยาเต็ม (thread e4572bed): แผงยา ✎ แก้ข้อมูลยา / "แก้ในตารางแก้ไขยา" [data-dc-grid] → แถวยานั้น (sessionStorage 'pcps_grid_focus' · ไฮไลต์ dg-flash) · มีช่อง บรรจุ/หน่วยนับ/หมายเหตุ/แสดง · ยาสูตรผสม (สารสำคัญ) ยังแก้ที่ฟอร์มยา
js/pages/drug-io.js        ตาราง › นำเข้า/ส่งออก: ส่งออกแถวที่แสดง Excel/CSV/JSON (COLS · หัวไทย) · นำเข้าไฟล์รูปแบบของเว็บ (มีคอลัมน์ "รหัสในเว็บ" หรือ .json) = planDrugImport ตรง (จับคู่ web_code → ชื่อ · ช่องว่าง = ไม่เปลี่ยน · แสดงสิ่งที่เปลี่ยนก่อนกดบันทึก)
                           ไฟล์อื่น (Excel/CSV/PDF (pdf.js jsDelivr)/ข้อความ) → fileText → AI วิเคราะห์ (89_ai_drug_import.sql · ai_drug_import_start/poll: target rpst | drugs | nlem | other · ตัดแถวที่ชื่อ/รหัสไม่อยู่ในไฟล์ · ปฏิเสธข้อความ MIMS) → planFromAi → ตรวจแล้วกดบันทึก
                           PDF ที่เป็นภาพ (ไม่มีตัวอักษร) = OCR ในเบราว์เซอร์ fileTextInfo → ocrPdf (Tesseract.js 5.1.1 jsDelivr · eng · ≤12 หน้า · ไม่ส่งออกนอกเครื่อง/ไม่ใช้ AI · ป้ายเตือน [data-dg-ocr] ตรวจตัวเลขกับต้นฉบับ)
                           ไฟล์หน้า MIMS (looksMims · PDF/ข้อความ · เลือกหลายไฟล์ได้) = ไม่ส่งให้ AI → parseMimsText ในเครื่อง → แสดงหัวข้อ + เลือกยาที่ผูก (เดาจากชื่อ) → saveMimsText (drug_mims · การ์ดข้อบ่งใช้รอกรอกตัวเลข)
                           นำเข้าไม่สำเร็จ = บอกขั้นที่ error [data-dg-imperr] (อ่านไฟล์/ตรวจข้อมูล/AI วิเคราะห์/จับคู่/แยกหัวข้อ MIMS) · ก่อนบันทึก [data-dg-sum] ได้/ไม่ได้ + เหตุผลรายแถว [data-dg-badlist] · ปุ่ม "ข้าม N แถวที่ไม่ได้ · บันทึก M ยาที่ได้"
                           บันทึกทีละแถว (insertEach: ทีเดียวไม่ได้ = ลองทีละแถว) → resultHtml [data-dg-result]/[data-dg-faillist] + ลองใหม่เฉพาะที่ไม่ได้ [data-dg-retry] (retryPlan) / ข้ามที่ไม่ได้ · หลายไฟล์ MIMS ปนไฟล์อื่น = ข้ามไฟล์นั้นพร้อมเหตุผล [data-dg-mims-err]
                           หมวดใหม่ (ไม่อยู่ใน knownCats = site_texts 'drug_categories' + หมวดที่ใช้อยู่ + กลุ่มบัญชียาหลัก) = แจ้งเตือน ไม่นำเข้าแถวนั้น จนเจ้าของกด "+ เพิ่มหมวด" (addCats) · ห้ามใช้ไฟล์ที่มีข้อมูลผู้ป่วย
js/pages/admin-rpst.js     ฐานข้อมูลบัญชียา รพ.สต. (rpst_list · 86_rpst_list.sql · ผู้ดูแลเท่านั้น · แผงเครื่องมือ #/admin/drugs/rpst): เพิ่ม/แก้/ลบรายการ (รหัสยาโรงพยาบาล · ชื่อ · หมวด · บรรจุ · หน่วย)
                           ปุ่ม "เพิ่มยาในบัญชีที่ยังไม่มีในเว็บแอพ" (pull → local_drugs) · นำเข้าไฟล์ Excel/CSV (parseList · readTable ของ delivery-report · ใหม่/อัปเดต/ไม่อยู่ในไฟล์ = in_list false ไม่ลบ · ติ๊กเพิ่มเป็นยาในเว็บแอพด้วย)
                           ส่วนเดิม local/outside ในแผงเครื่องมือ = "ยาในเว็บแอพ · ยา รพ.สต. / ยานอก รพ.สต." (local_drugs)
js/pages/admin-mims.js     ฐานข้อมูล MIMS (drug_mims · 85_mims.sql · วางข้อความหน้า MIMS → แยกหัวข้อ (mims-text.js · #mmText) · RLS ผู้ดูแลเท่านั้น เพราะ MIMS เป็นข้อมูลสมาชิก · ห้ามเปิดให้ anon/เจ้าหน้าที่ · ห้ามใส่ข้อมูล MIMS ลงไฟล์ใน repo (public))
                           แผงเครื่องมือ › ฐานข้อมูล MIMS (#/admin/drugs/mims): นำเข้าไฟล์ mims_doses.json (ทำด้วย Claude in Chrome ในเครื่องผู้ดูแล) อ่านในเบราว์เซอร์ → planImport/mapInd (กฎตายตัว ไม่เดา: "ไม่พบ" = ไม่ใส่ · fixed_mg = ขนาดคงที่ · SMX+TMP รวม ÷6 = trimethoprim · elemental Fe = basis Elemental iron)
                           → drug_mims 1 แถว/หน้า MIMS (url ซ้ำ = อัปเดต) + local_drugs.mims_id (ชื่อตรง) + draftFromMims(): ร่างขนาดยา dose_drugs.ai_draft (ai_source 'MIMS Thailand …' · draftWord() = "ร่างจาก MIMS") ให้ยาที่ยังไม่มีข้อมูลคำนวณ · ร่างเดิม = เติมข้อบ่งใช้ · ที่อนุมัติแล้วไม่แตะ · ข้อบ่งใช้ที่ไม่ครบ = skip (เก็บใน MIMS ไม่เข้าร่าง)
                           ทุกข้อบ่งใช้มี ref {label:'MIMS Thailand', url} + note → หน้าคำนวณแสดง "ที่มา"/"หมายเหตุ" · ศูนย์ข้อมูลยามีส่วน mims (ผูก/สร้างร่างจาก MIMS ในแผงยา)
js/pages/admin-drugs.js    ผู้ดูแล › ข้อมูลยา › ฐานข้อมูลยา (#/admin/drugs/db · กดแก้ไข = ฟอร์มขยายใต้รายการนั้น showForm/parkForm/keepForm · placeForm เลื่อนจอให้แถวที่กดอยู่ที่เดิม)
                           ยา รพ.สต.: ฟอร์มเพิ่มยาใหม่ด้านบน #ldNewFold ปกติย่อ · กดแก้ไขด้านล่างไม่ย่อ/ขยายด้านบน + ข้อมูลยาใหม่ที่กรอกค้างคืนกลับ (snapNew/restoreNew) · ช่องผูกบัญชียาหลัก/ฉลาก/DDInter อยู่ใน #ldLinkFold (สำหรับยาที่ไม่มีข้อมูลคำนวณ)
                           ฐานข้อมูลบัญชียานอก รพ.สต. (#/admin/drugs/outside · #loList · local_drugs.outside · 81_outside_drugs.sql) ใช้ฟอร์ม #ldForm ร่วม (ติ๊ก #ldOutside)
                           รหัสยาในเว็บ web_code (82_drug_codes.sql · trigger ใส่เอง แก้ไม่ได้): SHPS (ยา รพ.สต.) · OUT (ยานอก) · NLEM · FDA · DDI · DOSE + อักษรแรก + ลำดับ เช่น SHPS-A-01 · ป้าย codeTag() ในทุกรายการ/กล่องผูก
                           กล่อง "ผูกฐานข้อมูล" ล่างสุดในฟอร์มแก้ไขคำนวณขนาดยา (#dfLinkFold · dlFill/dlCheck/dlSave): ยาที่ใช้ข้อมูลคำนวณนี้ (dose_id) + บัญชียาหลัก + ฉลาก + DDInter → ผูกทุกตัว (บันทึกเฉพาะช่องที่เปลี่ยน)
                           เพิ่มหลายรายการ + AI → linkDrug(): หายา รพ.สต. ที่ตรง (matchLocals: ชื่อสามัญ/บัญชียาหลักเดียวกัน · ตัวเลขความแรงต้องตรง) ไม่มี = สร้างยานอก รพ.สต. (ซ่อน) เมื่อพบข้อมูลอย่างน้อย 1 ฐาน · เติมเฉพาะช่องว่าง: Drug interaction (ค้นหา/AI แปลไทย/แก้/ลบ · ai_ddi_th_start/poll) · ยา รพ.สต. (เพิ่ม/แก้/ซ่อน/ลบ + ค้นหาผูก monograph) · บัญชียาหลัก (เพิ่ม/แก้/ลบ · หัวข้อแก้เป็นข้อความ "## หัวข้อ" · รูปแบบ "form | บัญชี" · ref ใหม่ = custom:<เวลา>) · ฉลาก openFDA: ดึงจาก api.fda.gov ในเบราว์เซอร์ (fetchFdaLabel · ฟรี ไม่ใช้คีย์) ดึงใหม่/แก้/ลบ/ผูกกับยา → resetDrugInfo()
                           งาน AI ที่ระบบทำเอง: ai_auto_tick() (63_ai_auto.sql) ← pg_cron ทุกนาที + run.mjs --check ทุกชั่วโมง (สำรอง) · ทีละ 1 รายการต่อชนิด ไม่จำกัดจำนวน · AI ไม่ว่าง = พัก 30 นาที (site_texts ai_auto_pause)
                           ① แปลไทยฉลาก openFDA → คู่ DDI ② ร่างขนาดยายารับประทาน รพ.สต. (local_drugs.dose_ai_status/dose_id → dose_drugs.ai_draft) → admin-settings.js กล่องร่างรอตรวจ (#dfReview · "ตรวจแล้ว · ใช้คำนวณ")
js/pages/admin-staff.js    ผู้ดูแล › ตั้งค่า › บัญชีเจ้าหน้าที่ (staff_roster)
js/pages/admin-audit.js    ผู้ดูแล › ตั้งค่า › ประวัติการเข้าถึงข้อมูลผู้ป่วย (PDPA · admin_audit_log() + ดาวน์โหลด CSV)
js/pages/chat.js      แชท real-time: mountInbox() กล่องข้อความเจ้าหน้าที่/ผู้ดูแล (ลบห้องลงถัง กู้คืน 30 วัน · ผู้ดูแลลบถาวรเมื่อครบ), startChatWatch() ตัวเลขข้อความใหม่บนเมนู
js/pages/unitchat.js  แชท ผู้ดูแล ⇄ เจ้าหน้าที่ รพ.สต. แยกห้องรายคน (unit_messages.staff_id + staff_threads · 31_staff_threads.sql): #/staff/messages/admin, #/admin/messages/units (แถบ รพ.สต. → รายชื่อเจ้าหน้าที่ → ห้อง) · mountUnitChat(slot, unit)
js/pages/me.js        ประชาชน (#/me): ข้อมูลส่วนตัว + แชทถาม รพ.สต./ห้องยา รพ. (ต้องมีเบอร์โทรก่อน) · ปลายทาง = เลือก รพ.สต. เท่านั้น (ห้องยา รพ. เดิมอ่านได้อย่างเดียว · ผู้ดูแลเข้าไปช่วยตอบในกล่องของ รพ.สต. ได้)
                      ไม่ล็อกอินก็แชทได้ (guest_chat_* ใน 30_guest_chat.sql): ชื่อเล่น · ≤15 ตัวอักษร/ข้อความ · 20 ข้อความ/เครื่อง/วัน · ไม่มีรูป · ลบเองเมื่อเงียบ 7 วัน (purge_guest_chats ← กล่องข้อความ + keepalive)
js/pages/staff-request.js  ขอสิทธิ์เจ้าหน้าที่: ประชาชนส่งคำขอ (#/me/request) → ผู้ดูแลอนุมัติใน ตั้งค่า › บัญชีเจ้าหน้าที่ (approve_staff_request เพิ่ม staff_roster)
js/pages/docs.js      เอกสารดาวน์โหลด: ผู้ดูแลอัปโหลด/แก้/แทนที่ไฟล์/ลบ + เลือกผู้ที่ดาวน์โหลดได้ (เจ้าหน้าที่ / ประชาชนทั่วไป = documents.is_public) + ข้อมาตรฐานที่ตรงกัน (documents.item_ids → หน้ามาตรฐานแสดงในข้อนั้น · 70_public_docs.sql)
                      หน้า "ดาวน์โหลดเอกสาร" #/documents (ปุ่มท้ายเว็บ · แสดงในหน้าเจ้าหน้าที่/ผู้ดูแลด้วย · ไม่มีเมนูในระบบเจ้าหน้าที่แล้ว · #/staff/docs พามาที่นี่) initDocs() — RLS กรองตามสิทธิ์ (bucket documents)
js/pages/staff.js     เจ้าหน้าที่: โครงหน้า/เมนู (ข่าว › ข้อความ › เยี่ยมบ้าน › ผลงาน › มาตรฐาน › ข้อเสนอแนะ) + ข่าว (ส่งตรวจ) + ผลงาน + ข้อเสนอแนะ + ตัวเลขแจ้งเตือน
                      ผลงาน: AI แนะนำข้อมาตรฐานจากรายละเอียด (ai_match_start/poll/link · 37_ai_match.sql: ฐานข้อมูลเรียก Gemini ผ่าน pg_net · คีย์ใน Supabase Vault ที่ ci-deploy ส่งจาก GitHub Secrets ด้วย ops.set_ai_key · รุ่นจาก site_texts ai_match_model) · สถานะ AI ในรายการผลงาน
js/pages/criteria.js  เจ้าหน้าที่: ส่งหลักฐานเกณฑ์มาตรฐานรายข้อ (item_status + bucket evidence) + ผลงานที่ผูกข้อนั้น (achievements.item_ids · 36_achievement_items.sql · ไม่ต้องส่งตรวจ)
js/pages/delivery.js  บริการจัดส่งยาถึงบ้าน (#/delivery): โปสเตอร์/ข้อความ/สถิติ + ผู้ดูแล › ตั้งค่า › จัดส่งยาถึงบ้าน
js/pages/delivery-report.js สรุปจากไฟล์ "ประวัติรายการจัดส่งยา" (Excel/CSV · 53_delivery_reports.sql): ผู้ดูแล › ตั้งค่า › จัดส่งยาถึงบ้าน เลือกไฟล์ → อ่านในเครื่อง (ไม่อัปโหลด) → summarizeDelivery() เก็บเฉพาะตัวเลขสรุป (ฐานข้อมูลปฏิเสธตัวเลข ≥9 หลัก)
                      → หน้า #/delivery แสดงตัวเลข + กราฟ เดือน/ตำบล/ช่องทาง/สิทธิ · ปุ่ม "ให้ AI สรุปเป็นข้อความ" (ai_delivery_start/poll ส่งเฉพาะตัวเลขสรุป)
js/pages/rider.js     Health Rider: ผลงานแสดงในช่องบริการจัดส่งยาถึงบ้าน (#hrBlock · #/rider เลื่อนไปที่นั่น · ไม่มีปุ่มเมนูแยก) · แยกตามตำบล (rider_tambon_stats · 55_rider_tambon.sql: ส่งสำเร็จ/ผู้รับบริการ/ยกเลิก/ส่งฟรี ตามหัวข้อไฟล์ประวัติรายการจัดส่งยา · นับเฉพาะบริการ rider)
                      ผู้ดูแล › Health Rider mountRiderEditor(slot): กรอกเอง หรือนำเข้าไฟล์ (riderByTambon ใน delivery-report.js · อ่านในเครื่อง ปีงบจากวันที่สร้างออเดอร์) · ส่งออกข้อมูลจากไฟล์ที่เลือกเป็น Excel (#hrExport: ติ๊กหัวข้อตามลำดับ + เลือกรายการ สำเร็จ/ทั้งหมด/rider · exportRows/downloadXlsx · ทำในเครื่อง ไม่อัปโหลด ไม่บันทึก · มี PII เตือน PDPA) · ปีงบที่ยังไม่มีข้อมูลรายตำบลแสดงแบบเดิมราย รพ.สต. (rider_stats)
js/pages/summaries.js สรุปผลงานเยี่ยมบ้าน one page summary ราย รพ.สต.×ปีงบ (หลายภาพ: image_path + gallery · เลือก รพ.สต. ได้ · 35_summary_images.sql · วันที่ summary_date + ผู้ร่วมลง participant_ids/names จาก staff_directory() (รวมคนในบัญชีเจ้าหน้าที่ที่ยังไม่เคยเข้าระบบ → เก็บเป็นชื่อ · 40_staff_directory_roster.sql) + participant_others กรอกเอง · 38_summary_date_people.sql · เชื่อมโยงรายการเยี่ยม summary_visits (39_summary_visits.sql · RLS อ้าง visits = เห็นเฉพาะผู้มีสิทธิ์ · หน้าอ่านแสดงเฉพาะเจ้าหน้าที่/ผู้ดูแล + log_patient_access · ลิงก์ #/staff|admin/visits/<visit id> · เจ้าหน้าที่ทุกคนเห็นรายการแบบ "ชื่อจริง****" ผ่าน summary_visit_list · ชื่อเต็ม+รายละเอียด (summary_visit_detail) = ผู้ร่วมลง/หน่วยที่ดูแล/ผู้ดูแล · 41_summary_visit_access.sql) · นับผู้ลงเยี่ยมตามตำแหน่ง (staff_roster.position · participant_positions · ตำแหน่งในวงเล็บของชื่อที่กรอกเอง) + summary_patient_count · 42_summary_counts.sql): กรอบโปสเตอร์ 10:7 ในผลการดำเนินงาน (loadSummaryList + renderSummaryPoster สลับภาพ), หน้าอ่าน #/summary/<id>, ฟอร์มในหน้าเยี่ยมบ้าน mountSummaries(slot, unit)
                      หน้าเยี่ยมบ้านแยก 2 ช่อง: #/staff|admin/visits = รายชื่อผู้ป่วย · /visits/summary = One page summary (visitTabs ใน staff.js)
                      ฟอร์มสรุป: กล่อง "แนบรายชื่อเยี่ยมบ้าน" (บน) / "แนบรายชื่อเจ้าหน้าที่" (ติ๊กเปิด · ไม่ติ๊ก = ไม่บันทึกรายชื่อนั้น) + "บันทึกเป็นผลงานตามมาตรฐานข้อ" → สร้าง/แก้ achievements (item_ids) ของ รพ.สต. นั้น · visit_summaries.achievement_id (51_summary_achievement.sql)
js/pages/visits.js    ผู้ป่วย + บันทึกเยี่ยมบ้าน (SOAP: S/O/A(assessment)/P, ชีพจร visits.pulse (45_visit_pulse.sql), Medication reconciliation = รายการยา + วิธีใช้ (med_list.how) + หมายเหตุ + ติ๊กยาเหลือค้างเกินวันนัด, DRPs) — mountVisits(slot, unit) ใช้ทั้งเจ้าหน้าที่และผู้ดูแล
                      แผงผู้ป่วยวาดแยกส่วน (renderInfo/renderVisitForm/renderVisits): ฟอร์มแก้ไขผู้ป่วยย่อได้ + ค้างไว้ระหว่างแก้บันทึกเยี่ยม · กดชื่อซ้ำ = ย่อ
                      สังกัด รพ.สต. = หน่วยที่ดูแล: เปลี่ยนแล้วย้ายผู้ป่วย+บันทึกเยี่ยมด้วย rpc transfer_patient (33_patient_transfer.sql) · ผู้ดูแลมีช่อง ALL = โรงพยาบาล รวมทุกชื่อ
                      ไม่ทราบวันเกิดกรอกอายุได้ (patients.age_years + age_at · 64_patient_age.sql · ageOf()) · ที่อยู่แยกช่อง patients.address_parts {no,moo,tambon,amphoe,province,zip} + address (ข้อความเต็ม)
js/upload.js          อัปโหลดไฟล์: ย่อรูปเป็น WebP (imagePicker แสดงตัวอย่างทันที), ภาพย่อไฟล์ fileCard/hydrateSigned, ลิงก์ชั่วคราวไฟล์ส่วนตัว
supabase/NN_*.sql     migration เรียงเลข · ไฟล์ใหม่ = เลขถัดไป → ระบบรันบน Supabase ให้เองหลังทดสอบผ่าน (tools/db/migrate.sh)
.github/workflows/    ci-deploy (ทดสอบ→รวม→ฐานข้อมูล→ขึ้นเว็บ) · keepalive (กัน Supabase หลับ) · backup (สำรองรายสัปดาห์) · restore (กู้) · ai-news (ช่อง AI เช็กทุกชั่วโมง ทำวันละ 1 ข่าว)
tools/ai_news/        run.mjs ข่าวจากบทความ CCPE: เลือกบทความ → PDF → Gemini (ฟรี · pro ก่อน flash) ① วิเคราะห์ข้อเท็จจริง+เลขหน้า ② เขียนข่าว ③ ตรวจทานเทียบ PDF แก้ซ้ำ ≤3 รอบ (ยังผิด = รอผู้ดูแลตรวจ) → ถอดข้อความ PDF เก็บ news_sources (pdftotext/Gemini) → templates.mjs ภาพแม่แบบ 3 ภาพ (ไม่ใช้ AI วาดภาพ ตามเจ้าของเว็บ) → บันทึกข่าว · --check / --offline
tools/nlem/            parse.py ถอดบัญชียาหลักแห่งชาติ 2569 จาก PDF ราชกิจจานุเบกษา (ตามตำแหน่งคอลัมน์ · pymupdf) → nlem2569.json → build_sql.py → 57_drug_monographs.sql
tools/ddi/             map.py (ยา รพ.สต. → ชื่อใน DDInter) · fetch.py ดึงคู่ interaction + รายละเอียด + CYP จาก DDInter → ddi.json → build_sql.py → 61_ddi.sql
                      fda_labels.py ฉลาก openFDA ของยา รพ.สต. (ตาราง FDA รหัสยา→ชื่อสามัญสหรัฐฯ+ช่องทาง) → 59_fda_labels.sql (หัวข้อ/ตัดความยาวตรงกับ FDA_SECTIONS ใน admin-drugs.js)
                      local_drugs.py รายการยา รพ.สต. (rpst_drugs.txt จากเจ้าของเว็บ) + ตาราง LINK รหัสยา→ชื่อในบัญชี → 58_local_drugs.sql (ข้อมูลใส่แบบ on conflict do nothing · ไม่ทับที่ผู้ดูแลแก้)
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
- ขนาดยา (90_dose_rules.sql): ประชาชน/เจ้าหน้าที่เห็น dose_drugs เฉพาะ active + approved_at · trigger ตรวจ dose_inds_problem + dose_rules_problem ตอนแสดง/แก้ข้อบ่งใช้ แล้วใส่ผู้อนุมัติเอง · ซ่อน = ล้างการอนุมัติ
  ยาเดิมที่แสดงอยู่แต่ไม่มีผู้อนุมัติ → ผู้ดูแลตรวจในหน้าโปรไฟล์ยาแล้วกดอนุมัติ (approve_dose · ตรวจกฎซ้ำ) · ทุกทางที่บันทึกแบบแสดง (saveDose · ฟอร์มขนาดยาเดิม) เรียก approve_dose
- AI ตรวจย้อนหลังขนาดยา (91_dose_audit.sql): ai_auto_tick → dose_audit_tick ช่วง 00–05 น. ไทย ทีละ 1 ยา (อนุมัติแล้ว + มีฉลาก OpenFDA · ยังไม่เคยตรวจ/อนุมัติใหม่/เกิน 30 วัน) → dose_drugs.audit_flags [{name, level, why, quote}]
  wrong (ตัวเลขขัดกับฉลาก + quote อยู่ในฉลากจริง) = หน้าคำนวณหยุดแสดงข้อนั้น [data-audit-block] · doubt = ยังแสดง เตือนผู้ดูแล [data-audit-doubt] · ธงระบบใส่เท่านั้น (GUC pcps.audit) · อนุมัติใหม่ล้างธง
  92_dose_audit_decide.sql (ผลตรวจระบบ 23 ต.ค. F-01 · ไม่เพิ่มตาราง): AI ให้ระดับ wrong (ฉลากมีข้อบ่งใช้นี้แต่ตัวเลขขัด = ซ่อนเอง) · offlabel (ฉลากไม่มีข้อบ่งใช้/อายุนี้ = ไม่ซ่อน) · doubt
  เภสัชกรตัดสินในการ์ด [data-dw-decide] → dose_audit_decide: conflict (ซ่อนจนแก้) · offlabel_ok · local · no_conflict (กลับมาแสดง) · การตัดสินอยู่ในธง (decision/decided_at/sig) · ผู้ตัดสิน = drug_data_history
  ตรวจซ้ำทุก 30 วัน: ตัดสินแล้ว + ตัวเลขเดิม (sig ตรง) = คงการตัดสิน ไม่ธง/ซ่อนซ้ำ · หน้าคำนวณบอก "ซ่อนเพราะ… โดย… เมื่อ…" [data-audit-why] · JS ใช้ flagHides/flagOpen/FLAG_LEVEL/DECISION ใน dose-rules.js
  ผู้ดูแล: กล่อง #dcAudit (ภาพรวม · เฉพาะธงที่ยังต้องทำ) + ตัวเลข #admDrugsBadge + ธงในการ์ด [data-dw-audit] (dose_audit_resolve 91 = รุ่นเก่า ยังใช้ได้) · สั่งตรวจตอนนี้ dose_audit_now/poll [data-dw-auditnow] (30 ครั้ง/วัน) · ผลตอบที่ข้อมูลเปลี่ยนไปแล้ว = ไม่ใช้
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
- `bash tests/run_all.sh` = ทุกอย่าง (ต้องผ่านก่อน push) · รวม `node --test tests/clinical/*.test.mjs` (กฎความปลอดภัยข้อมูลขนาดยา · ข้อมูลทดสอบสมมติ ห้ามใช้ข้อมูลยาจริงทำให้ test ผ่าน) · ในเครื่องที่ไม่มี Postgres/Playwright จะข้ามขั้นนั้นพร้อมเตือน แต่บน Actions ห้ามข้าม
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
