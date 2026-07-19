require('dotenv').config({ path: require('path').join(__dirname, '.env') })
const express = require('express')
const cors    = require('cors')
const net     = require('net')
const iconv   = require('iconv-lite')
const fs      = require('fs')
const { exec } = require('child_process')

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

// MAC address ของเครื่องพิมพ์ label ตัวจริง (ตั้งใน .env) — ใช้ยืนยันตัวตนก่อนสลับ IP อัตโนมัติ
// ป้องกันปัญหา: มีอุปกรณ์อื่น (เช่นเครื่องพิมพ์เอกสาร) เปิดพอร์ตเดียวกันไว้ แล้วระบบสลับไปยิงผิดเครื่อง
const PRINTER_MAC = (process.env.PRINTER_MAC || '').toLowerCase().replace(/-/g, ':')

// เช็ค MAC address ของ IP ที่เจอ ผ่าน ARP table ของ Windows
function getMacForIp(ip) {
  return new Promise((resolve) => {
    exec(`arp -a ${ip}`, (err, stdout) => {
      if (err || !stdout) return resolve(null)
      const match = stdout.match(/([0-9a-f]{2}(-[0-9a-f]{2}){5})/i)
      resolve(match ? match[1].toLowerCase().replace(/-/g, ':') : null)
    })
  })
}

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
  console.log(`[DISCOVER] พบอุปกรณ์เปิดพอร์ต ${PRINTER_PORT}: ${found.join(', ')}`)

  // ถ้าตั้ง PRINTER_MAC ไว้ ต้องยืนยัน MAC ตรงกันก่อนสลับ IP เท่านั้น
  if (PRINTER_MAC) {
    for (const ip of found) {
      const mac = await getMacForIp(ip)
      if (mac === PRINTER_MAC) {
        console.log(`[DISCOVER] ยืนยัน MAC ตรงกับเครื่องพิมพ์ (${mac}) — ใช้ ${ip}`)
        return ip
      }
    }
    console.warn(`[DISCOVER] ไม่พบอุปกรณ์ที่ MAC ตรงกับ PRINTER_MAC (${PRINTER_MAC}) ในบรรดา ${found.join(', ')} — ยกเลิกการสลับ IP อัตโนมัติ กรุณาตรวจสอบเครื่องพิมพ์ด้วยตนเอง`)
    return null
  }

  console.warn('[DISCOVER] ยังไม่ได้ตั้งค่า PRINTER_MAC ใน .env — ใช้ผลลัพธ์แรกที่เจอโดยไม่ยืนยันตัวตน (เสี่ยงสลับผิดเครื่อง) แนะนำให้ตั้ง PRINTER_MAC เพื่อความปลอดภัย')
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

// ─── Text wrapping helpers ────────────────────────────────────────────────────
// ป้องกันข้อความยาว (เช่น รวมตัวเลือกเสริมหลายรายการ) ล้นขอบฉลาก — ขึ้นบรรทัดใหม่แทน
function wrapAsciiLines(content, maxWidthDots, cw) {
  const maxChars = Math.max(4, Math.floor(maxWidthDots / cw))
  if (content.length <= maxChars) return [content]
  const words = content.split(' ')
  const lines = []
  let cur = ''
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w
    if (candidate.length > maxChars) {
      if (cur) lines.push(cur)
      let rest = w
      while (rest.length > maxChars) {
        lines.push(rest.slice(0, maxChars))
        rest = rest.slice(maxChars)
      }
      cur = rest
    } else {
      cur = candidate
    }
  }
  if (cur) lines.push(cur)
  return lines
}

let _measureCanvas = null
function measureThaiWidth(text, font) {
  if (!nCanvas) return text.length * 10
  if (!_measureCanvas) _measureCanvas = nCanvas.createCanvas(10, 10)
  const ctx = _measureCanvas.getContext('2d')
  ctx.font = font
  return ctx.measureText(text).width
}

function wrapThaiLines(content, maxWidthDots, font) {
  if (measureThaiWidth(content, font) <= maxWidthDots) return [content]
  const words = content.split(' ')
  const lines = []
  let cur = ''
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w
    if (measureThaiWidth(candidate, font) > maxWidthDots) {
      if (cur) lines.push(cur)
      let rest = w
      while (rest && measureThaiWidth(rest, font) > maxWidthDots) {
        let cut = rest.length
        while (cut > 1 && measureThaiWidth(rest.slice(0, cut), font) > maxWidthDots) cut--
        lines.push(rest.slice(0, cut))
        rest = rest.slice(cut)
      }
      cur = rest
    } else {
      cur = candidate
    }
  }
  if (cur) lines.push(cur)
  return lines
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
      case 'store_name': return storeName || 'BSK coffee'
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

    const xBase  = Math.round(field.x / 100 * wDot)
    const yBase  = Math.round(field.y / 100 * hDot)
    const margin = 4
    // ความกว้างที่พิมพ์ได้จริงตามตำแหน่ง/การจัดวาง — ป้องกันข้อความยาวล้นขอบฉลาก (ขึ้นบรรทัดใหม่แทน)
    const maxWidth = field.align === 'center'
      ? Math.max(30, 2 * Math.min(xBase, wDot - xBase) - margin)
      : field.align === 'right'
        ? Math.max(30, xBase - margin)
        : Math.max(30, wDot - xBase - margin)

    if (hasThai(content) && nCanvas && thaiFont) {
      const px    = fontSizeToPx(field.fontSize)
      const font  = `${px}px Thai`
      const lines = wrapThaiLines(content, maxWidth, font)
      let y = yBase
      for (const line of lines) {
        const bmp = renderThaiToBitmap(line, xBase, y, field.fontSize, field.align)
        if (!bmp) break
        chunks.push(enc(bmp.cmd))
        chunks.push(bmp.data)
        chunks.push(Buffer.from('\r\n'))
        y += bmp.th + 3
      }
      continue
    }

    const { font, xm, ym, cw } = getFontParams(field.fontSize)
    const lineH = fontSizeToPx(field.fontSize) + 8
    const lines = wrapAsciiLines(content, maxWidth, cw)
    let y = yBase
    for (const line of lines) {
      const textW = line.length * cw
      let x = xBase
      if (field.align === 'center') x = Math.max(0, xBase - Math.round(textW / 2))
      if (field.align === 'right')  x = Math.max(0, xBase - textW)
      addLine(`TEXT ${x},${y},"${font}",0,${xm},${ym},"${safe(line)}"`)
      y += lineH
    }
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
    const content  = opts.join(' / ')
    const maxWidth = Math.max(30, LABEL_W - 16) // เว้นขอบซ้ายขวาเล็กน้อย ป้องกันล้นขอบฉลาก
    if (hasThai(content) && nCanvas && thaiFont) {
      const px    = fontSizeToPx(10)
      const font  = `${px}px Thai`
      const lines = wrapThaiLines(content, maxWidth, font)
      for (const line of lines) {
        const bmp = renderThaiToBitmap(line, Math.round(LABEL_W / 2), y, 10, 'center')
        if (!bmp) break
        addBmp(bmp); y += bmp.th + 4
      }
    } else {
      const lines = wrapAsciiLines(content, maxWidth, 8)
      for (const line of lines) {
        const x = Math.max(0, Math.round(LABEL_W / 2 - line.length * 8 / 2))
        addLine(`TEXT ${x},${y},"2",0,1,1,"${safe(line)}"`)
        y += 25
      }
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
    const name = storeName || 'BSK coffee'
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

  // นโยบายฉลาก: 1 เมนู (1 หน่วย/แก้ว) = 1 ใบเสมอ ไม่ว่าจะติ๊กตัวเลือกเสริมกี่รายการ/กี่จำนวนก็ตาม
  // (milk, coffee bean, sweetness, add-on ฯลฯ) — ทุกตัวเลือกที่เลือกจะโชว์เป็นข้อความรวมในฉลากใบเดียว
  // (ดู getContent('options') ใน buildLabelFromLayout/buildLabel ด้านบน ที่รวม optionGroups ทุกกลุ่มเป็น text อยู่แล้ว)
  const totalLabels = items.reduce((s, item) => s + (item.qty ?? 1) * copies, 0)

  const buffers = []
  let labelIdx  = 1

  for (const item of items) {
    const qty = item.qty ?? 1

    for (let q = 0; q < qty; q++) {
      for (let c = 0; c < copies; c++) {
        const buf = labelSettings.layout
          ? buildLabelFromLayout(item, orderId, platform, labelIdx, totalLabels, labelSettings.layout, storeName, labelSettings.labelW, labelSettings.labelH)
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

// หมายเหตุ: BSK ไม่ใช้ AI Reporter ใน print-server (รายงานรันผ่าน Vercel cron แทน)
// จึงไม่มี route /report/send ในเวอร์ชันนี้ — ต่างจาก Cocoa House เดิม

// ─── Keep-alive heartbeat ─────────────────────────────────────────────────────
// เครื่องพิมพ์ label บางรุ่นมีโหมด power-save/auto-sleep ที่ตัดวงจรเน็ตเวิร์กเมื่อไม่มีการใช้งานนาน
// heartbeat นี้จะยิง TCP probe เบาๆ (connect แล้วปิดทันที ไม่ส่งข้อมูลพิมพ์) ไปหาเครื่องพิมพ์เป็นระยะ
// เพื่อ (1) มี traffic สม่ำเสมอ ช่วยลดโอกาสเครื่องพิมพ์เข้าโหมด idle/sleep เอง
// (2) log สถานะ online/offline ให้เห็นว่าเครื่องพิมพ์หลุดตอนไหน (ไม่ได้การันตี 100% ถ้าเครื่องพิมพ์
//     ตั้ง auto power off แบบ hard sleep ไว้ — กรณีนั้นต้องปิด/ปรับที่เมนูตัวเครื่องพิมพ์เอง)
const HEARTBEAT_INTERVAL = 90_000 // 90 วินาที
let printerWasOnline = null // null = ยังไม่เคย probe

async function heartbeat() {
  try {
    await testPrinterTcp(3000)
    if (printerWasOnline === false) {
      console.log(`[HEARTBEAT] เครื่องพิมพ์กลับมา online — ${PRINTER_IP}:${PRINTER_PORT}`)
    }
    printerWasOnline = true
  } catch (err) {
    if (printerWasOnline !== false) {
      console.warn(`[HEARTBEAT] เครื่องพิมพ์ offline — ${PRINTER_IP}:${PRINTER_PORT} (${err.message})`)
    }
    printerWasOnline = false
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(SERVER_PORT, '0.0.0.0', () => {
  console.log(`\nBSK coffee Print Server (TSPL mode)`)
  console.log(`  Listening : http://0.0.0.0:${SERVER_PORT}`)
  console.log(`  Printer   : ${PRINTER_IP}:${PRINTER_PORT}`)
  console.log(`\nรอรับ print job จาก BSK POS...\n`)

  heartbeat()
  setInterval(heartbeat, HEARTBEAT_INTERVAL)
})
