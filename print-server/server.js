require('dotenv').config({ path: require('path').join(__dirname, '.env') })
const express = require('express')
const cors    = require('cors')
const net     = require('net')
const iconv   = require('iconv-lite')
const fs      = require('fs')

// ─── Thai bitmap rendering ────────────────────────────────────────────────────
let nCanvas = null, thaiFont = false
try {
  nCanvas = require('@napi-rs/canvas')
  const THAI_FONT = 'C:\\Windows\\Fonts\\tahoma.ttf'
  if (fs.existsSync(THAI_FONT)) {
    nCanvas.GlobalFonts.registerFromPath(THAI_FONT, 'Thai')
    thaiFont = true
    console.log('[FONT] Thai (Tahoma) loaded OK')
  } else {
    console.warn('[FONT] Tahoma not found — Thai text may be garbled')
  }
} catch (e) {
  console.warn('[FONT] @napi-rs/canvas unavailable:', e.message)
}

const hasThai = (str) => /[฀-๿]/.test(String(str ?? ''))

const app = express()
app.use(cors())
app.use(express.json())

let PRINTER_IP     = process.env.PRINTER_IP   || '192.168.1.100'
const PRINTER_PORT = parseInt(process.env.PRINTER_PORT || '9100')
const SERVER_PORT  = parseInt(process.env.SERVER_PORT  || '3001')
const path         = require('path')

// ─── Auto-discovery: scan subnet for printer on PRINTER_PORT ─────────────────
let lastDiscoveryAt = 0
const DISCOVERY_COOLDOWN = 60_000   // ไม่ scan ถี่กว่า 1 นาที

async function discoverPrinter() {
  const now = Date.now()
  if (now - lastDiscoveryAt < DISCOVERY_COOLDOWN) {
    console.log('[DISCOVER] Cooldown active — skipping scan')
    return null
  }
  lastDiscoveryAt = now

  const prefix = PRINTER_IP.split('.').slice(0, 3).join('.')
  console.log(`[DISCOVER] Scanning ${prefix}.1-254:${PRINTER_PORT} ...`)

  const results = await Promise.allSettled(
    Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`).map(ip =>
      new Promise((resolve, reject) => {
        const s = new net.Socket()
        s.setTimeout(400)
        s.connect(PRINTER_PORT, ip, () => { s.destroy(); resolve(ip) })
        s.on('error',   () => { s.destroy(); reject() })
        s.on('timeout', () => { s.destroy(); reject() })
      })
    )
  )

  const found = results.filter(r => r.status === 'fulfilled').map(r => r.value)
  if (found.length === 0) {
    console.warn('[DISCOVER] No printer found on subnet')
    return null
  }
  console.log(`[DISCOVER] Found: ${found.join(', ')} — using ${found[0]}`)
  return found[0]
}

function updatePrinterIp(newIp) {
  PRINTER_IP = newIp
  try {
    const envPath = path.join(__dirname, '.env')
    let content = fs.readFileSync(envPath, 'utf8')
    content = content.replace(/^PRINTER_IP=.*/m, `PRINTER_IP=${newIp}`)
    fs.writeFileSync(envPath, content)
    console.log(`[DISCOVER] .env updated → PRINTER_IP=${newIp}`)
  } catch (e) {
    console.warn('[DISCOVER] Could not update .env:', e.message)
  }
}

// ─── Test TCP reachability to printer ────────────────────────────────────────
function testPrinterTcp(timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    socket.setTimeout(timeoutMs)
    socket.connect(PRINTER_PORT, PRINTER_IP, () => {
      socket.destroy()
      resolve()
    })
    socket.on('error', (err) => { socket.destroy(); reject(err) })
    socket.on('timeout', () => { socket.destroy(); reject(new Error('Printer TCP timeout')) })
  })
}

// ─── Send raw bytes to printer via TCP (with 1 auto-retry + auto-discovery) ──
function printRaw(buffer) {
  const attempt = (retriesLeft, allowDiscover = true) =>
    new Promise((resolve, reject) => {
      const socket = new net.Socket()
      socket.setTimeout(8000)
      socket.connect(PRINTER_PORT, PRINTER_IP, () => {
        const flushed = socket.write(buffer)
        if (flushed) socket.end()
      })
      socket.on('drain', () => socket.end())
      socket.on('close', () => resolve())
      socket.on('error', async (err) => {
        socket.destroy()
        if (retriesLeft > 0) {
          console.warn(`[PRINT] error — retrying in 2s (${retriesLeft} left): ${err.message}`)
          setTimeout(() => attempt(retriesLeft - 1).then(resolve).catch(reject), 2000)
        } else if (allowDiscover) {
          console.warn('[PRINT] All retries failed — starting auto-discovery...')
          const newIp = await discoverPrinter()
          if (newIp) { updatePrinterIp(newIp); attempt(1, false).then(resolve).catch(reject) }
          else reject(err)
        } else {
          reject(err)
        }
      })
      socket.on('timeout', async () => {
        socket.destroy()
        if (retriesLeft > 0) {
          console.warn(`[PRINT] timeout — retrying in 2s (${retriesLeft} left)`)
          setTimeout(() => attempt(retriesLeft - 1).then(resolve).catch(reject), 2000)
        } else if (allowDiscover) {
          console.warn('[PRINT] All retries timed out — starting auto-discovery...')
          const newIp = await discoverPrinter()
          if (newIp) { updatePrinterIp(newIp); attempt(1, false).then(resolve).catch(reject) }
          else reject(new Error('Printer connection timed out'))
        } else {
          reject(new Error('Printer connection timed out'))
        }
      })
    })
  return attempt(1)
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

// ─── Thai bitmap helper ───────────────────────────────────────────────────────
function fontSizeToPx(sz) {
  if (sz >= 16) return 28
  if (sz >= 13) return 20
  if (sz >= 10) return 16
  return 12
}

// Render Thai text to TSPL BITMAP command (absolute x/y in dots)
function renderThaiToBitmap(text, xAbs, yAbs, fontSizeHint, align) {
  if (!nCanvas || !thaiFont) return null
  const px   = fontSizeToPx(fontSizeHint)
  const font = `${px}px Thai`

  const mc   = nCanvas.createCanvas(4000, px * 3)
  const mctx = mc.getContext('2d')
  mctx.font  = font
  const tw   = Math.ceil(mctx.measureText(text).width) + 4
  const th   = px + Math.ceil(px * 0.4) + 2

  const c   = nCanvas.createCanvas(tw, th)
  const ctx = c.getContext('2d')
  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, tw, th)
  ctx.fillStyle = 'black'
  ctx.font      = font
  ctx.fillText(text, 2, px)

  const img = ctx.getImageData(0, 0, tw, th)
  const bpr = Math.ceil(tw / 8)
  const buf = Buffer.alloc(bpr * th, 0)
  for (let r = 0; r < th; r++) {
    for (let col = 0; col < tw; col++) {
      const i = (r * tw + col) * 4
      if ((img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3 < 128) {
        buf[r * bpr + Math.floor(col / 8)] |= (1 << (7 - (col % 8)))
      }
    }
  }

  let x = xAbs
  if (align === 'center') x = Math.max(0, xAbs - Math.floor(tw / 2))
  if (align === 'right')  x = Math.max(0, xAbs - tw)

  return { cmd: `BITMAP ${x},${yAbs},${bpr},${th},0,`, data: buf, tw, th }
}

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
        // กลุ่มตัวเลือกเสริม (menu_option_groups) — ที่แอดมินสร้างเองจากหน้าจัดการเมนู
        if (Array.isArray(o.optionGroups)) {
          for (const g of o.optionGroups) {
            for (const c of (g.choices ?? [])) {
              if (c.label) opts.push(c.qty > 1 ? `${c.label} x${c.qty}` : c.label)
            }
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

  const chunks  = []
  const enc     = (s) => iconv.encode(s, 'cp874')
  const addLine = (s) => chunks.push(enc(s + '\r\n'))

  addLine(`SIZE ${wMM} mm, ${hMM} mm`)
  addLine(`GAP 2 mm, 0 mm`)
  addLine(`DIRECTION 1`)
  addLine(`CODEPAGE 874`)
  addLine(`CLS`)

  for (const field of layout.filter(f => f.visible)) {
    if (field.type === 'divider') {
      const y = Math.round(field.y / 100 * hDot)
      addLine(`BAR 0,${y},${wDot},2`)
      continue
    }

    const content = getContent(field)
    if (!content) continue

    if (hasThai(content)) {
      const bmp = renderThaiToBitmap(
        content,
        Math.round(field.x / 100 * wDot),
        Math.round(field.y / 100 * hDot),
        field.fontSize, field.align
      )
      if (bmp) {
        chunks.push(enc(bmp.cmd))
        chunks.push(bmp.data)
        chunks.push(Buffer.from('\r\n'))
        continue
      }
    }

    const { font, xm, ym, cw } = getFontParams(field.fontSize)
    const xBase = Math.round(field.x / 100 * wDot)
    const y     = Math.round(field.y / 100 * hDot)
    const textW = content.length * cw
    let x = xBase
    if (field.align === 'center') x = Math.max(0, xBase - Math.round(textW / 2))
    if (field.align === 'right')  x = Math.max(0, xBase - textW)

    addLine(`TEXT ${x},${y},"${font}",0,${xm},${ym},"${safe(content)}"`)
  }

  addLine(`PRINT 1,1`)
  addLine('')
  return Buffer.concat(chunks)
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
  const o       = item.item_options ?? {}
  const chunks  = []
  const enc     = (s) => iconv.encode(s, 'cp874')
  const addLine = (s) => chunks.push(enc(s + '\r\n'))
  const addBmp  = (bmp) => {
    chunks.push(enc(bmp.cmd)); chunks.push(bmp.data); chunks.push(Buffer.from('\r\n'))
  }

  for (const h of tsplHeader()) addLine(h)
  let y = 10

  // Menu name
  if (s.showMenuName) {
    const big      = s.menuNameSize === 'large'
    const fontSize = big ? 16 : 13
    if (hasThai(item.name)) {
      const bmp = renderThaiToBitmap(item.name, Math.round(LABEL_W / 2), y, fontSize, 'center')
      if (bmp) { addBmp(bmp); y += bmp.th + (big ? 6 : 4) }
    } else {
      const { font, xm, ym, cw } = getFontParams(fontSize)
      const x = Math.max(0, Math.round(LABEL_W / 2 - item.name.length * cw / 2))
      addLine(`TEXT ${x},${y},"${font}",0,${xm},${ym},"${safe(item.name)}"`)
      y += big ? 50 : 30
    }
  }

  // Options
  const opts = []
  if (s.showOptions) {
    if (s.showOptionMilk   && o.milk)             opts.push(o.milk)
    if (s.showOptionSweet  && o.sweetness != null) opts.push(`${o.sweetness}%`)
    if (o.packaging)                               opts.push(o.packaging)
    if (s.showOptionRefill && o.refill)            opts.push('Refill')
    if (Array.isArray(o.optionGroups)) {
      for (const g of o.optionGroups) {
        for (const c of (g.choices ?? [])) {
          if (c.label) opts.push(c.qty > 1 ? `${c.label} x${c.qty}` : c.label)
        }
      }
    }
    if (s.showOptionNote   && o.note)              opts.push(o.note)
  }
  if (opts.length > 0) {
    const content = opts.join(' / ')
    if (hasThai(content)) {
      const bmp = renderThaiToBitmap(content, Math.round(LABEL_W / 2), y, 10, 'center')
      if (bmp) { addBmp(bmp); y += bmp.th + 4 }
    } else {
      const x = Math.max(0, Math.round(LABEL_W / 2 - content.length * 8 / 2))
      addLine(`TEXT ${x},${y},"2",0,1,1,"${safe(content)}"`)
      y += 25
    }
  }

  // Divider
  addLine(`BAR 0,${y},${LABEL_W},2`)
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
    addLine(`TEXT 5,${y},"2",0,1,1,"${safe(bottom.join('  '))}"`)
  }

  // Store name
  if (s.showStoreName) {
    y += 25
    const name = storeName || 'Cocoa House'
    const x = Math.max(0, Math.round(LABEL_W / 2 - name.length * 8 / 2))
    addLine(`TEXT ${x},${y},"2",0,1,1,"${safe(name)}"`)
  }

  addLine(`PRINT 1,1`)
  addLine('')
  return Buffer.concat(chunks)
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  let printerOnline = false
  let printerError  = null
  try {
    await testPrinterTcp()
    printerOnline = true
  } catch (err) {
    printerError = err.message
  }
  res.json({
    status: 'ok',
    printer: `${PRINTER_IP}:${PRINTER_PORT}`,
    printerOnline,
    ...(printerError ? { printerError } : {}),
  })
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

  // ดึง refill list จาก item (เสมอ array) — legacy field เก็บไว้เพื่อรองรับออเดอร์เก่า
  const getRefillList = (item) => {
    const refills = item.item_options?.refill
    if (!refills) return []
    const arr = Array.isArray(refills) ? refills : [refills]
    return arr.map(toRefillName).filter(Boolean)
  }

  // ดึงรายชื่อ "ตัวเลือกเสริมแบบเลือกจำนวน" (multi) ที่ต้องพิมพ์แยกฉลาก 1 ใบต่อ 1 หน่วย
  // (เช่น เพิ่มถุงพรุ่งนี้ x2 → แยก 2 ใบ ไว้ติดคนละถุง/แก้ว) — กลุ่มแบบ single ไม่แยกใบ โชว์เป็นข้อความในฉลากหลักพอ
  const getMultiLabelList = (item) => {
    const groups = item.item_options?.optionGroups
    if (!Array.isArray(groups)) return []
    const list = []
    for (const g of groups) {
      if (g.selectionType !== 'multi') continue
      for (const c of (g.choices ?? [])) {
        const qty = c.qty ?? 1
        for (let i = 0; i < qty; i++) list.push(c.label)
      }
    }
    return list
  }

  // totalLabels = แต่ละ unit × (1 label ปกติ + N label refill/ตัวเลือกเสริม)
  const totalLabels = items.reduce((s, item) => {
    const qty = item.qty ?? 1
    return s + qty * (1 + getRefillList(item).length + getMultiLabelList(item).length)
  }, 0)

  const buffers = []
  let labelIdx  = 1

  for (const item of items) {
    const qty        = item.qty ?? 1
    const refillList = getRefillList(item)
    const multiList  = getMultiLabelList(item)

    for (let q = 0; q < qty; q++) {
      // ── Label ปกติ ──
      for (let c = 0; c < copies; c++) {
        const buf = labelSettings.layout
          ? buildLabelFromLayout(item, orderId, platform, labelIdx, totalLabels, labelSettings.layout, storeName, labelSettings.labelW, labelSettings.labelH)
          : buildLabel(item, orderId, platform, labelIdx, totalLabels, labelSettings, storeName)
        buffers.push(buf)
      }
      labelIdx++

      // ── Label Refill (legacy — 1 ใบต่อ 1 refill ที่เลือก, รองรับออเดอร์เก่า) ──
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

      // ── Label ตัวเลือกเสริมแบบ multi (1 ใบต่อ 1 หน่วย) ──
      for (const choiceLabel of multiList) {
        const extraItem = {
          ...item,
          name: choiceLabel,
          item_options: {
            ...item.item_options,
            // เอาเฉพาะกลุ่มแบบ single ไว้โชว์เป็นบริบทบนฉลากใบนี้ด้วย ส่วนกลุ่ม multi ตัดออก (มีฉลากของตัวเองแล้ว)
            optionGroups: (item.item_options?.optionGroups ?? []).filter(g => g.selectionType !== 'multi'),
          },
        }
        for (let c = 0; c < copies; c++) {
          const buf = labelSettings.layout
            ? buildLabelFromLayout(extraItem, orderId, platform, labelIdx, totalLabels, labelSettings.layout, storeName, labelSettings.labelW, labelSettings.labelH)
            : buildLabel(extraItem, orderId, platform, labelIdx, totalLabels, labelSettings, storeName)
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

// ─── AI Reporter (ปิดแล้ว — ย้ายไป Vercel cron แทน) ─────────────────────────
// let aiReporter = null
// try { aiReporter = require('./ai-reporter') } catch (e) { console.warn('[AI Reporter] Failed to load:', e.message) }

// POST /report/send  — manual trigger จาก cocoa-house web app
// body: { date: 'YYYY-MM-DD' }
app.post('/report/send', async (req, res) => {
  if (!aiReporter) return res.status(503).json({ error: 'AI Reporter not loaded' })
  const { date } = req.body
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date required (YYYY-MM-DD)' })
  }
  try {
    await aiReporter.runReport(date)
    res.json({ ok: true, date })
  } catch (err) {
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
