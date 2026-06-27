// src/pages/ConfirmationPage.tsx
import type { Order } from '../types'

interface ConfirmationPageProps {
  order: Order
  onNewOrder: () => void
  onTrack: () => void   // ติดตามสถานะออเดอร์
}

const STATUS_LABEL: Record<string, { icon: string; label: string; color: string }> = {
  pending:          { icon: '⏳', label: 'รอร้านยืนยัน',    color: 'text-amber-600 bg-amber-50' },
  confirmed:        { icon: '✅', label: 'ร้านยืนยันแล้ว',  color: 'text-green-600 bg-green-50' },
  out_for_delivery: { icon: '🛵', label: 'กำลังจัดส่ง',     color: 'text-blue-600 bg-blue-50' },
  completed:        { icon: '📦', label: 'จัดส่งแล้ว',       color: 'text-gray-600 bg-gray-100' },
  cancelled:        { icon: '❌', label: 'ถูกยกเลิก',        color: 'text-red-600 bg-red-50' },
}

export function ConfirmationPage({ order, onNewOrder, onTrack }: ConfirmationPageProps) {
  const orderNum = String(order.order_number).padStart(4, '0')
  const statusInfo = STATUS_LABEL[order.order_status] ?? STATUS_LABEL.pending
  const deliveryFee = order.delivery_fee ?? 0

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Green header */}
      <div className="bg-gradient-to-b from-green-500 to-green-600 pt-safe px-4 pb-8 text-center">
        <div className="w-14 h-14 bg-white/25 rounded-full flex items-center justify-center mx-auto mb-3 text-3xl">
          ✓
        </div>
        <h1 className="text-xl font-bold text-white">สั่งซื้อสำเร็จ!</h1>
        <p className="text-green-100 text-sm mt-1">หมายเลขออเดอร์ <span className="font-bold text-white">#{orderNum}</span></p>
      </div>

      <div className="px-4 -mt-3 space-y-3 pb-6">
        {/* Status */}
        <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl font-semibold text-sm ${statusInfo.color}`}>
          <span className="text-lg">{statusInfo.icon}</span>
          <span>{statusInfo.label}</span>
        </div>

        {/* Scheduled */}
        {order.scheduled_at && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2.5">
            <span className="text-xl">📅</span>
            <div>
              <p className="text-xs text-amber-600 font-semibold">สั่งล่วงหน้า</p>
              <p className="text-sm text-amber-800 font-medium">
                {new Date(order.scheduled_at).toLocaleString('th-TH', {
                  weekday: 'short', month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </p>
            </div>
          </div>
        )}

        {/* Items */}
        <Card title="🧋 รายการสินค้า" count={`${order.items.length} รายการ`}>
          {order.items.map((item, i) => (
            <div key={i} className={`flex items-start gap-2.5 py-2.5 ${i < order.items.length - 1 ? 'border-b border-gray-100' : ''}`}>
              <div className="w-6 h-6 bg-green-50 text-green-600 rounded-md text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                {item.quantity}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{item.name}</p>
                <p className="text-xs text-gray-400">{Object.values(item.selected_options).join(' · ')}</p>
              </div>
              <p className="text-sm font-semibold text-gray-900">฿{item.subtotal}</p>
            </div>
          ))}
        </Card>

        {/* Delivery */}
        <Card title="📍 ที่อยู่จัดส่ง">
          {order.delivery_address && (
            <AddressDisplay address={order.delivery_address} deliveryFee={deliveryFee} />
          )}
        </Card>

        {/* Payment */}
        <Card title="💳 วิธีชำระเงิน">
          {order.payment_method === 'qr' ? (
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center text-lg">📱</div>
              <div>
                <p className="text-sm font-medium text-gray-900">QR Code (PromptPay)</p>
                <p className="text-xs text-gray-400">รอการยืนยันการชำระเงิน</p>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center text-lg">🏛️</div>
                <div>
                  <p className="text-sm font-medium text-gray-900">แคมเปญ 60/40</p>
                  <p className="text-xs text-gray-400">รัฐบาลร่วมจ่าย 60%</p>
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2.5 space-y-1.5">
                <SumRow label="ยอดรวม" value={`฿${order.total}`} />
                <SumRow label="รัฐบาลจ่าย" value={`−฿${order.gov_pays}`} valueClass="text-green-500" />
                <SumRow label="คุณจ่าย" value={`฿${order.customer_pays}`} bold />
              </div>
            </div>
          )}
        </Card>

        {/* Total */}
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex justify-between items-center">
          <span className="text-sm text-gray-500">ยอดที่ต้องชำระ</span>
          <span className="text-lg font-bold text-gray-900">฿{order.customer_pays}</span>
        </div>

        {/* Buttons */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onNewOrder}
            className="flex-1 py-3.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700"
          >
            + สั่งเพิ่ม
          </button>
          <button
            onClick={onTrack}
            className="flex-1 py-3.5 rounded-xl bg-green-500 text-sm font-semibold text-white"
          >
            🛵 ติดตามออเดอร์
          </button>
        </div>
      </div>
    </div>
  )
}

function Card({ title, count, children }: { title: string; count?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex-1">{title}</span>
        {count && <span className="text-xs text-gray-400">{count}</span>}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  )
}

function AddressDisplay({ address, deliveryFee }: { address: any; deliveryFee: number }) {
  if (address.zone === 'metro') return (
    <div>
      <span className="text-xs bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full">🏘️ The Metro</span>
      <p className="text-sm font-medium text-gray-900 mt-2">{address.house_number} ซอย {address.soi}</p>
      {address.note && <p className="text-xs text-gray-400 mt-0.5">{address.note}</p>}
      <p className="text-xs text-green-500 font-medium mt-0.5">จัดส่งฟรี</p>
    </div>
  )
  if (address.zone === 'tu') return (
    <div>
      <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-2 py-0.5 rounded-full">🎓 TU</span>
      <p className="text-sm font-medium text-gray-900 mt-2">{address.recipient_name}</p>
      <p className="text-xs text-gray-400 mt-0.5">Thammasat University</p>
      <p className="text-xs text-green-500 font-medium mt-0.5">จัดส่งฟรี</p>
    </div>
  )
  // zone === 'other'
  return (
    <div>
      <span className="text-xs bg-orange-100 text-orange-700 font-semibold px-2 py-0.5 rounded-full">📍 ที่อื่น</span>
      <p className="text-sm font-medium text-gray-900 mt-2">ห่างร้าน {address.distance_km?.toFixed(1)} กม.</p>
      {address.note && <p className="text-xs text-gray-500 mt-0.5">{address.note}</p>}
      {address.phone && <p className="text-xs text-gray-400 mt-0.5">📞 {address.phone}</p>}
      <p className={`text-xs font-medium mt-0.5 ${deliveryFee > 0 ? 'text-amber-600' : 'text-green-500'}`}>
        {deliveryFee > 0 ? `ค่าส่ง ฿${deliveryFee}` : 'จัดส่งฟรี'}
      </p>
    </div>
  )
}

function SumRow({ label, value, valueClass = 'text-gray-700', bold = false }: {
  label: string; value: string; valueClass?: string; bold?: boolean
}) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-gray-400">{label}</span>
      <span className={`${valueClass} ${bold ? 'font-bold text-sm' : ''}`}>{value}</span>
    </div>
  )
}