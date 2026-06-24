// src/components/StoreClosedBanner.tsx
import { useState } from 'react'
import type { StoreStatus } from '../types'
import { PreOrderPicker } from './PreOrderPicker'

interface StoreClosedBannerProps {
  status: StoreStatus
  openTime?: string
  closeTime?: string
  onSchedule?: (date: Date) => void
}

export function StoreClosedBanner({
  status,
  openTime = '08:00',
  closeTime = '20:00',
  onSchedule,
}: StoreClosedBannerProps) {
  const [showPicker, setShowPicker] = useState(false)

  const isManualClosed = status.status === 'manual_closed'

  return (
    <>
      <div className="mx-3 mt-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
        <span className="text-xl mt-0.5">🔴</span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-red-700">ร้านปิดอยู่ในขณะนี้</p>
          {isManualClosed && status.reopen_at ? (
            <p className="text-xs text-red-500 mt-0.5">
              จะกลับมาเปิดอีกครั้ง:{' '}
              {new Date(status.reopen_at).toLocaleString('th-TH', {
                weekday: 'short', hour: '2-digit', minute: '2-digit',
              })}
            </p>
          ) : (
            <p className="text-xs text-red-500 mt-0.5">
              เวลาเปิดทำการ {openTime}–{closeTime} น.
            </p>
          )}
          {onSchedule && (
            <button
              onClick={() => setShowPicker(true)}
              className="mt-2 text-xs font-semibold text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5"
            >
              📅 สั่งล่วงหน้าได้เลย
            </button>
          )}
        </div>
      </div>

      {showPicker && (
        <PreOrderPicker
          openTime={openTime}
          closeTime={closeTime}
          onConfirm={(date) => {
            onSchedule?.(date)
            setShowPicker(false)
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </>
  )
}
