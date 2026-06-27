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
  [optionLabel: string]: string
}

export interface CartItem {
  id: string
  menuItem: MenuItem
  quantity: number
  selectedOptions: SelectedOptions
  subtotal: number
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
  phone: string
  note?: string
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
  gov_pays?: number
  customer_pays: number
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
  order_number: number
  source: OrderSource
  customer_name?: string
  line_user_id?: string
  delivery_zone?: DeliveryZone
  delivery_address?: DeliveryAddress
  items: OrderItem[]
  payment_method: PaymentMethod
  subtotal: number
  delivery_fee: number
  total: number
  gov_pays?: number
  customer_pays: number
  order_status: OrderStatus
  scheduled_at?: string
  created_at: string
}

// ------------------------------------------------------------
// Store Status
// ------------------------------------------------------------
export type StoreStatusResult = 'open' | 'closed' | 'manual_open' | 'manual_closed'

export interface StoreStatus {
  status: StoreStatusResult
  reopen_at?: string
}

// ------------------------------------------------------------
// Utility functions
// ------------------------------------------------------------

/** คำนวณค่าส่ง: ฿15/กม., ปัดเป็นหลัก 5, ขั้นต่ำ ฿20 */
export function calcDeliveryFee(distanceKm: number): number {
  return Math.max(20, Math.round((distanceKm * 15) / 5) * 5)
}

/** คำนวณ 60/40 campaign — รัฐจ่าย 60% สูงสุด ฿200 */
export function calculate6040(total: number): {
  method: 'campaign_6040'
  total: number
  gov_pays: number
  customer_pays: number
} {
  const gov_pays = Math.min(Math.round(total * 0.6), 200)
  return { method: 'campaign_6040', total, gov_pays, customer_pays: total - gov_pays }
}
