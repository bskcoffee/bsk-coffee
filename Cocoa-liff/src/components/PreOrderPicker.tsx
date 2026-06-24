// src/components/PreOrderPicker.tsx
// DateTimePicker สำหรับสั่งล่วงหน้า — แสดงเฉพาะช่วงเวลาที่ร้านเปิด
import { useState, useEffect } from 'react'

interface PreOrderPickerProps {
  openTime: string    // 'HH:mm' เช่น '08:00'
  closeTime: string   // 'HH:mm' เช่น '20:00'
  onConfirm: (date: Date) => void
  onClose: () => void
}

function generateTimeSlots(openTime: string, closeTime: string): string[] {
  const [openH, openM] = openTime.split(':').map(Number)
  const [closeH, closeM] = closeTime.split(':').map(Number)
  const slots: string[] = []
  let h = openH, m = openM
  while (h * 60 + m <= closeH * 60 + closeM - 30) {
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    m += 30
    if (m >= 60) { h++; m -= 60 }
  }
  return slots
}

function getAvailableDates(): Date[] {
  const dates: Date[] = []
  const today = new Date()
  for (let i = 0; i < 7; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    dates.push(d)
  }
  return dates
}

export function PreOrderPicker({ openTime, closeTime, onConfirm, onClose }: PreOrderPickerProps) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const dates = getAvailableDates()
  const timeSlots = generateTimeSlots(openTime, closeTime)

  function handleConfirm() {
    if (!selectedDate || !selectedTime) return
    const [h, m] = selectedTime.split(':').map(Number)
    const result = new Date(selectedDate)
    result.setHours(h, m, 0, 0)
    onConfirm(result)
  }

  const dayLabels = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']
  const monthLabels = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end">
      <div className="bg-white w-full rounded-t-2xl max-h-[80vh] overflow-y-auto">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        <div className="px-4 pb-6">
          <div className="flex items-center justify-between py-3 mb-1">
            <h2 className="text-base font-bold text-gray-900">สั่งล่วงหน้า</h2>
            <button onClick={onClose} className="text-gray-400 text-xl">✕</button>
          </div>

          {/* Date picker */}
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2">เลือกวัน</p>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {dates.map((d, i) => {
              const isSelected = selectedDate?.toDateString() === d.toDateString()
              const isToday = i === 0
              return (
                <button
                  key={i}
                  onClick={() => { setSelectedDate(d); setSelectedTime(null) }}
                  className={`flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-xl border transition-all ${
                    isSelected
                      ? 'border-green-500 bg-green-50 text-green-700'
                      : 'border-gray-200 text-gray-600'
                  }`}
                >
                  <span className="text-xs">{isToday ? 'วันนี้' : dayLabels[d.getDay()]}</span>
                  <span className="text-base font-bold">{d.getDate()}</span>
                  <span className="text-xs">{monthLabels[d.getMonth()]}</span>
                </button>
              )
            })}
          </div>

          {/* Time picker */}
          {selectedDate && (
            <>
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mt-4 mb-2">
                เลือกเวลา (ร้านเปิด {openTime}–{closeTime} น.)
              </p>
              <div className="grid grid-cols-4 gap-2">
                {timeSlots.map((slot) => {
                  // ถ้าวันนี้ กรอง slot ที่ผ่านไปแล้ว
                  const now = new Date()
                  const [h, m] = slot.split(':').map(Number)
                  const slotDate = new Date(selectedDate)
                  slotDate.setHours(h, m, 0, 0)
                  const isPast = selectedDate.toDateString() === now.toDateString() && slotDate <= now
                  if (isPast) return null

                  const isSelected = selectedTime === slot
                  return (
                    <button
                      key={slot}
                      onClick={() => setSelectedTime(slot)}
                      className={`py-2 rounded-lg text-sm font-medium border transition-all ${
                        isSelected
                          ? 'bg-green-500 text-white border-green-500'
                          : 'border-gray-200 text-gray-700'
                      }`}
                    >
                      {slot}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {/* Confirm */}
          <button
            onClick={handleConfirm}
            disabled={!selectedDate || !selectedTime}
            className={`w-full mt-5 py-3.5 rounded-xl text-base font-semibold transition-colors ${
              selectedDate && selectedTime
                ? 'bg-green-500 text-white'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {selectedDate && selectedTime
              ? `ยืนยัน ${selectedTime} น.`
              : 'เลือกวันและเวลา'}
          </button>
        </div>
      </div>
    </div>
  )
}
