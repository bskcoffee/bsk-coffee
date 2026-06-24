// src/pages/DeliveryPage.tsx
// zone ถูกเลือกไว้แล้วจาก ZonePage — แสดงแค่ address form ของ zone นั้น
import { useState } from 'react'
import type { DeliveryAddress, DeliveryZone } from '../types'
import { useLocation } from '../hooks/useLocation'

interface DeliveryPageProps {
  zone: DeliveryZone
  userLat?: number      // GPS จาก ZonePage (เฉพาะ "other")
  userLng?: number
  distanceKm: number
  onBack: () => void
  onNext: (address: DeliveryAddress) => void
}

export function DeliveryPage({
  zone, userLat, userLng, distanceKm, onBack, onNext,
}: DeliveryPageProps) {
  // Metro fields
  const [houseNumber, setHouseNumber] = useState('')
  const [soi, setSoi] = useState('')
  const [note, setNote] = useState('')
  // TU fields
  const [recipientName, setRecipientName] = useState('')
  // Other fields
  const [phone, setPhone] = useState('')
  const [otherNote, setOtherNote] = useState('')
  // Other — fallback check ถ้า GPS ยังไม่มี
  const { location, check } = useLocation()

  // ถ้ามี GPS จาก ZonePage ให้ใช้ค่านั้นก่อน
  const hasLocation = (userLat !== undefined && userLng !== undefined) || location.status === 'ok'
  const resolvedLat = userLat ?? location.lat
  const resolvedLng = userLng ?? location.lng
  const resolvedDist = userLat !== undefined ? distanceKm : location.distanceKm ?? distanceKm

  function canConfirm(): boolean {
    if (zone === 'metro') return houseNumber.trim().length > 0
    if (zone === 'tu') return recipientName.trim().length > 0
    if (zone === 'other') return hasLocation && phone.trim().length >= 9
    return false
  }

  function handleConfirm() {
    if (!canConfirm()) return
    let address: DeliveryAddress
    if (zone === 'metro') {
      address = { zone, house_number: houseNumber.trim(), soi: soi.trim(), note: note.trim() }
    } else if (zone === 'tu') {
      address = { zone, recipient_name: recipientName.trim() }
    } else {
      if (!resolvedLat || !resolvedLng) return
      address = {
        zone,
        lat: resolvedLat,
        lng: resolvedLng,
        distance_km: resolvedDist,
        phone: phone.trim(),
        note: otherNote.trim() || undefined,
      }
    }
    onNext(address)
  }

  const zoneLabel = {
    metro: { icon: '🏘️', label: 'หมู่บ้าน The Metro', color: 'text-green-700 bg-green-50', badge: 'จัดส่งฟรี' },
    tu:    { icon: '🎓', label: 'Thammasat University', color: 'text-blue-700 bg-blue-50', badge: 'จัดส่งฟรี' },
    other: { icon: '📍', label: 'ที่อยู่อื่น', color: 'text-orange-700 bg-orange-50', badge: `ห่าง ${resolvedDist.toFixed(1)} กม.` },
  }[zone]

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm px-4 pt-safe pb-3 flex items-center gap-3">
        <button aria-label="ย้อนกลับ" onClick={onBack} className="text-gray-500 text-xl">←</button>
        <h1 className="text-base font-semibold text-gray-900">ที่อยู่จัดส่ง</h1>
      </header>

      <StepIndicator step={2} />

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Zone header chip */}
        <div className={`flex items-center gap-2 text-xs font-semibold rounded-xl px-3 py-2.5 ${zoneLabel.color}`}>
          <span className="text-base">{zoneLabel.icon}</span>
          <span className="flex-1">{zoneLabel.label}</span>
          <span>{zoneLabel.badge}</span>
        </div>

        {/* ─── Metro form ─── */}
        {zone === 'metro' && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">บ้านเลขที่ *</label>
                <input
                  value={houseNumber}
                  onChange={(e) => setHouseNumber(e.target.value)}
                  placeholder="เช่น 88/12"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-green-400"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">ซอย</label>
                <input
                  value={soi}
                  onChange={(e) => setSoi(e.target.value)}
                  placeholder="เช่น ซอย 5"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-green-400"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">หมายเหตุ (ถ้ามี)</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="เช่น รั้วสีขาว บ้านหลังมุม"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-green-400"
              />
            </div>
          </div>
        )}

        {/* ─── TU form ─── */}
        {zone === 'tu' && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">ชื่อผู้รับ *</label>
              <input
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="ชื่อ-นามสกุล"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-green-400"
              />
            </div>
            <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 rounded-lg">
              <span className="text-sm">📍</span>
              <span className="text-sm text-gray-500">Thammasat University (TU)</span>
            </div>
          </div>
        )}

        {/* ─── Other (GPS) ─── */}
        {zone === 'other' && (
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

            {/* เบอร์โทร — required */}
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

            {/* หมายเหตุ — optional */}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">ชื่ออาคาร / เลขห้อง / จุดสังเกต</label>
              <input
                value={otherNote}
                onChange={(e) => setOtherNote(e.target.value)}
                placeholder="เช่น คอนโด Lumpini ชั้น 5 ห้อง 502"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-green-400"
              />
            </div>
          </div>
        )}
      </div>

      {/* Confirm */}
      <div className="bg-white border-t px-4 pb-safe pt-3">
        {/* Validation hint — เฉพาะ zone "other" */}
        {zone === 'other' && !canConfirm() && hasLocation && phone.trim().length < 9 && (
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

function StepIndicator({ step }: { step: number }) {
  const steps = ['ตะกร้า', 'ที่อยู่', 'ชำระเงิน']
  return (
    <div className="bg-white border-b flex items-center px-4 py-2.5">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center flex-1">
          <div className="flex flex-col items-center flex-1">
            <div className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${
              i + 1 < step ? 'bg-green-500 text-white' :
              i + 1 === step ? 'bg-green-500 text-white ring-4 ring-green-100' : 'bg-gray-100 text-gray-400'
            }`}>
              {i + 1 < step ? '✓' : i + 1}
            </div>
            <p className={`text-xs mt-1 ${i + 1 === step ? 'text-green-600 font-semibold' : 'text-gray-400'}`}>
              {label}
            </p>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-0.5 mb-4 ${i + 1 < step ? 'bg-green-500' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}