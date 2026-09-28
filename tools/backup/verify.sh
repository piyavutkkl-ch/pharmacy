#!/usr/bin/env bash
# ทดลองกู้ไฟล์สำรองลงฐานข้อมูลว่าง (Postgres ชั่วคราวใน GitHub Actions) แล้วเทียบจำนวนแถวทุกตาราง
# ใช้:  verify.sh <โฟลเดอร์ db ที่มี data_public.sql> <connection string ของฐานข้อมูลว่าง>
set -euo pipefail
dir=$1; url=$2
root=$(cd "$(dirname "$0")/../.." && pwd)
P=(psql "$url" -X -q -v ON_ERROR_STOP=1)
quiet() { local out; out=$("$@" 2>&1 >/dev/null) || { echo "$out" | grep -v -e NOTICE -e WARNING -e HINT >&2; return 1; }; }
quiet "${P[@]}" -f "$root/tests/stub_new_default.sql"
for f in "$root"/supabase/[0-9]*.sql; do
  case "$(basename "$f")" in 02_*) continue ;; esac          # 02 = ผู้ดูแลคนแรก (ข้อมูลจริงมาจากไฟล์สำรอง)
  quiet "${P[@]}" -f "$f" || { echo "ERROR: รัน $(basename "$f") ในฐานข้อมูลทดสอบไม่ผ่าน" >&2; exit 1; }
done
bash "$(dirname "$0")/load_public.sh" "$url" "$dir/data_public.sql"
python3 "$(dirname "$0")/counts.py" "$dir/data_public.sql" > "$dir/expected.txt"
"${P[@]}" -At -F $'\t' -c "select 'public.' || c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1" > "$dir/actual.txt"
bad=$(awk -F'\t' 'NR==FNR {e[$1]=$2; next} ($1 in e) {seen[$1]=1; if (e[$1] != $2) print $1": ไฟล์ "e[$1]" แถว / กู้ได้ "$2} END {for (t in e) if (!(t in seen)) print t": ไม่มีตารางนี้ในปลายทาง"}' "$dir/expected.txt" "$dir/actual.txt")
if [ -n "$bad" ]; then echo "ERROR: กู้ทดลองแล้วข้อมูลไม่ตรง:" >&2; echo "$bad" >&2; exit 1; fi
echo "verify: restore test OK — $(wc -l < "$dir/expected.txt") tables, $(awk -F'\t' '{s+=$2} END {print s}' "$dir/expected.txt") rows"
