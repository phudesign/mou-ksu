#!/usr/bin/env bash
# Build แล้ว push ขึ้น Docker Hub ด้วยแท็กวันที่
#
#   phudesign/mou-backend:mou-YYYYMMDD-HHMM
#   phudesign/mou-web:mou-YYYYMMDD-HHMM
#
# ก่อนรันครั้งแรก:
#   docker login
#
# รัน:
#   ./scripts/build-dockerhub.sh
#
# ระบุแท็กเองได้:
#   ./scripts/build-dockerhub.sh mou-20261028-1400
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOCKERHUB_USER="${DOCKERHUB_USERNAME:-${DOCKERHUB_USER:-phudesign}}"
TAG="${1:-${IMAGE_TAG:-mou-$(date +%Y%m%d-%H%M)}}"
# โหนดคลัสเตอร์เป็น linux/amd64 — build บน Mac แบบ arm ต้องระบุ platform นี้
PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"
NAMESPACE="${K8S_NAMESPACE:-mou}"

BACKEND_IMAGE="${DOCKERHUB_USER}/mou-backend:${TAG}"
WEB_IMAGE="${DOCKERHUB_USER}/mou-web:${TAG}"
BACKEND_CONTEXT="${ROOT}/build/backend"
WEB_CONTEXT="${ROOT}/build/frontend"

if ! command -v docker >/dev/null 2>&1; then
  echo "ไม่พบคำสั่ง docker"
  exit 1
fi

if [[ ! -f "${BACKEND_CONTEXT}/Dockerfile" ]]; then
  echo "ไม่พบ ${BACKEND_CONTEXT}/Dockerfile"
  exit 1
fi
if [[ ! -f "${WEB_CONTEXT}/Dockerfile" ]]; then
  echo "ไม่พบ ${WEB_CONTEXT}/Dockerfile"
  exit 1
fi

echo "==> TAG=${TAG}"
echo "==> platform ${PLATFORM}"
echo "==> ${BACKEND_IMAGE}"
echo "==> ${WEB_IMAGE}"
echo "ต้อง docker login ด้วยบัญชี ${DOCKERHUB_USER} ไว้แล้ว และ repo ต้องเป็น public"
echo

echo "==> Build backend"
docker build --platform "${PLATFORM}" -t "${BACKEND_IMAGE}" "${BACKEND_CONTEXT}"

echo "==> Build web (Flutter release — ครั้งแรกใช้เวลานาน)"
docker build --platform "${PLATFORM}" \
  --build-arg API_URL=same-origin \
  -t "${WEB_IMAGE}" \
  "${WEB_CONTEXT}"

echo "==> Push"
docker push "${BACKEND_IMAGE}"
docker push "${WEB_IMAGE}"

echo
echo "==> Done"
echo "    ${BACKEND_IMAGE}"
echo "    ${WEB_IMAGE}"
echo
echo "วางบน terminal ของคลัสเตอร์ (Devtron):"
cat <<EOF

NS=${NAMESPACE}
kubectl set image deployment/backend backend=${BACKEND_IMAGE} -n "\${NS}"
kubectl set image deployment/web web=${WEB_IMAGE} -n "\${NS}"
kubectl rollout status deployment/backend -n "\${NS}"
kubectl rollout status deployment/web -n "\${NS}"
kubectl get pods -n "\${NS}"
EOF
