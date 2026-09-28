#!/usr/bin/env bash
# ทดสอบฐานข้อมูล: สร้างฐานข้อมูลว่าง → จำลองของที่ Supabase มีให้ (stub) → รัน supabase/*.sql ทุกไฟล์ (ข้าม 02) → tests/rls_test.py
# ใช้:  bash tests/db/run.sh            (ถ้าไม่ได้ตั้ง PG_ADMIN_URL จะเปิด Postgres ชั่วคราวในเครื่องให้เอง)
#       PG_ADMIN_URL=postgresql://postgres:pw@localhost:5432/postgres bash tests/db/run.sh   (CI ใช้แบบนี้)
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
source "$root/tests/db/pg_local.sh"
db=${TEST_DB_NAME:-t}
psql "$PG_ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -c "drop database if exists $db with (force)" -c "create database $db" 2>/dev/null
export TEST_DB_URL=$(db_url "$db")
bash "$root/tests/db/apply_schema.sh" "$TEST_DB_URL"
out=$(python3 "$root/tests/rls_test.py" 2>&1) || { echo "$out" | grep -v '^PASS' ; echo "FAIL: tests/rls_test.py" >&2; exit 1; }
echo "$out" | tail -1
