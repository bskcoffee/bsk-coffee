// src/pages/MenuPage.tsx
import { useState, useEffect } from 'react'
import { getCategories, getMenuItems } from '../services/menuService'
import type { MenuCategory, MenuItem, CartItem, SelectedOptions, DeliveryZone, StoreStatus } from '../types'
import { MenuItemCard } from '../components/MenuItemCard'
import { OptionModal } from '../components/OptionModal'
import { StoreClosedBanner } from '../components/StoreClosedBanner'
import { FreeShipNudge } from '../components/FreeShipNudge'

interface MenuPageProps {
  cartItems: CartItem[]
  cartTotal: number
  deliveryFee: number
  selectedZone: DeliveryZone
  distanceKm: number
  storeStatus: StoreStatus | null
  isOpen: boolean
  scheduledAt: Date | null
  onAddItem: (item: MenuItem, options: SelectedOptions) => void
  onGoToCart: () => void
  onSchedule: (date: Date) => void
}

export function MenuPage({
  cartItems, cartTotal, deliveryFee,
  selectedZone, distanceKm,
  storeStatus, isOpen, scheduledAt,
  onAddItem, onGoToCart, onSchedule,
}: MenuPageProps) {
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [cats, items] = await Promise.all([getCategories(), getMenuItems()])
        setCategories(cats)
        setMenuItems(items)
        if (cats.length > 0) setActiveCategory(cats[0].id)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filteredItems = activeCategory
    ? menuItems.filter((m) => m.category_id === activeCategory)
    : menuItems

  const cartCount = cartItems.reduce((s, ci) => s + ci.quantity, 0)

  // Zone badge config
  const zoneBadge = {
    metro: { label: '🏘️ The Metro', cls: 'bg-green-100 text-green-700' },
    tu: { label: '🎓 TU', cls: 'bg-blue-100 text-blue-700' },
    other: { label: `📍 ${distanceKm.toFixed(1)} กม.`, cls: 'bg-orange-100 text-orange-700' },
  }[selectedZone]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-green-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm px-4 pt-safe pb-3 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Cocoa House 🍫</h1>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${zoneBadge.cls}`}>
            {zoneBadge.label}
          </span>
        </div>
      </header>

      {/* Store Closed Banner */}
      {!isOpen && storeStatus && (
        <StoreClosedBanner
          status={storeStatus}
          onSchedule={onSchedule}
        />
      )}

      {/* Category Tabs */}
      <div className="bg-white border-b overflow-x-auto">
        <div className="flex gap-1 px-4 py-2">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                activeCategory === cat.id
                  ? 'bg-green-500 text-white'
                  : 'text-gray-500 bg-gray-100'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Menu Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-3">
          {filteredItems.map((item) => (
            <MenuItemCard
              key={item.id}
              item={item}
              disabled={!isOpen && !scheduledAt}
              onSelect={() => setSelectedItem(item)}
            />
          ))}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="bg-white border-t px-4 pb-safe pt-3 space-y-2">

        {/* Delivery info / nudge */}
        {selectedZone === 'other' && cartCount > 0 ? (
          <FreeShipNudge
            total={cartTotal}
            minOrder={249}
            deliveryFee={deliveryFee}
            distanceKm={distanceKm}
          />
        ) : (
          /* Metro / TU — ฟรีทันที */
          cartCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-50 border border-green-200">
              <span className="text-base">🎉</span>
   