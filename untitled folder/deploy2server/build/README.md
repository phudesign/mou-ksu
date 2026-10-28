# โค้ดสำหรับ build image

| โฟลเดอร์ | ได้ image |
|----------|-----------|
| `backend/` | API (Node.js) |
| `frontend/` | Nginx + ไฟล์ Flutter web ที่ **build แล้ว** (`html/`) |

`frontend/html/` = สำเนาของ `flutter_mou/build/web` (ต้อง build ด้วย `API_URL=same-origin`)

อัปเดตจาก repo หลัก:

```bash
../scripts/sync-from-repo.sh
```

สคริปต์จะรัน `flutter build web --release --dart-define=API_URL=same-origin` แล้วคัดลอกเข้า `frontend/html/`
