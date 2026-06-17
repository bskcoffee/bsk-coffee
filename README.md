# ☕ Cocoa House — ระบบจัดการยอดขาย

Web App จัดการยอดขาย รองรับทุก Platform (GRAB / LINE MAN / SHOPEE Food / Other)  
ใช้งานได้จาก คอม / iPad / มือถือ ผ่าน URL เดียวกัน

---

## 🚀 ขั้นตอนติดตั้ง (ทำครั้งเดียว ~20 นาที)

### ขั้นที่ 1 — สร้าง Supabase Project

1. ไปที่ **https://supabase.com** → คลิก **Start your project**
2. สมัครด้วย GitHub หรือ Email
3. คลิก **New project** → ตั้งชื่อ `cocoa-house` → เลือก Region ที่ใกล้ที่สุด (Southeast Asia)
4. ตั้ง **Database Password** (จด password ไว้) → คลิก **Create new project**
5. รอ ~2 นาที ให้ Project พร้อม

### ขั้นที่ 2 — รัน SQL สร้าง Database

1. ใน Supabase → ไปที่เมนู **SQL Editor** (ซ้ายมือ)
2. คลิก **New query**
3. เปิดไฟล์ `supabase_setup.sql` จาก project นี้
4. Copy ทั้งหมด → Paste ใน SQL Editor → คลิก **Run**
5. ตรวจสอบว่า: `total_menus = 59` และ `total_prices = 236`

### ขั้นที่ 3 — สร้าง User สำหรับ Login

1. ใน Supabase → ไปที่ **Authentication** → **Users**
2. คลิก **Add user** → **Create new user**
3. ใส่ Email และ Password ที่ต้องการใช้ Login
4. คลิก **Create user**

### ขั้นที่ 4 — คัดลอก API Keys

1. ใน Supabase → ไปที่ **Settings** (ล่างซ้าย) → **API**
2. คัดลอก:
   - **Project URL** → จะเป็น `https://xxxx.supabase.co`
   - **anon public** key → จะเป็น `eyJhbGci...`

### ขั้นที่ 5 — ตั้งค่า Project

1. คัดลอกไฟล์ `.env.example` → เปลี่ยนชื่อเป็น `.env`
2. เปิดไฟล์ `.env` แล้วใส่ค่าที่คัดลอกมา:

```
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### ขั้นที่ 6 — ติดตั้ง Dependencies และ Run

```bash
# เปิด Terminal ใน folder นี้
npm install
npm run dev
```

เปิด browser ไปที่ **http://localhost:3000** → Login ด้วย Email/Password ที่สร้างไว้

---

## 🌐 Deploy บน Vercel (ใช้งานได้จากทุกที่)

### วิธีที่ 1 — Vercel + GitHub (แนะนำ)

1. Push code ขึ้น **GitHub** repository
2. ไปที่ **https://vercel.com** → Import GitHub repo
3. ใน **Environment Variables** ใส่:
   - `VITE_SUPABASE_URL` = ค่าเดิม
   - `VITE_SUPABASE_ANON_KEY` = ค่าเดิม
4. คลิก **Deploy** → รอ ~2 นาที
5. ได้ URL เช่น `https://cocoa-house.vercel.app` — ใช้ได้ทันที!

### วิธีที่ 2 — Vercel CLI

```bash
npm install -g vercel
vercel
# ตอบคำถาม → เสร็จแล้วได้ URL
```

### ตั้งค่า Environment Variables ใน Vercel

ไปที่ Project Settings → Environment Variables → เพิ่ม:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

---

## 📱 การใช้งาน

| หน้า | ฟีเจอร์ |
|------|---------|
| **Dashboard** | ยอดขาย, กำไร, กราฟ, Top เมนู, Alerts |
| **กรอกยอดขาย** | เลือกวัน+Platform, กด +/- เพิ่มเมนู, Auto-save |
| **จัดการเมนู** | เพิ่ม/แก้ไข/ซ่อนเมนู, ราคาแยก Platform, ประวัติราคา |
| **รายงาน** | Export Excel 3 Sheet |
| **ตั้งค่า** | Fee %, Default costs, เปลี่ยน Email/Password |

---

## 🔧 Tech Stack

- **Frontend**: React 18 + Vite + Tailwind CSS
- **Database**: Supabase (PostgreSQL) + Row Level Security
- **Charts**: Recharts
- **Export**: SheetJS (xlsx)
- **Deploy**: Vercel
- **Icons**: Lucide React

---

## 💡 Tips

- **Auto-save Draft**: ข้อมูลบันทึกทุก 30 วิ — ถ้าเบราว์เซอร์ปิด ข้อมูลที่กรอกยังอยู่
- **Offline Mode**: ถ้าเน็ตหาย สามารถกรอกต่อได้ ระบบ sync เมื่อเน็ตกลับ
- **Session 30 วัน**: ไม่ต้อง Login ใหม่ทุกวัน
- **GP Cost**: ต้องกรอกเองในหน้าจัดการเมนู เพื่อให้คำนวณกำไรได้แม่นยำ
- **ราคาแยก Platform**: สามารถตั้งราคา GRAB ≠ LINE ≠ SHOPEE ≠ Other ได้

---

*Cocoa House Sales Management System v1.0*
