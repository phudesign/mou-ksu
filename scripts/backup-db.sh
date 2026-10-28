#!/usr/bin/env bash
# สำรองฐานข้อมูลจากคลัสเตอร์ลงไฟล์ในเครื่อง
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

OUT_DIR="${DEPLOY_ROOT}/backups"
mkdir -p "${OUT_DIR}"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="${OUT_DIR}/mou_db_${STAMP}.sql"

DB_PASS="$(kubectl -n "${NAMESPACE}" get secret mou-secrets -o jsonpath='{.data.DB_PASS}' | base64 -d)"

echo "Dump mou_db → ${OUT}"
kubectl -n "${NAMESPACE}" exec deploy/mysql -- \
  mysqldump -uroot -p"${DB_PASS}" \
  --default-character-set=utf8mb4 \
  --single-transaction \
  --routines --triggers \
  mou_db > "${OUT}"

echo "สำเร็จ: ${OUT}"
