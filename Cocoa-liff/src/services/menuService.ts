// src/services/menuService.ts
import { supabase } from '../lib/supabase'
import type { MenuCategory, MenuItem, MenuItemOption, Addon } from '../types'

const DEFAULT_OPTIONS: MenuItemOption[] = [
  {
    label: 'ความหวาน',
    choices: ['0%', '10%', '25%', '50%', '100%'],
    required: false,
    default: '100%',
  },
  {
    label: 'บรรจุภัณฑ์',
    choices: ['พร้อมดื่ม', 'แยกน้ำแข็ง'],
    required: true,
    default: 'พร้อมดื่ม',
  },
]

/** ดึง Addons (ชนิดนม) จาก menus WHERE category = 'Addon' */
export async function getAddons(): Promise<Addon[]> {
  const { data, error } = await supabase
    .from('menus')
    .select('id, name, sort_order')
    .in('category', ['Addon', 'addon', 'ADDON'])
    .eq('is_active', true)
    .order('sort_order')
  if (error) throw error
  return (data ?? []).map((m) => ({ id: m.id as string, name: m.name as string }))
}

/** ดึง categories จาก unique values ของ menus.category */
export async function getCategories(): Promise<MenuCategory[]> {
  const { data, error } = await supabase
    .from('menus')
    .select('category')
    .eq('is_active', true)
  if (error) throw error

  // กรอง Addon/Refill ออก — ไม่แสดงเป็น category เมนู
  const HIDDEN = ['Addon', 'addon', 'ADDON', 'Refill', 'refill', 'REFILL']
  const unique = [...new Set((data ?? [])
    .map((m) => m.category as string)
    .filter((c) => !HIDDEN.includes(c))
  )]
  return unique.map((name, i) => ({ id: name, name, sort_order: i }))
}

/** ดึง menus ที่ active + มีราคา LINE (effective_to IS NULL) */
export async function getMenuItems(): Promise<MenuItem[]> {
  // ดึงราคา LINE ปัจจุบัน
  const { data: prices, error: priceErr } = await supabase
    .from('menu_prices')
    .select('menu_id, price')
    .eq('platform', 'LINE@')
    .is('effective_to', null)
  if (priceErr) throw priceErr

  const priceMap = new Map((prices ?? []).map((p) => [p.menu_id as string, Number(p.price)]))

  // ดึงเมนูทั้งหมดที่ active
  const { data: menus, error: menuErr } = await supabase
    .from('menus')
    .select('id, name, category, image_url, is_active, is_sold_out, sort_order')
    .eq('is_active', true)
    .order('sort_order')
  if (menuErr) throw menuErr

  return (menus ?? [])
    .filter((m) => priceMap.has(m.id))
    .map((m) => ({
      id: m.id,
      name: m.name,
      price: priceMap.get(m.id)!,
      category_id: m.category as string,
      image_url: m.image_url ?? null,
      options: DEFAULT_OPTIONS,
      available: !m.is_sold_out,
    }))
}
