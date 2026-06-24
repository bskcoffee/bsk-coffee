import { useState, useEffect } from 'react'
import { X, ChevronRight, Minus, Plus } from 'lucide-react'

const SWEETNESS_LEVELS = [
  { label: '0%',   value: 0   },
  { label: '10%',  value: 10  },
  { label: '25%',  value: 25  },
  { label: '50%',  value: 50  },
  { label: '100%', sublabel: 'ปกติ', value: 100 },
]

const PACKAGING_OPTIONS = [
  { value: 'แยกน้ำแข็ง', icon: '🧊', desc: 'น้ำแข็งแยกถุง' },
  { value: 'พร้อมดื่ม',  icon: '🧋', desc: 'ใส่แก้วพร้อมดื่ม' },
]

const fmt = (n) =>
  n === 0 ? 'ฟรี'
    : new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 0 }).format(n)

const RequiredBadge = () => (
  <span className="text-[10px] text-red-400 font-semibold bg-red-50 px-1.5 py-0.5 rounded">ต้องระบุ</span>
)

// Convert initial.refill (old single obj or new array) → { [id]: qty }
const initRefillQtys = (initial) => {
  if (!initial?.refill) return {}
  if (Array.isArray(initial.refill)) return Object.fromEntries(initial.refill.map(r => [r.id, r.qty ?? 1]))
  return { [initial.refill.id]: 1 }
}

export default function MenuOptionModal({ menu, platform, addons, refills, initial, onConfirm, onClose, confirmLabel }) {
  const basePrice = menu?.prices?.[platform] ?? 0

  const [milk,       setMilk]       = useState(initial?.milk      ?? null)
  const [sweetness,  setSweetness]  = useState(initial?.sweetness  ?? 100)
  const [refillQtys, setRefillQtys] = useState(() => initRefillQtys(initial))
  const [packaging,  setPackaging]  = useState(initial?.packaging  ?? null)
  const [note,       setNote]       = useState(initial?.note       ?? '')

  useEffect(() => {
    if (!initial) {
      setMilk(null); setSweetness(100); setRefillQtys({}); setPackaging(null); setNote('')
    } else {
      setMilk(initial.milk ?? null)
      setSweetness(initial.sweetness ?? 100)
      setRefillQtys(initRefillQtys(initial))
      setPackaging(initial.packaging ?? null)
      setNote(initial.note ?? '')
    }
  }, [menu?.id])

  const refillTotal = refills.reduce((sum, r) => sum + (r.price ?? 0) * (refillQtys[r.id] ?? 0), 0)
  const totalExtra  = (milk?.price ?? 0) + refillTotal
  const totalPrice  = basePrice + totalExtra

  const canConfirm = packaging !== null

  const handleConfirm = () => {
    if (!canConfirm) return
    const selectedRefills = refills
      .filter(r => (refillQtys[r.id] ?? 0) > 0)
      .map(r => ({ id: r.id, name: r.name, price: r.price, prices: r.prices, qty: refillQtys[r.id] }))
    onConfirm({
      milk,
      sweetness,
      refill: selectedRefills.length > 0 ? selectedRefills : null,
      note,
      packaging,
    })
  }

  if (!menu) return null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end z-50" onClick={onClose}>
      <div className="bg-white rounded-t-3xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>

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

          {/* ── 1. ชนิดนม (ต้องระบุ) ──────────────────────── */}
          <section>
            <p className="text-sm font-medium text-gray-500 mb-3 flex items-center gap-2">
              🥛 ชนิดนม
              <span className="text-[10px] text-gray-400 font-normal bg-gray-100 px-1.5 py-0.5 rounded">ไม่บังคับ</span>
              {milk && <span className="ml-auto text-xs text-cocoa-600 font-semibold">{milk.name}</span>}
            </p>
            {addons.length === 0 ? (
              <p className="text-sm text-gray-400 bg-gray-50 rounded-xl px-4 py-3">ยังไม่มีข้อมูล Addon</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {addons.map(addon => (
                    <button
                      key={addon.id}
                      onClick={() => setMilk(prev => prev?.id === addon.id ? null : { id: addon.id, name: addon.name, price: addon.price, prices: addon.prices })}
                      className={`py-3 px-4 rounded-xl border-2 text-sm font-semibold text-left transition-all active:scale-95
                        ${milk?.id === addon.id ? 'border-cocoa-500 bg-cocoa-50 text-cocoa-700' : 'border-gray-200 bg-white text-gray-600'}`}
                    >
                      <div className="font-bold">{addon.name}</div>
                      <div className="text-xs opacity-60 mt-0.5">{addon.price > 0 ? `+${fmt(addon.price)}` : 'ฟรี'}</div>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">แตะอีกครั้งเพื่อยกเลิกการเลือก</p>
              </>
            )}
          </section>

          {/* ── 2. ความหวาน (ต้องระบุ) ────────────────────── */}
          <section>
            <p className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
              🍬 ความหวาน
              <span className="ml-auto text-cocoa-600 font-bold">{sweetness}%</span>
            </p>
            <div className="flex gap-2">
              {SWEETNESS_LEVELS.map(lvl => (
                <button
                  key={lvl.value}
                  onClick={() => setSweetness(lvl.value)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 border-2 flex flex-col items-center
                    ${sweetness === lvl.value ? 'bg-cocoa-700 text-white border-cocoa-700' : 'bg-white text-gray-600 border-gray-200'}`}
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

          {/* ── 3. Refill (ไม่บังคับ) — หลายรายการ + จำนวน ─ */}
          <section>
            <p className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
              🔄 Refill
              <span className="text-[10px] text-gray-400 font-normal bg-gray-100 px-1.5 py-0.5 rounded">ไม่บังคับ</span>
              {refillTotal > 0 && <span className="ml-auto text-xs text-cocoa-600 font-semibold">+{fmt(refillTotal)}</span>}
            </p>
            {refills.length === 0 ? (
              <p className="text-sm text-gray-400 bg-gray-50 rounded-xl px-4 py-3">ยังไม่มีข้อมูล Refill</p>
            ) : (
              <div className="space-y-2">
                {refills.map(r => {
                  const qty = refillQtys[r.id] ?? 0
                  return (
                    <div key={r.id} className={`flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all
                      ${qty > 0 ? 'border-cocoa-400 bg-cocoa-50' : 'border-gray-200 bg-white'}`}>
                      <div>
                        <p className={`text-sm font-bold ${qty > 0 ? 'text-cocoa-700' : 'text-gray-700'}`}>{r.name}</p>
                        <p className="text-xs text-gray-400">{r.price > 0 ? `+${fmt(r.price)} / ชิ้น` : 'ฟรี'}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setRefillQtys(prev => {
                            const next = (prev[r.id] ?? 0) - 1
                            if (next <= 0) { const { [r.id]: _, ...rest } = prev; return rest }
                            return { ...prev, [r.id]: next }
                          })}
                          disabled={qty === 0}
                          className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center disabled:opacity-20 active:bg-gray-100"
                        >
                          <Minus size={13} />
                        </button>
                        <span className={`w-6 text-center text-sm font-bold ${qty > 0 ? 'text-cocoa-700' : 'text-gray-300'}`}>
                          {qty || '·'}
                        </span>
                        <button
                          onClick={() => setRefillQtys(prev => ({ ...prev, [r.id]: (prev[r.id] ?? 0) + 1 }))}
                          className="w-8 h-8 rounded-lg bg-cocoa-700 flex items-center justify-center active:bg-cocoa-900"
                        >
                          <Plus size={13} className="text-white" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* ── 4. บรรจุภัณฑ์ (ต้องระบุ) ──────────────────── */}
          <section>
            <p className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
              📦 บรรจุภัณฑ์ <RequiredBadge />
            </p>
            <div className="grid grid-cols-2 gap-3">
              {PACKAGING_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setPackaging(prev => prev === opt.value ? null : opt.value)}
                  className={`py-4 px-4 rounded-xl border-2 text-left transition-all active:scale-95
                    ${packaging === opt.value ? 'border-cocoa-500 bg-cocoa-50' : 'border-gray-200 bg-white'}`}
                >
                  <div className="text-2xl mb-1">{opt.icon}</div>
                  <div className={`text-sm font-bold ${packaging === opt.value ? 'text-cocoa-700' : 'text-gray-700'}`}>{opt.value}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </section>

          {/* ── 5. หมายเหตุ ────────────────────────────────── */}
          <section>
            <p className="text-sm font-bold text-gray-700 mb-3">📝 หมายเหตุ</p>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="เช่น ไม่ใส่น้ำแข็ง, เพิ่มหวาน..."
              rows={2}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:outline-none focus:border-cocoa-400 resize-none"
            />
          </section>

          <div className="h-4" />
        </div>

        {/* ── Confirm Button ──────────────────────────────── */}
        <div className="px-5 pt-3 pb-6 border-t border-gray-100 shrink-0">
          {!canConfirm && (
            <p className="text-xs text-red-400 text-center mb-2">
              กรุณาเลือกบรรจุภัณฑ์
            </p>
          )}
          {totalExtra > 0 && (
            <div className="flex justify-between text-sm mb-2 text-gray-500">
              <span>ราคาเมนู + Addon/Refill</span>
              <span className="font-semibold text-cocoa-700">{fmt(totalPrice)} / ชิ้น</span>
            </div>
          )}
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={`w-full py-4 text-base font-bold rounded-xl flex items-center justify-between px-5 transition-all
              ${canConfirm ? 'bg-cocoa-700 text-white active:bg-cocoa-900' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
          >
            <span>{confirmLabel ?? 'เพิ่มลงออเดอร์'}</span>
            <div className="flex items-center gap-1">
              {totalExtra > 0 && <span className="text-sm opacity-80">+{fmt(totalExtra)}</span>}
              <ChevronRight size={20} />
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
