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
  return data as Order
}

export async function getOrderById(orderId: string): Promise<Order> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single()
  if (error) throw error
  return data as Order
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
