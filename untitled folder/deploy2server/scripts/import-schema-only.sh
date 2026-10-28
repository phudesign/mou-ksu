#!/usr/bin/env bash
# รันเฉพาะ schema.sql / seed.sql (ไม่ทับด้วย dump เต็ม)
# ใช้เมื่อ DB ว่างหรือต้องการ apply โครงสร้างใหม่แบบระวัง
# หมายเหตุ: schema.sql ใช้ CREATE TABLE IF NOT EXISTS — ไม่ลบข้อมูลเก่า
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

DB_DIR="${DEPLOY_ROOT}/database"
SCHEMA="${DB_DIR}/schema.sql"
SEED="${DB_DIR}/seed.sql"

[[ -f "${SCHEMA}" ]] || { echo "ไม่พบ ${SCHEMA}"; exit 1; }

DB_PASS="$(kubectl -n "${NAMESPACE}" get secret mou-secrets -o jsonpath='{.data.DB_PASS}' | base64 -d)"

echo "Apply schema.sql ..."
kubectl -n "${NAMESPACE}" exec -i deploy/mysql -- \
  mysql -uroot -p"${DB_PASS}" --default-character-set=utf8mb4 mou_db < "${SCHEMA}"

if [[ "${1:-}" == "--with-seed" && -f "${SEED}" ]]; then
  echo "Apply seed.sql ..."
  kubectl -n "${NAMESPACE}" exec -i deploy/mysql -- \
    mysql -uroot -p"${DB_PASS}" --default-character-set=utf8mb4 mou_db < "${SEED}"
fi

echo "สำเร็จ"
