import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check .env file.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'cocoa-house-auth',
  },
})

// ─── Menu Prices ────────────────────────────────────────────

// Get current price for a menu on a given date
export async function getMenuPrice(menuId, platform, date = new Date().toISOString().slice(0, 10)) {
  const { data } = await supabase
    .from('menu_prices')
    .select('price')
    .eq('menu_id', menuId)
    .eq('platform', platform)
    .lte('effective_from', date)
    .or('effective_to.is.null,effective_to.gte.' + date)
    .order('effective_from', { ascending: false })
    .limit(1)
    .single()
  return data?.price ?? 0
}

// Update menu price (close old, open new)
export async function updateMenuPrice(menuId, platform, newPrice, effectiveFrom = new Date().toISOString().slice(0, 10)) {
  await supabase
    .from('menu_prices')
    .update({ effective_to: effectiveFrom })
    .eq('menu_id', menuId)
    .eq('platform', platform)
    .is('effective_to', null)

  const { data, error } = await supabase
    .from('menu_prices')
    .insert({ menu_id: menuId, platform, price: newPrice, effective_from: effectiveFrom })
  return { data, error }
}

// ─── Settings (Platform Fees + Misc) ─────────────────────────

// ── Default cost schema (used as fallback / first-run seed) ──
export const DEFAULT_COST_SCHEMA = {
  sections: [
    {
      id: 'bev',
      title: '🧋 บรรจุภัณฑ์เครื่องดื่ม',
      pkg_type: 'beverage',
      items: [
        { key: 'packaging_bev_cup',     label: 'แก้ว + ฝา' },
        { key: 'packaging_bev_sticker', label: 'สติกเกอร์' },
        { key: 'packaging_bev_straw',   label: 'หลอด' },
        { key: 'packaging_bev_seal',    label: 'ปิดฝาแก้ว' },
        { key: 'packaging_bev_bag',     label: 'ถุงใส่' },
      ],
    },
    {
      id: 'bun',
      title: '🍞 บรรจุภัณฑ์ขนมปัง',
      pkg_type: 'bun',
      items: [
        { key: 'packaging_bun_box',     label: 'กล่อง' },
        { key: 'packaging_bun_sticker', label: 'สติกเกอร์' },
        { key: 'packaging_bun_bag',     label: 'ถุงใส่' },
      ],
    },
    {
      id: 'shared',
      title: '⚡ ต้นทุนร่วม',
      pkg_type: 'shared',
      items: [
        { key: 'consumables',    label: 'วัสดุสิ้นเปลือง' },
        { key: 'operation_cost', label: 'ค่าน้ำค่าไฟ' },
      ],
    },
  ],
}

export async function getCostSchema() {
  const raw = await getSetting('cost_schema')
  if (raw) {
    try { return JSON.parse(raw) } catch { /* fall through */ }
  }
  return DEFAULT_COST_SCHEMA
}

export async function saveCostSchema(schema) {
  return setSetting('cost_schema', JSON.stringify(schema))
}

// ── Platform config — monthly versioning ─────────────────────
export async function getPlatformConfigForMonth(month) {
  // Try monthly key first (e.g. platform_config_2026-06)
  const monthly = await getSetting(`platform_config_${month}`)
  if (monthly) { try { return JSON.parse(monthly) } catch { /* ignore */ } }
  // Fallback to current/latest
  const current = await getSetting('platform_config')
  if (current) { try { return JSON.parse(current) } catch { /* ignore */ } }
  return null
}

export async function savePlatformConfigForMonth(month, config, isCurrentMonth) {
  const json = JSON.stringify(config)
  const promises = [setSetting(`platform_config_${month}`, json)]
  if (isCurrentMonth) promises.push(setSetting('platform_config', json))
  await Promise.all(promises)
}

export async function getSetting(key) {
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .single()
  return data?.value
}

export async function setSetting(key, value) {
  return supabase
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() })
}

// ─── Cost Settings (Versioned Global Costs) ─────────────────

// Get all cost settings effective on a given date
export async function getCostSettingsForDate(date = new Date().toISOString().slice(0, 10)) {
  const { data } = await supabase
    .from('cost_settings')
    .select('key, value, effective_from')
    .lte('effective_from', date)
    .or(`effective_to.is.null,effective_to.gt.${date}`)
    .order('effective_from', { ascending: false })

  // Deduplicate: take newest active row per key
  const result = {}
  for (const row of data ?? []) {
    if (!(row.key in result)) result[row.key] = Number(row.value)
  }
  return result
}

// Get current cost settings (latest active)
export async function getCurrentCostSettings() {
  return getCostSettingsForDate()
}

// Update a cost setting — close old version, open new
export async function updateCostSetting(key, value, effectiveFrom = new Date().toISOString().slice(0, 10)) {
  await supabase
    .from('cost_settings')
    .update({ effective_to: effectiveFrom })
    .eq('key', key)
    .is('effective_to', null)

  return supabase
    .from('cost_settings')
    .insert({ key, value: Number(value), effective_from: effectiveFrom })
}

// Batch update multiple cost settings (only keys whose value changed)
export async function updateCostSettings(newValues, currentValues, effectiveFrom = new Date().toISOString().slice(0, 10)) {
  const changedKeys = Object.keys(newValues).filter(
    k => Number(newValues[k]) !== Number(currentValues[k])
  )
  if (changedKeys.length === 0) return { changed: 0 }

  for (const k of changedKeys) {
    await updateCostSetting(k, newValues[k], effectiveFrom)
  }
  return { changed: changedKeys.length }
}

// Get cost settings history (audit log)
export async function getCostSettingsHistory(limit = 30) {
  const { data } = await supabase
    .from('cost_settings')
    .select('key, value, effective_from, effective_to')
    .order('effective_from', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  return data ?? []
}

// ─── Menu Costs (Versioned Per-Menu Ingredients) ────────────

// Get current menu cost (effective today or on given date)
export async function getMenuCostForDate(menuId, date = new Date().toISOString().slice(0, 10)) {
  const { data } = await supabase
    .from('menu_costs')
    .select('*')
    .eq('menu_id', menuId)
    .lte('effective_from', date)
    .or(`effective_to.is.null,effective_to.gt.${date}`)
    .order('effective_from', { ascending: false })
    .limit(1)
    .single()
  return data ?? null
}

// Update menu cost — close old version, open new
export async function updateMenuCost(menuId, costData, effectiveFrom = new Date().toISOString().slice(0, 10)) {
  await supabase
    .from('menu_costs')
    .update({ effective_to: effectiveFrom })
    .eq('menu_id', menuId)
    .is('effective_to', null)

  return supabase.from('menu_costs').insert({
    menu_id:         menuId,
    main_ingredient: Number(costData.main_ingredient) || 0,
    milk_condensed:  Number(costData.milk_condensed)  || 0,
    milk_mixed:      Number(costData.milk_mixed)       || 0,
    milk_fresh:      Number(costData.milk_fresh)       || 0,
    packaging_type:  costData.packaging_type || 'beverage',
    custom_costs:    costData.custom_costs ?? [],
    effective_from:  effectiveFrom,
  })
}

// Get cost history for a menu
export async function getMenuCostHistory(menuId) {
  const { data } = await supabase
    .from('menu_costs')
    .select('*')
    .eq('menu_id', menuId)
    .order('effective_from', { ascending: false })
  return data ?? []
}
