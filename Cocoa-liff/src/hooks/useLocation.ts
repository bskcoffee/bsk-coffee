// src/hooks/useLocation.ts
import { useState, useCallback } from 'react'
import { checkUserLocation, type LocationResult } from '../lib/geolocation'

export function useLocation() {
  const [location, setLocation] = useState<LocationResult>({ status: 'loading' })

  const check = useCallback(async () => {
    setLocation({ status: 'loading' })
    const result = await checkUserLocation()
    setLocation(result)
    return result
  }, [])

  const retry = useCallback(() => check(), [check])

  return { location, check, retry }
}
