# Audit เครื่องคำนวณขนาดยา (Phase 1 · ตรวจอย่างเดียว ไม่แก้ระบบจริง)

ไฟล์ในโฟลเดอร์นี้ไม่ถูกโหลดโดยหน้าเว็บ และไม่อยู่ในชุดทดสอบ CI (branch `audit/dose-calc` ไม่ขึ้นต้นด้วย `claude/` · ไม่ push)

| ไฟล์ | ตรวจอะไร | วิธีรัน |
|---|---|---|
| `unit.mjs` | `kidney()` (CG/CKD-EPI 2021/Bedside Schwartz) + `strengthOf()` เทียบสูตรอ้างอิงที่เขียนแยก | `node audit/dose/unit.mjs --json audit/dose/unit-results.json` |
| `ui.cjs` | หน้าคำนวณจริงในเบราว์เซอร์ (Supabase จำลอง · ยาสังเคราะห์ AUDIT-…) | `bash tests/ui/make_fixtures.sh && NODE_PATH=$(npm root -g) node audit/dose/ui.cjs --json audit/dose/ui-results.json` |
| `db_audit.sh` / `db_audit.py` | RLS/constraint ของ dose_drugs + AI pipeline (คำตอบ openFDA/Gemini จำลอง) บน Postgres ในเครื่อง | `bash audit/dose/db_audit.sh --json audit/dose/db-results.json` |

ผล: FAIL = พฤติกรรมไม่ตรงข้อกำหนดในคำสั่งตรวจ · UNVERIFIED = ไม่มีแหล่งอ้างอิงที่ยืนยันได้ให้เทียบ
หลังแก้แต่ละประเด็น ให้รันไฟล์เหล่านี้ซ้ำ — กรณี FAIL ที่แก้แล้วต้องเปลี่ยนเป็น PASS และ PASS เดิมต้องยังผ่าน
