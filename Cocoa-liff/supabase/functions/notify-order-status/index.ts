// supabase/functions/notify-order-status/index.ts
// Supabase Edge Function — ส่ง LINE Push Notification
// Deploy: supabase functions deploy notify-order-status

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')!

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const { line_user_id, message } = await req.json()

  if (!line_user_id || !message) {
    return new Response('Missing line_user_id or message', { status: 400 })
  }

  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to: line_user_id,
      messages: [{ type: 'text', text: message }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    return new Response(`LINE API error: ${err}`, { status: 500 })
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
