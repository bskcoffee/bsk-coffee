// src/components/OptionModal.tsx
import { useState } from 'react'
import type { MenuItem, SelectedOptions, Addon } from '../types'

const SWEETNESS_LEVELS = ['0%', '10%', '25%', '50%', '100%']

interface OptionModalProps {
  item: MenuItem
  addons: Addon[]   // ชนิดนม จาก DB
  onClose: () => void
  onAdd: (options: SelectedOptions) => void
}

export function OptionModal({ item, addons, onClose, onAdd }: OptionModalProps) {
  const [milk, setMilk]         = useState<Addon | null>(null)
  const [sweetness, setSweetness] = useState<string>('100%')
  const [packaging, setPackaging] = useState<string | null>(null)
  const [note, setNote]           = useState<string>('')

  const canAdd = packaging !== null

  function handleAdd() {
    if (!canAdd) return
    const options: SelectedOptions = {
      ความหวาน:  sweetness,
      บรรจุภัณฑ์: packaging!,
    }
    if (milk) {
      // เก็บ milk เป็น JSON เพื่อส่งให้ orderService แปลงเป็น { id, name }
      options['__milk__'] = JSON.stringify({ id: milk.id, name: milk.name })
    }
    if (note.trim()) {
      options['หมายเหตุ'] = note.trim()
    }
    onAdd(options)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end z-50" onClick={onClose}>
      <div
        className="bg-white w-full rounded-t-2xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        {/* Header */}
        <div className="px-4 pb-3 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-bold text-gray-900">{item.name}</h2>
          <p className="text-sm text-green-600 font-semibold">฿{item.price}</p>
        </div>

        {/* Scrollable options */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">

          {/* 1. ชนิดนม */}
          {addons.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-1.5">
                🥛 ชนิดนม
                <span className="text-xs text-gray-400 font-normal bg-gray-100 px-1.5 py-0.5 rounded">ไม่บังคับ</span>
                {milk && <span className="ml-auto text-xs text-green-600 font-semibold">{milk.name}</span>}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {addons.map((addon) => (
                  <button
                    key={addon.id}
                    onClick={() => setMilk((prev) => prev?.id === addon.id ? null : addon)}
                    className={`py-2.5 px-3 rounded-xl border text-sm font-semibold text-left transition-all ${
                      milk?.id === addon.id
                        ? 'border-green-500 bg-green-50 text-green-700'
                        : 'border-gray-200 bg-white text-gray-600'
                    }`}
                  >
                    {addon.name}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">แตะอีกครั้งเพื่อยกเลิก</p>
            </div>
          )}

          {/* 2. ความหวาน */}
          <div>
            <p className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-1.5">
              🍬 ความหวาน
              <span className="ml-auto text-xs text-green-600 font-semibold">{sweetness}</span>
            </p>
            <div className="flex gap-1.5">
              {SWEETNESS_LEVELS.map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setSweetness(lvl)}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                    sweetness === lvl
                      ? 'bg-green-500 text-white border-green-500'
                      : 'bg-white text-gray-600 border-gray-200'
                  }`}
                >
                  {lvl === '100%' ? (
                    <><div>{lvl}</div><div className="text-[9px] font-normal opacity-70">ปกติ</div></>
                  ) : lvl}
                </button>
              ))}
            </div>
          </div>

          {/* 3. บรรจุภัณฑ์ */}
          <div>
            <p className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-1.5">
              📦 บรรจุภัณฑ์
              <span className="text-xs text-red-400 font-semibold bg-red-50 px-1.5 py-0.5 rounded">ต้องระบุ</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 'แยกน้ำแข็ง', icon: '🧊', desc: 'น้ำแข็งแยกถุง' },
                { value: 'พร้อมดื่ม',  icon: '🧋', desc: 'ใส่แก้วพร้อมดื่ม' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPackaging((prev) => prev === opt.value ? null : opt.value)}
                  className={`py-3.5 px-3 rounded-xl border text-left transition-all ${
                    packaging === opt.value
                      ? 'border-green-500 bg-green-50'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="text-xl mb-1">{opt.icon}</div>
                  <div className={`text-sm font-bold ${packaging === opt.value ? 'text-green-700' : 'text-gray-700'}`}>
                    {opt.value}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 4. หมายเหตุ */}
          <div>
            <p className="text-sm font-semibold text-gray-800 mb-2">📝 หมายเหตุ</p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น ไม่ใส่น้ำแข็ง, เพิ่มหวาน..."
              rows={2}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-400 resize-none"
            />
          </div>

        </div>

        {/* Add button */}
        <div className="px-4 pt-2 pb-safe flex-shrink-0 border-t border-gray-100">
          {!canAdd && (
            <p className="text-xs text-center text-red-400 mb-2">กรุณาเลือกบรรจุภัณฑ์</p>
          )}
          <button
            onClick={handleAdd}
            disabled={!canAdd}
            className={`w-full py-3.5 rounded-xl text-white font-semibold text-base transition-colors ${
              canAdd ? 'bg-green-500' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            + เพิ่มลงตะกร้า
          </button>
        </div>
      </div>
    </div>
  )
}
