#!/usr/bin/env bash
# Build + push image backend และ Flutter web ไปยัง registry
# ใช้โค้ดใน deploy2server/build/* (แพ็กเกจครบในตัว)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

if [[ ! -f "${BACKEND_CONTEXT}/Dockerfile" ]]; then
  echo "ไม่พบ ${BACKEND_CONTEXT}/Dockerfile"
  echo "รัน sync ก่อน (ถ้ายังอยู่ใน repo): ./deploy2server/scripts/sync-from-repo.sh"
  exit 1
fi
if [[ ! -f "${WEB_CONTEXT}/Dockerfile" ]]; then
  echo "ไม่พบ ${WEB_CONTEXT}/Dockerfile"
  exit 1
fi

echo "==> Build context backend: ${BACKEND_CONTEXT}"
echo "==> Build ${BACKEND_IMAGE}"
docker build -t "${BACKEND_IMAGE}" "${BACKEND_CONTEXT}"

if [[ ! -f "${WEB_CONTEXT}/html/index.html" ]]; then
  echo "ไม่พบ ${WEB_CONTEXT}/html/index.html"
  echo "รัน sync ก่อน (จะ build Flutter แล้วคัดลอกเข้า html/): ./deploy2server/scripts/sync-from-repo.sh"
  exit 1
fi

echo "==> Build context frontend: ${WEB_CONTEXT} (static html/ + Nginx)"
echo "==> Build ${WEB_IMAGE}"
docker build -t "${WEB_IMAGE}" "${WEB_CONTEXT}"

echo "==> Push"
docker push "${BACKEND_IMAGE}"
docker push "${WEB_IMAGE}"

echo
echo "สำเร็จ"
echo "  ${BACKEND_IMAGE}"
echo "  ${WEB_IMAGE}"
echo "ขั้นถัดไป: ./scripts/deploy.sh (จากโฟลเดอร์ deploy2server) หรือ npm run deploy:apply"
