// src/hooks/useCart.ts
import { useState, useCallback } from 'react'
import type { CartItem, MenuItem, SelectedOptions } from '../types'

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([])

  const addItem = useCallback((menuItem: MenuItem, selectedOptions: SelectedOptions) => {
    setItems((prev) => {
      // ถ้า item เดิม + options เดิมมีอยู่แล้ว → เพิ่ม quantity
      const existing = prev.find(
        (ci) =>
          ci.menuItem.id === menuItem.id &&
          JSON.stringify(ci.selectedOptions) === JSON.stringify(selectedOptions)
      )
      if (existing) {
        return prev.map((ci) =>
          ci.id === existing.id
            ? { ...ci, quantity: ci.quantity + 1, subtotal: (ci.quantity + 1) * menuItem.price }
            : ci
        )
      }
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          menuItem,
          quantity: 1,
          selectedOptions,
          subtotal: menuItem.price,
        },
      ]
    })
  }, [])

  const updateQuantity = useCallback((cartItemId: string, quantity: number) => {
    if (quantity <= 0) {
      setItems((prev) => prev.filter((ci) => ci.id !== cartItemId))
      return
    }
    setItems((prev) =>
      prev.map((ci) =>
        ci.id === cartItemId
          ? { ...ci, quantity, subtotal: quantity * ci.menuItem.price }
          : ci
      )
    )
  }, [])

  const clearCart = useCallback(() => setItems([]), [])

  const total = items.reduce((sum, ci) => sum + ci.subtotal, 0)
  const itemCount = items.reduce((sum, ci) => sum + ci.quantity, 0)

  return { items, total, itemCount, addItem, updateQuantity, clearCart }
}
