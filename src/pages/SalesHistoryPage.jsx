import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcPlatformProfit, formatBaht } from '../utils/calculations'
import { format, startOfMonth, endOfMonth, parseISO, addMonths, subMonths } from 'date-fns'
import { th } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, ClipboardList, PenLine, Printer } from 'lucide-react'

const PLATFORMS = ['GRAB', 'LINE', 'SHOPEE', 'The metro', 'TU']

const PLAT_BADGE = {
  GRAB:        'bg-green-100 text-green-800',
  LINE:        'bg-green-600 text-white',
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

export default function SalesHistoryPage() {
  const navigate = useNavigate()
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [loading, setLoading] = useState(true)
  const [dayData, setDayData] = useState([])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const start = format(startOfMonth(new Date(month + '-01')), 'yyyy-MM-dd')
        const end   = format(endOfMonth(new Date(month + '-01')), 'yyyy-MM-dd')

        const [ordersRes, costsRes] = await Promise.all([
          supabase.from('orders').select('id, date, platform').gte('date', start).lte('date', end),
          supabase.from('platform_costs').select('*').gte('date', start).lte('date', end),
        ])

        const orders = ordersRes.data ?? []
        const costs  = costsRes.data ?? []

        if (orders.length === 0) {
          setDayData([])
          setLoading(false)
          return
        }

        const { data: items } = await supabase
          .from('order_items')
          .select('order_id, quantity, unit_price, unit_gp_cost')
          .in('order_id', orders.map(o => o.id))

        // Index items by order_id
        const itemsByOrder = {}
        for (const item of items ?? []) {
          if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = []
          itemsByOrder[item.order_id].push(item)
        }

        // Group orders and costs by date
        const byDate = {}
        for (const order of orders) {
          if (!byDate[order.date]) byDate[order.date] = { orders: [], costs: [] }
          byDate[order.date].orders.push(order)
        }
        for (const cost of costs) {
          if (!byDate[cost.date]) byDate[cost.date] = { orders: [], costs: [] }
          byDate[cost.date].costs.push(cost)
        }

        // Calculate per-date summary
        const result = Object.entries(byDate).map(([date, { orders: dayOrders, costs: dayCosts }]) => {
          let totalSales = 0
          let totalNetProfit = 0
          let totalItems = 0
          const activePlatforms = []
          const platformSales = {}

          for (const order of dayOrders) {
            const orderItems = (itemsByOrder[order.id] ?? []).map(i => ({
              quantity:    i.quantity,
              unit_price:  i.unit_price,
              unit_gp_cost: i.unit_gp_cost,
            }))
            const cost = dayCosts.find(c => c.platform === order.platform) ?? {}
            const r = calcPlatformProfit({ items: orderItems, costs: cost })
            totalSales     += r.sales
            totalNetProfit += r.netProfit
            totalItems     += r.itemCount
            platformSales[order.platform] = r.grossSales
            if (r.itemCount > 0 || r.sales > 0) activePlatforms.push(order.platform)
          }

          return { date, totalSales, totalNetProfit, totalItems, activePlatforms, platformSales }
        }).sort((a, b) => b.date.localeCompare(a.date))

        setDayData(result)
      } catch (err) {
        console.error(err)
      }
      setLoading(false)
    }
    load()
  }, [month])

  const prevMonth = () => setMonth(m => format(subMonths(new Date(m + '-01'), 1), 'yyyy-MM'))
  const nextMonth = () => {
    const next = format(addMonths(new Date(month + '-01'), 1), 'yyyy-MM')
    if (next <= format(new Date(), 'yyyy-MM')) setMonth(next)
  }
  const isCurrentMonth = month === format(new Date(), 'yyyy-MM')

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
    <style>
      body { font-family: sans-serif; font-size: 12px; padding: 24px; }
      h2   { margin-bottom: 4px; }
      .sub { color:#666; margin-bottom:16px; }
      table{ width:100%; border-collapse:collapse; }
      th   { background:#f3f4f6; text-align:left; padding:6px 8px; }
      td   { padding:5px 8px; border-bottom:1px solid #e5e7eb; }
      .sum { font-weight:bold; background:#f9fafb; }
      @media print { body { padding: 8px; } }
    </style></head><body>
    <h2>☕ Cocoa House — สรุปยอดขายรายเดือน</h2>
    <div class="sub">${thaiMonth(month)} · ${dayData.length} วันที่มีข้อมูล</div>
    <table>
      <thead><tr><th>วันที่</th><th>Platform</th><th style="text-align:right">ยอดขาย</th><th style="text-align:right">กำไรสุทธิ</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="sum">
        <td colspan="2">รวม</td>
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

  const totalSales  = dayData.reduce((s, d) => s + d.totalSales, 0)
  const totalProfit = dayData.reduce((s, d) => s + d.totalNetProfit, 0)
  const totalItems  = dayData.reduce((s, d) => s + d.totalItems, 0)
  const avgDaily    = dayData.length > 0 ? totalSales / dayData.length : 0

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">ประวัติยอดขาย</h1>
        <div className="flex items-center gap-2">
          {!loading && dayData.length > 0 && (
            <button
              onClick={handlePrintMonth}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              <Printer size={14} /> พิมพ์
            </button>
          )}
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl px-1 py-1">
          <button
            onClick={prevMonth}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-medium text-gray-700 min-w-[110px] text-center">
            {thaiMonth(month)}
          </span>
          <button
            onClick={nextMonth}
            disabled={isCurrentMonth}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-30"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        </div>
      </div>

      {/* Summary KPIs */}
      {!loading && dayData.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'วันที่มีข้อมูล', value: `${dayData.length} วัน`, sub: null },
            { label: 'ยอดขายรวม',      value: formatBaht(totalSales),  sub: null },
            { label: 'กำไรสุทธิ',      value: formatBaht(totalProfit), profit: true },
            { label: 'เฉลี่ย/วัน',     value: formatBaht(avgDaily),    sub: null },
          ].map(({ label, value, profit }) => (
            <div key={label} className="card text-center py-3">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <p className={`text-base font-bold leading-tight ${
                profit
                  ? totalProfit >= 0 ? 'text-green-700' : 'text-red-600'
                  : 'text-gray-900'
              }`}>
                {value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <div className="w-6 h-6 border-2 border-cocoa-300 border-t-cocoa-600 rounded-full animate-spin mr-3" />
          กำลังโหลด...
        </div>
      )}

      {/* Empty */}
      {!loading && dayData.length === 0 && (
        <div className="card text-center py-12">
          <ClipboardList size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">ยังไม่มีข้อมูลในเดือนนี้</p>
          <p className="text-sm text-gray-400 mt-1">กรอกยอดขายได้ที่หน้า "กรอกยอดขาย"</p>
          <button
            onClick={() => navigate('/sales')}
            className="btn-primary mt-4 mx-auto"
          >
            ไปกรอกยอดขาย
          </button>
        </div>
      )}

      {/* Day list */}
      {!loading && dayData.map(day => {
        const dt = thaiDate(day.date)
        const profitPositive = day.totalNetProfit >= 0
        const profitPct = day.totalSales > 0
          ? (day.totalNetProfit / day.totalSales * 100).toFixed(1)
          : '0.0'

        return (
          <div
            key={day.date}
            onClick={() => navigate(`/sales?date=${day.date}`)}
            className="card cursor-pointer hover:border-cocoa-300 hover:shadow-sm transition-all group"
          >
            <div className="flex items-start gap-3">
              {/* Date block */}
              <div className={`shrink-0 w-12 text-center rounded-lg py-1.5 ${
                dt.isWeekend ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50 border border-gray-200'
              }`}>
                <p className={`text-xs ${dt.isWeekend ? 'text-amber-600' : 'text-gray-400'}`}>
                  {dt.dayOfWeek}
                </p>
                <p className={`text-lg font-bold leading-tight ${dt.isWeekend ? 'text-amber-700' : 'text-gray-800'}`}>
                  {day.date.slice(8)}
                </p>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex flex-wrap gap-1">
                    {PLATFORMS.filter(p => day.activePlatforms.includes(p)).map(p => (
                      <span key={p} className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLAT_BADGE[p]}`}>
                        {p}
                      </span>
                    ))}
                    {day.activePlatforms.length === 0 && (
                      <span className="text-xs text-gray-400">ไม่มีรายการขาย</span>
                    )}
                  </div>
                  <PenLine size={14} className="text-gray-300 group-hover:text-cocoa-500 shrink-0 transition-colors" />
                </div>

                <div className="flex items-end justify-between gap-2">
                  <div className="space-y-0.5">
                    <p className="text-lg font-bold text-gray-900 leading-tight">
                      {formatBaht(day.totalSales)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {day.totalItems} รายการ
                    </p>
                  </div>

                  <div className="text-right">
                    <div className={`flex items-center gap-1 justify-end text-sm font-semibold ${
                      profitPositive ? 'text-green-700' : 'text-red-600'
                    }`}>
                      {profitPositive
                        ? <TrendingUp size={14} />
                        : <TrendingDown size={14} />
                      }
                      {formatBaht(day.totalNetProfit)}
                    </div>
                    <p className={`text-xs mt-0.5 ${profitPositive ? 'text-green-600' : 'text-red-500'}`}>
                      {profitPositive ? '+' : ''}{profitPct}% net
                    </p>
                  </div>
                </div>

                {/* Platform mini bars */}
                {Object.keys(day.platformSales).length > 1 && day.totalSales > 0 && (
                  <div className="mt-2 flex gap-1 h-1.5 rounded-full overflow-hidden">
                    {PLATFORMS.filter(p => (day.platformSales[p] ?? 0) > 0).map(p => {
                      const pct = (day.platformSales[p] / day.totalSales * 100).toFixed(1)
                      const colors = {
                        GRAB: 'bg-green-400', LINE: 'bg-green-600',
                        SHOPEE: 'bg-orange-400', 'The metro': 'bg-blue-400', TU: 'bg-purple-400',
                      }
                      return (
                        <div
                          key={p}
                          title={`${p}: ${pct}%`}
                          className={`${colors[p]} rounded-full`}
                          style={{ width: `${pct}%` }}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
