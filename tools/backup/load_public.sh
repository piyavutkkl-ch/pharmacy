#!/usr/bin/env bash
# ล้างตาราง public ทั้งหมดในปลายทาง แล้วโหลดข้อมูลจากไฟล์สำรอง (ปิด trigger ระหว่างโหลดด้วย replica mode)
# ใช้:  load_public.sh <connection string> <data_public.sql> [data_auth.sql]
#   ถ้าให้ data_auth.sql ด้วย จะแทนที่บัญชีผู้ใช้ (auth.users) ในรายการเดียวกัน — พลาดตรงไหนจะไม่มีอะไรเปลี่ยน
set -euo pipefail
url=$1; data=$2; auth=${3:-}
tables=$(psql "$url" -X -At -v ON_ERROR_STOP=1 -c "select string_agg(format('public.%I', c.relname), ', ')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'")
[ -n "$tables" ] || { echo "ERROR: ปลายทางยังไม่มีตาราง — รัน SQL ใน supabase/ (01, 03–ล่าสุด) ก่อน" >&2; exit 1; }
args=(-c "truncate table $tables restart identity cascade")
[ -z "$auth" ] || args+=(-c "delete from auth.users")
args+=(-c "set session_replication_role = replica")
[ -z "$auth" ] || args+=(-f "$auth")
psql "$url" -X -q -v ON_ERROR_STOP=1 --single-transaction "${args[@]}" -f "$data" >/dev/null
