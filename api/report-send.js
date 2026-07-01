// api/report-send.js — Vercel Serverless Function
// POST /api/report-send { date: 'YYYY-MM-DD' }  → manual trigger
// GET  /api/report-send                          → Vercel Cron (12:30 Thai = 05:30 UTC)
import Anthropic from '@anthropic-ai/sdk'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const LINE_TOKEN   = process.env.LINE_CHANNEL_ACCESS_TOKEN
const LINE_USER    = process.env.LINE_ADMIN_USER_ID

// ─── Date helpers (Thailand UTC+7) ───────────────────────────────────────────
function thaiDateStr(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }) // YYYY-MM-DD
}

function offsetDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysBetween(from, to) {
  return Math.round((new Date(to + 'T12:00:00') - new Date(from + 'T12:00:00')) / 86400000)
}

function getMondayOf(dateStr) {
  const d   = new Date(dateStr + 'T12:00:00')
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return d.toISOString().slice(0, 10)
}

function thaiDate(dateStr) {
  const d      = new Date(dateStr + 'T12:00:00')
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
  const days   = ['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.']
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`
}

function shortDay(dateStr) {
  const days = ['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.']
  return days[new Date(dateStr + 'T12:00:00').getDay()]
}

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmt    = n => Number(n ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })
const fmtPct = n => `${Number(n ?? 0).toFixed(1)}%`

function changeBadge(cur, prev) {
  if (!prev) return { text: '— vs 7 วันก่อน', color: '#9CA3AF' }
  const d = ((cur - prev) / Math.abs(prev)) * 100
  if (Math.abs(d) < 0.5) return { text: '→ เท่าเดิม', color: '#9CA3AF' }
  return d > 0
    ? { text: `↑ ${d.toFixed(1)}% vs 7 วันก่อน`, color: '#16A34A' }
    : { text: `↓ ${Math.abs(d).toFixed(1)}% vs 7 วันก่อน`, color: '#DC2626' }
}
function feeRateChangeBadge(cur, prev) {
  if (prev == null) return { text: '— vs 7 วันก่อน', color: '#9CA3AF' }
  const d = cur - prev
  if (Math.abs(d) < 0.1) return { text: '→ เท่าเดิม', color: '#9CA3AF' }
  return d < 0
    ? { text: `↓ ${Math.abs(d).toFixed(1)}pp vs 7 วันก่อน`, color: '#16A34A' }
    : { text: `↑ ${d.toFixed(1)}pp vs 7 วันก่อน`, color: '#DC2626' }
}
function netProfitChangeBadge(cur, prev) {
  if (prev == null) return { text: '— vs 7 วันก่อน', color: '#9CA3AF' }
  const d = cur - prev
  if (Math.abs(d) < 0.1) return { text: '→ เท่าเดิม', color: '#9CA3AF' }
  return d > 0
    ? { text: `↑ ${d.toFixed(1)}pp vs 7 วันก่อน`, color: '#16A34A' }
    : { text: `↓ ${Math.abs(d).toFixed(1)}pp vs 7 วันก่อน`, color: '#DC2626' }
}
function weeklyChangeBadge(cur, prev) {
  if (!prev) return { text: '— vs สัปดาห์ก่อน', color: '#9CA3AF' }
  const d = ((cur - prev) / Math.abs(prev)) * 100
  if (Math.abs(d) < 0.5) return { text: '→ เท่าเดิม', color: '#9CA3AF' }
  return d > 0
    ? { text: `↑ ${d.toFixed(1)}% vs สัปดาห์ก่อน`, color: '#16A34A' }
    : { text: `↓ ${Math.abs(d).toFixed(1)}% vs สัปดาห์ก่อน`, color: '#DC2626' }
}

// ─── Supabase REST ────────────────────────────────────────────────────────────
async function sb(table, qs = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  if (!res.ok) throw new Error(`Supabase ${table}: ${await res.text()}`)
  return res.json()
}

async function getSetting(key) {
  const rows = await sb('settings', `?key=eq.${encodeURIComponent(key)}&select=value`)
  return rows[0]?.value ?? null
}

async function upsertSetting(key, value) {
  await fetch(`${SUPABASE_URL}/rest/v1/settings`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ key, value }),
  })
}

// ─── AI Memory (A) ───────────────────────────────────────────────────────────
async function fetchAIMemory(reportType, limit = 4) {
  try {
    return await sb('ai_memory',
      `?report_type=eq.${reportType}&order=report_date.desc&limit=${limit}&select=report_date,recommendations,key_metrics`)
  } catch { return [] }
}

async function saveAIMemory(reportType, reportDate, recommendations, keyMetrics = {}) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/ai_memory`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ report_type: reportType, report_date: reportDate,
        recommendations, key_metrics: keyMetrics }),
    })
  } catch (e) { console.warn('[AI Memory] save failed:', e.message) }
}

function buildMemoryContext(memories, reportType) {
  if (!memories || memories.length === 0) return ''
  const lines = memories.map(m => {
    const d = m.report_date
    const km = m.key_metrics ?? {}
    const salesStr = km.totalSales ? ` | ยอด ฿${fmt(km.totalSales)}` : ''
    const profitStr = km.netProfitPct != null ? ` | Profit ${fmtPct(km.netProfitPct)}` : ''
    return `  [${d}${salesStr}${profitStr}]\n  แนะนำ: ${(m.recommendations ?? '').slice(0, 200).replace(/\n/g, ' ')}`
  }).join('\n')
  return `\n═══ ความจำ AI — ${reportType === 'daily' ? '4 วัน' : reportType === 'weekly' ? '4 สัปดาห์' : '4 เดือน'}ย้อนหลัง ═══\n${lines}\n(ใช้ความจำนี้ดูว่าแนะนำอะไรไปแล้ว ผลเป็นอย่างไร และพัฒนาคำแนะนำให้ดีขึ้น)\n`
}

// ─── Closed Day helpers ───────────────────────────────────────────────────────
function closedKey(dateStr) { return `closed_${dateStr}` }

async function isClosedDay(dateStr) {
  try {
    const val = await getSetting(closedKey(dateStr))
    return val === 'true'
  } catch { return false }
}

async function markClosedDay(dateStr, reason = 'ร้านปิด') {
  await upsertSetting(closedKey(dateStr), 'true')
  // บันทึก memory ด้วย เพื่อให้ AI รู้ว่าวันนั้นปิด
  await saveAIMemory('daily', dateStr,
    `ร้านปิด — ${reason} (ไม่นับในการวิเคราะห์ trend และ outcome)`,
    { closed: true, reason })
}

// ─── D: Outcome Tracking ─────────────────────────────────────────────────────
async function saveOutcome(reportDate, outcomeText) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/ai_memory?report_type=eq.daily&report_date=eq.${reportDate}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ outcome: outcomeText }),
    })
  } catch (e) { console.warn('[Outcome] save failed:', e.message) }
}

function buildOutcomeText(todayMetrics, yesterdayMemory) {
  if (!yesterdayMemory?.key_metrics) return null
  // ข้ามถ้าเมื่อวานร้านปิด
  if (yesterdayMemory.key_metrics?.closed) return null
  const km = yesterdayMemory.key_metrics
  const salesDiff  = todayMetrics.totalSales - (km.totalSales ?? 0)
  const profitDiff = todayMetrics.netProfitPct - (km.netProfitPct ?? 0)
  const salesSign  = salesDiff >= 0 ? '↑' : '↓'
  const profitSign = profitDiff >= 0 ? '+' : ''
  const salesIcon  = salesDiff >= 0 ? '✅' : '🔴'
  const profitIcon = profitDiff >= 0.5 ? '✅' : profitDiff <= -0.5 ? '🔴' : '🟡'
  return `${salesIcon} ยอดขาย ${salesSign}฿${fmt(Math.abs(salesDiff))} vs วันก่อน | ${profitIcon} Profit ${profitSign}${profitDiff.toFixed(1)}pp`
}

// ─── F: Day-of-week Baseline ─────────────────────────────────────────────────
async function fetchDayOfWeekBaseline(todayStr) {
  try {
    const dow = new Date(todayStr + 'T12:00:00').getDay() // 0=Sun
    const dates = [-7, -14, -21, -28].map(d => offsetDate(todayStr, d))
    const orders = await Promise.all(dates.map(d =>
      sb('orders', `?date=eq.${d}&status=eq.delivered&select=order_items(quantity,unit_price)`)
        .catch(() => [])
    ))
    // exclude closed days
    const closedFlags = await Promise.all(dates.map(d => isClosedDay(d).catch(() => false)))
    const daySales = orders
      .map((dayOrders, i) => closedFlags[i] ? null :
        dayOrders.reduce((t, o) =>
          t + (o.order_items ?? []).reduce((s, i2) => s + Number(i2.quantity ?? 0) * Number(i2.unit_price ?? 0), 0), 0))
      .filter(s => s != null && s > 0)
    if (daySales.length === 0) return null
    const avg = daySales.reduce((a, b) => a + b, 0) / daySales.length
    const dayNames = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์']
    return { avg, dayName: dayNames[dow], samples: daySales.length }
  } catch { return null }
}

// ─── Deduplication via Supabase ───────────────────────────────────────────────
async function alreadySentToday() {
  try {
    const val = await getSetting('ai_report_last_sent')
    return val === thaiDateStr(0)
  } catch { return false }
}

async function markSentToday() {
  await upsertSetting('ai_report_last_sent', thaiDateStr(0))
}

// ─── Fetch daily metrics ──────────────────────────────────────────────────────
async function fetchMenuOriginalPrices() {
  const rows = await sb('menu_prices', `?effective_to=is.null&select=menu_id,platform,price,original_price`)
  // map: menuId → { platform → { price, original_price } }
  const map = {}
  for (const r of rows) {
    if (!map[r.menu_id]) map[r.menu_id] = {}
    map[r.menu_id][r.platform?.toUpperCase()] = {
      price:          Number(r.price ?? 0),
      original_price: Number(r.original_price ?? r.price ?? 0),
    }
  }
  return map
}

// ─── Material cost helper (mirrors calcMenuCostBreakdown price=0, feePct=0) ────
function calcSimpleMaterialCost(mc, cs) {
  if (!mc || !cs) return 0
  const ingredient = (Number(mc.main_ingredient) || 0)
                   + (Number(mc.milk_condensed)  || 0)
                   + (Number(mc.milk_mixed)       || 0)
                   + (Number(mc.milk_fresh)       || 0)
  const pkgType = mc.packaging_type || 'beverage'
  let packaging = 0
  if (pkgType === 'beverage') {
    packaging = (cs.packaging_bev_cup     || 0) + (cs.packaging_bev_sticker || 0)
              + (cs.packaging_bev_straw   || 0) + (cs.packaging_bev_seal    || 0)
              + (cs.packaging_bev_bag     || 0)
  } else if (pkgType === 'bun') {
    packaging = (cs.packaging_bun_box     || 0) + (cs.packaging_bun_sticker || 0)
              + (cs.packaging_bun_bag     || 0)
  }
  const shared = (cs.consumables || 0) + (cs.operation_cost || 0)
  const custom = Array.isArray(mc.custom_costs)
    ? mc.custom_costs.reduce((s, c) => s + (Number(c.amount) || 0), 0)
    : 0
  return ingredient + packaging + shared + custom
}

async function fetchMetrics(dateStr) {
  const [orders, platCosts, costRows, menuOriginal] = await Promise.all([
    sb('orders', `?date=eq.${dateStr}&status=eq.delivered&select=id,platform,order_items(quantity,unit_price,unit_gp_cost,menu_id,menus(name,category))`),
    sb('platform_costs', `?date=eq.${dateStr}&select=*`),
    sb('cost_settings', `?effective_from=lte.${dateStr}&select=key,value,effective_from&order=effective_from.desc`),
    fetchMenuOriginalPrices(),
  ])

  const cs = {}
  for (const row of costRows) if (!(row.key in cs)) cs[row.key] = Number(row.value)

  // Fetch menu_costs for real material cost calculation (same as Dashboard)
  const menuIds = [...new Set(orders.flatMap(o => (o.order_items ?? []).map(i => i.menu_id)).filter(Boolean))]
  let menuCostMap = {}
  if (menuIds.length > 0) {
    const mcRows = await sb('menu_costs', `?menu_id=in.(${menuIds.join(',')})&select=*`)
    for (const mc of mcRows) menuCostMap[mc.menu_id] = mc
  }

  const BEV_CATS = ['Cocoa', 'Coffee', 'Matcha', 'Classic', 'Hot']
  let totalSales = 0, totalPlatFeeRaw = 0, totalMatCostRaw = 0
  const menuAgg = {}, platSales = {}, catQty = { beverage: 0, bread: 0, refill: 0, addon: 0 }

  for (const order of orders) {
    const plat = (order.platform ?? 'other').toUpperCase()
    for (const item of order.order_items ?? []) {
      const qty        = Number(item.quantity ?? 0)
      const price      = Number(item.unit_price ?? 0)
      const platFeeUnit = Number(item.unit_gp_cost ?? 0)  // = price × feePct (platform commission only)
      const matUnit    = calcSimpleMaterialCost(menuCostMap[item.menu_id], cs)
      totalSales        += qty * price
      totalPlatFeeRaw   += qty * platFeeUnit
      totalMatCostRaw   += qty * matUnit
      platSales[plat] = (platSales[plat] ?? 0) + qty * price
      const cat = item.menus?.category ?? ''
      const mId = item.menu_id ?? 'unknown'
      if (!menuAgg[mId]) {
        const origData  = menuOriginal[mId]?.[plat] ?? menuOriginal[mId]?.[Object.keys(menuOriginal[mId] ?? {})[0]]
        const origPrice = origData?.original_price ?? price
        const discPct   = origPrice > 0 && price < origPrice
          ? Math.round((origPrice - price) / origPrice * 100) : 0
        menuAgg[mId] = { name: item.menus?.name || mId, qty: 0, sales: 0,
                         platFee: 0, matCost: 0, origPrice, discPct }
      }
      menuAgg[mId].qty     += qty
      menuAgg[mId].sales   += qty * price
      menuAgg[mId].platFee += qty * platFeeUnit
      menuAgg[mId].matCost += qty * matUnit
      if (BEV_CATS.includes(cat))  catQty.beverage += qty
      else if (cat === 'Bun')      catQty.bread    += qty
      else if (cat === 'Refill')   catQty.refill   += qty
      else if (cat === 'Addon')    catQty.addon    += qty
    }
  }

  let menuDiscount = 0, extraCosts = 0
  for (const pc of platCosts) {
    menuDiscount += Number(pc.menu_discount ?? 0)
    extraCosts   += Number(pc.campaign ?? 0) + Number(pc.marketing_fee ?? 0)
                  + Number(pc.delivery_discount ?? 0) + Number(pc.advertisement ?? 0)
  }

  const grossSales     = Math.max(0, totalSales - menuDiscount)
  const discountRatio  = totalSales > 0 ? grossSales / totalSales : 1
  // Platform commission and material cost adjusted for discount ratio
  const platCommission = totalPlatFeeRaw  * discountRatio
  const matCost        = totalMatCostRaw  * discountRatio
  const laborCost      = grossSales * (cs.labor_pct ?? 0) / 100
  const totalPlatFee   = platCommission + extraCosts
  const platFeeRate    = grossSales > 0 ? (totalPlatFee / grossSales) * 100 : 0
  // Net Profit = Gross Sales − GP Commission − Mat Cost − Labor − Extra Costs
  // matches Dashboard: grossSales - totalGpCost - totalMatCost - totalLaborCost - extraCosts
  const netProfit    = grossSales - platCommission - matCost - laborCost - extraCosts
  const netProfitPct = grossSales > 0 ? (netProfit / grossSales) * 100 : 0

  // Per-menu margin = (sales - platFee - matCost) / sales  (real margin after plat fee + ingredients)
  for (const m of Object.values(menuAgg)) {
    m.margin = m.sales > 0 ? ((m.sales - m.platFee - m.matCost) / m.sales) * 100 : 0
  }
  const top3 = Object.values(menuAgg).sort((a, b) => b.qty - a.qty).slice(0, 3)

  const marketingFee    = menuDiscount + extraCosts
  const marketingFeePct = grossSales > 0 ? (marketingFee / grossSales) * 100 : 0
  // GP rate = platform commission / gross sales
  const gpRate = grossSales > 0 ? (platCommission / grossSales) * 100 : 0

  return { totalSales, grossSales, menuDiscount, totalPlatFee, platFeeRate,
           marketingFee, marketingFeePct, gpRate,
           matCost, laborCost, netProfit, netProfitPct, orderCount: orders.length,
           top3, catQty, platSales }
}

// ─── Fetch monthly total ──────────────────────────────────────────────────────
async function fetchMonthlyMetrics(dateStr) {
  const [year, month] = dateStr.split('-')
  const monthStart = `${year}-${month}-01`
  const orders = await sb('orders',
    `?date=gte.${monthStart}&date=lte.${dateStr}&status=eq.delivered&select=order_items(quantity,unit_price,unit_gp_cost)`)
  let totalSales = 0, totalGpCost = 0
  for (const o of orders)
    for (const i of o.order_items ?? []) {
      const qty = Number(i.quantity ?? 0)
      totalSales  += qty * Number(i.unit_price ?? 0)
      totalGpCost += qty * Number(i.unit_gp_cost ?? 0)
    }
  const netProfit    = totalSales - totalGpCost
  const netProfitPct = totalSales > 0 ? (netProfit / totalSales) * 100 : 0
  const monthLabel   = new Date(dateStr + 'T12:00:00').toLocaleDateString('th-TH', { month: 'long', timeZone: 'Asia/Bangkok' })
  return { totalSales, netProfit, netProfitPct, monthLabel }
}

// ─── Fetch weekly metrics ─────────────────────────────────────────────────────
async function fetchWeeklyMetrics(yesterday) {
  const monday      = getMondayOf(yesterday)
  const prevMonday  = offsetDate(monday, -7)
  const prevSameDay = offsetDate(yesterday, -7)
  const sumSales    = orders => orders.reduce((t, o) =>
    t + (o.order_items ?? []).reduce((s, i) => s + Number(i.quantity ?? 0) * Number(i.unit_price ?? 0), 0), 0)
  const [thisWeek, lastWeek] = await Promise.all([
    sb('orders', `?date=gte.${monday}&date=lte.${yesterday}&status=eq.delivered&select=order_items(quantity,unit_price)`),
    sb('orders', `?date=gte.${prevMonday}&date=lte.${prevSameDay}&status=eq.delivered&select=order_items(quantity,unit_price)`),
  ])
  return { thisWeekSales: sumSales(thisWeek), lastWeekSales: sumSales(lastWeek),
           dayCount: daysBetween(monday, yesterday) + 1, weekStart: monday, weekEnd: yesterday }
}

// ─── 4-Week Trend (B) ────────────────────────────────────────────────────────
async function fetch4WeekTrend(todayStr) {
  try {
    const from   = offsetDate(todayStr, -27)
    const orders = await sb('orders',
      `?date=gte.${from}&date=lte.${todayStr}&status=eq.delivered&select=date,platform,order_items(quantity,unit_price)`)
    const weeks  = [{}, {}, {}, {}]
    for (const o of orders) {
      const daysAgo = daysBetween(o.date, todayStr)
      const wi      = Math.min(3, Math.floor(daysAgo / 7))
      const wk      = weeks[wi]
      const sales   = (o.order_items ?? []).reduce(
        (t, i) => t + Number(i.quantity ?? 0) * Number(i.unit_price ?? 0), 0)
      wk.sales  = (wk.sales  ?? 0) + sales
      wk.orders = (wk.orders ?? 0) + 1
      const plat  = (o.platform ?? 'other').toUpperCase()
      if (!wk.plat) wk.plat = {}
      wk.plat[plat] = (wk.plat[plat] ?? 0) + sales
    }
    // weeks[0]=สัปดาห์นี้ (ถึงวันนี้), weeks[1]=สัปดาห์ก่อน, ...
    const labels = ['สัปดาห์นี้', '1 สัปดาห์ก่อน', '2 สัปดาห์ก่อน', '3 สัปดาห์ก่อน']
    return weeks.map((w, i) => ({
      label:  labels[i],
      sales:  w.sales  ?? 0,
      orders: w.orders ?? 0,
      plat:   w.plat   ?? {},
    }))
  } catch { return [] }
}

// ─── AI analysis ─────────────────────────────────────────────────────────────
async function getAIInsights(dateStr, today, lastWeek, weekly, memory = [], trend = [], baseline = null) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return '• (AI วิเคราะห์ไม่พร้อมใช้งาน — ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY)'

  const vsDay  = lastWeek
    ? `${((today.totalSales - lastWeek.totalSales) / (lastWeek.totalSales || 1) * 100).toFixed(1)}% vs 7 วันก่อน`
    : 'ไม่มีข้อมูลเปรียบเทียบ'

  const menuMarginLines = today.top3.map(m => {
    const tag      = m.margin >= 35 ? '✅ Push ได้' : m.margin >= 25 ? '🟡 ระวัง discount' : '🔴 ตรวจต้นทุน'
    const discNote = m.discPct > 0
      ? ` | 🏷 ลด ${m.discPct}% จากราคาปกติ ฿${fmt(m.origPrice)}`
      : ''
    return `  • ${m.name}: ×${m.qty} | Margin ${m.margin.toFixed(1)}% ${tag}${discNote}`
  }).join('\n')

  const platLines = Object.entries(today.platSales ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([plat, sales]) => {
      const lastSales = lastWeek?.platSales?.[plat]
      const vsStr = lastSales > 0
        ? ` (${((sales - lastSales) / lastSales * 100).toFixed(1)}% vs 7 วันก่อน)`
        : ''
      return `  • ${plat}: ฿${fmt(sales)}${vsStr}`
    }).join('\n')

  const matCostPct     = today.grossSales > 0 ? (today.matCost / today.grossSales * 100) : 0
  const checkProfit    = today.netProfitPct >= 20 ? '✅' : today.netProfitPct >= 15 ? '🟡' : '🔴'
  const checkMat       = matCostPct <= 30 ? '✅' : matCostPct <= 35 ? '🟡' : '🔴'
  const checkMarketing = today.marketingFeePct <= 20 ? '✅' : today.marketingFeePct <= 25 ? '🟡' : '🔴'
  const profitDelta    = lastWeek ? (today.netProfitPct - lastWeek.netProfitPct).toFixed(1) : null
  const trendNote      = profitDelta
    ? (Number(profitDelta) > 0 ? `ดีขึ้น +${profitDelta}pp` : `แย่ลง ${profitDelta}pp`) + ' จาก 7 วันก่อน'
    : 'ไม่มีข้อมูลเปรียบเทียบ'

  // (B) 4-week trend summary
  const trendLines = trend.length > 0
    ? trend.map(w => `  • ${w.label}: ฿${fmt(w.sales)} / ${w.orders} ออเดอร์`).join('\n')
    : ''

  // (F) day-of-week baseline
  const baselineNote = baseline
    ? `ค่าเฉลี่ยวัน${baseline.dayName} (${baseline.samples} สัปดาห์ก่อน): ฿${fmt(Math.round(baseline.avg))} | วันนี้ ${today.totalSales >= baseline.avg ? `สูงกว่า +฿${fmt(Math.round(today.totalSales - baseline.avg))} ✅` : `ต่ำกว่า -฿${fmt(Math.round(baseline.avg - today.totalSales))} ⚠️`}`
    : ''

  // (A) memory context
  const memoryBlock = buildMemoryContext(memory, 'daily')

  const prompt = `คุณคือ Mirai — AI วิเคราะห์ธุรกิจของ Cocoa House${memoryBlock}
ข้อมูล ${dateStr}: ยอดขาย ฿${fmt(today.totalSales)} (${vsDay}) | Net Profit ${fmtPct(today.netProfitPct)} ${checkProfit} | Mat Cost ${fmtPct(matCostPct)} ${checkMat} | Marketing ${fmtPct(today.marketingFeePct)} ${checkMarketing} | GP Rate ${fmtPct(today.gpRate)}
Platform: ${Object.entries(today.platSales ?? {}).sort((a,b)=>b[1]-a[1]).map(([p,s])=>`${p} ฿${fmt(s)}`).join(' | ')}
Top Menu: ${today.top3.map(m=>`${m.name} ×${m.qty} margin ${m.margin.toFixed(0)}%${m.discPct>0?' 🏷-'+m.discPct+'%':''}`).join(' | ')}
${baselineNote}${trendLines ? `Trend: ${trend.map(w=>`${w.label} ฿${fmt(w.sales)}`).join(' → ')}` : ''}${trendNote ? ` | ${trendNote}` : ''}

สรุป 3 ข้อ — สั้น กระชับ มี impact:
• ข้อ 1 สถานะ: ผ่าน/ไม่ผ่านเป้า + Root Cause หลัก 1 อย่าง (ระบุตัวเลข)
• ข้อ 2 Action 48 ชม.: 1 action ทำได้เลย ระบุเมนู/platform + ตัวเลขที่คาดหวัง
• ข้อ 3 Insight: pricing/bundle/campaign ที่เพิ่ม Profit ได้สุด พร้อมเหตุผล

กฎ: ภาษาไทย กระชับ ตัวเลขจริงทุกข้อ ห้ามพูดกว้างๆ แต่ละข้อ ≤ 2 บรรทัด`

  const ai  = new Anthropic({ apiKey })
  const msg = await ai.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  })
  return msg.content[0]?.text ?? '• ไม่สามารถวิเคราะห์ได้ในขณะนี้'
}

// ─── LINE Flex Message ────────────────────────────────────────────────────────
function buildFlexMessage(dateStr, today, lastWeek, weekly, monthly, aiText) {
  // % change vs 7 days (compact badge)
  const pctBadge = (cur, prev) => {
    if (!prev || prev === 0) return { text: '—', color: '#9CA3AF' }
    const d = ((cur - prev) / Math.abs(prev)) * 100
    if (Math.abs(d) < 0.5) return { text: '→', color: '#9CA3AF' }
    return d > 0
      ? { text: `↑${d.toFixed(1)}%`, color: '#16A34A' }
      : { text: `↓${Math.abs(d).toFixed(1)}%`, color: '#DC2626' }
  }
  const ppBadge = (cur, prev, invertGood = false) => {
    if (prev == null) return { text: '—', color: '#9CA3AF' }
    const d = cur - prev
    if (Math.abs(d) < 0.1) return { text: '→', color: '#9CA3AF' }
    const good = invertGood ? d < 0 : d > 0
    return { text: `${d > 0 ? '↑' : '↓'}${Math.abs(d).toFixed(1)}pp`, color: good ? '#16A34A' : '#DC2626' }
  }

  // metric row: label | value | % badge
  const row = (label, value, badge) => ({
    type: 'box', layout: 'horizontal', margin: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#6B7280', flex: 4 },
      { type: 'text', text: value, size: 'sm', color: '#111827', weight: 'bold', flex: 3, align: 'end' },
      { type: 'text', text: badge.text, size: 'xs', color: badge.color, flex: 2, align: 'end' },
    ],
  })

  const aiLines = aiText.split('\n').filter(l => l.trim()).map(line => ({
    type: 'text', text: line.trim(), size: 'sm', color: '#374151', wrap: true, margin: 'xs',
  }))

  const top3Items = today.top3.length > 0
    ? today.top3.map((m, i) => ({
        type: 'box', layout: 'horizontal', margin: 'sm',
        contents: [
          { type: 'text', text: `${i + 1}.`, size: 'sm', color: '#9CA3AF', flex: 1 },
          { type: 'text', text: m.name, size: 'sm', color: '#111827', flex: 6 },
          { type: 'text', text: `×${m.qty}`, size: 'sm', color: '#4B5563', flex: 2, align: 'end' },
        ],
      }))
    : [{ type: 'text', text: 'ไม่มีออเดอร์', size: 'sm', color: '#9CA3AF' }]

  const netProfitColor = today.netProfitPct < 0 ? '#DC2626' : today.netProfitPct < 10 ? '#D97706' : '#111827'

  return {
    type: 'flex',
    altText: `Cocoa House รายงานประจำวัน — ${thaiDate(dateStr)}`,
    contents: {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: '#3B1F0F',
        contents: [
          { type: 'text', text: '🍫 Cocoa House', weight: 'bold', color: '#FFFFFF', size: 'lg' },
          { type: 'text', text: `รายงานประจำวัน — ${thaiDate(dateStr)}`, size: 'xs', color: '#D4A87A', margin: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'none',
        contents: [
          // ── Daily: 2 summary cards ──
          { type: 'text', text: '📊 ยอดขายเมื่อวาน', weight: 'bold', size: 'sm', color: '#374151' },
          { type: 'separator', margin: 'sm' },
          {
            type: 'box', layout: 'horizontal', margin: 'md', spacing: 'md',
            contents: [
              // Card 1: ยอดขายรวม
              {
                type: 'box', layout: 'vertical', flex: 1,
                backgroundColor: '#F9FAFB', cornerRadius: '10px', paddingAll: '12px',
                contents: [
                  { type: 'text', text: 'ยอดขายรวม', size: 'xs', color: '#6B7280' },
                  { type: 'text', text: `฿${fmt(today.totalSales)}`, size: 'xl', weight: 'bold', color: '#111827', margin: 'xs' },
                  { type: 'text', text: pctBadge(today.totalSales, lastWeek?.totalSales).text,
                    size: 'xs', color: pctBadge(today.totalSales, lastWeek?.totalSales).color, margin: 'xs' },
                ],
              },
              // Card 2: Net Profit
              {
                type: 'box', layout: 'vertical', flex: 1,
                backgroundColor: today.netProfitPct < 20 ? '#FEF2F2' : '#F0FDF4',
                cornerRadius: '10px', paddingAll: '12px',
                contents: [
                  { type: 'text', text: 'Net Profit', size: 'xs', color: '#6B7280' },
                  { type: 'text', text: `฿${fmt(today.netProfit)}`, size: 'xl', weight: 'bold', color: netProfitColor, margin: 'xs' },
                  { type: 'text', text: fmtPct(today.netProfitPct) + '  ' + ppBadge(today.netProfitPct, lastWeek?.netProfitPct).text,
                    size: 'xs', color: ppBadge(today.netProfitPct, lastWeek?.netProfitPct).color, margin: 'xs' },
                ],
              },
            ],
          },
          // ── Weekly + Monthly ──
          { type: 'separator', margin: 'md' },
          { type: 'box', layout: 'horizontal', margin: 'md', spacing: 'md',
            contents: [
              // สัปดาห์
              { type: 'box', layout: 'vertical', flex: 1, backgroundColor: '#F9FAFB', cornerRadius: '10px', paddingAll: '12px',
                contents: [
                  { type: 'text', text: '📅 สัปดาห์นี้', size: 'xs', color: '#6B7280' },
                  { type: 'text', text: `฿${fmt(weekly?.thisWeekSales ?? 0)}`, size: 'lg', weight: 'bold', color: '#111827', margin: 'xs' },
                  { type: 'text', text: weeklyChangeBadge(weekly?.thisWeekSales, weekly?.lastWeekSales).text,
                    size: 'xs', color: weeklyChangeBadge(weekly?.thisWeekSales, weekly?.lastWeekSales).color, margin: 'xs' },
                ],
              },
              // เดือน
              { type: 'box', layout: 'vertical', flex: 1, backgroundColor: '#F9FAFB', cornerRadius: '10px', paddingAll: '12px',
                contents: [
                  { type: 'text', text: `📆 ${monthly?.monthLabel ?? 'เดือนนี้'}`, size: 'xs', color: '#6B7280' },
                  { type: 'text', text: `฿${fmt(monthly?.totalSales ?? 0)}`, size: 'lg', weight: 'bold', color: '#111827', margin: 'xs' },
                  { type: 'text', text: `Profit ${fmtPct(monthly?.netProfitPct ?? 0)}`,
                    size: 'xs', color: (monthly?.netProfitPct ?? 0) >= 20 ? '#16A34A' : '#DC2626', margin: 'xs' },
                ],
              },
            ],
          },

          // ── Top 3 ──
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '🏆 Top เมนูขายดี', weight: 'bold', size: 'sm', color: '#374151', margin: 'md' },
          ...top3Items,

          // ── Category ──
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '📦 ยอดตามประเภท', weight: 'bold', size: 'sm', color: '#374151', margin: 'md' },
          {
            type: 'box', layout: 'horizontal', margin: 'sm', spacing: 'sm',
            contents: [
              { type: 'box', layout: 'vertical', flex: 1, backgroundColor: '#FFF3ED', cornerRadius: '8px', paddingAll: '8px',
                contents: [
                  { type: 'text', text: '🧋', size: 'sm', align: 'center' },
                  { type: 'text', text: String(today.catQty?.beverage ?? 0), size: 'lg', weight: 'bold', color: '#92400E', align: 'center' },
                  { type: 'text', text: 'Bev', size: 'xxs', color: '#92400E', align: 'center' },
                ],
              },
              { type: 'box', layout: 'vertical', flex: 1, backgroundColor: '#FEFCE8', cornerRadius: '8px', paddingAll: '8px',
                contents: [
                  { type: 'text', text: '🍞', size: 'sm', align: 'center' },
                  { type: 'text', text: String(today.catQty?.bread ?? 0), size: 'lg', weight: 'bold', color: '#713F12', align: 'center' },
                  { type: 'text', text: 'Bread', size: 'xxs', color: '#713F12', align: 'center' },
                ],
              },
              { type: 'box', layout: 'vertical', flex: 1, backgroundColor: '#EFF6FF', cornerRadius: '8px', paddingAll: '8px',
                contents: [
                  { type: 'text', text: '🔄', size: 'sm', align: 'center' },
                  { type: 'text', text: String(today.catQty?.refill ?? 0), size: 'lg', weight: 'bold', color: '#1E40AF', align: 'center' },
                  { type: 'text', text: 'Refill', size: 'xxs', color: '#1E40AF', align: 'center' },
                ],
              },
              { type: 'box', layout: 'vertical', flex: 1, backgroundColor: '#F5F3FF', cornerRadius: '8px', paddingAll: '8px',
                contents: [
                  { type: 'text', text: '➕', size: 'sm', align: 'center' },
                  { type: 'text', text: String(today.catQty?.addon ?? 0), size: 'lg', weight: 'bold', color: '#5B21B6', align: 'center' },
                  { type: 'text', text: 'Add-on', size: 'xxs', color: '#5B21B6', align: 'center' },
                ],
              },
            ],
          },

          // ── Menu Margin ──
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '📈 Margin เมนูขายดี', weight: 'bold', size: 'sm', color: '#374151', margin: 'md' },
          ...today.top3.map(m => {
            const isHigh = m.margin >= 35, isLow = m.margin < 25
            const bg     = isHigh ? '#F0FDF4' : isLow ? '#FEF2F2' : '#FFFBEB'
            const badge  = isHigh ? { text: 'Push!', bg: '#DCFCE7', color: '#166534' }
                         : isLow  ? { text: 'ตรวจต้นทุน', bg: '#FEE2E2', color: '#991B1B' }
                                  : { text: 'ระวัง discount', bg: '#FEF3C7', color: '#92400E' }
            return {
              type: 'box', layout: 'horizontal', margin: 'sm', backgroundColor: bg,
              cornerRadius: '8px', paddingAll: '9px',
              contents: [
                { type: 'box', layout: 'vertical', flex: 5, contents: [
                  { type: 'text', text: `${m.name} ×${m.qty}`, size: 'sm', weight: 'bold',
                    color: isHigh ? '#166534' : isLow ? '#7F1D1D' : '#713F12' },
                  { type: 'box', layout: 'horizontal', margin: 'xs', contents: [
                    { type: 'text', text: `Margin ${m.margin.toFixed(1)}%`, size: 'xs',
                      color: isHigh ? '#16A34A' : isLow ? '#DC2626' : '#D97706', flex: 0 },
                    ...(m.discPct > 0 ? [{ type: 'text', text: `  🏷-${m.discPct}%`, size: 'xs',
                      color: '#DC2626', flex: 0 }] : []),
                  ]},
                ]},
                { type: 'box', layout: 'vertical', flex: 3, justifyContent: 'center', contents: [
                  { type: 'box', layout: 'vertical', backgroundColor: badge.bg,
                    cornerRadius: '12px', paddingAll: '4px',
                    contents: [{ type: 'text', text: badge.text, size: 'xxs',
                      weight: 'bold', color: badge.color, align: 'center' }] },
                ]},
              ],
            }
          }),

          // ── AI ──
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '🤖 AI วิเคราะห์', weight: 'bold', size: 'sm', color: '#374151', margin: 'md' },
          ...aiLines,
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px', backgroundColor: '#F9FAFB',
        contents: [{
          type: 'button',
          action: { type: 'uri', label: 'เปิด Dashboard', uri: 'https://cocoa-house.vercel.app' },
          style: 'secondary', height: 'sm', color: '#D4A87A',
        }],
      },
    },
  }
}

// ─── Fetch weekly menu metrics ────────────────────────────────────────────────
async function fetchWeeklyMenuMetrics(monday, sunday) {
  const prevMonday = offsetDate(monday, -7)
  const prevSunday = offsetDate(sunday, -7)
  const [thisWeek, lastWeek] = await Promise.all([
    sb('orders', `?date=gte.${monday}&date=lte.${sunday}&status=eq.delivered&select=order_items(quantity,unit_price,unit_gp_cost,menu_id,menus(name))`),
    sb('orders', `?date=gte.${prevMonday}&date=lte.${prevSunday}&status=eq.delivered&select=order_items(quantity,unit_price,unit_gp_cost,menu_id,menus(name))`),
  ])
  const aggMenu = (orders) => {
    const agg = {}
    for (const o of orders)
      for (const i of o.order_items ?? []) {
        const id = i.menu_id ?? 'x'
        if (!agg[id]) agg[id] = { name: i.menus?.name || id, qty: 0, sales: 0, gpCost: 0 }
        agg[id].qty    += Number(i.quantity ?? 0)
        agg[id].sales  += Number(i.quantity ?? 0) * Number(i.unit_price ?? 0)
        agg[id].gpCost += Number(i.quantity ?? 0) * Number(i.unit_gp_cost ?? 0)
      }
    for (const m of Object.values(agg)) m.margin = m.sales > 0 ? (m.sales - m.gpCost) / m.sales * 100 : 0
    return agg
  }
  const thisAgg = aggMenu(thisWeek)
  const lastAgg = aggMenu(lastWeek)
  const totalSales = (orders) => orders.reduce((t, o) =>
    t + (o.order_items ?? []).reduce((s, i) => s + Number(i.quantity ?? 0) * Number(i.unit_price ?? 0), 0), 0)
  return { thisAgg, lastAgg, thisSales: totalSales(thisWeek), lastSales: totalSales(lastWeek) }
}

// ─── Fetch monthly menu metrics ───────────────────────────────────────────────
async function fetchMonthlyMenuMetrics(year, month) {
  const monthStart = `${year}-${String(month).padStart(2,'0')}-01`
  const lastMonth  = month === 1 ? `${year-1}-12-01` : `${year}-${String(month-1).padStart(2,'0')}-01`
  const lastEnd    = offsetDate(monthStart, -1)
  const [thisM, lastM, platCostsThis, platCostsLast] = await Promise.all([
    sb('orders', `?date=gte.${monthStart}&status=eq.delivered&select=id,platform,order_items(quantity,unit_price,unit_gp_cost,menu_id,menus(name))`),
    sb('orders', `?date=gte.${lastMonth}&date=lte.${lastEnd}&status=eq.delivered&select=id,platform,order_items(quantity,unit_price,unit_gp_cost,menu_id,menus(name))`),
    sb('platform_costs', `?date=gte.${monthStart}&select=campaign,marketing_fee,delivery_discount,advertisement,menu_discount`),
    sb('platform_costs', `?date=gte.${lastMonth}&date=lte.${lastEnd}&select=campaign,marketing_fee,delivery_discount,advertisement,menu_discount`),
  ])
  const aggMenu = (orders) => {
    const agg = {}
    for (const o of orders)
      for (const i of o.order_items ?? []) {
        const id = i.menu_id ?? 'x'
        if (!agg[id]) agg[id] = { name: i.menus?.name || id, qty: 0, sales: 0, gpCost: 0 }
        agg[id].qty    += Number(i.quantity ?? 0)
        agg[id].sales  += Number(i.quantity ?? 0) * Number(i.unit_price ?? 0)
        agg[id].gpCost += Number(i.quantity ?? 0) * Number(i.unit_gp_cost ?? 0)
      }
    for (const m of Object.values(agg)) m.margin = m.sales > 0 ? (m.sales - m.gpCost) / m.sales * 100 : 0
    return agg
  }
  const sumSales   = (orders) => orders.reduce((t, o) =>
    t + (o.order_items ?? []).reduce((s, i) => s + Number(i.quantity ?? 0) * Number(i.unit_price ?? 0), 0), 0)
  const sumGpCost  = (orders) => orders.reduce((t, o) =>
    t + (o.order_items ?? []).reduce((s, i) => s + Number(i.quantity ?? 0) * Number(i.unit_gp_cost ?? 0), 0), 0)
  const sumMktFee  = (rows) => rows.reduce((t, r) =>
    t + Number(r.campaign ?? 0) + Number(r.marketing_fee ?? 0)
      + Number(r.delivery_discount ?? 0) + Number(r.advertisement ?? 0)
      + Number(r.menu_discount ?? 0), 0)
  const thisSales      = sumSales(thisM);   const thisGpCost = sumGpCost(thisM)
  const lastSales      = sumSales(lastM);   const lastGpCost = sumGpCost(lastM)
  const thisOrderCount = thisM.length
  const lastOrderCount = lastM.length
  const thisAOV        = thisOrderCount > 0 ? thisSales / thisOrderCount : 0
  const lastAOV        = lastOrderCount > 0 ? lastSales / lastOrderCount : 0
  // ── Platform breakdown ──
  const aggByPlatform = (orders) => {
    const agg = {}
    for (const o of orders) {
      const plat = o.platform ?? 'Other'
      if (!agg[plat]) agg[plat] = { sales: 0, orders: 0 }
      const s = (o.order_items ?? []).reduce((t, i) => t + Number(i.quantity ?? 0) * Number(i.unit_price ?? 0), 0)
      agg[plat].sales  += s
      agg[plat].orders += 1
    }
    return agg
  }
  const thisByPlatform = aggByPlatform(thisM)
  const lastByPlatform = aggByPlatform(lastM)
  const thisMktFee     = sumMktFee(platCostsThis)
  const lastMktFee     = sumMktFee(platCostsLast)
  const thisNetProfit    = thisSales - thisGpCost - thisMktFee
  const thisNetProfitPct = thisSales > 0 ? thisNetProfit / thisSales * 100 : 0
  const lastNetProfitPct = lastSales > 0 ? (lastSales - lastGpCost - lastMktFee) / lastSales * 100 : 0
  const thisMktFeePct    = thisSales > 0 ? thisMktFee / thisSales * 100 : 0
  const lastMktFeePct    = lastSales > 0 ? lastMktFee / lastSales * 100 : 0
  const monthName = new Date(monthStart + 'T12:00:00').toLocaleDateString('th-TH', { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' })
  const top5 = Object.values(aggMenu(thisM)).sort((a, b) => b.qty - a.qty).slice(0, 5)
  return { thisSales, lastSales, thisNetProfit, thisNetProfitPct, lastNetProfitPct,
           thisMktFee, thisMktFeePct, lastMktFeePct,
           thisOrderCount, lastOrderCount, thisAOV, lastAOV,
           thisByPlatform, lastByPlatform,
           top5, monthName }
}

// ─── Weekly AI insights ───────────────────────────────────────────────────────
async function getWeeklyAIInsights(weekData, monday, sunday, memory = []) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return '• (AI ไม่พร้อมใช้งาน)'
  const salesChange = weekData.lastSales > 0
    ? ((weekData.thisSales - weekData.lastSales) / weekData.lastSales * 100).toFixed(1)
    : null
  const topMenuLines = Object.values(weekData.thisAgg)
    .sort((a, b) => b.qty - a.qty).slice(0, 5)
    .map(m => {
      const last = Object.values(weekData.lastAgg).find(x => x.name === m.name)
      const vs   = last ? ` (${((m.qty - last.qty) / (last.qty || 1) * 100).toFixed(0)}% vs สัปดาห์ก่อน)` : ''
      const tag  = m.margin >= 35 ? '✅ Push' : m.margin < 25 ? '🔴 ตรวจต้นทุน' : '🟡 ระวัง'
      return `  • ${m.name}: ×${m.qty}${vs} | Margin ${m.margin.toFixed(1)}% ${tag}`
    }).join('\n')
  const memoryBlock = buildMemoryContext(memory, 'weekly')
  const prompt = `คุณคือ CMO+CFO ร้าน Cocoa House — วิเคราะห์สัปดาห์ที่ผ่านมาและวางแผนการตลาดสัปดาห์หน้า${memoryBlock}
═══ ผลสัปดาห์ ${monday} ถึง ${sunday} ═══
ยอดขายสัปดาห์นี้  ฿${fmt(weekData.thisSales)}  ${salesChange ? `(${Number(salesChange) >= 0 ? '↑' : '↓'}${Math.abs(salesChange)}% vs สัปดาห์ก่อน)` : ''}
ยอดขายสัปดาห์ก่อน ฿${fmt(weekData.lastSales)}

Top 5 เมนู + Margin:
${topMenuLines || 'ไม่มีข้อมูล'}

═══ วิเคราะห์ 4 ข้อ ═══
ข้อ 1 — ผลสัปดาห์นี้: ยอดโต/ลด เมนูไหนขับเคลื่อน trend เป็นอย่างไร
ข้อ 2 — แคมเปญที่ผ่านมาได้ผลไหม: เปรียบ volume เมนูและยอดขาย vs สัปดาห์ก่อน (อ้างอิง memory ถ้ามี)
ข้อ 3 — Pricing/Campaign สัปดาห์หน้า: แนะนำ 1 action ชัดเจน เช่น ขึ้นราคาเมนู X ฿Y บน platform Z หรือลดราคา % เพื่อเพิ่ม volume โดยระบุเป้าที่คาดหวัง
ข้อ 4 — KPI เป้าสัปดาห์หน้า: ยอดขาย ฿X และ Profit %Y

กฎ: ภาษาไทย ตรงๆ ระบุตัวเลขจริง แต่ละข้อขึ้นต้น "• " ขึ้นบรรทัดใหม่`
  const ai  = new Anthropic({ apiKey })
  const msg = await ai.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  })
  return msg.content[0]?.text ?? '• ไม่สามารถวิเคราะห์ได้'
}

// ─── Monthly AI insights (C: Sonnet) ─────────────────────────────────────────
async function getMonthlyAIInsights(monthData, memory = []) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return '• (AI ไม่พร้อมใช้งาน)'
  const top5Lines = monthData.top5.map(m => {
    const tag = m.margin >= 35 ? '✅ Push' : m.margin < 25 ? '🔴 ตรวจต้นทุน' : '🟡 ระวัง'
    return `  • ${m.name}: ×${m.qty} | Margin ${m.margin.toFixed(1)}% ${tag}`
  }).join('\n')
  const platLines = Object.entries(monthData.thisByPlatform)
    .sort((a, b) => b[1].sales - a[1].sales)
    .map(([plat, d]) => {
      const last    = monthData.lastByPlatform[plat]
      const growth  = last?.sales > 0 ? ((d.sales - last.sales) / last.sales * 100).toFixed(1) : null
      const pct     = monthData.thisSales > 0 ? (d.sales / monthData.thisSales * 100).toFixed(1) : 0
      return `  • ${plat}: ฿${fmt(d.sales)} (${pct}%)${growth !== null ? `  ${Number(growth) >= 0 ? '↑' : '↓'}${Math.abs(growth)}% vs เดือนก่อน` : ' (ใหม่)'}`
    }).join('\n')
  const aovChange = monthData.lastAOV > 0
    ? ((monthData.thisAOV - monthData.lastAOV) / monthData.lastAOV * 100).toFixed(1)
    : null
  const aovLine = `฿${monthData.thisAOV.toFixed(0)}/ออเดอร์  (เดือนก่อน ฿${monthData.lastAOV.toFixed(0)}${aovChange !== null ? ` | ${Number(aovChange) >= 0 ? '↑' : '↓'}${Math.abs(aovChange)}%` : ''})`
  const memoryBlock = buildMemoryContext(memory, 'monthly')
  const prompt = `คุณคือ CMO+CFO ร้าน Cocoa House — สรุปเดือนที่ผ่านมาและวางกลยุทธ์การตลาดเดือนหน้า${memoryBlock}
═══ ผลรวม ${monthData.monthName} ═══
ยอดขายรวม    ฿${fmt(monthData.thisSales)}  (เดือนก่อน ฿${fmt(monthData.lastSales)})
Net Profit    ${fmtPct(monthData.thisNetProfitPct)}  (เดือนก่อน ${fmtPct(monthData.lastNetProfitPct)})  [เป้า >20%]
Marketing Fee ${fmtPct(monthData.thisMktFeePct)}  (เดือนก่อน ${fmtPct(monthData.lastMktFeePct)})  [เป้า ≤20%]
จำนวนออเดอร์  ${monthData.thisOrderCount} ออเดอร์  (เดือนก่อน ${monthData.lastOrderCount} ออเดอร์)
AOV ต่อออเดอร์ ${aovLine}

ยอดขายแยก Platform:
${platLines || 'ไม่มีข้อมูล'}

Top 5 เมนู + Margin:
${top5Lines || 'ไม่มีข้อมูล'}

═══ วิเคราะห์ 5 ข้อ ═══
ข้อ 1 — สรุปภาพรวม: ยอดขายโตหรือหด Marketing Fee คุ้มไหม เทียบเป้า (อ้างอิง memory ถ้ามี)
ข้อ 2 — Platform Strategy: Platform ไหนเติบโต/หด ควรเพิ่ม/ลดงบ ปรับราคาบน Platform ใด
ข้อ 3 — AOV & Pricing: AOV เพิ่ม/ลด — แนะนำ pricing เมนูที่ควรปรับ (ขึ้น/ลง ฿เท่าไหร่) และ bundle ที่เพิ่ม AOV ได้จริง
ข้อ 4 — Menu Optimization: เมนู margin สูงที่ควร push หนัก เมนูที่ควรปรับต้นทุนหรือตัดออก พร้อมเหตุผลจากตัวเลข
ข้อ 5 — กลยุทธ์เดือนหน้า: 1 แผนหลักพร้อม KPI วัดได้ (ยอดขาย ฿X / Profit Y% / AOV ฿Z) และขั้นตอนที่ทำได้จริง

กฎ: ภาษาไทย ตรงๆ ระบุตัวเลขจริงทุกข้อ แต่ละข้อขึ้นต้น "• " ขึ้นบรรทัดใหม่ ห้ามพูดกว้างๆ`
  const ai  = new Anthropic({ apiKey })
  const msg = await ai.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  })
  return msg.content[0]?.text ?? '• ไม่สามารถวิเคราะห์ได้'
}

// ─── Weekly Flex Message ──────────────────────────────────────────────────────
function buildWeeklyFlexMessage(monday, sunday, weekData, aiText) {
  const salesDelta = weekData.lastSales > 0
    ? ((weekData.thisSales - weekData.lastSales) / weekData.lastSales * 100)
    : null
  const deltaText  = salesDelta !== null
    ? (salesDelta >= 0 ? `↑${salesDelta.toFixed(1)}%` : `↓${Math.abs(salesDelta).toFixed(1)}%`)
    : '—'
  const deltaColor = salesDelta >= 0 ? '#16A34A' : '#DC2626'
  const topItems = Object.values(weekData.thisAgg).sort((a, b) => b.qty - a.qty).slice(0, 5)
  const aiLines  = aiText.split('\n').filter(l => l.trim()).map(line => ({
    type: 'text', text: line.trim(), size: 'sm', color: '#374151', wrap: true, margin: 'xs',
  }))
  return {
    type: 'flex', altText: `Cocoa House สรุปสัปดาห์ ${monday} ถึง ${sunday}`,
    contents: {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: '#1E3A5F',
        contents: [
          { type: 'text', text: '📊 Weekly Report', weight: 'bold', color: '#FFFFFF', size: 'lg' },
          { type: 'text', text: `สัปดาห์ ${thaiDate(monday)} – ${thaiDate(sunday)}`, size: 'xs', color: '#93C5FD', margin: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'none',
        contents: [
          // ยอดสัปดาห์
          { type: 'box', layout: 'horizontal', spacing: 'md',
            contents: [
              { type: 'box', layout: 'vertical', flex: 1, backgroundColor: '#F9FAFB', cornerRadius: '10px', paddingAll: '12px',
                contents: [
                  { type: 'text', text: 'สัปดาห์นี้', size: 'xs', color: '#6B7280' },
                  { type: 'text', text: `฿${fmt(weekData.thisSales)}`, size: 'xl', weight: 'bold', color: '#111827', margin: 'xs' },
                  { type: 'text', text: deltaText, size: 'xs', color: deltaColor, margin: 'xs' },
                ],
              },
              { type: 'box', layout: 'vertical', flex: 1, backgroundColor: '#F9FAFB', cornerRadius: '10px', paddingAll: '12px',
                contents: [
                  { type: 'text', text: 'สัปดาห์ก่อน', size: 'xs', color: '#6B7280' },
                  { type: 'text', text: `฿${fmt(weekData.lastSales)}`, size: 'xl', weight: 'bold', color: '#6B7280', margin: 'xs' },
                  { type: 'text', text: ' ', size: 'xs', color: '#9CA3AF', margin: 'xs' },
                ],
              },
            ],
          },
          // top เมนู + margin
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '📈 เมนูและ Margin สัปดาห์นี้', weight: 'bold', size: 'sm', color: '#374151', margin: 'md' },
          ...topItems.map(m => {
            const last     = Object.values(weekData.lastAgg).find(x => x.name === m.name)
            const qtyDelta = last ? ((m.qty - last.qty) / (last.qty || 1) * 100).toFixed(0) : null
            const isHigh   = m.margin >= 35, isLow = m.margin < 25
            return {
              type: 'box', layout: 'horizontal', margin: 'sm',
              contents: [
                { type: 'text', text: m.name, size: 'sm', color: '#111827', flex: 5 },
                { type: 'text', text: `×${m.qty}${qtyDelta !== null ? (Number(qtyDelta) >= 0 ? ` ↑${qtyDelta}%` : ` ↓${Math.abs(qtyDelta)}%`) : ''}`,
                  size: 'xs', color: qtyDelta !== null ? (Number(qtyDelta) >= 0 ? '#16A34A' : '#DC2626') : '#6B7280', flex: 3, align: 'end' },
                { type: 'text', text: `${m.margin.toFixed(0)}%`, size: 'xs',
                  color: isHigh ? '#16A34A' : isLow ? '#DC2626' : '#D97706', flex: 2, align: 'end' },
              ],
            }
          }),
          // AI
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '🤖 AI สรุปและแผนสัปดาห์หน้า', weight: 'bold', size: 'sm', color: '#374151', margin: 'md' },
          ...aiLines,
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px', backgroundColor: '#F9FAFB',
        contents: [{
          type: 'button',
          action: { type: 'uri', label: 'เปิด Dashboard', uri: 'https://cocoa-house.vercel.app' },
          style: 'secondary', height: 'sm', color: '#3B82F6',
        }],
      },
    },
  }
}

// ─── Monthly Flex Message ─────────────────────────────────────────────────────
function buildMonthlyFlexMessage(monthData, aiText) {
  const salesDelta = monthData.lastSales > 0
    ? ((monthData.thisSales - monthData.lastSales) / monthData.lastSales * 100) : null
  const profitDelta = (monthData.thisNetProfitPct - monthData.lastNetProfitPct).toFixed(1)
  const mktFeeDelta = (monthData.thisMktFeePct - monthData.lastMktFeePct).toFixed(1)
  const platEntries = Object.entries(monthData.thisByPlatform).sort((a, b) => b[1].sales - a[1].sales)
  const aovDelta    = monthData.lastAOV > 0
    ? ((monthData.thisAOV - monthData.lastAOV) / monthData.lastAOV * 100) : null
  const aovDeltaTxt = aovDelta !== null
    ? (aovDelta >= 0 ? `↑${aovDelta.toFixed(1)}%` : `↓${Math.abs(aovDelta).toFixed(1)}%`)
    : '—'
  const aovColor    = aovDelta === null ? '#6B7280' : aovDelta >= 0 ? '#16A34A' : '#DC2626'
  const aiLines = aiText.split('\n').filter(l => l.trim()).map(line => ({
    type: 'text', text: line.trim(), size: 'sm', color: '#374151', wrap: true, margin: 'xs',
  }))
  return {
    type: 'flex', altText: `Cocoa House สรุปประจำเดือน ${monthData.monthName}`,
    contents: {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: '#4C1D95',
        contents: [
          { type: 'text', text: '📆 Monthly Report', weight: 'bold', color: '#FFFFFF', size: 'lg' },
          { type: 'text', text: monthData.monthName, size: 'xs', color: '#C4B5FD', margin: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'none',
        contents: [
          // 3 KPI cards
          { type: 'box', layout: 'horizontal', spacing: 'sm',
            contents: [
              { type: 'box', layout: 'vertical', flex: 1, backgroundColor: '#F9FAFB', cornerRadius: '10px', paddingAll: '10px',
                contents: [
                  { type: 'text', text: 'ยอดขาย', size: 'xxs', color: '#6B7280' },
                  { type: 'text', text: `฿${fmt(monthData.thisSales)}`, size: 'sm', weight: 'bold', color: '#111827', margin: 'xs' },
                  { type: 'text', text: salesDelta !== null ? (salesDelta >= 0 ? `↑${salesDelta.toFixed(1)}%` : `↓${Math.abs(salesDelta).toFixed(1)}%`) : '—',
                    size: 'xxs', color: salesDelta >= 0 ? '#16A34A' : '#DC2626', margin: 'xs' },
                ],
              },
              { type: 'box', layout: 'vertical', flex: 1,
                backgroundColor: monthData.thisNetProfitPct >= 20 ? '#F0FDF4' : '#FEF2F2',
                cornerRadius: '10px', paddingAll: '10px',
                contents: [
                  { type: 'text', text: 'Net Profit', size: 'xxs', color: '#6B7280' },
                  { type: 'text', text: fmtPct(monthData.thisNetProfitPct), size: 'sm', weight: 'bold',
                    color: monthData.thisNetProfitPct >= 20 ? '#166534' : '#7F1D1D', margin: 'xs' },
                  { type: 'text', text: `${Number(profitDelta) >= 0 ? '↑' : '↓'}${Math.abs(profitDelta)}pp`,
                    size: 'xxs', color: Number(profitDelta) >= 0 ? '#16A34A' : '#DC2626', margin: 'xs' },
                ],
              },
              { type: 'box', layout: 'vertical', flex: 1,
                backgroundColor: monthData.thisMktFeePct <= 20 ? '#F0FDF4' : '#FEF2F2',
                cornerRadius: '10px', paddingAll: '10px',
                contents: [
                  { type: 'text', text: 'Mkt Fee', size: 'xxs', color: '#6B7280' },
                  { type: 'text', text: fmtPct(monthData.thisMktFeePct), size: 'sm', weight: 'bold',
                    color: monthData.thisMktFeePct <= 20 ? '#166534' : '#7F1D1D', margin: 'xs' },
                  { type: 'text', text: `${Number(mktFeeDelta) >= 0 ? '↑' : '↓'}${Math.abs(mktFeeDelta)}pp`,
                    size: 'xxs', color: Number(mktFeeDelta) <= 0 ? '#16A34A' : '#DC2626', margin: 'xs' },
                ],
              },
            ],
          },
          // AOV row
          { type: 'box', layout: 'horizontal', margin: 'md', paddingAll: '10px',
            backgroundColor: '#F8F5FF', cornerRadius: '8px',
            contents: [
              { type: 'box', layout: 'vertical', flex: 3,
                contents: [
                  { type: 'text', text: '🛒 AOV ต่อออเดอร์', size: 'xs', color: '#6B7280' },
                  { type: 'text', text: `฿${monthData.thisAOV.toFixed(0)}`, size: 'md', weight: 'bold', color: '#111827', margin: 'xs' },
                  { type: 'text', text: `${monthData.thisOrderCount} ออเดอร์รวม`, size: 'xxs', color: '#9CA3AF', margin: 'xs' },
                ],
              },
              { type: 'box', layout: 'vertical', flex: 2, alignItems: 'flex-end',
                contents: [
                  { type: 'text', text: 'เดือนก่อน', size: 'xxs', color: '#9CA3AF', align: 'end' },
                  { type: 'text', text: `฿${monthData.lastAOV.toFixed(0)}`, size: 'sm', color: '#6B7280', margin: 'xs', align: 'end' },
                  { type: 'text', text: aovDeltaTxt, size: 'xs', color: aovColor, margin: 'xs', align: 'end' },
                ],
              },
            ],
          },
          // Platform breakdown
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '📊 ยอดขายแยก Platform', weight: 'bold', size: 'sm', color: '#374151', margin: 'md' },
          ...platEntries.map(([plat, d]) => {
            const last     = monthData.lastByPlatform[plat]
            const growth   = last?.sales > 0 ? (d.sales - last.sales) / last.sales * 100 : null
            const pct      = monthData.thisSales > 0 ? d.sales / monthData.thisSales * 100 : 0
            const growthTxt = growth !== null
              ? (growth >= 0 ? `↑${growth.toFixed(1)}%` : `↓${Math.abs(growth).toFixed(1)}%`)
              : 'ใหม่'
            const growthColor = growth === null ? '#6B7280' : growth >= 0 ? '#16A34A' : '#DC2626'
            return {
              type: 'box', layout: 'horizontal', margin: 'sm',
              contents: [
                { type: 'text', text: plat, size: 'sm', color: '#111827', flex: 4 },
                { type: 'text', text: `฿${fmt(d.sales)}`, size: 'sm', color: '#374151', flex: 4, align: 'end' },
                { type: 'text', text: `${pct.toFixed(0)}%`, size: 'xs', color: '#9CA3AF', flex: 2, align: 'end' },
                { type: 'text', text: growthTxt, size: 'xs', color: growthColor, flex: 3, align: 'end' },
              ],
            }
          }),
          // top 5 เมนู
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '🏆 Top 5 เมนูประจำเดือน', weight: 'bold', size: 'sm', color: '#374151', margin: 'md' },
          ...monthData.top5.map((m, i) => {
            const isHigh = m.margin >= 35, isLow = m.margin < 25
            return {
              type: 'box', layout: 'horizontal', margin: 'sm',
              contents: [
                { type: 'text', text: `${i+1}.`, size: 'sm', color: '#9CA3AF', flex: 1 },
                { type: 'text', text: m.name, size: 'sm', color: '#111827', flex: 5 },
                { type: 'text', text: `×${m.qty}`, size: 'xs', color: '#4B5563', flex: 2, align: 'end' },
                { type: 'text', text: `${m.margin.toFixed(0)}%`, size: 'xs',
                  color: isHigh ? '#16A34A' : isLow ? '#DC2626' : '#D97706', flex: 2, align: 'end' },
              ],
            }
          }),
          // AI
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '🤖 AI สรุปและแผนเดือนหน้า', weight: 'bold', size: 'sm', color: '#374151', margin: 'md' },
          ...aiLines,
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px', backgroundColor: '#F9FAFB',
        contents: [{
          type: 'button',
          action: { type: 'uri', label: 'เปิด Dashboard', uri: 'https://cocoa-house.vercel.app' },
          style: 'secondary', height: 'sm', color: '#7C3AED',
        }],
      },
    },
  }
}

// ─── Send LINE ────────────────────────────────────────────────────────────────
async function sendLine(message) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { Authorization: `Bearer ${LINE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: LINE_USER, messages: [message] }),
  })
  if (!res.ok) throw new Error(`LINE API error: ${await res.text()}`)
}

// ─── Main runner ──────────────────────────────────────────────────────────────
async function runReport(targetDate, isManual = false) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !LINE_TOKEN || !LINE_USER) {
    throw new Error('Missing required env vars (SUPABASE_URL, SUPABASE_SERVICE_KEY, LINE_CHANNEL_ACCESS_TOKEN, LINE_ADMIN_USER_ID)')
  }

  const lastWeekSame = offsetDate(targetDate, -7)
  const [todayData, lastWeekData, weeklyData, monthlyData, memory, trend, baseline] = await Promise.all([
    fetchMetrics(targetDate),
    fetchMetrics(lastWeekSame).catch(() => null),
    fetchWeeklyMetrics(targetDate).catch(() => null),
    fetchMonthlyMetrics(targetDate).catch(() => null),
    fetchAIMemory('daily', 5),
    fetch4WeekTrend(targetDate).catch(() => []),
    fetchDayOfWeekBaseline(targetDate).catch(() => null),
  ])

  // เช็คว่าร้านปิดวันนี้ไหม
  const closed = await isClosedDay(targetDate)
  if (closed) {
    console.log(`[AI Reporter] Shop closed on ${targetDate} — skip`)
    return { skipped: true, reason: 'closed' }
  }

  if (todayData.orderCount === 0 && !isManual) {
    console.log(`[AI Reporter] No orders for ${targetDate} — skip`)
    return { skipped: true, reason: 'no orders' }
  }

  // D: เขียน outcome ให้เมื่อวาน
  const yesterday = offsetDate(targetDate, -1)
  const yesterdayMemory = memory.find(m => m.report_date === yesterday) ?? null
  const outcomeText = buildOutcomeText(todayData, yesterdayMemory)
  if (outcomeText) await saveOutcome(yesterday, outcomeText)

  const aiText = await getAIInsights(targetDate, todayData, lastWeekData, weeklyData, memory, trend, baseline)
  const flex   = buildFlexMessage(targetDate, todayData, lastWeekData, weeklyData, monthlyData, aiText)
  await sendLine(flex)
  // บันทึก memory สำหรับวันนี้
  await saveAIMemory('daily', targetDate, aiText, {
    totalSales:      todayData.totalSales,
    netProfitPct:    todayData.netProfitPct,
    marketingFeePct: todayData.marketingFeePct,
    orderCount:      todayData.orderCount,
  })
  console.log(`[AI Reporter] Sent report for ${targetDate}`)
  return { ok: true, date: targetDate }
}

// ─── Weekly runner ────────────────────────────────────────────────────────────
export async function runWeeklyReport() {
  if (!SUPABASE_URL || !SUPABASE_KEY || !LINE_TOKEN || !LINE_USER)
    throw new Error('Missing required env vars')
  const today  = thaiDateStr(0)
  const monday = getMondayOf(today)
  const sunday = offsetDate(monday, 6)
  const [weekData, memory] = await Promise.all([
    fetchWeeklyMenuMetrics(monday, sunday),
    fetchAIMemory('weekly', 4),
  ])
  const aiText = await getWeeklyAIInsights(weekData, monday, sunday, memory)
  const flex   = buildWeeklyFlexMessage(monday, sunday, weekData, aiText)
  await sendLine(flex)
  await saveAIMemory('weekly', monday, aiText, {
    thisSales: weekData.thisSales, lastSales: weekData.lastSales,
  })
  console.log(`[Weekly Report] Sent for ${monday} – ${sunday}`)
  return { ok: true, type: 'weekly', monday, sunday }
}

// ─── Monthly runner ───────────────────────────────────────────────────────────
export async function runMonthlyReport() {
  if (!SUPABASE_URL || !SUPABASE_KEY || !LINE_TOKEN || !LINE_USER)
    throw new Error('Missing required env vars')
  const today = thaiDateStr(0)
  // รายงานสรุปเดือนที่ผ่านมา (วันที่ 1 = วันนี้ → สรุปเดือนก่อน)
  const d = new Date(today + 'T12:00:00')
  let year = d.getFullYear(), month = d.getMonth() + 1  // เดือนปัจจุบัน
  // ถ้ารันวันที่ 1 → สรุปเดือนที่แล้ว
  if (d.getDate() === 1) { month -= 1; if (month === 0) { month = 12; year -= 1 } }
  const [monthData, memory] = await Promise.all([
    fetchMonthlyMenuMetrics(year, month),
    fetchAIMemory('monthly', 4),
  ])
  const aiText = await getMonthlyAIInsights(monthData, memory)
  const flex   = buildMonthlyFlexMessage(monthData, aiText)
  await sendLine(flex)
  const reportDate = `${year}-${String(month).padStart(2, '0')}-01`
  await saveAIMemory('monthly', reportDate, aiText, {
    thisSales:        monthData.thisSales,
    lastSales:        monthData.lastSales,
    netProfitPct:     monthData.thisNetProfitPct,
    marketingFeePct:  monthData.thisMktFeePct,
    orderCount:       monthData.thisOrderCount,
    aov:              monthData.thisAOV,
  })
  console.log(`[Monthly Report] Sent for ${year}-${month}`)
  return { ok: true, type: 'monthly', year, month }
}

// ─── Vercel Handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // GET = Vercel Cron trigger — ดูจาก header x-report-type ที่ vercel.json ส่งมา
  if (req.method === 'GET') {
    const reportType = req.headers['x-report-type'] ?? 'daily'

    if (reportType === 'weekly') {
      try {
        const result = await runWeeklyReport()
        return res.status(200).json(result)
      } catch (err) {
        console.error('[Weekly Cron]', err.message)
        return res.status(500).json({ error: err.message })
      }
    }

    if (reportType === 'monthly') {
      try {
        const result = await runMonthlyReport()
        return res.status(200).json(result)
      } catch (err) {
        console.error('[Monthly Cron]', err.message)
        return res.status(500).json({ error: err.message })
      }
    }

    // daily (default)
    if (await alreadySentToday()) {
      return res.status(200).json({ ok: true, skipped: 'already sent today' })
    }
    const yesterday = thaiDateStr(-1)
    try {
      const result = await runReport(yesterday, false)
      await markSentToday()
      return res.status(200).json(result)
    } catch (err) {
      console.error('[Daily Cron]', err.message)
      return res.status(500).json({ error: err.message })
    }
  }

  // POST = Manual trigger from web app
  if (req.method === 'POST') {
    const { date, type } = req.body ?? {}
    if (type === 'weekly') {
      try { return res.status(200).json(await runWeeklyReport()) }
      catch (err) { return res.status(500).json({ error: err.message }) }
    }
    if (type === 'monthly') {
      try { return res.status(200).json(await runMonthlyReport()) }
      catch (err) { return res.status(500).json({ error: err.message }) }
    }
    // mark a day as closed
    if (type === 'close_day') {
      const closeDate = req.body?.date
      const reason    = req.body?.reason ?? 'ร้านปิด'
      if (!closeDate || !/^\d{4}-\d{2}-\d{2}$/.test(closeDate))
        return res.status(400).json({ error: 'date required' })
      try {
        await markClosedDay(closeDate, reason)
        return res.status(200).json({ ok: true, date: closeDate, reason })
      } catch (err) { return res.status(500).json({ error: err.message }) }
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date required (YYYY-MM-DD)' })
    }
    try {
      const result = await runReport(date, true)
      return res.status(200).json(result)
    } catch (err) {
      console.error('[Manual Trigger]', err.message)
      return res.status(500).json({ error: err.message })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
