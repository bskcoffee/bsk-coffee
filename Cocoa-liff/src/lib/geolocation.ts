// src/lib/geolocation.ts
export const STORE_LOCATION = {
  lat: 13.7217005,
  lng: 100.4457931,
  name: 'Cocoa House',
}

export const MAX_DISTANCE_KM = 3

export function getDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export type LocationStatus = 'idle' | 'loading' | 'ok' | 'outside' | 'too_far' | 'denied' | 'unavailable'

export interface LocationResult {
  status: LocationStatus
  lat?: number
  lng?: number
  distanceKm?: number
}

export function checkUserLocation(): Promise<LocationResult> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ status: 'unavailable' })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        const distanceKm = getDistanceKm(STORE_LOCATION.lat, STORE_LOCATION.lng, lat, lng)
        resolve({
          status: distanceKm <= MAX_DISTANCE_KM ? 'ok' : 'too_far',
          lat,
          lng,
          distanceKm,
        })
      },
      () => resolve({ status: 'denied' }),
      { timeout: 8000, maximumAge: 60000 }
    )
  })
}
