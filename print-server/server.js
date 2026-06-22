require('dotenv').config()
const express = require('express')
const cors    = require('cors')
const net     = require('net')

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

// ─── ESC/POS helpers ──────────────────────────────────────────────────────────
const ESC = '\x1b'
const GS  = '\x1d'
const LF  = '\x0a'

const CMD = {
  INIT:        ESC + '@',
  BOLD_ON:     ESC + 'E\x01',
  BOLD_OFF:    ESC + 'E\x00',
  SIZE_BIG:    ESC + '!\x11',   // double-height + emphasized
  SIZE_MED:    ESC + '!\x01',   // emphasized only
  SIZE_NORM:   ESC + '!\x00',   // normal
  ALIGN_LEFT:  ESC + 'a\x00',
  ALIGN_CENTER:ESC + 'a\x01',
  ALIGN_RIGHT: ESC + 'a\x02',
  CUT:         GS  + 'V\x41\x03',  // partial cut
}

function alignCmd(textAlign) {
  if (textAlign === 'left')  return CMD.ALIGN_LEFT
  if (textAlign === 'right') return CMD.ALIGN_RIGHT
  return CMD.ALIGN_CENTER
}

// ─── Build ESC/POS buffer for ONE label ──────────────────────────────────────
function buildLabel(item, orderId, platform, labelIdx, totalLabels, settings, storeName) {
  const s = {
    showMenuName:    true,
    menuNameSize:    'large',
    showOptions:     true,
    showOptionMilk:  true,
    showOptionSweet: true,
    showOptionRefill:true,
    showOptionNote:  true,
    showOrderId:     true,
    showQty:         true,
    showIndex:       true,
    showTime:        true,
    showStoreName:   false,
    textAlign:       'center',
    ...settings,
  }

  let buf = CMD.INIT + alignCmd(s.textAlign)

  // ── ชื่อเมนู ──
  if (s.showMenuName) {
    buf += s.menuNameSize === 'large' ? CMD.SIZE_BIG : CMD.SIZE_MED
    buf += CMD.BOLD_ON
    buf += item.name + LF
    buf += CMD.BOLD_OFF + CMD.SIZE_NORM
  }

  // ── Options ──
  const opts = []
  const o = item.item_options ?? {}
  if (s.showOptions) {
    if (s.showOptionMilk   && o.milk)             opts.push(o.milk)
    if (s.showOptionSweet  && o.sweetness != null) opts.push(`${o.sweetness}%`)
    if (s.showOptionRefill && o.refill) {
      // refill อาจเป็น array หรือ object
      if (Array.isArray(o.refill))        opts.push(o.refill.map(r => r.name ?? r).join(', '))
      else if (typeof o.refill === 'object') opts.push(o.refill.name ?? 'Refill')
      else                                opts.push('Refill')
    }
    if (s.showOptionNote   && o.note)             opts.push(o.note)
  }
  if (opts.length > 0) {
    buf += CMD.SIZE_NORM + opts.join(' \xb7 ') + LF  // · separator
  }

  // ── Divider ──
  buf += CMD.ALIGN_LEFT + '-'.repeat(32) + LF + alignCmd(s.textAlign)

  // ── Bottom row ──
  const bottomParts = []
  if (s.showOrderId && orderId)  bottomParts.push(`#${orderId}`)
  if (s.showQty)                 bottomParts.push(`x${item.qty ?? 1}`)
  if (s.showTime) {
    const now = new Date()
    const t = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
    bottomParts.push(t)
  }
  if (s.showIndex) bottomParts.push(`${labelIdx}/${totalLabels}`)

  if (bottomParts.length > 0) {
    buf += CMD.SIZE_NORM + bottomParts.join('  ') + LF
  }

  // ── Store name ──
  if (s.showStoreName) {
    buf += CMD.ALIGN_CENTER + CMD.SIZE_NORM + (storeName || 'Cocoa House') + LF
  }

  // ── Feed + cut ──
  buf += LF + LF + CMD.CUT

  return Buffer.from(buf, 'binary')
}

// ─── Build label from new layout format (drag-editor) ────────────────────────
function buildLabelFromLayout(item, orderId, platform, labelIdx, totalLabels, layout, storeName) {
  const o = item.item_options ?? {}

  const getContent = (field) => {
    switch (field.type) {
      case 'menu_name':  return item.name || ''
      case 'options': {
        const opts = []
        if (o.milk)             opts.push(o.milk)
        if (o.sweetness != null)opts.push(`${o.sweetness}%`)
        if (o.refill)           opts.push('Refill')
        if (o.note)             opts.push(o.note)
        return opts.join(' \xb7 ')
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
      case 'custom':     return field.text || ''
      default:           return ''
    }
  }

  // Sort visible fields by Y — ESC/POS prints line by line
  const LINE_THRESHOLD = 8  // fields within 8% Y = same print line
  const visible = layout
    .filter(f => f.visible)
    .sort((a, b) => a.y - b.y)

  // Group into print lines
  const lines = []
  for (const field of visible) {
    const last = lines[lines.length - 1]
    if (!last || Math.abs(field.y - last[0].y) >= LINE_THRESHOLD) {
      lines.push([field])
    } else {
      last.push(field)
    }
  }

  let buf = CMD.INIT
  const LINE_W = 32  // characters per line

  for (const lineFields of lines) {
    // Divider line
    if (lineFields.length === 1 && lineFields[0].type === 'divider') {
      buf += CMD.ALIGN_LEFT + '-'.repeat(LINE_W) + LF
      continue
    }

    // Filter out dividers mixed with text (edge case)
    const textFields = lineFields.filter(f => f.type !== 'divider').sort((a, b) => a.x - b.x)
    if (!textFields.length) continue

    if (textFields.length === 1) {
      const f = textFields[0]
      const content = getContent(f)
      if (!content) continue
      buf += alignCmd(f.align)
      buf += f.bold ? CMD.BOLD_ON : ''
      buf += f.fontSize >= 14 ? CMD.SIZE_BIG : f.fontSize >= 11 ? CMD.SIZE_MED : CMD.SIZE_NORM
      buf += content + LF
      buf += CMD.BOLD_OFF + CMD.SIZE_NORM
    } else {
      // Multi-field line: arrange by X position
      buf += CMD.ALIGN_LEFT + CMD.SIZE_NORM
      const parts = textFields.map(f => getContent(f)).filter(Boolean)
      if (parts.length === 2) {
        const gap = Math.max(1, LINE_W - parts[0].length - parts[1].length)
        buf += parts[0] + ' '.repeat(gap) + parts[1] + LF
      } else {
        buf += parts.join('  ') + LF
      }
    }
  }

  buf += LF + LF + CMD.CUT
  return Buffer.from(buf, 'binary')
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check — ใช้ตรวจจาก LabelSettingsPage
app.get('/health', (req, res) => {
  res.json({ status: 'ok', printer: `${PRINTER_IP}:${PRINTER_PORT}` })
})

// Main print endpoint
// Body: { orderId, platform, items[], labelSettings, storeName }
app.post('/print', async (req, res) => {
  const { orderId, platform, items = [], labelSettings = {}, storeName } = req.body

  if (!items.length) {
    return res.status(400).json({ error: 'No items to print' })
  }

  const copies = parseInt(labelSettings.copies ?? 1)

  // นับ total labels = ผลรวม qty ทุก item
  const totalLabels = items.reduce((s, i) => s + (i.qty ?? 1), 0)

  const buffers = []
  let labelIdx = 1

  for (const item of items) {
    const qty = item.qty ?? 1
    for (let q = 0; q < qty; q++) {
      for (let c = 0; c < copies; c++) {
        // ใช้ layout format ใหม่ถ้ามี ไม่งั้น fallback เป็น old format
        const buf = labelSettings.layout
          ? buildLabelFromLayout(item, orderId, platform, labelIdx, totalLabels, labelSettings.layout, storeName)
          : buildLabel(item, orderId, platform, labelIdx, totalLabels, labelSettings, storeName)
        buffers.push(buf)
      }
      labelIdx++
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
  console.log(`\nCocoa Print Server`)
  console.log(`  Listening : http://0.0.0.0:${SERVER_PORT}`)
  console.log(`  Printer   : ${PRINTER_IP}:${PRINTER_PORT}`)
  console.log(`\nรอรับ print job จาก Cocoa POS...\n`)
})
