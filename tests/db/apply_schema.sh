#!/usr/bin/env bash
# สร้างโครงสร้างเหมือนโปรเจกต์ Supabase จริง: stub + supabase/*.sql ตามลำดับ (ข้าม 02 = ผู้ดูแลคนแรกของจริง)
set -euo pipefail
url=$1; root=$(cd "$(dirname "$0")/../.." && pwd)
run() { local out; out=$(psql "$url" -X -q -v ON_ERROR_STOP=1 -f "$1" 2>&1 >/dev/null) || { echo "$out" | grep -v -e NOTICE -e WARNING -e HINT >&2; echo "FAIL: $(basename "$1")" >&2; exit 1; }; }
run "$root/tests/stub_new_default.sql"
for f in "$root"/supabase/[0-9]*.sql; do
  case "$(basename "$f")" in 02_*) continue ;; esac
  run "$f"
done
