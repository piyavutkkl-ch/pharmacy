#!/usr/bin/env bash
# ทดสอบระบบสำรอง/กู้ข้อมูลทั้งวงจร ในเครื่อง (ไม่แตะของจริง): Postgres ในเครื่อง + Google Drive/Storage จำลอง
# ต้องมี: Postgres ที่ใช้ได้ผ่าน PG_BASE (ค่าเริ่มต้น socket /var/tmp/pgtest พอร์ต 5433 แบบ tests/rls_test.py)
#         และฐานข้อมูลต้นทาง t ที่รัน supabase/*.sql + tests/rls_test.py มาแล้ว
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd); B=$root/tools/backup
PG_BASE=${PG_BASE:-"host=/var/tmp/pgtest&port=5433&user=postgres"}
url() { echo "postgresql:///$1?$PG_BASE"; }
psql "$(url postgres)" -X -q -c "drop database if exists v" -c "create database v" -c "drop database if exists r" -c "create database r"
# ต้นทาง: เติมคอลัมน์/ตารางที่ Supabase จริงมีแต่ stub ไม่มี
psql "$(url t)" -X -q -c "alter table storage.objects add column if not exists created_at timestamptz default now(), add column if not exists updated_at timestamptz default now(), add column if not exists metadata jsonb" \
  -c "create table if not exists auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, provider text)" \
  -c "delete from storage.objects" \
  -c "insert into storage.objects(bucket_id,name,updated_at,metadata) values ('evidence','2570/2/1.1/a.pdf',now()-interval '2 days','{\"size\":12}'),('public-images','news/u1/n.webp',now()-interval '40 days','{\"size\":8}'),('documents','all/d.pdf',now()-interval '3 days','{\"size\":9}')"
python3 "$root/tests/backup/mock_cloud.py" 8799 & mock=$!; trap 'kill $mock' EXIT; sleep 1
export SUPABASE_DB_URL=$(url t) SUPABASE_URL=http://localhost:8799 SUPABASE_SECRET_KEY=sb_secret_test
export BACKUP_PASSPHRASE='test passphrase 1234567' GDRIVE_CLIENT_ID=cid GDRIVE_CLIENT_SECRET=csec GDRIVE_REFRESH_TOKEN=RT
export GDRIVE_TOKEN_URL=http://localhost:8799/token GDRIVE_API_BASE=http://localhost:8799/drive/v3 GDRIVE_UPLOAD_BASE=http://localhost:8799/upload/drive/v3
export VERIFY_DB_URL=$(url v)
MODE=full GDRIVE_CHUNK=262144 bash "$B/backup.sh"
# ปลายทาง: เหมือนโปรเจกต์ใหม่ที่รัน SQL แล้ว
psql "$(url r)" -X -q -f "$root/tests/stub_new_default.sql" >/dev/null 2>&1
for f in "$root"/supabase/0*.sql; do psql "$(url r)" -X -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1; done
psql "$(url r)" -X -q -c "create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, provider text)" \
  -c "alter table storage.objects add column created_at timestamptz, add column updated_at timestamptz, add column metadata jsonb"
RESTORE_DB_URL=$(url r) RESTORE_SUPABASE_URL=http://localhost:8799 RESTORE_SECRET_KEY=sb_secret_test bash "$B/restore.sh"
cnt() { psql "$1" -X -At -c "select 'public.'||c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' union all select 'auth.users', count(*)::text from auth.users order by 1"; }
diff <(cnt "$(url t)") <(cnt "$(url r)") && echo "PASS: ข้อมูลที่กู้ตรงกับต้นทางทุกตาราง"
curl -s localhost:8799/state | python3 -c "import json,sys; u=json.load(sys.stdin)['uploaded']; assert len(u)==3, u; print('PASS: กู้ไฟล์ Storage', len(u), 'ไฟล์')"
