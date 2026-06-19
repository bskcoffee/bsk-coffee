import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { format, subDays } from 'date-fns'
import { th } from 'date-fns/locale'
import {
  LogOut, ClipboardList, X, CheckCircle2, AlertCircle,
  Loader2, Trash2, Search, Minus, Plus, GripVertical,
  LayoutGrid, Save,
} from 'lucide-react'
import MenuOptionModal from '../components/MenuOptionModal'

// ── Constants ─────────────────────────────────────────────────
const PLATFORMS = ['GRAB', 'LINE', 'SHOPEE', 'The metro', 'TU']
const PLAT_STYLE = {
  GRAB: 'bg-green-500 text-white', LINE: 'bg-teal-500 text-white',
  SHOPEE: 'bg-orange-500 text-white', 'The metro': 'bg-blue-500 text-white',
  TU: 'bg-purple-500 text-white',
}
const PLAT_INACTIVE = 'bg-white border-2 border-gray-200 text-gray-600'
const PLAT_PREFIX = {
  GRAB: 'GF-', LINE: 'LM-', SHOPEE: 'SP-', 'The metro': 'TM-', TU: 'TU-',
}
const CAMPAIGN_GP_PCT = 5
const CAT_EMOJI = {
  Cocoa: '🍫', Coffee: '☕', Matcha: '🍵', Classic: '🧋',
  Hot: '🔥', Bun: '🥐', Refill: '🔄', Addon: '➕',
}

const todayStr  = () => format(new Date(), 'yyyy-MM-dd')
const fmt = n => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 0 }).format(n)

// ── Drag-sort hook — document-level listeners (iOS safe) ──────
// ใช้ document listeners แทน pointer capture เพื่อให้ onPointerMove
// fire ได้ถูกต้องแม้ pointer อยู่บน element อื่น
function useDragSort() {
  const ref = useRef(null)
  const [draggingIdx, setDraggingIdx] = useState(null)

  const startDrag = useCallback((e, idx, items, setItems, dataAttr) => {
    e.stopPropagation()
    ref.current = { currentIdx: idx, items: [...items], setItems, dataAttr }
    setDraggingIdx(idx)

    const handleMove = (ev) => {
      if (!ref.current) return
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(`[${ref.current.dataAttr}]`)
      if (!el) return
      const toIdx = parseInt(el.getAttribute(ref.current.dataAttr))
      if (isNaN(toIdx) || toIdx === ref.current.currentIdx) return
      const next = [...ref.current.items]
      const [moved] = next.splice(ref.current.currentIdx, 1)
      next.splice(toIdx, 0, moved)
      ref.current.items = next
      ref.current.currentIdx = toIdx
      ref.current.setItems(next)
      setDraggingIdx(toIdx)
    }

    const handleEnd = () => {
      ref.current = null
      setDraggingIdx(null)
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup',   handleEnd)
      document.removeEventListener('pointercancel', handleEnd)
    }

    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup',   handleEnd)
    document.addEventListener('pointercancel', handleEnd)
  }, [])

  return { draggingIdx, startDrag }
}

// ══════════════════════════════════════════════════════════════
export default function POSPage() {
  const { signOut } = useAuth()

  // ── Remote data ──
  const [menus,        setMenus]        = useState([])
  const [addonMenus,   setAddonMenus]   = useState([])
  const [refillMenus,  setRefillMenus]  = useState([])
  const [platFees,     setPlatFees]     = useState({})
  const [loading,      setLoading]      = useState(true)

  // ── Order state ──
  const [quantities,   setQuantities]   = useState({})
  const [campaigns,    setCampaigns]    = useState({})
  const [menuOptions,  setMenuOptions]  = useState({})

  // ── Layout / edit mode ──
  const [catEditMode,  setCatEditMode]  = useState(false)
  const [menuEditMode, setMenuEditMode] = useState(false)
  const [catOrder,     setCatOrder]     = useState([])  // custom category order
  const [menuOrder,    setMenuOrder]    = useState([])  // current view menu order (ids)
  const [savingLayout, setSavingLayout] = useState(false)
  // snapshots for cancel
  const catOrderSnap  = useRef([])
  const menuOrderSnap = useRef([])

  // ── UI state ──
  const [activeCategory, setActiveCategory] = useState('ทั้งหมด')
  const [searchQ,        setSearchQ]        = useState('')
  const [optionMenu,     setOptionMenu]     = useState(null)
  const [showConfirm,    setShowConfirm]    = useState(false)
  const [selectedPlat,   setSelectedPlat]   = useState(null)
  const [orderDate,      setOrderDate]      = useState(todayStr())  // วันที่บันทึกออเดอร์
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [orderRef,       setOrderRef]       = useState('')   // หมายเลขออเดอร์ / ชื่อผู้รับ
  const [saving,         setSaving]         = useState(false)
  const [saveError,      setSaveError]      = useState(null)
  const [savedMsg,       setSavedMsg]       = useState(null)
  const [showOrders,     setShowOrders]     = useState(false)
  const [todayOrders,    setTodayOrders]    = useState([])
  const [loadingOrders,  setLoadingOrders]  = useState(false)
  const [deletingId,     setDeletingId]     = useState(null)
  const [time,           setTime]           = useState(new Date())

  // ── Drag hooks ──
  const catDrag  = useDragSort()   // { draggingIdx, startDrag }
  const menuDrag = useDragSort()   // { draggingIdx, startDrag }

  // ── Clock ──
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  // ── Load data ─────────────────────────────────────────────
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

      const mainMenus = allMenuList.filter(m => !HIDDEN_CATS.includes(m.category))
      setMenus(mainMenus)
      setAddonMenus(allMenuList.filter(m => ADDON_CATS.includes(m.category)))
      setRefillMenus(allMenuList.filter(m => REFILL_CATS.includes(m.category)))

      // Load custom category order
      const settings = settingsRes.data ?? []
      const catOrderRow = settings.find(r => r.key === 'pos_cat_order')
      if (catOrderRow) {
        try {
          const saved = JSON.parse(catOrderRow.value)
          const rawCats = [...new Set(mainMenus.map(m => m.category).filter(Boolean))]
          // Merge saved order with new categories
          const ordered = [...saved.filter(c => rawCats.includes(c)), ...rawCats.filter(c => !saved.includes(c))]
          setCatOrder(['ทั้งหมด', ...ordered])
        } catch { _buildDefaultCatOrder(mainMenus) }
      } else {
        _buildDefaultCatOrder(mainMenus)
      }

      const platConfigRow = settings.find(r => r.key === 'platform_config')
      if (platConfigRow) {
        try {
          const cfg = JSON.parse(platConfigRow.value)
          setPlatFees(Object.fromEntries(cfg.map(p => [p.name, p.fee ?? 0])))
        } catch {}
      }
    } catch (err) { console.error(err) }
    setLoading(false)
  }, [])

  const _buildDefaultCatOrder = (mainMenus) => {
    const cats = [...new Set(mainMenus.map(m => m.category).filter(Boolean))]
    setCatOrder(['ทั้งหมด', ...cats])
  }

  useEffect(() => { loadData() }, [loadData])

  // ── Filtered menus (sorted by menuOrder when set) ─────────
  const filteredMenus = useMemo(() => {
    let list = menus
    if (activeCategory !== 'ทั้งหมด') list = list.filter(m => m.category === activeCategory)
    if (searchQ.trim()) {
      const q = searchQ.trim().toLowerCase()
      list = list.filter(m => m.name.toLowerCase().includes(q))
    }
    return list
  }, [menus, activeCategory, searchQ])

  // Ordered menus for display (respects menuOrder in edit mode)
  const displayMenus = useMemo(() => {
    if (menuOrder.length === 0) return filteredMenus
    const byId = Object.fromEntries(filteredMenus.map(m => [m.id, m]))
    const ordered = menuOrder.map(id => byId[id]).filter(Boolean)
    const extras  = filteredMenus.filter(m => !menuOrder.includes(m.id))
    return [...ordered, ...extras]
  }, [filteredMenus, menuOrder])

  // ── Sync menuOrder when category/menus change ─────────────
  useEffect(() => {
    if (!menuEditMode) {
      setMenuOrder(filteredMenus.map(m => m.id))
    }
  }, [filteredMenus, menuEditMode])

  // ── Edit mode handlers ────────────────────────────────────
  const enterCatEdit = () => {
    catOrderSnap.current = [...catOrder]
    setCatEditMode(true)
  }
  const cancelCatEdit = () => {
    setCatOrder(catOrderSnap.current)
    setCatEditMode(false)
  }
  const saveCatOrder = async () => {
    setSavingLayout(true)
    try {
      const orderToSave = catOrder.filter(c => c !== 'ทั้งหมด')
      await supabase.from('settings')
        .upsert({ key: 'pos_cat_order', value: JSON.stringify(orderToSave) }, { onConflict: 'key' })
      setCatEditMode(false)
    } catch (err) { console.error(err) }
    setSavingLayout(false)
  }

  const enterMenuEdit = () => {
    // Only allow when specific category selected (not search, not "ทั้งหมด")
    menuOrderSnap.current = [...menuOrder]
    setMenuEditMode(true)
  }
  const cancelMenuEdit = () => {
    setMenuOrder(menuOrderSnap.current)
    setMenuEditMode(false)
  }
  const saveMenuOrder = async () => {
    setSavingLayout(true)
    try {
      // Batch update sort_order for each menu
      const updates = menuOrder.map((id, idx) =>
        supabase.from('menus').update({ sort_order: idx * 10 }).eq('id', id)
      )
      await Promise.all(updates)
      // Update local menus sort_order
      setMenus(prev => {
        const orderMap = Object.fromEntries(menuOrder.map((id, i) => [id, i * 10]))
        return [...prev].sort((a, b) => (orderMap[a.id] ?? 999) - (orderMap[b.id] ?? 999))
      })
      setMenuEditMode(false)
    } catch (err) { console.error(err) }
    setSavingLayout(false)
  }

  // ── Computed: addons/refills ──────────────────────────────
  const addonsForModal  = useMemo(() => addonMenus.map(m => ({ id: m.id, name: m.name, prices: m.prices })), [addonMenus])
  const refillsForModal = useMemo(() => refillMenus.map(m => ({ id: m.id, name: m.name, prices: m.prices })), [refillMenus])

  // ── Order items ───────────────────────────────────────────
  const orderItems = useMemo(() =>
    Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([menuId, qty]) => {
        const menu = menus.find(m => m.id === menuId)
        const opts = menuOptions[menuId] ?? {}
        const basePrice   = Object.values(menu?.prices ?? {})[0] ?? 0
        const milkPrice   = opts.milk?.price ?? 0
        const refillPrice = opts.refill?.price ?? 0
        return { menuId, qty, name: menu?.name ?? '', image_url: menu?.image_url ?? null,
          basePrice, extras: milkPrice + refillPrice, isCampaign: !!campaigns[menuId], options: opts, menu }
      }),
  [quantities, menus, menuOptions, campaigns])

  const totalItems = orderItems.reduce((s, i) => s + i.qty, 0)

  const orderItemsWithPrice = useMemo(() => {
    if (!selectedPlat) return orderItems
    return orderItems.map(item => {
      const basePrice   = item.menu?.prices[selectedPlat] ?? 0
      const milkPrice   = item.options.milk?.prices?.[selectedPlat] ?? item.options.milk?.price ?? 0
      const refillPrice = item.options.refill?.prices?.[selectedPlat] ?? item.options.refill?.price ?? 0
      const unitPrice   = basePrice + milkPrice + refillPrice
      const feePct      = item.isCampaign ? CAMPAIGN_GP_PCT : (platFees[selectedPlat] ?? 0)
      return { ...item, basePrice, extras: milkPrice + refillPrice,
        unitPrice, subtotal: item.qty * unitPrice, unitGpCost: basePrice * feePct / 100 }
    })
  }, [orderItems, selectedPlat, platFees])

  const totalAmount = orderItemsWithPrice.reduce((s, i) => s + (i.subtotal ?? 0), 0)

  // ── Handlers ─────────────────────────────────────────────
  const increment = (menu) => {
    if (menuEditMode || catEditMode) return
    if ((quantities[menu.id] ?? 0) === 0) setOptionMenu(menu)
    else setQuantities(q => ({ ...q, [menu.id]: q[menu.id] + 1 }))
  }
  const decrement = (menuId) => {
    setQuantities(q => {
      const next = (q[menuId] ?? 0) - 1
      if (next <= 0) {
        const { [menuId]: _q, ...rQ } = q
        setCampaigns(c => { const { [menuId]: _, ...r } = c; return r })
        setMenuOptions(o => { const { [menuId]: _, ...r } = o; return r })
        return rQ
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
  const toggleCampaign = (menuId) => setCampaigns(c => ({ ...c, [menuId]: !c[menuId] }))
  const removeItem = (menuId) => {
    setQuantities(q => { const { [menuId]: _, ...r } = q; return r })
    setCampaigns(c => { const { [menuId]: _, ...r } = c; return r })
    setMenuOptions(o => { const { [menuId]: _, ...r } = o; return r })
  }
  const resetOrder  = () => { setQuantities({}); setCampaigns({}); setMenuOptions({}); setSaveError(null); setSelectedPlat(null) }
  const openConfirm = () => { setSelectedPlat(null); setSaveError(null); setShowConfirm(true) }

  // ── Save order ────────────────────────────────────────────
  const saveOrder_fn = async () => {
    if (!selectedPlat || orderItemsWithPrice.length === 0) return
    setSaving(true); setSaveError(null)
    try {
      const date = orderDate
      const { data: existing } = await supabase.from('orders')
        .select('id').eq('date', date).eq('platform', selectedPlat).maybeSingle()

      let orderId
      if (existing) {
        orderId = existing.id
        const { data: existingItems } = await supabase.from('order_items')
          .select('menu_id, quantity, unit_price, unit_gp_cost, is_campaign, item_options').eq('order_id', orderId)
        const merged = {}
        for (const item of existingItems ?? []) {
          merged[item.menu_id] = { qty: item.quantity, price: item.unit_price, gpCost: item.unit_gp_cost, isCampaign: item.is_campaign, options: item.item_options ?? {} }
        }
        for (const item of orderItemsWithPrice) {
          if (merged[item.menuId]) merged[item.menuId].qty += item.qty
          else merged[item.menuId] = { qty: item.qty, price: item.unitPrice, gpCost: item.unitGpCost, isCampaign: item.isCampaign,
            options: { milk: item.options.milk ?? null, sweetness: item.options.sweetness ?? 100, refill: item.options.refill ?? null, note: item.options.note ?? '' } }
        }
        await supabase.from('order_items').delete().eq('order_id', orderId)
        const { error } = await supabase.from('order_items').insert(
          Object.entries(merged).map(([menuId, v]) => ({
            order_id: orderId, menu_id: menuId, quantity: v.qty,
            unit_price: v.price, unit_gp_cost: v.gpCost, is_campaign: v.isCampaign, item_options: v.options }))
        )
        if (error) throw error
      } else {
        const { data: newOrder, error: orderErr } = await supabase.from('orders')
          .insert({ date, platform: selectedPlat, notes: orderRef.trim() ? `${PLAT_PREFIX[selectedPlat] ?? ''}${orderRef.trim()}` : null }).select('id').single()
        if (orderErr) throw orderErr
        orderId = newOrder.id
        const { error } = await supabase.from('order_items').insert(
          orderItemsWithPrice.map(item => ({
            order_id: orderId, menu_id: item.menuId, quantity: item.qty,
            unit_price: item.unitPrice, unit_gp_cost: item.unitGpCost, is_campaign: item.isCampaign,
            item_options: { milk: item.options.milk ?? null, sweetness: item.options.sweetness ?? 100, refill: item.options.refill ?? null, note: item.options.note ?? '' } }))
        )
        if (error) throw error
      }
      setSavedMsg({ itemCount: totalItems, total: totalAmount, platform: selectedPlat })
      resetOrder(); setShowConfirm(false); setOrderRef(''); setOrderDate(todayStr())
      setTimeout(() => setSavedMsg(null), 6000)
    } catch (err) { console.error(err); setSaveError('บันทึกไม่สำเร็จ กรุณาลองใหม่') }
    setSaving(false)
  }

  // ── Today's orders ────────────────────────────────────────
  const loadTodayOrders = useCallback(async () => {
    setLoadingOrders(true)
    try {
      const { data: orders } = await supabase.from('orders').select('id, platform, created_at')
        .eq('date', todayStr()).order('created_at', { ascending: false })
      if (!orders?.length) { setTodayOrders([]); return }
      const { data: items } = await supabase.from('order_items')
        .select('order_id, quantity, unit_price, menus(name)').in('order_id', orders.map(o => o.id))
      const byOrder = {}
      for (const item of items ?? []) { if (!byOrder[item.order_id]) byOrder[item.order_id] = []; byOrder[item.order_id].push(item) }
      setTodayOrders(orders.map(o => ({ ...o, items: byOrder[o.id] ?? [],
        total: (byOrder[o.id] ?? []).reduce((s, i) => s + i.quantity * i.unit_price, 0) })))
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

  // ── Can enter menu edit ───────────────────────────────────
  const canMenuEdit = activeCategory !== 'ทั้งหมด' && !searchQ.trim()

  // ══════════════════════════════════════════════════════════
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Loader2 size={36} className="text-cocoa-600 animate-spin" />
    </div>
  )

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50">

      {/* ── Top Bar ─────────────────────────────────────────── */}
      <div className="bg-cocoa-800 text-white px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">🍫</span>
          <div>
            <p className="font-bold text-sm leading-tight">Cocoa House POS</p>
            <p className="text-cocoa-300 text-[11px]">{format(time, 'EEEE d MMM yyyy', { locale: th })}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {savedMsg && (
            <div className="flex items-center gap-1.5 bg-green-600 text-white text-sm px-3 py-1.5 rounded-lg font-medium">
              <CheckCircle2 size={15} /> บันทึกแล้ว · {savedMsg.platform} · {fmt(savedMsg.total)}
            </div>
          )}
          {/* Date selector — ย้อนหลัง 7 วัน */}
          <div className="relative">
            <button
              aria-label="เลือกวันที่บันทึก"
              onClick={() => setShowDatePicker(p => !p)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors
                ${orderDate !== todayStr()
                  ? 'bg-amber-500 text-white'
                  : 'bg-cocoa-700 hover:bg-cocoa-600 text-white'
                }`}>
              📅 {orderDate === todayStr() ? 'วันนี้' : format(new Date(orderDate + 'T00:00:00'), 'd MMM', { locale: th })}
              {orderDate !== todayStr() && <span className="text-amber-200 text-[10px]">ย้อนหลัง</span>}
            </button>
            {showDatePicker && (
              <>
                {/* Backdrop */}
                <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />
                {/* Dropdown */}
                <div className="absolute right-0 top-full mt-1 bg-white rounded-2xl shadow-xl border border-gray-100 p-2 z-50 w-36">
                  {Array.from({ length: 7 }, (_, i) => {
                    const d = format(subDays(new Date(), i), 'yyyy-MM-dd')
                    const label = i === 0 ? 'วันนี้' : i === 1 ? 'เมื่อวาน' : format(subDays(new Date(), i), 'EEE d MMM', { locale: th })
                    return (
                      <button key={d} onClick={() => { setOrderDate(d); setShowDatePicker(false) }}
                        className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors
                          ${orderDate === d ? 'bg-cocoa-700 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>
                        {label}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
          <button onClick={() => setShowOrders(true)}
            className="flex items-center gap-1.5 bg-cocoa-700 hover:bg-cocoa-600 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors">
            <ClipboardList size={14} />
            {orderDate === todayStr() ? 'ออเดอร์วันนี้' : `ออเดอร์ ${format(new Date(orderDate + 'T00:00:00'), 'd MMM', { locale: th })}`}
          </button>
          <button onClick={signOut} aria-label="ออกจากระบบ" className="p-1.5 hover:bg-cocoa-700 rounded-lg transition-colors">
            <LogOut size={16} />
          </button>
        </div>
      </div>

      {/* ── 3-Panel Body ────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ══ Panel 1: Category Rail ══════════════════════════ */}
        <div className={`w-20 flex flex-col overflow-y-auto shrink-0 transition-colors relative
          ${catEditMode ? 'bg-amber-900' : 'bg-cocoa-900'}`}>

          {/* Cat edit toolbar */}
          {catEditMode ? (
            <div className="flex flex-col gap-1 p-1.5 shrink-0">
              <button onClick={saveCatOrder} disabled={savingLayout}
                className="w-full py-1.5 rounded-lg bg-green-500 text-white text-[10px] font-bold flex items-center justify-center gap-0.5">
                {savingLayout ? <Loader2 size={10} className="animate-spin" /> : <><Save size={10} /> บันทึก</>}
              </button>
              <button onClick={cancelCatEdit}
                className="w-full py-1 rounded-lg bg-amber-700 text-amber-200 text-[10px] font-semibold">
                ยกเลิก
              </button>
            </div>
          ) : (
            <button onClick={enterCatEdit}
              className="w-full py-2 text-[9px] text-cocoa-500 hover:text-cocoa-300 flex flex-col items-center gap-0.5 transition-colors shrink-0">
              <LayoutGrid size={12} />
              แก้ไข
            </button>
          )}

          {/* Category list */}
          {/* Scroll gradient hint */}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-cocoa-900/80 to-transparent z-10" />

          {catOrder.map((cat, idx) => {
            const isActive = activeCategory === cat
            return (
              <div
                key={cat}
                data-cat-idx={idx}
                className={`flex flex-col items-center justify-center gap-1 px-1 py-3 text-center
                  select-none transition-all cursor-pointer
                  ${catEditMode
                    ? catDrag.draggingIdx === idx
                      ? 'bg-amber-700/80 scale-95 opacity-80'
                      : 'bg-amber-800/40 border-b border-amber-700/30'
                    : isActive
                      ? 'bg-cocoa-600 text-white'
                      : 'text-cocoa-400 hover:bg-cocoa-800 hover:text-cocoa-200'
                  }`}
                onClick={() => { if (!catEditMode) { setActiveCategory(cat); setSearchQ('') } }}
              >
                {catEditMode && (
                  <div
                    className="text-amber-400 touch-none"
                    style={{ cursor: 'grab' }}
                    onPointerDown={e => catDrag.startDrag(e, idx, catOrder, setCatOrder, 'data-cat-idx')}
                  >
                    <GripVertical size={14} />
                  </div>
                )}
                <span className="text-xl leading-none">
                  {cat === 'ทั้งหมด' ? '🍽️' : (CAT_EMOJI[cat] ?? '🍹')}
                </span>
                <span className={`text-[11px] font-medium leading-tight break-all
                  ${catEditMode ? 'text-amber-200' : ''}`}>{cat}</span>
              </div>
            )
          })}
        </div>

        {/* ══ Panel 2: Menu Grid ══════════════════════════════ */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Search bar + menu edit toggle */}
          <div className={`border-b px-3 py-2.5 shrink-0 transition-colors
            ${menuEditMode ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-100'}`}>
            <div className="flex gap-2 items-center">
              {!menuEditMode ? (
                <>
                  <div className="flex-1 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                    <Search size={15} className="text-gray-400 shrink-0" />
                    <input type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)}
                      placeholder="ค้นหาเมนู..."
                      className="flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder-gray-400" />
                    {searchQ && <button onClick={() => setSearchQ('')}><X size={14} className="text-gray-400" /></button>}
                  </div>
                  {canMenuEdit && (
                    <button onClick={enterMenuEdit}
                      className="flex items-center gap-1 px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold transition-colors shrink-0">
                      <LayoutGrid size={13} /> แก้ไขตำแหน่ง
                    </button>
                  )}
                </>
              ) : (
                <div className="flex-1 flex items-center gap-2">
                  <p className="flex-1 text-sm font-bold text-amber-700">✏️ ลากเพื่อจัดตำแหน่งเมนู</p>
                  <button onClick={saveMenuOrder} disabled={savingLayout}
                    className="flex items-center gap-1 px-4 py-2 rounded-xl bg-green-500 text-white text-sm font-bold">
                    {savingLayout ? <Loader2 size={13} className="animate-spin" /> : <><Save size={13} /> บันทึก</>}
                  </button>
                  <button onClick={cancelMenuEdit}
                    className="px-3 py-2 rounded-xl bg-amber-100 text-amber-700 text-sm font-semibold">
                    ยกเลิก
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Menu count */}
          <div className="px-3 pt-2 pb-1 shrink-0">
            <p className="text-xs text-gray-400">
              {displayMenus.length} เมนู{activeCategory !== 'ทั้งหมด' ? ` ใน ${activeCategory}` : ''}
              {menuEditMode && <span className="text-amber-600 font-semibold ml-1">— โหมดแก้ไขตำแหน่ง</span>}
            </p>
          </div>

          {/* Grid */}
          {displayMenus.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center"><p className="text-2xl mb-2">🔍</p><p className="text-sm">ไม่พบเมนู</p></div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-2 pb-2">
              <div className="grid grid-cols-5 gap-2 pt-1">
                {displayMenus.map((menu, idx) => {
                  const qty      = quantities[menu.id] ?? 0
                  const hasQty   = qty > 0
                  const opts     = menuOptions[menu.id] ?? {}
                  const isDragging = menuEditMode && menuDrag.draggingIdx === idx

                  return (
                    <div
                      key={menu.id}
                      data-menu-idx={idx}
                      className={`bg-white rounded-xl overflow-hidden border transition-all
                        ${menuEditMode
                          ? isDragging
                            ? 'border-amber-400 shadow-lg scale-95 opacity-80 cursor-grabbing'
                            : 'border-amber-200 cursor-grab'
                          : hasQty
                            ? 'border-cocoa-400 shadow-sm cursor-pointer'
                            : 'border-gray-100 hover:border-gray-200 cursor-pointer'
                        }`}
                    >
                      {/* Image + drag handle overlay */}
                      <div className="relative w-full">
                        {menuEditMode && (
                          <div
                            className="absolute inset-0 z-10 flex items-center justify-center bg-amber-50/70 touch-none"
                            style={{ cursor: 'grab' }}
                            onPointerDown={e => menuDrag.startDrag(
                              e, idx,
                              displayMenus.map(m => m.id),
                              ids => setMenuOrder(ids),
                              'data-menu-idx'
                            )}
                          >
                            <GripVertical size={28} className="text-amber-500" />
                          </div>
                        )}
                        {!menuEditMode && (
                          <button aria-label={`ดูตัวเลือก ${menu.name}`} className="w-full relative" onClick={() => setOptionMenu(menu)}>
                            {menu.image_url ? (
                              <div className="w-full" style={{ paddingBottom: '70%', position: 'relative' }}>
                                <img src={menu.image_url} alt={menu.name}
                                  className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                              </div>
                            ) : (
                              <div className={`w-full ${hasQty ? 'bg-cocoa-50' : 'bg-gray-50'}`}
                                style={{ paddingBottom: '70%', position: 'relative' }}>
                                <span className="absolute inset-0 flex items-center justify-center text-3xl">🍫</span>
                              </div>
                            )}
                            {hasQty && (
                              <div className="absolute top-1.5 right-1.5 bg-cocoa-700 text-white text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center shadow">
                                {qty}
                              </div>
                            )}
                          </button>
                        )}
                        {menuEditMode && (
                          <div className="w-full bg-amber-50" style={{ paddingBottom: '70%', position: 'relative' }}>
                            {menu.image_url
                              ? <img src={menu.image_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" />
                              : <span className="absolute inset-0 flex items-center justify-center text-3xl opacity-40">🍫</span>
                            }
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="px-2 pt-1.5 pb-1">
                        <p className={`text-xs font-semibold leading-tight line-clamp-2 min-h-[2.2em]
                          ${menuEditMode ? 'text-amber-700' : 'text-gray-900'}`}>
                          {menu.name}
                        </p>
                        {!menuEditMode && hasQty && (opts.milk || opts.refill) && (
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            {opts.milk   && <span className="text-[9px] bg-blue-50 text-blue-600 px-1 py-0.5 rounded">{opts.milk.name}</span>}
                            {opts.refill && <span className="text-[9px] bg-purple-50 text-purple-600 px-1 py-0.5 rounded">{opts.refill.name}</span>}
                            {opts.sweetness != null && opts.sweetness !== 100 && (
                              <span className="text-[9px] bg-amber-50 text-amber-600 px-1 py-0.5 rounded">{opts.sweetness}%</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Controls (hidden in edit mode) */}
                      {!menuEditMode && (
                        <>
                          <div className="flex items-center justify-between px-2 pb-2 gap-1">
                            <button onPointerDown={() => decrement(menu.id)} disabled={!hasQty}
                              className="w-8 h-8 rounded-lg bg-gray-100 active:bg-gray-200 disabled:opacity-20 flex items-center justify-center text-gray-600">
                              <Minus size={14} />
                            </button>
                            <button onPointerDown={() => increment(menu)}
                              className="flex-1 h-8 rounded-lg bg-cocoa-700 active:bg-cocoa-900 text-white flex items-center justify-center text-xs font-bold">
                              {hasQty ? <Plus size={14} /> : '+ เพิ่ม'}
                            </button>
                          </div>
                          {hasQty && (
                            <div className="px-2 pb-2 -mt-1">
                              <button onClick={() => toggleCampaign(menu.id)}
                                className={`w-full py-1 rounded-lg text-[10px] font-bold transition-all
                                  ${campaigns[menu.id]
                                    ? 'bg-amber-100 text-amber-700 border border-amber-300'
                                    : 'bg-gray-50 text-gray-400 border border-gray-200'
                                  }`}>
                                {campaigns[menu.id] ? '⚡ Campaign 60/40' : '60/40'}
                              </button>
                            </div>
                          )}
                        </>
                      )}

                      {/* Edit mode: show position badge */}
                      {menuEditMode && (
                        <div className="pb-2 px-2">
                          <div className="w-full py-0.5 text-center text-[10px] text-amber-500 font-bold">
                            #{idx + 1}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ══ Panel 3: Order Summary ══════════════════════════ */}
        <div className="w-72 bg-white border-l border-gray-100 flex flex-col shrink-0">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
            <div>
              <p className="font-bold text-gray-900 text-sm">รายการออเดอร์</p>
              <p className="text-xs text-gray-400">{totalItems} รายการ</p>
            </div>
            {totalItems > 0 && (
              <button onClick={resetOrder}
                className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50">
                ล้างทั้งหมด
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
            {orderItems.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-300 text-center py-8">
                <div><p className="text-3xl mb-2">🛒</p><p className="text-sm">ยังไม่มีรายการ<br/>กดเมนูเพื่อเพิ่ม</p></div>
              </div>
            ) : orderItems.map(item => (
              <div key={item.menuId} className="bg-gray-50 rounded-xl p-2.5">
                <div className="flex items-start gap-2">
                  {item.image_url
                    ? <img src={item.image_url} alt={item.name} className="w-10 h-10 rounded-lg object-cover shrink-0" />
                    : <div className="w-10 h-10 rounded-lg bg-gray-200 flex items-center justify-center text-lg shrink-0">🍫</div>
                  }
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-900 leading-tight truncate">{item.name}</p>
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
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => decrement(item.menuId)}
                      className="w-6 h-6 rounded-md bg-white border border-gray-200 flex items-center justify-center active:bg-gray-100">
                      <Minus size={11} />
                    </button>
                    <span className="text-sm font-bold text-gray-900 min-w-[1.2rem] text-center">{item.qty}</span>
                    <button onClick={() => increment(item.menu)}
                      className="w-6 h-6 rounded-md bg-cocoa-700 flex items-center justify-center active:bg-cocoa-900">
                      <Plus size={11} className="text-white" />
                    </button>
                  </div>
                  {item.isCampaign && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">⚡60/40</span>}
                  <p className="text-xs text-gray-500">× {item.qty}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-gray-100 p-4 shrink-0">
            <p className="text-xs text-gray-400 text-center mb-3">ราคาจะคำนวณตาม Platform ที่เลือก</p>
            <button onClick={openConfirm} disabled={totalItems === 0}
              className={`w-full py-4 rounded-xl font-bold text-base transition-all
                ${totalItems > 0 ? 'bg-cocoa-700 text-white active:bg-cocoa-900 active:scale-[0.98]' : 'bg-gray-100 text-gray-300 cursor-not-allowed'}`}>
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

      {/* ══ Confirm Modal ════════════════════════════════════ */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
              <h2 className="text-base font-bold text-gray-900">ยืนยันออเดอร์</h2>
              <button onClick={() => setShowConfirm(false)} className="p-1.5 rounded-lg bg-gray-100"><X size={18} /></button>
            </div>
            <div className="px-5 pb-4 shrink-0 space-y-3">
              {/* วันที่บันทึก (สรุปจาก header) */}
              {orderDate !== todayStr() && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  <span className="text-amber-500 text-sm">⚠</span>
                  <p className="text-xs font-bold text-amber-700">
                    บันทึกย้อนหลัง: {format(new Date(orderDate + 'T00:00:00'), 'EEEE d MMM yyyy', { locale: th })}
                  </p>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">เลือก Platform</p>
                <div className="grid grid-cols-3 gap-2">
                  {PLATFORMS.map(p => (
                    <button key={p} onClick={() => { setSelectedPlat(p); setOrderRef('') }}
                      className={`py-3 rounded-xl text-sm font-bold transition-all active:scale-95
                        ${selectedPlat === p ? (PLAT_STYLE[p] ?? 'bg-cocoa-600 text-white') : PLAT_INACTIVE}`}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              {selectedPlat && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide flex items-center gap-1">
                    หมายเลขออเดอร์ / ชื่อผู้รับ
                    <span className="text-red-500">*</span>
                    <span className="normal-case text-gray-400 font-normal ml-1">(ไม่มีหมายเลข ใส่ 0)</span>
                  </p>
                  <div className={`flex items-center border-2 rounded-xl overflow-hidden transition-colors
                    ${orderRef.trim() ? 'border-cocoa-400' : 'border-red-300'}`}>
                    <span className={`px-3 py-2.5 text-sm font-bold shrink-0 border-r
                      ${PLAT_STYLE[selectedPlat] ?? 'bg-gray-500 text-white'} border-white/30`}>
                      {PLAT_PREFIX[selectedPlat]}
                    </span>
                    <input
                      type="text"
                      value={orderRef}
                      onChange={e => setOrderRef(e.target.value)}
                      placeholder="A001 หรือ 0"
                      className={`flex-1 px-3 py-2.5 text-sm outline-none
                        ${orderRef.trim() ? 'bg-cocoa-50' : 'bg-red-50'}`}
                      autoFocus
                    />
                  </div>
                  {!orderRef.trim() && (
                    <p className="text-xs text-red-500 mt-1">กรุณากรอกหมายเลขออเดอร์ หรือใส่ 0 หากไม่มี</p>
                  )}
                </div>
              )}
            </div>
            {selectedPlat && (
              <div className="flex-1 overflow-y-auto px-5 pb-2">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">รายการ</p>
                  <span className={`text-white text-xs font-bold px-2.5 py-1 rounded-lg ${PLAT_STYLE[selectedPlat] ?? 'bg-gray-500'}`}>
                    {selectedPlat}
                  </span>
                </div>
                <div className="space-y-2">
                  {orderItemsWithPrice.map(item => (
                    <div key={item.menuId} className="flex items-center justify-between gap-3 border-b border-gray-50 pb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                        <div className="flex gap-1 flex-wrap">
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
            <div className="px-5 pb-5 pt-3 border-t border-gray-100 shrink-0">
              {selectedPlat && (
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm text-gray-600 font-medium">ยอดรวม</span>
                  <span className="text-xl font-bold text-cocoa-700">{fmt(totalAmount)}</span>
                </div>
              )}
              {saveError && (
                <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-xl px-4 py-2.5 mb-3">
                  <AlertCircle size={16} className="shrink-0" /><p className="text-sm">{saveError}</p>
                </div>
              )}
              {(() => {
                const canSave = selectedPlat && orderRef.trim() && !saving
                return (
                  <button onClick={saveOrder_fn} disabled={!canSave}
                    className={`w-full py-4 rounded-xl font-bold text-base transition-all
                      ${canSave ? 'bg-cocoa-700 text-white active:bg-cocoa-900' : 'bg-gray-100 text-gray-300 cursor-not-allowed'}`}>
                    {saving
                      ? <span className="flex items-center justify-center gap-2"><Loader2 size={18} className="animate-spin" /> กำลังบันทึก...</span>
                      : !selectedPlat
                        ? 'เลือก Platform ก่อน'
                        : !orderRef.trim()
                          ? 'กรอกหมายเลขออเดอร์ก่อน'
                          : <span className="flex items-center justify-center gap-2"><CheckCircle2 size={18} /> บันทึกออเดอร์ · {selectedPlat}</span>
                    }
                  </button>
                )
              })()}
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
              <button onClick={() => setShowOrders(false)} className="p-2 rounded-xl bg-gray-100"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-6">
              {loadingOrders ? (
                <div className="flex justify-center py-10"><Loader2 size={28} className="animate-spin text-cocoa-500" /></div>
              ) : todayOrders.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <ClipboardList size={32} className="mx-auto mb-2 opacity-30" /><p className="text-sm">ยังไม่มีออเดอร์วันนี้</p>
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
                          <button onClick={() => deleteOrder(order.id)} disabled={deletingId === order.id}
                            className="p-1.5 rounded-lg bg-red-50 text-red-400 active:bg-red-100">
                            {deletingId === order.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1">
                        {order.items.map((item, idx) => (
                          <div key={idx} className="flex justify-between text-xs text-gray-600">
                            <span>{item.menus?.name ?? '?'}</span><span>×{item.quantity}</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-gray-300 mt-2">{format(new Date(order.created_at), 'HH:mm น.')}</p>
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
