# Frontend image: static Flutter web + Nginx (ไม่ build Flutter ใน Docker)
# ใส่ไฟล์จาก flutter_mou/build/web ไว้ที่ html/ ก่อน (ผ่าน sync-from-repo.sh)
#
# docker build -t mou-web:local ./deploy2server/build/frontend

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY html/ /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
