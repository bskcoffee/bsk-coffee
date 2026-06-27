// src/services/orderService.ts
import { supabase } from '../lib/supabase'
import type { CartItem, DeliveryAddress, PaymentMethod, Order } from '../types'
import { calculate6040 } from '../types'

export interface CreateOrderPayload {
  lineUserId: string
  customerName: string
  cartItems: CartItem[]
  deliveryAddress: DeliveryAddress
  paymentMethod: PaymentMethod
  subtotal: number
  deliveryFee: number
  total: number
  scheduledAt?: string
}

export async function createOrder(payload: CreateOrderPayload): Promise<Order> {
  const {
    lineUserId, customerName, cartItems, deliveryAddress,
    paymentMethod, subtotal, deliveryFee, total, scheduledAt,
  } = payload

  const payment = paymentMethod === 'campaign_6040'
    ? calculate6040(total)
    : { method: 'qr' as const, total, gov_pays: undefined, customer_pays: total }

  const line_items = cartItems.map((ci) => ({
    menu_item_id: ci.menuItem.id,
    name: ci.menuItem.name,
    price: ci.menuItem.price,
    quantity: ci.quantity,
    selected_options: ci.selectedOptions,
    subtotal: ci.subtotal,
  }))

  const { data, error } = await supabase
    .from('orders')
    .insert({
      // POS columns (ต้องมี)
      platform: 'LINE@',
      date: new Date().toISOString().split('T')[0],   // YYYY-MM-DD
      status: 'preparing',
      notes: `LINE@ order — ${customerName}`,

      // LIFF columns
      line_user_id: lineUserId,
      customer_name: customerName,
      delivery_zone: deliveryAddress.zone,
      delivery_address: deliveryAddress,
      line_items,
      payment_method: paymentMethod,
      subtotal,
      delivery_fee: deliveryFee,
      total,
      gov_pays: payment.gov_pays ?? null,
      customer_pays: payment.customer_pays,
      scheduled_at: scheduledAt ?? null,
    })
    .select()
    .single()

  if (error) throw error
  const d = data as any
  const order = { ...d, items: d.line_items ?? [] } as Order

  // Insert order_items เพื่อให้ POS เห็น item detail
  const orderItems = cartItems.map((ci) => ({
    order_id: order.id,
    menu_id: ci.menuItem.id,
    quantity: ci.quantity,
    unit_price: ci.menuItem.price,
    unit_gp_cost: 0,
    is_campaign: paymentMethod === 'campaign_6040',
    item_options: {
      milk: parseMilk(ci.selectedOptions['__milk__']),
      sweetness: mapSweetness(ci.selectedOptions['ความหวาน']),
      refill: null,
      packaging: (ci.selectedOptions['บรรจุภัณฑ์'] as 'พร้อมดื่ม' | 'แยกน้ำแข็ง') ?? null,
      note: ci.selectedOptions['หมายเหตุ'] ?? '',
    },
  }))

  if (orderItems.length > 0) {
    await supabase.from('order_items').insert(orderItems)
  }

  return order
}

function parseMilk(raw?: string): { id: string; name: string; price: number } | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw)
    return { id: obj.id, name: obj.name, price: 0 }
  } catch {
    return null
  }
}

function mapSweetness(val?: string): number {
  const map: Record<string, number> = {
    '0%': 0, 'ไม่หวาน': 0,
    '10%': 10,
    '25%': 25, 'หวานน้อย': 25,
    '50%': 50, 'หวานน้อยมาก': 50,
    '100%': 100, 'หวานปกติ': 100,
  }
  return map[val ?? ''] ?? 100
}

export async function getOrderById(orderId: string): Promise<Order> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single()
  if (error) throw error
  const d = data as any
  return { ...d, items: d.line_items ?? [] } as Order
}

export function subscribeToOrder(
  orderId: string,
  onUpdate: (order: Order) => void
) {
  return supabase
    .channel(`order-${orderId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `id=eq.${orderId}`,
      },
      (payload) => onUpdate(payload.new as Order)
    )
    .subscribe()
}
