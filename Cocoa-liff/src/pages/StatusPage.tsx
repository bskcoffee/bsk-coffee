// src/pages/StatusPage.tsx
import { useOrder } from '../hooks/useOrder'
import type { OrderStatus } from '../types'

interface StatusPageProps {
  orderId: string
  onNewOrder: () => void
}

const STATUS_STEPS: { key: OrderStatus; icon: string; label: string }[] = [
  { key: 'pending',          icon: '📋', label: 'รอร้านยืนยัน' },
  { key: 'confirmed',        icon: '✅', label: 'ร้านยืนยันแล้ว' },
  { key: 'out_for_delivery', icon: '🛵', label: 'กำลังจัดส่ง' },
  { key: 'completed',        icon: '📦', label: 'จัดส่งเรียบร้อย' },
]

const STATUS_ORDER: Record<OrderStatus, number> = {
  pending: 0, confirmed: 1, out_for_delivery: 2, completed: 3, cancelled: -1,
}

export function StatusPage({ orderId, onNewOrder }: StatusPageProps) {
  const { order, loading, error } = useOrder(orderId)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-green-500 border-t-transparent" />
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3 px-6 text-center">
        <span className="text-4xl">😕</span>
        <p className="text-gray-500 text-sm">{error ?? 'ไม่พบออเดอร์'}</p>
        <button onClick={onNewOrder} className="text-green-500 text-sm underline">กลับหน้าหลัก</button>
      </div>
    )
  }

  const currentStep = STATUS_ORDER[order.order_status] ?? 0
  const orderNum = String(order.order_number).padStart(4, '0')
  const isCancelled = order.order_status === 'cancelled'

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-b from-green-500 to-green-600 pt-safe px-4 pb-10 text-center">
        <p className="text-green-100 text-xs mb-1">ออเดอร์ #{orderNum}</p>
        <h1 className="text-xl font-bold text-white">
          {isCancelled ? '❌ ออเดอร์ถูกยกเลิก' : '🛵 ติดตามการจัดส่ง'}
        </h1>
        <p className="text-green-100 text-xs mt-1">อัปเดตอัตโนมัติแบบ Real-time</p>
      </div>

      <div className="px-4 -mt-4 space-y-3 pb-6">
        {/* Status timeline */}
        {!isCancelled && (
          <div className="bg-white rounded-xl border border-gray-100 px-4 py-4">
            <div className="space-y-0">
              {STATUS_STEPS.map((step, idx) => {
                const done = currentStep > idx
                const active = currentStep === idx
                const isLast = idx === STATUS_STEPS.length - 1
                return (
                  <div key={step.key} className="flex gap-3">
                    {/* Line + dot */}
                    <div className="flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-base flex-shrink-0 ${
                        done ? 'bg-green-500 text-white' :
                        active ? 'bg-green-500 text-white ring-4 ring-green-100' :
                        'bg-gray-100 text-gray-400'
                      }`}>
                        {done ? '✓' : step.icon}
                      </div>
                      {!isLast && (
                        <div className={`w-0.5 h-8 ${done ? 'bg-green-500' : 'bg-gray-200'}`} />
                      )}
                    </div>
                    {/* Label */}
                    <div className="flex-1 pt-1.5 pb-4">
                      <p className={`text-sm font-semibold ${active ? 'text-green-600' : done ? 'text-gray-700' : 'text-gray-300'}`}>
                        {step.label}
                      </p>
                      {active && (
                        <p className="text-xs text-gray-400 mt-0.5">กำลังดำเนินการ...</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Scheduled time */}
        {order.scheduled_at && (
          <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-xl">📅</span>
            <div>
              <p className="text-xs text-amber-600 font-semibold">กำหนดจัดส่ง</p>
              <p className="text-sm text-amber-800 font-medium">
                {new Date(order.scheduled_at).toLocaleString('th-TH', {
                  weekday: 'short', month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </p>
            </div>
          </div>
        )}

        {/* Items summary */}
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3">
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2">รายการ</p>
          {order.items.map((item, i) => (
            <div key={i} className="flex justify-between text-sm py-1">
              <span className="text-gray-700">{item.name} ×{item.quantity}</span>
              <span className="text-gray-900 font-medium">฿{item.subtotal}</span>
            </div>
          ))}
          <div className="flex justify-between text-sm font-bold text-gray-900 pt-2 border-t border-gray-100 mt-1">
            <span>ยอดที่ต้องชำระ</span>
            <span>฿{order.customer_pays}</span>
          </div>
        </div>

        <button
          onClick={onNewOrder}
          className="w-full py-3.5 rounded-xl bg-green-500 text-white font-semibold text-base"
        >
          + สั่งเพิ่ม
        </button>
      