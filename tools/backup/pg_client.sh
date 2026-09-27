# ใช้แบบ source: เลือก pg_dump/psql รุ่นเดียวกับฐานข้อมูล Supabase (ติดตั้งจาก apt.postgresql.org ถ้ายังไม่มี)
# ต้องมี DB_URL ก่อน source
command -v psql >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client >/dev/null; }
major=$(psql "$DB_URL" -X -Atc "select current_setting('server_version_num')::int / 10000") \
  || { echo "ERROR: เชื่อมต่อฐานข้อมูลไม่ได้ — ตรวจ connection string (ต้องใช้แบบ Session pooler) และรหัสผ่าน" >&2; exit 1; }
if [ ! -x "/usr/lib/postgresql/$major/bin/pg_dump" ]; then
  echo "installing postgresql-client-$major …"
  sudo apt-get install -y -qq postgresql-common >/dev/null
  sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >/dev/null 2>&1
  sudo apt-get install -y -qq "postgresql-client-$major" >/dev/null
fi
export PATH="/usr/lib/postgresql/$major/bin:$PATH"
echo "database: PostgreSQL $major · client $(pg_dump --version | awk '{print $3}')"
