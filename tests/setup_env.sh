#!/usr/bin/env bash
# เตรียมเครื่องมือทดสอบในเครื่องที่ Claude ใช้ทำงาน (เรียกอัตโนมัติตอนเริ่ม session จาก .claude/settings.json)
# ติดตั้งเฉพาะที่ยังไม่มี · ติดตั้งไม่ได้ก็ไม่เป็นไร (tests/run_all.sh จะข้ามขั้นนั้น และ GitHub Actions ทดสอบให้แทน)
root=$(cd "$(dirname "$0")/.." && pwd)
SUDO=$([ "$(id -u)" = 0 ] || echo sudo)
if ! ls -d /usr/lib/postgresql/*/bin >/dev/null 2>&1; then
  timeout 240 bash -c "$SUDO apt-get update -qq && $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql >/dev/null" 2>/dev/null \
    && echo "setup: ติดตั้ง Postgres แล้ว" || echo "setup: ติดตั้ง Postgres ไม่ได้ (ข้ามได้)"
fi
if ! (cd "$root/tests/ui" && node -e "require('playwright')" >/dev/null 2>&1) && ! NODE_PATH=$(npm root -g 2>/dev/null) node -e "require('playwright')" >/dev/null 2>&1; then
  timeout 300 bash -c "cd '$root/tests/ui' && npm install --no-audit --no-fund --loglevel=error >/dev/null && npx playwright install chromium >/dev/null" 2>/dev/null \
    && echo "setup: ติดตั้ง Playwright แล้ว" || echo "setup: ติดตั้ง Playwright ไม่ได้ (ข้ามได้)"
fi
exit 0
