# BSK coffee Print Server

Local Node.js server รับ print job จาก BSK POS → ส่ง TSPL ผ่าน TCP ไปยัง ES-9960 WiFi

## วิธีติดตั้งและเริ่มใช้

### 1. ตั้งค่า IP เครื่องพิมพ์

```bash
copy .env.example .env
```

แก้ไข `.env`:
```
PRINTER_IP=192.168.1.xxx   ← IP จริงของ ES-9960 (ดูจากหน้าจอเครื่องพิมพ์)
PRINTER_PORT=9100
SERVER_PORT=3001
```

### 2. เริ่ม server

**วิธีง่าย (Windows):** double-click `start.bat`

**หรือผ่าน terminal:**
```bash
npm install
npm start
```

### 3. ตั้งค่าใน BSK

ไปที่ **ตั้งค่าฉลาก** → ใส่ IP ของ **คอมพิวเตอร์** ที่รัน print server นี้ (ไม่ใช่ IP printer)
กด **ทดสอบการเชื่อมต่อ** — ควรขึ้น ✓

## หมายเหตุสำหรับ iPad (bsk-pos.vercel.app)

เนื่องจาก Vercel ใช้ HTTPS แต่ print server เป็น HTTP, iOS Safari จะบล็อก mixed-content
**วิธีแก้:** เปิด bsk-pos ผ่าน IP คอมพิวเตอร์บน local network แทน
เช่น `http://192.168.1.50:5173` (ถ้ารัน dev) หรือ build แล้ว serve ผ่าน local

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | ตรวจสอบการเชื่อมต่อ |
| POST | /print | พิมพ์ label |

### POST /print body

```json
{
  "orderId": "GF-012",
  "platform": "GRAB",
  "items": [
    {
      "name": "Dark Latte",
      "qty": 2,
      "item_options": {
        "sweetness": 50,
        "packaging": null,
        "note": "",
        "optionGroups": []
      }
    }
  ],
  "labelSettings": {
    "showMenuName": true,
    "menuNameSize": "large",
    "copies": 1,
    "textAlign": "center"
  },
  "storeName": "BSK coffee"
}
```
