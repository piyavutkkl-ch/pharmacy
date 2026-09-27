#!/usr/bin/env bash
# สำรองข้อมูลรายสัปดาห์ (GitHub Actions: .github/workflows/backup.yml)
#   1) ฐานข้อมูล: pg_dump → ทดลองกู้ใน Postgres ชั่วคราว → เข้ารหัส → Google Drive  (db-YYYY-MM-DD.tar.gz.gpg)
#   2) ไฟล์ใน Storage: ต้นเดือนเก็บครบทุกไฟล์ (files-full-…) สัปดาห์อื่นเก็บเฉพาะไฟล์ใหม่ (files-inc-…)
#   3) ลบไฟล์สำรองเก่าตามนโยบายใน gdrive.py
# เข้ารหัส AES-256 ด้วยรหัสผ่าน BACKUP_PASSPHRASE — ไม่มีรหัสนี้จะเปิดไฟล์สำรองไม่ได้ (Google ก็เปิดไม่ได้)
# ห้ามพิมพ์ข้อมูลจริงลง log: repo เป็นสาธารณะ ใครก็อ่าน log ของ GitHub Actions ได้
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
MODE=${MODE:-auto}                                     # auto | full | inc | db-only

miss=()
for k in SUPABASE_DB_URL SUPABASE_URL BACKUP_PASSPHRASE GDRIVE_CLIENT_ID GDRIVE_CLIENT_SECRET GDRIVE_REFRESH_TOKEN; do
  [ -n "${!k:-}" ] || miss+=("$k")
done
[ "$MODE" = db-only ] || [ -n "${SUPABASE_SECRET_KEY:-}" ] || miss+=(SUPABASE_SECRET_KEY)
if [ ${#miss[@]} -gt 0 ]; then echo "ERROR: ยังไม่ได้ตั้ง GitHub Secret: ${miss[*]} (ดู docs/BACKUP.md)" >&2; exit 1; fi
[ ${#BACKUP_PASSPHRASE} -ge 16 ] || { echo "ERROR: BACKUP_PASSPHRASE ต้องยาวอย่างน้อย 16 ตัวอักษร" >&2; exit 1; }

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
stamp=$(TZ=Asia/Bangkok date +%F)
encrypt() {  # encrypt <โฟลเดอร์ใน $work> <ไฟล์ผลลัพธ์>
  tar -C "$work" -czf - "$1" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
    --symmetric --cipher-algo AES256 -o "$2" 3<<<"$BACKUP_PASSPHRASE"
}

# ---------- 1) ฐานข้อมูล ----------
DB_URL=$SUPABASE_DB_URL
source "$here/pg_client.sh"
mkdir -p "$work/db"
pg_dump "$DB_URL" --schema-only --no-owner --no-privileges --schema=public -f "$work/db/schema_public.sql"
pg_dump "$DB_URL" --data-only --no-owner --no-privileges --table='public.*' -f "$work/db/data_public.sql"
pg_dump "$DB_URL" --data-only --no-owner --no-privileges --table=auth.users --table=auth.identities -f "$work/db/data_auth.sql"
python3 "$here/counts.py" "$work/db/data_public.sql" > "$work/db/counts.txt"
git -C "$here/../.." rev-parse HEAD > "$work/db/schema_version.txt" 2>/dev/null || true
echo "database dump: $(wc -l < "$work/db/counts.txt") tables, $(awk -F'\t' '{s+=$2} END {print s}' "$work/db/counts.txt") rows, $(du -sh "$work/db" | cut -f1)"

if [ -n "${VERIFY_DB_URL:-}" ]; then
  bash "$here/verify.sh" "$work/db" "$VERIFY_DB_URL"
fi
rm -f "$work/db/expected.txt" "$work/db/actual.txt"
encrypt db "$work/db-$stamp.tar.gz.gpg"
python3 "$here/gdrive.py" upload "$work/db-$stamp.tar.gz.gpg"

# ---------- 2) ไฟล์ใน Storage ----------
if [ "$MODE" != db-only ]; then
  kind=$MODE
  if [ "$kind" = auto ]; then [ "$(TZ=Asia/Bangkok date +%-d)" -le 7 ] && kind=full || kind=inc; fi
  python3 "$here/storage.py" pull "$kind" "$work/files"
  encrypt files "$work/files-$kind-$stamp.tar.gz.gpg"
  python3 "$here/gdrive.py" upload "$work/files-$kind-$stamp.tar.gz.gpg"
fi

# ---------- 3) ลบของเก่า ----------
python3 "$here/gdrive.py" prune
echo "backup finished $(TZ=Asia/Bangkok date '+%F %H:%M') (เวลาไทย)"
