import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { exportMonthlyExcel } from '../utils/exportExcel'
import { calcPlatformProfit, formatBaht } from '../utils/calculations'
import { Download, Loader2, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { useToast } from '../contexts/ToastContext'

const THAI_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']
const PLATFORMS   = ['GRAB', 'LINE', 'SHOPEE', 'The metro', 'TU']

const PLAT_BADGE = {
  GRAB:        'bg-green-100 text-green-800',
  LINE:        'bg-green-600 text-white',
  SHOPEE:      'bg-orange-100 text-orange-800',
  'The metro': 'bg-blue-100 text-blue-800',
  TU:          'bg-purple-100 text-purple-800',
}

function thaiMonthLabel(monthStr) {
  const [y, m] = monthStr.split('-')
  return `${THAI_MONTHS[parseInt(m) - 1]} ${parseInt(y) + 543}`
}

export default function ReportsPage() {
  const { addToast } = useToast()
  const [month, setMonth]       = useState(format(new Date(), 'yyyy-MM'))
  const [loading, setLoading]   = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [status, setStatus]     = useState('')
  const [preview, setPreview]   = useState(null) // summary data

  // โหลด preview อัตโนมัติเมื่อเปลี่ยนเดือน
  useEffect(() => {
    loadPreview()
  }, [month])

  const fetchMonthData = async () => {
    const start = format(startOfMonth(new Date(month + '-01')), 'yyyy-MM-dd')
    const end   = format(endOfMonth(new Date(month + '-01')), 'yyyy-MM-dd')

    const [ordersRes, costsRes] = await Promise.all([
      supabase.from('orders').select('id, date, platform').gte('date', start).lte('date', end),
      supabase.from('platform_costs').select('*').gte('date', start).lte('date', end),
    ])
    const orders = ordersRes.data ?? []
    const costs  = costsRes.data ?? []

    if (orders.length === 0) return { orders, costs, items: [], isEmpty: true, start, end }

    const { data: items } = await supabase
      .from('order_items')
      .select('order_id, quantity, unit_price, unit_gp_cost')
      .in('order_id', orders.map(o => o.id))

    return { orders, costs, items: items ?? [], isEmpty: false, start, end }
  }

  const loadPreview = async () => {
    setPreviewing(true)
    try {
      const { orders, costs, items, isEmpty } = await fetchMonthData()

      if (isEmpty) {
        setPreview({ isEmpty: true })
        setPreviewing(false)
        return
      }

      // Index items by order_id
      const itemsByOrder = {}
      for (const item of items) {
        if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = []
        itemsByOrder[item.order_id].push(item)
      }

      // Aggregate
      let totalSales = 0, totalNetProfit = 0, totalItems = 0
      const byPlatform = {}
      const byDate = {}

      for (const order of orders) {
        const orderItems = (itemsByOrder[order.id] ?? []).map(i => ({
          quantity: i.quantity, unit_price: i.unit_price, unit_gp_cost: i.unit_gp_cost,
        }))
        const cost = costs.find(c => c.platform === order.platform && c.date === order.date) ?? {}
        const r    = calcPlatformProfit({ items: orderItems, costs: cost })

        totalSales     += r.sales
        totalNetProfit += r.netProfit
        totalItems     += r.itemCount

        if (!byPlatform[order.platform]) byPlatform[order.platform] = { sales: 0, netProfit: 0, days: new Set() }
        byPlatform[order.platform].sales     += r.sales
        byPlatform[order.platform].netProfit += r.netProfit
        if (r.itemCount > 0) byPlatform[order.platform].days.add(order.date)

        if (!byDate[order.date]) byDate[order.date] = { sales: 0, netProfit: 0 }
        byDate[order.date].sales     += r.sales
        byDate[order.date].netProfit += r.netProfit
      }

      const days = Object.keys(byDate)
      const profitableDays = days.filter(d => byDate[d].netProfit >= 0).length
      const avgDailySales  = days.length > 0 ? totalSales / days.length : 0

      setPreview({
        isEmpty: false,
        totalSales,
        totalNetProfit,
        totalItems,
        days: days.length,
        profitableDays,
        avgDailySales,
        byPlatform,
      })
    } catch (err) {
      console.error(err)
      setPreview(null)
      addToast('โหลดข้อมูลสรุปไม่สำเร็จ: ' + err.message, 'error')
    }
    setPreviewing(false)
  }

  const handleExport = async () => {
    setLoading(true)
    setStatus('กำลังดึงข้อมูล...')

    try {
      const { orders, costs, items, start, end } = await fetchMonthData()

      const [itemsWithOrder, menusRes] = await Promise.all([
        supabase.from('order_items').select('*, orders(date, platform)').gte('orders.date', start).lte('orders.date', end),
        supabase.from('menus').select('id, name, category, gp_cost'),
      ])

      setStatus('กำลังสร้างไฟล์ Excel...')

      exportMonthlyExcel({
        orders,
        orderItems: itemsWithOrder.data ?? [],
        platformCosts: costs,
        menus: menusRes.data ?? [],
        monthLabel: thaiMonthLabel(month),
      })

      setStatus('ดาวน์โหลดสำเร็จ!')
    } catch (err) {
      console.error(err)
      setStatus('เกิดข้อผิดพลาด: ' + err.message)
    } finally {
      setLoading(false)
      setTimeout(() => setStatus(''), 4000)
    }
  }

  const profitPct = preview && !preview.isEmpty && preview.totalSales > 0
    ? (preview.totalNetProfit / preview.totalSales * 100).toFixed(1)
    : null

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-gray-900">รายงาน & Export Excel</h1>

      {/* Month selector */}
      <div className="card space-y-3">
        <div>
          <label className="label">เลือกเดือน</label>
          <input
            type="month"
            className="input"
            value={month}
            max={format(new Date(), 'yyyy-MM')}
            onChange={e => setMonth(e.target.value)}
          />
        </div>
      </div>

      {/* Preview Summary */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">สรุป — {thaiMonthLabel(month)}</h2>
          <button
            onClick={loadPreview}
            disabled={previewing}
            className="text-xs text-cocoa-600 hover:underline flex items-center gap-1"
          >
            <RefreshCw size={12} className={previewing ? 'animate-spin' : ''} />
            รีเฟรช
          </button>
        </div>

        {previewing ? (
          <div className="flex items-center justify-center py-8 text-gray-400 gap-2">
            <Loader2 size={16} className="animate-spin" />
            กำลังโหลด...
          </div>
        ) : !preview || preview.isEmpty ? (
          <div className="text-center py-8 text-gray-400">
            <p className="text-sm">ไม่มีข้อมูลยอดขายในเดือนนี้</p>
          </div>
        ) : (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">ยอดขายรวม</p>
                <p className="text-xl font-bold text-gray-900">{formatBaht(preview.totalSales)}</p>
              </div>
              <div className={`rounded-xl p-3 text-center ${preview.totalNetProfit >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                <p className="text-xs text-gray-500 mb-1">กำไรสุทธิ</p>
                <p className={`text-xl font-bold ${preview.totalNetProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                  {formatBaht(preview.totalNetProfit)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">วันที่มีข้อมูล</p>
                <p className="text-lg font-bold text-gray-900">{preview.days} <span className="text-sm font-normal">วัน</span></p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">เฉลี่ย/วัน</p>
                <p className="text-lg font-bold text-gray-900">{formatBaht(preview.avgDailySales)}</p>
              </div>
              <div className={`rounded-xl p-3 text-center ${preview.profitableDays === preview.days ? 'bg-green-50' : preview.profitableDays > preview.days / 2 ? 'bg-amber-50' : 'bg-red-50'}`}>
                <p className="text-xs text-gray-500 mb-1">วันกำไร</p>
                <p className="text-lg font-bold text-gray-900">
                  {preview.profitableDays}
                  <span className="text-sm font-normal text-gray-500">/{preview.days}</span>
                </p>
              </div>
            </div>

            {/* Net profit % badge */}
            {profitPct !== null && (
              <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium ${
                parseFloat(profitPct) >= 0
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {parseFloat(profitPct) >= 0
                  ? <TrendingUp size={16} />
                  : <TrendingDown size={16} />
                }
                Net Profit Margin เดือนนี้: {parseFloat(profitPct) >= 0 ? '+' : ''}{profitPct}%
              </div>
            )}

            {/* Per-platform breakdown */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">ยอดขายแยก Platform</p>
              <div className="space-y-2">
                {PLATFORMS.filter(p => preview.byPlatform[p]?.sales > 0).map(p => {
                  const pd  = preview.byPlatform[p]
                  const pct = preview.totalSales > 0 ? (pd.sales / preview.totalSales * 100).toFixed(0) : 0
                  return (
                    <div key={p} className="flex items-center gap-3">
                      <span className={`badge shrink-0 w-24 text-center ${PLAT_BADGE[p]}`}>{p}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div
                          className="h-2 rounded-full bg-cocoa-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="text-right shrink-0 w-28">
                        <span className="text-sm font-medium text-gray-800">{formatBaht(pd.sales)}</span>
                        <span className="text-xs text-gray-400 ml-1">{pct}%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Export button */}
      <div className="card space-y-3">
        <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600 space-y-1">
          <p className="font-medium text-gray-700 mb-2">ไฟล์ Excel จะมี 3 Sheet:</p>
          <p>📋 <strong>Sheet 1</strong> — สรุปยอดขายรายวัน (ไฮไลท์วันกำไรติดลบ)</p>
          <p>📦 <strong>Sheet 2</strong> — สรุปยอดขายรายเมนู</p>
          <p>📊 <strong>Sheet 3</strong> — Dashboard เดือน (KPIs + Alerts)</p>
        </div>

        <button
          onClick={handleExport}
          disabled={loading || (preview?.isEmpty)}
          className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
          {loading ? (status || 'กำลังสร้างไฟล์...') : `Export Excel — ${thaiMonthLabel(month)}`}
        </button>

        {status && !loading && (
          <p className={`text-center text-sm ${status.includes('สำเร็จ') ? 'text-green-600' : 'text-red-600'}`}>
            {status}
          </p>
        )}
      </div>
    </div>
  )
}
