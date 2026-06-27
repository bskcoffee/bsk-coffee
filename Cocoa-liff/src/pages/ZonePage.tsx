// src/pages/ZonePage.tsx
// หน้าแรก — ตรวจ GPS ก่อนเข้าเมนู (รองรับเฉพาะ "ที่อยู่อื่น")
import { useEffect } from 'react'
import { calcDeliveryFee } from '../types'
import { useLocation } from '../hooks/useLocation'

export interface ZoneSelection {
  zone: 'other'
  distanceKm: number
  lat?: number
  lng?: number
}

interface ZonePageProps {
  displayName: string
  onNext: (selection: ZoneSelection) => void
}

export function ZonePage({ displayName, onNext }: ZonePageProps) {
  const { location, check } = useLocation()

  // auto-check GPS เมื่อโหลดหน้า
  useEffect(() => {
    check()
  }, [])

  function canProceed(): boolean {
    return location.status === 'ok'
  }

  function handleNext() {
    if (location.status !== 'ok') return
    onNext({
      zone: 'other',
      distanceKm: location.distanceKm!,
      lat: location.lat,
      lng: location.lng,
    })
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
          <p className="text-sm font-semibold text-gray-800">ระบุตำแหน่งของคุณ</p>
          <p className="text-xs text-gray-400 mt-0.5">ใช้ GPS ตรวจสอบว่าอยู่ในรัศมีจัดส่ง 3 กม.</p>
        </div>

        {/* GPS Status Card */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2.5">
          {location.status === 'idle' || location.status === 'loading' ? (
            <div className="flex items-center gap-2.5 text-sm text-gray-400">
              <div className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
              กำลังระบุตำแหน่ง...
            </div>
          ) : location.status === 'ok' && location.distanceKm !== undefined ? (
            <>
              <div className="flex items-center gap-2.5">
                <span className="text-lg">✅</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">ตรวจพบตำแหน่งของคุณ</p>
                  <p className="text-xs text-gray-400">
                    ห่างร้าน {location.distanceKm.toFixed(1)} กม.
                  </p>
                </div>
                <button onClick={() => check()} className="text-xs text-blue-500 underline">
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
          ) : tooFar ? (
            <div className="text-center py-2 space-y-1">
              <p className="text-sm font-semibold text-red-600">ตำแหน่งของคุณอยู่นอกรัศมี 3 กม.</p>
              <p className="text-xs text-gray-400">ขออภัย ยังไม่สามารถจัดส่งได้</p>
              <button onClick={() => check()} className="text-sm text-green-500 underline mt-1">
                ลองใหม่
              </button>
            </div>
          ) : (
            <div className="text-center py-2 space-y-2">
              <p className="text-sm text-gray-500">ไม่สามารถระบุตำแหน่งได้</p>
              <button onClick={() => check()} className="text-sm text-green-500 underline">
                ลองใหม่
              </button>
            </div>
          )}
        </div>
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