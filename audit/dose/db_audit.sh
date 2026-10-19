#!/usr/bin/env bash
# Audit (Phase 1): สร้างฐาน audit_dose ในเครื่องจาก supabase/*.sql แล้วรัน db_audit.py (ไม่แตะ Supabase จริง)
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
source "$root/tests/db/pg_local.sh"
psql "$PG_ADMIN_URL" -X -q -c "drop database if exists audit_dose with (force)" -c "create database audit_dose" 2>/dev/null
export TEST_DB_URL=$(db_url audit_dose)
bash "$root/tests/db/apply_schema.sh" "$TEST_DB_URL"
python3 "$root/audit/dose/db_audit.py" "$@"
