// supabase/functions/notify-order-status/index.ts
// Edge Function — ส่ง LINE Push Message เมื่อ POS เปลี่ยนสถานะ order
//
// Deploy: npx supabase functions deploy notify-order-status
// Env vars ที่ต้องตั้งใน Supabase Dashboard → Settings → Edge Functions:
//   LINE_CHANNEL_ACCESS_TOKEN = <token จาก LINE Developers>
//
// Trigger: Supabase Dashboard → Database → Webhooks → สร้าง webhook ใหม่
//   Table: orders | Events: UPDATE
//   URL: https://<project>.supabase.co/functions/v1/notify-order-status

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push'

const STATUS_MESSAGE: Record<string, string> = {
  confirmed:        '✅ ร้านยืนยันออเดอร์ของคุณแล้ว กำลังเตรียมเครื่องดื่ม 🍫',
  out_for_delivery: '🛵 ออเดอร์ของคุณกำลังจัดส่งแล้ว! เตรียมรับของได้เลย',
  completed:        '📦 จัดส่งเรียบร้อย! ขอบคุณที่ใช้บริการ Cocoa House 🍫\nหวังว่าจะได้เจอกันใหม่นะคะ',
  cancelled:        '❌ ออเดอร์ของคุณถูกยกเลิก กรุณาติดต่อร้านหากมีข้อสงสัย',
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')
  if (!token) {
    return new Response('LINE_CHANNEL_ACCESS_TOKEN not set', { status: 500 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  // Supabase Database Webhook payload
  const record = body.record ?? body.new  // order row หลัง UPDATE
  const oldRecord = body.old_record ?? body.old

  const { line_user_id, order_status, customer_name, order_number } = record ?? {}

  // ส่งเฉพาะ status ที่เปลี่ยนแปลง + มี line_user_id
  if (!line_user_id || !order_status) {
    return new Response('No line_user_id or status', { status: 200 })
  }

  // ไม่ส่งถ้า status ไม่ได้เปลี่ยน
  if (oldRecord?.order_status === order_status) {
    return new Response('Status unchanged', { status: 200 })
  }

  const messageText = STATUS_MESSAGE[order_status]
  if (!messageText) {
    return new Response('No message for this status', { status: 200 })
  }

  const orderNum = order_number ? `#${String(order_number).padStart(4, '0')}` : ''
  const fullMessage = `Cocoa House 🍫\nออเดอร์ ${orderNum}\n\n${messageText}`

  const lineRes = await fetch(LINE_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: line_user_id,
      messages: [{ type: 'text', text: fullMessage }],
    }),
  })

  if (!lineRes.ok) {
    const err = await lineRes.text()
    console.error('LINE API error:', err)
    return new Response(`LINE error: ${err}`, { status: 500 })
  }

  return new Response('OK', { status: 200 })
})
