import { useState, useEffect, useRef } from 'react'
import { X, ChevronRight, ChevronUp, ChevronDown, Minus, Plus, GripVertical } from 'lucide-react'

const fmt = (n) =>
  n === 0 ? 'ฟรี'
    : new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 0 }).format(n)

const RequiredBadge = () => (
  <span className="text-[10px] text-red-400 font-semibold bg-red-50 px-1.5 py-0.5 rounded">ต้องระบุ</span>
)

// Convert initial.optionGroups ([{groupId, choices:[{id, qty, ...}]}]) → { [groupId]: { [choiceId]: qty } }
const initGroupSelections = (initial) => {
  if (!initial?.optionGroups) return {}
  return Object.fromEntries(
    initial.optionGroups.map(g => [
      g.groupId,
      Object.fromEntries((g.choices ?? []).map(c => [c.id, c.qty ?? 1])),
    ])
  )
}

// กลุ่มตัวเลือกเสริม (เช่น "ชนิดนม", "Refill") มาจากหน้าจัดการเมนู → จัดการตัวเลือกเสริม
// ผูกกับหมวดหมู่เมนู ไม่ได้ hardcode ไว้ในโค้ดอีกต่อไป — ผู้ดูแลระบบสร้าง/แก้ไขเองได้ทั้งหมด
export default function MenuOptionModal({ menu, platform, optionGroups = [], initial, onConfirm, onClose, confirmLabel, onMoveGroup, onReorderGroup }) {
  const basePrice = menu?.prices?.[platform] ?? 0

  const [note,       setNote]       = useState(initial?.note       ?? '')
  const [groupSelections, setGroupSelections] = useState(() => initGroupSelections(initial))
  const dragGroupId = useRef(null)

  useEffect(() => {
    if (!initial) {
      setNote(''); setGroupSelections({})
    } else {
      setNote(initial.note ?? '')
      setGroupSelections(initGroupSelections(initial))
    }
  }, [menu?.id])

  const choicePrice = (choice) => choice.prices?.[platform] ?? choice.price ?? 0

  const groupTotal = (group) => {
    const sel = groupSelections[group.id] ?? {}
    return Object.entries(sel).reduce((sum, [cid, qty]) => {
      const choice = group.choices.find(c => c.id === cid)
      return sum + (choice ? choicePrice(choice) * qty : 0)
    }, 0)
  }
  const groupsTotal = optionGroups.reduce((sum, g) => sum + groupTotal(g), 0)
  const totalExtra  = groupsTotal
  const totalPrice  = basePrice + totalExtra

  const groupQtyTotal = (group) => Object.values(groupSelections[group.id] ?? {}).reduce((s, q) => s + q, 0)

  const canConfirm = optionGroups.every(g => !g.required || groupQtyTotal(g) > 0)

  // single = เลือกได้ 1 (แตะซ้ำเพื่อยกเลิก), multi = ปรับจำนวนต่อชิ้นได้ (+/-) จนถึง max_select (รวมทุกตัวเลือก)
  const selectSingle = (group, choiceId) => {
    setGroupSelections(prev => {
      const current = prev[group.id] ?? {}
      if (current[choiceId]) {
        const { [choiceId]: _, ...rest } = current
        return { ...prev, [group.id]: rest }
      }
      return { ...prev, [group.id]: { [choiceId]: 1 } }
    })
  }

  const adjustQty = (group, choiceId, delta) => {
    setGroupSelections(prev => {
      const current = prev[group.id] ?? {}
      const currentQty = current[choiceId] ?? 0
      const totalQty    = groupQtyTotal(group)
      if (delta > 0 && group.max_select && totalQty >= group.max_select) return prev
      const nextQty = currentQty + delta
      if (nextQty <= 0) {
        const { [choiceId]: _, ...rest } = current
        return { ...prev, [group.id]: rest }
      }
      return { ...prev, [group.id]: { ...current, [choiceId]: nextQty } }
    })
  }

  const handleConfirm = () => {
    if (!canConfirm) return
    const selectedGroups = optionGroups
      .map(g => ({
        groupId:       g.id,
        groupName:     g.name,
        selectionType: g.selection_type,
        choices:   Object.entries(groupSelections[g.id] ?? {})
          .map(([cid, qty]) => {
            const c = g.choices.find(c => c.id === cid)
            return c ? { id: c.id, label: c.label, price: choicePrice(c), qty } : null
          })
          .filter(Boolean),
      }))
      .filter(g => g.choices.length > 0)
    onConfirm({
      note,
      optionGroups: selectedGroups.length > 0 ? selectedGroups : null,
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

          {/* ── กลุ่มตัวเลือกเสริม (สร้าง/ผูกหมวดหมู่จากหน้าจัดการเมนู) ── */}
          {/* ความหวาน/บรรจุภัณฑ์ ไม่ hardcode ในนี้อีกต่อไป — มาจากกลุ่มตัวเลือกเสริม
              เหมือนกลุ่มอื่นๆ (ดู sweetness_packaging_optiongroups_migration.sql) */}
          {optionGroups.map((group, idx) => {
            const sel      = groupSelections[group.id] ?? {}
            const qtyTotal = groupQtyTotal(group)
            const total    = groupTotal(group)
            return (
              <section
                key={group.id}
                draggable={!!onReorderGroup}
                onDragStart={() => { dragGroupId.current = group.id }}
                onDragOver={(e) => { if (onReorderGroup) e.preventDefault() }}
                onDrop={() => {
                  if (onReorderGroup && dragGroupId.current && dragGroupId.current !== group.id) {
                    onReorderGroup(dragGroupId.current, group.id)
                  }
                  dragGroupId.current = null
                }}
              >
                <div className="flex items-center gap-1.5 mb-3">
                  {onMoveGroup && (
                    <>
                      <GripVertical size={14} className="text-gray-300 shrink-0 cursor-grab active:cursor-grabbing" aria-hidden="true" />
                      {/* ปุ่มลูกศร — ใช้แตะเรียงลำดับได้บนแท็บเล็ต (drag บางเครื่องแตะไม่ติด) */}
                      <div className="flex flex-col shrink-0 -my-1">
                        <button
                          type="button"
                          draggable={false}
                          onClick={() => onMoveGroup(group.id, -1)}
                          disabled={idx === 0}
                          aria-label={`ย้าย ${group.name} ขึ้น`}
                          className="p-0.5 rounded text-gray-400 active:bg-gray-100 disabled:opacity-20 disabled:pointer-events-none"
                        >
                          <ChevronUp size={12} />
                        </button>
                        <button
                          type="button"
                          draggable={false}
                          onClick={() => onMoveGroup(group.id, 1)}
                          disabled={idx === optionGroups.length - 1}
                          aria-label={`ย้าย ${group.name} ลง`}
                          className="p-0.5 rounded text-gray-400 active:bg-gray-100 disabled:opacity-20 disabled:pointer-events-none"
                        >
                          <ChevronDown size={12} />
                        </button>
                      </div>
                    </>
                  )}
                  <p className="text-sm font-bold text-gray-700 flex items-center gap-2 flex-wrap flex-1 min-w-0">
                    {group.name}
                    {group.required
                      ? <RequiredBadge />
                      : <span className="text-[10px] text-gray-400 font-normal bg-gray-100 px-1.5 py-0.5 rounded">ไม่บังคับ</span>}
                    <span className="text-[10px] text-gray-400 font-normal">
                      {group.selection_type === 'single' ? 'เลือกได้ 1' : `เลือกได้สูงสุด ${group.max_select ?? 'ไม่จำกัด'}`}
                    </span>
                    {total > 0 && <span className="ml-auto text-xs text-cocoa-600 font-semibold">+{fmt(total)}</span>}
                  </p>
                </div>
                {group.choices.length === 0 ? (
                  <p className="text-sm text-gray-400 bg-gray-50 rounded-xl px-4 py-3">ยังไม่มีตัวเลือกในกลุ่มนี้</p>
                ) : group.selection_type === 'single' ? (
                  <div className="grid grid-cols-2 gap-2">
                    {group.choices.map(choice => {
                      const isSelected = !!sel[choice.id]
                      const price = choicePrice(choice)
                      return (
                        <button
                          key={choice.id}
                          type="button"
                          onClick={() => selectSingle(group, choice.id)}
                          className={`py-3 px-4 rounded-xl border-2 text-sm font-semibold text-left transition-all active:scale-95
                            ${isSelected ? 'border-cocoa-500 bg-cocoa-50 text-cocoa-700' : 'border-gray-200 bg-white text-gray-600'}`}
                        >
                          <div className="font-bold">{choice.label}</div>
                          <div className="text-xs opacity-60 mt-0.5">{price > 0 ? `+${fmt(price)}` : 'ฟรี'}</div>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {group.choices.map(choice => {
                      const qty      = sel[choice.id] ?? 0
                      const price    = choicePrice(choice)
                      const atMax    = !!(group.max_select && qtyTotal >= group.max_select)
                      return (
                        <div key={choice.id} className={`flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all
                          ${qty > 0 ? 'border-cocoa-400 bg-cocoa-50' : 'border-gray-200 bg-white'}`}>
                          <div>
                            <p className={`text-sm font-bold ${qty > 0 ? 'text-cocoa-700' : 'text-gray-700'}`}>{choice.label}</p>
                            <p className="text-xs text-gray-400">{price > 0 ? `+${fmt(price)} / ชิ้น` : 'ฟรี'}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => adjustQty(group, choice.id, -1)}
                              disabled={qty === 0}
                              className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center disabled:opacity-20 active:bg-gray-100"
                            >
                              <Minus size={13} />
                            </button>
                            <span className={`w-6 text-center text-sm font-bold ${qty > 0 ? 'text-cocoa-700' : 'text-gray-300'}`}>
                              {qty || '·'}
                            </span>
                            <button
                              onClick={() => adjustQty(group, choice.id, 1)}
                              disabled={atMax && qty === 0}
                              className="w-8 h-8 rounded-lg bg-cocoa-700 flex items-center justify-center active:bg-cocoa-900 disabled:opacity-30"
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
            )
          })}

          {/* ── หมายเหตุ ────────────────────────────────── */}
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
              กรุณาเลือกตัวเลือกที่จำเป็นให้ครบ
            </p>
          )}
          {totalExtra > 0 && (
            <div className="flex justify-between text-sm mb-2 text-gray-500">
              <span>ราคาเมนู + ตัวเลือกเสริม</span>
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
