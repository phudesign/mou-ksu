#!/usr/bin/env bash
# นำข้อมูลจาก deploy2server/database เข้าคลัสเตอร์ (แทนที่ข้อมูลใน mou_db)
# ใช้หลัง deploy แล้ว และมี MySQL + backend พร้อมใน namespace
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

DB_DIR="${DEPLOY_ROOT}/database"
SQL_FILE="${DB_DIR}/data/mou_db_full.sql"
UPLOADS_DIR="${DB_DIR}/uploads"

if [[ ! -f "${SQL_FILE}" ]]; then
  echo "ไม่พบ ${SQL_FILE}"
  echo "รัน ./scripts/export-data.sh บนเครื่องพัฒนาก่อน"
  exit 1
fi

if ! kubectl get namespace "${NAMESPACE}" >/dev/null 2>&1; then
  echo "ไม่พบ namespace ${NAMESPACE}"
  exit 1
fi

echo "คำเตือน: จะแทนที่ข้อมูลทั้งหมดในฐาน mou_db บน namespace ${NAMESPACE}"
read -r -p "พิมพ์ yes เพื่อยืนยัน: " ans
if [[ "${ans}" != "yes" ]]; then
  echo "ยกเลิก"
  exit 1
fi

echo "==> รอ MySQL Ready"
kubectl -n "${NAMESPACE}" rollout status deployment/mysql --timeout=180s

DB_PASS="$(kubectl -n "${NAMESPACE}" get secret mou-secrets -o jsonpath='{.data.DB_PASS}' | base64 -d)"

echo "==> Import SQL ($(wc -c < "${SQL_FILE}" | tr -d ' ') bytes)"
kubectl -n "${NAMESPACE}" exec -i deploy/mysql -- \
  mysql -uroot -p"${DB_PASS}" --default-character-set=utf8mb4 mou_db < "${SQL_FILE}"

echo "==> ตรวจจำนวนแถว"
kubectl -n "${NAMESPACE}" exec deploy/mysql -- \
  mysql -uroot -p"${DB_PASS}" -N -e \
  "SELECT 'users',COUNT(*) FROM mou_db.users UNION ALL SELECT 'mous',COUNT(*) FROM mou_db.mou_documents UNION ALL SELECT 'boxes',COUNT(*) FROM mou_db.mou_signature_boxes;"

if [[ -d "${UPLOADS_DIR}/pdfs" || -d "${UPLOADS_DIR}/signatures" || -d "${UPLOADS_DIR}/signed" ]]; then
  POD="$(kubectl -n "${NAMESPACE}" get pod -l app=backend -o jsonpath='{.items[0].metadata.name}')"
  echo "==> คัดลอก uploads → pod ${POD}"
  kubectl -n "${NAMESPACE}" exec "${POD}" -c backend -- sh -c \
    'rm -rf /app/uploads/pdfs /app/uploads/signatures /app/uploads/signed; mkdir -p /app/uploads'
  [[ -d "${UPLOADS_DIR}/pdfs" ]] && kubectl -n "${NAMESPACE}" cp "${UPLOADS_DIR}/pdfs" "${POD}:/app/uploads/pdfs" -c backend
  [[ -d "${UPLOADS_DIR}/signatures" ]] && kubectl -n "${NAMESPACE}" cp "${UPLOADS_DIR}/signatures" "${POD}:/app/uploads/signatures" -c backend
  [[ -d "${UPLOADS_DIR}/signed" ]] && kubectl -n "${NAMESPACE}" cp "${UPLOADS_DIR}/signed" "${POD}:/app/uploads/signed" -c backend
  echo "uploads บน pod:"
  kubectl -n "${NAMESPACE}" exec "${POD}" -c backend -- du -sh /app/uploads 2>/dev/null || true
else
  echo "ไม่มีโฟลเดอร์ uploads ในแพ็กเกจ — ข้าม"
fi

echo
echo "สำเร็จ — รีเฟรชเว็บแล้วลองใช้งาน"
echo "ถ้าต้องการแค่อัปเดต schema โดยไม่ทับข้อมูล ดู README ส่วน migrate"
