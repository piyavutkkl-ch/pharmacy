# กันระบบหลับ + สำรองข้อมูล (ขั้นที่ 5) — ฟรี 100%

| งาน | ไฟล์ | ทำอะไร | ต้องตั้งค่า |
|---|---|---|---|
| **keepalive** | `.github/workflows/keepalive.yml` | เรียก Supabase จันทร์/พฤหัส กันโปรเจกต์ฟรีถูกหยุดเมื่อไม่มีคนใช้ 7 วัน และกัน GitHub ปิดงานตั้งเวลาเมื่อ repo เงียบ 60 วัน | ไม่ต้อง |
| **backup** | `.github/workflows/backup.yml` | ทุกคืนวันเสาร์ (อาทิตย์ 02:23 น.) สำรองฐานข้อมูล + ไฟล์ → เข้ารหัส AES-256 → Google Drive กลาง · ทดลองกู้ทุกครั้งเพื่อยืนยันว่าไฟล์ใช้ได้จริง | 6 secrets |
| **restore** | `.github/workflows/restore.yml` | กู้ข้อมูลจากไฟล์สำรองกลับขึ้น Supabase (กดรันเองเท่านั้น) | +2 secrets ตอนจะกู้ |

**สิ่งที่ถูกสำรอง**
- `db-YYYY-MM-DD.tar.gz.gpg` ทุกสัปดาห์ คือทุกตารางของเว็บและบัญชีผู้ใช้ เก็บไว้ 26 สัปดาห์ (≈ 6 เดือน)
- `files-full-…` เดือนละครั้ง (สัปดาห์แรกของเดือน) คือรูป เอกสาร และหลักฐานทุกไฟล์ เก็บไว้ 3 ชุด
- `files-inc-…` สัปดาห์อื่นของเดือน เก็บเฉพาะไฟล์ใหม่หรือไฟล์ที่แก้ใน 15 วันล่าสุด

> 🔒 repo นี้เป็นสาธารณะ ค่าลับทุกตัวต้องใส่ที่ **GitHub → Settings → Secrets and variables → Actions** เท่านั้น
> ห้ามใส่ในไฟล์ใด ๆ ห้ามส่งในแชท และห้ามส่งให้ AI · ไฟล์สำรองมีข้อมูลผู้ป่วย (PDPA) จึงเข้ารหัสทุกไฟล์ Google เองก็เปิดอ่านไม่ได้

---

## ตั้งค่าครั้งแรก (ประมาณ 20 นาที)

### 1. `SUPABASE_DB_URL` — ที่อยู่ฐานข้อมูล
1. Supabase → เลือกโปรเจกต์ → ปุ่ม **Connect** (ด้านบน)
2. เลือกแบบ **Session pooler** (ต้องเป็นแบบนี้ เพราะ GitHub ต่อแบบ Direct ไม่ได้) → คัดลอก URI
   หน้าตาประมาณ `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres`
3. แทน `[YOUR-PASSWORD]` ด้วยรหัสผ่านฐานข้อมูล ถ้าจำไม่ได้ให้ไปที่ Project Settings → Database → **Reset database password** (หน้าเว็บไม่กระทบ เพราะเว็บใช้ API key ไม่ได้ใช้รหัสนี้)

### 2. `SUPABASE_SECRET_KEY` — ใช้ดึงไฟล์รูป/เอกสาร
Project Settings → **API Keys** → Secret keys → สร้างหรือกดดูคีย์ `sb_secret_…` แล้วคัดลอก

### 3. `BACKUP_PASSPHRASE` — รหัสเข้ารหัสไฟล์สำรอง
- ตั้งเองให้ยาวอย่างน้อย 16 ตัว เช่น เป็นประโยคที่จำได้
- **จดเก็บไว้นอกคอมพิวเตอร์** เช่น ใส่ซองปิดผนึกเก็บในตู้เซฟห้องยา หรือเก็บใน password manager
- ถ้ารหัสนี้หาย ไฟล์สำรองทั้งหมดจะเปิดไม่ได้อีก

### 4. `GDRIVE_CLIENT_ID` / `GDRIVE_CLIENT_SECRET` / `GDRIVE_REFRESH_TOKEN` — สิทธิ์เขียน Google Drive กลาง
ใช้ Google Cloud โปรเจกต์เดียวกับที่ตั้งค่า Google login ไว้แล้ว

1. **APIs & Services → Library** → ค้นหา **Google Drive API** → Enable
2. **Google Auth Platform → Data Access** → Add or remove scopes → ติ๊ก `…/auth/drive.file` แล้วกด Save
   scope นี้ให้ระบบเห็นเฉพาะไฟล์ที่ระบบสำรองสร้างเอง ไม่เห็นไฟล์อื่นใน Drive
3. **Google Auth Platform → Clients** → Create client → ประเภท **Web application** → ตั้งชื่อ `Backup`
   - ในช่อง Authorized redirect URIs ใส่ `https://developers.google.com/oauthplayground` → Create
   - คัดลอก Client ID และ Client secret ไว้
4. เปิด https://developers.google.com/oauthplayground
   - กดรูปเฟือง ⚙️ มุมขวาบน → ติ๊ก **Use your own OAuth credentials** → วาง Client ID/secret → ปิด
   - ช่อง "Input your own scopes" ด้านซ้าย พิมพ์ `https://www.googleapis.com/auth/drive.file` → **Authorize APIs**
   - เข้าสู่ระบบด้วย **บัญชี Google กลางที่จะเก็บไฟล์สำรอง** → อนุญาต
     ถ้าขึ้นว่า "Google hasn't verified this app" ให้กด Advanced → Go to … (เป็นแอปของเราเอง)
   - กด **Exchange authorization code for tokens** → คัดลอก **Refresh token**

### 5. ใส่ค่าทั้ง 6 ตัวใน GitHub
repo → **Settings → Secrets and variables → Actions → New repository secret** ใส่ทีละตัว ชื่อต้องตรงตามนี้:
`SUPABASE_DB_URL`, `SUPABASE_SECRET_KEY`, `BACKUP_PASSPHRASE`, `GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET`, `GDRIVE_REFRESH_TOKEN`

### 6. ทดสอบ
1. แท็บ **Actions** → เลือก **backup** → Run workflow → mode = `full` → Run
2. รอประมาณ 2–5 นาที ถ้าขึ้นเครื่องหมายถูกสีเขียว ให้เปิด Google Drive ของบัญชีกลาง จะเห็นโฟลเดอร์ **Pharmacy-Backups**
3. เลือก **keepalive** → Run workflow หนึ่งครั้ง
4. ถ้างานไหนล้มเหลว GitHub จะส่งอีเมลแจ้งเจ้าของ repo ให้เปิดดู log ได้ log แสดงแค่จำนวนและขนาด ไม่มีข้อมูลจริง

---

## กู้ข้อมูล (เมื่อข้อมูลหาย / โปรเจกต์เสีย)

> ⚠️ การกู้จะ **แทนที่ข้อมูลทั้งหมด** ในโปรเจกต์ปลายทางด้วยข้อมูลในไฟล์สำรอง

**ก. กู้ลงโปรเจกต์เดิม** (เช่น ข้อมูลถูกลบผิด)
1. เพิ่ม secret `RESTORE_DB_URL` ใส่ค่าเดียวกับ `SUPABASE_DB_URL` และ `RESTORE_SECRET_KEY` ใส่ค่าเดียวกับ `SUPABASE_SECRET_KEY`
2. Actions → **restore** → Run workflow
   - `target_url` = URL โปรเจกต์ (ดูได้ใน `js/config.js`)
   - `confirm` = `RESTORE-<ref>` โดย ref คือตัวอักษรหน้า `.supabase.co`
   - `backup` = เว้นว่างเพื่อใช้ไฟล์ล่าสุด หรือใส่ชื่อไฟล์ `db-…` ที่ต้องการ
3. เสร็จแล้วให้ลบ secret `RESTORE_*` ออก กันกดผิดในภายหลัง

**ข. กู้ลงโปรเจกต์ใหม่** (เช่น โปรเจกต์ถูกลบ)
1. สร้างโปรเจกต์ Supabase ใหม่ (Singapore) → SQL Editor → รันไฟล์ใน `supabase/` ตามลำดับ **ข้าม 02**
2. ตั้งค่า Google login ใหม่เหมือนขั้นที่ 2 (Authentication → Providers → Google, URL Configuration) และเพิ่ม callback URL ใหม่ใน Google Cloud
3. แก้ `js/config.js` ใส่ URL และ publishable key ของโปรเจกต์ใหม่
4. ตั้ง secret `RESTORE_DB_URL` และ `RESTORE_SECRET_KEY` ของโปรเจกต์ใหม่ → รัน **restore** ตามข้อ ก.
5. เปลี่ยน `SUPABASE_DB_URL` และ `SUPABASE_SECRET_KEY` ให้ชี้โปรเจกต์ใหม่ เพื่อให้สำรองต่อได้

**เปิดไฟล์สำรองด้วยมือ** (ไม่ต้องกู้ทั้งระบบ): ติดตั้ง GnuPG (Windows ใช้ Gpg4win) แล้วรัน
`gpg -d db-YYYY-MM-DD.tar.gz.gpg > db.tar.gz` ใส่ BACKUP_PASSPHRASE → แตกไฟล์ด้วย 7-Zip
ข้างในมี `data_public.sql` (ข้อมูลเว็บ), `data_auth.sql` (บัญชีผู้ใช้), `schema_public.sql`, `counts.txt`

---

## ค่าใช้จ่าย (ฟรีทั้งหมด)
- **GitHub Actions:** repo สาธารณะใช้ได้ไม่จำกัดนาที
- **Supabase:** การดึงไฟล์ครบชุดเดือนละครั้งนับเป็น egress เท่ากับขนาดไฟล์ทั้งหมด (โควตาฟรี 5 GB/เดือน พื้นที่ไฟล์ไม่เกิน 1 GB จึงไม่เกิน)
- **Google Drive:** พื้นที่ฟรี 15 GB ของบัญชีกลาง ระบบลบไฟล์สำรองเก่าให้อัตโนมัติ

## สำหรับนักพัฒนา / AI
- สคริปต์ทั้งหมดอยู่ใน `tools/backup/` ใช้ bash + Python มาตรฐาน + pg_dump รุ่นเดียวกับเซิร์ฟเวอร์
- ทดสอบครบวงจรในเครื่องด้วย `tests/backup/run.sh` ใช้ Postgres ในเครื่อง และจำลอง Google Drive/Storage
- ถ้าเพิ่มตารางใหม่ ไม่ต้องแก้อะไร เพราะสำรองทุกตารางใน schema `public` อัตโนมัติ แต่ต้องเพิ่มไฟล์ SQL ใน `supabase/` เพราะการกู้และการทดลองกู้สร้างโครงสร้างจากไฟล์เหล่านั้น
- ห้ามพิมพ์ข้อมูลจริงลง log ของ Actions (repo สาธารณะ) ให้พิมพ์ได้แค่จำนวนและขนาด
