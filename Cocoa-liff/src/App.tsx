// src/App.tsx
import { useState, useEffect } from 'react'
import { initLiff } from './lib/liff'
import { useCart } from './hooks/useCart'
import { useStoreStatus } from './hooks/useStoreStatus'
import { useLocation } from './hooks/useLocation'
import { createOrder, getOrderById } from './services/orderService'
import { getLiffConfig, type LiffConfig } from './services/configService'
import { calcDeliveryFee } from './types'
import type { DeliveryAddress, PaymentMethod, Order } from './types'

const ORDER_KEY = 'cocoa_last_order_id'
const DONE_STATUSES = new Set(['completed', 'cancelled'])

import type { ZoneSelection } from './pages/ZonePage'
import { MenuPage } from './pages/MenuPage'
import { CartPage } from './pages/CartPage'
import { DeliveryPage } from './pages/DeliveryPage'
import { PaymentPage } from './pages/PaymentPage'
import { ConfirmationPage } from './pages/ConfirmationPage'
import { StatusPage } from './pages/StatusPage'

type AppScreen = 'loading' | 'menu' | 'cart' | 'delivery' | 'payment' | 'confirmation' | 'status'

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('loading')
  const [lineUserId, setLineUserId] = useState('')
  const [lineDisplayName, setLineDisplayName] = useState('')

  // GPS (ทำงานเบื้องหลัง)
  const { location, check: checkLocation } = useLocation()
  const [zoneSelection, setZoneSelection] = useState<ZoneSelection | null>(null)

  const [liffConfig, setLiffConfig] = useState<LiffConfig | null>(null)
  const [deliveryAddress, setDeliveryAddress] = useState<DeliveryAddress | null>(null)
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [order, setOrder] = useState<Order | null>(null)

  const { items, total, addItem, updateQuantity, clearCart } = useCart()
  const { storeStatus, isOpen } = useStoreStatus()

  // delivery fee — คำนวณจาก config + ยอดรวม
  const freeMin = liffConfig?.free_delivery_min ?? 249
  const feePerKm = liffConfig?.delivery_fee_per_km ?? 15
  const deliveryFee: number = (() => {
    if (!zoneSelection || zoneSelection.zone !== 'other') return 0
    if (total >= freeMin) return 0
    return Math.max(20, Math.round((zoneSelection.distanceKm * feePerKm) / 5) * 5)
  })()

  // Auto-set zoneSelection เมื่อ GPS สำเร็จ
  useEffect(() => {
    if (location.status === 'ok' && location.distanceKm !== undefined) {
      setZoneSelection({
        zone: 'other',
        distanceKm: location.distanceKm,
        lat: location.lat,
        lng: location.lng,
      })
    }
  }, [location])

  // Init LIFF + config พร้อมกัน
  // ถ้ามี order ค้างอยู่ใน localStorage → โชว์ StatusPage ทันที
  useEffect(() => {
    Promise.all([initLiff(), getLiffConfig()])
      .then(async ([{ userId, displayName }, config]) => {
        setLineUserId(userId)
        setLineDisplayName(displayName)
        setLiffConfig(config)
        checkLocation()

        // ตรวจ localStorage ว่ามี order ที่ยังไม่จบไหม
        const savedId = localStorage.getItem(ORDER_KEY)
        if (savedId) {
          try {
            const savedOrder = await getOrderById(savedId)
            if (!DONE_STATUSES.has(savedOrder.order_status)) {
              // order ยังอยู่ระหว่างดำเนินการ → ไปที่ status โดยตรง
              setOrder(savedOrder)
              setScreen('status')
              return
            }
            // จบแล้ว → ลบทิ้ง
            localStorage.removeItem(ORDER_KEY)
          } catch {
            localStorage.removeItem(ORDER_KEY)
          }
        }
        setScreen('menu')
      })
      .catch((err) => {
        console.error(err)
        setScreen('menu')
      })
  }, [])

  async function handlePlaceOrder(method: PaymentMethod) {
    if (!deliveryAddress) return
    setSubmitting(true)
    try {
      const newOrder = await createOrder({
        lineUserId,
        customerName: lineDisplayName,
        cartItems: items,
        deliveryAddress,
        paymentMethod: method,
        subtotal: total,
        deliveryFee,
        total: total + deliveryFee,
        scheduledAt: scheduledAt?.toISOString(),
      })
      setOrder(newOrder)
      clearCart()
      // จำ orderId ไว้ใน localStorage เผื่อลูกค้าปิด LIFF แล้วกลับมา
      localStorage.setItem(ORDER_KEY, newOrder.id)
      setScreen('confirmation')
    } catch (err) {
      console.error('Order failed:', err)
      alert('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง')
    } finally {
      setSubmitting(false)
    }
  }

  function reset() {
    localStorage.removeItem(ORDER_KEY)
    setScreen('menu')
    setZoneSelection(null)
    setDeliveryAddress(null)
    setScheduledAt(null)
    setOrder(null)
    checkLocation()
  }

  function handleGoToCart() {
    if (location.status === 'too_far') {
      alert('ตำแหน่งของคุณอยู่นอกรัศมีจัดส่ง 3 กม.')
      return
    }
    if (location.status === 'error' || location.status === 'denied') {
      alert('ไม่สามารถระบุตำแหน่งได้ กรุณาอนุญาต GPS แล้วลองใหม่')
      return
    }
    if (!zoneSelection) {
      alert('กำลังระบุตำแหน่ง... กรุณารอสักครู่')
      return
    }
    setScreen('cart')
  }

  // ─── Screens ───────────────────────────────────

  if (screen === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="text-center">
          <div className="text-5xl mb-4">🍫</div>
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-green-500 border-t-transparent mx-auto" />
          <p className="text-sm text-gray-400 mt-3">กำลังโหลด...</p>
        </div>
      </div>
    )
  }

  if (screen === 'menu') {
    return (
      <MenuPage
        cartItems={items}
        cartTotal={total}
        deliveryFee={deliveryFee}
        distanceKm={zoneSelection?.distanceKm ?? 0}
        locationStatus={location.status}
        storeStatus={storeStatus}
        isOpen={isOpen}
        scheduledAt={scheduledAt}
        onSchedule={setScheduledAt}
        onAddItem={addItem}
        onGoToCart={handleGoToCart}
      />
    )
  }

  if (screen === 'cart' && zoneSelection) {
    return (
      <CartPage
        items={items}
        subtotal={total}
        deliveryFee={deliveryFee}
        distanceKm={zoneSelection.distanceKm}
        onUpdateQuantity={updateQuantity}
        onBack={() => setScreen('menu')}
        onNext={() => setScreen('delivery')}
      />
    )
  }

  if (screen === 'delivery' && zoneSelection) {
    return (
      <DeliveryPage
        userLat={zoneSelection.lat}
        userLng={zoneSelection.lng}
        distanceKm={zoneSelection.distanceKm}
        onBack={() => setScreen('cart')}
        onNext={(address) => {
          setDeliveryAddress(address)
          setScreen('payment')
        }}
      />
    )
  }

  if (screen === 'payment' && deliveryAddress) {
    return (
      <PaymentPage
        subtotal={total}
        deliveryFee={deliveryFee}
        total={total + deliveryFee}
        deliveryAddress={deliveryAddress}
        scheduledAt={scheduledAt}
        promptpayQrUrl={liffConfig?.promptpay_qr_url ?? '/promptpay-qr.png'}
        onBack={() => setScreen('delivery')}
        onNext={handlePlaceOrder}
      />
    )
  }

  if (screen === 'confirmation' && order) {
    return (
      <ConfirmationPage
        order={order}
        lineOaUrl={liffConfig?.line_oa_url ?? ''}
        onNewOrder={reset}
        onTrack={() => setScreen('status')}
      />
    )
  }

  if (screen === 'status' && order) {
    return (
      <StatusPage
        orderId={order.id}
        onNewOrder={reset}
        onOrderDone={() => {
          localStorage.removeItem(ORDER_KEY)
        }}
      />
    )
  }

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-green-500 border-t-transparent" />
    </div>
  )
}