import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { format, subDays } from 'date-fns'
import { th } from 'date-fns/locale'
import {
  RefreshCw, ChevronDown, ChevronUp, Loader2, X, Plus, Minus,
  CheckCircle2, Clock, Package, Truck, AlertCircle, Edit3, Save,
  Search, CalendarDays, Trash2, SlidersHorizontal, Printer,
} from 'lucide-react'
import MenuOptionModal from '../components/MenuOptionModal'

// ── Status config ──────────────────────────────────────────────
const STATUSES = [
  {
    key: 'preparing',
    label: 'กำลังเตรียม',
    short: 'เตรียม',
    icon: Clock,
    color: 'bg-amber-100 text-amber-700 border-amber-200',
    dot: 'bg-amber-400',
    next: 'ready',
    nextLabel: 'เตรียมเสร็จแล้ว →',
  },
  {
    key: 'ready',
    label: 'เตรียมเสร็จแล้ว',
    short: 'พร้อมส่ง',
    icon: Package,
    color: 'bg-blue-100 text-blue-700 border-blue-200',
    dot: 'bg-blue-400',
    next: 'delivered',
    nextLabel: 'ส่งแล้ว →',
  },
  {
    key: 'delivered',
    label: 'ส่งแล้ว',
    short: 'ส่งแล้ว',
    icon: Truck,
    color: 'bg-green-100 text-green-700 border-green-200',
    dot: 'bg-green-500',
    next: null,
    nextLabel: null,
  },
]

const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.key, s]))

const PLAT_COLOR = {
  GRAB: 'bg-green-500', LINE: 'bg-teal-500',
  SHOPEE: 'bg-orange-500', 'The metro': 'bg-blue-500', TU: 'bg-purple-500',
}

const today = () => format(new Date(), 'yyyy-MM-dd')
const fmt   = n => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 0 }).format(n)

// ══════════════════════════════════════════════════════════════
export default function OrderManagePage({ initialDate = null, highlightRef = null }) {
  const [date,         setDate]         = useState(initialDate ?? today())
  const [orders,       setOrders]       = useState([])
  const [menus,        setMenus]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [refreshing,   setRefreshing]   = useState(false)
  const [expandedId,   setExpandedId]   = useState(null)
  const [editingId,    setEditingId]    = useState(null)
  const [editItems,    setEditItems]    = useState({})      // { menuId: qty }
  const [editItemMeta, setEditItemMeta] = useState({})   // { menuId: { unit_price, is_campaign, item_options } }
  const [savingId,     setSavingId]     = useState(null)
  const [updatingId,   setUpdatingId]   = useState(null)
  const [filterStatus, setFilterStatus] = useState('all')
  const [searchQ,      setSearchQ]      = useState(highlightRef ?? '')
  const [menuSearch,   setMenuSearch]   = useState('')
  const [optionTarget, setOptionTarget] = useState(null)  // { menu, order } when modal open
  const [deleteTarget, setDeleteTarget] = useState(null)  // order to delete
  const [deleting,     setDeleting]     = useState(false)
  const [pendingDates, setPendingDates] = useState([])    // วันก่อนๆ ที่ยังมีออเดอร์ค้าง
  const [alertDismissed, setAlertDismissed] = useState(false)
  const [reprintTarget,   setReprintTarget]   = useState(null)   // order ที่จะ reprint
  const [reprintItems,    setReprintItems]    = useState([])    // order_items ที่โหลดแล้ว
  const [reprintLoading,  setReprintLoading]  = useState(false)
  const [reprintSelected, setReprintSelected] = useState(new Set())
  const [reprintPrinting, setReprintPrinting] = useState(false)

  // ── Load menus (for edit) ────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('menus')
        .select('id, name, category, menu_prices(platform, price)')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name')
      setMenus(data ?? [])
    }
    load()
  }, [])

  // ── Check previous days for undelivered orders ───────────
  useEffect(() => {
    const check = async () => {
      const todayDate = today()
      try {
        const { data } = await supabase
          .from('orders')
          .select('date, status')
          .lt('date', todayDate)
          .neq('status', 'delivered')
        if (data?.length) {
          // unique dates, sorted desc
          const dates = [...new Set(data.map(o => o.date))].sort((a, b) => b.localeCompare(a))
          setPendingDates(dates)
        } else {
          setPendingDates([])
        }
      } catch {
        // ถ้า status column ยังไม่มี ข้ามไป
      }
    }
    check()
  }, [orders]) // re-check เมื่อ orders เปลี่ยน (เช่น หลัง update status)

  // ── Load orders ──────────────────────────────────────────
  const loadOrders = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select('id, platform, date, status, notes, created_at')
        .eq('date', date)
        .order('created_at', { ascending: false })

      if (ordersError) {
        // Fallback: status column อาจยังไม่มี (SQL migration ยังไม่ได้รัน)
        console.warn('orders query error, retrying without status:', ordersError.message)
        const { data: fallback } = await supabase
          .from('orders')
          .select('id, platform, date, notes, created_at')
          .eq('date', date)
          .order('created_at', { ascending: false })
        if (fallback) {
          // inject default status
          const withStatus = fallback.map(o => ({ ...o, status: 'preparing' }))
          // continue with withStatus as ordersData
          const itemsRes = await supabase
            .from('order_items')
            .select('id, order_id, menu_id, quantity, unit_price, is_campaign, item_options, menus(name, image_url)')
            .in('order_id', withStatus.map(o => o.id))
          const byOrder2 = {}
          for (const item of itemsRes.data ?? []) {
            if (!byOrder2[item.order_id]) byOrder2[item.order_id] = []
            byOrder2[item.order_id].push(item)
          }
          setOrders(withStatus.map(o => ({
            ...o,
            items: byOrder2[o.id] ?? [],
            total: (byOrder2[o.id] ?? []).reduce((s, i) => s + i.quantity * i.unit_price, 0),
            itemCount: (byOrder2[o.id] ?? []).reduce((s, i) => s + i.quantity, 0),
          })))
          return
        }
      }

      if (!ordersData?.length) {
        setOrders([])
        return
      }

      const { data: itemsData } = await supabase
        .from('order_items')
        .select('id, order_id, menu_id, quantity, unit_price, is_campaign, item_options, menus(name, image_url)')
        .in('order_id', ordersData.map(o => o.id))

      const byOrder = {}
      for (const item of itemsData ?? []) {
        if (!byOrder[item.order_id]) byOrder[item.order_id] = []
        byOrder[item.order_id].push(item)
      }

      setOrders(ordersData.map(o => ({
        ...o,
        status: o.status ?? 'preparing',
        items: byOrder[o.id] ?? [],
        total: (byOrder[o.id] ?? []).reduce((s, i) => s + i.quantity * i.unit_price, 0),
        itemCount: (byOrder[o.id] ?? []).reduce((s, i) => s + i.quantity, 0),
      })))
    } catch (err) { console.error(err) }
    finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [date])

  useEffect(() => { loadOrders() }, [loadOrders])

  // ── Status update ────────────────────────────────────────
  const updateStatus = async (order, newStatus) => {
    setUpdatingId(order.id)
    try {
      await supabase.from('orders').update({ status: newStatus }).eq('id', order.id)
      setOrders(prev => prev.map(o =>
        o.id === order.id ? { ...o, status: newStatus } : o
      ))
    } catch (err) { console.error(err) }
    setUpdatingId(null)
  }

  // ── Edit order ───────────────────────────────────────────
  const startEdit = (order) => {
    const initQty  = {}
    const initMeta = {}
    for (const item of order.items) {
      initQty[item.menu_id]  = item.quantity
      // เก็บ options เดิมไว้ครบ — ใช้ตอน save เพื่อไม่ให้ milk/refill/sweetness/note หาย
      initMeta[item.menu_id] = {
        unit_price:   item.unit_price,
        is_campaign:  item.is_campaign ?? false,
        item_options: item.item_options ?? null,
      }
    }
    setEditItems(initQty)
    setEditItemMeta(initMeta)
    setEditingId(order.id)
    setMenuSearch('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditItems({})
    setEditItemMeta({})
  }

  const saveEdit = async (order) => {
    setSavingId(order.id)
    try {
      await supabase.from('order_items').delete().eq('order_id', order.id)

      const toInsert = Object.entries(editItems)
        .filter(([, qty]) => qty > 0)
        .map(([menuId, qty]) => {
          const meta = editItemMeta[menuId]
          // ถ้าเป็นรายการเดิม → ใช้ราคาและ options เดิม
          // ถ้าเป็นรายการใหม่ที่เพิ่ง add → ดึงราคาจาก menu_prices
          const menu  = menus.find(m => m.id === menuId)
          const price = meta?.unit_price
            ?? menu?.menu_prices?.find(p => p.platform === order.platform)?.price
            ?? 0
          return {
            order_id:     order.id,
            menu_id:      menuId,
            quantity:     qty,
            unit_price:   price,
            is_campaign:  meta?.is_campaign ?? false,
            item_options: meta?.item_options ?? null,  // ← preserve milk/refill/sweetness/note
          }
        })

      if (toInsert.length > 0) {
        await supabase.from('order_items').insert(toInsert)
      }

      cancelEdit()
      await loadOrders(true)
    } catch (err) { console.error(err) }
    setSavingId(null)
  }

  // ── Delete order ─────────────────────────────────────────
  const deleteOrder = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await supabase.from('order_items').delete().eq('order_id', deleteTarget.id)
      await supabase.from('orders').delete().eq('id', deleteTarget.id)
      setOrders(prev => prev.filter(o => o.id !== deleteTarget.id))
      if (expandedId === deleteTarget.id) setExpandedId(null)
    } catch (err) { console.error(err) }
    setDeleting(false)
    setDeleteTarget(null)
  }

  // ── Re-print: build printable units ─────────────────────
  const buildPrintUnits = (items) => {
    const units = []
    for (const item of items) {
      const opts     = item.item_options ?? {}
      const refills  = Array.isArray(opts.refill) && opts.refill.length > 0 ? opts.refill : []
      const sublabel = [opts.milk?.name, opts.packaging, opts.sweetness != null ? `${opts.sweetness}%` : null]
        .filter(Boolean).join(' · ')
      units.push({
        key:       `${item.id}_main`,
        label:     item.menus?.name ?? '?',
        sublabel,
        printItem: {
          name:         item.menus?.name ?? '?',
          qty:          item.quantity,
          item_options: refills.length > 0 ? { ...opts, refill: null } : opts,
          isCampaign:   item.is_campaign ?? false,
        },
      })
      for (const r of refills) {
        units.push({
          key:       `${item.id}_refill_${r.id}`,
          label:     `Refill: ${r.name}`,
          sublabel:  `× ${r.qty}`,
          printItem: {
            name:         r.name,
            qty:          r.qty,
            item_options: { packaging: opts.packaging, sweetness: 100 },
            isCampaign:   false,
          },
        })
      }
    }
    return units
  }

  // เปิด modal และโหลด items
  const openReprintModal = async (order) => {
    setReprintTarget(order)
    setReprintLoading(true)
    const { data } = await supabase
      .from('order_items')
      .select('id, quantity, is_campaign, item_options, menus(name)')
      .eq('order_id', order.id)
    const items = data ?? []
    setReprintItems(items)
    const units = buildPrintUnits(items)
    setReprintSelected(new Set(units.map(u => u.key)))
    setReprintLoading(false)
  }

  // ส่ง print request ทีละ unit ที่เลือก
  const executeReprint = async () => {
    if (!reprintTarget) return
    setReprintPrinting(true)
    try {
      const labelRes = await supabase.from('settings').select('value').eq('key', 'label_settings').maybeSingle()
      const labelSettings = labelRes.data?.value ? JSON.parse(labelRes.data.value) : {}
      const ip   = labelSettings.printerIp   ?? '192.168.1.100'
      const port = labelSettings.printerPort ?? 3001
      const units = buildPrintUnits(reprintItems).filter(u => reprintSelected.has(u.key))
      for (const unit of units) {
        await fetch(`http://${ip}:${port}/print`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId:  reprintTarget.notes ?? reprintTarget.id,
            platform: reprintTarget.platform,
            items:    [unit.printItem],
            labelSettings,
          }),
          signal: AbortSignal.timeout(5000),
        })
      }
    } catch (err) { console.warn('reprint failed:', err.message) }
    setReprintPrinting(false)
    setReprintTarget(null)
    setReprintItems([])
  }

  const toggleReprintKey = (key) =>
    setReprintSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  // ── Filtered orders ──────────────────────────────────────
  const filteredOrders = useMemo(() => {
    let list = orders
    if (filterStatus !== 'all') list = list.filter(o => o.status === filterStatus)
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase()
      list = list.filter(o =>
        o.platform.toLowerCase().includes(q) ||
        (o.notes ?? '').toLowerCase().includes(q) ||
        o.items.some(i => i.menus?.name?.toLowerCase().includes(q))
      )
    }
    return list
  }, [orders, filterStatus, searchQ])

  // ── Summary counts ───────────────────────────────────────
  const counts = useMemo(() => {
    const c = { all: orders.length, preparing: 0, ready: 0, delivered: 0 }
    for (const o of orders) {
      const s = o.status ?? 'preparing'
      c[s] = (c[s] ?? 0) + 1
    }
    return c
  }, [orders])

  const totalDelivered = useMemo(() =>
    orders.filter(o => o.status === 'delivered').reduce((s, o) => s + o.total, 0),
  [orders])

  // ── Addon / Refill menus (for MenuOptionModal) ──────────
  const ADDON_CATS  = ['Addon', 'addon', 'ADDON']
  const REFILL_CATS = ['Refill', 'refill', 'REFILL']
  const addonMenus  = useMemo(() => menus.filter(m => ADDON_CATS.includes(m.category)),  [menus])
  const refillMenus = useMemo(() => menus.filter(m => REFILL_CATS.includes(m.category)), [menus])

  // ── Menu for editing (filtered) ──────────────────────────
  const editableMenus = useMemo(() => {
    const HIDDEN = [...ADDON_CATS, ...REFILL_CATS]
    let list = menus.filter(m => !HIDDEN.includes(m.category))
    if (menuSearch.trim()) {
      const q = menuSearch.toLowerCase()
      list = list.filter(m => m.name.toLowerCase().includes(q))
    }
    return list
  }, [menus, menuSearch])

  // ── Handle option confirm from MenuOptionModal ────────────
  const handleEditOptionConfirm = (opts) => {
    if (!optionTarget) return
    const { menu, order } = optionTarget
    const basePrice = menu.menu_prices?.find(p => p.platform === order.platform)?.price ?? 0
    const milkPrice   = opts.milk?.price   ?? 0
    const refillPrice = opts.refill?.price ?? 0
    setEditItems(prev => ({ ...prev, [menu.id]: prev[menu.id] ?? 1 }))
    setEditItemMeta(prev => ({
      ...prev,
      [menu.id]: {
        unit_price:  basePrice + milkPrice + refillPrice,
        is_campaign: false,
        item_options: opts,
      },
    }))
    setOptionTarget(null)
  }

  // ══════════════════════════════════════════════════════════
  return (
    <div className="h-full flex flex-col overflow-hidden bg-gray-50">

      {/* ── Header ──────────────────────────────────────── */}
      <div className="bg-cocoa-800 text-white px-4 py-3 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-sm">จัดการออเดอร์</h1>
            <p className="text-cocoa-300 text-xs">
              {format(new Date(date + 'T00:00:00'), 'd MMM yyyy', { locale: th })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Date picker */}
            <div className="flex items-center gap-1 bg-cocoa-700 rounded-lg px-2 py-1.5">
              <CalendarDays size={14} className="text-cocoa-300" />
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="bg-transparent text-white text-xs outline-none w-28"
              />
            </div>
            <button
              onClick={() => loadOrders(true)}
              disabled={refreshing}
              aria-label="รีเฟรช"
              className="p-2 rounded-lg bg-cocoa-700 hover:bg-cocoa-600 active:bg-cocoa-900 transition-colors"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Summary bar */}
        <div className="flex gap-3 mt-3">
          {[
            { key: 'preparing', label: 'กำลังเตรียม', color: 'text-amber-300' },
            { key: 'ready',     label: 'พร้อมส่ง',   color: 'text-blue-300'  },
            { key: 'delivered', label: 'ส่งแล้ว',    color: 'text-green-300' },
          ].map(s => (
            <div key={s.key} className="flex-1 bg-cocoa-700/50 rounded-xl p-2 text-center">
              <p className={`text-lg font-bold ${s.color}`}>{counts[s.key] ?? 0}</p>
              <p className="text-xs text-cocoa-400">{s.label}</p>
            </div>
          ))}
          <div className="flex-1 bg-cocoa-700/50 rounded-xl p-2 text-center">
            <p className="text-lg font-bold text-green-300">{fmt(totalDelivered)}</p>
            <p className="text-xs text-cocoa-400">ยอดส่งแล้ว</p>
          </div>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-100 px-3 py-2 shrink-0">
        <div className="flex gap-2 items-center">
          {/* Status filter */}
          <div className="flex gap-1">
            {[
              { key: 'all', label: `ทั้งหมด (${counts.all})` },
              { key: 'preparing', label: `⏳ ${counts.preparing ?? 0}` },
              { key: 'ready',     label: `📦 ${counts.ready ?? 0}` },
              { key: 'delivered', label: `🚀 ${counts.delivered ?? 0}` },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setFilterStatus(f.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
                  ${filterStatus === f.key
                    ? 'bg-cocoa-700 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="flex-1 flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5">
            <Search size={13} className="text-gray-400 shrink-0" />
            <input
              type="text"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="ค้นหา platform / เมนู..."
              className="flex-1 bg-transparent text-xs text-gray-700 outline-none placeholder-gray-400"
            />
            {searchQ && <button onClick={() => setSearchQ('')}><X size={12} className="text-gray-400" /></button>}
          </div>
        </div>
      </div>

      {/* ── Pending days alert ──────────────────────────── */}
      {pendingDates.length > 0 && !alertDismissed && (
        <div className="mx-3 mt-3 shrink-0">
          <div className="bg-amber-50 border border-amber-300 rounded-2xl px-4 py-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-amber-800">มีออเดอร์ค้างจากวันก่อน</p>
                <p className="text-xs text-amber-600 mt-0.5 mb-2">
                  ออเดอร์ด้านล่างยังไม่ได้อัปเดตเป็น "ส่งแล้ว"
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {pendingDates.map(d => (
                    <button
                      key={d}
                      onClick={() => setDate(d)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border
                        ${date === d
                          ? 'bg-amber-500 text-white border-amber-500'
                          : 'bg-white text-amber-700 border-amber-300 hover:bg-amber-100'
                        }`}
                    >
                      {format(new Date(d + 'T00:00:00'), 'd MMM yyyy', { locale: th })}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => setAlertDismissed(true)}
                aria-label="ปิดการแจ้งเตือน"
                className="p-1 rounded-lg hover:bg-amber-100 text-amber-400 shrink-0"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Order list ──────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={28} className="animate-spin text-cocoa-500" />
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-3xl mb-2">📋</p>
            <p className="text-sm">ไม่มีออเดอร์</p>
          </div>
        ) : (
          filteredOrders.map(order => {
            const st       = STATUS_MAP[order.status ?? 'preparing']
            const isExpand = expandedId === order.id
            const isEdit   = editingId  === order.id
            const isSaving = savingId   === order.id
            const isUpdating = updatingId === order.id
            const StatusIcon = st.icon

            return (
              <div key={order.id}
                className={`bg-white rounded-2xl border overflow-hidden shadow-sm
                  ${order.status === 'delivered' ? 'border-green-100' : 'border-gray-100'}`}
              >
                {/* Card header */}
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Platform badge */}
                      <span className={`text-white text-xs font-bold px-2.5 py-1 rounded-lg
                        ${PLAT_COLOR[order.platform] ?? 'bg-gray-500'}`}>
                        {order.platform}
                      </span>
                      {/* Order number */}
                      {order.notes && (
                        <span className="text-xs font-bold text-gray-700 bg-gray-100 px-2 py-1 rounded-lg tracking-wide">
                          {order.notes}
                        </span>
                      )}
                      {/* Campaign badge */}
                      {order.items.some(i => i.is_campaign) && (
                        <span className="text-[10px] bg-amber-400 text-white font-bold px-2 py-1 rounded-lg">⚡ 60/40</span>
                      )}
                      {/* Status badge */}
                      <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg border ${st.color}`}>
                        <StatusIcon size={11} />
                        {st.label}
                      </span>
                    </div>
                    {/* Expand toggle */}
                    <button
                      onClick={() => setExpandedId(isExpand ? null : order.id)}
                      className="p-1.5 rounded-lg hover:bg-gray-100"
                    >
                      {isExpand ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                    </button>
                  </div>

                  {/* Summary row */}
                  <div className="flex items-center justify-between mt-2">
                    <div>
                      <p className="text-xs text-gray-500">{order.itemCount} รายการ</p>
                      <p className="text-base font-bold text-gray-900">{fmt(order.total)}</p>
                    </div>
                    <p className="text-[10px] text-gray-400">
                      {format(new Date(order.created_at), 'HH:mm น.')}
                    </p>
                  </div>
                </div>

                {/* Expanded: items + controls */}
                {isExpand && !isEdit && (
                  <div className="border-t border-gray-50 px-4 py-3 space-y-3">

                    {/* Items list */}
                    <div className="space-y-2">
                      {order.items.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2.5">
                          {item.menus?.image_url ? (
                            <img src={item.menus.image_url} alt=""
                              className="w-9 h-9 rounded-lg object-cover shrink-0" />
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-base shrink-0">🍫</div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{item.menus?.name ?? '?'}</p>
                            {/* Options summary */}
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {item.is_campaign && (
                                <span className="text-[9px] bg-amber-400 text-white font-bold px-1.5 py-0.5 rounded">⚡ 60/40</span>
                              )}
                              {item.item_options?.milk && <span className="text-[9px] bg-blue-50 text-blue-600 px-1 py-0.5 rounded">🥛 {item.item_options.milk.name}</span>}
                              {item.item_options?.packaging === 'พร้อมดื่ม' && <span className="text-[9px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded">🧋 พร้อมดื่ม</span>}
                              {Array.isArray(item.item_options?.refill)
                                ? item.item_options.refill.map(r => <span key={r.id} className="text-xs font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-lg border border-purple-200">🔄 {r.name}{r.qty > 1 ? ` ×${r.qty}` : ''}</span>)
                                : item.item_options?.refill && <span className="text-xs font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-lg border border-purple-200">🔄 {item.item_options.refill.name}</span>
                              }
                              {item.item_options?.sweetness != null && (
                                <span className="text-[9px] bg-amber-50 text-amber-600 px-1 py-0.5 rounded">{item.item_options.sweetness}%</span>
                              )}
                              {item.item_options?.note && (
                                <span className="text-[9px] bg-gray-100 text-gray-500 px-1 py-0.5 rounded">📝 {item.item_options.note}</span>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs text-gray-400">× {item.quantity}</p>
                            <p className="text-sm font-semibold text-gray-700">{fmt(item.quantity * item.unit_price)}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 pt-1">
                      {/* Delete button */}
                      <button
                        onClick={() => setDeleteTarget(order)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold transition-colors"
                      >
                        <Trash2 size={13} /> ลบ
                      </button>

                      {/* Edit button */}
                      <button
                        onClick={() => startEdit(order)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold transition-colors"
                      >
                        <Edit3 size={13} /> แก้ไขรายการ
                      </button>

                      {/* Re-print button */}
                      <button
                        onClick={() => openReprintModal(order)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-semibold transition-colors"
                      >
                        <Printer size={13} /> พิมพ์ฉลาก
                      </button>

                      {/* Status advance button */}
                      {st.next && (
                        <button
                          onClick={() => updateStatus(order, st.next)}
                          disabled={isUpdating}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all
                            ${st.next === 'delivered'
                              ? 'bg-green-500 hover:bg-green-600 text-white'
                              : 'bg-blue-500 hover:bg-blue-600 text-white'
                            } disabled:opacity-50`}
                        >
                          {isUpdating
                            ? <Loader2 size={13} className="animate-spin" />
                            : <>
                                {st.next === 'ready'     && <Package size={13} />}
                                {st.next === 'delivered' && <Truck size={13} />}
                                {st.nextLabel}
                              </>
                          }
                        </button>
                      )}

                      {/* Delivered: already done */}
                      {!st.next && (
                        <div className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-green-50 text-green-600 text-xs font-bold">
                          <CheckCircle2 size={13} /> บันทึกยอดขายแล้ว
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Edit mode */}
                {isExpand && isEdit && (
                  <div className="border-t border-gray-50 px-4 py-3">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-bold text-gray-900">แก้ไขรายการ</p>
                      <button onClick={cancelEdit} className="p-1 rounded-lg hover:bg-gray-100">
                        <X size={16} className="text-gray-400" />
                      </button>
                    </div>

                    {/* Menu search */}
                    <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 mb-3">
                      <Search size={13} className="text-gray-400" />
                      <input
                        type="text"
                        value={menuSearch}
                        onChange={e => setMenuSearch(e.target.value)}
                        placeholder="ค้นหาเมนู..."
                        className="flex-1 bg-transparent text-xs outline-none text-gray-700 placeholder-gray-400"
                      />
                    </div>

                    {/* Editable item list */}
                    <div className="max-h-60 overflow-y-auto space-y-1.5 mb-3">
                      {editableMenus.map(menu => {
                        const qty = editItems[menu.id] ?? 0
                        const price = menu.menu_prices?.find(p => p.platform === order.platform)?.price ?? 0
                        return (
                          <div key={menu.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-colors
                            ${qty > 0 ? 'bg-cocoa-50 border border-cocoa-200' : 'bg-gray-50'}`}>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-gray-900 truncate">{menu.name}</p>
                              {price > 0 && <p className="text-[10px] text-gray-400">{fmt(price)}</p>}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {/* Options edit button — แสดงเมื่อมี item อยู่แล้ว */}
                              {qty > 0 && (
                                <button
                                  onClick={() => setOptionTarget({ menu, order })}
                                  className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-cocoa-100 flex items-center justify-center"
                                  title="แก้ไขตัวเลือก"
                                >
                                  <SlidersHorizontal size={11} className="text-gray-500" />
                                </button>
                              )}
                              <button
                                onClick={() => setEditItems(prev => {
                                  const next = (prev[menu.id] ?? 0) - 1
                                  if (next <= 0) { const { [menu.id]: _, ...rest } = prev; return rest }
                                  return { ...prev, [menu.id]: next }
                                })}
                                disabled={qty === 0}
                                className="w-7 h-7 rounded-lg bg-white border border-gray-200 flex items-center justify-center disabled:opacity-20"
                              >
                                <Minus size={12} />
                              </button>
                              <span className={`w-6 text-center text-sm font-bold
                                ${qty > 0 ? 'text-cocoa-700' : 'text-gray-300'}`}>
                                {qty || '·'}
                              </span>
                              <button
                                onClick={() => {
                                  const qty = editItems[menu.id] ?? 0
                                  if (qty === 0) {
                                    // เมนูใหม่ — เปิด MenuOptionModal เพื่อเลือกนม/Refill/ความหวาน
                                    setOptionTarget({ menu, order })
                                  } else {
                                    // มีอยู่แล้ว — เพิ่มจำนวนได้เลย
                                    setEditItems(prev => ({ ...prev, [menu.id]: prev[menu.id] + 1 }))
                                  }
                                }}
                                className="w-7 h-7 rounded-lg bg-cocoa-700 flex items-center justify-center"
                              >
                                <Plus size={12} className="text-white" />
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Save / Cancel */}
                    <div className="flex gap-2">
                      <button
                        onClick={cancelEdit}
                        className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-sm font-semibold"
                      >
                        ยกเลิก
                      </button>
                      <button
                        onClick={() => saveEdit(order)}
                        disabled={isSaving}
                        className="flex-1 py-2.5 rounded-xl bg-cocoa-700 text-white text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-60"
                      >
                        {isSaving
                          ? <Loader2 size={14} className="animate-spin" />
                          : <><Save size={14} /> บันทึก</>
                        }
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* ── Delete Confirm Popup ─────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
          <div className="bg-white rounded-2xl w-full max-w-xs shadow-2xl overflow-hidden">
            <div className="px-6 pt-6 pb-4 text-center">
              <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <Trash2 size={24} className="text-red-500" />
              </div>
              <h3 className="text-base font-bold text-gray-900 mb-1">ยืนยันการลบออเดอร์?</h3>
              <p className="text-sm text-gray-500">
                <span className={`font-bold ${PLAT_COLOR[deleteTarget.platform] ? 'text-white' : 'text-gray-700'}`}></span>
                <span className={`inline-block text-white text-xs font-bold px-2 py-0.5 rounded-lg mr-1
                  ${PLAT_COLOR[deleteTarget.platform] ?? 'bg-gray-500'}`}>
                  {deleteTarget.platform}
                </span>
                {deleteTarget.itemCount} รายการ · {new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 0 }).format(deleteTarget.total)}
              </p>
              <p className="text-xs text-red-500 mt-2">การลบไม่สามารถกู้คืนได้</p>
            </div>
            <div className="flex flex-col gap-2 px-5 pb-5 pt-2">
              <button
                onClick={deleteOrder}
                disabled={deleting}
                className="w-full py-3.5 rounded-xl text-sm font-bold bg-red-500 hover:bg-red-600 active:bg-red-700 text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                ยืนยัน ลบออเดอร์นี้
              </button>
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="w-full py-3 rounded-xl text-sm font-semibold text-gray-500 hover:bg-gray-100 transition-colors"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reprint Modal ───────────────────────────────── */}
      {reprintTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-end z-50" onClick={() => !reprintPrinting && setReprintTarget(null)}>
          <div className="bg-white rounded-t-3xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 shrink-0">
              <p className="font-bold text-gray-900">เลือกรายการที่จะพิมพ์</p>
              <button onClick={() => !reprintPrinting && setReprintTarget(null)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X size={18} className="text-gray-400" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
              {reprintLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={22} className="animate-spin text-cocoa-400" />
                </div>
              ) : (
                buildPrintUnits(reprintItems).map((unit, i, arr) => {
                  const isRefill  = unit.key.includes('_refill_')
                  const isChecked = reprintSelected.has(unit.key)
                  // กลุ่ม refill แนบกับ main item
                  const isFirstOfGroup = i === 0 || !arr[i - 1].key.includes('_refill_') || isRefill === false

                  return (
                    <div
                      key={unit.key}
                      onClick={() => toggleReprintKey(unit.key)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 cursor-pointer transition-all
                        ${isChecked ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'}
                        ${isRefill ? 'ml-6' : ''}`}
                    >
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors
                        ${isChecked ? 'bg-blue-500 border-blue-500' : 'border-gray-300'}`}>
                        {isChecked && <CheckCircle2 size={12} className="text-white" strokeWidth={3} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{unit.label}</p>
                        {unit.sublabel && <p className="text-xs text-gray-400 mt-0.5">{unit.sublabel}</p>}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-5 pt-3 pb-6 border-t border-gray-100 shrink-0 flex gap-2">
              <button
                onClick={() => setReprintTarget(null)}
                disabled={reprintPrinting}
                className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-600 text-sm font-semibold disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                onClick={executeReprint}
                disabled={reprintPrinting || reprintLoading || reprintSelected.size === 0}
                className="flex-2 flex-[2] py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {reprintPrinting
                  ? <Loader2 size={15} className="animate-spin" />
                  : <Printer size={15} />
                }
                พิมพ์ที่เลือก ({reprintSelected.size} ฉลาก)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MenuOptionModal (เพิ่มเมนูใหม่ในโหมดแก้ไข) ── */}
      {optionTarget && (
        <MenuOptionModal
          menu={optionTarget.menu}
          platform={optionTarget.order.platform}
          addons={addonMenus}
          refills={refillMenus}
          initial={editItemMeta[optionTarget.menu.id]?.item_options ?? null}
          onConfirm={handleEditOptionConfirm}
          onClose={() => setOptionTarget(null)}
          confirmLabel="เพิ่มในรายการ"
        />
      )}
    </div>
  )
}
