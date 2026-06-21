import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSearchParams, useBlocker } from 'react-router-dom'
import { supabase, getSetting, getCostSettingsForDate } from '../lib/supabase'
import { saveDraft, loadDraft, clearDraft, isOnline, enqueueSync, getSyncQueue, processSyncQueue, clearSyncQueue } from '../utils/offlineSync'
import { calcPlatformProfit, calcMenuCostBreakdown, formatBaht, CAMPAIGN_GP_PCT } from '../utils/calculations'
import { useToast } from '../contexts/ToastContext'
import { Plus, Minus, Save, AlertCircle, CheckCircle, WifiOff, ChevronDown, ChevronUp, Pencil, Lock, Search, X, RefreshCw, CloudOff, Trash2, Printer, Download } from 'lucide-react'

const DEFAULT_PLATFORMS = ['GRAB', 'LINE', 'SHOPEE', 'The metro', 'TU']
const CATEGORIES = ['Cocoa', 'Coffee', 'Matcha', 'Classic', 'Hot', 'Bun', 'Refill', 'Addon']

// slug key for settings (legacy compat)
const platSlug = name => name.toLowerCase().replace(/\s+/g, '_')

const KNOWN_PLAT_COLORS = {
  GRAB: 'bg-green-500 text-white',
  LINE: 'bg-teal-600 text-white',
  SHOPEE: 'bg-orange-500 text-white',
  'The metro': 'bg-blue-600 text-white',
  TU: 'bg-purple-600 text-white',
}
const EXTRA_PLAT_COLORS = [
  'bg-pink-500 text-white', 'bg-amber-500 text-white', 'bg-indigo-500 text-white',
  'bg-teal-500 text-white', 'bg-lime-600 text-white', 'bg-sky-500 text-white',
]
const getPlatBtnColor = (name, idx) => KNOWN_PLAT_COLORS[name] ?? EXTRA_PLAT_COLORS[idx % EXTRA_PLAT_COLORS.length]

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function SalesEntryPage() {
  const { addToast } = useToast()
  const [searchParams] = useSearchParams()
  const [date, setDate] = useState(searchParams.get('date') || today())
  const [platform, setPlatform] = useState('GRAB')
  const [menus, setMenus] = useState([])
  const [quantities, setQuantities] = useState({}) // { menuId: qty }
  const [costs, setCosts]             = useState({ menu_discount: 0, campaign: 0, marketing_fee: 0, delivery_discount: 0, advertisement: 0 })
  const [hasCampaign, setHasCampaign] = useState(false)
  const [campaignQty, setCampaignQty] = useState({})   // { menuId: qty } for 60/40 campaign items

  // Snapshots for isDirty comparison
  const [originalCampaignQty, setOriginalCampaignQty] = useState({})
  const [notes, setNotes] = useState('')
  const [saveStatus, setSaveStatus] = useState('idle') // idle | saving | success | error
  const [existingWarning, setExistingWarning] = useState(false)
  const [isLocked, setIsLocked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [online, setOnline] = useState(isOnline())
  const [syncQueue, setSyncQueue] = useState(() => getSyncQueue())
  const [syncStatus, setSyncStatus] = useState('idle') // idle | syncing | synced | error
  const [showQueue, setShowQueue] = useState(false)
  const [filterCategory, setFilterCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showCosts, setShowCosts] = useState(true)
  const draftTimer = useRef(null)

  // Snapshot of DB state when data is loaded — used for accurate isDirty check
  const [originalQty, setOriginalQty]       = useState({})
  const [originalNotes, setOriginalNotes]   = useState('')

  // ─── Cost data for dynamic gp_cost calculation ───────────────
  const [costSettings, setCostSettings] = useState({})    // cost_settings effective on date
  const [menuCostMap, setMenuCostMap]   = useState({})    // { menuId: menu_costs row }
  const [platformFeePct, setPlatformFeePct] = useState(0) // fee % for selected platform
  const [platConfig, setPlatConfig] = useState([])        // [{name, fee}] from platform_config
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false)
  // posUnitPrices: weighted avg unit_price per menu from POS (includes addons)
  const [posUnitPrices, setPosUnitPrices] = useState({})

  // Load menus + platform_config
  useEffect(() => {
    const loadMenus = async () => {
      const [menuRes, settingsRes] = await Promise.all([
        supabase
          .from('menus')
          .select('id, name, category, gp_cost, is_sold_out, menu_prices(platform, price)')
          .eq('is_active', true)
          .eq('is_sold_out', false)
          .order('sort_order', { ascending: true })
          .order('name'),
        supabase.from('settings').select('key, value').eq('key', 'platform_config').maybeSingle(),
      ])
      if (menuRes.data) setMenus(menuRes.data)
      if (settingsRes.data?.value) {
        try { setPlatConfig(JSON.parse(settingsRes.data.value)) } catch {}
      } else {
        // Fallback: build from default platforms with 0 fee
        setPlatConfig(DEFAULT_PLATFORMS.map(name => ({ name, fee: 0 })))
      }
      setLoading(false)
    }
    loadMenus()

    // Restore draft — only when NOT navigating to a specific date from history
    // If ?date= param exists, the DB check useEffect will load the correct data instead
    const urlDate = searchParams.get('date')
    if (!urlDate) {
      const draft = loadDraft()
      if (draft && draft.date === today()) {
        // Only restore if draft is from today (avoid restoring stale drafts)
        if (draft.platform)   setPlatform(draft.platform)
        if (draft.quantities) setQuantities(draft.quantities)
        if (draft.costs)      setCosts(draft.costs)
        if (draft.notes)      setNotes(draft.notes)
      }
    }

    const handleOnline  = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)

    // Auto-update date when app is reopened / tab is focused on a new day
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !searchParams.get('date')) {
        setDate(today())
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  // Load cost_settings + menu_costs + platform fee% — triggered by date or platform change
  useEffect(() => {
    const loadCostData = async () => {
      const [cs, mcRaw] = await Promise.all([
        // cost_settings effective on the selected date (handles backdated entries correctly)
        getCostSettingsForDate(date),
        // all menu_costs effective on the selected date
        supabase
          .from('menu_costs')
          .select('*')
          .lte('effective_from', date)
          .or(`effective_to.is.null,effective_to.gt.${date}`)
          .order('effective_from', { ascending: false }),
      ])

      setCostSettings(cs ?? {})
      // Fee from platConfig (already loaded); fallback to 0 for unknown platforms
      const feePct = platConfig.find(p => p.name === platform)?.fee ?? 0
      setPlatformFeePct(feePct)

      // Deduplicate by menu_id — take the most recent row per menu
      const mcMap = {}
      for (const row of mcRaw.data ?? []) {
        if (!(row.menu_id in mcMap)) mcMap[row.menu_id] = row
      }
      setMenuCostMap(mcMap)
    }
    loadCostData()
  }, [date, platform, platConfig])

  // Load default costs when platform changes
  useEffect(() => {
    const loadDefaults = async () => {
      const defaults = await getSetting(`${platSlug(platform)}_defaults`)
      if (defaults) {
        setCosts(prev => ({
          menu_discount: defaults.menu_discount ?? prev.menu_discount,
          campaign: defaults.campaign ?? prev.campaign,
          marketing_fee: defaults.marketing_fee ?? prev.marketing_fee,
          delivery_discount: defaults.delivery_discount ?? prev.delivery_discount,
          advertisement: defaults.advertisement ?? prev.advertisement,
        }))
      }
    }
    loadDefaults()
  }, [platform])

  // Check data: POS มี priority เสมอ — ถ้ามี POS orders ให้ใช้ POS
  useEffect(() => {
    const check = async () => {
      // Step 1: ตรวจสอบ POS orders ก่อน (notes IS NOT NULL)
      const { data: posOrders } = await supabase
        .from('orders')
        .select('id')
        .eq('date', date)
        .eq('platform', platform)
        .not('notes', 'is', null)

      const hasPOS = (posOrders?.length ?? 0) > 0

      if (!hasPOS) {
        // ── ไม่มี POS — โหลด SalesEntry เก่า (manual mode) ────────────
        const { data: order } = await supabase
          .from('orders')
          .select('id, notes, status')
          .eq('date', date)
          .eq('platform', platform)
          .eq('status', 'delivered')
          .maybeSingle()

        if (order) {
          setExistingWarning(true)
          setPosUnitPrices({})

          const { data: items } = await supabase
            .from('order_items')
            .select('menu_id, quantity, is_campaign')
            .eq('order_id', order.id)

          const loadedQty = {}
          const loadedCampaignQty = {}
          for (const item of items ?? []) {
            if (item.is_campaign) loadedCampaignQty[item.menu_id] = item.quantity
            else                  loadedQty[item.menu_id]         = item.quantity
          }
          setQuantities(loadedQty)
          setCampaignQty(loadedCampaignQty)
          setHasCampaign(Object.keys(loadedCampaignQty).length > 0)

          const { data: pc } = await supabase
            .from('platform_costs').select('*')
            .eq('date', date).eq('platform', platform).maybeSingle()
          if (pc) {
            setCosts({
              menu_discount:     pc.menu_discount     ?? 0,
              campaign:          pc.campaign          ?? 0,
              marketing_fee:     pc.marketing_fee     ?? 0,
              delivery_discount: pc.delivery_discount ?? 0,
              advertisement:     pc.advertisement     ?? 0,
            })
            setHasCampaign((pc.campaign_revenue ?? 0) > 0)
          }

          setNotes(order.notes ?? '')
          setOriginalQty(loadedQty)
          setOriginalCampaignQty(loadedCampaignQty)
          setOriginalNotes(order.notes ?? '')
          setIsLocked(true)
          return
        }
      }

      // ── มี POS orders หรือไม่มีอะไรเลย — ใช้ POS data ──────────────
      {
        setIsLocked(false)
        setNotes('')
        setOriginalQty({})
        setOriginalCampaignQty({})
        setOriginalNotes('')

        // โหลด platform_costs ที่บันทึกไว้ก่อนหน้า (POS mode)
        const { data: existingCosts } = await supabase
          .from('platform_costs')
          .select('*')
          .eq('date', date)
          .eq('platform', platform)
          .maybeSingle()

        if (existingCosts) {
          setExistingWarning(true)
          setCosts({
            menu_discount:     existingCosts.menu_discount     ?? 0,
            campaign:          existingCosts.campaign          ?? 0,
            marketing_fee:     existingCosts.marketing_fee     ?? 0,
            delivery_discount: existingCosts.delivery_discount ?? 0,
            advertisement:     existingCosts.advertisement     ?? 0,
          })
        } else {
          setExistingWarning(false)
          setCosts({ menu_discount: 0, campaign: 0, marketing_fee: 0, delivery_discount: 0, advertisement: 0 })
        }

        // ── Auto-import from POS ──────────────────────────────
        const { data: posOrders } = await supabase
          .from('orders')
          .select('id')
          .eq('date', date)
          .eq('platform', platform)
          .not('notes', 'is', null)

        if (posOrders?.length) {
          const { data: posItems } = await supabase
            .from('order_items')
            .select('menu_id, quantity, unit_price, is_campaign')
            .in('order_id', posOrders.map(o => o.id))

          const autoQty = {}
          const autoCampaignQty = {}
          // สำหรับ weighted avg price (รวม addon/milk)
          const revenueMap = {}
          const totalQtyMap = {}

          for (const item of posItems ?? []) {
            const id = item.menu_id
            if (item.is_campaign) {
              autoCampaignQty[id] = (autoCampaignQty[id] ?? 0) + item.quantity
            } else {
              autoQty[id] = (autoQty[id] ?? 0) + item.quantity
            }
            // รวม revenue เพื่อคำนวณ avg unit_price
            revenueMap[id]   = (revenueMap[id]   ?? 0) + (item.unit_price ?? 0) * item.quantity
            totalQtyMap[id]  = (totalQtyMap[id]  ?? 0) + item.quantity
          }

          // weighted avg unit_price per menu (รวมราคา addon ที่แท้จริง)
          const avgPrices = {}
          for (const id of Object.keys(totalQtyMap)) {
            if (totalQtyMap[id] > 0) avgPrices[id] = revenueMap[id] / totalQtyMap[id]
          }

          setQuantities(autoQty)
          setCampaignQty(autoCampaignQty)
          setPosUnitPrices(avgPrices)
          setHasCampaign(Object.keys(autoCampaignQty).length > 0)
          // ไม่ reset costs ที่นี่ — โหลดมาจาก existingCosts แล้วด้านบน
        } else {
          setQuantities({})
          setCampaignQty({})
          setPosUnitPrices({})
          setCosts({ menu_discount: 0, campaign: 0, marketing_fee: 0, delivery_discount: 0, advertisement: 0 })
          setHasCampaign(false)
        }
      }
    }
    check()
  }, [date, platform])

  // Auto-save draft every 30s
  useEffect(() => {
    clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => {
      saveDraft({ date, platform, quantities, costs, notes })
    }, 30000)
    return () => clearTimeout(draftTimer.current)
  }, [date, platform, quantities, costs, notes])

  // ─── Offline Sync ─────────────────────────────────────────────
  // Auto-sync queue when coming back online
  useEffect(() => {
    if (!online) return
    const queue = getSyncQueue()
    if (queue.length === 0) return
    setSyncStatus('syncing')
    processSyncQueue(supabase).then(result => {
      setSyncQueue(getSyncQueue())
      setSyncStatus(result.failed > 0 ? 'error' : 'synced')
      setTimeout(() => setSyncStatus('idle'), 4000)
    })
  }, [online])

  // ─── Delete Order ─────────────────────────────────────────────
  const handleDelete = () => setShowDeleteConfirm(true)

  const confirmDelete = async () => {
    setShowDeleteConfirm(false)
    try {
      const { data: order } = await supabase
        .from('orders').select('id').eq('date', date).eq('platform', platform).single()
      if (order) {
        await supabase.from('order_items').delete().eq('order_id', order.id)
        await supabase.from('orders').delete().eq('id', order.id)
        await supabase.from('platform_costs').delete().eq('date', date).eq('platform', platform)
      }
      setQuantities({})
      setCampaignQty({})
      setCosts({ menu_discount: 0, campaign: 0, marketing_fee: 0, delivery_discount: 0, advertisement: 0 })
      setHasCampaign(false)
      setNotes('')
      setIsLocked(false)
      setExistingWarning(false)
      clearDraft()
      addToast(`ลบออเดอร์ ${platform} วันที่ ${date} แล้ว`, 'success')
    } catch (err) {
      addToast('ลบไม่สำเร็จ: ' + (err.message ?? 'Unknown error'), 'error')
    }
  }

  // ─── Print Receipt ────────────────────────────────────────────
  const handlePrint = () => {
    const selectedMenus = menus.filter(m => (quantities[m.id] ?? 0) > 0)
    const printContent = `
      <html><head><meta charset="UTF-8">
      <style>
        body { font-family: monospace; font-size: 13px; padding: 20px; max-width: 300px; margin: 0 auto; }
        h2   { text-align: center; margin-bottom: 4px; }
        .sub { text-align: center; color: #666; margin-bottom: 12px; }
        hr   { border: none; border-top: 1px dashed #ccc; margin: 10px 0; }
        .row { display: flex; justify-content: space-between; margin: 3px 0; }
        .total { font-weight: bold; font-size: 15px; }
        .footer { text-align: center; color: #999; margin-top: 12px; font-size: 11px; }
      </style></head><body>
      <h2>☕ Cocoa House</h2>
      <div class="sub">${platform} · ${date}</div>
      <hr>
      ${selectedMenus.map(m => {
        const qty   = quantities[m.id]
        const price = currentMenuPrices[m.id]?.price ?? 0
        return `<div class="row"><span>${m.name} ×${qty}</span><span>${(qty * price).toFixed(0)} ฿</span></div>`
      }).join('')}
      <hr>
      <div class="row total"><span>ยอดขาย</span><span>${profit.sales.toFixed(0)} ฿</span></div>
      <div class="row"><span>กำไรสุทธิ</span><span>${profit.netProfit.toFixed(0)} ฿ (${profit.netProfitPct.toFixed(1)}%)</span></div>
      <div class="footer">พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')}</div>
      </body></html>
    `
    const w = window.open('', '_blank', 'width=400,height=600')
    w.document.write(printContent)
    w.document.close()
    w.print()
  }

  const handleManualSync = useCallback(async () => {
    if (!online || syncStatus === 'syncing') return
    setSyncStatus('syncing')
    const result = await processSyncQueue(supabase)
    setSyncQueue(getSyncQueue())
    setSyncStatus(result.failed > 0 ? 'error' : 'synced')
    setTimeout(() => setSyncStatus('idle'), 4000)
  }, [online, syncStatus])

  // ─── Unsaved Changes Protection ──────────────────────────────
  // For new entries: dirty when any qty > 0 or notes filled
  // For existing (after แก้ไข): dirty only when changed vs loaded snapshot
  const isDirty = !isLocked && (() => {
    const hasExisting = Object.keys(originalQty).length > 0 || Object.keys(originalCampaignQty).length > 0 || originalNotes !== ''
    if (!hasExisting) {
      return Object.values(quantities).some(q => q > 0)
          || Object.values(campaignQty).some(q => q > 0)
          || notes.trim() !== ''
    }
    if (notes !== originalNotes) return true
    const normalKeys = new Set([...Object.keys(originalQty), ...Object.keys(quantities)])
    if ([...normalKeys].some(k => (quantities[k] ?? 0) !== (originalQty[k] ?? 0))) return true
    const campKeys = new Set([...Object.keys(originalCampaignQty), ...Object.keys(campaignQty)])
    return [...campKeys].some(k => (campaignQty[k] ?? 0) !== (originalCampaignQty[k] ?? 0))
  })()

  // Block in-app navigation when dirty (requires createBrowserRouter / data router)
  const blocker = useBlocker(isDirty)

  // Also block browser tab close / refresh
  useEffect(() => {
    if (!isDirty) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const setQty = useCallback((menuId, delta) => {
    setQuantities(prev => {
      const cur = prev[menuId] ?? 0
      const next = Math.max(0, cur + delta)
      if (next === 0) {
        const { [menuId]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [menuId]: next }
    })
  }, [])

  const setQtyDirect = useCallback((menuId, val) => {
    const n = parseInt(val) || 0
    if (n <= 0) {
      setQuantities(prev => { const { [menuId]: _, ...rest } = prev; return rest })
    } else {
      setQuantities(prev => ({ ...prev, [menuId]: n }))
    }
  }, [])

  const setCampaignQtyDelta = useCallback((menuId, delta) => {
    setCampaignQty(prev => {
      const cur  = prev[menuId] ?? 0
      const next = Math.max(0, cur + delta)
      if (next === 0) { const { [menuId]: _, ...rest } = prev; return rest }
      return { ...prev, [menuId]: next }
    })
  }, [])

  const setCampaignQtyDirect = useCallback((menuId, val) => {
    const n = parseInt(val) || 0
    if (n <= 0) {
      setCampaignQty(prev => { const { [menuId]: _, ...rest } = prev; return rest })
    } else {
      setCampaignQty(prev => ({ ...prev, [menuId]: n }))
    }
  }, [])

  // ─── Dynamic GP Cost per menu (normal platform fee) ─────────
  const currentMenuPrices = useMemo(() => {
    return menus.reduce((acc, m) => {
      const priceObj  = m.menu_prices?.find(p => p.platform === platform)
      const price     = priceObj?.price ?? 0
      const mc        = menuCostMap[m.id] ?? null
      const breakdown = calcMenuCostBreakdown(mc, costSettings, price, platformFeePct)
      acc[m.id] = { price, gp_cost: breakdown?.gpCost ?? m.gp_cost ?? 0 }
      return acc
    }, {})
  }, [menus, platform, menuCostMap, costSettings, platformFeePct])

  // ─── Campaign GP Cost per menu (5% flat fee) ─────────────────
  const campaignMenuPrices = useMemo(() => {
    if (!hasCampaign) return {}
    return menus.reduce((acc, m) => {
      const priceObj  = m.menu_prices?.find(p => p.platform === platform)
      const price     = priceObj?.price ?? 0
      const mc        = menuCostMap[m.id] ?? null
      const breakdown = calcMenuCostBreakdown(mc, costSettings, price, CAMPAIGN_GP_PCT)
      acc[m.id] = { price, gp_cost: breakdown?.gpCost ?? m.gp_cost ?? 0 }
      return acc
    }, {})
  }, [menus, platform, menuCostMap, costSettings, hasCampaign])

  // ─── Live profit preview (normal + campaign items combined) ──
  const normalItems = Object.entries(quantities)
    .filter(([_, qty]) => qty > 0)
    .map(([menuId, quantity]) => ({
      quantity,
      unit_price:   posUnitPrices[menuId] ?? currentMenuPrices[menuId]?.price   ?? 0,
      unit_gp_cost: currentMenuPrices[menuId]?.gp_cost ?? 0,
      is_campaign:  false,
    }))

  const campaignItems = Object.entries(campaignQty)
    .filter(([_, qty]) => qty > 0)
    .map(([menuId, quantity]) => ({
      quantity,
      unit_price:   posUnitPrices[menuId] ?? campaignMenuPrices[menuId]?.price ?? currentMenuPrices[menuId]?.price ?? 0,
      unit_gp_cost: campaignMenuPrices[menuId]?.gp_cost ?? currentMenuPrices[menuId]?.gp_cost ?? 0,
      is_campaign:  true,
    }))

  const allItems = [...normalItems, ...campaignItems]
  const profit   = calcPlatformProfit({ items: allItems, costs, platformFeePct })

  // ── Import from POS ──────────────────────────────────────────
  const importFromPOS = async () => {
    setImporting(true)
    try {
      // ดึงออเดอร์ทั้งหมดของวันนี้+platform ที่สร้างจาก POS
      // (ไม่ใช่ 'delivered' ที่ SalesEntry บันทึก — POS orders มักมี notes เช่น GF-012)
      const { data: orders } = await supabase
        .from('orders')
        .select('id')
        .eq('date', date)
        .eq('platform', platform)
        .not('notes', 'is', null)  // POS orders จะมี notes เสมอ

      if (!orders?.length) {
        addToast('ไม่พบออเดอร์จาก POS สำหรับวันที่และ Platform นี้', 'error')
        return
      }

      const { data: items } = await supabase
        .from('order_items')
        .select('menu_id, quantity, is_campaign')
        .in('order_id', orders.map(o => o.id))

      const newQty = {}
      const newCampaignQty = {}
      for (const item of items ?? []) {
        if (item.is_campaign) {
          newCampaignQty[item.menu_id] = (newCampaignQty[item.menu_id] ?? 0) + item.quantity
        } else {
          newQty[item.menu_id] = (newQty[item.menu_id] ?? 0) + item.quantity
        }
      }

      setQuantities(newQty)
      setCampaignQty(newCampaignQty)
      setHasCampaign(Object.keys(newCampaignQty).length > 0)
      const total = Object.values(newQty).reduce((s, v) => s + v, 0) + Object.values(newCampaignQty).reduce((s, v) => s + v, 0)
      setImportCount(total)
      addToast(`นำเข้าจาก POS สำเร็จ — ${orders.length} ออเดอร์, ${total} รายการ`, 'success')
    } catch (err) {
      console.error(err)
      addToast('เกิดข้อผิดพลาดในการนำเข้าข้อมูล', 'error')
    }
    setImporting(false)
  }

  const handleSave = async (force = false) => {
    // Warn if no items selected
    if (totalItems === 0 && !force) {
      setShowEmptyConfirm(true)
      return
    }

    setSaveStatus('saving')
    saveDraft({ date, platform, quantities, costs, notes })

    const hasPOSData = Object.keys(posUnitPrices).length > 0

    try {
      if (hasPOSData) {
        // ── POS mode: ข้อมูลออเดอร์มีอยู่แล้วใน POS orders ──────────────
        // ไม่ต้อง insert order_items ซ้ำ (Dashboard จะ double-count)
        // บันทึกเฉพาะ platform_costs เท่านั้น
        const { error: costsError } = await supabase
          .from('platform_costs')
          .upsert({ date, platform, ...costs }, { onConflict: 'date,platform' })
        if (costsError) throw costsError
      } else {
        // ── Manual mode: ไม่มี POS data — บันทึกแบบเดิม ─────────────────
        const { data: orderData, error: orderError } = await supabase
          .from('orders')
          .upsert({ date, platform, notes, status: 'delivered' }, { onConflict: 'date,platform' })
          .select()
          .single()
        if (orderError) throw orderError

        const orderId = orderData.id
        await supabase.from('order_items').delete().eq('order_id', orderId)

        const itemsToInsert = [
          ...Object.entries(quantities)
            .filter(([_, qty]) => qty > 0)
            .map(([menuId, quantity]) => ({
              order_id:    orderId,
              menu_id:     menuId,
              quantity,
              unit_price:   currentMenuPrices[menuId]?.price   ?? 0,
              unit_gp_cost: currentMenuPrices[menuId]?.gp_cost ?? 0,
              is_campaign:  false,
            })),
          ...Object.entries(campaignQty)
            .filter(([_, qty]) => qty > 0)
            .map(([menuId, quantity]) => ({
              order_id:    orderId,
              menu_id:     menuId,
              quantity,
              unit_price:   campaignMenuPrices[menuId]?.price ?? currentMenuPrices[menuId]?.price ?? 0,
              unit_gp_cost: campaignMenuPrices[menuId]?.gp_cost ?? currentMenuPrices[menuId]?.gp_cost ?? 0,
              is_campaign:  true,
            })),
        ]
        if (itemsToInsert.length > 0) {
          const { error: itemsError } = await supabase.from('order_items').insert(itemsToInsert)
          if (itemsError) throw itemsError
        }

        // platform_costs for manual mode
        const { error: costsError } = await supabase
          .from('platform_costs')
          .upsert({ date, platform, ...costs }, { onConflict: 'date,platform' })
        if (costsError) throw costsError
      }

      setSaveStatus('success')
      setIsLocked(true)
      clearDraft()
      setTimeout(() => setSaveStatus('idle'), 3000)
    } catch (err) {
      if (!isOnline()) {
        // Enqueue full order (header + items + costs) so nothing is lost on sync
        const itemsForQueue = Object.entries(quantities)
          .filter(([, qty]) => qty > 0)
          .map(([menuId, quantity]) => ({
            menu_id:      menuId,
            quantity,
            unit_price:   currentMenuPrices[menuId]?.price    ?? 0,
            unit_gp_cost: currentMenuPrices[menuId]?.gp_cost  ?? 0,
          }))
        enqueueSync({
          type: 'upsert_full_order',
          data: {
            order: { date, platform, notes, status: 'delivered' },
            items: itemsForQueue,
            costs: { date, platform, ...costs },
          },
        })
        setSyncQueue(getSyncQueue())
        setSaveStatus('offline')
        addToast('บันทึกไว้ใน queue แล้ว จะ sync เมื่อกลับมา online', 'warning')
      } else {
        console.error(err)
        setSaveStatus('error')
        addToast('บันทึกไม่สำเร็จ: ' + (err.message ?? 'Unknown error'), 'error')
      }
      setTimeout(() => setSaveStatus('idle'), 4000)
    }
  }

  const filteredMenus = menus.filter(m => {
    const matchCat = filterCategory === 'all' || m.category === filterCategory
    const matchSearch = searchQuery === '' ||
      m.name.toLowerCase().includes(searchQuery.toLowerCase())
    return matchCat && matchSearch
  })

  const totalItems = Object.values(quantities).reduce((s, q) => s + q, 0)
                   + Object.values(campaignQty).reduce((s, q) => s + q, 0)

  // True if cost data is fully loaded (used to show a subtle indicator)
  const hasCostData = Object.keys(costSettings).length > 0

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">กรอกยอดขาย</h1>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="flex items-center gap-1 text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded-full border border-orange-200">
              ● ยังไม่บันทึก
            </span>
          )}
          {!online && (
            <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
              <WifiOff size={12} /> Offline
            </span>
          )}
          {isLocked ? (
            <>
              <button
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                <Printer size={14} /> พิมพ์
              </button>
              <button
                onClick={handleDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-sm font-medium hover:bg-red-100 transition-colors"
              >
                <Trash2 size={14} /> ลบ
              </button>
              <button
                onClick={() => setIsLocked(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 text-sm font-medium hover:bg-amber-200 transition-colors"
              >
                <Pencil size={14} /> แก้ไข
              </button>
            </>
          ) : existingWarning && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Lock size={12} /> มีข้อมูลอยู่แล้ว
            </span>
          )}
        </div>
      </div>

      {/* Offline sync status banner */}
      {(syncQueue.length > 0 || syncStatus !== 'idle') && (
        <div className={`rounded-xl border px-4 py-2.5 text-sm transition-all ${
          syncStatus === 'syncing' ? 'bg-blue-50 border-blue-200 text-blue-700'
          : syncStatus === 'synced' ? 'bg-green-50 border-green-200 text-green-700'
          : syncStatus === 'error'  ? 'bg-red-50 border-red-200 text-red-700'
          : 'bg-amber-50 border-amber-200 text-amber-700'
        }`}>
          {/* Status row */}
          <div className="flex items-center gap-2.5">
            {syncStatus === 'syncing' ? (
              <RefreshCw size={15} className="animate-spin shrink-0" />
            ) : syncStatus === 'synced' ? (
              <CheckCircle size={15} className="shrink-0" />
            ) : syncStatus === 'error' ? (
              <AlertCircle size={15} className="shrink-0" />
            ) : (
              <CloudOff size={15} className="shrink-0" />
            )}

            <span className="flex-1 font-medium">
              {syncStatus === 'syncing' && 'กำลัง sync ข้อมูล...'}
              {syncStatus === 'synced'  && 'Sync สำเร็จทุกรายการ ✅'}
              {syncStatus === 'error'   && 'Sync บางรายการล้มเหลว'}
              {syncStatus === 'idle'    && `${syncQueue.length} รายการรอ sync`}
            </span>

            {syncStatus === 'idle' && syncQueue.length > 0 && online && (
              <button
                onClick={handleManualSync}
                className="flex items-center gap-1 shrink-0 px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg text-xs font-medium transition-colors"
              >
                <RefreshCw size={11} /> Sync เลย
              </button>
            )}

            {syncQueue.length > 0 && (
              <button
                onClick={() => setShowQueue(v => !v)}
                className="shrink-0 text-xs opacity-60 hover:opacity-100 underline"
              >
                {showQueue ? 'ซ่อน' : 'ดูรายการ'}
              </button>
            )}
          </div>

          {/* Queue detail */}
          {showQueue && syncQueue.length > 0 && (
            <div className="mt-2.5 space-y-1.5 border-t border-current/20 pt-2.5">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-semibold opacity-70">รายการที่รอ sync</span>
                <button
                  onClick={() => { clearSyncQueue(); setSyncQueue([]) }}
                  className="text-xs opacity-60 hover:opacity-100 underline"
                >
                  ล้างทั้งหมด
                </button>
              </div>
              {syncQueue.map(op => (
                <div key={op.id} className="flex items-center gap-2 bg-white/60 rounded-lg px-3 py-1.5 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50 shrink-0" />
                  <span className="flex-1 text-gray-600">
                    {op.type === 'upsert_full_order'
                      ? `ออเดอร์ ${op.data?.order?.date ?? ''} · ${op.data?.order?.platform ?? ''} (${op.data?.items?.length ?? 0} เมนู)`
                      : op.type === 'upsert_order'
                      ? `ออเดอร์ ${op.data?.date ?? ''} · ${op.data?.platform ?? ''}`
                      : op.type}
                  </span>
                  <span className="text-gray-400 shrink-0">
                    {new Date(op.enqueuedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Date + Platform selector */}
      <div className="card space-y-3">
        <div>
          <label htmlFor="entry-date" className="label">วันที่</label>
          <input
            id="entry-date"
            type="date"
            className="input disabled:bg-gray-50 disabled:text-gray-400"
            value={date}
            disabled={isLocked}
            onChange={e => setDate(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Platform</label>
          <div className="grid grid-cols-3 gap-1.5">
            {(platConfig.length ? platConfig : DEFAULT_PLATFORMS.map(name => ({ name, fee: 0 }))).map(({ name }, idx) => (
              <button
                key={name}
                onClick={() => !isLocked && setPlatform(name)}
                disabled={isLocked}
                aria-pressed={platform === name}
                className={`py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                  platform === name
                    ? getPlatBtnColor(name, idx)
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {existingWarning && (
          <div role="status" className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2 rounded-lg">
            <AlertCircle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
            <span>มีข้อมูลวันนี้ {platform} แล้ว — การบันทึกจะอัปเดตทับข้อมูลเดิม</span>
          </div>
        )}


        {/* Cost data status */}
        {!hasCostData && !loading && (
          <div role="status" className="flex items-start gap-2 bg-blue-50 border border-blue-200 text-blue-700 text-xs px-3 py-2 rounded-lg">
            <AlertCircle size={13} className="shrink-0 mt-0.5" aria-hidden="true" />
            ยังไม่มีข้อมูลต้นทุนส่วนกลาง — unit_gp_cost จะใช้ค่าเริ่มต้น กรุณาตั้งค่าที่หน้า <strong>ตั้งค่า</strong> และ <strong>ต้นทุนเมนู</strong>
          </div>
        )}
      </div>

      {/* Platform Costs */}
      <div className="card">
        <button
          onClick={() => setShowCosts(!showCosts)}
          className="w-full flex items-center justify-between font-semibold text-gray-800"
        >
          <span>ค่าใช้จ่าย {platform}</span>
          {showCosts ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>

        {showCosts && (
          <div className="grid grid-cols-2 gap-3 mt-3">
            {[
              { key: 'menu_discount', label: 'Menu Discount (฿)' },
              { key: 'campaign', label: 'Campaign (฿)' },
              { key: 'marketing_fee', label: 'Marketing Fee (฿)' },
              { key: 'delivery_discount', label: 'Delivery Discount (฿)' },
              { key: 'advertisement', label: 'Advertisement (฿)' },
            ].map(({ key, label }) => (
              <div key={key}>
                <label htmlFor={`cost-${key}`} className="label text-xs">{label}</label>
                <input
                  id={`cost-${key}`}
                  type="number"
                  className="input text-right disabled:bg-gray-50 disabled:text-gray-400"
                  min="0"
                  disabled={isLocked}
                  value={costs[key]}
                  onChange={e => setCosts(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            ))}

            {/* ── Grab Campaign 60/40 toggle (GRAB only) ─────────── */}
            {platform === 'GRAB' && (
              <div className="col-span-2 border-t border-dashed border-green-200 pt-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700">🎯 มีออเดอร์แคมเปญ 60/40 วันนี้</p>
                    <p className="text-xs text-gray-400 mt-0.5">เปิดเพื่อกรอกจำนวนแยกต่อเมนูด้านล่าง (GP 5%)</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={hasCampaign}
                    aria-label="เปิด/ปิดแคมเปญ 60/40"
                    disabled={isLocked}
                    onClick={() => {
                      const next = !hasCampaign
                      setHasCampaign(next)
                      if (!next) setCampaignQty({})
                    }}
                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0
                      ${hasCampaign ? 'bg-green-500' : 'bg-gray-200'} disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200
                      ${hasCampaign ? 'translate-x-5' : ''}`} />
                  </button>
                </div>
              </div>
            )}

            <div className="col-span-2">
              <label htmlFor="entry-notes" className="label text-xs">หมายเหตุ</label>
              <input
                id="entry-notes"
                type="text"
                className="input disabled:bg-gray-50 disabled:text-gray-400"
                placeholder="เช่น วันหยุด / โปรโมชั่น / ของหมด"
                disabled={isLocked}
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Sales Summary by type — แสดงเสมอเมื่อมีข้อมูล (ทั้ง locked และ editing) */}
      {(totalItems > 0 || (isLocked && Object.keys(quantities).length > 0)) && (() => {
        const BEV_CATS  = ['Cocoa', 'Coffee', 'Matcha', 'Classic', 'Hot']
        const summary = { bev: 0, bread: 0, refill: 0, addon: 0 }
        for (const menu of menus) {
          const qty = quantities[menu.id] ?? 0
          if (!qty) continue
          if (BEV_CATS.includes(menu.category))  summary.bev   += qty
          else if (menu.category === 'Bun')       summary.bread  += qty
          else if (menu.category === 'Refill')    summary.refill += qty
          else if (menu.category === 'Addon')     summary.addon  += qty
        }
        const boxes = [
          { label: 'Beverage', value: summary.bev,    icon: '🧋', color: 'bg-cocoa-50 border-cocoa-200 text-cocoa-800' },
          { label: 'Bread',    value: summary.bread,  icon: '🍞', color: 'bg-amber-50 border-amber-200 text-amber-800' },
          { label: 'Refill',   value: summary.refill, icon: '🔁', color: 'bg-blue-50 border-blue-200 text-blue-800' },
          { label: 'Add-on',   value: summary.addon,  icon: '➕', color: 'bg-purple-50 border-purple-200 text-purple-800' },
        ]
        return (
          <div className="grid grid-cols-4 gap-2">
            {boxes.map(({ label, value, icon, color }) => (
              <div key={label} className={`rounded-xl border px-3 py-2.5 text-center ${color}`}>
                <p className="text-lg">{icon}</p>
                <p className="text-xl font-bold leading-tight">{value}</p>
                <p className="text-xs mt-0.5 opacity-70">{label}</p>
              </div>
            ))}
          </div>
        )
      })()}

      {/* Search box */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          className="input pl-9 pr-9"
          placeholder="ค้นหาเมนู..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* Category filter */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <button
          onClick={() => setFilterCategory('all')}
          className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            filterCategory === 'all' ? 'bg-cocoa-700 text-white' : 'bg-white text-gray-600 border border-gray-200'
          }`}
        >
          ทั้งหมด
        </button>
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setFilterCategory(cat)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filterCategory === cat ? 'bg-cocoa-700 text-white' : 'bg-white text-gray-600 border border-gray-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Menu List */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">กำลังโหลดเมนู...</div>
      ) : (
        <div className="space-y-2">
          {filteredMenus.map(menu => {
            const price  = currentMenuPrices[menu.id]?.price ?? 0
            const qty    = quantities[menu.id] ?? 0
            const cQty   = campaignQty[menu.id] ?? 0
            const active = qty > 0 || cQty > 0

            return (
              <div
                key={menu.id}
                className={`card transition-all ${active ? 'ring-2 ring-cocoa-400' : ''}`}
              >
                {/* ── Normal row ── */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm leading-tight truncate">{menu.name}</p>
                    <p className="text-xs text-gray-400">{menu.category} • {formatBaht(price)}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setQty(menu.id, -1)} disabled={qty === 0 || isLocked}
                      aria-label={`ลด ${menu.name}`}
                      className="w-10 h-10 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center disabled:opacity-30 transition-colors">
                      <Minus size={18} aria-hidden="true" />
                    </button>
                    <input type="number" min="0" disabled={isLocked}
                      aria-label={`จำนวน ${menu.name}`}
                      className="w-12 text-center font-bold text-lg border-0 outline-none bg-transparent disabled:text-gray-400"
                      value={qty || ''} placeholder="0"
                      onChange={e => setQtyDirect(menu.id, e.target.value)} />
                    <button onClick={() => setQty(menu.id, +1)} disabled={isLocked}
                      aria-label={`เพิ่ม ${menu.name}`}
                      className="w-10 h-10 rounded-xl bg-cocoa-700 hover:bg-cocoa-800 text-white flex items-center justify-center disabled:opacity-50 transition-colors">
                      <Plus size={18} aria-hidden="true" />
                    </button>
                  </div>

                  {qty > 0 && (
                    <div className="text-right shrink-0 min-w-[60px]">
                      <p className="text-sm font-semibold text-cocoa-700">{formatBaht(qty * price)}</p>
                    </div>
                  )}
                </div>

                {/* ── Campaign row (shown when toggle ON) ── */}
                {hasCampaign && (
                  <div className="flex items-center gap-3 mt-2 pt-2 border-t border-dashed border-green-200">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-green-700">🎯 แคมเปญ 60/40</p>
                      <p className="text-xs text-green-500">GP {CAMPAIGN_GP_PCT}%</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => setCampaignQtyDelta(menu.id, -1)} disabled={cQty === 0 || isLocked}
                        aria-label={`ลดแคมเปญ ${menu.name}`}
                        className="w-10 h-10 rounded-xl bg-green-50 hover:bg-green-100 border border-green-200 flex items-center justify-center disabled:opacity-30 transition-colors text-green-700">
                        <Minus size={18} aria-hidden="true" />
                      </button>
                      <input type="number" min="0" disabled={isLocked}
                        aria-label={`จำนวนแคมเปญ ${menu.name}`}
                        className="w-12 text-center font-bold text-lg border-0 outline-none bg-transparent disabled:text-gray-400 text-green-700"
                        value={cQty || ''} placeholder="0"
                        onChange={e => setCampaignQtyDirect(menu.id, e.target.value)} />
                      <button onClick={() => setCampaignQtyDelta(menu.id, +1)} disabled={isLocked}
                        aria-label={`เพิ่มแคมเปญ ${menu.name}`}
                        className="w-10 h-10 rounded-xl bg-green-600 hover:bg-green-700 text-white flex items-center justify-center disabled:opacity-50 transition-colors">
                        <Plus size={18} aria-hidden="true" />
                      </button>
                    </div>

                    {cQty > 0 && (
                      <div className="text-right shrink-0 min-w-[60px]">
                        <p className="text-sm font-semibold text-green-700">{formatBaht(cQty * price)}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Profit preview + Save — แสดงเสมอเมื่อไม่ได้ล็อค */}
      {!isLocked && (
        <div className="sticky bottom-20 md:bottom-6 card bg-cocoa-50 border border-cocoa-200 shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1 text-sm">
              {totalItems > 0 ? (
                <>
                  <p className="text-gray-500">{totalItems} รายการ • ยอดขาย {formatBaht(profit.sales)}</p>
                  <p className={`font-bold text-base ${profit.netProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    กำไรสุทธิ {formatBaht(profit.netProfit)} ({profit.netProfitPct.toFixed(1)}%)
                  </p>
                </>
              ) : (
                <p className="text-gray-400 text-sm">ยังไม่มีรายการขาย</p>
              )}
            </div>
            <button
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
              className="btn-primary flex items-center gap-2 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saveStatus === 'saving' && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {saveStatus === 'success' && <CheckCircle size={16} />}
              {saveStatus === 'error' && <AlertCircle size={16} />}
              <Save size={16} />
              {saveStatus === 'saving' ? 'กำลังบันทึก...'
                : saveStatus === 'success' ? 'บันทึกแล้ว!'
                : saveStatus === 'error' ? 'เกิดข้อผิดพลาด'
                : 'บันทึก'}
            </button>
          </div>

          {/* 5-layer breakdown */}
          <details className="mt-2 text-xs text-gray-600">
            <summary className="cursor-pointer text-cocoa-700 font-medium">ดูรายละเอียดกำไร</summary>
            <div className="mt-2 space-y-1 border-t pt-2">
              <div className="flex justify-between"><span>ยอดขาย</span><span>{formatBaht(profit.sales)}</span></div>
              <div className="flex justify-between text-red-500"><span>− Menu Discount</span><span>−{formatBaht(profit.menuDiscount)}</span></div>
              <div className="flex justify-between font-medium"><span>= Gross Sales</span><span>{formatBaht(profit.grossSales)}</span></div>
              {profit.campaignSales > 0 && (
                <>
                  <div className="flex justify-between text-gray-400 text-xs">
                    <span>  ยอดปกติ ({platformFeePct}% GP fee)</span><span>{formatBaht(profit.normalSales)}</span>
                  </div>
                  <div className="flex justify-between text-green-600 text-xs">
                    <span>  🎯 ยอดแคมเปญ ({CAMPAIGN_GP_PCT}% GP fee)</span><span>{formatBaht(profit.campaignSales)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-red-500">
                <span>− GP Cost <span className="text-gray-400">(วัตถุดิบ + แรงงาน + fee ตามประเภท)</span></span>
                <span>−{formatBaht(profit.gpCostTotal)}</span>
              </div>
              <div className="flex justify-between font-medium"><span>= Gross Profit</span><span>{formatBaht(profit.grossProfit)}</span></div>
              <div className="flex justify-between text-red-500"><span>− Platform Costs</span><span>−{formatBaht(profit.totalPlatformCosts)}</span></div>
              <div className={`flex justify-between font-bold border-t pt-1 ${profit.netProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                <span>= Net Profit</span><span>{formatBaht(profit.netProfit)} ({profit.netProfitPct.toFixed(1)}%)</span>
              </div>
            </div>
          </details>
        </div>
      )}

      {/* Bottom padding */}
      <div className="h-4" />

      {/* ── Delete Order Confirm Modal ────────────────────────────── */}
      {showDeleteConfirm && (
        <div role="dialog" aria-modal="true" aria-labelledby="delete-title" className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card max-w-sm w-full text-center space-y-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <Trash2 size={22} className="text-red-600" />
            </div>
            <div>
              <p id="delete-title" className="font-semibold text-gray-900">ลบออเดอร์นี้?</p>
              <p className="text-sm text-gray-500 mt-1">{platform} · {date}<br/>ข้อมูลจะถูกลบถาวร ไม่สามารถกู้คืนได้</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(false)} className="btn-secondary flex-1">ยกเลิก</button>
              <button onClick={confirmDelete} className="btn-danger flex-1">ลบถาวร</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Empty Order Confirm Modal ─────────────────────────────── */}
      {showEmptyConfirm && (
        <div role="dialog" aria-modal="true" aria-labelledby="empty-title" className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card max-w-sm w-full text-center space-y-4">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle size={22} className="text-amber-600" />
            </div>
            <div>
              <p id="empty-title" className="font-semibold text-gray-900">ยังไม่มีเมนูที่เลือก</p>
              <p className="text-sm text-gray-500 mt-1">ต้องการบันทึกออเดอร์เปล่าหรือไม่?</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowEmptyConfirm(false)} className="btn-secondary flex-1">ยกเลิก</button>
              <button onClick={() => { setShowEmptyConfirm(false); handleSave(true) }} className="btn-primary flex-1">บันทึก</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Unsaved Changes Blocker Modal ─────────────────────────── */}
      {blocker.state === 'blocked' && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="card max-w-sm w-full text-center space-y-4">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle size={24} className="text-amber-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">มีข้อมูลที่ยังไม่ได้บันทึก</p>
              <p className="text-sm text-gray-500 mt-1">ต้องการออกจากหน้านี้หรือไม่?</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => blocker.reset()} className="btn-secondary flex-1">
                อยู่ต่อ
              </button>
              <button onClick={() => blocker.proceed()} className="btn-danger flex-1">
                ออกไปเลย
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
