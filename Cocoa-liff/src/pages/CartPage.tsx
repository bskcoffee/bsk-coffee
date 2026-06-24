// src/pages/CartPage.tsx
import type { CartItem, DeliveryZone } from '../types'
import { FreeShipNudge } from '../components/FreeShipNudge'

interface CartPageProps {
  items: CartItem[]
  subtotal: number
  deliveryFee: number
  selectedZone: DeliveryZone
  distanceKm: number
  onUpdateQuantity: (id: string, qty: number) => void
  onBack: () => void
  onNext: () => void
}

export function CartPage({
  items, subtotal, deliveryFee,
  selectedZone, distanceKm,
  onUpdateQuantity, onBack, onNext,
}: CartPageProps) {
  const total = subtotal + deliveryFee
  const freeShipping = selectedZone !== 'other' || subtotal >= 249

  const btnLabel = freeShipping
    ? 'เลือกที่อยู่จัดส่ง →'
    : `สั่งพร้อมค่าส่ง ฿${deliveryFee} →`

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm px-4 pt-safe pb-3 flex items-center gap-3">
        <button aria-label="ย้อนกลับ" onClick={onBack} className="text-gray-500 text-xl">←</button>
        <h1 className="text-base font-semibold text-gray-900 flex-1">ตะกร้าสินค้า</h1>
        <span className="text-sm text-gray-400">
          {items.reduce((s, c) => s + c.quantity, 0)} รายการ
        </span>
      </header>

      {/* Free Ship Nudge — เฉพาะ zone อื่น */}
      {selectedZone === 'other' && (
        <div className="px-4 pt-3">
          <FreeShipNudge
            total={subtotal}
            minOrder={249}
            deliveryFee={deliveryFee}
            distanceKm={distanceKm}
          />
        </div>
      )}

      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        <div className="bg-white mx-4 mt-3 rounded-xl shadow-sm overflow-hidden">
          {items.map((ci, idx) => (
            <div
              key={ci.id}
              className={`flex items-center gap-3 px-4 py-3 ${
                idx < items.length - 1 ? 'border-b border-gray-100' : ''
              }`}
            >
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{ci.menuItem.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {Object.values(ci.selectedOptions).join(' · ')}
                </p>
              </div>
              {/* Qty controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onUpdateQuantity(ci.id, ci.quantity - 1)}
                  className="w-11 h-11 rounded-full border border-gray-200 flex items-center justify-center text-base text-gray-600"
                >
                  −
                </button>
                <span className="text-sm font-semibold w-4 text-center">{ci.quantity}</span>
                <button
                  onClick={() => onUpdateQuantity(ci.id, ci.quantity + 1)}
                  className="w-11 h-11 rounded-full border border-gray-200 flex items-center justify-center text-base text-gray-600"
                >
                  +
                </button>
              </div>
              <span className="text-sm font-semibold text-gray-900 w-14 text-right">
                ฿{ci.subtotal}
              </span>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="bg-white mx-4 mt-3 rounded-xl shadow-sm px-4 py-3 space-y-2">
          <div className="flex justify-between text-sm text-gray-500">
            <span>ราคาสินค้า</span>
            <span>฿{subtotal}</span>
          </div>
          <div className="flex justify-between text-sm text-gray-500">
            <span>ค่าจัดส่ง</span>
            {freeShipping ? (
              <span className="text-green-500 font-medium">ฟรี</span>
            ) : (
              <span className="text-amber-600 font-medium">฿{deliveryFee}</span>
            )}
          </div>
          {!freeShipping && (
            <p className="text-xs text-amber-500">
              * สั่งครบ ฿249 รับค่าส่งฟรี (เหลืออีก ฿{249 - subtotal})
            </p>
          )}
          <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-100">
            <span>ยอดรวม</span>
            <span>฿{total}</span>
          </div>
        </