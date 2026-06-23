require('dotenv').config()
const express = require('express')
const cors    = require('cors')
const net     = require('net')
const iconv   = require('iconv-lite')

const app = express()
app.use(cors())
app.use(express.json())

const PRINTER_IP   = process.env.PRINTER_IP   || '192.168.1.100'
const PRINTER_PORT = parseInt(process.env.PRINTER_PORT || '9100')
const SERVER_PORT  = parseInt(process.env.SERVER_PORT  || '3001')

// ─── Send raw bytes to printer via TCP ───────────────────────────────────────
function printRaw(buffer) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    socket.setTimeout(5000)
    socket.connect(PRINTER_PORT, PRINTER_IP, () => {
      socket.write(buffer, () => {
        socket.end()
        resolve()
      })
    })
    socket.on('error', (err) => { socket.destroy(); reject(err) })
    socket.on('timeout', () => { socket.destroy(); reject(new Error('Printer connection timed out')) })
  })
}

// ─── TSPL constants ───────────────────────────────────────────────────────────
const LABEL_W_MM = 50
const LABEL_H_MM = 30
const DPI        = 203            // dots per inch
const MM2DOT     = DPI / 25.4    // ~8 dots/mm
const LABEL_W    = Math.round(LABEL_W_MM * MM2DOT)  // 400 dots
const LABEL_H    = Math.round(LABEL_H_MM * MM2DOT)  // 240 dots

// Map fontSize (7-20) to TSPL font + multiplier + approx char width (dots)
function getFontParams(fontSize) {
  if (fontSize >= 16) return { font: '3', xm: 2, ym: 2, cw: 20 }
  if (fontSize >= 13) return { font: '3', xm: 1, ym: 1, cw: 10 }
  if (fontSize >= 10) return { font: '2', xm: 1, ym: 1, cw: 8  }
  return              { font: '1', xm: 1, ym: 1, cw: 6  }
}

// Adjust x for alignment
function alignX(xPct, content, cw, align) {
  const xDot  = Math.round(xPct / 100 * LABEL_W)
  const textW = content.length * cw
  if (align === 'center') return Math.max(0, xDot - Math.round(textW / 2))
  if (align === 'right')  return Math.max(0, xDot - textW)
  return xDot
}

// TSPL header for every label
function tsplHeader() {
  return [
    `SIZE ${LABEL_W_MM} mm, ${LABEL_H_MM} mm`,
    `GAP 2 mm, 0 mm`,
    `DIRECTION 1`,
    `CODEPAGE 874`,  // Thai character support
    `CLS`,
  ]
}

// Safe-escape double quotes inside content
function safe(str) { return String(str).replace(/"/g, "'") }

// ─── Build TSPL label from new layout (drag-editor) ──────────────────────────
function buildLabelFromLayout(item, orderId, platform, labelIdx, totalLabels, layout, storeName, labelWmm, labelHmm) {
  const wMM = labelWmm || LABEL_W_MM
  const hMM = labelHmm || LABEL_H_MM
  const wDot = Math.round(wMM * MM2DOT)
  const hDot = Math.round(hMM * MM2DOT)
  const o = item.item_options ?? {}

  const getContent = (field) => {
    switch (field.type) {
      case 'menu_name':  return item.name || ''
      case 'options': {
        const toStr = (v) => {
          if (v == null) return ''
          if (typeof v === 'string') return v
          if (typeof v === 'number') return String(v)
          if (typeof v === 'object') return v.name || v.label || v.value || ''
          return ''
        }
        const opts = []
        if (o.milk)             { const s = toStr(o.milk);  if (s) opts.push(s) }
        if (o.sweetness != null) opts.push(`${o.sweetness}%`)
        if (o.packaging)        { const s = toStr(o.packaging); if (s) opts.push(s) }
        if (o.refill) {
          if (Array.isArray(o.refill) && o.refill.length > 0)
            opts.push(o.refill.map(toStr).filter(Boolean).join(', ') || 'Refill')
          else {
            const s = toStr(o.refill)
            opts.push(s || 'Refill')
          }
        }
        if (o.note)             { const s = toStr(o.note);  if (s) opts.push(s) }
        return opts.join(' / ')
      }
      case 'order_id':   return `#${orderId}`
      case 'qty':        return `x${item.qty ?? 1}`
      case 'time': {
        const now = new Date()
        return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
      }
      case 'index':      return `${labelIdx}/${totalLabels}`
      case 'store_name': return storeName || 'Cocoa House'
      case 'platform':   return platform || ''
      case 'date': {
        const now = new Date()
        return `${now.getDate()}/${now.getMonth()+1}`
      }
      case 'note': {
        const s = o.note
        if (!s) return ''
        const text = typeof s === 'string' ? s
          : typeof s === 'object' ? (s.name || s.label || s.value || '')
          : String(s)
        return text ? `Note : ${text}` : ''
      }
      case 'custom':     return field.text || ''
      default:           return ''
    }
  }

  const cmds = [
    `SIZE ${wMM} mm, ${hMM} mm`,
    `GAP 2 mm, 0 mm`,
    `DIRECTION 1`,
    `CODEPAGE 874`,
    `CLS`,
  ]

  for (const field of layout.filter(f => f.visible)) {
    if (field.type === 'divider') {
      const y = Math.round(field.y / 100 * hDot)
      cmds.push(`BAR 0,${y},${wDot},2`)
      continue
    }

    const content = getContent(field)
    if (!content) continue

    const { font, xm, ym, cw } = getFontParams(field.fontSize)
    const xBase = Math.round(field.x / 100 * wDot)
    const y     = Math.round(field.y / 100 * hDot)
    const textW = content.length * cw
    let x = xBase
    if (field.align === 'center') x = Math.max(0, xBase - Math.round(textW / 2))
    if (field.align === 'right')  x = Math.max(0, xBase - textW)

    cmds.push(`TEXT ${x},${y},"${font}",0,${xm},${ym},"${safe(content)}"`)
  }

  cmds.push(`PRINT 1,1`, '')
  return iconv.encode(cmds.join('\r\n'), 'cp874')
}

// ─── Build TSPL label from old settings format (fallback) ────────────────────
function buildLabel(item, orderId, platform, labelIdx, totalLabels, settings, storeName) {
  const s = {
    showMenuName: true, menuNameSize: 'large',
    showOptions: true,
    showOptionMilk: true, showOptionSweet: true,
    showOptionRefill: true, showOptionNote: true,
    showOrderId: true, showQty: true,
    showIndex: true, showTime: true, showStoreName: false,
    ...settings,
  }
  const o = item.item_options ?? {}
  const cmds = tsplHeader()
  let y = 10

  // Menu name
  if (s.showMenuName) {
    const big = s.menuNameSize === 'large'
    const { font, xm, ym, cw } = getFontParams(big ? 16 : 13)
    const x = Math.max(0, Math.round(LABEL_W / 2 - item.name.length * cw / 2))
    cmds.push(`TEXT ${x},${y},"${font}",0,${xm},${ym},"${safe(item.name)}"`)
    y += big ? 50 : 30
  }

  // Options
  const opts = []
  if (s.showOptions) {
    if (s.showOptionMilk   && o.milk)             opts.push(o.milk)
    if (s.showOptionSweet  && o.sweetness != null) opts.push(`${o.sweetness}%`)
    if (o.packaging)                               opts.push(o.packaging)
    if (s.showOptionRefill && o.refill)            opts.push('Refill')
    if (s.showOptionNote   && o.note)              opts.push(o.note)
  }
  if (opts.length > 0) {
    const content = opts.join(' / ')
    const x = Math.max(0, Math.round(LABEL_W / 2 - content.length * 8 / 2))
    cmds.push(`TEXT ${x},${y},"2",0,1,1,"${safe(content)}"`)
    y += 25
  }

  // Divider
  cmds.push(`BAR 0,${y},${LABEL_W},2`)
  y += 10

  // Bottom row
  const bottom = []
  if (s.showOrderId && orderId) bottom.push(`#${orderId}`)
  if (s.showQty)                bottom.push(`x${item.qty ?? 1}`)
  if (s.showTime) {
    const now = new Date()
    bottom.push(`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`)
  }
  if (s.showIndex) bottom.push(`${labelIdx}/${totalLabels}`)
  if (bottom.length > 0) {
    cmds.push(`TEXT 5,${y},"2",0,1,1,"${safe(bottom.join('  '))}"`)
  }

  // Store name
  if (s.showStoreName) {
    y += 25
    const name = storeName || 'Cocoa House'
    const x = Math.max(0, Math.round(LABEL_W / 2 - name.length * 8 / 2))
    cmds.push(`TEXT ${x},${y},"2",0,1,1,"${safe(name)}"`)
  }

  cmds.push(`PRINT 1,1`, '')
  return iconv.encode(cmds.join('\r\n'), 'cp874')
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', printer: `${PRINTER_IP}:${PRINTER_PORT}` })
})

app.post('/print', async (req, res) => {
  const { orderId, platform, items = [], labelSettings = {}, storeName } = req.body

  if (!items.length) {
    return res.status(400).json({ error: 'No items to print' })
  }

  const copies = parseInt(labelSettings.copies ?? 1)

  // แปลง refill value เป็น string ชื่อ
  const toRefillName = (v) => {
    if (v == null) return ''
    if (typeof v === 'string') return v
    if (typeof v === 'object') return v.name || v.label || v.value || ''
    return String(v)
  }

  // ดึง refill list จาก item (เสมอ array)
  const getRefillList = (item) => {
    const refills = item.item_options?.refill
    if (!refills) return []
    const arr = Array.isArray(refills) ? refills : [refills]
    return arr.map(toRefillName).filter(Boolean)
  }

  // totalLabels = แต่ละ unit × (1 label ปกติ + N label refill)
  const totalLabels = items.reduce((s, item) => {
    const qty = item.qty ?? 1
    return s + qty * (1 + getRefillList(item).length)
  }, 0)

  const buffers = []
  let labelIdx  = 1

  for (const item of items) {
    const qty        = item.qty ?? 1
    const refillList = getRefillList(item)

    for (let q = 0; q < qty; q++) {
      // ── Label ปกติ ──
      for (let c = 0; c < copies; c++) {
        const buf = labelSettings.layout
          ? buildLabelFromLayout(item, orderId, platform, labelIdx, totalLabels, labelSettings.layout, storeName, labelSettings.labelW, labelSettings.labelH)
          : buildLabel(item, orderId, platform, labelIdx, totalLabels, labelSettings, storeName)
        buffers.push(buf)
      }
      labelIdx++

      // ── Label Refill (1 ใบต่อ 1 refill ที่เลือก) ──
      for (const refillName of refillList) {
        const refillItem = {
          ...item,
          name: refillName,
          item_options: { ...item.item_options, refill: null },
        }
        for (let c = 0; c < copies; c++) {
          const buf = labelSettings.layout
            ? buildLabelFromLayout(refillItem, orderId, platform, labelIdx, totalLabels, labelSettings.layout, storeName, labelSettings.labelW, labelSettings.labelH)
            : buildLabel(refillItem, orderId, platform, labelIdx, totalLabels, labelSettings, storeName)
          buffers.push(buf)
        }
        labelIdx++
      }
    }
  }

  try {
    await printRaw(Buffer.concat(buffers))
    console.log(`[PRINT] order=${orderId} platform=${platform} labels=${buffers.length}`)
    res.json({ success: true, labelsCount: buffers.length })
  } catch (err) {
    console.error('[PRINT ERROR]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(SERVER_PORT, '0.0.0.0', () => {
  console.log(`\nCocoa Print Server (TSPL mode)`)
  console.log(`  Listening : http://0.0.0.0:${SERVER_PORT}`)
  console.log(`  Printer   : ${PRINTER_IP}:${PRINTER_PORT}`)
  console.log(`\nรอรับ print job จาก Cocoa POS...\n`)
})
