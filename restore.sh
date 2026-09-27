#!/usr/bin/env bash
# กู้ข้อมูลจากไฟล์สำรองใน Google Drive ลงโปรเจกต์ Supabase ปลายทาง (GitHub Actions: .github/workflows/restore.yml)
# ⚠️ ข้อมูลเดิมทั้งหมดในปลายทางจะถูกแทนที่ — ปลายทางต้องรัน SQL ใน supabase/ (01, 03–ล่าสุด) มาก่อน
# ค่าที่ใช้: RESTORE_DB_URL, RESTORE_SUPABASE_URL, RESTORE_SECRET_KEY, BACKUP_PASSPHRASE, GDRIVE_*
#          BACKUP_NAME (เว้นว่าง = ล่าสุด), RESTORE_FILES (true/false)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
for k in RESTORE_DB_URL RESTORE_SUPABASE_URL BACKUP_PASSPHRASE; do
  [ -n "${!k:-}" ] || { echo "ERROR: ยังไม่ได้ตั้งค่า $k" >&2; exit 1; }
done
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
cd "$work"
decrypt() { gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 -d "$1" 3<<<"$BACKUP_PASSPHRASE" | tar -xzf -; }

# ---------- ฐานข้อมูล ----------
name=$(python3 "$here/gdrive.py" fetch db ${BACKUP_NAME:+"$BACKUP_NAME"} | tail -1)
decrypt "$name" || { echo "ERROR: ถอดรหัสไม่ได้ — BACKUP_PASSPHRASE ไม่ตรงกับตอนสำรอง" >&2; exit 1; }
echo "restoring database from $name ($(wc -l < db/counts.txt) tables)"
DB_URL=$RESTORE_DB_URL
source "$here/pg_client.sh"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -c "select 1 from public.units limit 1" >/dev/null 2>&1 \
  || { echo "ERROR: ปลายทางยังไม่มีโครงสร้างตาราง — รัน SQL ใน supabase/ ตามลำดับ (ข้าม 02) ก่อน" >&2; exit 1; }
bash "$here/load_public.sh" "$DB_URL" db/data_public.sql db/data_auth.sql     # รายการเดียว: พลาดแล้วไม่มีอะไรเปลี่ยน
echo "database restored"

# ---------- ไฟล์ ----------
if [ "${RESTORE_FILES:-true}" = true ]; then
  [ -n "${RESTORE_SECRET_KEY:-}" ] || { echo "ERROR: ยังไม่ได้ตั้งค่า RESTORE_SECRET_KEY" >&2; exit 1; }
  mapfile -t parts < <(python3 "$here/gdrive.py" fetch files)
  for p in "${parts[@]}"; do decrypt "$p"; echo "extracted $p"; done      # full ก่อน แล้ว inc ทับตามลำดับวัน
  SUPABASE_URL=$RESTORE_SUPABASE_URL SUPABASE_SECRET_KEY=$RESTORE_SECRET_KEY python3 "$here/storage.py" push files
fi
echo "restore finished — ให้ผู้ใช้ออกจากระบบแล้วเข้าใหม่ และตรวจหน้าเว็บ"
