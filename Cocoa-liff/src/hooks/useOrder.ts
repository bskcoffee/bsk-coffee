// src/hooks/useOrder.ts
import { useState, useEffect } from 'react'
import { getOrderById, subscribeToOrder } from '../services/orderService'
import type { Order } from '../types'

export function useOrder(orderId: string | null) {
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!orderId) return

    let cancelled = false

    async function fetch() {
      setLoading(true)
      try {
        const data = await getOrderById(orderId!)
        if (!cancelled) setOrder(data)
      } catch (err) {
        if (!cancelled) setError('ไม่สามารถโหลดออเดอร์ได้')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetch()

    // Realtime subscription
    const channel = subscribeToOrder(orderId, (updated) => {
      if (!cancelled) setOrder(updated)
    })

    return () => {
      cancelled = true
      channel.unsubscribe()
    }
  }, [orderId])

  return { order, loading, error }
}
