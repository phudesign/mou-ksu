# ฐานข้อมูลในแพ็กเกจ deploy2server

**คู่มือฉบับเต็ม:** ดู [`../คู่มือฐานข้อมูล.md`](../คู่มือฐานข้อมูล.md)

| ไฟล์/โฟลเดอร์ | ความหมาย |
|--------------|----------|
| `schema.sql` | โครงสร้างตาราง |
| `seed.sql` | ข้อมูลเริ่มต้นเล็กน้อย (users ตัวอย่าง) |
| `data/mou_db_full.sql` | **dump ข้อมูลเต็ม** จากเครื่องพัฒนา |
| `data/EXPORT_INFO.txt` | วันเวลาและจำนวนแถวตอน export |
| `uploads/` | ไฟล์ PDF / ลายเซ็น / signed ที่คู่กับ dump |

ไฟล์ init ตอนสร้าง MySQL ครั้งแรกอยู่ที่ `../k8s/init/` (schema+seed เท่านั้น)  
ข้อมูลเต็มต้อง import แยกด้วย `../scripts/import-data.sh` หลังระบบขึ้นแล้ว

---

## คำสั่งหลัก (ย่อ)

```bash
# เครื่องพัฒนา — รีเฟรช dump + uploads ในแพ็กเกจ
./deploy2server/scripts/export-data.sh

# เซิร์ฟเวอร์ — แทนที่ mou_db + uploads (ทับข้อมูลเดิม)
cd deploy2server && ./scripts/import-data.sh

# แค่โครงสร้างตาราง
./scripts/import-schema-only.sh

# สำรองจากเซิร์ฟเวอร์
./scripts/backup-db.sh
```
