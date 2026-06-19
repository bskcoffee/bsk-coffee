import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'
import {
  LogOut, ClipboardList, X, CheckCircle2, AlertCircle,
  Loader2, Trash2, Search, ChevronRight, Minus, Plus,
} from 'lucide-react'
import MenuOptionModal from '../components/MenuOptionModal'

// ── Constants ─────────────────────────────────────────────────
const PLATFORMS = ['GRAB', 'LINE', 'SHOPEE', 'The metro', 'TU']
const PLAT_STYLE = {
  GRAB:        'bg-green-500 text-white',
  LINE:        'bg-teal-500 text-white',
  SHOPEE:      'bg-orange-500 text-white',
  'The metro': 'bg-blue-500 text-white',
  TU:          'bg-purple-500 text-white',
}
const PLAT_INACTIVE = 'bg-white border-2 border-gray-200 text-gray-600'
const CAMPAIGN_GP_PCT = 5

const CAT_EMOJI = {
  Cocoa: '🍫', Coffee: '☕', Matcha: '🍵', Classic: '🧋',
  Hot: '🔥', Bun: '🥐', Refill: '🔄', Addon: '➕',
}

const today = () => format(new Date(), 'yyyy-MM-dd')
const fmt = (n) => new Intl.NumberFormat('th-TH', {
  style: 'currency', currency: 'THB', minimumFractionDigits: 0,
}).format(n)

// ══════════════════════════════════════════════════════════════
export default function POSPage() {
  const { signOut } = useAuth()

  // ── Remote data ──
  const [menus,       setMenus]       = useState([])
  const [addonMenus,  setAddonMenus]  = useState([])
  const [refillMenus, setRefillMenus] = useState([])
  const [platFees,    setPlatFees]    = useState({})
  const [loading,     setLoading]     = useState(true)

  // ── Order state ──
  const [quantities,  setQuantities]  = useState({})
  const [campaigns,   setCampaigns]   = useState({})
  const [menuOptions, setMenuOptions] = useState({})

  // ── UI state ──
  const [activeCategory, setActiveCategory] = useState('ทั้งหมด')
  const [searchQ,        setSearchQ]        = useState('')
  const [optionMenu,     setOptionMenu]     = useState(null)
  const [showConfirm,    setShowConfirm]    = useState(false)  // platform picker + confirm
  const [selectedPlat,   setSelectedPlat]   = useState(null)   // platform chosen in modal
  const [saving,         setSaving]         = useState(false)
  const [saveError,      setSaveError]      = useState(null)
  const [savedMsg,       setSavedMsg]       = useState(null)
  const [showOrders,     setShowOrders]     = useState(false)
  const [todayOrders,    setTodayOrders]    = useState([])
  const [loadingOrders,  setLoadingOrders]  = useState(false)
  const [deletingId,     setDeletingId]     = useState(null)
  const [time,           setTime]           = useState(new Date())

  const searchRef = useRef(null)

  // ── Clock ──
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  // ── Load data ──────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const ADDON_CATS  = ['Addon', 'addon', 'ADDON']
      const REFILL_CATS = ['Refill', 'refill', 'REFILL']
      const HIDDEN_CATS = [...ADDON_CATS, ...REFILL_CATS]

      const [menusRes, settingsRes] = await Promise.all([
        supabase.from('menus')
          .select('id, name, category, sort_order, image_url, menu_prices(platform, price)')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('name'),
        supabase.from('settings').select('key, value'),
      ])

      const allMenuList = (menusRes.data ?? []).map(m => {
        const prices = {}
        for (const p of m.menu_prices ?? []) prices[p.platform] = p.price
        return { ...m, prices }
      })

      setMenus(allMenuList.filter(m => !HIDDEN_CATS.includes(m.category)))
      setAddonMenus(allMenuList.filter(m => ADDON_CATS.includes(m.category)))
      setRefillMenus(allMenuList.filter(m => REFILL_CATS.includes(m.category)))

      const platConfigRow = (settingsRes.data ?? []).find(r => r.key === 'platform_config')
      if (platConfigRow) {
        try {
          const cfg = JSON.parse(platConfigRow.value)
          setPlatFees(Object.fromEntries(cfg.map(p => [p.name, p.fee ?? 0])))
        } catch {}
      }
    } catch (err) { console.error(err) }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Computed: addons/refills by platform ──────────────────
  // Platform known only at confirm time, so pass all prices
  // MenuOptionModal will receive full menu objects; we map on open
  const addonsForModal  = useMemo(() =>
    addonMenus.map(m => ({ id: m.id, name: m.name, prices: m.prices })),
  [addonMenus])

  const refillsForModal = useMemo(() =>
    refillMenus.map(m => ({ id: m.id, name: m.name, prices: m.prices })),
  [refillMenus])

  // ── Categories ────────────────────────────────────────────
  const categories = useMemo(() => {
    const cats = [...new Set(menus.map(m => m.category).filter(Boolean))]
    return ['ทั้งหมด', ...cats]
  }, [menus])

  // ── Filtered menus ────────────────────────────────────────
  const filteredMenus = useMemo(() => {
    let list = menus
    if (activeCategory !== 'ทั้งหมด') list = list.filter(m => m.category === activeCategory)
    if (searchQ.trim()) {
      const q = searchQ.trim().toLowerCase()
      list = list.filter(m => m.name.toLowerCase().includes(q))
    }
    return list
  }, [menus, activeCategory, searchQ])

  // ── Order items ───────────────────────────────────────────
  // Platform isn't chosen yet — use GRAB as reference for display, real price set at confirm
  const orderItems = useMemo(() =>
    Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([menuId, qty]) => {
        const menu = menus.find(m => m.id === menuId)
        const opts = menuOptions[menuId] ?? {}
        // Show price without platform-specific modifier until platform chosen
        const basePrice = Object.values(menu?.prices ?? {})[0] ?? 0  // any price for display
        const milkPrice   = opts.milk?.prices  ? 0 : (opts.milk?.price ?? 0)
        const refillPrice = opts.refill?.prices ? 0 : (opts.refill?.price ?? 0)
        return {
          menuId, qty,
          name: menu?.name ?? '',
          image_url: menu?.image_url ?? null,
          basePrice,
          extras: milkPrice + refillPrice,
          isCampaign: !!campaigns[menuId],
          options: opts,
          menu,
        }
      }),
  [quantities, menus, menuOptions, campaigns])

  const totalItems = orderItems.reduce((s, i) => s + i.qty, 0)

  // ── Order items with real platform price (at confirm) ─────
  const orderItemsWithPrice = useMemo(() => {
    if (!selectedPlat) return orderItems
    return orderItems.map(item => {
      const basePrice  = item.menu?.prices[selectedPlat] ?? 0
      const milkPrice  = item.options.milk?.prices?.[selectedPlat]
        ?? item.options.milk?.price ?? 0
      const refillPrice = item.options.refill?.prices?.[selectedPlat]
        ?? item.options.refill?.price ?? 0
      const unitPrice  = basePrice + milkPrice + refillPrice
      const feePct     = item.isCampaign ? CAMPAIGN_GP_PCT : (platFees[selectedPlat] ?? 0)
      return {
        ...item,
        basePrice, extras: milkPrice + refillPrice,
        unitPrice, subtotal: item.qty * unitPrice,
        unitGpCost: basePrice * feePct / 100,
      }
    })
  }, [orderItems, selectedPlat, platFees])

  const totalAmount = orderItemsWithPrice.reduce((s, i) => s + (i.subtotal ?? 0), 0)

  // ── Handlers ──────────────────────────────────────────────
  const increment = (menu) => {
    if ((quantities[menu.id] ?? 0) === 0) {
      setOptionMenu(menu)
    } else {
      setQuantities(q => ({ ...q, [menu.id]: q[menu.id] + 1 }))
    }
  }

  const decrement = (menuId) => {
    setQuantities(q => {
      const next = (q[menuId] ?? 0) - 1
      if (next <= 0) {
        const { [menuId]: _q, ...restQ } = q
        const { [menuId]: _c, ...restC } = campaigns
        const { [menuId]: _o, ...restO } = menuOptions
        setCampaigns(restC)
        setMenuOptions(restO)
        return restQ
      }
      return { ...q, [menuId]: next }
    })
  }

  const handleOptionConfirm = (opts) => {
    if (!optionMenu) return
    setMenuOptions(prev => ({ ...prev, [optionMenu.id]: opts }))
    setQuantities(prev => ({ ...prev, [optionMenu.id]: (prev[optionMenu.id] ?? 0) + 1 }))
    setOptionMenu(null)
  }

  const toggleCampaign = (menuId) =>
    setCampaigns(c => ({ ...c, [menuId]: !c[menuId] }))

  const removeItem = (menuId) => {
    setQuantities(q => { const { [menuId]: _, ...rest } = q; return rest })
    setCampaigns(c => { const { [menuId]: _, ...rest } = c; return rest })
    setMenuOptions(o => { const { [menuId]: _, ...rest } = o; return rest })
  }

  const resetOrder = () => {
    setQuantities({})
    setCampaigns({})
    setMenuOptions({})
    setSaveError(null)
    setSelectedPlat(null)
  }

  const openConfirm = () => {
    setSelectedPlat(null)
    setSaveError(null)
    setShowConfirm(true)
  }

  // ── Save ──────────────────────────────────────────────────
  const saveOrder_fn = async () => {
    if (!selectedPlat || orderItemsWithPrice.length === 0) return
    setSaving(true)
    setSaveError(null)
    try {
      const date = today()
      const { data: existing } = await supabase
        .from('orders').select('id').eq('date', date).eq('platform', selectedPlat).maybeSingle()

      let orderId
      if (existing) {
        orderId = existing.id
        const { data: existingItems } = await supabase
          .from('order_items')
          .select('menu_id, quantity, unit_price, unit_gp_cost, is_campaign, item_options')
          .eq('order_id', orderId)

        const merged = {}
        for (const item of existingItems ?? []) {
          merged[item.menu_id] = {
            qty: item.quantity, price: item.unit_price,
            gpCost: item.unit_gp_cost, isCampaign: item.is_campaign,
            options: item.item_options ?? {},
          }
        }
        for (const item of orderItemsWithPrice) {
          if (merged[item.menuId]) {
            merged[item.menuId].qty += item.qty
          } else {
            merged[item.menuId] = {
              qty: item.qty, price: item.unitPrice,
              gpCost: item.unitGpCost, isCampaign: item.isCampaign,
              options: {
                milk: item.options.milk ?? null,
                sweetness: item.options.sweetness ?? 100,
                refill: item.options.refill ?? null,
                note: item.options.note ?? '',
              },
            }
          }
        }

        await supabase.from('order_items').delete().eq('order_id', orderId)
        const toInsert = Object.entries(merged).map(([menuId, v]) => ({
          order_id: orderId, menu_id: menuId, quantity: v.qty,
          unit_price: v.price, unit_gp_cost: v.gpCost, is_campaign: v.isCampaign,
          item_options: v.options,
        }))
        const { error } = await supabase.from('order_items').insert(toInsert)
        if (error) throw error
      } else {
        const { data: newOrder, error: orderErr } = await supabase
          .from('orders').insert({ date, platform: selectedPlat }).select('id').single()
        if (orderErr) throw orderErr
        orderId = newOrder.id

        const toInsert = orderItemsWithPrice.map(item => ({
          order_id: orderId, menu_id: item.menuId, quantity: item.qty,
          unit_price: item.unitPrice, unit_gp_cost: item.unitGpCost, is_campaign: item.isCampaign,
          item_options: {
            milk: item.options.milk ?? null,
            sweetness: item.options.sweetness ?? 100,
            refill: item.options.refill ?? null,
            note: item.options.note ?? '',
          },
        }))
        const { error } = await supabase.from('order_items').insert(toInsert)
        if (error) throw error
      }

      setSavedMsg({ itemCount: totalItems, total: totalAmount, platform: selectedPlat })
      resetOrder()
      setShowConfirm(false)
      setTimeout(() => setSavedMsg(null), 4000)
    } catch (err) {
      console.error(err)
      setSaveError('บันทึกไม่สำเร็จ กรุณาลองใหม่')
    }
    setSaving(false)
  }

  // ── Today's orders ────────────────────────────────────────
  const loadTodayOrders = useCallback(async () => {
    setLoadingOrders(true)
    try {
      const { data: orders } = await supabase
        .from('orders').select('id, platform, created_at')
        .eq('date', today()).order('created_at', { ascending: false })
      if (!orders?.length) { setTodayOrders([]); setLoadingOrders(false); return }

      const { data: items } = await supabase
        .from('order_items')
        .select('order_id, quantity, unit_price, item_options, menus(name)')
        .in('order_id', orders.map(o => o.id))

      const byOrder = {}
      for (const item of items ?? []) {
        if (!byOrder[item.order_id]) byOrder[item.order_id] = []
        byOrder[item.order_id].push(item)
      }
      setTodayOrders(orders.map(o => ({
        ...o,
        items: byOrder[o.id] ?? [],
        total: (byOrder[o.id] ?? []).reduce((s, i) => s + i.quantity * i.unit_price, 0),
      })))
    } catch (err) { console.error(err) }
    setLoadingOrders(false)
  }, [])

  useEffect(() => { if (showOrders) loadTodayOrders() }, [showOrders, loadTodayOrders])

  const deleteOrder = async (orderId) => {
    if (!window.confirm('ลบออเดอร์นี้?')) return
    setDeletingId(orderId)
    try {
      await supabase.from('order_items').delete().eq('order_id', orderId)
      await supabase.from('orders').delete().eq('id', orderId)
      await loadTodayOrders()
    } catch (err) { console.error(err) }
    setDeletingId(null)
  }

  // ══════════════════════════════════════════════════════════
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={36} className="text-cocoa-600 animate-spin" />
          <p className="text-gray-400 text-sm">กำลังโหลด...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50">

      {/* ── Top Bar ─────────────────────────────────────────── */}
      <div className="bg-cocoa-800 text-white px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">🍫</span>
          <div>
            <p className="font-bold text-sm leading-tight">Cocoa House POS</p>
            <p className="text-cocoa-300 text-[11px]">
              {format(time, 'EEEE d MMM yyyy', { locale: th })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {savedMsg && (
            <div className="flex items-center gap-1.5 bg-green-600 text-white text-xs px-3 py-1.5 rounded-lg font-medium animate-pulse">
              <CheckCircle2 size={14} />
              บันทึกแล้ว · {savedMsg.platform} · {fmt(savedMsg.total)}
            </div>
          )}
          <button
            onClick={() => setShowOrders(true)}
            className="flex items-center gap-1.5 bg-cocoa-700 hover:bg-cocoa-600 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
          >
            <ClipboardList size={14} /> ออเดอร์วันนี้
          </button>
          <button onClick={signOut} className="p-1.5 hover:bg-cocoa-700 rounded-lg transition-colors">
            <LogOut size={16} />
          </button>
        </div>
      </div>

      {/* ── 3-Panel Body ────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Panel 1: Category Rail ───────────────────────── */}
        <div className="w-20 bg-cocoa-900 flex flex-col overflow-y-auto shrink-0">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => { setActiveCategory(cat); setSearchQ('') }}
              className={`flex flex-col items-center justify-center gap-1 px-1 py-3 text-center transition-all
                ${activeCategory === cat
                  ? 'bg-cocoa-600 text-white'
                  : 'text-cocoa-400 hover:bg-cocoa-800 hover:text-cocoa-200'
                }`}
            >
              <span className="text-xl leading-none">
                {cat === 'ทั้งหมด' ? '🍽️' : (CAT_EMOJI[cat] ?? '🍹')}
              </span>
              <span className="text-[9px] font-medium leading-tight break-all">{cat}</span>
            </button>
          ))}
        </div>

        {/* ── Panel 2: Menu Grid ───────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Search bar */}
          <div className="bg-white border-b border-gray-100 px-3 py-2.5 shrink-0">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
              <Search size={15} className="text-gray-400 shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                placeholder="ค้นหาเมนู..."
                className="flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder-gray-400"
              />
              {searchQ && (
                <button onClick={() => setSearchQ('')} className="text-gray-400 hover:text-gray-600">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Menu count */}
          <div className="px-3 pt-2 pb-1 shrink-0">
            <p className="text-xs text-gray-400">{filteredMenus.length} เมนู{activeCategory !== 'ทั้งหมด' ? ` ใน ${activeCategory}` : ''}</p>
          </div>

          {/* Grid */}
          {filteredMenus.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <p className="text-2xl mb-2">🔍</p>
                <p className="text-sm">ไม่พบเมนู</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-2 pb-2">
              <div className="grid grid-cols-3 gap-2 pt-1">
                {filteredMenus.map(menu => {
                  const qty    = quantities[menu.id] ?? 0
                  const hasQty = qty > 0
                  const opts   = menuOptions[menu.id] ?? {}

                  return (
                    <div
                      key={menu.id}
                      className={`bg-white rounded-xl overflow-hidden border transition-all cursor-pointer
                        ${hasQty
                          ? 'border-cocoa-400 shadow-sm'
                          : 'border-gray-100 hover:border-gray-200'
                        }`}
                    >
                      {/* Image */}
                      <button
                        className="w-full relative"
                        onClick={() => hasQty && setOptionMenu(menu)}
                      >
                        {menu.image_url ? (
                          <div className="w-full" style={{ paddingBottom: '70%', position: 'relative' }}>
                            <img
                              src={menu.image_url}
                              alt={menu.name}
                              className="absolute inset-0 w-full h-full object-cover"
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <div className={`w-full flex items-center justify-center text-3xl
                            ${hasQty ? 'bg-cocoa-50' : 'bg-gray-50'}`}
                            style={{ paddingBottom: '70%', position: 'relative' }}>
                            <span className="absolute inset-0 flex items-center justify-center">🍫</span>
                          </div>
                        )}
                        {/* Qty badge */}
                        {hasQty && (
                          <div className="absolute top-1.5 right-1.5 bg-cocoa-700 text-white text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center shadow">
                            {qty}
                          </div>
                        )}
                      </button>

                      {/* Info */}
                      <div className="px-2 pt-1.5 pb-1">
                        <p className="text-xs font-semibold text-gray-900 leading-tight line-clamp-2 min-h-[2.2em]">
                          {menu.name}
                        </p>
                        {/* Options summary */}
                        {hasQty && (opts.milk || opts.refill) && (
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            {opts.milk   && <span className="text-[9px] bg-blue-50 text-blue-600 px-1 py-0.5 rounded">{opts.milk.name}</span>}
                            {opts.refill && <span className="text-[9px] bg-purple-50 text-purple-600 px-1 py-0.5 rounded">{opts.refill.name}</span>}
                            {opts.sweetness != null && opts.sweetness !== 100 && (
                              <span className="text-[9px] bg-amber-50 text-amber-600 px-1 py-0.5 rounded">{opts.sweetness}%</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Controls */}
                      <div className="flex items-center justify-between px-2 pb-2 gap-1">
                        <button
                          onPointerDown={() => decrement(menu.id)}
                          disabled={!hasQty}
                          className="w-8 h-8 rounded-lg bg-gray-100 active:bg-gray-200 disabled:opacity-20
                                     flex items-center justify-center text-base font-bold text-gray-600 transition-all"
                        >
                          <Minus size={14} />
                        </button>
                        <button
                          onPointerDown={() => increment(menu)}
                          className="flex-1 h-8 rounded-lg bg-cocoa-700 active:bg-cocoa-900 text-white
                                     flex items-center justify-center text-xs font-bold transition-all"
                        >
                          {hasQty ? <Plus size={14} /> : '+ เพิ่ม'}
                        </button>
                      </div>

                      {/* Campaign toggle */}
                      {hasQty && (
                        <div className="px-2 pb-2 -mt-1">
                          <button
                            onClick={() => toggleCampaign(menu.id)}
                            className={`w-full py-1 rounded-lg text-[10px] font-bold transition-all
                              ${campaigns[menu.id]
                                ? 'bg-amber-100 text-amber-700 border border-amber-300'
                                : 'bg-gray-50 text-gray-400 border border-gray-200'
                              }`}
                          >
                            {campaigns[menu.id] ? '⚡ Campaign 60/40' : '60/40'}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Panel 3: Order Summary ───────────────────────── */}
        <div className="w-72 bg-white border-l border-gray-100 flex flex-col shrink-0">

          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
            <div>
              <p className="font-bold text-gray-900 text-sm">รายการออเดอร์</p>
              <p className="text-xs text-gray-400">{totalItems} รายการ</p>
            </div>
            {totalItems > 0 && (
              <button
                onClick={resetOrder}
                className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
              >
                ล้างทั้งหมด
              </button>
            )}
          </div>

          {/* Items list */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
            {orderItems.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-300 text-center py-8">
                <div>
                  <p className="text-3xl mb-2">🛒</p>
                  <p className="text-sm">ยังไม่มีรายการ<br/>กดเมนูเพื่อเพิ่ม</p>
                </div>
              </div>
            ) : (
              orderItems.map(item => (
                <div key={item.menuId} className="bg-gray-50 rounded-xl p-2.5">
                  <div className="flex items-start gap-2">
                    {/* Thumbnail */}
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.name}
                        className="w-10 h-10 rounded-lg object-cover shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-gray-200 flex items-center justify-center text-lg shrink-0">🍫</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-900 leading-tight truncate">{item.name}</p>
                      {/* Options */}
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {item.options.milk   && <span className="text-[9px] bg-blue-100 text-blue-700 px-1 py-0.5 rounded">{item.options.milk.name}</span>}
                        {item.options.refill && <span className="text-[9px] bg-purple-100 text-purple-700 px-1 py-0.5 rounded">{item.options.refill.name}</span>}
                        {item.options.sweetness != null && item.options.sweetness !== 100 && (
                          <span className="text-[9px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded">{item.options.sweetness}%</span>
                        )}
                        {item.options.note && <span className="text-[9px] bg-gray-200 text-gray-600 px-1 py-0.5 rounded truncate max-w-[80px]">📝{item.options.note}</span>}
                      </div>
                    </div>
                    <button onClick={() => removeItem(item.menuId)} className="text-gray-300 hover:text-red-400 p-0.5">
                      <X size={14} />
                    </button>
                  </div>

                  {/* Qty controls */}
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => decrement(item.menuId)}
                        className="w-6 h-6 rounded-md bg-white border border-gray-200 flex items-center justify-center active:bg-gray-100"
                      >
                        <Minus size={11} />
                      </button>
                      <span className="text-sm font-bold text-gray-900 min-w-[1.2rem] text-center">{item.qty}</span>
                      <button
                        onClick={() => increment(item.menu)}
                        className="w-6 h-6 rounded-md bg-cocoa-700 flex items-center justify-center active:bg-cocoa-900"
                      >
                        <Plus size={11} className="text-white" />
                      </button>
                    </div>
                    {item.isCampaign && (
                      <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">⚡60/40</span>
                    )}
                    <p className="text-xs text-gray-500">× {item.qty}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-100 p-4 shrink-0">
            <p className="text-xs text-gray-400 text-center mb-3">ราคาจะคำนวณตาม Platform ที่เลือก</p>
            <button
              onClick={openConfirm}
              disabled={totalItems === 0}
              className={`w-full py-4 rounded-xl font-bold text-base transition-all
                ${totalItems > 0
                  ? 'bg-cocoa-700 text-white active:bg-cocoa-900 active:scale-[0.98]'
                  : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                }`}
            >
              {totalItems > 0 ? `ยืนยันออเดอร์ (${totalItems})` : 'เลือกเมนูก่อน'}
            </button>
          </div>
        </div>
      </div>

      {/* ══ Menu Option Modal ════════════════════════════════ */}
      {optionMenu && (
        <MenuOptionModal
          menu={optionMenu}
          platform={selectedPlat ?? PLATFORMS[0]}
          addons={addonsForModal.map(a => ({ ...a, price: a.prices?.[selectedPlat ?? PLATFORMS[0]] ?? 0 }))}
          refills={refillsForModal.map(r => ({ ...r, price: r.prices?.[selectedPlat ?? PLATFORMS[0]] ?? 0 }))}
          initial={menuOptions[optionMenu.id] ?? null}
          onConfirm={handleOptionConfirm}
          onClose={() => setOptionMenu(null)}
        />
      )}

      {/* ══ Confirm Modal (Platform picker + Order summary) ══ */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl">

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
              <h2 className="text-base font-bold text-gray-900">ยืนยันออเดอร์</h2>
              <button onClick={() => setShowConfirm(false)} className="p-1.5 rounded-lg bg-gray-100 active:bg-gray-200">
                <X size={18} />
              </button>
            </div>

            {/* Platform picker */}
            <div className="px-5 pb-4 shrink-0">
              <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">เลือก Platform</p>
              <div className="grid grid-cols-3 gap-2">
                {PLATFORMS.map(p => (
                  <button
                    key={p}
                    onClick={() => setSelectedPlat(p)}
                    className={`py-3 rounded-xl text-sm font-bold transition-all active:scale-95
                      ${selectedPlat === p
                        ? (PLAT_STYLE[p] ?? 'bg-cocoa-600 text-white')
                        : PLAT_INACTIVE
                      }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Order items (shown after platform selected) */}
            {selectedPlat && (
              <div className="flex-1 overflow-y-auto px-5 pb-2">
                <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">รายการ</p>
                <div className="space-y-2">
                  {orderItemsWithPrice.map(item => (
                    <div key={item.menuId} className="flex items-center justify-between gap-3 border-b border-gray-50 pb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                        <div className="flex gap-1 mt-0.5 flex-wrap">
                          {item.options.milk   && <span className="text-[10px] text-blue-600">{item.options.milk.name}</span>}
                          {item.options.refill && <span className="text-[10px] text-purple-600">{item.options.refill.name}</span>}
                          {item.isCampaign && <span className="text-[10px] text-amber-600 font-bold">⚡60/40</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-gray-400">{item.qty} × {fmt(item.unitPrice)}</p>
                        <p className="text-sm font-bold text-gray-900">{fmt(item.subtotal)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="px-5 pb-5 pt-3 border-t border-gray-100 shrink-0">
              {selectedPlat && (
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm text-gray-600 font-medium">ยอดรวม</span>
                  <span className="text-xl font-bold text-cocoa-700">{fmt(totalAmount)}</span>
                </div>
              )}

              {saveError && (
                <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-xl px-4 py-2.5 mb-3">
                  <AlertCircle size={16} className="shrink-0" />
                  <p className="text-sm">{saveError}</p>
                </div>
              )}

              <button
                onClick={saveOrder_fn}
                disabled={saving || !selectedPlat}
                className={`w-full py-4 rounded-xl font-bold text-base transition-all
                  ${selectedPlat && !saving
                    ? 'bg-cocoa-700 text-white active:bg-cocoa-900'
                    : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                  }`}
              >
                {saving ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 size={18} className="animate-spin" /> กำลังบันทึก...
                  </span>
                ) : selectedPlat ? (
                  <span className="flex items-center justify-center gap-2">
                    <CheckCircle2 size={18} /> บันทึกออเดอร์ · {selectedPlat}
                  </span>
                ) : 'เลือก Platform ก่อน'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Today's Orders Panel ════════════════════════════ */}
      {showOrders && (
        <div className="fixed inset-0 bg-black/50 flex items-end z-50">
          <div className="bg-white rounded-t-3xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
              <div>
                <h2 className="text-base font-bold text-gray-900">ออเดอร์วันนี้</h2>
                <p className="text-xs text-gray-400">{format(new Date(), 'd MMM yyyy', { locale: th })}</p>
              </div>
              <button onClick={() => setShowOrders(false)} className="p-2 rounded-xl bg-gray-100">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-6">
              {loadingOrders ? (
                <div className="flex justify-center py-10">
                  <Loader2 size={28} className="animate-spin text-cocoa-500" />
                </div>
              ) : todayOrders.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <ClipboardList size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">ยังไม่มีออเดอร์วันนี้</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {todayOrders.map(order => (
                    <div key={order.id} className="bg-gray-50 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${PLAT_STYLE[order.platform] ?? 'bg-gray-200 text-gray-700'}`}>
                          {order.platform}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-cocoa-700">{fmt(order.total)}</span>
                          <button
                            onClick={() => deleteOrder(order.id)}
                            disabled={deletingId === order.id}
                            className="p-1.5 rounded-lg bg-red-50 text-red-400 active:bg-red-100"
                          >
                            {deletingId === order.id
                              ? <Loader2 size={14} className="animate-spin" />
                              : <Trash2 size={14} />}
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1">
                        {order.items.map((item, idx) => (
                          <div key={idx} className="flex justify-between text-xs text-gray-600">
                            <span>{item.menus?.name ?? '?'}</span>
                            <span>×{item.quantity}</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-gray-300 mt-2">
                        {format(new Date(order.created_at), 'HH:mm น.')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
