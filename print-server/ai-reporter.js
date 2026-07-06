'use strict'
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '.env') })
const cron      = require('node-cron')
const axios     = require('axios')
const fs        = require('fs')
const Anthropic = require('@anthropic-ai/sdk')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const LINE_TOKEN   = process.env.LINE_CHANNEL_ACCESS_TOKEN
const LINE_USER    = process.env.LINE_ADMIN_USER_ID
const SENT_FILE    = path.join(__dirname, 'last_sent.json')

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Date helpers ─────────────────────────────────────────────────────────────
function localDateStr(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const y   = d.getFullYear()
  const m   = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function offsetDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysBetween(from, to) {
  const a = new Date(from + 'T12:00:00')
  const b = new Date(to   + 'T12:00:00')
  return Math.round((b - a) / 86400000)
}

function getMondayOf(dateStr) {
  const d   = new Date(dateStr + 'T12:00:00')
  const day = d.getDay()                        // 0=Sun, 1=Mon, …, 6=Sat
  const diff = day === 0 ? 6 : day - 1          // steps back to Monday
  d.setDate(d.getDate() - diff)
  return d.toISOString().slice(0, 10)
}

function thaiDate(dateStr) {
  const d      = new Date(dateStr + 'T12:00:00')
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
  const days   = ['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.']
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`
}

// Short day name for weekly label e.g. "จ.–พ."
function shortDay(dateStr) {
  const d    = new Date(dateStr + 'T12:00:00')
  const days = ['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.']
  return days[d.getDay()]
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmt(n) {
  return Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtPct(n) {
  return `${Number(n ?? 0).toFixed(1)}%`
}

// ─── Badge helpers ────────────────────────────────────────────────────────────
// ↑ = green (good), ↓ = red (bad) — for sales, mat cost, labor cost
function changeBadge(current, previous) {
  if (previous == null || previous === 0) return { text: '— vs 7 วันก่อน', color: '#9CA3AF' }
  const diff = ((current - previous) / Math.abs(previous)) * 100
  if (Math.abs(diff) < 0.5) return { text: '→ เท่าเดิม', color: '#9CA3AF' }
  return diff > 0
    ? { text: `↑ ${diff.toFixed(1)}% vs 7 วันก่อน`, color: '#16A34A' }
    : { text: `↓ ${Math.abs(diff).toFixed(1)}% vs 7 วันก่อน`, color: '#DC2626' }
}

// ↓ = green (good), ↑ = red (bad) — for platform fee rate
function feeRateChangeBadge(current, previous) {
  if (previous == null) return { text: '— vs 7 วันก่อน', color: '#9CA3AF' }
  const diff = current - previous
  if (Math.abs(diff) < 0.1) return { text: '→ เท่าเดิม', color: '#9CA3AF' }
  return diff < 0
    ? { text: `↓ ${Math.abs(diff).toFixed(1)}pp vs 7 วันก่อน`, color: '#16A34A' }
    : { text: `↑ ${diff.toFixed(1)}pp vs 7 วันก่อน`, color: '#DC2626' }
}

// ↑ = green (good), ↓ = red (bad) — for net profit % (pp comparison)
function netProfitChangeBadge(current, previous) {
  if (previous == null) return { text: '— vs 7 วันก่อน', color: '#9CA3AF' }
  const diff = current - previous
  if (Math.abs(diff) < 0.1) return { text: '→ เท่าเดิม', color: '#9CA3AF' }
  return diff > 0
    ? { text: `↑ ${diff.toFixed(1)}pp vs 7 วันก่อน`, color: '#16A34A' }
    : { text: `↓ ${Math.abs(diff).toFixed(1)}pp vs 7 วันก่อน`, color: '#DC2626' }
}

// ↑ = green, ↓ = red — for weekly sales % comparison
function weeklyChangeBadge(current, previous) {
  if (previous == null || previous === 0) return { text: '— vs สัปดาห์ก่อน', color: '#9CA3AF' }
  const diff = ((current - previous) / Math.abs(previous)) * 100
  if (Math.abs(diff) < 0.5) return { text: '→ เท่าเดิม', color: '#9CA3AF' }
  return diff > 0
    ? { text: `↑ ${diff.toFixed(1)}% vs สัปดาห์ก่อน`, color: '#16A34A' }
    : { text: `↓ ${Math.abs(diff).toFixed(1)}% vs สัปดาห์ก่อน`, color: '#DC2626' }
}

// ─── Supabase REST helpers ────────────────────────────────────────────────────
async function sb(table, qs = '') {
  const res = await axios.get(`${SUPABASE_URL}/rest/v1/${table}${qs}`, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  })
  return res.data ?? []
}

async function getSetting(key) {
  const rows = await sb('settings', `?key=eq.${encodeURIComponent(key)}&select=value`)
  return rows[0]?.value ?? null
}

// ─── Fetch & calculate DAILY metrics for a given date ─────────────────────────
async function fetchMetrics(dateStr) {
  const [orders, platCosts, costRows] = await Promise.all([
    sb('orders', `?date=eq.${dateStr}&status=eq.delivered&select=id,platform,order_items(quantity,unit_price,unit_gp_cost,menu_id,menus(name,category))`),
    sb('platform_costs', `?date=eq.${dateStr}&select=*`),
    sb('cost_settings', `?effective_from=lte.${dateStr}&select=key,value,effective_from&order=effective_from.desc`),
  ])

  // cost_settings: เอาค่าล่าสุดของแต่ละ key
  const cs = {}
  for (const row of costRows) {
    if (!(row.key in cs)) cs[row.key] = Number(row.value)
  }

  // platform fee% config
  const platConfigRaw = await getSetting('platform_config')
  const platConfig    = platConfigRaw ? JSON.parse(platConfigRaw) : []
  const feeMap = {}
  for (const p of platConfig) feeMap[(p.name ?? '').toUpperCase()] = Number(p.fee ?? 0)

  const BEV_CATS = ['Cocoa', 'Coffee', 'Matcha', 'Classic', 'Hot']
  let totalSales = 0, totalGpCost = 0
  const menuAgg   = {}
  const platSales = {}
  const catQty    = { beverage: 0, bread: 0, refill: 0, addon: 0 }

  for (const order of orders) {
    const plat = (order.platform ?? 'other').toUpperCase()
    for (const item of order.order_items ?? []) {
      const qty   = Number(item.quantity ?? 0)
      const price = Number(item.unit_price ?? 0)
      const gpCst = Number(item.unit_gp_cost ?? 0)
      totalSales  += qty * price
      totalGpCost += qty * gpCst
      platSales[plat] = (platSales[plat] ?? 0) + qty * price
      const mId  = item.menu_id ?? 'unknown'
      const cat  = item.menus?.category ?? ''
      if (!menuAgg[mId]) menuAgg[mId] = { name: item.menus?.name || mId, qty: 0, sales: 0 }
      menuAgg[mId].qty   += qty
      menuAgg[mId].sales += qty * price
      // category summary
      if (BEV_CATS.includes(cat))      catQty.beverage += qty
      else if (cat === 'Bun')          catQty.bread    += qty
      else if (cat === 'Refill')       catQty.refill   += qty
      else if (cat === 'Addon')        catQty.addon    += qty
    }
  }

  // menu_discount + extra costs จาก platform_costs
  let menuDiscount = 0, extraCosts = 0
  for (const pc of platCosts) {
    menuDiscount += Number(pc.menu_discount ?? 0)
    extraCosts   += Number(pc.campaign ?? 0) + Number(pc.marketing_fee ?? 0)
                 +  Number(pc.delivery_discount ?? 0) + Number(pc.advertisement ?? 0)
  }

  const grossSales    = Math.max(0, totalSales - menuDiscount)
  const discountRatio = totalSales > 0 ? grossSales / totalSales : 1
  const gpCostAdj     = totalGpCost * discountRatio

  // platform fee จาก orders (fee% × grossSales per platform)
  let platFeeFromOrders = 0
  for (const [plat, sales] of Object.entries(platSales)) {
    platFeeFromOrders += (sales * discountRatio) * (feeMap[plat] ?? 0) / 100
  }
  const totalPlatFee = platFeeFromOrders + extraCosts
  const platFeeRate  = grossSales > 0 ? (totalPlatFee / grossSales) * 100 : 0

  // labor cost
  const laborPct  = cs.labor_pct ?? 0
  const laborCost = grossSales * laborPct / 100

  // mat cost = gpCostAdj − labor − platform fee from orders
  const matCost = Math.max(0, gpCostAdj - laborCost - platFeeFromOrders)

  // net profit
  const netProfit    = grossSales - gpCostAdj - extraCosts
  const netProfitPct = grossSales > 0 ? (netProfit / grossSales) * 100 : 0

  // top 3 menus by qty
  const top3 = Object.values(menuAgg).sort((a, b) => b.qty - a.qty).slice(0, 3)

  return {
    totalSales, grossSales, menuDiscount,
    totalPlatFee, platFeeRate,
    matCost, laborCost,
    netProfit, netProfitPct,
    orderCount: orders.length,
    top3, catQty, platSales,
  }
}

// ─── Fetch WEEKLY totals (Mon → yesterday, vs same span last week) ─────────────
async function fetchWeeklyMetrics(yesterday) {
  const monday     = getMondayOf(yesterday)
  const prevMonday = offsetDate(monday, -7)
  const prevSameDay = offsetDate(yesterday, -7)

  const sumSales = (orders) =>
    orders.reduce((t, o) =>
      t + (o.order_items ?? []).reduce((s, i) =>
        s + Number(i.quantity ?? 0) * Number(i.unit_price ?? 0), 0), 0)

  const [thisWeekOrders, lastWeekOrders] = await Promise.all([
    sb('orders', `?date=gte.${monday}&date=lte.${yesterday}&status=eq.delivered&select=order_items(quantity,unit_price)`),
    sb('orders', `?date=gte.${prevMonday}&date=lte.${prevSameDay}&status=eq.delivered&select=order_items(quantity,unit_price)`),
  ])

  const dayCount = daysBetween(monday, yesterday) + 1

  return {
    thisWeekSales: sumSales(thisWeekOrders),
    lastWeekSales: sumSales(lastWeekOrders),
    dayCount,
    weekStart: monday,
    weekEnd:   yesterday,
  }
}

// ─── Claude Haiku — AI analysis ───────────────────────────────────────────────
async function getAIInsights(today, lastWeek, weekly) {
  const vsDay = lastWeek
    ? `${((today.totalSales - lastWeek.totalSales) / (lastWeek.totalSales || 1) * 100).toFixed(1)}% vs 7 วันก่อน`
    : 'ไม่มีข้อมูลเปรียบเทียบ'
  const vsWeek = weekly && weekly.lastWeekSales > 0
    ? `${((weekly.thisWeekSales - weekly.lastWeekSales) / weekly.lastWeekSales * 100).toFixed(1)}% vs สัปดาห์ก่อน`
    : 'ไม่มีข้อมูลเปรียบเทียบ'

  // Platform breakdown: sort by sales desc, compare vs last week
  const platLines = Object.entries(today.platSales ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([plat, sales]) => {
      const lastSales = lastWeek?.platSales?.[plat]
      const vsStr = lastSales != null && lastSales > 0
        ? ` (${((sales - lastSales) / lastSales * 100).toFixed(1)}% vs 7 วันก่อน)`
        : ''
      return `  • ${plat}: ฿${fmt(sales)}${vsStr}`
    })
    .join('\n')

  const prompt = `คุณเป็นที่ปรึกษาธุรกิจร้านเครื่องดื่มไทย วิเคราะห์ข้อมูลยอดขาย Cocoa House

ข้อมูลเมื่อวาน:
- ยอดขายรวม: ฿${fmt(today.totalSales)} (${vsDay})
- ยอดขายแยก Platform:
${platLines || '  • ไม่มีข้อมูล'}
- Platform Fee: ฿${fmt(today.totalPlatFee)} (${fmtPct(today.platFeeRate)} ของยอดขาย${lastWeek ? `, ${(today.platFeeRate - lastWeek.platFeeRate).toFixed(1)}pp vs 7 วันก่อน` : ''})
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

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === 'sk-ant-...') {
    return '• (AI วิเคราะห์ไม่พร้อมใช้งาน — ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY)'
  }
  const msg = await ai.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages:   [{ role: 'user', content: prompt }],
  })
  return msg.content[0]?.text ?? '• ไม่สามารถวิเคราะห์ได้ในขณะนี้'
}

// ─── LINE Flex Message builder ─────────────────────────────────────────────────
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

  // Weekly label: "จ.–อ. 2 วัน"
  const wkLabel = weekly
    ? `${shortDay(weekly.weekStart)}–${shortDay(weekly.weekEnd)} ${weekly.dayCount} วัน`
    : '—'

  const weeklySection = [
    { type: 'separator', margin: 'md' },
    {
      type: 'box', layout: 'horizontal', margin: 'md',
      contents: [
        { type: 'text', text: '📅 ยอดรายสัปดาห์', size: 'sm', weight: 'bold', color: '#374151', flex: 1 },
        { type: 'text', text: wkLabel, size: 'xs', color: '#9CA3AF', align: 'end' },
      ],
    },
    {
      type: 'box', layout: 'horizontal', margin: 'sm',
      contents: [
        { type: 'text', text: 'ยอดสะสม', size: 'sm', color: '#6B7280', flex: 3 },
        { type: 'text', text: `฿${fmt(weekly?.thisWeekSales ?? 0)}`, size: 'sm', color: '#111827', weight: 'bold', flex: 3, align: 'end' },
        { type: 'text', text: wkBadge.text, size: 'xs', color: wkBadge.color, flex: 4, align: 'end' },
      ],
    },
  ]

  return {
    type:     'flex',
    altText:  `Cocoa House รายงานประจำวัน — ${thaiDate(dateStr)}`,
    contents: {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'vertical', paddingAll: '16px',
        backgroundColor: '#3B1F0F',
        contents: [
          { type: 'text', text: '🍫 Cocoa House', weight: 'bold', color: '#FFFFFF', size: 'lg' },
          { type: 'text', text: `รายงานประจำวัน — ${thaiDate(dateStr)}`, size: 'xs', color: '#D4A87A', margin: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'none',
        contents: [
          // Daily metrics
          { type: 'text', text: '📊 ยอดขายเมื่อวาน', weight: 'bold', size: 'sm', color: '#374151' },
          { type: 'separator', margin: 'sm' },
          metricRow('ยอดขายรวม',  `฿${fmt(today.totalSales)}`,                           salesBadge),
          metricRow('Platform Fee', `฿${fmt(today.totalPlatFee)} (${fmtPct(today.platFeeRate)})`, feeBadge),
          metricRow('Mat Cost',    `฿${fmt(today.matCost)}`,                              matBadge),
          metricRow('Labor Cost',  `฿${fmt(today.laborCost)}`,                            laborBadge),
          metricRow('Net Profit%', fmtPct(today.netProfitPct),                            profitBadge),

          // Weekly section
          ...weeklySection,

          // Top 3
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '🏆 Top เมนูขายดี', weight: 'bold', size: 'sm', color: '#374151', margin: 'md' },
          ...top3Items,

          // Category summary
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

          // AI analysis
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '🤖 AI วิเคราะห์', weight: 'bold', size: 'sm', color: '#374151', margin: 'md' },
          ...aiLines,
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px', backgroundColor: '#F9FAFB',
        contents: [{
          type:   'button',
          action: { type: 'uri', label: 'เปิด Dashboard', uri: 'https://cocoa-house.vercel.app' },
          style:  'secondary', height: 'sm', color: '#D4A87A',
        }],
      },
    },
  }
}

// ─── Send to LINE ─────────────────────────────────────────────────────────────
async function sendLine(message) {
  await axios.post(
    'https://api.line.me/v2/bot/message/push',
    { to: LINE_USER, messages: [message] },
    { headers: { Authorization: `Bearer ${LINE_TOKEN}`, 'Content-Type': 'application/json' } }
  )
}

// ─── Deduplication ────────────────────────────────────────────────────────────
function alreadySentToday() {
  try {
    const data = JSON.parse(fs.readFileSync(SENT_FILE, 'utf8'))
    return data.date === localDateStr(0)
  } catch {
    return false
  }
}

function markSentToday() {
  fs.writeFileSync(SENT_FILE, JSON.stringify({
    date:   localDateStr(0),
    sentAt: new Date().toISOString(),
  }))
}

// ─── Main report runner ───────────────────────────────────────────────────────
// dateOverride: ถ้าส่งมา จะ report วันนั้น (manual trigger จาก web app)
async function runDailyReport(dateOverride) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !LINE_TOKEN || !LINE_USER) {
    console.warn('[AI Reporter] Missing env vars — skip')
    return
  }
  const isManual = !!dateOverride
  if (!isManual && alreadySentToday()) {
    console.log('[AI Reporter] Already sent today — skip')
    return
  }

  try {
    console.log(`[AI Reporter] Running... ${isManual ? `(manual: ${dateOverride})` : ''}`)
    const yesterday    = dateOverride ?? localDateStr(-1)
    const lastWeekSame = offsetDate(yesterday, -7)

    const [todayData, lastWeekData, weeklyData] = await Promise.all([
      fetchMetrics(yesterday),
      fetchMetrics(lastWeekSame).catch(() => null),
      fetchWeeklyMetrics(yesterday).catch(() => null),
    ])

    if (todayData.orderCount === 0 && !isManual) {
      console.log('[AI Reporter] No orders — skip')
      markSentToday()
      return
    }

    const aiText = await getAIInsights(todayData, lastWeekData, weeklyData)
    const flex   = buildFlexMessage(yesterday, todayData, lastWeekData, weeklyData, aiText)

    await sendLine(flex)
    if (!isManual) markSentToday()
    console.log(`[AI Reporter] Sent report for ${yesterday}`)
  } catch (err) {
    console.error('[AI Reporter] Error:', err.message)
    if (err.response) console.error('[AI Reporter] Detail:', JSON.stringify(err.response.data))
    throw err  // re-throw ให้ caller จับได้
  }
}

// ─── Cron: 16:30 every day ────────────────────────────────────────────────────
cron.schedule('30 16 * * *', () => {
  console.log('[AI Reporter] Cron triggered 16:30')
  runDailyReport()
})

// ─── Startup catch-up ─────────────────────────────────────────────────────────
function startupCatchUp() {
  const now  = new Date()
  const hour = now.getHours()
  const min  = now.getMinutes()
  if ((hour > 16 || (hour === 16 && min >= 30)) && !alreadySentToday()) {
    console.log('[AI Reporter] Startup catch-up: sending missed report in 3s')
    setTimeout(runDailyReport, 3000)
  }
}
startupCatchUp()

console.log('[AI Reporter] Initialized — cron at 16:30 daily')
module.exports = { runDailyReport, runReport: runDailyReport }
