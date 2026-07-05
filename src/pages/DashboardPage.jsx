import { useState, useEffect, useRef } from 'react'
import { supabase, getSetting, setSetting, getCostSchema } from '../lib/supabase'
import {
  calcPlatformProfit, calcDayTotal, calcMenuCostBreakdown, formatBaht, formatPct, changePct,
  CAMPAIGN_GP_PCT,
} from '../utils/calculations'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend
} from 'recharts'
import { TrendingUp, TrendingDown, AlertTriangle, Calendar, ChevronDown, Star, Pencil, Target, GripVertical } from 'lucide-react'
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear, subYears, parseISO, startOfISOWeek, endOfISOWeek, subWeeks, getISOWeek, getISOWeekYear } from 'date-fns'
import { th } from 'date-fns/locale'

const DEFAULT_PLATFORMS = ['GRAB', 'LINE', 'SHOPEE', 'The metro', 'TU']
const KNOWN_PLAT_COLORS = { GRAB: '#22c55e', LINE: '#0d9488', SHOPEE: '#f97316', 'The metro': '#3b82f6', TU: '#a855f7' }
const EXTRA_COLORS = ['#ec4899', '#f59e0b', '#6366f1', '#14b8a6', '#84cc16', '#0ea5e9', '#f43f5e']
const getPlatColor = (name, idx) => KNOWN_PLAT_COLORS[name] ?? EXTRA_COLORS[(idx ?? 0) % EXTRA_COLORS.length]

// Sales target — maps range value to settings key + display label
const TARGET_KEY_MAP = {
  singleday: 'sales_target_daily',
  yesterday: 'sales_target_daily',
  week:      'sales_target_weekly',
  month:     'sales_target_monthly',
  lastMonth: 'sales_target_monthly',
  year:      'sales_target_yearly',
  custom:    'sales_target_monthly',
}
const TARGET_LABEL = {
  singleday: 'เป้ารายวัน',
  yesterday: 'เป้ารายวัน',
  week:      'เป้ารายสัปดาห์',
  month:     'เป้ารายเดือน',
  lastMonth: 'เป้ารายเดือน',
  year:      'เป้ารายปี',
  custom:    'เป้ารายเดือน',
}

const ranges = [
  { label: 'วันที่เลือก', value: 'singleday' },
  { label: 'เมื่อวาน',   value: 'yesterday' },
  { label: 'สัปดาห์',    value: 'week' },
  { label: 'เดือนนี้',   value: 'month' },
  { label: 'เดือนที่แล้ว', value: 'lastMonth' },
  { label: 'ปีนี้',      value: 'year' },
  { label: 'กำหนดเอง',   value: 'custom' },
]

// Parse "yyyy-Www" → { monday, sunday } as 'yyyy-MM-dd'
function weekStrToRange(weekStr) {
  if (!weekStr) {
    const now = new Date()
    return [format(startOfISOWeek(now), 'yyyy-MM-dd'), format(endOfISOWeek(now), 'yyyy-MM-dd')]
  }
  const [yearStr, weekPart] = weekStr.split('-W')
  const year = parseInt(yearStr)
  const week = parseInt(weekPart)
  // ISO week: week 1 = week containing Jan 4
  const jan4 = new Date(year, 0, 4)
  const monday = new Date(jan4)
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (week - 1) * 7)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return [format(monday, 'yyyy-MM-dd'), format(sunday, 'yyyy-MM-dd')]
}

function getDateRange(range, customStart, customEnd, singleDay, selectedWeek) {
  const now = new Date()
  switch (range) {
    case 'singleday': return [singleDay, singleDay]
    case 'week': return weekStrToRange(selectedWeek)
    case 'yesterday': {
      const y = format(subDays(now, 1), 'yyyy-MM-dd')
      return [y, y]
    }
    case 'month': return [format(startOfMonth(now), 'yyyy-MM-dd'), format(endOfMonth(now), 'yyyy-MM-dd')]
    case 'lastMonth': {
      const lm = subMonths(now, 1)
      return [format(startOfMonth(lm), 'yyyy-MM-dd'), format(endOfMonth(lm), 'yyyy-MM-dd')]
    }
    case 'year': return [format(startOfYear(now), 'yyyy-MM-dd'), format(endOfYear(now), 'yyyy-MM-dd')]
    case 'custom': return [customStart, customEnd]
    default: return [format(startOfMonth(now), 'yyyy-MM-dd'), format(endOfMonth(now), 'yyyy-MM-dd')]
  }
}

function getComparisonRange(range, customStart, customEnd, selectedWeek) {
  switch (range) {
    case 'singleday': {
      const y = format(subDays(new Date(), 1), 'yyyy-MM-dd')
      return [y, y]
    }
    case 'week': {
      const [mon] = weekStrToRange(selectedWeek)
      const prevMon = format(subWeeks(parseISO(mon), 1), 'yyyy-MM-dd')
      const prevSun = format(subDays(parseISO(mon), 1), 'yyyy-MM-dd')
      return [prevMon, prevSun]
    }
    case 'yesterday': {
      const d = format(subDays(new Date(), 2), 'yyyy-MM-dd')
      return [d, d]
    }
    case 'month': {
      const lm = subMonths(new Date(), 1)
      return [format(startOfMonth(lm), 'yyyy-MM-dd'), format(endOfMonth(lm), 'yyyy-MM-dd')]
    }
    case 'lastMonth': {
      const lm2 = subMonths(new Date(), 2)
      return [format(startOfMonth(lm2), 'yyyy-MM-dd'), format(endOfMonth(lm2), 'yyyy-MM-dd')]
    }
    case 'year': {
      const ly = subYears(new Date(), 1)
      return [format(startOfYear(ly), 'yyyy-MM-dd'), format(endOfYear(ly), 'yyyy-MM-dd')]
    }
    default: return null
  }
}

const DEFAULT_SECTION_ORDER = [
  'category-summary', 'cost-breakdown', 'sales-target', 'alerts', 'chart', 'platform', 'advertisement', 'top-menus', 'best-worst'
]

const DEFAULT_KPI_ORDER = ['total-sales', 'mat-cost', 'platform-cost', 'profit-before-mat', 'net-profit', 'days']

const DEFAULT_COST_CONFIG = {
  categories: [
    { id: 'cat-1', label: 'Cost Breakdown' },
  ],
  items: [
    { id: 'mat-cost',          catId: 'cat-1', label: 'Mat Cost',          sub: 'วัตถุดิบ + บรรจุภัณฑ์', icon: '🧪', color: 'text-orange-600', valueKey: 'totalMatCost' },
    { id: 'gp-cost',           catId: 'cat-1', label: 'GP Cost',           sub: 'ค่า GP Platform',        icon: '🧾', color: 'text-red-600',    valueKey: 'totalGpCost' },
    { id: 'labor-cost',        catId: 'cat-1', label: 'Labor Cost',        sub: 'ค่าแรง',                icon: '👷', color: 'text-gray-600',   valueKey: 'totalLaborCost' },
    { id: 'menu-discount',     catId: 'cat-1', label: 'Menu Discount',     sub: 'ส่วนลดเมนู',           icon: '🏷️', color: 'text-blue-600',  valueKey: 'totalMenuDiscount' },
    { id: 'campaign-cost',     catId: 'cat-1', label: 'Campaign Cost',     sub: 'ค่า Campaign',          icon: '📣', color: 'text-purple-600', valueKey: 'totalCampaign' },
    { id: 'marketing-fee',     catId: 'cat-1', label: 'Marketing Fee',     sub: 'ค่า Marketing',         icon: '📈', color: 'text-amber-600',  valueKey: 'totalMarketingFee' },
    { id: 'delivery-discount', catId: 'cat-1', label: 'Delivery Discount', sub: 'ส่วนลด Delivery',      icon: '🛵', color: 'text-teal-600',   valueKey: 'totalDeliveryDiscount' },
    { id: 'advertisement',     catId: 'cat-1', label: 'Advertisement',     sub: 'ค่าโฆษณา',             icon: '📢', color: 'text-red-500',    valueKey: 'totalAdvertisement' },
  ],
}

function DraggableSection({ id, dragOverId, onDragStart, onDragOver, onDrop, onDragEnd, children }) {
  const isDragTarget = dragOverId === id
  return (
    <div
      draggable
      onDragStart={() => onDragStart(id)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(id) }}
      onDrop={() => onDrop(id)}
      onDragEnd={onDragEnd}
      className={`relative group/drag transition-opacity ${isDragTarget ? 'opacity-40' : ''}`}
    >
      <div className="absolute top-3 right-3 z-10 cursor-grab active:cursor-grabbing p-1 rounded-lg opacity-0 group-hover/drag:opacity-100 transition-opacity bg-white/80 text-gray-400 hover:text-gray-600">
        <GripVertical size={15} />
      </div>
      {children}
    </div>
  )
}

// KPI Card
function KpiCard({ title, value, sub, change, positive, dragProps }) {
  const dir = change > 0 ? 'up' : 'down'
  const isDragTarget = dragProps?.dragOverId === dragProps?.id
  return (
    <div
      draggable
      onDragStart={() => dragProps?.onDragStart(dragProps.id)}
      onDragOver={(e) => { e.preventDefault(); dragProps?.onDragOver(dragProps.id) }}
      onDrop={() => dragProps?.onDrop(dragProps.id)}
      onDragEnd={dragProps?.onDragEnd}
      className={`card relative group/kpi cursor-grab active:cursor-grabbing transition-opacity select-none ${isDragTarget ? 'opacity-40 ring-2 ring-cocoa-400' : ''}`}
    >
      <div className="absolute top-2 right-2 opacity-0 group-hover/kpi:opacity-100 transition-opacity text-gray-300">
        <GripVertical size={14} />
      </div>
      <p className="text-xs text-gray-500 mb-1 pr-4">{title}</p>
      <p className={`text-2xl font-bold ${positive === false ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-sm text-gray-500 mt-0.5">{sub}</p>}
      {change != null && (
        <div className={`flex items-center gap-1 mt-1 text-xs font-medium ${positive ? 'text-green-600' : 'text-red-600'}`}>
          {dir === 'up' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {Math.abs(change).toFixed(1)}% vs ช่วงก่อน
        </div>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const [range, setRange] = useState('month')
  const [customStart, setCustomStart] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customEnd, setCustomEnd] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [data, setData] = useState(null)
  const [compData, setCompData] = useState(null)
  const [loading, setLoading] = useState(true)

  // ─── Cost Breakdown config (categories + item labels, persisted) ──────────
  function mergeCostConfig(parsed) {
    const savedIds = parsed.items.map(i => i.id)
    const newItems = DEFAULT_COST_CONFIG.items.filter(i => !savedIds.includes(i.id))
      .map(i => ({ ...i, catId: parsed.categories[0]?.id ?? 'cat-1' }))
    if (newItems.length) parsed.items = [...parsed.items, ...newItems]
    return parsed
  }

  const [costConfig, setCostConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('dashboard-cost-config')
      if (saved) return mergeCostConfig(JSON.parse(saved))
    } catch {}
    return DEFAULT_COST_CONFIG
  })
  const [costEditMode, setCostEditMode] = useState(false)
  const costDragItemRef = useRef(null)
  const [costDragOver, setCostDragOver] = useState(null) // { catId, itemId? }

  const saveCostConfig = (updater) => {
    setCostConfig(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      const json = JSON.stringify(next)
      localStorage.setItem('dashboard-cost-config', json)
      setSetting('dash_cost_config', json) // sync to Supabase
      return next
    })
  }

  const costRenameCat   = (catId, label) => saveCostConfig(p => ({ ...p, categories: p.categories.map(c => c.id === catId ? { ...c, label } : c) }))
  const costAddCat      = () => saveCostConfig(p => ({ ...p, categories: [...p.categories, { id: `cat-${Date.now()}`, label: 'หมวดใหม่' }] }))
  const costDeleteCat   = (catId) => saveCostConfig(p => {
    const fallback = p.categories.find(c => c.id !== catId)?.id ?? p.categories[0]?.id
    return {
      categories: p.categories.filter(c => c.id !== catId),
      items: p.items.map(i => i.catId === catId ? { ...i, catId: fallback } : i),
    }
  })
  const costRenameItem  = (itemId, label) => saveCostConfig(p => ({ ...p, items: p.items.map(i => i.id === itemId ? { ...i, label } : i) }))

  const handleCostDrop = (toCatId, toItemId) => {
    const fromId = costDragItemRef.current
    if (!fromId) { setCostDragOver(null); return }
    saveCostConfig(prev => {
      const items = [...prev.items]
      const fi = items.findIndex(i => i.id === fromId)
      if (fi === -1) return prev
      const item = { ...items[fi], catId: toCatId }
      items.splice(fi, 1)
      if (toItemId && toItemId !== fromId) {
        const ti = items.findIndex(i => i.id === toItemId)
        items.splice(ti >= 0 ? ti : items.length, 0, item)
      } else {
        // append after last item of this category
        const lastIdx = items.reduce((acc, it, idx) => it.catId === toCatId ? idx : acc, -1)
        items.splice(lastIdx + 1, 0, item)
      }
      return { ...prev, items }
    })
    setCostDragOver(null)
    costDragItemRef.current = null
  }

  // Drag-and-drop KPI card ordering
  const [kpiOrder, setKpiOrder] = useState(() => {
    try {
      const saved = localStorage.getItem('dashboard-kpi-order')
      if (saved) {
        const parsed = JSON.parse(saved)
        return [...parsed, ...DEFAULT_KPI_ORDER.filter(s => !parsed.includes(s))]
      }
    } catch {}
    return DEFAULT_KPI_ORDER
  })
  const [kpiDragOver, setKpiDragOver] = useState(null)
  const kpiDragItem = useRef(null)

  const handleKpiDragStart = (id) => { kpiDragItem.current = id }
  const handleKpiDragOver  = (id) => { if (id !== kpiDragItem.current) setKpiDragOver(id) }
  const handleKpiDrop      = (toId) => {
    const fromId = kpiDragItem.current
    if (!fromId || fromId === toId) { setKpiDragOver(null); return }
    setKpiOrder(prev => {
      const next = [...prev]
      const fi = next.indexOf(fromId); const ti = next.indexOf(toId)
      next.splice(fi, 1); next.splice(ti, 0, fromId)
      const json = JSON.stringify(next)
      localStorage.setItem('dashboard-kpi-order', json)
      setSetting('dash_kpi_order', json) // sync to Supabase
      return next
    })
    setKpiDragOver(null); kpiDragItem.current = null
  }
  const handleKpiDragEnd = () => { setKpiDragOver(null); kpiDragItem.current = null }

  // Drag-and-drop section ordering (persisted in localStorage)
  const [sectionOrder, setSectionOrder] = useState(() => {
    try {
      const saved = localStorage.getItem('dashboard-section-order')
      if (saved) {
        const parsed = JSON.parse(saved)
        // merge: add any new sections not in saved order
        const merged = [...parsed, ...DEFAULT_SECTION_ORDER.filter(s => !parsed.includes(s))]
        return merged
      }
    } catch {}
    return DEFAULT_SECTION_ORDER
  })
  const [dragOverId, setDragOverId] = useState(null)
  const dragItemId = useRef(null)

  const handleDragStart = (id) => { dragItemId.current = id }
  const handleDragOver  = (id) => { if (id !== dragItemId.current) setDragOverId(id) }
  const handleDrop      = (toId) => {
    const fromId = dragItemId.current
    if (!fromId || fromId === toId) { setDragOverId(null); return }
    setSectionOrder(prev => {
      const next = [...prev]
      const fi = next.indexOf(fromId)
      const ti = next.indexOf(toId)
      next.splice(fi, 1)
      next.splice(ti, 0, fromId)
      const json = JSON.stringify(next)
      localStorage.setItem('dashboard-section-order', json)
      setSetting('dash_section_order', json) // sync to Supabase
      return next
    })
    setDragOverId(null)
    dragItemId.current = null
  }
  const handleDragEnd = () => { setDragOverId(null); dragItemId.current = null }

  // Drag-and-drop category boxes within category-summary section
  const DEFAULT_CAT_BOX_ORDER = ['bev', 'bread', 'refill', 'addon']
  const [catBoxOrder, setCatBoxOrder] = useState(() => {
    try {
      const saved = localStorage.getItem('dashboard-cat-box-order')
      if (saved) {
        const parsed = JSON.parse(saved)
        return [...parsed, ...DEFAULT_CAT_BOX_ORDER.filter(b => !parsed.includes(b))]
      }
    } catch {}
    return DEFAULT_CAT_BOX_ORDER
  })
  const [catBoxDragOver, setCatBoxDragOver] = useState(null)
  const catBoxDragItem = useRef(null)
  const handleCatBoxDragStart = (id) => { catBoxDragItem.current = id }
  const handleCatBoxDragOver  = (id) => { if (id !== catBoxDragItem.current) setCatBoxDragOver(id) }
  const handleCatBoxDrop      = (toId) => {
    const fromId = catBoxDragItem.current
    if (!fromId || fromId === toId) { setCatBoxDragOver(null); return }
    setCatBoxOrder(prev => {
      const next = [...prev]
      const fi = next.indexOf(fromId); const ti = next.indexOf(toId)
      next.splice(fi, 1); next.splice(ti, 0, fromId)
      localStorage.setItem('dashboard-cat-box-order', JSON.stringify(next))
      return next
    })
    setCatBoxDragOver(null); catBoxDragItem.current = null
  }
  const handleCatBoxDragEnd = () => { setCatBoxDragOver(null); catBoxDragItem.current = null }

  // ─── Load dashboard config from Supabase on mount (sync across devices) ────
  useEffect(() => {
    Promise.all([
      getSetting('dash_cost_config'),
      getSetting('dash_kpi_order'),
      getSetting('dash_section_order'),
    ]).then(([costJson, kpiJson, sectionJson]) => {
      // ── Cost config ──
      if (costJson) {
        try {
          const parsed = mergeCostConfig(JSON.parse(costJson))
          setCostConfig(parsed)
          localStorage.setItem('dashboard-cost-config', costJson)
        } catch {}
      } else {
        // No Supabase data yet — migrate local config up so other devices can sync
        const local = localStorage.getItem('dashboard-cost-config')
        if (local) setSetting('dash_cost_config', local)
      }

      // ── KPI order ──
      if (kpiJson) {
        try {
          const parsed = JSON.parse(kpiJson)
          setKpiOrder([...parsed, ...DEFAULT_KPI_ORDER.filter(s => !parsed.includes(s))])
          localStorage.setItem('dashboard-kpi-order', kpiJson)
        } catch {}
      } else {
        const local = localStorage.getItem('dashboard-kpi-order')
        if (local) setSetting('dash_kpi_order', local)
      }

      // ── Section order ──
      if (sectionJson) {
        try {
          const parsed = JSON.parse(sectionJson)
          setSectionOrder([...parsed, ...DEFAULT_SECTION_ORDER.filter(s => !parsed.includes(s))])
          localStorage.setItem('dashboard-section-order', sectionJson)
        } catch {}
      } else {
        const local = localStorage.getItem('dashboard-section-order')
        if (local) setSetting('dash_section_order', local)
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Sales Target ─────────────────────────────────────────────
  const [salesTarget, setSalesTarget]     = useState(0)
  const [savedTarget, setSavedTarget]     = useState(0)
  const [targetInput, setTargetInput]     = useState('')
  const [targetEditing, setTargetEditing] = useState(false)
  const [savingTarget, setSavingTarget]   = useState(false)

  const [singleDay, setSingleDay] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [selectedWeek, setSelectedWeek] = useState(() => {
    const now = new Date()
    return `${getISOWeekYear(now)}-W${String(getISOWeek(now)).padStart(2, '0')}`
  })

  const targetKey = TARGET_KEY_MAP[range] ?? 'sales_target_monthly'

  useEffect(() => {
    getSetting(targetKey).then(val => {
      const n = parseFloat(val) || 0
      setSalesTarget(n)
      setSavedTarget(n)
      setTargetInput(n > 0 ? String(n) : '')
      setTargetEditing(false)
    })
  }, [targetKey])

  const saveTarget = async () => {
    setSavingTarget(true)
    const val = parseFloat(targetInput) || 0
    await setSetting(targetKey, String(val))
    setSalesTarget(val)
    setSavedTarget(val)
    setTargetEditing(false)
    setSavingTarget(false)
  }

  const cancelTarget = () => {
    setTargetInput(savedTarget > 0 ? String(savedTarget) : '')
    setTargetEditing(false)
  }

  // Platform filter: null = all, array = selected subset
  const [selectedPlatforms, setSelectedPlatforms] = useState(null)

  const togglePlatform = (p, platList) => {
    setSelectedPlatforms(prev => {
      if (prev === null) return [p]                                            // all → single
      if (prev.includes(p) && prev.length === 1) return null                  // last one → all
      return prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    })
  }
  const isAllSelected = selectedPlatforms === null

  const [start, end] = getDateRange(range, customStart, customEnd, singleDay, selectedWeek)

  const [itemsTruncated, setItemsTruncated] = useState(false)
  const ITEMS_LIMIT = 8000 // ~400 days × 5 platforms × 4 items/platform

  const fetchData = async (s, e) => {
    const today = new Date().toISOString().slice(0, 10)
    const [ordersRes, itemsRes, costsRes, settingsRes, costSettingsRes, menuCostsRes, costSchema] = await Promise.all([
      supabase.from('orders').select('*').gte('date', s).lte('date', e),
      supabase.from('order_items')
        .select('*, menus(name, category), orders!inner(date, platform, notes)')
        .gte('orders.date', s).lte('orders.date', e)
        .limit(ITEMS_LIMIT),
      supabase.from('platform_costs').select('*').gte('date', s).lte('date', e),
      supabase.from('settings').select('key, value'),
      supabase.from('cost_settings')
        .select('key, value, effective_from')
        .lte('effective_from', today)
        .or(`effective_to.is.null,effective_to.gt.${today}`)
        .order('effective_from', { ascending: false }),
      supabase.from('menu_costs').select('*').is('effective_to', null),
      getCostSchema(),
    ])
    // กรอง order_items — ป้องกัน double-count ระหว่าง POS กับ SalesEntry
    // กฎ: ถ้าวัน+platform นั้นมี POS data อยู่แล้ว → ใช้เฉพาะ POS (notes != null)
    //      ถ้าไม่มี POS → ใช้ SalesEntry (notes = null/'') แทน
    const allItems = itemsRes.data ?? []

    // หา set ของ (date|platform) ที่มี POS orders
    const posDatePlatSet = new Set()
    for (const i of allItems) {
      if (i.orders?.notes != null && i.orders.notes !== '') {
        posDatePlatSet.add(`${i.orders.date}|${i.orders.platform}`)
      }
    }

    const items = allItems.filter(i => {
      const key = `${i.orders?.date}|${i.orders?.platform}`
      const isPOS = i.orders?.notes != null && i.orders.notes !== ''
      if (isPOS) return true                    // POS → รวมเสมอ
      return !posDatePlatSet.has(key)           // SalesEntry → รวมเฉพาะวันที่ไม่มี POS
    })
    setItemsTruncated(allItems.length >= ITEMS_LIMIT)

    // Read platform config (dynamic list from settings)
    const platConfigRow = settingsRes.data?.find(r => r.key === 'platform_config')
    let platList, platFees
    if (platConfigRow) {
      const platConfig = JSON.parse(platConfigRow.value)
      platList  = platConfig.map(p => p.name)
      platFees  = Object.fromEntries(platConfig.map(p => [p.name, p.fee ?? 0]))
    } else {
      // Fallback: read legacy individual fee settings
      platList = [...DEFAULT_PLATFORMS]
      platFees = { GRAB: 0, LINE: 0, SHOPEE: 0, 'The metro': 0, TU: 0 }
      for (const row of settingsRes.data ?? []) {
        if (row.key === 'grab_fee_pct')      platFees.GRAB          = parseFloat(row.value) || 0
        if (row.key === 'line_fee_pct')      platFees.LINE          = parseFloat(row.value) || 0
        if (row.key === 'shopee_fee_pct')    platFees.SHOPEE        = parseFloat(row.value) || 0
        if (row.key === 'the_metro_fee_pct') platFees['The metro']  = parseFloat(row.value) || 0
        if (row.key === 'tu_fee_pct')        platFees.TU            = parseFloat(row.value) || 0
      }
    }

    // Build cost settings map (latest per key)
    const cs = {}
    for (const row of costSettingsRes.data ?? []) {
      if (!(row.key in cs)) cs[row.key] = Number(row.value)
    }

    // Build menuCostMap: menuId → menu_cost record
    const menuCostMap = {}
    for (const mc of menuCostsRes.data ?? []) menuCostMap[mc.menu_id] = mc

    return {
      orders: ordersRes.data ?? [],
      items,
      costs: costsRes.data ?? [],
      platList,
      platFees,
      costSettings: cs,
      menuCostMap,
      costSchema,
    }
  }

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const main = await fetchData(start, end)
      setData(main)

      const compRange = getComparisonRange(range, customStart, customEnd, selectedWeek)
      if (compRange) {
        const comp = await fetchData(compRange[0], compRange[1])
        setCompData(comp)
      } else {
        setCompData(null)
      }
      setLoading(false)
    }
    load()
  }, [start, end])

  // Aggregate data
  const aggregated = (() => {
    if (!data) return null
    const { orders, items, costs, platList, platFees, costSettings, menuCostMap, costSchema } = data

    // Apply platform filter (null = all platforms)
    const effectivePlats = selectedPlatforms ?? platList
    const filteredOrders = orders.filter(o => effectivePlats.includes(o.platform))
    const filteredItems  = items.filter(i => effectivePlats.includes(i.orders?.platform))
    const filteredCosts  = costs.filter(c => effectivePlats.includes(c.platform))

    // By date for line chart
    const byDate = {}
    for (const o of filteredOrders) {
      if (!byDate[o.date]) byDate[o.date] = { byPlatform: {}, costs: {} }
      const orderItems = filteredItems
        .filter(i => i.orders?.date === o.date && i.orders?.platform === o.platform)
        .map(i => ({ quantity: i.quantity, unit_price: i.unit_price, unit_gp_cost: i.unit_gp_cost }))
      const orderCosts = filteredCosts.find(c => c.date === o.date && c.platform === o.platform) ?? {}
      byDate[o.date].byPlatform[o.platform] = calcPlatformProfit({ items: orderItems, costs: orderCosts })
    }

    const chartData = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, day]) => {
        const total = calcDayTotal(day.byPlatform)
        return {
          date:     date.slice(5),  // "MM-DD" for display
          fullDate: date,           // "YYYY-MM-DD" for navigation
          ยอดขาย: Math.round(total.sales),
          กำไร: Math.round(total.netProfit),
          ...Object.fromEntries(platList.map(p => [p, Math.round(day.byPlatform[p]?.sales ?? 0)])),
        }
      })

    // Platform totals (only selected platforms)
    const platformTotals = {}
    for (const plat of platList) {
      const platItems = filteredItems
        .filter(i => i.orders?.platform === plat)
        .map(i => ({ quantity: i.quantity, unit_price: i.unit_price, unit_gp_cost: i.unit_gp_cost, is_campaign: i.is_campaign }))
      const platCosts = filteredCosts
        .filter(c => c.platform === plat)
        .reduce((acc, c) => ({
          menu_discount: (acc.menu_discount ?? 0) + (c.menu_discount ?? 0),
          campaign: (acc.campaign ?? 0) + (c.campaign ?? 0),
          marketing_fee: (acc.marketing_fee ?? 0) + (c.marketing_fee ?? 0),
          delivery_discount: (acc.delivery_discount ?? 0) + (c.delivery_discount ?? 0),
          advertisement: (acc.advertisement ?? 0) + (c.advertisement ?? 0),
        }), {})
      platformTotals[plat] = calcPlatformProfit({ items: platItems, costs: platCosts })
    }

    const totalSales = Object.values(platformTotals).reduce((s, p) => s + p.sales, 0)
    const totalNetProfit = Object.values(platformTotals).reduce((s, p) => s + p.netProfit, 0)
    const totalGrossProfit = Object.values(platformTotals).reduce((s, p) => s + p.grossProfit, 0)
    const netProfitPct = totalSales > 0 ? totalNetProfit / totalSales * 100 : 0

    // Top 5 menus
    const menuQty = {}
    const menuSales = {}
    const menuProfit = {}
    const menuNames = {}
    for (const i of filteredItems) {
      if (!menuQty[i.menu_id]) { menuQty[i.menu_id] = 0; menuSales[i.menu_id] = 0; menuProfit[i.menu_id] = 0 }
      menuQty[i.menu_id]    += i.quantity
      menuSales[i.menu_id]  += i.quantity * i.unit_price
      menuProfit[i.menu_id] += i.quantity * (i.unit_price - i.unit_gp_cost)
      menuNames[i.menu_id]   = i.menus?.name ?? `#${i.menu_id.slice(0, 6)}`
    }

    // Top Sellers — by quantity
    const topSellers = Object.entries(menuQty)
      .map(([id, qty]) => ({
        id, qty,
        name:   menuNames[id],
        sales:  menuSales[id]  ?? 0,
        profit: menuProfit[id] ?? 0,
      }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5)

    // per-menu material cost (บาทต่อหน่วย) จาก menuCostMap
    const menuMatCostPerUnit = {}
    for (const id of Object.keys(menuSales)) {
      const mc = menuCostMap[id]
      if (!mc) continue
      const bd = calcMenuCostBreakdown(mc, costSettings, 0, 0, costSchema)
      menuMatCostPerUnit[id] = bd?.materialCost ?? 0
    }

    // Best Margin — GP margin หลังหักค่า platform fee + material cost
    const bestMargins = Object.entries(menuSales)
      .filter(([, s]) => s > 0)
      .map(([id, sales]) => {
        const qty        = menuQty[id] ?? 0
        const platProfit = menuProfit[id] ?? 0            // sales - platform_fee
        const matCost    = (menuMatCostPerUnit[id] ?? 0) * qty
        const trueProfit = platProfit - matCost           // หักต้นทุนวัตถุดิบด้วย
        const marginPct  = sales > 0 ? trueProfit / sales * 100 : 0
        return { id, sales, profit: trueProfit, marginPct, qty, name: menuNames[id] }
      })
      .filter(m => m.sales > 0)
      .sort((a, b) => b.marginPct - a.marginPct)
      .slice(0, 5)

    // Best/worst day
    let bestDay = null, worstDay = null
    for (const [date, day] of Object.entries(byDate)) {
      const t = calcDayTotal(day.byPlatform)
      if (!bestDay || t.netProfit > bestDay.profit) bestDay = { date, profit: t.netProfit }
      if (!worstDay || t.netProfit < worstDay.profit) worstDay = { date, profit: t.netProfit }
    }

    // Alerts
    const zeroSalesDays = chartData.filter(d => d.ยอดขาย === 0)
    const lossDays = chartData.filter(d => d.กำไร < 0)

    // Advertisement aggregation
    const advByPlatform = {}
    for (const plat of platList) {
      advByPlatform[plat] = filteredCosts
        .filter(c => c.platform === plat)
        .reduce((s, c) => s + (c.advertisement ?? 0), 0)
    }
    const totalAdvertisement = Object.values(advByPlatform).reduce((s, v) => s + v, 0)

    // Advertisement by date (filtered platforms)
    const advByDate = {}
    for (const c of filteredCosts) {
      if (!advByDate[c.date]) advByDate[c.date] = {}
      advByDate[c.date][c.platform] = (advByDate[c.date][c.platform] ?? 0) + (c.advertisement ?? 0)
    }
    const advChartData = Object.entries(advByDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, byPlat]) => ({
        date: date.slice(5),
        รวม: Math.round(Object.values(byPlat).reduce((s, v) => s + v, 0)),
        ...Object.fromEntries(platList.map(p => [p, Math.round(byPlat[p] ?? 0)])),
      }))

    // Cost totals across all platforms
    const totalGpCostRaw       = Object.values(platformTotals).reduce((s, p) => s + p.gpCostTotal,        0)
    const totalMenuDiscount    = Object.values(platformTotals).reduce((s, p) => s + p.menuDiscount,       0)
    const totalCampaign        = Object.values(platformTotals).reduce((s, p) => s + p.campaign,           0)
    const totalMarketingFee    = Object.values(platformTotals).reduce((s, p) => s + p.marketingFee,       0)
    const totalDeliveryDiscount= Object.values(platformTotals).reduce((s, p) => s + p.deliveryDiscount,   0)

    // GP Cost = (grossNormalSales × platFee%) + (grossCampaignSales × CAMPAIGN_GP_PCT%)
    // ใช้ grossNormalSales/grossCampaignSales (หลังหัก menu_discount ตามสัดส่วน)
    // เพื่อให้ GP คำนวณบนยอดสุทธิ ไม่ใช่ยอดก่อนหักส่วนลด
    const totalGpCost = platList.reduce((s, p) => {
      const pt = platformTotals[p]
      if (!pt) return s
      const feePct = platFees[p] ?? 0
      const normalGp   = (pt.grossNormalSales   ?? pt.normalSales   ?? pt.sales) * feePct         / 100
      const campaignGp = (pt.grossCampaignSales ?? pt.campaignSales ?? 0)        * CAMPAIGN_GP_PCT / 100
      return s + normalGp + campaignGp
    }, 0)

    // Labor Cost = laborPct % × totalSales
    const laborPct       = costSettings.labor_pct ?? 0
    const totalLaborCost = totalSales * laborPct / 100

    // Mat Cost = Σ(qty × materialCost per menu) from menu_costs × cost_settings
    // materialCost is independent of price/platform → call calcMenuCostBreakdown with price=0, feePct=0
    const totalMatCost = filteredItems.reduce((sum, item) => {
      const mc = menuCostMap[item.menu_id]
      if (!mc) return sum
      const bd = calcMenuCostBreakdown(mc, costSettings, 0, 0, costSchema)
      return sum + (item.quantity * (bd?.materialCost ?? 0))
    }, 0)

    // รวม cost ทั้งหมด
    // Mat Cost     = Σ(qty × materialCost) จาก menu_costs (วัตถุดิบ + บรรจุภัณฑ์ + ค่ากลาง)
    // GP Cost      = platFee% × platformSales (จาก settings แต่ละ platform)
    // Labor Cost   = labor_pct% × totalSales (จาก cost_settings)
    // ที่เหลือ     = จากการกรอกยอดขายประจำวัน (platform_costs table)
    const totalAllCosts = totalMatCost + totalGpCost + totalLaborCost
      + totalMenuDiscount + totalCampaign + totalMarketingFee + totalDeliveryDiscount + totalAdvertisement

    // Platform Cost = GP Cost + Campaign + Advertisement + Menu Discount + Marketing Fee + Delivery Discount
    const totalPlatformCost    = totalGpCost + totalCampaign + totalAdvertisement + totalMenuDiscount + totalMarketingFee + totalDeliveryDiscount
    const totalPlatformCostPct = totalSales > 0 ? (totalPlatformCost / totalSales) * 100 : 0

    // กำไร (รวม Mat cost) = ยอดขาย − GP Cost − Discount/Fee ต่างๆ (ยังไม่หัก Mat + Labor)
    const profitBeforeMat    = totalSales - totalGpCost - totalMenuDiscount - totalCampaign - totalMarketingFee - totalDeliveryDiscount - totalAdvertisement
    const profitBeforeMatPct = totalSales > 0 ? (profitBeforeMat / totalSales) * 100 : 0

    // Net Profit = ยอดขาย − ต้นทุนทั้งหมด
    const newNetProfit    = totalSales - totalAllCosts
    const newNetProfitPct = totalSales > 0 ? (newNetProfit / totalSales) * 100 : 0

    // กำไร (รวม Mat cost) แยกรายแพลตฟอร์ม
    const platformProfitBeforeMat = {}
    for (const p of platList) {
      const pt = platformTotals[p]
      const feePct = platFees[p] ?? 0
      const gpCostP = ((pt?.grossNormalSales   ?? pt?.normalSales   ?? pt?.sales ?? 0) * feePct         / 100)
                    + ((pt?.grossCampaignSales ?? pt?.campaignSales ?? 0)              * CAMPAIGN_GP_PCT / 100)
      platformProfitBeforeMat[p] = (pt?.sales ?? 0) - gpCostP
        - (pt?.menuDiscount ?? 0) - (pt?.campaign ?? 0)
        - (pt?.marketingFee ?? 0) - (pt?.deliveryDiscount ?? 0)
        - (advByPlatform[p] ?? 0)
    }

    // Category summary (Beverage / Bread / Refill / Add-on)
    const BEV_CATS = ['Cocoa', 'Coffee', 'Matcha', 'Classic', 'Hot']
    const categorySummary = { bev: 0, bread: 0, refill: 0, addon: 0 }
    for (const item of filteredItems) {
      const cat = item.menus?.category
      const qty = item.quantity ?? 0
      if (BEV_CATS.includes(cat))  categorySummary.bev   += qty
      else if (cat === 'Bun')      categorySummary.bread  += qty
      // Refill จาก item_options.refill (array หรือ single)
      const refill = item.item_options?.refill
      if (Array.isArray(refill)) {
        categorySummary.refill += refill.reduce((s, r) => s + (r.qty ?? 1), 0)
      } else if (refill) {
        categorySummary.refill += refill.qty ?? 1
      }
      // Add-on: milk ที่มีราคา (paid addon)
      const milk = item.item_options?.milk
      if (milk && (milk.price ?? 0) > 0) categorySummary.addon += qty
    }

    return {
      chartData, platList, platformTotals, platformProfitBeforeMat,
      totalSales, totalNetProfit, totalGrossProfit, netProfitPct,
      totalPlatformCost, totalPlatformCostPct,
      profitBeforeMat, profitBeforeMatPct,
      newNetProfit, newNetProfitPct,
      menuQty, menuSales, menuProfit, menuNames, topSellers, bestMargins,
      bestDay, worstDay, zeroSalesDays, lossDays,
      daysWithData: Object.keys(byDate).length,
      advByPlatform, totalAdvertisement, advChartData,
      totalGpCostRaw, totalGpCost, totalLaborCost, totalMatCost,
      totalMenuDiscount, totalCampaign, totalMarketingFee, totalDeliveryDiscount, totalAllCosts,
      platFees, categorySummary,
    }
  })()

  // Comparison aggregation (simplified — just total sales/profit)
  const compAgg = (() => {
    if (!compData) return null
    const { items, costs } = compData
    const allItems = items.map(i => ({ quantity: i.quantity, unit_price: i.unit_price, unit_gp_cost: i.unit_gp_cost }))
    const totalCosts = costs.reduce((acc, c) => ({
      menu_discount: (acc.menu_discount ?? 0) + (c.menu_discount ?? 0),
      campaign: (acc.campaign ?? 0) + (c.campaign ?? 0),
      marketing_fee: (acc.marketing_fee ?? 0) + (c.marketing_fee ?? 0),
      delivery_discount: (acc.delivery_discount ?? 0) + (c.delivery_discount ?? 0),
      advertisement: (acc.advertisement ?? 0) + (c.advertisement ?? 0),
    }), {})
    const r = calcPlatformProfit({ items: allItems, costs: totalCosts })
    return r
  })()

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>

        {/* Range selector */}
        <div className="flex gap-2 flex-wrap">
          {ranges.map(r => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                range === r.value ? 'bg-cocoa-700 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {range === 'singleday' && (
        <div className="card">
          <label className="label">เลือกวันที่</label>
          <input
            type="date"
            className="input"
            value={singleDay}
            max={format(new Date(), 'yyyy-MM-dd')}
            onChange={e => setSingleDay(e.target.value)}
          />
        </div>
      )}

      {range === 'week' && (
        <div className="card">
          <label className="label">เลือกสัปดาห์ (จันทร์ – อาทิตย์)</label>
          <input
            type="week"
            className="input"
            value={selectedWeek}
            max={`${getISOWeekYear(new Date())}-W${String(getISOWeek(new Date())).padStart(2, '0')}`}
            onChange={e => setSelectedWeek(e.target.value)}
          />
          {(() => {
            const [mon, sun] = weekStrToRange(selectedWeek)
            return (
              <p className="text-xs text-gray-400 mt-1.5">
                {mon} (จ.) — {sun} (อา.)
              </p>
            )
          })()}
        </div>
      )}

      {range === 'custom' && (
        <div className="card flex gap-4">
          <div className="flex-1">
            <label className="label">วันเริ่มต้น</label>
            <input type="date" className="input" value={customStart} onChange={e => setCustomStart(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="label">วันสิ้นสุด</label>
            <input type="date" className="input" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
          </div>
        </div>
      )}

      {/* Platform filter */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500 shrink-0">แสดงข้อมูล:</span>
        <button
          onClick={() => setSelectedPlatforms(null)}
          className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
            isAllSelected
              ? 'bg-gray-800 text-white border-gray-800'
              : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
          }`}
        >
          ทั้งหมด
        </button>
        {(aggregated?.platList ?? DEFAULT_PLATFORMS).map((p, idx) => {
          const active = !isAllSelected && selectedPlatforms?.includes(p)
          return (
            <button key={p} onClick={() => togglePlatform(p)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                active
                  ? 'text-white border-transparent'
                  : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400'
              }`}
              style={active ? { backgroundColor: getPlatColor(p, idx), borderColor: getPlatColor(p, idx) } : {}}
            >
              {p}
            </button>
          )
        })}
        {!isAllSelected && (
          <span className="text-xs text-gray-400 ml-1">
            ({selectedPlatforms?.length ?? 0}/{aggregated?.platList?.length ?? DEFAULT_PLATFORMS.length} platform)
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">กำลังโหลดข้อมูล...</div>
      ) : !aggregated ? null : (
        <>
          {/* KPI Cards — draggable */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {kpiOrder.map(kpiId => {
              const dp = {
                id: kpiId, dragOverId: kpiDragOver,
                onDragStart: handleKpiDragStart, onDragOver: handleKpiDragOver,
                onDrop: handleKpiDrop, onDragEnd: handleKpiDragEnd,
              }
              if (kpiId === 'total-sales') return (
                <KpiCard key={kpiId} title="ยอดขายรวม" value={formatBaht(aggregated.totalSales)}
                  change={compAgg ? changePct(aggregated.totalSales, compAgg.sales) : null}
                  positive={aggregated.totalSales >= (compAgg?.sales ?? 0)} dragProps={dp} />
              )
              if (kpiId === 'mat-cost') return (
                <KpiCard key={kpiId} title="Mat Cost" value={formatBaht(aggregated.totalMatCost)}
                  sub={aggregated.totalSales > 0 ? `${(aggregated.totalMatCost / aggregated.totalSales * 100).toFixed(1)}% ของยอดขาย` : null}
                  dragProps={dp} />
              )
              if (kpiId === 'platform-cost') return (
                <KpiCard key={kpiId} title="Platform Cost" value={formatBaht(aggregated.totalPlatformCost)}
                  sub={aggregated.totalSales > 0 ? `${aggregated.totalPlatformCostPct.toFixed(1)}% ของยอดขาย` : null}
                  dragProps={dp} />
              )
              if (kpiId === 'profit-before-mat') return (
                <KpiCard key={kpiId} title="กำไร (รวม Mat cost)" value={formatBaht(aggregated.profitBeforeMat)}
                  sub={aggregated.totalSales > 0 ? `${aggregated.profitBeforeMatPct.toFixed(1)}% ของยอดขาย` : null}
                  positive={aggregated.profitBeforeMat >= 0} dragProps={dp} />
              )
              if (kpiId === 'net-profit') return (
                <KpiCard key={kpiId} title="กำไรสุทธิ" value={formatBaht(aggregated.newNetProfit)}
                  sub={aggregated.totalSales > 0 ? `${aggregated.newNetProfitPct.toFixed(1)}% ของยอดขาย` : null}
                  positive={aggregated.newNetProfit >= 0} dragProps={dp} />
              )
              if (kpiId === 'days') return (
                <KpiCard key={kpiId} title="วันที่มีข้อมูล" value={`${aggregated.daysWithData} วัน`} dragProps={dp} />
              )
              return null
            })}
          </div>

          {/* Data truncation warning (fixed, not draggable) */}
          {itemsTruncated && (
            <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 text-blue-700 text-sm px-4 py-3 rounded-xl">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>ข้อมูลมีจำนวนมาก — แสดงผลเฉพาะ {(8000).toLocaleString()} รายการแรก ตัวเลขอาจไม่ครบถ้วน</span>
            </div>
          )}

          {/* Draggable sections */}
          <div className="space-y-4">
            {sectionOrder.map(sectionId => {
              const dragProps = {
                id: sectionId, dragOverId,
                onDragStart: handleDragStart, onDragOver: handleDragOver,
                onDrop: handleDrop, onDragEnd: handleDragEnd,
              }

              if (sectionId === 'category-summary') {
                const catBoxDef = {
                  bev:    { label: 'Beverage', icon: '🧋', color: 'bg-cocoa-50 border-cocoa-200 text-cocoa-800',   value: aggregated.categorySummary.bev },
                  bread:  { label: 'Bread',    icon: '🍞', color: 'bg-amber-50 border-amber-200 text-amber-800',   value: aggregated.categorySummary.bread },
                  refill: { label: 'Refill',   icon: '🔁', color: 'bg-blue-50 border-blue-200 text-blue-800',     value: aggregated.categorySummary.refill },
                  addon:  { label: 'Add-on',   icon: '➕', color: 'bg-purple-50 border-purple-200 text-purple-800', value: aggregated.categorySummary.addon },
                }
                return (
                  <DraggableSection key={sectionId} {...dragProps}>
                    <div className="card">
                      <h2 className="font-semibold text-gray-800 mb-3">📦 สรุปยอดตามประเภท</h2>
                      <div className="grid grid-cols-4 gap-2">
                        {catBoxOrder.map(boxId => {
                          const box = catBoxDef[boxId]
                          if (!box) return null
                          const isDragTarget = catBoxDragOver === boxId
                          return (
                            <div
                              key={boxId}
                              draggable
                              onDragStart={() => handleCatBoxDragStart(boxId)}
                              onDragOver={(e) => { e.preventDefault(); handleCatBoxDragOver(boxId) }}
                              onDrop={(e) => { e.stopPropagation(); handleCatBoxDrop(boxId) }}
                              onDragEnd={handleCatBoxDragEnd}
                              className={`rounded-xl border px-3 py-3 text-center cursor-grab active:cursor-grabbing select-none transition-all
                                ${box.color} ${isDragTarget ? 'opacity-40 ring-2 ring-cocoa-400' : ''}`}
                            >
                              <p className="text-lg">{box.icon}</p>
                              <p className="text-2xl font-bold leading-tight">{box.value}</p>
                              <p className="text-xs mt-0.5 opacity-70">{box.label}</p>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </DraggableSection>
                )
              }

              if (sectionId === 'cost-breakdown') return (
                <DraggableSection key={sectionId} {...dragProps}>
                  <div className="space-y-3">
                    {/* Toolbar */}
                    <div className="flex items-center justify-between">
                      <h2 className="font-semibold text-gray-800">📊 ต้นทุน</h2>
                      <div className="flex items-center gap-2">
                        {costEditMode && (
                          <button onClick={costAddCat}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-cocoa-50 text-cocoa-700 hover:bg-cocoa-100 border border-cocoa-200 transition-colors">
                            + หมวดหมู่
                          </button>
                        )}
                        <button onClick={() => setCostEditMode(v => !v)}
                          className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg transition-colors ${
                            costEditMode
                              ? 'bg-cocoa-600 text-white hover:bg-cocoa-700'
                              : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                          }`}>
                          <Pencil size={11} />
                          {costEditMode ? 'เสร็จสิ้น' : 'แก้ไข'}
                        </button>
                      </div>
                    </div>

                    {/* Categories */}
                    {costConfig.categories.map(cat => {
                      const catItems = costConfig.items.filter(i => i.catId === cat.id)
                      const catTotal = catItems.reduce((s, it) => s + (aggregated[it.valueKey] ?? 0), 0)
                      const isDropTarget = costDragOver?.catId === cat.id && !costDragOver?.itemId

                      return (
                        <div key={cat.id}
                          className={`card transition-colors ${isDropTarget ? 'ring-2 ring-cocoa-400 bg-cocoa-50' : ''}`}
                          onDragOver={(e) => { e.preventDefault(); setCostDragOver({ catId: cat.id, itemId: null }) }}
                          onDrop={(e) => { e.stopPropagation(); handleCostDrop(cat.id, null) }}
                        >
                          {/* Category header */}
                          <div className="flex items-center justify-between mb-3">
                            {costEditMode ? (
                              <div className="flex items-center gap-2 flex-1 mr-3">
                                <input
                                  value={cat.label}
                                  onChange={e => costRenameCat(cat.id, e.target.value)}
                                  className="text-sm font-semibold text-gray-800 border-b border-gray-300 bg-transparent focus:outline-none focus:border-cocoa-500 flex-1"
                                />
                                {costConfig.categories.length > 1 && (
                                  <button onClick={() => costDeleteCat(cat.id)}
                                    className="text-xs text-red-400 hover:text-red-600 shrink-0 px-1">
                                    ลบ
                                  </button>
                                )}
                              </div>
                            ) : (
                              <h3 className="font-semibold text-gray-800">{cat.label}</h3>
                            )}
                            <span className="text-sm font-bold text-gray-700 shrink-0">
                              {formatBaht(catTotal)}
                              {aggregated.totalSales > 0 && (
                                <span className="ml-1.5 text-xs font-normal text-gray-400">
                                  ({(catTotal / aggregated.totalSales * 100).toFixed(1)}%)
                                </span>
                              )}
                            </span>
                          </div>

                          {/* Items */}
                          <div className="space-y-2">
                            {catItems.map(item => {
                              const value = aggregated[item.valueKey] ?? 0
                              const pct  = aggregated.totalSales > 0 ? (value / aggregated.totalSales * 100) : 0
                              const barW = aggregated.totalAllCosts > 0 ? Math.min(100, value / aggregated.totalAllCosts * 100) : 0
                              const isItemDrop = costDragOver?.catId === cat.id && costDragOver?.itemId === item.id

                              return (
                                <div key={item.id}
                                  draggable
                                  onDragStart={(e) => { e.stopPropagation(); costDragItemRef.current = item.id; setCostDragOver(null) }}
                                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setCostDragOver({ catId: cat.id, itemId: item.id }) }}
                                  onDrop={(e) => { e.stopPropagation(); handleCostDrop(cat.id, item.id) }}
                                  onDragEnd={() => { setCostDragOver(null); costDragItemRef.current = null }}
                                  className={`flex items-center gap-3 rounded-lg transition-colors ${
                                    costEditMode ? 'cursor-grab active:cursor-grabbing hover:bg-gray-50 px-1 -mx-1' : ''
                                  } ${isItemDrop ? 'border-t-2 border-cocoa-400 pt-1' : ''}`}
                                >
                                  {costEditMode && <GripVertical size={13} className="text-gray-300 shrink-0" />}
                                  <span className="text-sm w-4 shrink-0">{item.icon}</span>
                                  <div className="w-36 shrink-0">
                                    {costEditMode ? (
                                      <input
                                        value={item.label}
                                        onChange={e => costRenameItem(item.id, e.target.value)}
                                        className="text-sm font-medium text-gray-700 w-full border-b border-gray-300 bg-transparent focus:outline-none focus:border-cocoa-500"
                                      />
                                    ) : (
                                      <p className="text-sm text-gray-700 font-medium leading-tight">{item.label}</p>
                                    )}
                                    <p className="text-xs text-gray-400 leading-tight">{item.sub}</p>
                                  </div>
                                  <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                                    <div className="h-2 rounded-full bg-cocoa-400 transition-all" style={{ width: `${barW}%` }} />
                                  </div>
                                  <span className={`text-sm font-semibold w-20 text-right shrink-0 ${item.color}`}>{formatBaht(value)}</span>
                                  <span className="text-xs text-gray-400 w-12 text-right shrink-0">{pct > 0 ? `${pct.toFixed(1)}%` : '—'}</span>
                                </div>
                              )
                            })}

                            {catItems.length === 0 && (
                              <div className="h-10 border-2 border-dashed border-gray-200 rounded-lg flex items-center justify-center text-xs text-gray-400">
                                ลากรายการมาวางที่นี่
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </DraggableSection>
              )

              if (sectionId === 'sales-target') return (
                <DraggableSection key={sectionId} {...dragProps}>
                  <div className="card">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                        <Target size={16} className="text-cocoa-600" /> เป้ายอดขาย
                      </h2>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{TARGET_LABEL[range]}</span>
                        {!targetEditing ? (
                          <button onClick={() => setTargetEditing(true)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 text-xs font-medium hover:bg-amber-200 transition-colors">
                            <Pencil size={11} /> แก้ไข
                          </button>
                        ) : (
                          <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 flex items-center gap-1">
                            <Pencil size={11} /> กำลังแก้ไข
                          </span>
                        )}
                      </div>
                    </div>
                    {targetEditing ? (
                      <div className="space-y-3">
                        <div>
                          <label className="label text-xs">เป้ายอดขาย (฿)</label>
                          <input type="number" className="input text-right" min="0" placeholder="0" value={targetInput}
                            onChange={e => setTargetInput(e.target.value)} autoFocus
                            onKeyDown={e => { if (e.key === 'Enter') saveTarget(); if (e.key === 'Escape') cancelTarget() }} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={cancelTarget} className="btn-secondary flex-1 text-sm py-2">ยกเลิก</button>
                          <button onClick={saveTarget} disabled={savingTarget} className="btn-primary flex-1 text-sm py-2">
                            {savingTarget ? 'กำลังบันทึก...' : 'บันทึก'}
                          </button>
                        </div>
                      </div>
                    ) : salesTarget > 0 ? (() => {
                      const current = aggregated?.totalSales ?? 0
                      const pct = Math.min(100, current / salesTarget * 100)
                      const over = current > salesTarget
                      const barColor = over ? 'bg-green-500' : pct >= 80 ? 'bg-amber-500' : pct >= 50 ? 'bg-cocoa-500' : 'bg-cocoa-300'
                      return (
                        <div className="space-y-2">
                          <div className="flex justify-between items-baseline">
                            <span className={`text-2xl font-bold ${over ? 'text-green-600' : 'text-gray-900'}`}>{formatBaht(current)}</span>
                            <span className="text-sm text-gray-400">เป้า {formatBaht(salesTarget)}</span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                            <div className={`h-3 rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className={`font-bold ${over ? 'text-green-600' : 'text-cocoa-700'}`}>{pct.toFixed(1)}%</span>
                            {over
                              ? <span className="text-green-600 font-medium">🎉 เกินเป้า +{formatBaht(current - salesTarget)}</span>
                              : <span className="text-gray-400">เหลืออีก {formatBaht(salesTarget - current)}</span>}
                          </div>
                        </div>
                      )
                    })() : (
                      <p className="text-sm text-gray-400 text-center py-2">
                        ยังไม่ได้ตั้งเป้ายอดขาย — กด <span className="text-amber-600 font-medium">แก้ไข</span> เพื่อตั้งค่า
                      </p>
                    )}
                  </div>
                </DraggableSection>
              )

              if (sectionId === 'alerts') {
                const hasAlerts = aggregated.zeroSalesDays.length > 0 || aggregated.lossDays.length > 0
                if (!hasAlerts) return null
                return (
                  <DraggableSection key={sectionId} {...dragProps}>
                    <div className="space-y-2">
                      {aggregated.zeroSalesDays.length > 0 && (
                        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 rounded-xl">
                          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span>⚠ ไม่มียอดขาย {aggregated.zeroSalesDays.length} วัน — อาจลืมกรอก?</span>
                            {aggregated.zeroSalesDays.map(d => (
                              <a key={d.fullDate} href={`/sales?date=${d.fullDate}`}
                                className="px-2 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded text-xs font-medium hover:underline underline-offset-2">
                                {d.date}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      {aggregated.lossDays.length > 0 && (
                        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
                          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span>🔴 กำไรติดลบ {aggregated.lossDays.length} วัน</span>
                            {aggregated.lossDays.map(d => (
                              <a key={d.fullDate} href={`/sales?date=${d.fullDate}`}
                                className="px-2 py-0.5 bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs font-medium hover:underline underline-offset-2">
                                {d.date}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </DraggableSection>
                )
              }

              if (sectionId === 'chart') {
                if (aggregated.chartData.length === 0) return null
                return (
                  <DraggableSection key={sectionId} {...dragProps}>
                    <div className="card">
                      <h2 className="font-semibold text-gray-800 mb-3">ยอดขายรายวัน</h2>
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={aggregated.chartData} margin={{ left: -10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip formatter={(v) => formatBaht(v)} />
                          <Legend />
                          <Line type="monotone" dataKey="ยอดขาย" stroke="#a13911" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="กำไร" stroke="#22c55e" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </DraggableSection>
                )
              }

              if (sectionId === 'platform') return (
                <DraggableSection key={sectionId} {...dragProps}>
                  <div className="card">
                    <h2 className="font-semibold text-gray-800 mb-3">ยอดขายแยก Platform</h2>
                    <div className="grid grid-cols-3 md:grid-cols-5 gap-2 mb-4">
                      {aggregated.platList.map((p, idx) => {
                        const pt = aggregated.platformTotals[p]
                        const pbm = aggregated.platformProfitBeforeMat[p] ?? 0
                        return (
                          <div key={p} className="text-center p-2.5 rounded-xl bg-gray-50 border border-gray-100">
                            <p className="text-xs font-semibold mb-1" style={{ color: getPlatColor(p, idx) }}>{p}</p>
                            <p className="font-bold text-gray-900 text-sm">{formatBaht(pt?.sales ?? 0)}</p>
                            <p className={`text-xs mt-0.5 ${pbm >= 0 ? 'text-green-600' : 'text-red-500'}`}>กำไร {formatBaht(pbm)}</p>
                          </div>
                        )
                      })}
                    </div>
                    {aggregated.chartData.length > 0 && (
                      <ResponsiveContainer width="100%" height={160}>
                        <BarChart data={aggregated.chartData} margin={{ left: -10 }}>
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip formatter={(v) => formatBaht(v)} />
                          {aggregated.platList.map((p, idx) => <Bar key={p} dataKey={p} stackId="a" fill={getPlatColor(p, idx)} />)}
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </DraggableSection>
              )

              if (sectionId === 'advertisement') return (
                <DraggableSection key={sectionId} {...dragProps}>
                  <div className="card">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="font-semibold text-gray-800">📢 Advertisement</h2>
                      <span className="text-sm font-bold text-gray-700">
                        รวม {formatBaht(aggregated.totalAdvertisement)}
                        {aggregated.totalSales > 0 && (
                          <span className="ml-1.5 text-xs font-normal text-gray-400">
                            ({(aggregated.totalAdvertisement / aggregated.totalSales * 100).toFixed(1)}% ของยอดขาย)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 md:grid-cols-5 gap-2 mb-4">
                      {aggregated.platList.map((p, idx) => {
                        const adv = aggregated.advByPlatform[p]
                        const sales = aggregated.platformTotals[p]?.sales ?? 0
                        const pct = sales > 0 ? (adv / sales * 100) : null
                        return (
                          <div key={p} className="text-center p-2.5 rounded-xl bg-gray-50 border border-gray-100">
                            <p className="text-xs font-semibold mb-1" style={{ color: getPlatColor(p, idx) }}>{p}</p>
                            <p className="font-bold text-gray-900 text-sm">{formatBaht(adv)}</p>
                            {pct !== null ? <p className="text-xs text-gray-500 mt-0.5">{pct.toFixed(1)}%</p> : <p className="text-xs text-gray-300 mt-0.5">—</p>}
                          </div>
                        )
                      })}
                    </div>
                    {aggregated.advChartData.length > 1 && (
                      <ResponsiveContainer width="100%" height={150}>
                        <BarChart data={aggregated.advChartData} margin={{ left: -10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip formatter={(v) => formatBaht(v)} />
                          {aggregated.platList.map((p, idx) => <Bar key={p} dataKey={p} stackId="a" fill={getPlatColor(p, idx)} />)}
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                    {aggregated.advChartData.length === 1 && (
                      <div className="text-center py-3 text-sm text-gray-500">
                        {aggregated.advChartData[0].date} — รวม {formatBaht(aggregated.advChartData[0].รวม)}
                      </div>
                    )}
                    {aggregated.totalAdvertisement === 0 && (
                      <p className="text-center text-sm text-gray-400 py-2">ไม่มีค่าโฆษณาในช่วงนี้</p>
                    )}
                  </div>
                </DraggableSection>
              )

              if (sectionId === 'top-menus') {
                if (aggregated.topSellers.length === 0 && aggregated.bestMargins.length === 0) return null
                const rankStyle = (i) => i === 0 ? 'bg-yellow-100 text-yellow-700' : i === 1 ? 'bg-gray-200 text-gray-600' : i === 2 ? 'bg-orange-100 text-orange-600' : 'bg-gray-50 text-gray-400'
                return (
                  <DraggableSection key={sectionId} {...dragProps}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="card">
                        <h2 className="font-semibold text-gray-800 mb-3">🏆 Top Sellers</h2>
                        <div className="space-y-2.5">
                          {aggregated.topSellers.map((m, i) => (
                            <div key={m.id} className="flex items-center gap-2.5">
                              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${rankStyle(i)}`}>{i + 1}</span>
                              <span className="flex-1 text-sm text-gray-800 truncate">{m.name}</span>
                              <span className="text-sm font-bold text-cocoa-700 shrink-0">{m.qty} ชิ้น</span>
                              <span className="text-xs text-gray-400 shrink-0 w-16 text-right">{formatBaht(m.sales)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="card">
                        <h2 className="font-semibold text-gray-800 mb-3">💰 Best Margin <span className="text-[11px] text-gray-400 font-normal">(หลังหักวัตถุดิบ+ค่า platform)</span></h2>
                        <div className="space-y-2.5">
                          {aggregated.bestMargins.map((m, i) => (
                            <div key={m.id} className="flex items-center gap-2.5">
                              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${rankStyle(i)}`}>{i + 1}</span>
                              <span className="flex-1 text-sm text-gray-800 truncate">{m.name}</span>
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${m.marginPct >= 20 ? 'bg-green-50 text-green-700' : m.marginPct >= 10 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
                                {m.marginPct.toFixed(1)}%
                              </span>
                              <span className="text-xs text-gray-400 shrink-0 w-16 text-right">{formatBaht(m.profit)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </DraggableSection>
                )
              }

              if (sectionId === 'best-worst') {
                return (
                  <DraggableSection key={sectionId} {...dragProps}>
                    <div className="grid grid-cols-2 gap-3">
                      {aggregated.bestDay && (
                        <div className="card bg-green-50 border-green-200">
                          <p className="text-xs text-green-600 font-medium flex items-center gap-1"><Star size={12} /> วันที่ดีสุด</p>
                          <p className="font-bold text-gray-900">{aggregated.bestDay.date}</p>
                          <p className="text-green-700 text-sm">{formatBaht(aggregated.bestDay.profit)}</p>
                        </div>
                      )}
                      {aggregated.worstDay && (
                        <div className="card bg-red-50 border-red-200">
                          <p className="text-xs text-red-500 font-medium flex items-center gap-1"><Star size={12} /> วันที่แย่สุด</p>
                                                 <p className="font-bold text-gray-900">{aggregated.worstDay.date}</p>
                          <p className="text-red-600 text-sm">{formatBaht(aggregated.worstDay.profit)}</p>
                        </div>
                      )}
                    </div>
                  </DraggableSection>
                )
              }

              return null
            })}
          </div>
        </>
      )}
    </div>
  )
}
