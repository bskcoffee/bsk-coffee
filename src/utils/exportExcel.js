import * as XLSX from 'xlsx'
import { calcPlatformProfit, calcDayTotal } from './calculations'

const PLATFORMS = ['GRAB', 'LINE', 'SHOPEE', 'The metro', 'TU']

/**
 * Export 3-sheet Excel report for a given month
 */
export function exportMonthlyExcel({ orders, orderItems, platformCosts, menus, monthLabel }) {
  const wb = XLSX.utils.book_new()

  // ── SHEET 1: Daily Summary ──────────────────────────────────────────
  const datesMap = groupByDate(orders, orderItems, platformCosts)
  const dates = Object.keys(datesMap).sort()

  const sheet1Rows = [
    ['วันที่', 'GRAB ยอด', 'LINE ยอด', 'SHOPEE ยอด', 'The metro ยอด', 'TU ยอด',
     'ยอดรวม', 'GP Cost', 'Campaign', 'โฆษณา', 'ส่วนลด', 'กำไรสุทธิ', '% กำไร', 'หมายเหตุ']
  ]

  for (const date of dates) {
    const day = datesMap[date]
    const total = calcDayTotal(day.byPlatform)
    const note = PLATFORMS.map(p => day.notes[p]).filter(Boolean).join(' / ')
    const campaign = PLATFORMS.reduce((s, p) => s + (day.costs[p]?.campaign ?? 0), 0)
    const adv = PLATFORMS.reduce((s, p) => s + (day.costs[p]?.advertisement ?? 0), 0)
    sheet1Rows.push([
      date,
      day.byPlatform['GRAB']?.sales ?? 0,
      day.byPlatform['LINE']?.sales ?? 0,
      day.byPlatform['SHOPEE']?.sales ?? 0,
      day.byPlatform['The metro']?.sales ?? 0,
      day.byPlatform['TU']?.sales ?? 0,
      total.sales,
      total.gpCostTotal,
      campaign,
      adv,
      total.menuDiscount,
      total.netProfit,
      total.netProfitPct.toFixed(1) + '%',
      note,
    ])
  }

  const ws1 = XLSX.utils.aoa_to_sheet(sheet1Rows)
  ws1['!cols'] = [
    { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 12 }, { wch: 8 }, { wch: 30 },
  ]
  XLSX.utils.book_append_sheet(wb, ws1, 'สรุปรายวัน')

  // ── SHEET 2: Menu Summary ────────────────────────────────────────────
  const menuMap = {}
  for (const item of orderItems) {
    const key = item.menu_id
    if (!menuMap[key]) {
      const m = menus.find(m => m.id === key) ?? { name: 'Unknown', category: '-' }
      menuMap[key] = {
        name: m.name, category: m.category,
        qty: { GRAB: 0, LINE: 0, SHOPEE: 0, 'The metro': 0, TU: 0 },
        totalQty: 0, totalSales: 0, totalGP: 0,
      }
    }
    const order = orders.find(o => o.id === item.order_id)
    if (order) {
      const plat = order.platform
      menuMap[key].qty[plat] = (menuMap[key].qty[plat] ?? 0) + item.quantity
    }
    menuMap[key].totalQty += item.quantity
    menuMap[key].totalSales += item.quantity * item.unit_price
    menuMap[key].totalGP += item.quantity * item.unit_gp_cost
  }

  // รวมเมนูที่ไม่มียอด
  for (const m of menus) {
    if (!menuMap[m.id]) {
      menuMap[m.id] = {
        name: m.name, category: m.category,
        qty: { GRAB: 0, LINE: 0, SHOPEE: 0, 'The metro': 0, TU: 0 },
        totalQty: 0, totalSales: 0, totalGP: 0,
      }
    }
  }

  const sheet2Rows = [
    ['เมนู', 'หมวด', 'จำนวนขาย', 'ยอดขาย', 'GP Cost', 'กำไร', '% กำไร',
     'GRAB qty', 'LINE qty', 'SHOPEE qty', 'The metro qty', 'TU qty', 'หมายเหตุ']
  ]

  const sorted = Object.values(menuMap).sort((a, b) => b.totalQty - a.totalQty)
  for (const m of sorted) {
    const profit = m.totalSales - m.totalGP
    const pct = m.totalSales > 0 ? (profit / m.totalSales * 100).toFixed(1) + '%' : '-'
    const note = m.totalQty === 0 ? '⚠ ไม่มียอดเดือนนี้' : profit < 0 ? '🔴 ขาดทุน' : ''
    sheet2Rows.push([
      m.name, m.category, m.totalQty, m.totalSales, m.totalGP, profit, pct,
      m.qty.GRAB, m.qty.LINE, m.qty.SHOPEE, m.qty['The metro'], m.qty.TU, note
    ])
  }

  const ws2 = XLSX.utils.aoa_to_sheet(sheet2Rows)
  XLSX.utils.book_append_sheet(wb, ws2, 'สรุปรายเมนู')

  // ── SHEET 3: Month Dashboard ─────────────────────────────────────────
  const platformTotals = {}
  for (const plat of PLATFORMS) {
    const platItems = orderItems.filter(i => {
      const o = orders.find(o => o.id === i.order_id)
      return o?.platform === plat
    })
    const platCosts = platformCosts.filter(c => c.platform === plat)
    platformTotals[plat] = calcPlatformProfit({
      items: platItems.map(i => ({
        quantity: i.quantity,
        unit_price: i.unit_price,
        unit_gp_cost: i.unit_gp_cost,
      })),
      costs: platCosts.reduce((acc, c) => ({
        menu_discount:    (acc.menu_discount    ?? 0) + (c.menu_discount    ?? 0),
        campaign:         (acc.campaign         ?? 0) + (c.campaign         ?? 0),
        marketing_fee:    (acc.marketing_fee    ?? 0) + (c.marketing_fee    ?? 0),
        delivery_discount:(acc.delivery_discount ?? 0) + (c.delivery_discount ?? 0),
        advertisement:    (acc.advertisement    ?? 0) + (c.advertisement    ?? 0),
      }), {}),
    })
  }

  let bestDay = null, worstDay = null
  for (const date of dates) {
    const t = calcDayTotal(datesMap[date].byPlatform)
    if (!bestDay  || t.netProfit > bestDay.profit)  bestDay  = { date, profit: t.netProfit }
    if (!worstDay || t.netProfit < worstDay.profit) worstDay = { date, profit: t.netProfit }
  }

  const zeroSalesDays = dates.filter(d => calcDayTotal(datesMap[d].byPlatform).sales === 0)
  const lossMenus    = sorted.filter(m => m.totalQty > 0 && m.totalSales - m.totalGP < 0).map(m => m.name)
  const noSaleMenus  = sorted.filter(m => m.totalQty === 0).map(m => m.name)

  const totalNetProfit = PLATFORMS.reduce((s, p) => s + (platformTotals[p]?.netProfit ?? 0), 0)

  const sheet3Data = [
    ['📊 Dashboard เดือน ' + monthLabel, ''],
    ['', ''],
    ['ยอดขายรวม',   orderItems.reduce((s, i) => s + i.quantity * i.unit_price, 0)],
    ['กำไรสุทธิรวม', totalNetProfit],
    ['', ''],
    ['── สัดส่วน Platform ──', ''],
    ['Platform', 'ยอดขาย', 'กำไรสุทธิ', '% กำไร'],
    ...PLATFORMS.map(p => [
      p,
      platformTotals[p]?.sales     ?? 0,
      platformTotals[p]?.netProfit  ?? 0,
      (platformTotals[p]?.netProfitPct ?? 0).toFixed(1) + '%'
    ]),
    ['', ''],
    ['── วันที่ดีสุด ──',  bestDay?.date  ?? '-', 'กำไร', bestDay?.profit  ?? 0],
    ['── วันที่แย่สุด ──', worstDay?.date ?? '-', 'กำไร', worstDay?.profit ?? 0],
    ['', ''],
    ['⚠ วันที่ไม่มียอด', zeroSalesDays.length + ' วัน',  zeroSalesDays.join(', ')],
    ['🔴 เมนูขาดทุน',    lossMenus.length   + ' เมนู',  lossMenus.join(', ')],
    ['⬜ เมนูไม่มียอด',   noSaleMenus.length + ' เมนู',  noSaleMenus.slice(0, 10).join(', ')],
  ]

  const ws3 = XLSX.utils.aoa_to_sheet(sheet3Data)
  XLSX.utils.book_append_sheet(wb, ws3, 'Dashboard เดือน')

  XLSX.writeFile(wb, `CocoaHouse_${monthLabel}.xlsx`)
}

// ── Helpers ──────────────────────────────────────────────────────────────

function groupByDate(orders, orderItems, platformCosts) {
  const map = {}
  for (const order of orders) {
    if (!map[order.date]) {
      map[order.date] = { byPlatform: {}, notes: {}, costs: {} }
    }
    const items = orderItems.filter(i => i.order_id === order.id)
    const costs = platformCosts.find(c => c.date === order.date && c.platform === order.platform) ?? {}
    map[order.date].byPlatform[order.platform] = calcPlatformProfit({ items, costs })
    map[order.date].notes[order.platform] = order.notes
    map[order.date].costs[order.platform] = costs
  }
  return map
}
