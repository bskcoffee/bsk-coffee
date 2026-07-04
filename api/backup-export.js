// backup-export.js
// Export ทุก table สำคัญเป็น JSON file — ดาวน์โหลดได้ตรงจาก browser
//
// GET https://cocoa-house.vercel.app/api/backup-export?secret=<CRON_SECRET>
// → ดาวน์โหลด cocoa-backup-YYYY-MM-DD.json

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
const CRON_SECRET  = process.env.CRON_SECRET

const headers = () => ({
  apikey:        SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
})

async function fetchTable(table, query = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}&limit=10000`
  const res  = await fetch(url, { headers: headers() })
  if (!res.ok) throw new Error(`Failed to fetch ${table}: ${res.status}`)
  return res.json()
}

export default async function handler(req, res) {
  // Auth
  const secret = req.query?.secret ?? req.headers['x-backup-secret']
  if (secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  try {
    // ดึงทุก table พร้อมกัน
    const [
      orders,
      orderItems,
      platformCosts,
      menus,
      menuPrices,
      menuCosts,
      costSettings,
      cashbook,
      settings,
      aiMemory,
    ] = await Promise.all([
      fetchTable('orders', 'order=date.desc'),
      fetchTable('order_items', 'order=id.desc'),
      fetchTable('platform_costs', 'order=date.desc'),
      fetchTable('menus', 'order=sort_order.asc'),
      fetchTable('menu_prices', ''),
      fetchTable('menu_costs', ''),
      fetchTable('cost_settings', ''),
      fetchTable('cashbook_entries', 'order=date.desc').catch(() => []),
      fetchTable('settings', ''),
      fetchTable('ai_memory', 'order=report_date.desc').catch(() => []),
    ])

    const now    = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
    const backup = {
      exported_at:   new Date().toISOString(),
      exported_date: now,
      version:       '1.0',
      tables: {
        orders:         { count: orders.length,        data: orders },
        order_items:    { count: orderItems.length,    data: orderItems },
        platform_costs: { count: platformCosts.length, data: platformCosts },
        menus:          { count: menus.length,         data: menus },
        menu_prices:    { count: menuPrices.length,    data: menuPrices },
        menu_costs:     { count: menuCosts.length,     data: menuCosts },
        cost_settings:  { count: costSettings.length,  data: costSettings },
        cashbook_entries: { count: cashbook.length,    data: cashbook },
        settings:       { count: settings.length,      data: settings },
        ai_memory:      { count: aiMemory.length,      data: aiMemory },
      },
    }

    const filename = `cocoa-backup-${now}.json`
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.status(200).json(backup)

  } catch (err) {
    console.error('[backup-export]', err)
    return res.status(500).json({ error: err.message })
  }
}
