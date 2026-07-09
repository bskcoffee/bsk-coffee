import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { format, subDays } from 'date-fns'
import { th } from 'date-fns/locale'
import {
  LogOut, ClipboardList, X, CheckCircle2, AlertCircle,
  Loader2, Trash2, Search, Minus, Plus, GripVertical,
  LayoutGrid, Save, ChevronUp, ChevronDown,
} from 'lucide-react'
import MenuOptionModal from '../components/MenuOptionModal'
import { useToast } from '../contexts/ToastContext'

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
export default function POSPage({ onDateChange }) {
  const { signOut } = useAuth()
  const { addToast } = useToast()

  // ── Remote data ──
  const [menus,        setMenus]        = useState([])
  const [platFees,     setPlatFees]     = useState({})
  const [loading,      setLoading]      = useState(true)

  // ── Order state (line items) ──
  // lineItems: [{ lineId, menuId, qty, options, isCampaign }]
  const [lineItems,    setLineItems]    = useState([])
  const [pendingMenu,  setPendingMenu]  = useState(null) // popup "เพิ่มจำนวน / ตัวเลือกใหม่"

  // ── Layout / edit mode ──
  const [catEditMode,  setCatEditMode]  = useState(false)
  const [menuEditMode, setMenuEditMode] = useState(false)
  const [catOrder,     setCatOrder]     = useState([])  // custom category order
  const [menuOrder,    setMenuOrder]    = useState([])  // current view menu order (ids)
  const [savingLayout,  setSavingLayout]  = useState(false)
  const [layoutSaveErr, setLayoutSaveErr] = useState(null)
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
  const [printWarning,   setPrintWarning]   = useState(null)
  const [savedMsg,       setSavedMsg]       = useState(null)
  const [discountType,   setDiscountType]   = useState('amt')  // 'pct' | 'amt'
  const [discountRaw,    setDiscountRaw]    = useState('')      // string input
  const [showOrders,     setShowOrders]     = useState(false)
  const [todayOrders,    setTodayOrders]    = useState([])
  const [loadingOrders,  setLoadingOrders]  = useState(false)
  const [deletingId,     setDeletingId]     = useState(null)
  const [time,           setTime]           = useState(new Date())
  const [platforms,      setPlatforms]      = useState(PLATFORMS) // sync กับ platform_config ใน Supabase
  const [optionGroups,   setOptionGroups]   = useState([]) // กลุ่มตัวเลือกเสริม ผูกกับหมวดหมู่เมนู (จากหน้าจัดการเมนู)
  const [printEnabled,   setPrintEnabled]   = useState(true)   // toggle พิมพ์ฉลาก — ไม่ persist, reset เป็นเปิดทุกครั้งที่รีโหลดหน้า

  // ── Drag hooks ──
  const catDrag  = useDragSort()   // { draggingIdx, startDrag }
  const menuDrag = useDragSort()   // { draggingIdx, startDrag }

  // ── Auto-persist catOrder to localStorage on every change ──
  const catOrderInitRef = useRef(false)
  useEffect(() => {
    if (!catOrderInitRef.current) { catOrderInitRef.current = true; return }
    if (catOrder.length === 0) return
    try { localStorage.setItem('pos_cat_order_local', JSON.stringify(catOrder)) } catch {}
  }, [catOrder])

  // ── Report orderDate to parent (App.jsx) for tab sync ──
  useEffect(() => { onDateChange?.(orderDate) }, [orderDate, onDateChange])

  // ── Clock ──
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  // ── Load data ─────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [menusRes, settingsRes, optionGroupsRes] = await Promise.all([
        supabase.from('menus')
          .select('id, name, category, sort_order, image_url, menu_prices(platform, price, effective_to)')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('name'),
        supabase.from('settings').select('key, value'),
        supabase.from('menu_option_groups')
          .select('*, menu_option_choices(*)')
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
      ])

      // กลุ่มตัวเลือกเสริม (ผูกกับหมวดหมู่เมนู) — โผล่อัตโนมัติเมื่อเลือกเมนูในหมวดหมู่นั้น
      const loadedGroups = (optionGroupsRes.data ?? []).map(g => ({
        ...g,
        choices: (g.menu_option_choices ?? [])
          .filter(c => c.is_active)
          .sort((a, b) => a.sort_order - b.sort_order),
      }))
      setOptionGroups(loadedGroups)

      const allMenuList = (menusRes.data ?? []).map(m => {
        const prices = {}
        // เฉพาะ row ปัจจุบัน (effective_to IS NULL) เพื่อไม่ให้ price history ทับราคาล่าสุด
        for (const p of m.menu_prices ?? []) {
          if (p.effective_to === null) prices[p.platform] = p.price
        }
        return { ...m, prices }
      })

      const mainMenus = allMenuList

      // Apply saved menu order from localStorage (fallback เมื่อ Supabase sort_order ไม่ได้รับสิทธิ์ write)
      const localMenuOrderStr = (() => { try { return localStorage.getItem('pos_menu_order_local') } catch { return null } })()
      if (localMenuOrderStr) {
        try {
          const localOrder = JSON.parse(localMenuOrderStr)
          const orderMap = Object.fromEntries(localOrder.map((id, i) => [id, i]))
          mainMenus.sort((a, b) => (orderMap[a.id] ?? 9999) - (orderMap[b.id] ?? 9999))
        } catch {}
      }

      setMenus(mainMenus)

      // Load custom category order
      const settings = settingsRes.data ?? []
      const catOrderRow = settings.find(r => r.key === 'pos_cat_order')
      const localCatStr = (() => { try { return localStorage.getItem('pos_cat_order_local') } catch { return null } })()
      const savedCatStr = localCatStr ?? catOrderRow?.value

      if (savedCatStr) {
        try {
          const saved = JSON.parse(savedCatStr)
          const rawCats = [...new Set(mainMenus.map(m => m.category).filter(Boolean))]
          if (saved.includes('ทั้งหมด')) {
            // new format — ทั้งหมด position is stored; respect it
            const ordered = [
              ...saved.filter(c => c === 'ทั้งหมด' || rawCats.includes(c)),
              ...rawCats.filter(c => !saved.includes(c)),
            ]
            setCatOrder(ordered)
          } else {
            // old format — prepend ทั้งหมด to front
            const ordered = [...saved.filter(c => rawCats.includes(c)), ...rawCats.filter(c => !saved.includes(c))]
            setCatOrder(['ทั้งหมด', ...ordered])
          }
        } catch { _buildDefaultCatOrder(mainMenus) }
      } else {
        _buildDefaultCatOrder(mainMenus)
      }

      const platConfigRow = settings.find(r => r.key === 'platform_config')
      if (platConfigRow) {
        try {
          const cfg = JSON.parse(platConfigRow.value)
          setPlatFees(Object.fromEntries(cfg.map(p => [p.name, p.fee ?? 0])))
          const names = cfg.map(p => p.name).filter(Boolean)
          if (names.length > 0) setPlatforms(names)
        } catch {}
      }
    } catch (err) {
      console.error(err)
      addToast('โหลดข้อมูลเมนูไม่สำเร็จ: ' + err.message, 'error')
    }
    setLoading(false)
  }, [addToast])

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
    setLayoutSaveErr(null)
    try {
      const valueStr = JSON.stringify(catOrder)  // เก็บ position ของ ทั้งหมด ด้วย

      // บันทึก localStorage เสมอ (ทำงานแน่นอน ไม่ขึ้นกับ RLS)
      try {
        localStorage.setItem('pos_cat_order_local', valueStr)
      } catch(e) {
        console.warn('localStorage save failed:', e.message)
      }

      // ลองบันทึก Supabase (cross-device sync)
      const { error: supErr } = await supabase.from('settings')
        .upsert({ key: 'pos_cat_order', value: valueStr }, { onConflict: 'key' })
      if (supErr) console.warn('settings upsert:', supErr.message)

      setCatEditMode(false)
    } catch (err) {
      console.error(err)
      setLayoutSaveErr(err.message)
      addToast('บันทึกลำดับไม่สำเร็จ: ' + err.message, 'error')
    }
    setSavingLayout(false)
  }

  // Keyboard-accessible alternative to drag-and-drop for category order
  const moveCatItem = (idx, direction) => {
    const target = idx + direction
    if (target < 0 || target >= catOrder.length) return
    const next = [...catOrder]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setCatOrder(next)
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

  // Keyboard-accessible alternative to drag-and-drop for menu order
  const moveMenuItem = (idx, direction) => {
    const ids = displayMenus.map(m => m.id)
    const target = idx + direction
    if (target < 0 || target >= ids.length) return
    const next = [...ids]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setMenuOrder(next)
  }

  const saveMenuOrder = async () => {
    setSavingLayout(true)
    setLayoutSaveErr(null)
    try {
      // บันทึก localStorage ก่อน (cross-browser fallback)
      try { localStorage.setItem('pos_menu_order_local', JSON.stringify(menuOrder)) } catch {}

      // Update sort_order ใน Supabase (ต้องการสิทธิ์ write menus)
      const results = await Promise.all(
        menuOrder.map((id, idx) =>
          supabase.from('menus').update({ sort_order: idx * 10 }).eq('id', id)
        )
      )
      const firstErr = results.find(r => r.error)?.error
      if (firstErr) console.warn('menu sort_order update:', firstErr.message)

      // อัปเดต local state เสมอ (ไม่ว่า Supabase จะสำเร็จหรือไม่)
      setMenus(prev => {
        const orderMap = Object.fromEntries(menuOrder.map((id, i) => [id, i * 10]))
        return [...prev].sort((a, b) => (orderMap[a.id] ?? 999) - (orderMap[b.id] ?? 999))
      })
      setMenuEditMode(false)
    } catch (err) {
      console.error(err)
      setLayoutSaveErr(err.message)
      addToast('บันทึกลำดับไม่สำเร็จ: ' + err.message, 'error')
    }
    setSavingLayout(false)
  }

  // กลุ่มตัวเลือกเสริมที่ผูกกับหมวดหมู่ของเมนูที่กำลังเปิด modal อยู่
  const groupsForOptionMenu = useMemo(() => {
    if (!optionMenu) return []
    return optionGroups.filter(g => (g.categories ?? []).includes(optionMenu.category))
  }, [optionGroups, optionMenu])

  // ── Line item helpers ─────────────────────────────────────
  const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

  const totalQtyForMenu = (menuId) =>
    lineItems.filter(l => l.menuId === menuId).reduce((s, l) => s + l.qty, 0)

  // ── Order items ───────────────────────────────────────────
  const orderItems = useMemo(() =>
    lineItems
      .filter(l => l.qty > 0)
      .map(l => {
        const menu = menus.find(m => m.id === l.menuId)
        const opts = l.options ?? {}
        const basePrice   = Object.values(menu?.prices ?? {})[0] ?? 0
        const optionGroupsPrice = (opts.optionGroups ?? []).reduce((sum, g) =>
          sum + (g.choices ?? []).reduce((s, c) => s + (c.price ?? 0), 0), 0)
        return { lineId: l.lineId, menuId: l.menuId, qty: l.qty, name: menu?.name ?? '',
          image_url: menu?.image_url ?? null, basePrice, extras: optionGroupsPrice,
          isCampaign: l.isCampaign, options: opts, menu }
      }),
  [lineItems, menus])

  const totalItems = orderItems.reduce((s, i) => s + i.qty, 0)

  const orderItemsWithPrice = useMemo(() => {
    if (!selectedPlat) return orderItems
    return orderItems.map(item => {
      const basePrice   = item.menu?.prices[selectedPlat] ?? 0
      const optionGroupsPrice = (item.options.optionGroups ?? []).reduce((sum, g) =>
        sum + (g.choices ?? []).reduce((s, c) => s + (c.price ?? 0), 0), 0)
      const unitPrice   = basePrice + optionGroupsPrice
      const feePct      = item.isCampaign ? CAMPAIGN_GP_PCT : (platFees[selectedPlat] ?? 0)
      return { ...item, basePrice, extras: optionGroupsPrice,
        unitPrice, subtotal: item.qty * unitPrice, unitGpCost: basePrice * feePct / 100 }
    })
  }, [orderItems, selectedPlat, platFees])

  // ── Line item mutators ─────────────────────────────────────
  const incrementLine = (lineId) =>
    setLineItems(prev => prev.map(l => l.lineId === lineId ? { ...l, qty: l.qty + 1 } : l))

  const decrementLine = (lineId) =>
    setLineItems(prev =>
      prev.flatMap(l => l.lineId === lineId
        ? l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : []
        : [l]
      )
    )

  const removeLine = (lineId) =>
    setLineItems(prev => prev.filter(l => l.lineId !== lineId))

  const toggleCampaignLine = (lineId) =>
    setLineItems(prev => prev.map(l => l.lineId === lineId ? { ...l, isCampaign: !l.isCampaign } : l))

  const totalAmount = orderItemsWithPrice.reduce((s, i) => s + (i.subtotal ?? 0), 0)

  const discountValue = (() => {
    const v = parseFloat(discountRaw) || 0
    if (v <= 0) return 0
    const raw = discountType === 'pct' ? Math.round(totalAmount * v / 100) : Math.round(v)
    return Math.min(raw, totalAmount)
  })()
  const finalTotal = totalAmount - discountValue

  // ── Handlers ─────────────────────────────────────────────
  const increment = (menu) => {
    if (menuEditMode || catEditMode) return
    const totalQty = totalQtyForMenu(menu.id)
    if (totalQty === 0) {
      setOptionMenu(menu) // เปิด modal ตัวเลือก — ทุกหมวดหมู่เปิดเหมือนกันหมด (ไม่มี logic พิเศษเฉพาะหมวดอีกต่อไป)
    } else {
      // มีในรายการแล้ว → popup เลือก
      setPendingMenu(menu)
    }
  }

  // กดปุ่ม − ในเมนู grid → ลดจากบรรทัดล่าสุดของเมนูนั้น
  const decrementMenu = (menuId) => {
    setLineItems(prev => {
      const next = [...prev]
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].menuId === menuId) {
          if (next[i].qty > 1) {
            next[i] = { ...next[i], qty: next[i].qty - 1 }
          } else {
            next.splice(i, 1)
          }
          return next
        }
      }
      return next
    })
  }

  // เพิ่มจำนวนในบรรทัดล่าสุด (จาก pendingMenu popup)
  const addQtyToExisting = () => {
    if (!pendingMenu) return
    setLineItems(prev => {
      const next = [...prev]
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].menuId === pendingMenu.id) {
          next[i] = { ...next[i], qty: next[i].qty + 1 }
          return next
        }
      }
      return next
    })
    setPendingMenu(null)
  }

  const handleOptionConfirm = (opts) => {
    if (!optionMenu) return
    setLineItems(prev => [...prev, {
      lineId: genId(), menuId: optionMenu.id, qty: 1,
      options: opts, isCampaign: false,
    }])
    setOptionMenu(null)
    setPendingMenu(null)
  }

  const resetOrder = () => { setLineItems([]); setSaveError(null); setPrintWarning(null); setSelectedPlat(null); setDiscountRaw(''); setDiscountType('amt') }
  const openConfirm = () => { setSelectedPlat(null); setSaveError(null); setShowConfirm(true) }

  // ── Save order ────────────────────────────────────────────
  const saveOrder_fn = async () => {
    if (!selectedPlat || orderItemsWithPrice.length === 0) return
    setSaving(true); setSaveError(null)
    try {
      const date = orderDate
      const notes = orderRef.trim() ? `${PLAT_PREFIX[selectedPlat] ?? ''}${orderRef.trim()}` : null

      // สร้าง order ใหม่ทุกครั้ง (ไม่ merge)
      const { data: newOrder, error: orderErr } = await supabase.from('orders')
        .insert({ date, platform: selectedPlat, notes, status: 'preparing', discount: discountValue })
        .select('id').single()
      if (orderErr) throw orderErr

      const { error: itemsErr } = await supabase.from('order_items').insert(
        orderItemsWithPrice.map(item => ({
          order_id:      newOrder.id,
          menu_id:       item.menuId,
          quantity:      item.qty,
          unit_price:    item.unitPrice    ?? 0,
          unit_gp_cost:  item.unitGpCost   ?? 0,
          is_campaign:   item.isCampaign   ?? false,
          item_options: {
            sweetness:    item.options.sweetness    ?? 100,
            note:         item.options.note         ?? '',
            packaging:    item.options.packaging    ?? null,
            optionGroups: item.options.optionGroups ?? null,
          },
        }))
      )
      if (itemsErr) throw itemsErr

      setSavedMsg({ itemCount: totalItems, total: finalTotal, platform: selectedPlat })
      resetOrder(); setShowConfirm(false); setOrderRef(''); setOrderDate(todayStr())
      setTimeout(() => setSavedMsg(null), 6000)

      // ── Sync menu_discount ไปยัง platform_costs (fire-and-forget) ──
      ;(async () => {
        try {
          // Sum discount ทุก order ของวัน+platform นี้
          const { data: allOrders } = await supabase
            .from('orders')
            .select('discount')
            .eq('date', date)
            .eq('platform', selectedPlat)
          const totalDiscount = (allOrders ?? []).reduce((s, o) => s + (o.discount ?? 0), 0)
          if (totalDiscount <= 0) return

          // Update ถ้ามี row อยู่แล้ว, Insert ถ้ายังไม่มี
          const { data: existingRow } = await supabase
            .from('platform_costs')
            .select('id')
            .eq('date', date)
            .eq('platform', selectedPlat)
            .maybeSingle()

          if (existingRow) {
            await supabase.from('platform_costs')
              .update({ menu_discount: totalDiscount })
              .eq('date', date)
              .eq('platform', selectedPlat)
          } else {
            await supabase.from('platform_costs')
              .insert({ date, platform: selectedPlat, menu_discount: totalDiscount })
          }
        } catch (err) {
          console.warn('menu_discount sync failed:', err.message)
        }
      })()

      // ── Auto-print: ส่งไป print server (fire-and-forget, ไม่ block UX) ──
      if (!printEnabled) {
        // พิมพ์ปิดอยู่ — ข้ามการพิมพ์ทั้งหมด
      } else
      try {
        const labelRes = await supabase.from('settings').select('value').eq('key', 'label_settings').maybeSingle()
        const labelSettings = labelRes.data?.value ? JSON.parse(labelRes.data.value) : {}
        const printServerIp = labelSettings.printerIp ?? '192.168.1.100'
        const printServerPort = labelSettings.printerPort ?? 3001

        fetch(`http://${printServerIp}:${printServerPort}/print`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId:  notes ?? newOrder.id,
            platform: selectedPlat,
            items: orderItemsWithPrice.map(item => ({
              name:         item.name,
              qty:          item.qty,
              item_options: item.options,
              isCampaign:   item.isCampaign ?? false,
            })),
            labelSettings,
          }),
          signal: AbortSignal.timeout(5000),
        }).catch(err => {
          console.warn('print-server unreachable:', err.message)
          setPrintWarning('พิมพ์ฉลากไม่สำเร็จ — ตรวจสอบ print server')
        })
      } catch (err) {
        console.warn('auto-print setup error:', err.message)
        setPrintWarning('พิมพ์ฉลากไม่สำเร็จ — ตรวจสอบ print server')
      }

    } catch (err) {
      console.error('saveOrder error:', err)
      setSaveError(`บันทึกไม่สำเร็จ: ${err?.message ?? 'กรุณาลองใหม่'}`)
    }
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
    } catch (err) {
      console.error(err)
      addToast('โหลดออเดอร์วันนี้ไม่สำเร็จ: ' + err.message, 'error')
    }
    setLoadingOrders(false)
  }, [addToast])

  useEffect(() => { if (showOrders) loadTodayOrders() }, [showOrders, loadTodayOrders])

  const deleteOrder = async (orderId) => {
    if (!window.confirm('ลบออเดอร์นี้?')) return
    setDeletingId(orderId)
    try {
      await supabase.from('order_items').delete().eq('order_id', orderId)
      await supabase.from('orders').delete().eq('id', orderId)
      await loadTodayOrders()
    } catch (err) {
      console.error(err)
      addToast('ลบออเดอร์ไม่สำเร็จ: ' + err.message, 'error')
    }
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
    <div className="h-full flex flex-col overflow-hidden bg-gray-50">

      {/* ── Top Bar ─────────────────────────────────────────── */}
      <div className="bg-cocoa-800 text-white px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">🍫</span>
          <div>
            <p className="font-bold text-sm leading-tight">BSK coffee&bakery POS</p>
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
                <div className="absolute right-0 top-full mt-1 bg-white rounded-2xl shadow-xl border border-gray-100 p-2 z-50 w-44">
                  {/* Shortcuts */}
                  {[
                    { d: todayStr(), label: 'วันนี้' },
                    { d: format(subDays(new Date(), 1), 'yyyy-MM-dd'), label: 'เมื่อวาน' },
                  ].map(({ d, label }) => (
                    <button key={d} onClick={() => { setOrderDate(d); setShowDatePicker(false) }}
                      className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors
                        ${orderDate === d ? 'bg-cocoa-700 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>
                      {label}
                    </button>
                  ))}
                  {/* Free date input */}
                  <div className="border-t border-gray-100 pt-2 mt-1 px-1">
                    <p className="text-[10px] text-gray-400 mb-1.5">เลือกวันย้อนหลัง</p>
                    <input
                      type="date"
                      max={todayStr()}
                      value={orderDate}
                      onChange={e => { if (e.target.value) { setOrderDate(e.target.value); setShowDatePicker(false) } }}
                      className="w-full px-2 py-2 border border-gray-200 rounded-xl text-xs outline-none focus:border-cocoa-400 bg-gray-50"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => setPrintEnabled(p => !p)}
            aria-label={printEnabled ? 'ปิดการพิมพ์ฉลาก' : 'เปิดการพิมพ์ฉลาก'}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border
              ${printEnabled
                ? 'bg-green-600/20 border-green-500/40 text-green-300 hover:bg-green-600/30'
                : 'bg-red-600/20 border-red-500/40 text-red-300 hover:bg-red-600/30'
              }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${printEnabled ? 'bg-green-400' : 'bg-red-400'}`} />
            {printEnabled ? '🖨️ พิมพ์ฉลาก' : '🖨️ ปิดพิมพ์'}
          </button>
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
                {catEditMode && (
                  <div className="flex gap-0.5">
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); moveCatItem(idx, -1) }}
                      disabled={idx === 0}
                      aria-label={`ย้าย ${cat} ขึ้น`}
                      className="p-0.5 rounded text-amber-300 hover:text-white hover:bg-amber-800 disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); moveCatItem(idx, 1) }}
                      disabled={idx === catOrder.length - 1}
                      aria-label={`ย้าย ${cat} ลง`}
                      className="p-0.5 rounded text-amber-300 hover:text-white hover:bg-amber-800 disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <ChevronDown size={12} />
                    </button>
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
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 pt-1">
                {displayMenus.map((menu, idx) => {
                  const qty        = totalQtyForMenu(menu.id)
                  const hasQty     = qty > 0
                  const menuLines  = lineItems.filter(l => l.menuId === menu.id)
                  const opts       = menuLines[0]?.options ?? {}        // แสดง options บรรทัดแรก
                  const multiLine  = menuLines.length > 1               // มีหลาย variant
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
                        {menuEditMode && (
                          <div className="absolute top-1 right-1 z-20 flex flex-col gap-0.5">
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); moveMenuItem(idx, -1) }}
                              disabled={idx === 0}
                              aria-label={`ย้าย ${menu.name} ขึ้น`}
                              className="p-1 rounded bg-white/90 text-amber-600 hover:bg-amber-100 disabled:opacity-30 disabled:pointer-events-none shadow-sm"
                            >
                              <ChevronUp size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); moveMenuItem(idx, 1) }}
                              disabled={idx === displayMenus.length - 1}
                              aria-label={`ย้าย ${menu.name} ลง`}
                              className="p-1 rounded bg-white/90 text-amber-600 hover:bg-amber-100 disabled:opacity-30 disabled:pointer-events-none shadow-sm"
                            >
                              <ChevronDown size={13} />
                            </button>
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
                              <div className="absolute top-1.5 right-1.5 flex gap-0.5 items-center">
                                <div className="bg-cocoa-700 text-white text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center shadow">
                                  {qty}
                                </div>
                                {multiLine && (
                                  <div className="bg-purple-600 text-white text-[9px] font-bold rounded-full px-1 h-4 flex items-center shadow">
                                    {menuLines.length}v
                                  </div>
                                )}
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
                        {!menuEditMode && hasQty && (
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            {multiLine ? (
                              <span className="text-[9px] bg-purple-50 text-purple-700 px-1 py-0.5 rounded font-bold">
                                {menuLines.length} ตัวเลือก
                              </span>
                            ) : (
                              <>
                                {opts.sweetness != null && opts.sweetness !== 100 && (
                                  <span className="text-[9px] bg-amber-50 text-amber-600 px-1 py-0.5 rounded">{opts.sweetness}%</span>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Controls (hidden in edit mode) */}
                      {!menuEditMode && (
                        <>
                          <div className="flex items-center justify-between px-2 pb-2 gap-1">
                            <button onPointerDown={() => decrementMenu(menu.id)} disabled={!hasQty}
                              className="w-8 h-8 rounded-lg bg-gray-100 active:bg-gray-200 disabled:opacity-20 flex items-center justify-center text-gray-600">
                              <Minus size={14} />
                            </button>
                            <button onPointerDown={() => increment(menu)}
                              className="flex-1 h-8 rounded-lg bg-cocoa-700 active:bg-cocoa-900 text-white flex items-center justify-center text-xs font-bold">
                              {hasQty ? <Plus size={14} /> : '+ เพิ่ม'}
                            </button>
                          </div>
                          {hasQty && !multiLine && (
                            <div className="px-2 pb-2 -mt-1">
                              <button onClick={() => toggleCampaignLine(menuLines[0].lineId)}
                                className={`w-full py-1 rounded-lg text-[10px] font-bold transition-all
                                  ${menuLines[0]?.isCampaign
                                    ? 'bg-amber-100 text-amber-700 border border-amber-300'
                                    : 'bg-gray-50 text-gray-400 border border-gray-200'
                                  }`}>
                                {menuLines[0]?.isCampaign ? '⚡ Campaign 60/40' : '60/40'}
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
        <div className="w-60 md:w-64 lg:w-72 bg-white border-l border-gray-100 flex flex-col shrink-0">
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
              <div key={item.lineId} className="bg-gray-50 rounded-xl p-2.5">
                <div className="flex items-start gap-2">
                  {item.image_url
                    ? <img src={item.image_url} alt={item.name} className="w-10 h-10 rounded-lg object-cover shrink-0" />
                    : <div className="w-10 h-10 rounded-lg bg-gray-200 flex items-center justify-center text-lg shrink-0">🍫</div>
                  }
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-900 leading-tight truncate">{item.name}</p>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {item.options.packaging === 'พร้อมดื่ม' && <span className="text-[9px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded">🧋 พร้อมดื่ม</span>}
                      {item.options.sweetness != null && item.options.sweetness !== 100 && (
                        <span className="text-[9px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded">{item.options.sweetness}%</span>
                      )}
                      {item.options.note && <span className="text-[9px] bg-gray-200 text-gray-600 px-1 py-0.5 rounded truncate max-w-[80px]">📝{item.options.note}</span>}
                      {(item.options.optionGroups ?? []).flatMap(g => g.choices ?? []).map(c => (
                        <span key={c.id} className="text-[9px] bg-pink-100 text-pink-700 px-1 py-0.5 rounded">✦{c.label}</span>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => removeLine(item.lineId)} className="text-gray-300 hover:text-red-400 p-0.5">
                    <X size={14} />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => decrementLine(item.lineId)}
                      className="w-6 h-6 rounded-md bg-white border border-gray-200 flex items-center justify-center active:bg-gray-100">
                      <Minus size={11} />
                    </button>
                    <span className="text-sm font-bold text-gray-900 min-w-[1.2rem] text-center">{item.qty}</span>
                    <button onClick={() => incrementLine(item.lineId)}
                      className="w-6 h-6 rounded-md bg-cocoa-700 flex items-center justify-center active:bg-cocoa-900">
                      <Plus size={11} className="text-white" />
                    </button>
                  </div>
                  <button onClick={() => toggleCampaignLine(item.lineId)}
                    className={`text-[9px] px-1.5 py-0.5 rounded font-bold transition-colors
                      ${item.isCampaign ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'}`}>
                    {item.isCampaign ? '⚡60/40' : '60/40'}
                  </button>
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

      {/* ══ Pending Menu Popup (เพิ่มจำนวน / ตัวเลือกใหม่) ══ */}
      {pendingMenu && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setPendingMenu(null)}>
          <div className="bg-white rounded-2xl w-full max-w-xs shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="p-5">
              <p className="font-bold text-gray-900 text-sm">{pendingMenu.name}</p>
              <p className="text-xs text-gray-400 mt-0.5 mb-4">มีในรายการแล้ว — เลือกดำเนินการ</p>
              <div className="space-y-2">
                <button
                  onClick={addQtyToExisting}
                  className="w-full py-3 rounded-xl bg-cocoa-700 text-white font-bold text-sm active:bg-cocoa-900">
                  + เพิ่มจำนวน (ตัวเลือกเดิม)
                </button>
                <button
                  onClick={() => { setPendingMenu(null); setOptionMenu(pendingMenu) }}
                  className="w-full py-3 rounded-xl bg-gray-100 text-gray-800 font-bold text-sm active:bg-gray-200">
                  ✦ ตัวเลือกใหม่ (นมต่างกัน ฯลฯ)
                </button>
                <button
                  onClick={() => setPendingMenu(null)}
                  className="w-full py-2 text-gray-400 text-sm">
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ Menu Option Modal ════════════════════════════════ */}
      {optionMenu && (
        <MenuOptionModal
          menu={optionMenu}
          platform={selectedPlat ?? platforms[0]}
          optionGroups={groupsForOptionMenu}
          initial={null}
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
                  {platforms.map(p => (
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
                {selectedPlat === 'GRAB' && (
                  <p className="text-[11px] text-amber-600 mb-2">⚡ กดที่รายการเพื่อเปิด/ปิด Campaign 60/40</p>
                )}
                <div className="space-y-2">
                  {orderItemsWithPrice.map(item => (
                    <div key={item.lineId} className={`rounded-xl border overflow-hidden transition-colors
                      ${item.isCampaign ? 'border-amber-300' : 'border-gray-100'}`}>
                      <div className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                          <div className="flex gap-1 flex-wrap mt-0.5">
                            {(item.options.optionGroups ?? []).flatMap(g => g.choices ?? []).map(c => (
                              <span key={c.id} className="text-[10px] text-pink-600">✦{c.label}</span>
                            ))}
                            {item.isCampaign && <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-1.5 rounded">⚡ 60/40</span>}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-gray-400">{item.qty} × {fmt(item.unitPrice)}</p>
                          <p className="text-sm font-bold text-gray-900">{fmt(item.subtotal)}</p>
                        </div>
                      </div>
                      {/* Campaign toggle — GRAB only */}
                      {selectedPlat === 'GRAB' && (
                        <button
                          onClick={() => toggleCampaignLine(item.lineId)}
                          className={`w-full py-1.5 text-xs font-bold transition-all border-t
                            ${item.isCampaign
                              ? 'bg-amber-400 text-white border-amber-300'
                              : 'bg-amber-50 text-amber-500 border-amber-100 active:bg-amber-100'
                            }`}
                        >
                          {item.isCampaign ? '⚡ Campaign 60/40 — กดเพื่อยกเลิก' : '+ กำหนดเป็น Campaign 60/40'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="px-5 pb-5 pt-3 border-t border-gray-100 shrink-0">

              {/* ── Discount ────────────────────────────────── */}
              <div className="mb-4">
                <p className="text-xs font-medium text-gray-500 mb-2">
                  ส่วนลด <span className="font-normal text-gray-400">(ถ้ามี)</span>
                </p>
                <div className="flex gap-2 mb-2">
                  {[['amt','฿ จำนวนเงิน'],['pct','% เปอร์เซ็นต์']].map(([t,label]) => (
                    <button
                      key={t}
                      onClick={() => { setDiscountType(t); setDiscountRaw('') }}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all
                        ${discountType === t
                          ? 'bg-cocoa-50 border-cocoa-400 text-cocoa-700'
                          : 'bg-white border-gray-200 text-gray-500'}`}
                    >{label}</button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    value={discountRaw}
                    onChange={e => setDiscountRaw(e.target.value)}
                    placeholder="0"
                    className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:border-cocoa-400"
                  />
                  <span className="text-sm text-gray-400 w-5 shrink-0">{discountType === 'pct' ? '%' : '฿'}</span>
                </div>
              </div>

              {/* ── ยอดรวม ──────────────────────────────────── */}
              {selectedPlat && (
                <div className="mb-4 space-y-1">
                  {discountValue > 0 && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-400">ยอดก่อนส่วนลด</span>
                        <span className="text-sm text-gray-400">{fmt(totalAmount)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-red-500 font-medium">ส่วนลด</span>
                        <span className="text-sm text-red-500 font-medium">-{fmt(discountValue)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 font-medium">ยอดสุทธิ</span>
                    <span className="text-xl font-bold text-cocoa-700">{fmt(finalTotal)}</span>
                  </div>
                </div>
              )}
              {!printEnabled && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-3">
                  <span className="text-base shrink-0">🖨️</span>
                  <p className="text-sm text-red-700 font-medium">พิมพ์ฉลากปิดอยู่ — บันทึกโดยไม่พิมพ์</p>
                </div>
              )}
              {saveError && (
                <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-xl px-4 py-2.5 mb-3">
                  <AlertCircle size={16} className="shrink-0" /><p className="text-sm">{saveError}</p>
                </div>
              )}
              {printWarning && (
                <div className="flex items-center justify-between gap-2 bg-amber-50 text-amber-700 rounded-xl px-4 py-2.5 mb-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={16} className="shrink-0" />
                    <p className="text-sm">{printWarning}</p>
                  </div>
                  <button onClick={() => setPrintWarning(null)} className="text-amber-500 hover:text-amber-700">
                    <X size={14} />
                  </button>
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
