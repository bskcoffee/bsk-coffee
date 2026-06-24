// src/components/MenuItemCard.tsx
import type { MenuItem } from '../types'

interface MenuItemCardProps {
  item: MenuItem
  disabled?: boolean
  onSelect: () => void
}

export function MenuItemCard({ item, disabled, onSelect }: MenuItemCardProps) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled || !item.available}
      className={`w-full text-left bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm transition-opacity ${
        disabled || !item.available ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'
      }`}
    >
      {item.image_url ? (
        <img src={item.image_url} alt={item.name} className="w-full h-28 object-cover" />
      ) : (
        <div className="w-full h-28 bg-amber-50 flex items-center justify-center text-4xl">
          🍫
        </div>
      )}
      <div className="p-2.5">
        <p className="text-sm font-semibold text-gray-900 leading-tight">{item.name}</p>
        <p className="text-sm font-bold text-green-600 mt-1">฿{item.price}</p>
        {!item.available && (
          <p className="text-xs text-red-400 mt-0.5">หมดชั่วคราว</p>
        )}
      </div>
    </button>
  )
}
