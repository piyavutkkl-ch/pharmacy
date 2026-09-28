#!/usr/bin/env bash
# ทดสอบระบบสำรอง/กู้ข้อมูลทั้งวงจร ในเครื่อง (ไม่แตะของจริง): Postgres ในเครื่อง + Google Drive/Storage จำลอง
# ต้องรัน tests/db/run.sh ก่อน (ใช้ฐานข้อมูล t ที่มีข้อมูลทดสอบเป็นต้นทาง) · ตั้ง PG_ADMIN_URL ได้เหมือน tests/db/run.sh
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd); B=$root/tools/backup
source "$root/tests/db/pg_local.sh"
url() { db_url "$1"; }
psql "$PG_ADMIN_URL" -X -q -c "drop database if exists v with (force)" -c "create database v" -c "drop database if exists r with (force)" -c "create database r" 2>/dev/null
# ต้นทาง: เติมคอลัมน์/ตารางที่ Supabase จริงมีแต่ stub ไม่มี
psql "$(url t)" -X -q -c "alter table storage.objects add column if not exists created_at timestamptz default now(), add column if not exists updated_at timestamptz default now(), add column if not exists metadata jsonb" \
  -c "create table if not exists auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, provider text)" \
  -c "delete from storage.objects" \
  -c "insert into storage.objects(bucket_id,name,updated_at,metadata) values ('evidence','2570/2/1.1/a.pdf',now()-interval '2 days','{\"size\":12}'),('public-images','news/u1/n.webp',now()-interval '40 days','{\"size\":8}'),('documents','all/d.pdf',now()-interval '3 days','{\"size\":9}')"
python3 "$root/tests/backup/mock_cloud.py" 8799 & mock=$!; trap 'kill $mock 2>/dev/null' EXIT; sleep 1
export SUPABASE_DB_URL=$(url t) SUPABASE_URL=http://localhost:8799 SUPABASE_SECRET_KEY=sb_secret_test
export BACKUP_PASSPHRASE='test passphrase 1234567' GDRIVE_CLIENT_ID=cid GDRIVE_CLIENT_SECRET=csec GDRIVE_REFRESH_TOKEN=RT
export GDRIVE_TOKEN_URL=http://localhost:8799/token GDRIVE_API_BASE=http://localhost:8799/drive/v3 GDRIVE_UPLOAD_BASE=http://localhost:8799/upload/drive/v3
export VERIFY_DB_URL=$(url v)
MODE=full GDRIVE_CHUNK=262144 bash "$B/backup.sh"
# ปลายทาง: เหมือนโปรเจกต์ใหม่ที่รัน SQL แล้ว
bash "$root/tests/db/apply_schema.sh" "$(url r)"
psql "$(url r)" -X -q -c "create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, provider text)" \
  -c "alter table storage.objects add column created_at timestamptz, add column updated_at timestamptz, add column metadata jsonb"
RESTORE_DB_URL=$(url r) RESTORE_SUPABASE_URL=http://localhost:8799 RESTORE_SECRET_KEY=sb_secret_test bash "$B/restore.sh"
cnt() { psql "$1" -X -At -c "select 'public.'||c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' union all select 'auth.users', count(*)::text from auth.users order by 1"; }
diff <(cnt "$(url t)") <(cnt "$(url r)") && echo "PASS: ข้อมูลที่กู้ตรงกับต้นทางทุกตาราง"
curl -s localhost:8799/state | python3 -c "import json,sys; u=json.load(sys.stdin)['uploaded']; assert len(u)==3, u; print('PASS: กู้ไฟล์ Storage', len(u), 'ไฟล์')"
