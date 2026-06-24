// pos-changes/useLineOrderSound.ts
// เพิ่ม hook นี้ใน Order Manage page ของ POS
// เมื่อมี order ใหม่จาก LINE → เล่นเสียงแจ้งเตือน

import { useEffect, useRef } from 'react'
import { supabase } from '../src/lib/supabase'

// สร้างเสียง notification ด้วย Web Audio API
function playNotificationSound() {
  try {
    const ctx = new AudioContext()
    const times = [0, 0.15, 0.3]
    times.forEach((t) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.4, ctx.currentTime + t)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.12)
      osc.start(ctx.currentTime + t)
      osc.stop(ctx.currentTime + t + 0.12)
    })
  } catch (err) {
    console.warn('Audio play failed:', err)
  }
}

export function useLineOrderSound(onNewOrder?: (orderId: string) => void) {
  const audioUnlocked = useRef(false)

  // Unlock audio on first user interaction (iPad requirement)
  useEffect(() => {
    function unlock() {
      if (audioUnlocked.current) return
      const ctx = new AudioContext()
      ctx.resume().then(() => { audioUnlocked.current = true })
      document.removeEventListener('touchstart', unlock)
      document.removeEventListener('click', unlock)
    }
    document.addEventListener('touchstart', unlock, { once: true })
    document.addEventListener('click', unlock, { once: true })
    return () => {
      document.removeEventListener('touchstart', unlock)
      document.removeEventListener('click', unlock)
    }
  }, [])

  // Subscribe to new LINE orders
  useEffect(() => {
    const channel = supabase
      .channel('pos-line-orders')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'orders',
          filter: "source=eq.line",
        },
        (payload) => {
          playNotificationSound()
          onNewOrder?.(payload.new.id)
        }
      )
      .subscribe()

    return () => { channel.unsubscribe() }
  }, [onNewOrder])
}

// ========== วิธีใช้ใน OrderManagePage ==========
// import { useLineOrderSound } from './useLineOrderSound'
//
// useLineOrderSound((newOrderId) => {
//   // refresh order list หรือ highlight order ใหม่
//   refetchOrders()
// })
