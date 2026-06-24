// src/services/orderService.ts
import { supabase } from '../lib/supabase'
import type { CartItem, DeliveryAddress, PaymentMethod, Order, OrderStatus } from '../types'
import { calculate6040 } from '../types'

export interface CreateOrderPayload {
  lineUserId: string
  customerName: string
  cartItems: CartItem[]
  deliveryAddress: DeliveryAddress
  paymentMethod: PaymentMethod
  total: number
}

export async function createOrder(payload: CreateOrderPayload): Promise<Order> {
  const { lineUserId, customerName, cartItems, deliveryAddress, paymentMethod, total } = payload

  const payment = paymentMethod === 'campaign_6040'
    ? calculate6040(total)
    : { method: 'qr' as const, total, customer_pays: total }

  const items = cartItems.map((ci) => ({
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
      source: 'line',
      customer_name: customerName,
      line_user_id: lineUserId,
      delivery_zone: deliveryAddress.zone,
      delivery_address: deliveryAddress,
      items,
      payment_method: paymentMethod,
      total,
      gov_pays: payment.gov_pays ?? null,
      customer_pays: payment.customer_pays,
      order_status: 'pending',
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
