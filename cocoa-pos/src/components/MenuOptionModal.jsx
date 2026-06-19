import { useState, useEffect } from 'react'
import { X, ChevronRight, Minus, Plus } from 'lucide-react'

const SWEETNESS_LEVELS = [
  { label: '0%',   value: 0   },
  { label: '10%',  value: 10  },
  { label: '25%',  value: 25  },
  { label: '50%',  value: 50  },
  { label: '100%', sublabel: 'ปกติ', value: 100 },
]

const fmt = (n) =>
  n === 0 ? 'ฟรี'
    : new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 0 }).format(n)

/**
 * MenuOptionModal
 * Props:
 *  menu        – { id, name, prices }
 *  platform    – string
 *  addons      – [ { id, name, price } ]  (milk options)
 *  refills     – [ { id, name, price } ]
 *  initial     – { milk, sweetness, refill, note } | null
 *  onConfirm   – (options) => void
 *  onClose     – () => void
 */
export default function MenuOptionModal({ menu, platform, addons, refills, initial, onConfirm, onClose, confirmLabel }) {
  const basePrice = menu?.prices?.[platform] ?? 0

  const [milk,      setMilk]      = useState(initial?.milk      ?? null)    // { id, name, price }
  const [sweetness, setSweetness] = useState(initial?.sweetness  ?? 100)
  const [refill,    setRefill]    = useState(initial?.refill     ?? null)    // { id, name, price }
  const [note,      setNote]      = useState(initial?.note       ?? '')

  // Reset when menu changes
  useEffect(() => {
    if (!initial) {
      setMilk(null)
      setSweetness(100)
      setRefill(null)
      setNote('')
    } else {
      setMilk(initial.milk ?? null)
      setSweetness(initial.sweetness ?? 100)
      setRefill(initial.refill ?? null)
      setNote(initial.note ?? '')
    }
  }, [menu?.id])

  const totalExtra = (milk?.price ?? 0) + (refill?.price ?? 0)
  const totalPrice = basePrice + totalExtra

  const handleConfirm = () => {
    onConfirm({ milk, sweetness, refill, note })
  }

  if (!menu) return null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end z-50" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl w-full max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{menu.name}</h2>
            <p className="text-sm text-cocoa-600 font-semibold">{fmt(basePrice)}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl bg-gray-100 active:bg-gray-200">
            <X size={20} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

          {/* ── 1. Milk ────────────────────────────────────── */}
          <section>
            <p className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-1.5">
              🥛 ชนิดนม
            </p>
            {addons.length === 0 ? (
              <p className="text-sm text-gray-400 bg-gray-50 rounded-xl px-4 py-3">
                ยังไม่มีข้อมูล Addon — เพิ่มได้ใน Supabase → addons table
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {addons.map(addon => (
                  <button
                    key={addon.id}
                    onClick={() => setMilk(prev => prev?.id === addon.id ? null : { id: addon.id, name: addon.name, price: addon.price })}
                    className={`py-3 px-4 rounded-xl border-2 text-sm font-semibold text-left transition-all active:scale-95
                      ${milk?.id === addon.id
                        ? 'border-cocoa-500 bg-cocoa-50 text-cocoa-700'
                        : 'border-gray-200 bg-white text-gray-600'
                      }`}
                  >
                    <div className="font-bold">{addon.name}</div>
                    <div className="text-xs opacity-60 mt-0.5">
                      {addon.price > 0 ? `+${fmt(addon.price)}` : 'ฟรี'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* ── 2. Sweetness ──────────────────────────────── */}
          <section>
            <p className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-1.5">
              🍬 ความหวาน
              <span className="ml-auto text-cocoa-600 font-bold">{sweetness}%</span>
            </p>
            <div className="flex gap-2">
              {SWEETNESS_LEVELS.map(lvl => (
                <button
                  key={lvl.value}
                  onClick={() => setSweetness(lvl.value)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 border-2 flex flex-col items-center
                    ${sweetness === lvl.value
                      ? 'bg-cocoa-700 text-white border-cocoa-700'
                      : 'bg-white text-gray-600 border-gray-200'
                    }`}
                >
                  <span>{lvl.label}</span>
                  {lvl.sublabel && (
                    <span className={`text-[10px] font-medium mt-0.5 ${sweetness === lvl.value ? 'text-cocoa-200' : 'text-gray-400'}`}>
                      {lvl.sublabel}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* ── 3. Refill ─────────────────────────────────── */}
          <section>
            <p className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-1.5">
              🔄 Refill
            </p>
            {refills.length === 0 ? (
              <p className="text-sm text-gray-400 bg-gray-50 rounded-xl px-4 py-3">
                ยังไม่มีข้อมูล Refill — เพิ่มได้ใน Supabase → refills table
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {refills.map(r => (
                  <button
                    key={r.id}
                    onClick={() => setRefill(prev => prev?.id === r.id ? null : { id: r.id, name: r.name, price: r.price })}
                    className={`py-3 px-4 rounded-xl border-2 text-sm font-semibold text-left transition-all active:scale-95
                      ${refill?.id === r.id
                        ? 'border-cocoa-500 bg-cocoa-50 text-cocoa-700'
                        : 'border-gray-200 bg-white text-gray-600'
                      }`}
                  >
                    <div className="font-bold">{r.name}</div>
                    <div className="text-xs opacity-60 mt-0.5">
                      {r.price > 0 ? `+${fmt(r.price)}` : 'ฟรี'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* ── 4. Note ───────────────────────────────────── */}
          <section>
            <p className="text-sm font-bold text-gray-700 mb-3">📝 หมายเหตุ</p>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="เช่น ไม่ใส่น้ำแข็ง, เพิ่มหวาน..."
              rows={2}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm
                         focus:outline-none focus:border-cocoa-400 resize-none"
            />
          </section>

          {/* Spacer so confirm button doesn't overlap */}
          <div className="h-4" />
        </div>

        {/* ── Confirm Button ─────────────────────────────── */}
        <div className="px-5 pt-3 pb-6 border-t border-gray-100 shrink-0">
          {totalExtra > 0 && (
            <div className="flex justify-between text-sm mb-2 text-gray-500">
              <span>ราคาเมนู + Addon/Refill</span>
              <span className="font-semibold text-cocoa-700">{fmt(totalPrice)} / ชิ้น</span>
            </div>
          )}
          <button
            onClick={handleConfirm}
            className="btn-primary w-full py-4 text-base flex items-center justify-between px-5"
          >
            <span>{confirmLabel ?? 'เพิ่มลงออเดอร์'}</span>
            <div className="flex items-center gap-1">
              {totalExtra > 0 && (
                <span className="text-sm opacity-80">+{fmt(totalExtra)}</span>
              )}
              <ChevronRight size={20} />
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
