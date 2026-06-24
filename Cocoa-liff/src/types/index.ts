// ============================================================
// Cocoa House LIFF — Shared Types
// ============================================================

// ------------------------------------------------------------
// Menu
// ------------------------------------------------------------
export interface MenuCategory {
  id: string
  name: string
  sort_order: number
}

export interface MenuItemOption {
  label: string       // เช่น "ความหวาน"
  choices: string[]   // เช่น ["หวานน้อย", "หวานปกติ", "หวานมาก"]
  required: boolean
  default?: string
}

export interface MenuItem {
  id: string
  name: string
  price: number
  category_id: string
  image_url: string | null
  options: MenuItemOption[]
  available: boolean
}

// ------------------------------------------------------------
// Cart
// ------------------------------------------------------------
export interface SelectedOptions {
  [optionLabel: string]: string  // เช่น { "ความหวาน": "หวานน้อย" }
}

export interface CartItem {
  id: string            // uuid สร้างตอนเพิ่มลง cart
  menuItem: MenuItem
  quantity: number
  selectedOptions: SelectedOptions
  subtotal: number      // price * quantity
}

// ------------------------------------------------------------
// Delivery
// ------------------------------------------------------------
export type DeliveryZone = 'metro' | 'tu' | 'other'

export interface DeliveryAddressMetro {
  zone: 'metro'
  house_number: string
  soi: string
  note?: string
}

export interface DeliveryAddressTU {
  zone: 'tu'
  recipient_name: string
}

export interface DeliveryAddressOther {
  zone: 'other'
  lat: number
  lng: number
  distance_km: number
  phone: string        // เบอร์โทรลูกค้า (สำหรับ Grab driver)
  note?: string        // ชื่ออาคาร / เลขห้อง / จุดสังเกต
}

export type DeliveryAddress =
  | DeliveryAddressMetro
  | DeliveryAddressTU
  | DeliveryAddressOther

// ------------------------------------------------------------
// Payment
// ------------------------------------------------------------
export type PaymentMethod = 'qr' | 'campaign_6040'

export interface PaymentBreakdown {
  method: PaymentMethod
  total: number
  gov_pays?: number       // เฉพาะ 60/40
  customer_pays: number   // ยอดที่ลูกค้าจ่ายจริง
}

// ------------------------------------------------------------
// Order
// ------------------------------------------------------------
export type OrderStatus = 'pending' | 'confirmed' | 'out_for_delivery' | 'completed' | 'cancelled'
export type OrderSource = 'pos' | 'line'

export interface OrderItem {
  menu_item_id: string
  name: string
  price: number
  quantity: number
  selected_options: SelectedOptions
  subtotal: number
}

export interface Order {
  id: string
  order_number: number         // running number #0042
  source: OrderSource
  customer_name?: string
  line_user_id?: string
  delivery_zone?: DeliveryZone
  delivery_address?: DeliveryAddress
  items: OrderItem[]
  payment_method: PaymentMethod
  subtotal: number             // ราคาสินค้ารวม
  delivery_fee: number         // ค่าส่ง (0 = ฟรี)
  total: number                // subtotal + delivery_fee
  gov_pays?: number
  customer_pays: number
  order_status: OrderStatus
  created_at: string
}

// ------------------------------------------------------------
// Store Status
// ------------------------------------------------------------
export type StoreStatusResult = 'open' | 'closed' | 'manual_open' | 'manual_closed'

export interface StoreStatus {
  status: StoreStatusResult
  reopen_at?: string   // ISO timestamp — แสดงเมื่อ manual_closed
}

// -----------------------------