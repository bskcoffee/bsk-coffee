/**
 * BSK coffee&bakery — Profit Calculations
 *
 * 5-Layer Order Profit (existing):
 *   Layer 1: Sales = Σ (qty × unit_price)
 *   Layer 2: Gross Sales = Sales − Menu Discount
 *   Layer 3: Gross Profit = Gross Sales − GP Cost
 *   Layer 4: Net Profit = Gross Profit − (Campaign + Marketing Fee + Delivery Discount + Advert.)
 *   Layer 5: Net Profit % = Net Profit ÷ Gross Sales × 100
 *
 * Per-Menu Cost Breakdown (new — version-based costing):
 *   Material Cost = Ingredients + Packaging + Consumables + Operation
 *   GP Cost       = Material Cost + Labor (labor_pct % × price) + Platform Fee (fee_pct % × price)
 *   Total Cost    = GP Cost + Marketing (marketing_pct % × price)
 *   Profit        = Price − Total Cost
 *   Profit %      = Profit ÷ Price × 100
 */

// ─── Constants ───────────────────────────────────────────────

export const CAMPAIGN_GP_PCT = 5  // Grab 60/40 campaign flat GP fee %

// ─── 5-Layer Order Profit ────────────────────────────────────

export function calcPlatformProfit({ items = [], costs = {}, platformFeePct = 0 }) {
  // Layer 1
  const sales       = items.reduce((sum, i) => sum + (i.quantity * i.unit_price),   0)
  const gpCostTotal = items.reduce((sum, i) => sum + (i.quantity * i.unit_gp_cost), 0)

  // Campaign breakdown for display (items already carry correct unit_gp_cost per type)
  const campaignSales    = items.filter(i => i.is_campaign).reduce((s, i) => s + i.quantity * i.unit_price, 0)
  const normalSales      = sales - campaignSales

  // Layer 2
  const menuDiscount = costs.menu_discount ?? 0
  const grossSales   = Math.max(0, sales - menuDiscount)

  // Layer 3 — GP ต้องคำนวณบน grossSales (หลังหัก menu_discount) ไม่ใช่ยอดเต็ม
  // ตัวอย่าง: sales=500, discount=76, fee=10% → gpCost=42.4 (ไม่ใช่ 50)
  const discountRatio      = sales > 0 ? grossSales / sales : 1
  const grossNormalSales   = normalSales   * discountRatio
  const grossCampaignSales = campaignSales * discountRatio
  const gpCostAdjusted     = gpCostTotal   * discountRatio   // GP บนยอดสุทธิ
  const grossProfit        = grossSales    - gpCostAdjusted

  // Layer 4
  const campaign         = costs.campaign          ?? 0
  const marketingFee     = costs.marketing_fee     ?? 0
  const deliveryDiscount = costs.delivery_discount ?? 0
  const advertisement    = costs.advertisement     ?? 0
  const totalPlatformCosts = campaign + marketingFee + deliveryDiscount + advertisement

  const netProfit    = grossProfit - totalPlatformCosts

  // Layer 5
  const netProfitPct = grossSales > 0 ? (netProfit / grossSales) * 100 : 0

  return {
    sales,
    normalSales,
    campaignSales,
    menuDiscount,
    grossSales,
    gpCostTotal,
    gpCostAdjusted,
    grossNormalSales,
    grossCampaignSales,
    grossProfit,
    campaign,
    marketingFee,
    deliveryDiscount,
    advertisement,
    totalPlatformCosts,
    netProfit,
    netProfitPct,
    platformFeePct,
    itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
  }
}

export function calcDayTotal(platformResults) {
  const totals = {
    sales: 0,
    menuDiscount: 0,
    grossSales: 0,
    gpCostTotal: 0,
    grossProfit: 0,
    totalPlatformCosts: 0,
    netProfit: 0,
    itemCount: 0,
  }

  for (const r of Object.values(platformResults)) {
    if (!r) continue
    totals.sales += r.sales
    totals.menuDiscount += r.menuDiscount
    totals.grossSales += r.grossSales
    totals.gpCostTotal += r.gpCostTotal
    totals.grossProfit += r.grossProfit
    totals.totalPlatformCosts += r.totalPlatformCosts
    totals.netProfit += r.netProfit
    totals.itemCount += r.itemCount
  }

  totals.netProfitPct = totals.grossSales > 0
    ? (totals.netProfit / totals.grossSales) * 100
    : 0

  return totals
}

export function calcPeriodSummary(dayResults) {
  const totals = {
    sales: 0, menuDiscount: 0, grossSales: 0,
    gpCostTotal: 0, grossProfit: 0, totalPlatformCosts: 0,
    netProfit: 0, itemCount: 0, days: 0
  }

  for (const day of dayResults) {
    totals.days++
    totals.sales += day.sales ?? 0
    totals.menuDiscount += day.menuDiscount ?? 0
    totals.grossSales += day.grossSales ?? 0
    totals.gpCostTotal += day.gpCostTotal ?? 0
    totals.grossProfit += day.grossProfit ?? 0
    totals.totalPlatformCosts += day.totalPlatformCosts ?? 0
    totals.netProfit += day.netProfit ?? 0
    totals.itemCount += day.itemCount ?? 0
  }

  totals.netProfitPct = totals.grossSales > 0
    ? (totals.netProfit / totals.grossSales) * 100
    : 0
  totals.avgDailySales = totals.days > 0 ? totals.sales / totals.days : 0

  return totals
}

// ─── Per-Menu Cost Breakdown (Version-Based) ─────────────────

// Default (hardcoded) packaging keys — used when no schema is provided
export const PKG_KEYS = {
  beverage: ['packaging_bev_cup', 'packaging_bev_sticker', 'packaging_bev_straw', 'packaging_bev_seal', 'packaging_bev_bag'],
  bun:      ['packaging_bun_box', 'packaging_bun_sticker', 'packaging_bun_bag'],
  none:     [],
}

// Default labels — used when no schema is provided
export const COST_KEY_LABELS = {
  packaging_bev_cup:     'แก้ว + ฝา',
  packaging_bev_sticker: 'สติกเกอร์',
  packaging_bev_straw:   'หลอด',
  packaging_bev_seal:    'ปิดฝาแก้ว',
  packaging_bev_bag:     'ถุงใส่',
  packaging_bun_box:     'กล่อง',
  packaging_bun_sticker: 'สติกเกอร์',
  packaging_bun_bag:     'ถุงใส่',
  consumables:           'วัสดุสิ้นเปลือง',
  operation_cost:        'ค่าน้ำค่าไฟ',
  labor_pct:             'ค่าแรง',
  marketing_pct:         'Marketing',
}

/**
 * Build dynamic PKG_KEYS and COST_KEY_LABELS from a cost schema.
 * Returns { pkgKeys, costKeyLabels, sharedKeys }
 */
export function buildDynamicLookups(costSchema) {
  if (!costSchema?.sections) return { pkgKeys: PKG_KEYS, costKeyLabels: COST_KEY_LABELS, sharedKeys: ['consumables', 'operation_cost'] }

  const pkgKeys = { none: [] }
  const costKeyLabels = { labor_pct: 'ค่าแรง', marketing_pct: 'Marketing' }
  const sharedKeys = []

  for (const section of costSchema.sections) {
    for (const item of section.items ?? []) {
      costKeyLabels[item.key] = item.label
    }
    if (section.pkg_type === 'shared') {
      for (const item of section.items ?? []) sharedKeys.push(item.key)
    } else if (section.pkg_type) {
      pkgKeys[section.pkg_type] = (section.items ?? []).map(i => i.key)
    }
  }

  // Ensure 'beverage' and 'bun' always have an entry (fallback empty)
  if (!pkgKeys.beverage) pkgKeys.beverage = PKG_KEYS.beverage
  if (!pkgKeys.bun)      pkgKeys.bun      = PKG_KEYS.bun

  return { pkgKeys, costKeyLabels, sharedKeys }
}

/**
 * Calculate full cost breakdown for a menu item.
 *
 * @param {object} menuCost       - Row from menu_costs table
 * @param {object} costSettings   - Map of key→value from cost_settings (for effective date)
 * @param {number} price          - Selling price on this platform
 * @param {number} platformFeePct - Platform fee % (0-100)
 * @param {object} [costSchema]   - Dynamic schema from cost_schema setting (optional)
 * @returns {object|null} Full cost breakdown
 */
export function calcMenuCostBreakdown(menuCost, costSettings, price = 0, platformFeePct = 0, costSchema = null) {
  if (!menuCost || !costSettings) return null

  const { pkgKeys, costKeyLabels, sharedKeys } = buildDynamicLookups(costSchema)
  const pkgType = menuCost.packaging_type || 'beverage'

  // 1. Ingredient cost
  const ingredientCost = (Number(menuCost.main_ingredient) || 0) +
                         (Number(menuCost.milk_condensed)  || 0) +
                         (Number(menuCost.milk_mixed)      || 0) +
                         (Number(menuCost.milk_fresh)      || 0)

  // 2. Packaging breakdown (from cost_settings, dynamic per schema)
  const packagingBreakdown = (pkgKeys[pkgType] || []).map(key => ({
    key,
    label: costKeyLabels[key] || key,
    value: Number(costSettings[key]) || 0,
  }))
  const packagingCost = packagingBreakdown.reduce((s, i) => s + i.value, 0)

  // 3. Shared costs (dynamic from schema's shared section)
  const sharedBreakdown = sharedKeys.map(key => ({
    key,
    label: costKeyLabels[key] || key,
    value: Number(costSettings[key]) || 0,
  }))
  const sharedCost = sharedBreakdown.reduce((s, i) => s + i.value, 0)
  // Keep legacy aliases for backwards-compat
  const consumables   = Number(costSettings.consumables)    || 0
  const operationCost = Number(costSettings.operation_cost) || 0

  // 4. Custom per-menu costs (free-form label + amount rows)
  const customCostRows  = Array.isArray(menuCost.custom_costs) ? menuCost.custom_costs : []
  const customCostTotal = customCostRows.reduce((s, c) => s + (Number(c.amount) || 0), 0)

  // 5. Material Cost = ingredients + packaging + shared + custom
  const materialCost = ingredientCost + packagingCost + sharedCost + customCostTotal

  // 5. Labor (% of price)
  const laborPct  = Number(costSettings.labor_pct) || 0
  const laborCost = price * laborPct / 100

  // 6. Platform Fee (% of price)
  const platformFee = price * platformFeePct / 100

  // 7. GP Cost = Material + Labor + Platform Fee
  const gpCost = materialCost + laborCost + platformFee

  // 8. Marketing (% of price)
  const marketingPct  = Number(costSettings.marketing_pct) || 0
  const marketingCost = price * marketingPct / 100

  // 9. Total Cost & Profit
  const totalCost  = gpCost + marketingCost
  const profit     = price - totalCost
  const profitPct  = price > 0 ? (profit / price) * 100 : 0

  return {
    ingredientCost,
    packagingBreakdown,
    packagingCost,
    sharedBreakdown,
    sharedCost,
    consumables,
    operationCost,
    customCostRows,
    customCostTotal,
    materialCost,
    laborPct,
    laborCost,
    marketingPct,
    marketingCost,
    platformFeePct,
    platformFee,
    gpCost,
    totalCost,
    profit,
    profitPct,
  }
}

// ─── Formatting Helpers ──────────────────────────────────────

export function formatBaht(n, decimals = 0) {
  if (n == null || isNaN(n)) return '฿0'
  return '฿' + Number(n).toLocaleString('th-TH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })
}

export function formatPct(n, decimals = 1) {
  if (n == null || isNaN(n)) return '0%'
  return Number(n).toFixed(decimals) + '%'
}

export function formatNum(n) {
  if (n == null || isNaN(n)) return '0'
  return Number(n).toLocaleString('th-TH')
}

export function changePct(current, previous) {
  if (!previous || previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}
