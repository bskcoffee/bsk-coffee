/**
 * Offline Support — draft saving & sync queue
 * Uses localStorage for temporary storage
 */

const DRAFT_KEY = 'cocoa-house-draft'
const QUEUE_KEY = 'cocoa-house-sync-queue'

// ── Draft (auto-save current form state) ─────────────────────────────

export function saveDraft(data) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      ...data,
      savedAt: new Date().toISOString()
    }))
  } catch (e) {
    console.warn('Draft save failed:', e)
  }
}

export function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearDraft() {
  localStorage.removeItem(DRAFT_KEY)
}

// ── Sync Queue (operations to retry when back online) ─────────────────

export function enqueueSync(operation) {
  try {
    const queue = getSyncQueue()
    queue.push({ ...operation, id: Date.now(), enqueuedAt: new Date().toISOString() })
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch (e) {
    console.warn('Enqueue failed:', e)
  }
}

export function getSyncQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function clearSyncQueue() {
  localStorage.removeItem(QUEUE_KEY)
}

export function removeFromQueue(id) {
  const queue = getSyncQueue().filter(op => op.id !== id)
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

// ── Online/Offline detection ──────────────────────────────────────────

export function isOnline() {
  return navigator.onLine
}

export function onOnline(callback) {
  window.addEventListener('online', callback)
  return () => window.removeEventListener('online', callback)
}

export function onOffline(callback) {
  window.addEventListener('offline', callback)
  return () => window.removeEventListener('offline', callback)
}

// ── Process sync queue ────────────────────────────────────────────────

export async function processSyncQueue(supabase) {
  if (!isOnline()) return { processed: 0, failed: 0 }
  const queue = getSyncQueue()
  let processed = 0, failed = 0

  for (const op of queue) {
    try {
      if (op.type === 'upsert_full_order') {
        // 1. Upsert order → get back order_id
        const { data: orderData, error: orderError } = await supabase
          .from('orders')
          .upsert(op.data.order, { onConflict: 'date,platform' })
          .select()
          .single()
        if (orderError) throw orderError

        const orderId = orderData.id

        // 2. Replace items
        await supabase.from('order_items').delete().eq('order_id', orderId)
        if (op.data.items?.length > 0) {
          const itemsWithId = op.data.items.map(item => ({ ...item, order_id: orderId }))
          const { error: itemsError } = await supabase.from('order_items').insert(itemsWithId)
          if (itemsError) throw itemsError
        }

        // 3. Upsert platform costs
        if (op.data.costs) {
          const { error: costsError } = await supabase
            .from('platform_costs')
            .upsert(op.data.costs, { onConflict: 'date,platform' })
          if (costsError) throw costsError
        }

      } else if (op.type === 'upsert_order') {
        // Legacy — order header only (kept for backward compat)
        const { error } = await supabase.from('orders').upsert(op.data)
        if (error) throw error
      } else if (op.type === 'upsert_items') {
        const { error } = await supabase.from('order_items').upsert(op.data)
        if (error) throw error
      } else if (op.type === 'upsert_costs') {
        const { error } = await supabase.from('platform_costs').upsert(op.data)
        if (error) throw error
      }
      removeFromQueue(op.id)
      processed++
    } catch {
      failed++
    }
  }

  return { processed, failed }
}
