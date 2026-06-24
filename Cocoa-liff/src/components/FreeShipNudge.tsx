// src/components/FreeShipNudge.tsx
// แสดงเฉพาะ zone 'other' — บอกความคืบหน้า + ค่าส่งปัจจุบัน
interface FreeShipNudgeProps {
  total: number
  minOrder: number     // 249
  deliveryFee: number  // คำนวณจาก calcDeliveryFee()
  distanceKm: number
}

export function FreeShipNudge({ total, minOrder, deliveryFee, distanceKm }: FreeShipNudgeProps) {
  const reached = total >= minOrder
  const remaining = Math.max(minOrder - total, 0)
  const pct = Math.min((total / minOrder) * 100, 100)

  if (reached) {
    return (
      <div className="rounded-xl px-3 py-2.5 border bg-green-50 border-green-300">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-base">🎉</span>
          <div className="flex-1">
            <p className="text-xs font-semibold text-green-700">ได้รับค่าส่งฟรีแล้ว!</p>
            <p className="text-xs text-green-500 mt-0.5">ประหยัดค่าส่งไป ฿{deliveryFee} 🎊</p>
          </div>
          <span className="text-xs font-bold text-green-600">✓ ฟรี</span>
        </div>
        <div className="h-1.5 rounded-full bg-green-100">
          <div className="h-full rounded-full bg-green-500 w-full transition-all duration-500" />
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl px-3 py-2.5 border bg-amber-50 border-amber-300">
      {/* Row 1: icon + message + amount */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-base">🛵</span>
        <div className="flex-1">
            <p className="text-xs font-semibold text-amber-700">ค่าจัดส่ง ฿{deliveryFee}</p>
            <p className="text-xs text-amber-500 mt-0.5">
              เพิ่มอีก ฿{remaining} → ฟรี ฿{deliveryFee}
            </p>
          </div>
          <span className="text-xs font-bold text-amber-600">฿{deliveryFee}</span>
        </div>
      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-amber-100">
        <div
          className="h-full rounded-full bg-amber-400 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-amber-600 mt-1">
        💡 ยอดรวม ฿{total} · เพิ่มอีก ฿{remaining} รับฟรีค่าส่ง
      </p>
    </div>
  )
}