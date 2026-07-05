import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getCostSchema } from '../lib/supabase'
import { calcPlatformProfit, calcMenuCostBreakdown, formatBaht, CAMPAIGN_GP_PCT } from '../utils/calculations'
import { format, startOfMonth, endOfMonth, parseISO, addMonths, subMonths } from 'date-fns'
import { th } from 'date-fns/locale'
import {
  ChevronLeft, ChevronRight, TrendingUp, TrendingDown,
  ClipboardList, PenLine, Printer, ChevronDown, ChevronUp,
  Banknote, CheckCircle2, Clock, Save, X,
} from 'lucide-react'

const PLAT_BADGE = {
  GRAB:        'bg-green-100 text-green-800',
  LINE:        'bg-teal-100 text-teal-800',
  SHOPEE:      'bg-orange-100 text-orange-800',
  'The metro': 'bg-blue-100 text-blue-800',
  TU:          'bg-purple-100 text-purple-800',
}

const THAI_DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']

function thaiDate(dateStr) {
  try {
    const d = parseISO(dateStr)
    const day = THAI_DAYS[d.getDay()]
    return {
      dayOfWeek: day,
      full: format(d, 'd MMM yyyy', { locale: th }),
      short: format(d, 'd MMM', { locale: th }),
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
    }
  } catch {
    return { dayOfWeek: '', full: dateStr, short: dateStr, isWeekend: false }
  }
}

function thaiMonth(monthStr) {
  try {
    return format(new Date(monthStr + '-01'), 'MMMM yyyy', { locale: th })
  } catch {
    return monthStr
  }
}

const tsKey = (date, platform) => `${date}|${platform}`

export default function SalesHistoryPage() {
  const navigate = useNavigate()
  const [month, setMonth]             = useState(format(new Date(), 'yyyy-MM'))
  const [loading, setLoading]         = useState(true)
  const [dayData, setDayData]         = useState([])
  const [transferMap, setTransferMap]     = useState({})
  const [expanded, setExpanded]           = useState(new Set())
  const [saving, setSaving]               = useState(null)
  const [pendingChanges, setPendingChanges] = useState({})
  const [laborPct, setLaborPct]             = useState(0)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const start = format(startOfMonth(new Date(month + '-01')), 'yyyy-MM-dd')
      const end   = format(endOfMonth(new Date(month + '-01')), 'yyyy-MM-dd')
      const today = new Date().toISOString().slice(0, 10)

      // Fetch same data sources as Dashboard for identical calculation
      const [ordersRes, costsRes, transferRes, settingsRes, costSettingsRes, menuCostsRes, costSchema] = await Promise.all([
        supabase.from('orders').select('id, date, platform, notes, created_at').gte('date', start).lte('date', end),
        supabase.from('platform_costs').select('*').gte('date', start).lte('date', end),
        supabase.from('transfer_status').select('*').gte('sale_date', start).lte('sale_date', end),
        supabase.from('settings').select('key, value'),
        // Identical query to Dashboard: filter by effective_to to exclude expired settings
        supabase.from('cost_settings')
          .select('key, value, effective_from')
          .lte('effective_from', today)
          .or(`effective_to.is.null,effective_to.gt.${today}`)
          .order('effective_from', { ascending: false }),
        supabase.from('menu_costs').select('*').is('effective_to', null),
        getCostSchema(),
      ])

      const orders    = ordersRes.data ?? []
      const costs     = costsRes.data ?? []
      const transfers = transferRes.data ?? []

      // Platform fees — identical fallback logic to Dashboard
      const platConfigRow = (settingsRes.data ?? []).find(r => r.key === 'platform_config')
      let platFees = {}
      if (platConfigRow) {
        try {
          const platConfig = JSON.parse(platConfigRow.value)
          platFees = Object.fromEntries(platConfig.map(p => [p.name, p.fee ?? 0]))
        } catch {}
      } else {
        // Fallback: read legacy individual fee keys (same as Dashboard fallback)
        platFees = { GRAB: 0, LINE: 0, SHOPEE: 0, 'The metro': 0, TU: 0 }
        for (const row of settingsRes.data ?? []) {
          if (row.key === 'grab_fee_pct')      platFees.GRAB          = parseFloat(row.value) || 0
          if (row.key === 'line_fee_pct')      platFees.LINE          = parseFloat(row.value) || 0
          if (row.key === 'shopee_fee_pct')    platFees.SHOPEE        = parseFloat(row.value) || 0
          if (row.key === 'the_metro_fee_pct') platFees['The metro']  = parseFloat(row.value) || 0
          if (row.key === 'tu_fee_pct')        platFees.TU            = parseFloat(row.value) || 0
        }
      }

      // Cost settings map (latest per key) — same as Dashboard
      const cs = {}
      for (const row of costSettingsRes.data ?? []) {
        if (!(row.key in cs)) cs[row.key] = Number(row.value)
      }
      const laborPct = cs.labor_pct ?? 0
      setLaborPct(laborPct)

      // Menu cost map
      const menuCostMap = {}
      for (const mc of menuCostsRes.data ?? []) menuCostMap[mc.menu_id] = mc

      // Transfer map
      const tmap = {}
      for (const t of transfers) {
        tmap[tsKey(t.sale_date, t.platform)] = {
          mat: t.mat_transferred, profit: t.profit_transferred, labor: t.labor_transferred,
          matAt: t.mat_transferred_at, profitAt: t.profit_transferred_at, laborAt: t.labor_transferred_at,
          matAmount: t.mat_amount ?? 0, profitAmount: t.profit_amount ?? 0, laborAmount: t.labor_amount ?? 0,
        }
      }
      setTransferMap(tmap)

      if (orders.length === 0) { setDayData([]); setLoading(false); return }

      // Smart filter: same logic as Dashboard posDatePlatSet
      // Use POS orders (notes != null/empty); use SalesEntry only when no POS for that date|platform
      const posDatePlatSet = new Set()
      for (const order of orders) {
        if (order.notes != null && order.notes !== '') {
          posDatePlatSet.add(tsKey(order.date, order.platform))
        }
      }
      const filteredOrders = orders.filter(order => {
        const isPOS = order.notes != null && order.notes !== ''
        if (isPOS) return true
        return !posDatePlatSet.has(tsKey(order.date, order.platform))
      })

      // Fetch order_items with menu_id for matCost recalculation
      const { data: items } = await supabase
        .from('order_items')
        .select('order_id, menu_id, quantity, unit_price, unit_gp_cost, is_campaign')
        .in('order_id', filteredOrders.map(o => o.id))

      // Group items by order_id
      const itemsByOrder = {}
      for (const item of items ?? []) {
        if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = []
        itemsByOrder[item.order_id].push(item)
      }

      // Per-order amount & item count (for order list display)
      const orderAmounts = {}
      for (const [orderId, orderItems] of Object.entries(itemsByOrder)) {
        orderAmounts[orderId] = {
          amount: orderItems.reduce((s, i) => s + i.unit_price * i.quantity, 0),
          itemCount: orderItems.reduce((s, i) => s + i.quantity, 0),
        }
      }

      // Merge all items per date|platform (handles multiple orders same platform same day)
      const itemsByDatePlat = {}
      for (const order of filteredOrders) {
        const key = tsKey(order.date, order.platform)
        if (!itemsByDatePlat[key]) itemsByDatePlat[key] = []
        itemsByDatePlat[key].push(...(itemsByOrder[order.id] ?? []))
      }

      // Orders grouped by date for quick lookup
      const ordersByDate = {}
      for (const order of filteredOrders) {
        if (!ordersByDate[order.date]) ordersByDate[order.date] = []
        ordersByDate[order.date].push(order)
      }

      // Build byDate structure
      const byDate = {}
      for (const order of filteredOrders) {
        if (!byDate[order.date]) byDate[order.date] = { platforms: new Set(), costs: [] }
        byDate[order.date].platforms.add(order.platform)
      }
      for (const cost of costs) {
        if (!byDate[cost.date]) byDate[cost.date] = { platforms: new Set(), costs: [] }
        byDate[cost.date].costs.push(cost)
      }

      // Aggregate per day using Dashboard-identical newNetProfit formula
      const result = Object.entries(byDate).map(([date, { platforms, costs: dayCosts }]) => {
        let totalSales = 0, totalNetProfit = 0, totalItems = 0
        const activePlatforms = []
        const platformSales  = {}
        const platformDetail = {}

        for (const platform of platforms) {
          const key       = tsKey(date, platform)
          const platItems = itemsByDatePlat[key] ?? []
          const cost      = dayCosts.find(c => c.platform === platform) ?? {}
          const r         = calcPlatformProfit({ items: platItems, costs: cost })

          // Mat Cost — recalculated from current menu_costs + cost_settings (same as Dashboard)
          const platMatCost = platItems.reduce((sum, item) => {
            const mc = menuCostMap[item.menu_id]
            if (!mc) return sum
            const bd = calcMenuCostBreakdown(mc, cs, 0, 0, costSchema)
            return sum + (item.quantity * (bd?.materialCost ?? 0))
          }, 0)

          // GP Cost — ใช้ grossNormalSales/grossCampaignSales (ปรับตาม menu_discount ratio แล้ว)
          // เหมือน Dashboard ทุกประการ
          const platGpCost = (r.grossNormalSales   ?? r.normalSales   ?? r.sales) * (platFees[platform] ?? 0) / 100
                           + (r.grossCampaignSales ?? r.campaignSales ?? 0)       * CAMPAIGN_GP_PCT           / 100
          // Labor Cost = laborPct% x sales (same as Dashboard totalLaborCost)
          const platLaborCost = laborPct / 100 * r.sales

          // Net Profit — identical formula to Dashboard's newNetProfit
          const netProfit = r.sales
            - r.menuDiscount
            - platMatCost
            - platGpCost
            - platLaborCost
            - r.campaign
            - r.marketingFee
            - r.deliveryDiscount
            - r.advertisement

          totalSales     += r.sales
          totalNetProfit += netProfit
          totalItems     += r.itemCount
          // Use r.sales (not grossSales) to be consistent with Dashboard's pSales
          platformSales[platform]  = r.sales
          platformDetail[platform] = { sales: r.sales, matCost: platMatCost, laborCost: platLaborCost, netProfit }
          if (r.itemCount > 0 || r.sales > 0) activePlatforms.push(platform)
        }

        // Build POS order list per platform (only orders with notes = POS ref numbers)
        const platformOrders = {}
        for (const order of (ordersByDate[date] ?? [])) {
          if (!order.notes) continue
          if (!platformOrders[order.platform]) platformOrders[order.platform] = []
          const oa = orderAmounts[order.id] ?? { amount: 0, itemCount: 0 }
          const time = order.created_at ? order.created_at.slice(11, 16) : ''
          platformOrders[order.platform].push({ notes: order.notes, amount: oa.amount, itemCount: oa.itemCount, time })
        }
        for (const p of Object.keys(platformOrders)) {
          platformOrders[p].sort((a, b) => a.time.localeCompare(b.time))
        }

        return { date, totalSales, totalNetProfit, totalItems, activePlatforms, platformSales, platformDetail, platformOrders }
      }).sort((a, b) => b.date.localeCompare(a.date))

      setDayData(result)
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }, [month])

  useEffect(() => { loadData() }, [loadData])

  const toggleExpand = (date) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(date) ? next.delete(date) : next.add(date)
      return next
    })
  }

  // Stage a change locally (no DB write yet)
  const stageChange = (date, platform, field) => {
    const key     = tsKey(date, platform)
    const saved   = transferMap[key] ?? { mat: false, profit: false, labor: false }
    const current = pendingChanges[key] ?? { mat: saved.mat, profit: saved.profit, labor: saved.labor }
    setPendingChanges(prev => ({
      ...prev,
      [key]: { ...current, [field]: !current[field] },
    }))
  }

  // Confirm and save pending changes to DB
  const saveChanges = async (date, platform, detail = {}) => {
    const key    = tsKey(date, platform)
    const cur    = transferMap[key] ?? { mat: false, profit: false, labor: false, matAt: null, profitAt: null, laborAt: null, matAmount: 0, profitAmount: 0, laborAmount: 0 }
    const staged = pendingChanges[key] ?? { mat: cur.mat, profit: cur.profit, labor: cur.labor }
    const matNow    = staged.mat    && !cur.mat    ? new Date().toISOString() : (staged.mat    ? cur.matAt    : null)
    const profitNow = staged.profit && !cur.profit ? new Date().toISOString() : (staged.profit ? cur.profitAt : null)
    const laborNow  = staged.labor  && !cur.labor  ? new Date().toISOString() : (staged.labor  ? cur.laborAt  : null)

    setSaving(key)
    await supabase.from('transfer_status').upsert({
      sale_date:             date,
      platform,
      mat_transferred:       staged.mat,
      mat_transferred_at:    matNow,
      mat_amount:            staged.mat    ? (detail.matCost    ?? cur.matAmount    ?? 0) : 0,
      profit_transferred:    staged.profit,
      profit_transferred_at: profitNow,
      profit_amount:         staged.profit ? (detail.netProfit  ?? cur.profitAmount ?? 0) : 0,
      labor_transferred:     staged.labor,
      labor_transferred_at:  laborNow,
      labor_amount:          staged.labor  ? (detail.laborCost  ?? cur.laborAmount  ?? 0) : 0,
    }, { onConflict: 'sale_date,platform' })

    setTransferMap(prev => ({
      ...prev,
      [key]: { ...cur, mat: staged.mat, profit: staged.profit, labor: staged.labor,
               matAt: matNow, profitAt: profitNow, laborAt: laborNow,
               matAmount:    staged.mat    ? (detail.matCost   ?? cur.matAmount    ?? 0) : 0,
               profitAmount: staged.profit ? (detail.netProfit ?? cur.profitAmount ?? 0) : 0,
               laborAmount:  staged.labor  ? (detail.laborCost ?? cur.laborAmount  ?? 0) : 0 },
    }))
    setPendingChanges(prev => { const n = { ...prev }; delete n[key]; return n })
    setSaving(null)
  }

  // Cancel pending changes
  const cancelChanges = (date, platform) => {
    const key = tsKey(date, platform)
    setPendingChanges(prev => { const n = { ...prev }; delete n[key]; return n })
  }

  const prevMonth = () => setMonth(m => format(subMonths(new Date(m + '-01'), 1), 'yyyy-MM'))
  const nextMonth = () => {
    const next = format(addMonths(new Date(month + '-01'), 1), 'yyyy-MM')
    if (next <= format(new Date(), 'yyyy-MM')) setMonth(next)
  }
  const isCurrentMonth = month === format(new Date(), 'yyyy-MM')

  const totalSales  = dayData.reduce((s, d) => s + d.totalSales, 0)
  const totalProfit = dayData.reduce((s, d) => s + d.totalNetProfit, 0)
  const avgDaily    = dayData.length > 0 ? totalSales / dayData.length : 0

  const handlePrintMonth = () => {
    const rows = dayData.map(d => {
      const dt = thaiDate(d.date)
      return `<tr>
        <td>${dt.dayOfWeek} ${dt.full}</td>
        <td>${d.activePlatforms.join(', ') || '-'}</td>
        <td style="text-align:right">${formatBaht(d.totalSales)}</td>
        <td style="text-align:right;color:${d.totalNetProfit >= 0 ? '#15803d' : '#b91c1c'}">${formatBaht(d.totalNetProfit)}</td>
      </tr>`
    }).join('')
    const html = `<html><head><meta charset="UTF-8">
    <style>body{font-family:sans-serif;font-size:12px;padding:24px}h2{margin-bottom:4px}.sub{color:#666;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f3f4f6;text-align:left;padding:6px 8px}td{padding:5px 8px;border-bottom:1px solid #e5e7eb}.sum{font-weight:bold;background:#f9fafb}</style>
    </head><body>
    <h2>Cocoa House</h2>
    <div class="sub">${thaiMonth(month)} · ${dayData.length} วันที่มีข้อมูล</div>
    <table>
      <thead><tr><th>วันที่</th><th>Platform</th><th style="text-align:right">ยอดขาย</th><th style="text-align:right">กำไรสุทธิ</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="sum"><td colspan="2">รวม</td>
        <td style="text-align:right">${formatBaht(totalSales)}</td>
        <td style="text-align:right;color:${totalProfit >= 0 ? '#15803d' : '#b91c1c'}">${formatBaht(totalProfit)}</td>
      </tr></tfoot>
    </table>
    <p style="color:#999;margin-top:16px;font-size:11px">พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')}</p>
    </body></html>`
    const w = window.open('', '_blank', 'width=700,height=800')
    w.document.write(html)
    w.document.close()
    w.print()
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">ประวัติยอดขาย</h1>
        <div className="flex items-center gap-2">
          {!loading && dayData.length > 0 && (
            <button onClick={handlePrintMonth}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-sm font-medium hover:bg-gray-200 transition-colors">
              <Printer size={14} /> พิมพ์
            </button>
          )}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl px-1 py-1">
            <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium text-gray-700 min-w-[110px] text-center">
              {thaiMonth(month)}
            </span>
            <button onClick={nextMonth} disabled={isCurrentMonth}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-30">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Summary KPIs */}
      {!loading && dayData.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'วันที่มีข้อมูล', value: `${dayData.length} วัน` },
            { label: 'ยอดขายรวม',      value: formatBaht(totalSales) },
            { label: 'กำไรสุทธิ',      value: formatBaht(totalProfit), profit: true },
            { label: 'เฉลี่ย/วัน',     value: formatBaht(avgDaily) },
          ].map(({ label, value, profit }) => (
            <div key={label} className="card text-center py-3">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <p className={`text-base font-bold leading-tight ${
                profit ? (totalProfit >= 0 ? 'text-green-700' : 'text-red-600') : 'text-gray-900'
              }`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <div className="w-6 h-6 border-2 border-cocoa-300 border-t-cocoa-600 rounded-full animate-spin mr-3" />
          กำลังโหลด...
        </div>
      )}

      {!loading && dayData.length === 0 && (
        <div className="card text-center py-12">
          <ClipboardList size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">ยังไม่มีข้อมูลในเดือนนี้</p>
          <p className="text-sm text-gray-400 mt-1">กรอกยอดขายได้ที่หน้า "กรอกยอดขาย"</p>
          <button onClick={() => navigate('/sales')} className="btn-primary mt-4 mx-auto">ไปกรอกยอดขาย</button>
        </div>
      )}

      {/* Day list */}
      {!loading && dayData.map(day => {
        const dt             = thaiDate(day.date)
        const profitPositive = day.totalNetProfit >= 0
        const profitPct      = day.totalSales > 0
          ? (day.totalNetProfit / day.totalSales * 100).toFixed(1) : '0.0'
        const isExpanded  = expanded.has(day.date)
        const activePlats = day.activePlatforms

        const allMatDone     = activePlats.length > 0 && activePlats.every(p => transferMap[tsKey(day.date, p)]?.mat)
        const allProfitDone  = activePlats.length > 0 && activePlats.every(p => transferMap[tsKey(day.date, p)]?.profit)
        const someMatDone    = activePlats.some(p => transferMap[tsKey(day.date, p)]?.mat)
        const someProfitDone = activePlats.some(p => transferMap[tsKey(day.date, p)]?.profit)

        return (
          <div key={day.date} className="card overflow-hidden">
            <div className="flex items-start gap-3 cursor-pointer" onClick={() => toggleExpand(day.date)}>
              <div className={`shrink-0 w-12 text-center rounded-lg py-1.5 ${
                dt.isWeekend ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50 border border-gray-200'
              }`}>
                <p className={`text-xs ${dt.isWeekend ? 'text-amber-600' : 'text-gray-400'}`}>{dt.dayOfWeek}</p>
                <p className={`text-lg font-bold leading-tight ${dt.isWeekend ? 'text-amber-700' : 'text-gray-800'}`}>
                  {day.date.slice(8)}
                </p>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex flex-wrap gap-1">
                    {activePlats.map(p => (
                      <span key={p} className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLAT_BADGE[p] ?? 'bg-gray-100 text-gray-700'}`}>{p}</span>
                    ))}
                    {activePlats.length === 0 && <span className="text-xs text-gray-400">ไม่มีรายการขาย</span>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {activePlats.length > 0 && (
                      <>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5 ${
                          allMatDone ? 'bg-green-100 text-green-700' : someMatDone ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'
                        }`}>{allMatDone ? <CheckCircle2 size={10} /> : <Clock size={10} />} Mat</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5 ${
                          allProfitDone ? 'bg-green-100 text-green-700' : someProfitDone ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'
                        }`}>{allProfitDone ? <CheckCircle2 size={10} /> : <Clock size={10} />} กำไร</span>
                      </>
                    )}
                    {isExpanded ? <ChevronUp size={14} className="text-gray-400 ml-0.5" /> : <ChevronDown size={14} className="text-gray-400 ml-0.5" />}
                  </div>
                </div>

                <div className="flex items-end justify-between gap-2">
                  <div className="space-y-0.5">
                    <p className="text-lg font-bold text-gray-900 leading-tight">{formatBaht(day.totalSales)}</p>
                    <p className="text-xs text-gray-500">{day.totalItems} รายการ</p>
                  </div>
                  <div className="text-right">
                    <div className={`flex items-center gap-1 justify-end text-sm font-semibold ${profitPositive ? 'text-green-700' : 'text-red-600'}`}>
                      {profitPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                      {formatBaht(day.totalNetProfit)}
                    </div>
                    <p className={`text-xs mt-0.5 ${profitPositive ? 'text-green-600' : 'text-red-500'}`}>
                      {profitPositive ? '+' : ''}{profitPct}% net
                    </p>
                  </div>
                </div>

                {Object.keys(day.platformSales).length > 1 && day.totalSales > 0 && (
                  <div className="mt-2 flex gap-1 h-1.5 rounded-full overflow-hidden">
                    {activePlats.filter(p => (day.platformSales[p] ?? 0) > 0).map(p => {
                      const pct = (day.platformSales[p] / day.totalSales * 100).toFixed(1)
                      const colors = { GRAB:'bg-green-400', LINE:'bg-teal-500', SHOPEE:'bg-orange-400', 'The metro':'bg-blue-400', TU:'bg-purple-400' }
                      return <div key={p} title={`${p}: ${pct}%`} className={`${colors[p] ?? 'bg-gray-400'} rounded-full`} style={{ width:`${pct}%` }} />
                    })}
                  </div>
                )}
              </div>
            </div>

            {isExpanded && activePlats.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
                  <Banknote size={12} /> สถานะการโอนเงินแยกบัญชี
                </p>
                {activePlats.map(p => {
                  const key        = tsKey(day.date, p)
                  const ts         = transferMap[key] ?? {}
                  const detail     = day.platformDetail[p] ?? {}
                  const pending    = pendingChanges[key]
                  const hasPending = !!pending
                  // Display state: use pending if exists, else use saved
                  const dispMat    = hasPending ? pending.mat    : (ts.mat    ?? false)
                  const dispProfit = hasPending ? pending.profit : (ts.profit ?? false)
                  const dispLabor  = hasPending ? pending.labor  : (ts.labor  ?? false)
                  const isSaving   = saving === key
                  return (
                    <div key={p} className="bg-gray-50 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${PLAT_BADGE[p] ?? 'bg-gray-100 text-gray-700'}`}>{p}</span>
                        <span className="text-xs text-gray-400">ยอดขาย {formatBaht(detail.sales ?? 0)}</span>
                      </div>
                      {/* Order numbers from POS — กดเพื่อแก้ไขใน Cocoa POS */}
                      {(day.platformOrders?.[p] ?? []).length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">หมายเลขออเดอร์ · กดเพื่อแก้ไข</p>
                          {day.platformOrders[p].map(o => (
                            <a
                              key={o.notes}
                              href={`https://cocoa-pos.vercel.app?tab=orders&date=${day.date}&highlight=${o.notes}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-between bg-white rounded-lg px-2.5 py-1.5 border border-gray-100 hover:border-cocoa-300 hover:bg-cocoa-50 active:bg-cocoa-100 transition-colors cursor-pointer no-underline"
                            >
                              <span className="font-mono text-xs font-bold text-cocoa-700">{o.notes}</span>
                              <div className="flex items-center gap-2">
                                {o.time && <span className="text-[11px] text-gray-400">{o.time}น.</span>}
                                <span className="text-[11px] text-gray-400">{o.itemCount} รายการ</span>
                                <span className="text-xs font-semibold text-gray-700">{formatBaht(o.amount)}</span>
                              </div>
                            </a>
                          ))}
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-2">
                        <button onClick={() => stageChange(day.date, p, 'mat')} disabled={isSaving}
                          className={`flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-all active:scale-95 ${
                            dispMat
                              ? 'bg-green-50 border-green-300'
                              : hasPending && !dispMat
                                ? 'bg-white border-amber-300 ring-1 ring-amber-200'
                                : 'bg-white border-gray-200 hover:border-cocoa-300'
                          } ${isSaving ? 'opacity-50' : ''}`}>
                          <span className="text-[11px] text-gray-400 font-medium">Mat Cost</span>
                          <span className="text-sm font-bold text-gray-800">{formatBaht(detail.matCost ?? 0)}</span>
                          <span className={`text-[11px] flex items-center gap-1 font-semibold ${dispMat ? 'text-green-600' : 'text-gray-400'}`}>
                            {dispMat ? <><CheckCircle2 size={11} /> โอนแล้ว</> : <><Clock size={11} /> รอโอน</>}
                          </span>
                        </button>
                        <button onClick={() => stageChange(day.date, p, 'labor')} disabled={isSaving}
                          className={`flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-all active:scale-95 ${
                            dispLabor
                              ? 'bg-green-50 border-green-300'
                              : hasPending && !dispLabor
                                ? 'bg-white border-amber-300 ring-1 ring-amber-200'
                                : 'bg-white border-gray-200 hover:border-cocoa-300'
                          } ${isSaving ? 'opacity-50' : ''}`}>
                          <span className="text-[11px] text-gray-400 font-medium">Labor Cost</span>
                          <span className="text-sm font-bold text-gray-800">{formatBaht(detail.laborCost ?? 0)}</span>
                          <span className={`text-[11px] flex items-center gap-1 font-semibold ${dispLabor ? 'text-green-600' : 'text-gray-400'}`}>
                            {dispLabor ? <><CheckCircle2 size={11} /> โอนแล้ว</> : <><Clock size={11} /> รอโอน</>}
                          </span>
                        </button>
                        <button onClick={() => stageChange(day.date, p, 'profit')} disabled={isSaving}
                          className={`flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-all active:scale-95 ${
                            dispProfit
                              ? 'bg-green-50 border-green-300'
                              : hasPending && !dispProfit
                                ? 'bg-white border-amber-300 ring-1 ring-amber-200'
                                : 'bg-white border-gray-200 hover:border-cocoa-300'
                          } ${isSaving ? 'opacity-50' : ''}`}>
                          <span className="text-[11px] text-gray-400 font-medium">กำไรสุทธิ</span>
                          <span className={`text-sm font-bold ${(detail.netProfit ?? 0) >= 0 ? 'text-gray-800' : 'text-red-600'}`}>
                            {formatBaht(detail.netProfit ?? 0)}
                          </span>
                          <span className={`text-[11px] flex items-center gap-1 font-semibold ${dispProfit ? 'text-green-600' : 'text-gray-400'}`}>
                            {dispProfit ? <><CheckCircle2 size={11} /> โอนแล้ว</> : <><Clock size={11} /> รอโอน</>}
                          </span>
                        </button>
                      </div>
                      {/* Save / Cancel row — แสดงเมื่อมีการเปลี่ยนแปลงที่ยังไม่บันทึก */}
                      {hasPending && (
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => saveChanges(day.date, p, detail)}
                            disabled={isSaving}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-cocoa-600 text-white text-xs font-semibold hover:bg-cocoa-700 active:scale-95 transition-all disabled:opacity-50">
                            {isSaving ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={13} />}
                            บันทึก
                          </button>
                          <button
                            onClick={() => cancelChanges(day.date, p)}
                            disabled={isSaving}
                            className="flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-gray-100 text-gray-500 text-xs font-medium hover:bg-gray-200 active:scale-95 transition-all disabled:opacity-50">
                            <X size={13} /> ยกเลิก
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
                <button onClick={e => { e.stopPropagation(); navigate(`/sales?date=${day.date}`) }}
                  className="w-full py-2 rounded-xl text-xs font-medium text-cocoa-600 bg-cocoa-50 hover:bg-cocoa-100 transition-colors text-center">
                  + กรอกยอดขายวันนี้
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
