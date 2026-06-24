// src/pages/ZonePage.tsx
// หน้าแรก — เลือกพื้นที่จัดส่ง (ก่อนเข้าเมนู)
import { useState } from 'react'
import type { DeliveryZone } from '../types'
import { calcDeliveryFee } from '../types'
import { useLocation } from '../hooks/useLocation'

export interface ZoneSelection {
  zone: DeliveryZone
  distanceKm: number   // 0 สำหรับ metro/tu
  lat?: number
  lng?: number
}

interface ZonePageProps {
  displayName: string
  onNext: (selection: ZoneSelection) => void
}

export function ZonePage({ displayName, onNext }: ZonePageProps) {
  const [selectedZone, setSelectedZone] = useState<DeliveryZone | null>(null)
  const { location, check } = useLocation()

  function handleSelect(zone: DeliveryZone) {
    setSelectedZone(zone)
    if (zone === 'other' && location.status === 'idle') check()
  }

  function canProceed(): boolean {
    if (!selectedZone) return false
    if (selectedZone === 'other') return location.status === 'ok'
    return true
  }

  function handleNext() {
    if (!selectedZone || !canProceed()) return
    if (selectedZone === 'other' && location.status === 'ok') {
      onNext({
        zone: selectedZone,
        distanceKm: location.distanceKm!,
        lat: location.lat,
        lng: location.lng,
      })
    } else {
      onNext({ zone: selectedZone, distanceKm: 0 })
    }
  }

  const tooFar = location.status === 'too_far'
  const deliveryFee =
    location.status === 'ok' && location.distanceKm
      ? calcDeliveryFee(location.distanceKm)
      : null

  const firstName = displayName.split(' ')[0] || displayName

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white px-4 pt-safe pb-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🍫</span>
          <div>
            <h1 className="text-base font-bold text-gray-900">Cocoa House</h1>
            <p className="text-xs text-gray-400">
              {firstName ? `สวัสดี ${firstName}! ` : ''}ยินดีต้อนรับ
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-gray-800">คุณอยู่ที่ไหนครับ?</p>
          <p className="text-xs text-gray-400 mt-0.5">เลือกพื้นที่เพื่อแสดงข้อมูลค่าจัดส่ง</p>
        </div>

        {/* Metro */}
        <ZoneCard
          icon="🏘️"
          iconBg={selectedZone === 'metro' ? 'bg-green-100' : 'bg-gray-100'}
          label="หมู่บ้าน The Metro"
          sub="ระบุบ้านเลขที่ + ซอย"
          badge="ฟรี ไม่มีขั้นต่ำ"
          badgeClass="bg-green-100 text-green-700"
          selected={selectedZone === 'metro'}
          onSelect={() => handleSelect('metro')}
        />

        {/* TU */}
        <ZoneCard
          icon="🎓"
          iconBg={selectedZone === 'tu' ? 'bg-green-100' : 'bg-blue-50'}
          label="Thammasat University"
          sub="ระบุชื่อผู้รับเท่านั้น"
          badge="ฟรี ไม่มีขั้นต่ำ"
          badgeClass="bg-green-100 text-green-700"
          selected={selectedZone === 'tu'}
          onSelect={() => handleSelect('tu')}
        />

        {/* Other */}
        <ZoneCard
          icon="📍"
          iconBg={selectedZone === 'other' ? 'bg-orange-100' : 'bg-orange-50'}
          label="ที่อยู่อื่น (ในรัศมี 3 กม.)"
          sub={tooFar ? 'ตำแหน่งของคุณอยู่นอกรัศมีบริการ' : 'ใช้ GPS ระบุตำแหน่ง'}
          badge={tooFar ? 'ไม่รองรับ' : deliveryFee !== null ? `ค่าส่ง ฿${deliveryFee}` : 'คิดตามระยะทาง'}
          badgeClass={tooFar ? 'bg-red-100 text-red-500' : deliveryFee !== null ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}
          selected={selectedZone === 'other'}
          disabled={tooFar}
          onSelect={() => !tooFar && handleSelect('other')}
        />

        {/* GPS status — เฉพาะ "ที่อื่น" */}
        {selectedZone === 'other' && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2.5">
            {location.status === 'loading' && (
              <div className="flex items-center gap-2.5 text-sm text-gray-400">
                <div className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                กำลังระบุตำแหน่ง...
              </div>
            )}

            {location.status === 'ok' && location.distanceKm !== undefined && (
              <>
                <div className="flex items-center gap-2.5">
                  <span className="text-lg">✅</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">ตรวจพบตำแหน่งของคุณ</p>
                    <p className="text-xs text-gray-400">
                      ห่างร้าน {location.distanceKm.toFixed(1)} กม.
                    </p>
                  </div>
                  <button
                    onClick={() => check()}
                    className="text-xs text-blue-500 underline"
                  >
                    เปลี่ยน
                  </button>
                </div>
                {deliveryFee !== null && (
                  <div className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                    <div>
                      <p className="text-xs font-semibold text-orange-700">ค่าจัดส่ง</p>
                      <p className="text-xs text-orange-500">
                        {location.distanceKm.toFixed(1)} กม. × ฿15
                      </p>
                    </div>
                    <p className="text-base font-bold text-orange-700">฿{deliveryFee}</p>
                  </div>
                )}
                <p className="text-xs text-gray-400">
                  💡 สั่งครบ ฿249 รับค่าส่งฟรีทันที!
                </p>
              </>
            )}

            {location.status === 'too_far' && (
              <div className="text-center py-2 space-y-1">
                <p className="text-sm font-semibold text-red-600">ตำแหน่งของคุณอยู่นอกรัศมี 3 กม.</p>
                <p className="text-xs text-gray-400">ขออภัย ยังไม่สามารถจัดส่งได้</p>
              </div>
            )}

            {(location.status === 'denied' || location.status === 'unavailable') && (
              <div className="text-center py-2 space-y-2">
                <p className="text-sm text-gray-500">ไม่สามารถระบุตำแหน่งได้</p>
                <button
                  onClick={() => check()}
                  className="text-sm text-green-500 underline"
                >
                  ลองใหม่
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Next Button */}
      <div className="bg-white border-t px-4 pb-safe pt-3">
        <button
          onClick={handleNext}
          disabled={!canProceed()}
          className={`w-full py-3.5 rounded-xl text-base font-semibold transition-colors ${
            canProceed()
              ? 'bg-green-500 text-white'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          ดูเมนู →
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────
function ZoneCard({
  icon, iconBg, label, sub, badge, badgeClass, selected, disabled, onSelect,
}: {
  icon: string
  iconBg: string
  label: string
  sub: string
  badge: string
  badgeClass: string
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={`w-full text-left rounded-xl border p-3.5 transition-all ${
        disabled ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed' :
        selected ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${iconBg}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 leading-tight">{label}</p>
          <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${badgeClass}`}>
          {badge}
        </span>
       