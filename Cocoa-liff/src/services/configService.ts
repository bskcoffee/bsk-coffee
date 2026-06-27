// src/services/configService.ts
// อ่านค่า config จาก liff_config table ใน Supabase
import { supabase } from '../lib/supabase'

export interface LiffConfig {
  promptpay_qr_url: string
  delivery_radius_km: number
  delivery_fee_per_km: number
  free_delivery_min: number
  store_status: 'open' | 'closed'
  line_oa_url: string
}

const DEFAULTS: LiffConfig = {
  promptpay_qr_url:    '/promptpay-qr.png',
  delivery_radius_km:  3,
  delivery_fee_per_km: 15,
  free_delivery_min:   249,
  store_status:        'open',
  line_oa_url:         '',
}

export async function getLiffConfig(): Promise<LiffConfig> {
  const { data, error } = await supabase
    .from('liff_config')
    .select('key, value')

  if (error || !data) return DEFAULTS

  const map = Object.fromEntries(data.map((r) => [r.key, r.value]))

  return {
    promptpay_qr_url:    map['promptpay_qr_url']    || DEFAULTS.promptpay_qr_url,
    delivery_radius_km:  Number(map['delivery_radius_km'])  || DEFAULTS.delivery_radius_km,
    delivery_fee_per_km: Number(map['delivery_fee_per_km']) || DEFAULTS.delivery_fee_per_km,
    free_delivery_min:   Number(map['free_delivery_min'])   || DEFAULTS.free_delivery_min,
    store_status:        (map['store_status'] as LiffConfig['store_status']) || DEFAULTS.store_status,
    line_oa_url:         map['line_oa_url'] ?? '',
  }
}
