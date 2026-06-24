// pos-changes/GrabMapsButtons.tsx
// ปุ่มเรียก Grab + Google Maps สำหรับ POS order card — เฉพาะ zone "other"
// ใช้งาน: <GrabMapsButtons address={order.delivery_address} />

const STORE_LAT = 13.7217005
const STORE_LNG = 100.4457931
const STORE_NAME = 'Cocoa House'

interface OtherAddress {
  zone: 'other'
  lat: number
  lng: number
  distance_km: number
  phone: string
  note?: string
}

interface GrabMapsButtonsProps {
  address: OtherAddress
}

export function GrabMapsButtons({ address }: GrabMapsButtonsProps) {
  const { lat, lng, phone, note } = address

  const dropAdd = note
    ? encodeURIComponent(note)
    : encodeURIComponent(`ลูกค้า ${phone}`)

  // Grab deep link — เปิดแอป Grab พร้อม pickup + dropoff
  const grabUrl =
    `grab://open?screenType=BOOKING` +
    `&pickLat=${STORE_LAT}&pickLng=${STORE_LNG}&pickAdd=${encodeURIComponent(STORE_NAME)}` +
    `&dropLat=${lat}&dropLng=${lng}&dropAdd=${dropAdd}`

  // Google Maps directions
  const mapsUrl =
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${STORE_LAT},${STORE_LNG}` +
    `&destination=${lat},${lng}` +
    `&travelmode=driving`

  function openGrab() {
    // ลอง deep link ก่อน — ถ้าไม่มีแอปจะ fallback ไปหน้าเว็บ Grab
    window.location.href = grabUrl
  }

  function openMaps() {
    window.open(mapsUrl, '_blank')
  }

  return (
    <div className="flex gap-2 mt-2">
      <button
        onClick={openGrab}
        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#00B14F] text-white text-xs font-semibold"
        title={`Grab: ${lat.toFixed(4)}, ${lng.toFixed(4)}`}
      >
        🚗 เรียก Grab
      </button>
      <button
        onClick={openMaps}
        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#4285F4] text-white text-xs font-semibold"
        title={`Maps: ${lat.toFixed(4)}, ${lng.toFixed(4)}`}
      >
        🗺️ Google Maps
      </button>
    </div>
  )
}

// ──────────────────────────────────────────────────────────
// วิธีใช้ใน POS order card (React):
//
// import { GrabMapsButtons } from '../pos-changes/GrabMapsButtons'
//
// {order.delivery_zone === 'other' && order.delivery_address?.zone === 'other' && (
//   <GrabMapsButtons address={order.delivery_address} />
// )}
// ──────────────────────────────────────────────────────────
