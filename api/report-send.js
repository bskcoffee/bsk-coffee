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
      menuAgg[mId].qty += qty; menuAgg[mId].sales += qty * price
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
  const top3          = Object.values(menuAgg).sort((a, b) => b.qty - a.qty).slice(0, 3)

  return { totalSales, grossSales, menuDiscount, totalPlatFee, platFeeRate,
           matCost, laborCost, netProfit, netProfitPct, orderCount: orders.length,
           top3, catQty, platSales }
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

  const platLines = Object.entries(today.platSales ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([plat, sales]) => {
      const lastSales = lastWeek?.platSales?.[plat]
      const vsStr = lastSales > 0
        ? ` (${((sales - lastSales) / lastSales * 100).toFixed(1)}% vs 7 วันก่อน)`
        : ''
      return `  • ${plat}: ฿${fmt(sales)}${vsStr}`
    }).join('\n')

  const prompt = `คุณเป็นที่ปรึกษาธุรกิจร้านเครื่องดื่มไทย วิเคราะห์ข้อมูลยอดขาย Cocoa House

ข้อมูลเมื่อวาน:
- ยอดขายรวม: ฿${fmt(today.totalSales)} (${vsDay})
- ยอดขายแยก Platform:
${platLines || '  • ไม่มีข้อมูล'}
- Platform Fee: ฿${fmt(today.totalPlatFee)} (${fmtPct(today.platFeeRate)}${lastWeek ? `, ${(today.platFeeRate - lastWeek.platFeeRate).toFixed(1)}pp vs 7 วันก่อน` : ''})
- Mat Cost: ฿${fmt(today.matCost)}
- Labor Cost: ฿${fmt(today.laborCost)}
- Net Profit: ${fmtPct(today.netProfitPct)}${lastWeek ? ` (${(today.netProfitPct - lastWeek.netProfitPct).toFixed(1)}pp vs 7 วันก่อน)` : ''}
- จำนวนออเดอร์: ${today.orderCount}
- Top 3 เมนู: ${today.top3.map(m => `${m.name} (${m.qty} รายการ)`).join(', ')}

ยอดขายสัปดาห์นี้ (${weekly?.dayCount ?? 1} วัน): ฿${fmt(weekly?.thisWeekSales)} (${vsWeek})

เขียนวิเคราะห์ 2-4 ข้อสั้นๆ แต่ละข้อไม่เกิน 2 ประโยค
- วิเคราะห์ platform ไหนดีขึ้น/ลงอย่างเห็นได้ชัด (ถ้ามีข้อมูลเปรียบเทียบ)
- ถ้า Net Profit ติดลบหรือต่ำกว่า 10% ให้แจ้งเตือนและระบุสาเหตุที่น่าจะเป็น
- เน้นสิ่งที่น่าสนใจหรือควรระวังอื่นๆ
ตอบเป็นภาษาไทยเท่านั้น ไม่ต้องมีหัวข้อหรือ markdown แต่ละข้อขึ้นต้นด้วย "• "`

  const ai  = new Anthropic({ apiKey })
  const msg = await ai.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  })
  return msg.content[0]?.text ?? '• ไม่สามารถวิเคราะห์ได้ในขณะนี้'
}

// ─── LINE Flex Message ────────────────────────────────────────────────────────
function buildFlexMessage(dateStr, today, lastWeek, weekly, aiText) {
  const salesBadge  = changeBadge(today.totalSales,   lastWeek?.totalSales)
  const feeBadge    = feeRateChangeBadge(today.platFeeRate, lastWeek?.platFeeRate)
  const matBadge    = changeBadge(today.matCost,       lastWeek?.matCost)
  const laborBadge  = changeBadge(today.laborCost,     lastWeek?.laborCost)
  const profitBadge = netProfitChangeBadge(today.netProfitPct, lastWeek?.netProfitPct)
  const wkBadge     = weeklyChangeBadge(weekly?.thisWeekSales, weekly?.lastWeekSales)

  const metricRow = (label, value, badge) => ({
    type: 'box', layout: 'horizontal', margin: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm',  color: '#6B7280', flex: 3 },
      { type: 'text', text: value, size: 'sm',  color: '#111827', weight: 'bold', flex: 3, align: 'end' },
      { type: 'text', text: badge.text, size: 'xs', color: badge.color, flex: 4, align: 'end' },
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
          { type: 'text', text: m.name,       size: 'sm', color: '#111827', flex: 5 },
          { type: 'text', text: `× ${m.qty}`, size: 'sm', color: '#4B5563', flex: 2, align: 'end' },
        ],
      }))
    : [{ type: 'text', text: 'ไม่มีออเดอร์', size: 'sm', color: '#9CA3AF' }]

  const wkLabel = weekly
    ? `${shortDay(weekly.weekStart)}–${shortDay(weekly.weekEnd)} ${weekly.dayCount} วัน` : '—'

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
          { type: 'text', text: '📊 ยอดขายเมื่อวาน', weight: 'bold', size: 'sm', color: '#374151' },
          { type: 'separator', margin: 'sm' },
          metricRow('ยอดขายรวม',    `฿${fmt(today.totalSales)}`, salesBadge),
          metricRow('Platform Fee', `฿${fmt(today.totalPlatFee)} (${fmtPct(today.platFeeRate)})`, feeBadge),
          metricRow('Mat Cost',     `฿${fmt(today.matCost)}`,    matBadge),
          metricRow('Labor Cost',   `฿${fmt(today.laborCost)}`,  laborBadge),
          metricRow('Net Profit%',  fmtPct(today.netProfitPct),  profitBadge),
          { type: 'separator', margin: 'md' },
          { type: 'box', layout: 'horizontal', margin: 'md',
            contents: [
              { type: 'text', text: '📅 ยอดรายสัปดาห์', size: 'sm', weight: 'bold', color: '#374151', flex: 1 },
              { type: 'text', text: wkLabel, size: 'xs', color: '#9CA3AF', align: 'end' },
            ],
          },
          { type: 'box', layout: 'horizontal', margin: 'sm',
            contents: [
              { type: 'text', text: 'ยอดสะสม', size: 'sm', color: '#6B7280', flex: 3 },
              { type: 'text', text: `฿${fmt(weekly?.thisWeekSales ?? 0)}`, size: 'sm', color: '#111827', weight: 'bold', flex: 3, align: 'end' },
              { type: 'text', text: wkBadge.text, size: 'xs', color: wkBadge.color, flex: 4, align: 'end' },
            ],
          },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '🏆 Top เมนูขายดี', weight: 'bold', size: 'sm', color: '#374151', margin: 'md' },
          ...top3Items,
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '📦 ยอดตามประเภท', weight: 'bold', size: 'sm', color: '#374151', margin: 'md' },
          {
            type: 'box', layout: 'horizontal', margin: 'sm', spacing: 'sm',
            contents: [
              { type: 'box', layout: 'vertical', flex: 1, backgroundColor: '#FFF3ED', cornerRadius: '8px', paddingAll: '8px',
                contents: [
                  { type: 'text', text: '🧋', size: 'sm', align: 'center' },
                  { type: 'text', text: String(today.catQty?.beverage ?? 0), size: 'lg', weight: 'bold', color: '#92400E', align: 'center' },
                  { type: 'text', text: 'Beverage', size: 'xxs', color: '#92400E', align: 'center' },
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
  const [todayData, lastWeekData, weeklyData] = await Promise.all([
    fetchMetrics(targetDate),
    fetchMetrics(lastWeekSame).catch(() => null),
    fetchWeeklyMetrics(targetDate).catch(() => null),
  ])

  if (todayData.orderCount === 0 && !isManual) {
    console.log(`[AI Reporter] No orders for ${targetDate} — skip`)
    return { skipped: true, reason: 'no orders' }
  }

  const aiText = await getAIInsights(todayData, lastWeekData, weeklyData)
  const flex   = buildFlexMessage(targetDate, todayData, lastWeekData, weeklyData, aiText)
  await sendLine(flex)
  console.log(`[AI Reporter] Sent report for ${targetDate}`)
  return { ok: true, date: targetDate }
}

// ─── Vercel Handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // GET = Vercel Cron trigger
  if (req.method === 'GET') {
    if (await alreadySentToday()) {
      return res.status(200).json({ ok: true, skipped: 'already sent today' })
    }
    const yesterday = thaiDateStr(-1)
    try {
      const result = await runReport(yesterday, false)
      await markSentToday()
      return res.status(200).json(result)
    } catch (err) {
      console.error('[AI Reporter Cron]', err.message)
      return res.status(500).json({ error: err.message })
    }
  }

  // POST = Manual trigger from web app
  if (req.method === 'POST') {
    const { date } = req.body ?? {}
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date required (YYYY-MM-DD)' })
    }
    try {
      const result = await runReport(date, true)
      return res.status(200).json(result)
    } catch (err) {
      console.error('[AI Reporter Manual]', err.message)
      return res.status(500).json({ error: err.message })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
