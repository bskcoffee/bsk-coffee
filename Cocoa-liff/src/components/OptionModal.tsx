// src/components/OptionModal.tsx
import { useState } from 'react'
import type { MenuItem, SelectedOptions } from '../types'

interface OptionModalProps {
  item: MenuItem
  onClose: () => void
  onAdd: (options: SelectedOptions) => void
}

export function OptionModal({ item, onClose, onAdd }: OptionModalProps) {
  const initialOptions: SelectedOptions = {}
  item.options.forEach((opt) => {
    if (opt.default) initialOptions[opt.label] = opt.default
    else if (opt.choices.length > 0) initialOptions[opt.label] = opt.choices[0]
  })

  const [selected, setSelected] = useState<SelectedOptions>(initialOptions)

  function handleAdd() {
    // ตรวจว่า required options ครบ
    const allFilled = item.options.every(
      (opt) => !opt.required || selected[opt.label]
    )
    if (!allFilled) return
    onAdd(selected)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end z-50" onClick={onClose}>
      <div
        className="bg-white w-full rounded-t-2xl max-h-[80vh] overflow-y-auto pb-safe"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        {/* Item header */}
        <div className="px-4 pb-3 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">{item.name}</h2>
          <p className="text-sm text-green-600 font-semibold">฿{item.price}</p>
        </div>

        {/* Options */}
        <div className="px-4 py-3 space-y-4">
          {item.options.map((opt) => (
            <div key={opt.label}>
              <p className="text-sm font-semibold text-gray-800 mb-2">
                {opt.label}
                {opt.required && <span className="text-red-400 ml-1">*</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                {opt.choices.map((choice) => (
                  <button
                    key={choice}
                    onClick={() => setSelected((prev) => ({ ...prev, [opt.label]: choice }))}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      selected[opt.label] === choice
                        ? 'bg-green-500 text-white border-green-500'
                        : 'bg-white text-gray-600 border-gray-200'
                    }`}
                  >
                    {choice}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Add button */}
        <div className="px-4 pt-2 pb-4">
          <button
            onClick={handleAdd}
            className="w-full py-3.5 rounded-xl bg-green-500 text-white font-semibold text-base"
          >
            + เพิ่มลงตะกร้า
          </button>
        </div>
      </div>
    </div>
  )
}
