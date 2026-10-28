#!/usr/bin/env bash
# คัดลอกโค้ดล่าสุดจาก repo เข้า deploy2server/build
# - backend: ซอร์ส Node
# - frontend: ไฟล์ Flutter web ที่ build แล้ว (flutter_mou/build/web → html/)
# รันจากเครื่องที่มี repo เต็ม ก่อนเอาโฟลเดอร์ deploy2server ไปเซิร์ฟเวอร์
set -euo pipefail

DEPLOY_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "${DEPLOY_ROOT}/.." && pwd)"
DEST="${DEPLOY_ROOT}/build"
FLUTTER_DIR="${REPO_ROOT}/flutter_mou"
WEB_OUT="${FLUTTER_DIR}/build/web"

if [[ ! -d "${REPO_ROOT}/backend" || ! -d "${FLUTTER_DIR}" ]]; then
  echo "ไม่พบ backend/ หรือ flutter_mou/ ใน parent ของ deploy2server"
  echo "สคริปต์นี้ใช้เมื่อ deploy2server ยังอยู่ภายใน repo โปรเจกต์"
  exit 1
fi

echo "Sync backend → build/backend"
rm -rf "${DEST}/backend"
mkdir -p "${DEST}/backend"
rsync -a \
  --exclude node_modules \
  --exclude uploads \
  --exclude '.env' \
  --exclude '.DS_Store' \
  "${REPO_ROOT}/backend/Dockerfile" \
  "${REPO_ROOT}/backend/.dockerignore" \
  "${REPO_ROOT}/backend/package.json" \
  "${REPO_ROOT}/backend/package-lock.json" \
  "${DEST}/backend/"
rsync -a "${REPO_ROOT}/backend/src/" "${DEST}/backend/src/"
rsync -a "${REPO_ROOT}/backend/scripts/" "${DEST}/backend/scripts/"

echo "Build Flutter web (release, API_URL=same-origin)"
if ! command -v flutter >/dev/null 2>&1; then
  echo "ไม่พบคำสั่ง flutter — ต้องมี Flutter SDK บนเครื่องนี้"
  echo "หรือ build เองก่อน: cd flutter_mou && flutter build web --release --dart-define=API_URL=same-origin"
  exit 1
fi
(
  cd "${FLUTTER_DIR}"
  flutter build web --release --dart-define=API_URL=same-origin
)

if [[ ! -f "${WEB_OUT}/index.html" ]]; then
  echo "ไม่พบ ${WEB_OUT}/index.html หลัง build"
  exit 1
fi

echo "Sync frontend → build/frontend/html (ไฟล์ static ที่ build แล้ว)"
mkdir -p "${DEST}/frontend"
# คง Dockerfile / nginx.conf / .dockerignore ใน frontend ไว้ (ไม่ลบทั้งโฟลเดอร์)
rm -rf "${DEST}/frontend/html"
# ลบซากซอร์สเก่าถ้ายังมีจากแพ็กเกจรุ่นก่อน
rm -rf "${DEST}/frontend/lib" "${DEST}/frontend/web" \
  "${DEST}/frontend/pubspec.yaml" "${DEST}/frontend/pubspec.lock" \
  "${DEST}/frontend/analysis_options.yaml"
mkdir -p "${DEST}/frontend/html"
rsync -a \
  --exclude '.DS_Store' \
  --exclude '.last_build_id' \
  "${WEB_OUT}/" "${DEST}/frontend/html/"

# ยืนยันว่ามี Dockerfile + nginx สำหรับ image แบบ static
if [[ ! -f "${DEST}/frontend/Dockerfile" ]]; then
  cat > "${DEST}/frontend/Dockerfile" <<'EOF'
# Frontend image: static Flutter web + Nginx (ไม่ build Flutter ใน Docker)
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY html/ /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
EOF
fi

if [[ ! -f "${DEST}/frontend/nginx.conf" ]]; then
  cp "${FLUTTER_DIR}/nginx.conf" "${DEST}/frontend/nginx.conf"
fi

if [[ ! -f "${DEST}/frontend/.dockerignore" ]]; then
  printf '%s\n' '.DS_Store' '**/.DS_Store' '**/*.md' > "${DEST}/frontend/.dockerignore"
fi

# sync SQL schema/seed + init
mkdir -p "${DEPLOY_ROOT}/k8s/init" "${DEPLOY_ROOT}/database"
cp "${REPO_ROOT}/database/schema.sql" "${DEPLOY_ROOT}/k8s/init/01-schema.sql"
cp "${REPO_ROOT}/database/seed.sql" "${DEPLOY_ROOT}/k8s/init/02-seed.sql"
cp "${REPO_ROOT}/database/schema.sql" "${DEPLOY_ROOT}/database/schema.sql"
cp "${REPO_ROOT}/database/seed.sql" "${DEPLOY_ROOT}/database/seed.sql"

echo "สำเร็จ"
du -sh "${DEST}/backend" "${DEST}/frontend" "${DEST}/frontend/html"
echo
echo "ขั้นถัดไป:"
echo "  1) อัปเดตข้อมูลเต็ม + uploads:  ./deploy2server/scripts/export-data.sh"
echo "  2) build/push:                 ./deploy2server/scripts/build-push.sh"
