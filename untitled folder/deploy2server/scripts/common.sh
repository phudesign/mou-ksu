#!/usr/bin/env bash
# ใช้ร่วมกันในสคริปต์ deploy2server
set -euo pipefail

DEPLOY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# แพ็กเกจนี้ build ได้เองจาก deploy2server/build/* ไม่ต้องพึ่งโฟลเดอร์นอกแพ็กเกจ
GENERATED="${DEPLOY_ROOT}/.generated"

load_config() {
  local cfg="${DEPLOY_ROOT}/config.env"
  if [[ ! -f "${cfg}" ]]; then
    echo "ไม่พบ ${cfg}"
    echo "รัน: cp deploy2server/config.env.example deploy2server/config.env แล้วแก้ค่า"
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "${cfg}"
  set +a

  : "${NAMESPACE:?ต้องตั้ง NAMESPACE ใน config.env}"
  : "${REGISTRY:?ต้องตั้ง REGISTRY ใน config.env}"
  : "${IMAGE_TAG:?ต้องตั้ง IMAGE_TAG ใน config.env}"
  : "${INGRESS_HOST:?ต้องตั้ง INGRESS_HOST ใน config.env}"
  : "${CORS_ORIGIN:?ต้องตั้ง CORS_ORIGIN ใน config.env}"
  : "${ENABLE_TLS:=false}"
  : "${STORAGE_CLASS:=}"
  : "${IMAGE_PULL_SECRET:=}"
  : "${MYSQL_STORAGE:=10Gi}"
  : "${UPLOADS_STORAGE:=5Gi}"
  # default = โฟลเดอร์ในแพ็กเกจ deploy2server เอง
  : "${BACKEND_CONTEXT:=${DEPLOY_ROOT}/build/backend}"
  : "${WEB_CONTEXT:=${DEPLOY_ROOT}/build/frontend}"

  # รองรับ path แบบ relative จาก DEPLOY_ROOT
  if [[ "${BACKEND_CONTEXT}" != /* ]]; then
    BACKEND_CONTEXT="${DEPLOY_ROOT}/${BACKEND_CONTEXT#./}"
  fi
  if [[ "${WEB_CONTEXT}" != /* ]]; then
    WEB_CONTEXT="${DEPLOY_ROOT}/${WEB_CONTEXT#./}"
  fi

  BACKEND_IMAGE="${REGISTRY}/backend:${IMAGE_TAG}"
  WEB_IMAGE="${REGISTRY}/web:${IMAGE_TAG}"
}

render_file() {
  local src="$1" dest="$2"
  local storage_line="" pull_block="" tls_block=""

  if [[ -n "${STORAGE_CLASS}" ]]; then
    storage_line="storageClassName: ${STORAGE_CLASS}"
  fi

  if [[ -n "${IMAGE_PULL_SECRET}" ]]; then
    pull_block="$(printf 'imagePullSecrets:\n        - name: %s' "${IMAGE_PULL_SECRET}")"
  fi

  # OpenShift Route — edge TLS (ใบรับรองมักอยู่ที่ Router ของคลัสเตอร์)
  if [[ "${ENABLE_TLS}" == "true" ]]; then
    tls_block="$(cat <<'EOF'
tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
EOF
)"
  fi

  # ใช้ python แทนที่ placeholder ให้ปลอดภัยกับอักขระพิเศษ
  NAMESPACE="${NAMESPACE}" \
  BACKEND_IMAGE="${BACKEND_IMAGE}" \
  WEB_IMAGE="${WEB_IMAGE}" \
  CORS_ORIGIN="${CORS_ORIGIN}" \
  INGRESS_HOST="${INGRESS_HOST}" \
  MYSQL_STORAGE="${MYSQL_STORAGE}" \
  UPLOADS_STORAGE="${UPLOADS_STORAGE}" \
  STORAGE_CLASS_LINE="${storage_line}" \
  IMAGE_PULL_SECRETS_BLOCK="${pull_block}" \
  TLS_BLOCK="${tls_block}" \
  python3 - "${src}" "${dest}" <<'PY'
import os, pathlib, sys
src, dest = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
text = src.read_text()
repl = {
    "__NAMESPACE__": os.environ["NAMESPACE"],
    "__BACKEND_IMAGE__": os.environ["BACKEND_IMAGE"],
    "__WEB_IMAGE__": os.environ["WEB_IMAGE"],
    "__CORS_ORIGIN__": os.environ["CORS_ORIGIN"],
    "__INGRESS_HOST__": os.environ["INGRESS_HOST"],
    "__MYSQL_STORAGE__": os.environ["MYSQL_STORAGE"],
    "__UPLOADS_STORAGE__": os.environ["UPLOADS_STORAGE"],
    "__STORAGE_CLASS_LINE__": os.environ.get("STORAGE_CLASS_LINE", ""),
    "__IMAGE_PULL_SECRETS_BLOCK__": os.environ.get("IMAGE_PULL_SECRETS_BLOCK", ""),
    "__TLS_BLOCK__": os.environ.get("TLS_BLOCK", ""),
}
for k, v in repl.items():
    text = text.replace(k, v)
# ลบบรรทัดที่เหลือแต่ช่องว่างหลังเอา placeholder ออก
lines = []
for line in text.splitlines(True):
    if line.strip() == "":
        # เก็บบรรทัดว่างตามปกติ
        lines.append(line)
        continue
    # ถ้าบรรทัดมีแต่ whitespace หลังแทนที่ (เช่น บรรทัดที่มีแค่ placeholder ว่าง)
    if line.strip() == "" or (line.endswith("\n") and line.strip() == ""):
        lines.append(line)
        continue
    lines.append(line)
# ลบบรรทัดที่เหลือเป็นช่องว่างล้วนจาก indent ของ block ที่ว่าง
cleaned = []
for line in lines:
    if line.strip() == "" and False:
        continue
    cleaned.append(line)
out = "".join(cleaned)
# ลบบรรทัดที่มีแต่ช่องว่าง (เกิดจาก placeholder ว่างบนบรรทัดนั้น)
out_lines = []
for line in out.splitlines(True):
    if line.strip() == "" and line.replace(" ", "").replace("\t", "") == "\n":
        out_lines.append("\n")
    elif line.strip() == "" and set(line) <= set(" \t\n") and line.count(" ") > 0 and line.strip() == "":
        # บรรทัด indent อย่างเดียวที่เคยเป็น block ว่าง — ตัดทิ้ง
        if line.endswith("\n") and line[:-1].strip() == "" and len(line) > 1:
            continue
        out_lines.append(line)
    else:
        out_lines.append(line)
# แบบง่ายกว่า: ตัดบรรทัดที่ trim แล้วว่างแต่เดิมมีแต่ space (ไม่มี content)
final = []
for line in out.splitlines(True):
    if line.endswith("\n"):
        body, nl = line[:-1], "\n"
    else:
        body, nl = line, ""
    if body.strip() == "" and body != "":
        continue  # ตัด indent-only
    final.append(body + nl)
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text("".join(final))
PY
}

render_all() {
  load_config
  rm -rf "${GENERATED}"
  mkdir -p "${GENERATED}/init"
  cp "${DEPLOY_ROOT}/k8s/init/"*.sql "${GENERATED}/init/"

  for f in mysql.yaml backend.yaml web.yaml route.yaml; do
    render_file "${DEPLOY_ROOT}/k8s/${f}" "${GENERATED}/${f}"
  done

  if [[ -f "${DEPLOY_ROOT}/k8s/secret.yaml" ]]; then
    render_file "${DEPLOY_ROOT}/k8s/secret.yaml" "${GENERATED}/secret.yaml"
  else
    echo "คำเตือน: ยังไม่มี k8s/secret.yaml — คัดลอกจาก secret.example.yaml ก่อน deploy"
  fi

  echo "เรนเดอร์ไฟล์แล้วที่ ${GENERATED}"
  echo "  BACKEND_IMAGE=${BACKEND_IMAGE}"
  echo "  WEB_IMAGE=${WEB_IMAGE}"
  echo "  NAMESPACE=${NAMESPACE}"
  echo "  INGRESS_HOST=${INGRESS_HOST}"
}
