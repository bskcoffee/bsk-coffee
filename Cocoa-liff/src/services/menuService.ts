// src/services/menuService.ts
import { supabase } from '../lib/supabase'
import type { MenuCategory, MenuItem } from '../types'

export async function getCategories(): Promise<MenuCategory[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, sort_order')
    .order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function getMenuItems(): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from('menus')
    .select('id, name, price, category_id, image_url, options, available')
    .eq('available', true)
    .order('name')
  if (error) throw error
  return data ?? []
}
