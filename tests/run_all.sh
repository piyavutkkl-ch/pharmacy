#!/usr/bin/env bash
# ทดสอบทั้งหมดก่อนขึ้นเว็บ — Claude รันก่อน push ทุกครั้ง และ GitHub Actions รันซ้ำก่อน deploy
#   1) static  : ไวยากรณ์ / HTML / id ซ้ำ / ค่าลับหลุด
#   2) db      : สร้างฐานข้อมูลจาก supabase/*.sql แล้วทดสอบสิทธิ์ (RLS) ~130 ข้อ
#   3) ui      : เปิดทุกหน้าทุกบทบาทด้วย Chromium + Supabase จำลอง, ทดสอบงานหลัก, จอมือถือ/แท็บเล็ต
#   4) backup  : สำรอง → ทดลองกู้ → กู้จริง ครบวงจร (ข้ามได้ด้วย SKIP_BACKUP_TEST=1)
#   + ai-news : ช่อง AI สร้างข่าว (tools/ai_news) แบบไม่ใช้เน็ต/คีย์จริง
# ตั้ง PG_ADMIN_URL เพื่อใช้ Postgres ที่มีอยู่ (ไม่ตั้ง = เปิด Postgres ชั่วคราวในเครื่องให้เอง)
# ในเครื่องที่ไม่มี Postgres/Playwright จะข้ามขั้นนั้นพร้อมเตือน (บน GitHub Actions ห้ามข้าม — ต้องผ่านทุกขั้น)
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
step() { printf '\n==== %s ====\n' "$1"; }
skip() { if [ -n "${CI:-}" ]; then echo "ERROR: $1" >&2; exit 1; fi; echo "⚠️  ข้าม: $1 — GitHub Actions จะทดสอบขั้นนี้ให้ก่อนขึ้นเว็บ"; skipped=1; }
skipped=0
have_pg() { [ -n "${PG_ADMIN_URL:-}" ] || ls -d /usr/lib/postgresql/*/bin >/dev/null 2>&1; }
[ -d tests/ui/node_modules/playwright ] || export NODE_PATH=${NODE_PATH:-$(npm root -g 2>/dev/null || true)}
have_pw() { (cd tests/ui && node -e "require('playwright')") >/dev/null 2>&1; }

step "1/4 static"; python3 tests/static_checks.py
if have_pg; then
  step "2/4 db"; bash tests/db/run.sh
  step "3/4 ui"; bash tests/ui/make_fixtures.sh
else
  skip "ไม่มี Postgres ในเครื่อง (ขั้น db + สร้าง fixtures)"
  step "3/4 ui"
fi
if have_pw; then node tests/ui/smoke.js | grep -v '^PASS'; else skip "ไม่มี Playwright ในเครื่อง (ขั้น ui)"; fi
if have_pw; then step "ai-news (offline)"; bash tests/ai_news/run.sh | grep -v '^PASS'; test "${PIPESTATUS[0]}" = 0; fi
if [ -z "${SKIP_BACKUP_TEST:-}" ] && have_pg; then
  step "4/4 backup"; bash tests/backup/run.sh 2>&1 | grep -E '^(PASS|FAIL|ERROR)'; test "${PIPESTATUS[0]}" = 0
fi
if [ "$skipped" = 1 ]; then printf '\nPASSED (บางขั้นข้ามในเครื่องนี้)\n'; else printf '\nALL TESTS PASSED\n'; fi
