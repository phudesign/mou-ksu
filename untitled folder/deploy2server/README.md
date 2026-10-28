# Deploy ไปเซิร์ฟเวอร์ Kubernetes จริง

โฟลเดอร์ **`deploy2server/`** เป็นแพ็กเกจครบในตัวสำหรับขึ้นเซิร์ฟเวอร์  
เมื่อ **admin สร้าง namespace ให้แล้ว** — คัดลอกทั้งโฟลเดอร์นี้ไปใช้ได้เลย

**คู่มือละเอียด (เริ่มใช้งาน + อัปเดตโค้ด + ฐานข้อมูล):**  
→ [`คู่มือการใช้งาน.md`](./คู่มือการใช้งาน.md)

ทดลองในเครื่อง (Docker Desktop) ยังใช้ `k8s/` + `npm run k8s:up` ของ repo เดิม

---

## โครงสร้างแพ็กเกจ

```text
deploy2server/
├── คู่มือการใช้งาน.md      ← คู่มือละเอียด (เริ่มใช้ + อัปเดตโค้ด)
├── README.md / FILES.txt
├── config.env.example      → คัดลอกเป็น config.env
├── build/backend + build/frontend
├── database/               → schema, dump, uploads
├── k8s/                    → manifests production
└── scripts/                → sync / build-push / deploy / import-data …
```

---

## สิ่งที่ต้องขอจาก Admin

1. ชื่อ **namespace**
2. สิทธิ์ `kubectl` ใน namespace นั้น
3. **Container Registry** + `docker login`
4. **imagePullSecret** (ถ้ารegistry ปิด)
5. **โดเมน** สำหรับ OpenShift Route
6. StorageClass (ถ้ามี)
7. TLS บน Router (ถ้ามี)

```bash
kubectl get ns
kubectl -n <namespace> get all
```

---

คู่มือเฉพาะฐานข้อมูล: [`คู่มือฐานข้อมูล.md`](./คู่มือฐานข้อมูล.md)

## Step by step

### A) บนเครื่องพัฒนา — ก่อนเอาไปเซิร์ฟเวอร์

```bash
./deploy2server/scripts/sync-from-repo.sh   # backend + Flutter web→html/ + schema
./deploy2server/scripts/export-data.sh      # dump DB เต็ม + uploads เข้า database/
```

จากนั้นคัดลอก**ทั้งโฟลเดอร์** `deploy2server/` ไปเครื่องที่ต่อคลัสเตอร์/registry ได้

### B) ครั้งแรกบนเครื่องที่จะ deploy

```bash
cd deploy2server
cp config.env.example config.env
cp k8s/secret.example.yaml k8s/secret.yaml
```

แก้ `config.env`:

- `NAMESPACE`, `REGISTRY`, `IMAGE_TAG`
- `INGRESS_HOST`, `CORS_ORIGIN`, `ENABLE_TLS`
- `STORAGE_CLASS`, `IMAGE_PULL_SECRET` ตาม admin

แก้ `k8s/secret.yaml`:

- `DB_PASS`, `JWT_SECRET` (≥ 32), `LDAP_AUTH_API_TOKEN`  
- ปล่อย `namespace: __NAMESPACE__` ไว้ สคริปต์แทนที่ให้

### C) Build + Push image

```bash
docker login <registry>
./scripts/build-push.sh
```

ใช้โค้ดใน:

- `build/backend` → image `.../backend:<tag>`
- `build/frontend` → image `.../web:<tag>` (Nginx + ไฟล์ static ใน `html/`)

### D) Deploy ลง namespace

```bash
./scripts/deploy.sh
./scripts/status.sh
```

สคริปต์**ไม่สร้าง namespace ใหม่** — ต้องมีอยู่แล้ว

### E) นำข้อมูลเต็ม + ไฟล์ uploads เข้าเซิร์ฟเวอร์

หลัง MySQL พร้อม (deploy สำเร็จ):

```bash
./scripts/import-data.sh
# พิมพ์ yes เพื่อยืนยัน — จะทับข้อมูลใน mou_db และคัดลอก uploads
```

รายละเอียดเพิ่ม: `database/README.md`

ทางเลือกอื่น:

| เป้าหมาย | คำสั่ง |
|----------|--------|
| แทนที่ข้อมูลทั้งก้อน | `./scripts/import-data.sh` |
| แค่ schema (ไม่ทับ dump) | `./scripts/import-schema-only.sh` |
| สำรองจากเซิร์ฟเวอร์ | `./scripts/backup-db.sh` |

### F) ตรวจ

```bash
curl -i https://<INGRESS_HOST>/
curl -i https://<INGRESS_HOST>/api/health
```

---

## อัปเดตโค้ดทีหลัง

1. แก้ใน repo หลัก  
2. `./deploy2server/scripts/sync-from-repo.sh`  
3. เปลี่ยน `IMAGE_TAG` ใน `config.env`  
4. `./scripts/build-push.sh` แล้ว `./scripts/deploy.sh`

ถ้าแก้ไฟล์ใน `deploy2server/build/` โดยตรงบนเครื่อง deploy ก็ build-push ได้เลยโดยไม่ต้อง sync

---

## คำสั่งจาก root repo (ทางลัด npm)

```bash
npm run deploy:sync        # sync-from-repo
npm run deploy:build-push
npm run deploy:apply
npm run deploy:status
npm run deploy:backup-db
```

---

## สถาปัตยกรรม

```text
ผู้ใช้ → Route (โดเมน)
         → web (Nginx): / + /api + /socket.io
         → backend → mysql (PVC)
```

หลายโปรเจกต์บนคลัสเตอร์เดียว: คนละ namespace + คนละโดเมน

---

## สำรอง DB

```bash
./scripts/backup-db.sh
# ไฟล์อยู่ที่ deploy2server/backups/
```

---

## อย่า commit / อย่าแชร์

- `config.env`
- `k8s/secret.yaml`
- `.generated/`
- `backups/`
