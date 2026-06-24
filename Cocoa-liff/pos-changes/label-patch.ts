// pos-changes/label-patch.ts
// แก้ไขฟังก์ชัน printLabel ของ POS ให้รองรับ Platform: LINE
// หาฟังก์ชัน printLabel ใน print server แล้วเพิ่ม platform field

// ตัวอย่าง TSPL template ที่อัปเดตแล้ว:
export function buildLabelTspl(order: {
  order_number: number
  source: 'pos' | 'line'
  items: Array<{ name: string; quantity: number; selected_options: Record<string, string> }>
  created_at: string
  scheduled_at?: string | null
}): string {
  const orderNum = String(order.order_number).padStart(4, '0')
  const platform = order.source === 'line' ? 'LINE' : 'POS'
  const dateStr = new Date(order.created_at).toLocaleString('th-TH', {
    hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short',
  })

  let tspl = `SIZE 60 mm, 40 mm\nGAP 3 mm, 0\nCLS\n`
  tspl += `TEXT 10,10,"3",0,1,1,"#${orderNum}  Platform: ${platform}"\n`
  tspl += `TEXT 10,35,"2",0,1,1,"${dateStr}"\n`

  if (order.scheduled_at) {
    const schedStr = new Date(order.scheduled_at).toLocaleString('th-TH', {
      hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short',
    })
    tspl += `TEXT 10,55,"2",0,1,1,"Scheduled: ${schedStr}"\n`
    tspl += `BAR 10,70,560,2\n`
  } else {
    tspl += `BAR 10,55,560,2\n`
  }

  const startY = order.scheduled_at ? 80 : 65
  order.items.forEach((item, i) => {
    const opts = Object.values(item.selected_options).join(' ')
    tspl += `TEXT 10,${startY + i * 30},"2",0,1,1,"x${item.quantity} ${item.name}  ${opts}"\n`
  })

  tspl += `PRINT 1\n`
  return tspl
}
