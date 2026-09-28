#!/usr/bin/env bash
# สร้าง tests/ui/fixtures.json = ข้อมูลทุกตารางจากฐานข้อมูลทดสอบ (โครงสร้างจริงจาก supabase/*.sql + seed.sql)
# ใช้เป็นข้อมูลของ mock_supabase.js ตอนทดสอบหน้าเว็บ · รันใหม่ทุกครั้งที่แก้โครงสร้างตาราง (CI รันให้เองทุกครั้ง)
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
source "$root/tests/db/pg_local.sh"
psql "$PG_ADMIN_URL" -X -q -c "drop database if exists ui with (force)" -c "create database ui" 2>/dev/null
url=$(db_url ui)
bash "$root/tests/db/apply_schema.sh" "$url"
psql "$url" -X -q -v ON_ERROR_STOP=1 -f "$root/tests/ui/seed.sql" >/dev/null 2>&1 || { psql "$url" -X -q -v ON_ERROR_STOP=1 -f "$root/tests/ui/seed.sql" >/dev/null; exit 1; }
psql "$url" -X -At -v ON_ERROR_STOP=1 -c "
  select jsonb_pretty(jsonb_object_agg(c.relname, (xpath('/row/j/text()', query_to_xml(format(
    'select coalesce(json_agg(t), ''[]'') as j from public.%I t', c.relname), false, true, '')))[1]::text::jsonb))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'audit_log'" > "$root/tests/ui/fixtures.json"
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print('fixtures:', len(d), 'tables,', sum(len(v) for v in d.values()), 'rows')" "$root/tests/ui/fixtures.json"
