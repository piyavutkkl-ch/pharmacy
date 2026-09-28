#!/usr/bin/env bash
# อัปเดตโครงสร้างฐานข้อมูล Supabase อัตโนมัติ (GitHub Actions: ci-deploy.yml เรียกหลังทดสอบผ่าน ก่อน deploy หน้าเว็บ)
#   - จดว่าไฟล์ไหนรันแล้วในตาราง ops.schema_migrations (schema ops ไม่เปิดผ่าน API ของเว็บ)
#   - ไฟล์ 01–07 รันด้วยมือไปแล้วก่อนมีระบบนี้ → ครั้งแรกบันทึกว่ารันแล้วโดยไม่รันซ้ำ
#   - ข้าม 02_first_admin.sql เสมอ (ข้อมูลผู้ดูแลจริง)
#   - มีไฟล์ใหม่ → สำรองฐานข้อมูลก่อน (ต้องตั้ง secrets ของระบบสำรองแล้ว) → รันทีละไฟล์ในรายการเดียว พลาด = ไม่มีอะไรเปลี่ยน
#   - คำสั่งที่ลบข้อมูล (drop table/column, truncate, delete from ...) ต้องมีบรรทัด
#       -- confirmed-destructive: <เหตุผล>   ในไฟล์ (ใส่ได้เมื่อเจ้าของเว็บยืนยันในแชทแล้วเท่านั้น)
# ใช้:  SUPABASE_DB_URL=… bash tools/db/migrate.sh [--dry-run]
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
BASELINE_MAX=7
export PGOPTIONS="-c client_min_messages=warning"
dry=${1:-}

files=()
for f in "$root"/supabase/[0-9]*.sql; do
  b=$(basename "$f"); [[ "$b" == 02_* ]] && continue; files+=("$b")
done
new_files() { for b in "${files[@]}"; do n=$((10#${b%%_*})); [ "$n" -gt "$BASELINE_MAX" ] && echo "$b"; done; }

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  if [ -n "$(new_files)" ]; then
    echo "::error::มีไฟล์ SQL ใหม่ ($(new_files | tr '\n' ' ')) แต่ยังไม่ได้ตั้ง Secret SUPABASE_DB_URL — ตั้งตาม docs/BACKUP.md แล้วกด Re-run"; exit 1
  fi
  echo "migrate: ไม่มีไฟล์ SQL ใหม่ (ยังไม่ได้ตั้ง SUPABASE_DB_URL จึงไม่ได้ตรวจกับฐานข้อมูล)"; exit 0
fi

DB_URL=$SUPABASE_DB_URL
source "$root/tools/backup/pg_client.sh" >/dev/null
Q=(psql "$DB_URL" -X -q -At -v ON_ERROR_STOP=1)
"${Q[@]}" -c "create schema if not exists ops; revoke all on schema ops from public;
  create table if not exists ops.schema_migrations (filename text primary key, checksum text not null, applied_at timestamptz not null default now())" >/dev/null
if [ "$("${Q[@]}" -c "select count(*) from ops.schema_migrations")" = 0 ] && [ "$("${Q[@]}" -c "select to_regclass('public.units') is not null")" = t ]; then
  for b in "${files[@]}"; do
    n=$((10#${b%%_*})); [ "$n" -le "$BASELINE_MAX" ] || continue
    "${Q[@]}" -c "insert into ops.schema_migrations(filename, checksum) values ('$b', '$(sha256sum "$root/supabase/$b" | cut -c1-16)') on conflict do nothing"
  done
  echo "migrate: บันทึกไฟล์ 01–0$BASELINE_MAX ที่รันด้วยมือไว้แล้วเป็นจุดเริ่มต้น"
fi

applied=$("${Q[@]}" -c "select filename from ops.schema_migrations")
pending=()
for b in "${files[@]}"; do grep -qxF "$b" <<<"$applied" || pending+=("$b"); done
if [ ${#pending[@]} -eq 0 ]; then echo "migrate: ฐานข้อมูลเป็นปัจจุบันแล้ว"; exit 0; fi
echo "migrate: ไฟล์ใหม่ ${pending[*]}"

for b in "${pending[@]}"; do
  body=$(sed -E 's/--.*$//' "$root/supabase/$b" | tr '[:upper:]' '[:lower:]')
  if grep -qE 'drop[[:space:]]+(table|schema|database)|drop[[:space:]]+column|truncate[[:space:]]|delete[[:space:]]+from' <<<"$body" \
     && ! grep -q -- '-- confirmed-destructive:' "$root/supabase/$b"; then
    echo "::error::$b มีคำสั่งที่ลบข้อมูล แต่ยังไม่มีบรรทัด '-- confirmed-destructive: <เหตุผล>' — ต้องให้เจ้าของเว็บยืนยันก่อน"; exit 1
  fi
done
[ "$dry" = --dry-run ] && { echo "migrate: dry-run — ไม่ได้รันจริง"; exit 0; }

echo "migrate: สำรองฐานข้อมูลก่อนเปลี่ยนแปลง…"
MODE=db-only VERIFY_DB_URL= bash "$root/tools/backup/backup.sh" \
  || { echo "::error::สำรองฐานข้อมูลไม่สำเร็จ จึงยังไม่อัปเดตฐานข้อมูล (ตรวจ secrets ของระบบสำรองใน docs/BACKUP.md)"; exit 1; }

for b in "${pending[@]}"; do
  sum=$(sha256sum "$root/supabase/$b" | cut -c1-16)
  if out=$(psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$root/supabase/$b" \
        -c "insert into ops.schema_migrations(filename, checksum) values ('$b', '$sum')" 2>&1 >/dev/null); then
    echo "migrate: ✓ $b"
  else
    echo "$out" | grep -vE 'NOTICE|HINT' | head -5 >&2
    echo "::error::รัน $b ไม่สำเร็จ — ฐานข้อมูลไม่เปลี่ยน (ย้อนกลับอัตโนมัติ) และหน้าเว็บยังไม่ถูกอัปเดต"; exit 1
  fi
done
echo "migrate: เสร็จ ${#pending[@]} ไฟล์"
