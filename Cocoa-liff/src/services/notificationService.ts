// src/services/notificationService.ts
// LINE Push Notification — ส่งผ่าน Edge Function บน Supabase
// Supabase Edge Function: supabase/functions/notify-order-status/index.ts

import type { OrderStatus } from '../types'

const STATUS_MESSAGES: Record<OrderStatus, string | null> = {
  pending: null, // ไม่แจ้ง — ลูกค้าเห็นหน้า confirmation แล้ว
  confirmed: '✅ ร้านยืนยันออเดอร์ของคุณแล้ว กำลังเตรียมเครื่องดื่ม ☕',
  out_for_delivery: '🛵 ออเดอร์ของคุณกำลังจัดส่งแล้ว รอสักครู่นะคะ',
  completed: '📦 จัดส่งเรียบร้อยแล้ว ขอบคุณที่ใช้บริการ Cocoa House 🍫',
  cancelled: '❌ ออเดอร์ของคุณถูกยกเลิก กรุณาติดต่อร้านค้า',
}

// เรียกจาก POS เมื่อ staff เปลี่ยน status
// (ผ่าน Supabase Edge Function เพื่อซ่อน LINE Channel Access Token)
export async function sendStatusNotification(
  lineUserId: string,
  status: OrderStatus,
  orderNumber: number
): Promise<void> {
  const message = STATUS_MESSAGES[status]
  if (!message) return

  const { supabase } = await import('../lib/supabase')
  const { error } = await supabase.functions.invoke('notify-order-status', {
    body: {
      line_user_id: lineUserId,
      message: `[ออเดอร์ #${String(orderNumber).padStart(4, '0')}]\n${message}`,
    },
  })

  if (error) console.error('Push notification failed:', error)
}
