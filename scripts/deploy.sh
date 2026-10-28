#!/usr/bin/env bash
# Apply manifests ลง namespace ที่ admin สร้างไว้แล้ว (ไม่สร้าง namespace ใหม่)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

if ! command -v kubectl >/dev/null 2>&1; then
  echo "ไม่พบ kubectl"
  exit 1
fi

render_all

if [[ ! -f "${GENERATED}/secret.yaml" ]]; then
  echo "สร้าง deploy2server/k8s/secret.yaml จากตัวอย่างก่อน:"
  echo "  cp deploy2server/k8s/secret.example.yaml deploy2server/k8s/secret.yaml"
  exit 1
fi

if ! kubectl get namespace "${NAMESPACE}" >/dev/null 2>&1; then
  echo "ไม่พบ namespace '${NAMESPACE}'"
  echo "ให้ admin สร้าง namespace นี้ก่อน หรือแก้ NAMESPACE ใน config.env ให้ตรง"
  exit 1
fi

echo "==> Apply Secret"
kubectl apply -f "${GENERATED}/secret.yaml"

echo "==> ConfigMap mysql-init (schema/seed)"
kubectl -n "${NAMESPACE}" create configmap mysql-init \
  --from-file="${GENERATED}/init" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "==> Apply MySQL / backend / web / Route"
kubectl apply -f "${GENERATED}/mysql.yaml"
kubectl apply -f "${GENERATED}/backend.yaml"
kubectl apply -f "${GENERATED}/web.yaml"
kubectl apply -f "${GENERATED}/route.yaml"

echo "==> รอ rollout"
kubectl -n "${NAMESPACE}" rollout status deployment/mysql --timeout=300s
kubectl -n "${NAMESPACE}" rollout status deployment/backend --timeout=300s
kubectl -n "${NAMESPACE}" rollout status deployment/web --timeout=180s

echo
echo "สำเร็จ — ตรวจสถานะ:"
echo "  kubectl -n ${NAMESPACE} get pods,svc,route"
echo "  เปิด https://${INGRESS_HOST} (หรือ http ตามที่ตั้ง TLS)"
echo "  health: https://${INGRESS_HOST}/api/health"
