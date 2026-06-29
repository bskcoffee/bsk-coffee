# Cocoa House — Project Rules for Claude

## ⚠️ กฎบังคับก่อน Commit ทุกครั้ง

### 1. อัพเดท System Architecture ทุกครั้งที่มีการเปลี่ยนแปลง
ไฟล์: `src/pages/SystemPage.jsx`

**ต้องอัพเดทเมื่อ:**
- เพิ่ม/ลบ/เปลี่ยนชื่อ page ใดๆ
- เพิ่ม/ลบ route ใน `src/App.jsx`
- เพิ่ม/ลบ/เปลี่ยน Supabase table หรือ column สำคัญ
- เปลี่ยนกฎการคำนวณ GP / Profit (5-Layer)
- เพิ่ม external service (print-server, API ใหม่)
- เปลี่ยน data flow ระหว่าง cocoa-pos ↔ cocoa-house

**ส่วนใน SystemPage.jsx ที่ต้องตรวจ:**
- `APPS` array — pages ของ cocoa-house และ cocoa-pos
- `TABLES` array — Supabase tables ทั้งหมด
- `CALC_RULES` array — กฎการคำนวณ 5 layers
- Data Flow section ด้านล่าง

---

### 2. Preview ก่อนแก้โค้ดเสมอ
"มีดีก่อนแก้ไขโค้ด ต้องพรีวิวให้เราดูก่อนนะ"
— แสดง diff หรืออธิบายสิ่งที่จะเปลี่ยนก่อน แล้วค่อยลงมือแก้

### 3. Git commands — แยกทีละบรรทัด
```
cd "Documents\Claude Cowork\cocoa-house"
git add ...
git commit -m "..."
git push
```
ห้ามใช้ `&&` ต่อ command

---

## Project Structure

```
cocoa-house/          → cocoa-house.vercel.app  (main web app)
  src/
    pages/
      DashboardPage.jsx       /           แดชบอร์ด
      SalesEntryPage.jsx      /sales      กรอกยอดขาย
      SalesHistoryPage.jsx    /history    ประวัติยอดขาย
      CashFlowPage.jsx        /cashflow   รายรับรายจ่าย
      MenuManagementPage.jsx  /menu       จัดการเมนู
      MenuCostPage.jsx        /cost       ต้นทุนเมนู
      ReportsPage.jsx         /reports    รายงาน & Export
      SettingsPage.jsx        /settings   ตั้งค่า (admin)
      LabelSettingsPage.jsx   /label-settings  ตั้งค่าฉลาก (admin)
      UserManagementPage.jsx  /users      การจัดการผู้ใช้งาน (admin)
      ImportPage.jsx          /import     นำเข้าข้อมูล (admin)
      SystemPage.jsx          /system     System Architecture (super admin)
    utils/
      calculations.js         calcPlatformProfit() — 5-Layer GP
    components/
      Sidebar.jsx             nav items + passkey modal
      Layout.jsx

cocoa-pos/            → cocoa-pos.vercel.app  (iPad POS)
  src/pages/
    POSPage.jsx         ?tab=pos    รับออเดอร์ + พิมพ์ฉลาก
    OrderManagePage.jsx ?tab=orders จัดการออเดอร์

print-server/         → Express TCP server (local Windows)
  server.js           รับ ESC/POS จาก POS app → ส่งไปเครื่องพิมพ์
```

## GP Calculation Rule (5-Layer)
```
Layer 1: sales       = Σ(qty × unit_price)
Layer 2: grossSales  = sales − menu_discount
Layer 3: grossProfit = grossSales − gpCostAdjusted
         gpCostAdjusted = gpCostTotal × (grossSales / sales)   ← GP บน grossSales ไม่ใช่ full sales
Layer 4: netProfit   = grossProfit − (campaign + marketing + delivery + advert)
Layer 5: netProfit%  = netProfit / grossSales × 100
```

## Key Supabase Tables
| Table | หน้าที่ |
|-------|---------|
| `orders` | ออเดอร์จาก POS |
| `order_items` | รายการสินค้าในออเดอร์ |
| `platform_costs` | ต้นทุน platform รายวัน (menu_discount sync อัตโนมัติจาก POS) |
| `menus` + `menu_prices` | เมนูและราคาแต่ละ platform |
| `menu_costs` + `cost_settings` | ต้นทุนวัตถุดิบ |
| `cashbook_entries` | รายรับ-รายจ่ายเงินสด |
| `settings` | ค่า global (platform fee%, store name) |
