import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { format, subDays } from 'date-fns'
import { th } from 'date-fns/locale'
import {
  RefreshCw, ChevronDown, ChevronUp, Loader2, X, Plus, Minus,
  CheckCircle2, Clock, Package, Truck, AlertCircle, Edit3, Save,
  Search, CalendarDays,
} from 'lucide-react'

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
export default function OrderManagePage() {
  const [date,         setDate]         = useState(today())
  const [orders,       setOrders]       = useState([])
  const [menus,        setMenus]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [refreshing,   setRefreshing]   = useState(false)
  const [expandedId,   setExpandedId]   = useState(null)
  const [editingId,    setEditingId]    = useState(null)
  const [editItems,    setEditItems]    = useState({})   // { menuId: qty }
  const [savingId,     setSavingId]     = useState(null)
  const [updatingId,   setUpdatingId]   = useState(null)
  const [filterStatus, setFilterStatus] = useState('all')
  const [searchQ,      setSearchQ]      = useState('')
  const [menuSearch,   setMenuSearch]   = useState('')

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

  // ── Load orders ──────────────────────────────────────────
  const loadOrders = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const { data: ordersData } = await supabase
        .from('orders')
        .select('id, platform, date, status, notes, created_at, updated_at')
        .eq('date', date)
        .order('created_at', { ascending: false })

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
    const initItems = {}
    for (const item of order.items) {
      initItems[item.menu_id] = item.quantity
    }
    setEditItems(initItems)
    setEditingId(order.id)
    setMenuSearch('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditItems({})
  }

  const saveEdit = async (order) => {
    setSavingId(order.id)
    try {
      // Delete existing items
      await supabase.from('order_items').delete().eq('order_id', order.id)

      // Insert updated items
      const toInsert = Object.entries(editItems)
        .filter(([, qty]) => qty > 0)
        .map(([menuId, qty]) => {
          const menu = menus.find(m => m.id === menuId)
          const price = menu?.menu_prices?.find(p => p.platform === order.platform)?.price ?? 0
          return {
            order_id: order.id,
            menu_id: menuId,
            quantity: qty,
            unit_price: price,
            is_campaign: false,
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

  // ── Filtered orders ──────────────────────────────────────
  const filteredOrders = useMemo(() => {
    let list = orders
    if (filterStatus !== 'all') list = list.filter(o => o.status === filterStatus)
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase()
      list = list.filter(o =>
        o.platform.toLowerCase().includes(q) ||
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

  // ── Menu for editing (filtered) ──────────────────────────
  const editableMenus = useMemo(() => {
    const HIDDEN = ['Addon', 'addon', 'ADDON', 'Refill', 'refill', 'REFILL']
    let list = menus.filter(m => !HIDDEN.includes(m.category))
    if (menuSearch.trim()) {
      const q = menuSearch.toLowerCase()
      list = list.filter(m => m.name.toLowerCase().includes(q))
    }
    return list
  }, [menus, menuSearch])

  // ══════════════════════════════════════════════════════════
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50">

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
              <p className="text-[10px] text-cocoa-400">{s.label}</p>
            </div>
          ))}
          <div className="flex-1 bg-cocoa-700/50 rounded-xl p-2 text-center">
            <p className="text-lg font-bold text-green-300">{fmt(totalDelivered)}</p>
            <p className="text-[10px] text-cocoa-400">ยอดส่งแล้ว</p>
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
                    <div className="flex items-center gap-2.5">
                      {/* Platform badge */}
                      <span className={`text-white text-xs font-bold px-2.5 py-1 rounded-lg
                        ${PLAT_COLOR[order.platform] ?? 'bg-gray-500'}`}>
                        {order.platform}
                      </span>
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
                            {item.item_options && (
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {item.item_options.milk   && <span className="text-[9px] bg-blue-50 text-blue-600 px-1 py-0.5 rounded">{item.item_options.milk.name}</span>}
                                {item.item_options.refill && <span className="text-[9px] bg-purple-50 text-purple-600 px-1 py-0.5 rounded">{item.item_options.refill.name}</span>}
                                {item.item_options.sweetness != null && item.item_options.sweetness !== 100 && (
                                  <span className="text-[9px] bg-amber-50 text-amber-600 px-1 py-0.5 rounded">{item.item_options.sweetness}%</span>
                                )}
                                {item.item_options.note && (
                                  <span className="text-[9px] bg-gray-100 text-gray-500 px-1 py-0.5 rounded">📝 {item.item_options.note}</span>
                                )}
                              </div>
                            )}
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
                      {/* Edit button (only if not delivered) */}
                      {order.status !== 'delivered' && (
                        <button
                          onClick={() => startEdit(order)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold transition-colors"
                        >
                          <Edit3 size={13} /> แก้ไขรายการ
                        </button>
                      )}

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
                                onClick={() => setEditItems(prev => ({ ...prev, [menu.id]: (prev[menu.id] ?? 0) + 1 }))}
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
    </div>
  )
}
