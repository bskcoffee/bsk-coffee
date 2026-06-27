// src/App.tsx
import { useState, useEffect } from 'react'
import { initLiff } from './lib/liff'
import { useCart } from './hooks/useCart'
import { useStoreStatus } from './hooks/useStoreStatus'
import { createOrder } from './services/orderService'
import { calcDeliveryFee } from './types'
import type { DeliveryAddress, PaymentMethod, Order } from './types'

import { ZonePage } from './pages/ZonePage'
import type { ZoneSelection } from './pages/ZonePage'
import { MenuPage } from './pages/MenuPage'
import { CartPage } from './pages/CartPage'
import { DeliveryPage } from './pages/DeliveryPage'
import { PaymentPage } from './pages/PaymentPage'
import { ConfirmationPage } from './pages/ConfirmationPage'
import { StatusPage } from './pages/StatusPage'

type AppScreen = 'loading' | 'zone' | 'menu' | 'cart' | 'delivery' | 'payment' | 'confirmation' | 'status'

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('loading')
  const [lineUserId, setLineUserId] = useState('')
  const [lineDisplayName, setLineDisplayName] = useState('')

  // Zone selection (จาก ZonePage)
  const [zoneSelection, setZoneSelection] = useState<ZoneSelection | null>(null)

  const [deliveryAddress, setDeliveryAddress] = useState<DeliveryAddress | null>(null)
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [order, setOrder] = useState<Order | null>(null)

  const { items, total, addItem, updateQuantity, clearCart } = useCart()
  const { storeStatus, isOpen } = useStoreStatus()

  // delivery fee — คำนวณจาก zone + ยอดรวม
  const deliveryFee: number = (() => {
    if (!zoneSelection || zoneSelection.zone !== 'other') return 0
    if (total >= 249) return 0
    return calcDeliveryFee(zoneSelection.distanceKm)
  })()

  // Init LIFF
  useEffect(() => {
    initLiff()
      .then(({ userId, displayName }) => {
        setLineUserId(userId)
        setLineDisplayName(displayName)
        setScreen('zone')
      })
      .catch((err) => {
        console.error(err)
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
      setScreen('confirmation')
    } catch (err) {
      console.error('Order failed:', err)
      alert('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง')
    } finally {
      setSubmitting(false)
    }
  }

  function reset() {
    setScreen('zone')
    setZoneSelection(null)
    setDeliveryAddress(null)
    setScheduledAt(null)
    setOrder(null)
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

  if (screen === 'zone') {
    return (
      <ZonePage
        displayName={lineDisplayName}
        onNext={(selection) => {
          setZoneSelection(selection)
          setScreen('menu')
        }}
      />
    )
  }

  if (screen === 'menu' && zoneSelection) {
    return (
      <MenuPage
        cartItems={items}
        cartTotal={total}
        deliveryFee={deliveryFee}
        selectedZone={zoneSelection.zone}
        distanceKm={zoneSelection.distanceKm}
        storeStatus={storeStatus}
        isOpen={isOpen}
        scheduledAt={scheduledAt}
        onSchedule={setScheduledAt}
        onAddItem={addItem}
        onGoToCart={() => setScreen('cart')}
      />
    )
  }

  if (screen === 'cart' && zoneSelection) {
    return (
      <CartPage
        items={items}
        subtotal={total}
        deliveryFee={deliveryFee}
        selectedZone={zoneSelection.zone}
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
        zone={zoneSelection.zone}
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
        onBack={() => setScreen('delivery')}
        onNext={handlePlaceOrder}
      />
    )
  }

  if (screen === 'confirmation' && order) {
    return (
      <ConfirmationPage
        order={order}
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
      />
    )
  }

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-green-500 border-t-transparent" />
    </div>
  )
}