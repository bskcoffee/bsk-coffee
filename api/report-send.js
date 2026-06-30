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
async function fetchMetrics(dateStr) {
  const [orders, platCosts, costRows] = await Promise.all([
    sb('orders', `?date=eq.${dateStr}&status=eq.delivered&select=id,platform,order_items(quantity,unit_price,unit_gp_cost,menu_id,menus(name,category))`),
    sb('platform_costs', `?date=eq.${dateStr}&select=*`),
    sb('cost_settings', `?effective_from=lte.${dateStr}&select=key,value,effective_from&order=effective_from.desc`),
  ])

  const cs = {}
  for (const row of costRows) if (!(row.key in cs)) cs[row.key] = Number(row.value)

  const platConfigRaw = await getSetting('platform_config')
  const platConfig    = platConfigRaw ? JSON.parse(platConfigRaw) : []
  const feeMap = {}
  for (const p of platConfig) feeMap[(p.name ?? '').toUpperCase()] = Number(p.fee ?? 0)

  const BEV_CATS = ['Cocoa', 'Coffee', 'Matcha', 'Classic', 'Hot']
  let totalSales = 0, totalGpCost = 0
  const menuAgg = {}, platSales = {}, catQty = { beverage: 0, bread: 0, refill: 0, addon: 0 }

  for (const order of orders) {
    const plat = (order.platform ?? 'other').toUpperCase()
    for (const item of order.order_items ?? []) {
      const qty = Number(item.quantity ?? 0), price = Number(item.unit_price ?? 0)
      totalSales  += qty * price
      totalGpCost += qty * Number(item.unit_gp_cost ?? 0)
      platSales[plat] = (platSales[plat] ?? 0) + qty * price
      const cat = item.menus?.category ?? ''
      const mId = item.menu_id ?? 'unknown'
      if (!menuAgg[mId]) menuAgg[mId] = { name: item.menus?.name || mId, qty: 0, sales: 0 }
      if (!menuAgg[mId]) menuAgg[mId].gpCost = 0
      menuAgg[mId].qty += qty; menuAgg[mId].sales += qty * price
      menuAgg[mId].gpCost += qty * Number(item.unit_gp_cost ?? 0)
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
  const gpCostAdj      = totalGpCost * discountRatio
  let platFeeFromOrders = 0
  for (const [plat, sales] of Object.entries(platSales))
    platFeeFromOrders += (sales * discountRatio) * (feeMap[plat] ?? 0) / 100
  const totalPlatFee  = platFeeFromOrders + extraCosts
  const platFeeRate   = grossSales > 0 ? (totalPlatFee / grossSales) * 100 : 0
  const laborCost     = grossSales * (cs.labor_pct ?? 0) / 100
  const matCost       = Math.max(0, gpCostAdj - laborCost - platFeeFromOrders)
  const netProfit     = grossSales - gpCostAdj - extraCosts
  const netProfitPct  = grossSales > 0 ? (netProfit / grossSales) * 100 : 0
  // เพิ่ม margin% ต่อเมนู
  for (const m of Object.values(menuAgg)) {
    m.margin = m.sales > 0 ? ((m.sales - m.gpCost) / m.sales) * 100 : 0
  }
  const top3          = Object.values(menuAgg).sort((a, b) => b.qty - a.qty).slice(0, 3)

  // Marketing Fee = ต้นทุนโปรโมทที่ร้านแบกเอง (ไม่รวม GP commission ของ platform)
  // = menu_discount + campaign + marketing_fee + delivery_discount + advertisement
  const marketingFee    = menuDiscount + extraCosts
  const marketingFeePct = grossSales > 0 ? (marketingFee / grossSales) * 100 : 0

  // GP rate จริง (ถ้าต่ำกว่า 32.1% แสดงว่ามี 60/40 campaign หรือ direct sales เช่น Metro, TU)
  const gpRate = totalSales > 0 ? (platFeeFromOrders / totalSales) * 100 : 0

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

// ─── AI analysis ─────────────────────────────────────────────────────────────
async function getAIInsights(today, lastWeek, weekly) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return '• (AI วิเคราะห์ไม่พร้อมใช้งาน — ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY)'

  const vsDay  = lastWeek
    ? `${((today.totalSales - lastWeek.totalSales) / (lastWeek.totalSales || 1) * 100).toFixed(1)}% vs 7 วันก่อน`
    : 'ไม่มีข้อมูลเปรียบเทียบ'
  const vsWeek = weekly?.lastWeekSales > 0
    ? `${((weekly.thisWeekSales - weekly.lastWeekSales) / weekly.lastWeekSales * 100).toFixed(1)}% vs สัปดาห์ก่อน`
    : 'ไม่มีข้อมูลเปรียบเทียบ'

  // menu margin lines สำหรับ AI
  const menuMarginLines = today.top3.map(m => {
    const tag = m.margin >= 35 ? '✅ Push ได้' : m.margin >= 25 ? '🟡 ระวัง discount' : '🔴 ตรวจต้นทุน'
    return `  • ${m.name}: ×${m.qty} | Margin ${m.margin.toFixed(1)}% ${tag}`
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

  const matCostPct = today.grossSales > 0 ? (today.matCost / today.grossSales * 100) : 0

  // traffic light ตรวจเกณฑ์
  const checkProfit     = today.netProfitPct >= 20 ? '✅' : today.netProfitPct >= 15 ? '🟡' : '🔴'
  const checkMat        = matCostPct <= 30 ? '✅' : matCostPct <= 35 ? '🟡' : '🔴'
  const checkMarketing  = today.marketingFeePct <= 20 ? '✅' : today.marketingFeePct <= 25 ? '🟡' : '🔴'

  const profitDelta   = lastWeek ? (today.netProfitPct - lastWeek.netProfitPct).toFixed(1) : null
  const trendNote     = profitDelta
    ? (Number(profitDelta) > 0 ? `ดีขึ้น +${profitDelta}pp` : `แย่ลง ${profitDelta}pp`) + ' จาก 7 วันก่อน'
    : 'ไม่มีข้อมูลเปรียบเทียบ'

  const prompt = `คุณคือ CFO ส่วนตัวของร้าน Cocoa House (เครื่องดื่ม/เบเกอรี่ ขายผ่าน delivery platform)
หน้าที่: วิเคราะห์สุขภาพธุรกิจวันนี้ให้เจ้าของร้านอ่านเข้าใจใน 30 วินาที

═══ ข้อมูลประจำวัน ═══
ยอดขาย       ฿${fmt(today.totalSales)}  (${vsDay})
Net Profit    ฿${fmt(today.netProfit)} = ${fmtPct(today.netProfitPct)}  [เป้า >20%]  ${trendNote}
Mat Cost      ${fmtPct(matCostPct)}  [เป้า ≤30%]
Marketing Fee ${fmtPct(today.marketingFeePct)}  (menu discount + campaign + advert + delivery discount)  [เป้า ≤20%]
GP Rate       ${fmtPct(today.gpRate)}  [ปกติ 32.1% — ถ้าต่ำกว่านี้มาจาก 60/40 campaign หรือ direct sales เช่น Metro, TU]
Platform Mix  ${platLines || 'ไม่มีข้อมูล'}
ออเดอร์       ${today.orderCount} รายการ
Top menu + Margin:
${menuMarginLines || 'ไม่มีข้อมูล'}

═══ ผลตรวจเกณฑ์ ═══
${checkProfit}  Net Profit ${fmtPct(today.netProfitPct)}
${checkMat}  Mat Cost ${fmtPct(matCostPct)}
${checkMarketing}  Marketing Fee ${fmtPct(today.marketingFeePct)}
${today.gpRate < 30 ? '⚠️' : '✅'}  GP Rate ${fmtPct(today.gpRate)} ${today.gpRate < 30 ? '(ต่ำกว่าปกติ — ตรวจ 60/40 หรือ direct sales)' : '(ปกติ)'}

═══ วิเคราะห์ 3 ข้อ ═══
ข้อ 1 — "วันนี้เป็นอย่างไร": สรุปภาพรวมสุขภาพร้านในประโยคเดียว ระบุว่าผ่าน/ไม่ผ่านเกณฑ์ไหน
ข้อ 2 — "เพราะอะไร": หา root cause หลัก 1 อย่าง โดยดูความสัมพันธ์ระหว่าง Marketing Fee + GP Rate + mat cost + sales volume + platform mix อย่าพูดแค่อาการ ให้หาต้นตอ (ถ้า GP Rate ต่ำกว่า 32.1% ให้ระบุว่าอาจมาจาก 60/40 campaign หรือ direct sales Metro/TU)
ข้อ 3 — "ทำอะไรได้เลย": แนะนำ 1 action ที่ทำได้จริงภายใน 48 ชั่วโมง ระบุให้ชัดเจน (เช่น "ลด campaign LINE วันพฤหัส" ดีกว่า "ควรลดต้นทุน")
ข้อ 4 — "แคมเปญเมนู": ดู margin เมนูขายดี แล้วแนะนำ 1 ไอเดียแคมเปญที่เหมาะสม เช่น bundle เมนู margin สูง, ห้าม discount เมนู margin ต่ำ, ปรับราคาเมนูที่ขายดีแต่ margin ต่ำ

กฎ: ภาษาไทย พูดตรงๆ ไม่ใช้ศัพท์วิชาการ แต่ละข้อขึ้นต้นด้วย "• " ขึ้นบรรทัดใหม่ทุกข้อ`

  const ai  = new Anthropic({ apiKey })
  const msg = await ai.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 450,
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
                  { type: 'text', text: `Margin ${m.margin.toFixed(1)}%`, size: 'xs',
                    color: isHigh ? '#16A34A' : isLow ? '#DC2626' : '#D97706', margin: 'xs' },
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
    sb('orders', `?date=gte.${monthStart}&status=eq.delivered&select=order_items(quantity,unit_price,unit_gp_cost,menu_id,menus(name))`),
    sb('orders', `?date=gte.${lastMonth}&date=lte.${lastEnd}&status=eq.delivered&select=order_items(quantity,unit_price,unit_gp_cost,menu_id,menus(name))`),
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
  const thisSales   = sumSales(thisM);  const thisGpCost = sumGpCost(thisM)
  const lastSales   = sumSales(lastM);  const lastGpCost = sumGpCost(lastM)
  const thisMktFee  = sumMktFee(platCostsThis)
  const lastMktFee  = sumMktFee(platCostsLast)
  const thisNetProfit    = thisSales - thisGpCost - thisMktFee
  const thisNetProfitPct = thisSales > 0 ? thisNetProfit / thisSales * 100 : 0
  const lastNetProfitPct = lastSales > 0 ? (lastSales - lastGpCost - lastMktFee) / lastSales * 100 : 0
  const thisMktFeePct    = thisSales > 0 ? thisMktFee / thisSales * 100 : 0
  const lastMktFeePct    = lastSales > 0 ? lastMktFee / lastSales * 100 : 0
  const monthName = new Date(monthStart + 'T12:00:00').toLocaleDateString('th-TH', { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' })
  const top5 = Object.values(aggMenu(thisM)).sort((a, b) => b.qty - a.qty).slice(0, 5)
  return { thisSales, lastSales, thisNetProfit, thisNetProfitPct, lastNetProfitPct,
           thisMktFee, thisMktFeePct, lastMktFeePct, top5, monthName }
}

// ─── Weekly AI insights ───────────────────────────────────────────────────────
async function getWeeklyAIInsights(weekData, monday, sunday) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return '• (AI ไม่พร้อมใช้งาน)'
  const salesChange = weekData.lastSales > 0
    ? ((weekData.thisSales - weekData.lastSales) / weekData.lastSales * 100).toFixed(1)
    : null
  const topMenuLines = Object.values(weekData.thisAgg)
    .sort((a, b) => b.qty - a.qty).slice(0, 5)
    .map(m => {
      const last = weekData.lastAgg[Object.keys(weekData.lastAgg).find(k => weekData.lastAgg[k].name === m.name)]
      const vs   = last ? ` (${((m.qty - last.qty) / (last.qty || 1) * 100).toFixed(0)}% vs สัปดาห์ก่อน)` : ''
      const tag  = m.margin >= 35 ? '✅' : m.margin < 25 ? '🔴' : '🟡'
      return `  • ${m.name}: ×${m.qty}${vs} | Margin ${m.margin.toFixed(1)}% ${tag}`
    }).join('\n')
  const prompt = `คุณคือ CFO ร้าน Cocoa House — วิเคราะห์ผลประจำสัปดาห์ให้เจ้าของอ่านใน 30 วินาที

═══ ผลสัปดาห์ ${monday} ถึง ${sunday} ═══
ยอดขายสัปดาห์นี้  ฿${fmt(weekData.thisSales)}  ${salesChange ? `(${Number(salesChange) > 0 ? '↑' : '↓'}${Math.abs(salesChange)}% vs สัปดาห์ก่อน)` : ''}
ยอดขายสัปดาห์ก่อน ฿${fmt(weekData.lastSales)}

Top เมนู + Margin:
${topMenuLines || 'ไม่มีข้อมูล'}

═══ วิเคราะห์ 3 ข้อ ═══
ข้อ 1 — สัปดาห์นี้เป็นอย่างไร: สรุปภาพรวมในประโยคเดียว
ข้อ 2 — แคมเปญสัปดาห์ที่ผ่านมาได้ผลไหม: ดูจากยอดขายและ volume เมนู เปรียบเทียบกับสัปดาห์ก่อน
ข้อ 3 — แผนแคมเปญสัปดาห์หน้า: แนะนำ 1 ไอเดียที่เหมาะกับ margin เมนูที่เห็น (push เมนู margin สูง / ปรับราคา / bundle) ระบุให้ชัด

กฎ: ภาษาไทย ตรงๆ แต่ละข้อขึ้นต้น "• " ขึ้นบรรทัดใหม่`
  const ai  = new Anthropic({ apiKey })
  const msg = await ai.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  })
  return msg.content[0]?.text ?? '• ไม่สามารถวิเคราะห์ได้'
}

// ─── Monthly AI insights ──────────────────────────────────────────────────────
async function getMonthlyAIInsights(monthData) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return '• (AI ไม่พร้อมใช้งาน)'
  const top5Lines = monthData.top5.map(m => {
    const tag = m.margin >= 35 ? '✅ Push' : m.margin < 25 ? '🔴 ตรวจต้นทุน' : '🟡 ระวัง'
    return `  • ${m.name}: ×${m.qty} | Margin ${m.margin.toFixed(1)}% ${tag}`
  }).join('\n')
  const prompt = `คุณคือ CFO ร้าน Cocoa House — สรุปผลเดือนที่ผ่านมาและวางแผนเดือนหน้า

═══ ผลรวม ${monthData.monthName} ═══
ยอดขายรวม    ฿${fmt(monthData.thisSales)}  (เดือนก่อน ฿${fmt(monthData.lastSales)})
Net Profit    ${fmtPct(monthData.thisNetProfitPct)}  (เดือนก่อน ${fmtPct(monthData.lastNetProfitPct)})  [เป้า >20%]
Marketing Fee ${fmtPct(monthData.thisMktFeePct)}  (เดือนก่อน ${fmtPct(monthData.lastMktFeePct)})  [เป้า ≤20%]

Top 5 เมนู + Margin:
${top5Lines || 'ไม่มีข้อมูล'}

═══ วิเคราะห์ 3 ข้อ ═══
ข้อ 1 — สรุปเดือนที่ผ่านมา: Marketing Fee คุ้มไหม ยอดขายโตหรือหด เทียบเป้า
ข้อ 2 — เมนู Strategy: เมนู margin สูงขายดีพอไหม เมนูไหนควรตัด/ปรับราคา/ยกระดับ
ข้อ 3 — แผนเดือนหน้า: แนะนำ 1 กลยุทธ์หลัก (pricing / bundle / platform mix / ลด marketing fee) พร้อม target ที่วัดได้

กฎ: ภาษาไทย ตรงๆ แต่ละข้อขึ้นต้น "• " ขึ้นบรรทัดใหม่`
  const ai  = new Anthropic({ apiKey })
  const msg = await ai.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 450,
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
  const [todayData, lastWeekData, weeklyData, monthlyData] = await Promise.all([
    fetchMetrics(targetDate),
    fetchMetrics(lastWeekSame).catch(() => null),
    fetchWeeklyMetrics(targetDate).catch(() => null),
    fetchMonthlyMetrics(targetDate).catch(() => null),
  ])

  if (todayData.orderCount === 0 && !isManual) {
    console.log(`[AI Reporter] No orders for ${targetDate} — skip`)
    return { skipped: true, reason: 'no orders' }
  }

  const aiText = await getAIInsights(todayData, lastWeekData, weeklyData)
  const flex   = buildFlexMessage(targetDate, todayData, lastWeekData, weeklyData, monthlyData, aiText)
  await sendLine(flex)
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
  const weekData = await fetchWeeklyMenuMetrics(monday, sunday)
  const aiText   = await getWeeklyAIInsights(weekData, monday, sunday)
  const flex     = buildWeeklyFlexMessage(monday, sunday, weekData, aiText)
  await sendLine(flex)
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
  const monthData = await fetchMonthlyMenuMetrics(year, month)
  const aiText    = await getMonthlyAIInsights(monthData)
  const flex      = buildMonthlyFlexMessage(monthData, aiText)
  await sendLine(flex)
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
