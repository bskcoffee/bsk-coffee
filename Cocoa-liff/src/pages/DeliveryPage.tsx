// src/pages/DeliveryPage.tsx
import { useState } from 'react'
import type { DeliveryAddress } from '../types'
import { useLocation } from '../hooks/useLocation'
import { StepIndicator } from '../components/StepIndicator'

interface DeliveryPageProps {
  userLat?: number
  userLng?: number
  distanceKm: number
  onBack: () => void
  onNext: (address: DeliveryAddress) => void
}

export function DeliveryPage({ userLat, userLng, distanceKm, onBack, onNext }: DeliveryPageProps) {
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const { location, check } = useLocation()

  const hasLocation = (userLat !== undefined && userLng !== undefined) || location.status === 'ok'
  const resolvedLat = userLat ?? location.lat
  const resolvedLng = userLng ?? location.lng
  const resolvedDist = userLat !== undefined ? distanceKm : location.distanceKm ?? distanceKm

  function canConfirm(): boolean {
    return hasLocation && phone.trim().length >= 9
  }

  function handleConfirm() {
    if (!canConfirm() || !resolvedLat || !resolvedLng) return
    onNext({
      zone: 'other',
      lat: resolvedLat,
      lng: resolvedLng,
      distance_km: resolvedDist,
      phone: phone.trim(),
      note: note.trim() || undefined,
    })
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="bg-white shadow-sm px-4 pt-safe pb-3 flex items-center gap-3">
        <button aria-label="ย้อนกลับ" onClick={onBack} className="text-gray-500 text-xl">←</button>
        <h1 className="text-base font-semibold text-gray-900">ที่อยู่จัดส่ง</h1>
      </header>

      <StepIndicator step={2} />

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold rounded-xl px-3 py-2.5 text-orange-700 bg-orange-50">
          <span className="text-base">📍</span>
          <span className="flex-1">ที่อยู่อื่น</span>
          <span>ห่าง {resolvedDist.toFixed(1)} กม.</span>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          {hasLocation ? (
            <div className="flex items-center gap-2.5">
              <span className="text-lg">✅</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">ตรวจพบตำแหน่งของคุณ</p>
                <p className="text-xs text-gray-400">ห่างร้าน {resolvedDist.toFixed(1)} กม.</p>
              </div>
              <button onClick={() => check()} className="text-xs text-blue-500 underline">รีเฟรช</button>
            </div>
          ) : location.status === 'loading' ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <div className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
              กำลังระบุตำแหน่ง...
            </div>
          ) : (
            <div className="text-center py-2 space-y-2">
              <p className="text-sm text-gray-500">ไม่สามารถระบุตำแหน่งได้</p>
              <button onClick={() => check()} className="text-sm text-green-500 underline">ลองใหม่</button>
            </div>
          )}

          <div>
            <label className="text-xs text-gray-500 mb-1 block">เบอร์โทรลูกค้า *</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="0812345678"
              maxLength={10}
              type="tel"
              inputMode="tel"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-green-400"
            />
            <p className="text-xs text-gray-400 mt-0.5">สำหรับ Grab driver ติดต่อ</p>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">ชื่ออาคาร / เลขห้อง / จุดสังเกต</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น คอนโด Lumpini ชั้น 5 ห้อง 502"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-green-400"
            />
          </div>
        </div>
      </div>

      <div className="bg-white border-t px-4 pb-safe pt-3">
        {!canConfirm() && hasLocation && phone.trim().length < 9 && (
          <p className="text-xs text-center text-red-400 mb-2">กรุณากรอกเบอร์โทรให้ครบ 9 หลักขึ้นไป</p>
        )}
        <button
          onClick={handleConfirm}
          disabled={!canConfirm()}
          className={`w-full py-3.5 rounded-xl text-base font-semibold transition-colors ${
            canConfirm() ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          ยืนยันที่อยู่ →
        </button>
      </div>
    </div>
  )
}

