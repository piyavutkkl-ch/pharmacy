# ใช้แบบ source: ตั้ง PG_ADMIN_URL และฟังก์ชัน db_url <ชื่อฐานข้อมูล>
# ถ้าไม่ได้ตั้ง PG_ADMIN_URL จะเปิด Postgres ชั่วคราวที่ /var/tmp/pgtest พอร์ต 5433 (ต้องมี Postgres ติดตั้งในเครื่อง)
if [ -z "${PG_ADMIN_URL:-}" ]; then
  _PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)
  [ -n "$_PGBIN" ] || { echo "ERROR: ไม่พบ Postgres ในเครื่อง — ติดตั้ง postgresql หรือตั้ง PG_ADMIN_URL" >&2; exit 1; }
  _PGD=/var/tmp/pgtest
  as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
  if [ ! -d $_PGD/data ]; then mkdir -p $_PGD; [ "$(id -u)" = 0 ] && chown postgres $_PGD; as_pg "$_PGBIN/initdb -D $_PGD/data -E UTF8 --locale=C.UTF-8 -U postgres >/dev/null"; fi
  as_pg "$_PGBIN/pg_ctl -D $_PGD/data status" >/dev/null 2>&1 || { as_pg "$_PGBIN/pg_ctl -D $_PGD/data -o \"-k $_PGD -p 5433 -c listen_addresses=''\" -l $_PGD/pg.log start" >/dev/null; sleep 2; }
  PG_ADMIN_URL="postgresql:///postgres?host=$_PGD&port=5433&user=postgres"
fi
db_url() { local base=${PG_ADMIN_URL%%\?*} q=""; [[ "$PG_ADMIN_URL" == *\?* ]] && q="?${PG_ADMIN_URL#*\?}"; echo "${base%/*}/$1$q"; }
