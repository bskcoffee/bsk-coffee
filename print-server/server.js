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
        const buf = buildLabel(item, orderId, platform, labelIdx, totalLabels, labelSettings, storeName)
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
