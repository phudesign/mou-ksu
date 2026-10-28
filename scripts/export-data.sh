#!/usr/bin/env bash
# ส่งออกข้อมูลล่าสุดเข้า deploy2server/database/
# แหล่งข้อมูล (เลือกอัตโนมัติ): Kubernetes local (namespace mou) หรือ Docker Compose
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${DEPLOY_ROOT}/.." && pwd)"
DB_DIR="${DEPLOY_ROOT}/database"
DATA_DIR="${DB_DIR}/data"
UPLOADS_DIR="${DB_DIR}/uploads"
DB_PASS="${DB_PASS:-mou_dev_password}"

mkdir -p "${DATA_DIR}" "${UPLOADS_DIR}"

# sync schema/seed จาก repo ถ้ามี
if [[ -f "${REPO_ROOT}/database/schema.sql" ]]; then
  cp "${REPO_ROOT}/database/schema.sql" "${DB_DIR}/schema.sql"
  cp "${REPO_ROOT}/database/seed.sql" "${DB_DIR}/seed.sql"
  mkdir -p "${DEPLOY_ROOT}/k8s/init"
  cp "${REPO_ROOT}/database/schema.sql" "${DEPLOY_ROOT}/k8s/init/01-schema.sql"
  cp "${REPO_ROOT}/database/seed.sql" "${DEPLOY_ROOT}/k8s/init/02-seed.sql"
fi

dump_from_k8s() {
  kubectl -n mou exec deploy/mysql -- \
    mysqldump -uroot -p"${DB_PASS}" \
    --default-character-set=utf8mb4 \
    --single-transaction --routines --triggers --add-drop-table \
    mou_db > "${DATA_DIR}/mou_db_full.sql"
  kubectl -n mou exec deploy/mysql -- \
    mysql -uroot -p"${DB_PASS}" -N -e \
    "SELECT CONCAT('users=',COUNT(*)) FROM mou_db.users; SELECT CONCAT('mou_documents=',COUNT(*)) FROM mou_db.mou_documents; SELECT CONCAT('mou_signature_boxes=',COUNT(*)) FROM mou_db.mou_signature_boxes;" \
    2>/dev/null | grep -v Warning > "${DATA_DIR}/EXPORT_INFO.txt" || true
  POD="$(kubectl -n mou get pod -l app=backend -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -n "${POD}" ]]; then
    rm -rf "${UPLOADS_DIR:?}/pdfs" "${UPLOADS_DIR}/signatures" "${UPLOADS_DIR}/signed"
    mkdir -p "${UPLOADS_DIR}"
    kubectl -n mou cp "${POD}:/app/uploads/pdfs" "${UPLOADS_DIR}/pdfs" -c backend 2>/dev/null || true
    kubectl -n mou cp "${POD}:/app/uploads/signatures" "${UPLOADS_DIR}/signatures" -c backend 2>/dev/null || true
    kubectl -n mou cp "${POD}:/app/uploads/signed" "${UPLOADS_DIR}/signed" -c backend 2>/dev/null || true
  fi
  echo "source=kubernetes-local (namespace mou)" >> "${DATA_DIR}/EXPORT_INFO.txt"
}

dump_from_docker() {
  cd "${REPO_ROOT}"
  DB_PASS="${DB_PASS}" docker compose up -d --wait db
  DB_PASS="${DB_PASS}" docker compose exec -T db mysqldump -uroot -p"${DB_PASS}" \
    --default-character-set=utf8mb4 \
    --single-transaction --routines --triggers --add-drop-table \
    mou_db > "${DATA_DIR}/mou_db_full.sql"
  {
    echo "source=docker-compose"
    DB_PASS="${DB_PASS}" docker compose exec -T db mysql -uroot -p"${DB_PASS}" -N -e \
      "SELECT CONCAT('users=',COUNT(*)) FROM mou_db.users; SELECT CONCAT('mou_documents=',COUNT(*)) FROM mou_db.mou_documents; SELECT CONCAT('mou_signature_boxes=',COUNT(*)) FROM mou_db.mou_signature_boxes;" \
      2>/dev/null | grep -v Warning
  } > "${DATA_DIR}/EXPORT_INFO.txt"
  if [[ -d "${REPO_ROOT}/backend/uploads" ]]; then
    rsync -a --delete "${REPO_ROOT}/backend/uploads/pdfs/" "${UPLOADS_DIR}/pdfs/" 2>/dev/null || mkdir -p "${UPLOADS_DIR}/pdfs"
    rsync -a --delete "${REPO_ROOT}/backend/uploads/signatures/" "${UPLOADS_DIR}/signatures/"
    rsync -a --delete "${REPO_ROOT}/backend/uploads/signed/" "${UPLOADS_DIR}/signed/"
  fi
}

echo "exported_at=$(date -Iseconds)" > "${DATA_DIR}/EXPORT_INFO.txt.tmp"

if kubectl -n mou get deploy/mysql >/dev/null 2>&1 \
  && kubectl -n mou get pods -l app=mysql --field-selector=status.phase=Running 2>/dev/null | grep -q mysql; then
  echo "Export จาก Kubernetes (mou)..."
  dump_from_k8s
else
  echo "Export จาก Docker Compose..."
  dump_from_docker
fi

cat "${DATA_DIR}/EXPORT_INFO.txt.tmp" "${DATA_DIR}/EXPORT_INFO.txt" > "${DATA_DIR}/EXPORT_INFO.txt.new" 2>/dev/null || true
# รวม timestamp ไว้บนสุด
{
  echo "exported_at=$(date -Iseconds)"
  grep -v '^exported_at=' "${DATA_DIR}/EXPORT_INFO.txt" || true
} > "${DATA_DIR}/EXPORT_INFO.txt.new"
mv "${DATA_DIR}/EXPORT_INFO.txt.new" "${DATA_DIR}/EXPORT_INFO.txt"
rm -f "${DATA_DIR}/EXPORT_INFO.txt.tmp"

echo
echo "สำเร็จ"
echo "  SQL:     ${DATA_DIR}/mou_db_full.sql ($(wc -c < "${DATA_DIR}/mou_db_full.sql" | tr -d ' ') bytes)"
echo "  Uploads: ${UPLOADS_DIR}"
cat "${DATA_DIR}/EXPORT_INFO.txt"
echo
echo "นำโฟลเดอร์ deploy2server ไปเซิร์ฟเวอร์ แล้วรัน ./scripts/import-data.sh"
