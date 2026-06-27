// src/pages/PaymentPage.tsx
import type { PaymentMethod, DeliveryAddress } from '../types'
import { StepIndicator } from '../components/StepIndicator'

interface PaymentPageProps {
  subtotal: number
  deliveryFee: number
  total: number
  deliveryAddress: DeliveryAddress
  scheduledAt: Date | null
  promptpayQrUrl: string   // จาก liff_config.promptpay_qr_url
  onBack: () => void
  onNext: (method: PaymentMethod) => void
}

export function PaymentPage({
  subtotal, deliveryFee, total,
  deliveryAddress, scheduledAt,
  promptpayQrUrl,
  onBack, onNext,
}: PaymentPageProps) {
  const freeShipping = deliveryFee === 0
  const addressLabel = `GPS · ห่างร้าน ${deliveryAddress.distance_km.toFixed(1)} กม.`

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="bg-white shadow-sm px-4 pt-safe pb-3 flex items-center gap-3">
        <button aria-label="ย้อนกลับ" onClick={onBack} className="text-gray-500 text-xl">←</button>
        <h1 className="text-base font-semibold text-gray-900">ชำระเงิน</h1>
      </header>

      <StepIndicator step={3} />

      <div className="flex-1 overflow-y-auto p-4 space-y-3">

        {/* Delivery summary */}
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3">
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1">จัดส่งไปที่</p>
          <p className="text-sm font-medium text-gray-900">{addressLabel}</p>
          {deliveryAddress.note && (
            <p className="text-xs text-gray-400 mt-0.5">{deliveryAddress.note}</p>
          )}
          {scheduledAt && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
              <span>📅</span>
              <span>สั่งล่วงหน้า: {scheduledAt.toLocaleString('th-TH', {
                weekday: 'short', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}</span>
            </div>
          )}
        </div>

        {/* Order summary */}
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 space-y-2">
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">สรุปออเดอร์</p>
          <div className="flex justify-between text-sm text-gray-500">
            <span>ราคาสินค้า</span><span>฿{subtotal}</span>
          </div>
          <div className="flex justify-between text-sm text-gray-500">
            <span>ค่าจัดส่ง</span>
            {freeShipping
              ? <span className="text-green-500 font-medium">ฟรี</span>
              : <span className="text-amber-600 font-medium">฿{deliveryFee}</span>}
          </div>
          <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-100">
            <span>ยอดที่ต้องโอน</span>
            <span className="text-green-600">฿{total}</span>
          </div>
        </div>

        {/* QR PromptPay */}
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-4 flex flex-col items-center gap-3">
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide self-start">
            ชำระผ่าน QR Code (PromptPay)
          </p>
          <img
            src={promptpayQrUrl}
            alt="PromptPay QR Code"
            className="w-52 h-52 object-contain rounded-xl border border-gray-100"
            onError={(e) => {
              // ถ้ายังไม่ได้อัปโหลด QR ให้แสดง placeholder
              const t = e.currentTarget
              t.style.display = 'none'
              t.nextElementSibling?.classList.remove('hidden')
            }}
          />
          {/* Placeholder ถ้าไม่มีไฟล์ */}
          <div className="hidden w-52 h-52 rounded-xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-2 text-gray-400">
            <span className="text-4xl">📱</span>
            <p className="text-xs text-center px-4">วางไฟล์ QR ที่<br /><code className="bg-gray-100 px-1 rounded">public/promptpay-qr.png</code></p>
          </div>
          <p className="text-xs text-gray-400 text-center">
            สแกน QR ผ่านแอปธนาคาร แล้วกด "ยืนยันออเดอร์"
          </p>
          <div className="w-full bg-amber-50 rounded-lg px-3 py-2 text-xs text-amber-700 text-center">
            ⚠️ กรุณาโอนตามยอดที่แสดง แล้วรอร้านยืนยัน
          </div>
        </div>

      </div>

      {/* Confirm button — ไม่ต้องเลือก method แล้ว กด confirm ได้เลย */}
      <div className="bg-white border-t px-4 pb-safe pt-3">
        <button
          onClick={() => onNext('qr')}
          className="w-full py-3.5 rounded-xl text-base font-semibold bg-green-500 text-white"
        >
          ยืนยันออเดอร์ →
        </button>
      </div>
    </div>
  )
}