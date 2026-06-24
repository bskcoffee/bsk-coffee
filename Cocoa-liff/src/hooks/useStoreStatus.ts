// src/hooks/useStoreStatus.ts
import { useState, useEffect } from 'react'
import { getStoreStatus } from '../services/settingsService'
import type { StoreStatus } from '../types'

export function useStoreStatus() {
  const [storeStatus, setStoreStatus] = useState<StoreStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function fetch() {
      try {
        const status = await getStoreStatus()
        if (!cancelled) setStoreStatus(status)
      } catch (err) {
        console.error('Failed to fetch store status:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetch()
    // refresh ทุก 5 นาที
    const interval = setInterval(fetch, 5 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const isOpen =
    storeStatus?.status === 'open' || storeStatus?.status === 'manual_open'

  return { storeStatus, isOpen, loading }
}
