# VTA Namelist (Next.js + Supabase + Vercel)

## ติดตั้ง
1. สร้างโปรเจกต์ Supabase (เลือก region Singapore) แล้วเปิด SQL Editor
2. รัน `select vault.create_secret('<สุ่มยาว 32+ ตัวอักษร>','pii_key');` (เก็บ key สำรองไว้ที่ปลอดภัย ถ้าหายจะถอดรหัสไม่ได้)
3. รัน `001_schema.sql`, `002_admin.sql`, `003_import.sql`, `004_bulk_move.sql`, `005_files.sql` (ตามลำดับ; 005 สร้าง bucket `namelist-files` แบบ private ให้อัตโนมัติ)
4. Authentication > Providers: ปิด "Allow new users to sign up" แล้วสร้างผู้ใช้เองที่ Authentication > Users
5. ตั้ง Admin คนแรก: `update profiles set role='admin' where id='<uuid>';`
6. ใส่ `SUPABASE_SERVICE_ROLE_KEY` ใน Vercel (Production เท่านั้น ไม่ใส่ prefix NEXT_PUBLIC) สำหรับการเชิญผู้ใช้ และตั้งค่า SMTP ที่ Supabase > Auth > SMTP เพื่อส่งอีเมลเชิญ
7. Push โค้ดขึ้น GitHub > Import เข้า Vercel > ใส่ env ตาม `.env.example` (Vercel region: Singapore)
8. เปิด MFA สำหรับ Admin ทุกคน และเปิด Daily Backup (Supabase Pro)

## กำหนดสิทธิ์ผ่านหน้า /admin (Admin คนแรกต้องตั้งด้วย SQL ข้างบน)
ตัวอย่าง SQL เทียบเท่า:
```sql
update profiles set role='branch_officer' where id='<uuid>';
insert into user_branches values ('<uuid>','<branch_id>', true, false); -- แก้ได้ ดูข้อมูลเต็มไม่ได้
```
## หลักการป้องกันข้อมูล
- RLS บังคับทุกตาราง: เห็น/แก้เฉพาะสาขาที่ได้รับมอบหมาย, ไม่มีสิทธิ์ลบ (ใช้สถานะ "พ้นสภาพ")
- เลขบัตรและเลขบัญชีเข้ารหัส (pgcrypto) เก็บแยกตาราง ไม่มี policy อ่านตรง ต้องผ่าน RPC ที่เช็กสิทธิ์รายสาขาและบันทึก `audit_log`
- ตรวจ checksum เลขบัตรประชาชนไทยก่อนบันทึก

## นำเข้า Excel
Admin > เมนู "นำเข้าจาก Excel": เลือกไฟล์ > เลือกชีต+สาขาปลายทาง > ตรวจสอบ > นำเข้า (รันซ้ำได้ ข้ามรหัสที่มีแล้ว)

## ไฟล์แนบ
- พนักงาน: PDF เท่านั้น ประเภท ประวัติพนักงาน/สัญญาจ้าง/เอกสารส่วนตัว/อื่นๆ (ทำเครื่องหมาย "อ่อนไหว" ได้ เห็นเฉพาะผู้มีสิทธิ์ดูเลขเต็ม)
- บริษัท (เมนู "บริษัท"): สัญญาการบริการ/ระเบียบสวัสดิการ/เอกสารอื่นๆ รองรับ PDF, Word, Excel, PNG, JPG ไม่เกิน 20 MB
- ดู/ดาวน์โหลด: ผู้มีสิทธิ์สาขาใดสาขาหนึ่งของบริษัท | แนบ/ลบ: ผู้มีสิทธิ์แก้ไขในสาขานั้น (และ Admin) | ทุกการเปิด/ดาวน์โหลดบันทึกใน Audit Log
