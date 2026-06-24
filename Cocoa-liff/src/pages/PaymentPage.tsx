// src/pages/PaymentPage.tsx
import { useState } from 'react'
import type { PaymentMethod, DeliveryAddress } from '../types'
import { calculate6040 } from '../types'
import { StepIndicator } from '../components/StepIndicator'

interface PaymentPageProps {
  subtotal: number
  deliveryFee: number
  total: number        // subtotal + deliveryFee
  deliveryAddress: DeliveryAddress
  scheduledAt: Date | null
  onBack: () => void
  onNext: (method: PaymentMethod) => void
}

export function PaymentPage({
  subtotal, deliveryFee, total,
  deliveryAddress, scheduledAt, onBack, onNext,
}: PaymentPageProps) {
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const breakdown = calculate6040(total)
  const freeShipping = deliveryFee === 0

  const addressLabel = getAddressLabel(deliveryAddress)

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
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2">จัดส่งไปที่</p>
          <p className="text-sm font-medium text-gray-900">{addressLabel}</p>
          {scheduledAt && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
              <span>📅</span>
              <span>สั่งล่วงหน้า: {formatScheduled(scheduledAt)}</span>
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
            {freeShipping ? (
              <span className="text-green-500 font-medium">ฟรี</span>
            ) : (
              <span className="text-amber-600 font-medium">฿{deliveryFee}</span>
            )}
          </div>
          <div className="flex justify-between text-sm font-bold text-gray-900 pt-2 border-t border-gray-100">
            <span>ยอดรวม</span><span>฿{total}</span>
          </div>
        </div>

        {/* Payment methods */}
        <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">เลือกวิธีชำระเงิน</p>

        {/* QR Code */}
        <button
          onClick={() => setMethod('qr')}
          className={`w-full text-left rounded-xl border p-4 transition-all ${
            method === 'qr' ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-xl">📱</div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900">QR Code (PromptPay)</p>
              <p className="text-xs text-gray-400">สแกนจ่ายผ่านแอปธนาคาร</p>
            </div>
            <RadioDot checked={method === 'qr'} />
          </div>
        </button>

        {/* 60/40 Campaign */}
        <button
          onClick={() => setMethod('campaign_6040')}
          className={`w-full text-left rounded-xl border p-4 transition-all ${
            method === 'campaign_6040' ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center text-xl">🏛️</div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900">แคมเปญ 60/40</p>
              <p className="text-xs text-gray-400">รัฐบาลร่วมจ่าย 60% (สูงสุด ฿200)</p>
            </div>
            <RadioDot checked={method === 'campaign_6040'} />
          </div>
          {method === 'campaign_6040' && (
            <div className="mt-3 bg-white rounded-lg px-3 py-2.5 space-y-1.5">
              <Row label="ยอดรวม" value={`฿${total}`} />
              <Row label="รัฐบาลจ่าย (60%)" value={`−฿${breakdown.gov_pays}`} valueClass="text-green-500" />
              <Row label="คุณจ่าย (40%)" value={`฿${breakdown.customer_pays}`} bold />
            </div>
          )}
        </button>

        {/* Total to pay */}
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex justify-between items-center">
          <span className="text-sm text-gray-500">ยอดที่ต้องชำระ</span>
          <span className="text-lg font-bold text-gray-900">
            ฿{method === 'campaign_6040' ? breakdown.customer_pays : total}
          </span>
        </div>
      </div>

      <div className="bg-white border-t px-4 pb-safe pt-3">
        <button
          onClick={() => method && onNext(method)}
          disabled={!method}
          className={`w-full py-3.5 rounded-xl text-base font-semibold transition-colors ${
            method ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          ยืนยันออเดอร์ →
        </button>
      </div>
    </div>
  )
}

function RadioDot({ checked }: { checked: boolean }) {
  return (
    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
      checked ? 'border-green-500 bg-green-500' : 'border-gray-300'
    }`}>
      {checked && <div className="w-2 h-2 rounded-full bg-white" />}
    </div>
  )
}

function Row({ label, value, valueClass = 'text-gray-700', bold = false }: {
  label: string; value: string; valueClass?: string; bold?: boolean
}) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-gray-400">{label}</span>
      <span className={`${valueClass} ${bold ? 'font-bold text-sm' : ''}`}>{value}</span>
    </div>
  )
}

function getAddressLabel(addr: DeliveryAddress): string {
  if (addr.zone === 'metro') return `${addr.house_number} ซอย ${addr.soi} · The Metro`
  if (addr.zone === 'tu') return `${addr.recipient_name} · Thammasat University`
  return `GPS · ห่างร้าน ${addr.distance_km.toFixed(1)} กม.`
}

function formatScheduled(date: Date): string {
  return date.toLocaleString('th-TH', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}