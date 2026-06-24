// src/services/settingsService.ts
import { supabase } from '../lib/supabase'
import type { StoreStatus } from '../types'

async function getSetting(key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .single()
  if (error) return null
  return data?.value ?? null
}

export async function getStoreStatus(): Promise<StoreStatus> {
  const [openTime, closeTime, override, reopenAt] = await Promise.all([
    getSetting('store_open_time'),
    getSetting('store_close_time'),
    getSetting('manual_override'),
    getSetting('reopen_at'),
  ])

  // Manual override ชนะเสมอ
  if (override === 'open') return { status: 'manual_open' }
  if (override === 'closed') {
    return {
      status: 'manual_closed',
      reopen_at: reopenAt === 'null' ? undefined : reopenAt ?? undefined,
    }
  }

  // Auto by time
  const now = new Date()
  const [openH, openM] = (openTime ?? '08:00').split(':').map(Number)
  const [closeH, closeM] = (closeTime ?? '20:00').split(':').map(Number)
  const openMinutes = openH * 60 + openM
  const closeMinutes = closeH * 60 + closeM
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  return {
    status: nowMinutes >= openMinutes && nowMinutes < closeMinutes ? 'open' : 'closed',
  }
}

export async function getMinOrderOther(): Promise<number> {
  const val = await getSetting('min_order_other')
  return parseInt(val ?? '249', 10)
}
