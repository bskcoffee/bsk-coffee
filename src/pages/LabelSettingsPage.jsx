import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Save, Printer, RefreshCw, CheckCircle, Wifi,
  AlignLeft, AlignCenter, AlignRight,
  Coffee, Hash, Clock, Tag, Package, SlidersHorizontal,
  FileText, Plus, X, Trash2, Calendar, Type, MessageSquare, AlertTriangle,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'

// ─── Preview base width (px) — height is computed from label aspect ratio ─────
const PW = 250

// ─── Mock data ────────────────────────────────────────────────────────────────
// ใส่ตัวอย่างกลุ่มตัวเลือกเสริม (single + multi ที่มีจำนวน) ด้วย — เพื่อให้ preview
// ตรงกับสิ่งที่จะพิมพ์จริงเมื่อลูกค้าเลือกตัวเลือกเสริมจากหน้า POS
const MOCK = {
  name: 'Cocoa Latte',
  qty: 2,
  options: {
    milk: 'นมสด', sweetness: 50, refill: false, note: 'ไม่ใส่น้ำแข็ง', packaging: 'แยกน้ำแข็ง',
    optionGroups: [
      { groupId: 'mock-1', groupName: 'ชนิดนม', choices: [{ id: 'c1', label: 'อัลมอนด์มิลค์', qty: 1 }] },
      { groupId: 'mock-2', groupName: 'เพิ่มถุงพรุ่งนี้', choices: [{ id: 'c2', label: 'เพิ่มถุงพรุ่งนี้ ตราดัชมิลค์', qty: 2 }] },
    ],
  },
  orderId: 'GF-012',
  platform: 'GRAB',
}

// ตัวอย่างแบบเรียบง่าย (ไม่มีตัวเลือกเสริม) — ไว้เทียบกับกรณีเต็มด้านบน
const MOCK_SIMPLE = {
  name: 'Cocoa Latte',
  qty: 1,
  options: { milk: null, sweetness: 100, refill: false, note: '', packaging: 'แยกน้ำแข็ง', optionGroups: null },
  orderId: 'GF-012',
  platform: 'GRAB',
}

// ─── Default layout (each field has absolute position as % of PW/PH) ─────────
const DEFAULT_LAYOUT = [
  { id: 'menu_name', type: 'menu_name', label: 'Menu Name',  visible: true,  x: 50, y: 10, fontSize: 16, bold: true,  align: 'center' },
  { id: 'options',   type: 'options',   label: 'Options',    visible: true,  x: 50, y: 38, fontSize: 10, bold: false, align: 'center' },
  { id: 'divider',   type: 'divider',   label: 'Divider',   visible: true,  x: 50, y: 53 },
  { id: 'order_id',  type: 'order_id',  label: 'Order ID',   visible: true,  x: 10, y: 63, fontSize: 9,  bold: false, align: 'left'   },
  { id: 'qty',       type: 'qty',       label: 'Quantity',      visible: true,  x: 42, y: 63, fontSize: 9,  bold: false, align: 'center' },
  { id: 'time',      type: 'time',      label: 'Time',       visible: true,  x: 65, y: 63, fontSize: 9,  bold: false, align: 'center' },
  { id: 'index',     type: 'index',     label: 'Index',      visible: true,  x: 90, y: 63, fontSize: 9,  bold: false, align: 'right'  },
  { id: 'store_name',type: 'store_name',label: 'Store Name',   visible: false, x: 50, y: 80, fontSize: 9,  bold: false, align: 'center' },
  { id: 'platform',  type: 'platform',  label: 'Platform',   visible: false, x: 50, y: 80, fontSize: 10, bold: true,  align: 'center' },
  { id: 'date',      type: 'date',      label: 'Date',     visible: false, x: 50, y: 80, fontSize: 9,  bold: false, align: 'center' },
  { id: 'note',      type: 'note',      label: 'Note',       visible: false, x: 50, y: 88, fontSize: 9,  bold: false, align: 'center' },
]

// ─── Field icons ──────────────────────────────────────────────────────────────
const FIELD_ICON = {
  menu_name:  Coffee,
  options:    SlidersHorizontal,
  divider:    Type,
  order_id:   Hash,
  qty:        Package,
  time:       Clock,
  index:      Tag,
  store_name: Tag,
  platform:   Tag,
  date:       Calendar,
  note:       MessageSquare,
  custom:     FileText,
}

// ─── Get preview content for each field type ─────────────────────────────────
function getContent(field, storeName, mock = MOCK) {
  const o = mock.options
  switch (field.type) {
    case 'menu_name': return mock.name
    case 'options': {
      const opts = []
      if (o.milk)           opts.push(o.milk)
      if (o.sweetness != null) opts.push(`${o.sweetness}%`)
      if (o.packaging)      opts.push(o.packaging)
      // กลุ่มตัวเลือกเสริม (menu_option_groups) — ให้ตรงกับ print-server/server.js เป๊ะๆ
      if (Array.isArray(o.optionGroups)) {
        for (const g of o.optionGroups) {
          for (const c of (g.choices ?? [])) {
            if (c.label) opts.push(c.qty > 1 ? `${c.label} x${c.qty}` : c.label)
          }
        }
      }
      if (o.note) opts.push(o.note)
      return opts.join(' / ') || '–'
    }
    case 'order_id':   return `#${mock.orderId}`
    case 'qty':        return `×${mock.qty}`
    case 'time':       return new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
    case 'index':      return '1/3'
    case 'store_name': return storeName || 'BSK coffee&bakery'
    case 'platform':   return mock.platform
    case 'date':       return new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
    case 'note':       return mock.options.note ? `Note : ${mock.options.note}` : ''
    case 'custom':     return field.text || '(ข้อความ)'
    default:           return ''
  }
}

// ─── ตรวจจับ field ที่ขึ้นบรรทัดใหม่แล้วอาจทับ field อื่นที่อยู่ด้านล่าง ──────────
// (ใช้สูตรความกว้าง/บรรทัดเดียวกับ LabelCanvas ทุกอย่าง เพื่อให้คำเตือนตรงกับสิ่งที่เห็นจริง)
function computeWrapOverlaps(layout, labelW, labelH, storeName, mock) {
  const MM2DOT = 203 / 25.4
  const wDot = labelW * MM2DOT
  const hDot = labelH * MM2DOT
  const visible = layout.filter(f => f.visible && f.type !== 'divider')

  const infos = visible.map(field => {
    const content = getContent(field, storeName, mock)
    const { dh, dw } = tsplMeta(field.fontSize || 9)
    const xBaseDot = (field.x / 100) * wDot
    const margin = 4
    const maxWidthDot = field.align === 'center'
      ? Math.max(30, 2 * Math.min(xBaseDot, wDot - xBaseDot) - margin)
      : field.align === 'right'
        ? Math.max(30, xBaseDot - margin)
        : Math.max(30, wDot - xBaseDot - margin)
    const lines         = wrapPreviewLines(content, maxWidthDot, dw)
    const lineHeightDot = dh + 3
    const yStartDot = (field.y / 100) * hDot
    const yEndDot   = yStartDot + (lines.length - 1) * lineHeightDot + dh
    return { field, lines, yStartDot, yEndDot }
  })

  const warnings = {}
  for (const info of infos) {
    if (info.lines.length <= 1) continue // field เดิมบรรทัดเดียวไม่ทำให้เกิดปัญหาใหม่
    const hits = infos.filter(other =>
      other.field.id !== info.field.id &&
      other.yStartDot > info.yStartDot &&
      other.yStartDot < info.yEndDot
    )
    if (hits.length > 0) warnings[info.field.id] = hits.map(h => h.field.label)
  }
  return warnings
}

// ─── Ripple ───────────────────────────────────────────────────────────────────
function useRipple() {
  const ref = useRef(null)
  const trigger = (e) => {
    const el = ref.current; if (!el) return
    const rect = el.getBoundingClientRect()
    const size = Math.max(rect.width, rect.height) * 2
    const span = document.createElement('span')
    span.style.cssText = `position:absolute;border-radius:50%;background:rgba(255,255,255,.25);
      width:${size}px;height:${size}px;
      left:${(e.clientX - rect.left) - size/2}px;top:${(e.clientY - rect.top) - size/2}px;
      animation:rippleAnim .5s linear forwards;pointer-events:none`
    el.appendChild(span); setTimeout(() => span.remove(), 500)
  }
  return { ref, trigger }
}
if (!document.getElementById('ripple-style')) {
  const st = document.createElement('style'); st.id = 'ripple-style'
  st.textContent = '@keyframes rippleAnim{to{transform:scale(4);opacity:0}}'
  document.head.appendChild(st)
}

// ─── TSPL font metrics (mirrors server.js getFontParams) ──────────────────────
// Returns dot height and char width at 203 DPI
function tsplMeta(fontSize) {
  if (fontSize >= 16) return { dh: 40, dw: 20 }  // font '3' xm=2 ym=2
  if (fontSize >= 13) return { dh: 20, dw: 10 }  // font '3' xm=1 ym=1
  if (fontSize >= 10) return { dh: 16, dw: 8  }  // font '2' xm=1 ym=1
  return                      { dh: 12, dw: 6  }  // font '1' xm=1 ym=1
}

// ─── Preview line-wrap (mirrors wrapAsciiLines/wrapThaiLines in print-server/server.js) ──
// ให้ preview ขึ้นบรรทัดใหม่เหมือนของจริงที่พิมพ์ออกมา แทนที่จะปล่อยให้ข้อความยาวล้นออกจาก canvas
function wrapPreviewLines(content, maxWidthDot, dw) {
  const maxChars = Math.max(4, Math.floor(maxWidthDot / dw))
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

// ─── Label Canvas (TSPL-accurate preview) ─────────────────────────────────────
function LabelCanvas({ layout, selectedId, onSelect, onMove, storeName, pw, ph, labelW, labelH, mock = MOCK, editable = true }) {
  const canvasRef  = useRef(null)
  const draggingId = useRef(null)
  const offset     = useRef({ x: 0, y: 0 })

  // Dot dimensions at 203 DPI
  const MM2DOT = 203 / 25.4
  const wDot   = labelW * MM2DOT
  const hDot   = labelH * MM2DOT
  const scaleX = pw / wDot
  const scaleY = ph / hDot

  // Mirror server.js alignX: given field anchor (x%), content, return left px
  const fieldLeftPx = useCallback((field, content) => {
    const { dw } = tsplMeta(field.fontSize || 9)
    const xBaseDot = (field.x / 100) * wDot
    const textWDot = content.length * dw
    let xDot = xBaseDot
    if (field.align === 'center') xDot = Math.max(0, xBaseDot - textWDot / 2)
    if (field.align === 'right')  xDot = Math.max(0, xBaseDot - textWDot)
    return xDot * scaleX
  }, [wDot, scaleX])

  // extraYPx = ระยะที่บรรทัดที่ถูกลาก (เมื่อ field ขึ้นหลายบรรทัด) เยื้องลงมาจาก field.y เดิม
  // ป้องกัน field "กระโดด" เวลาลากจากบรรทัดที่ 2/3 แทนที่จะเป็นบรรทัดแรก
  const startDrag = useCallback((e, field, extraYPx = 0) => {
    e.stopPropagation(); e.preventDefault()
    if (!editable) return
    onSelect(field.id)
    const rect = canvasRef.current.getBoundingClientRect()
    const clientX = e.touches?.[0]?.clientX ?? e.clientX
    const clientY = e.touches?.[0]?.clientY ?? e.clientY
    // Anchor the drag on the field's x% point (same as onMove uses)
    offset.current = {
      x: clientX - rect.left - (field.x / 100) * pw,
      y: clientY - rect.top  - (field.y / 100) * ph - extraYPx,
    }
    draggingId.current = field.id
  }, [onSelect, pw, ph, editable])

  useEffect(() => {
    const move = (e) => {
      if (!draggingId.current || !canvasRef.current) return
      const rect = canvasRef.current.getBoundingClientRect()
      const clientX = e.touches?.[0]?.clientX ?? e.clientX
      const clientY = e.touches?.[0]?.clientY ?? e.clientY
      const x = Math.max(0, Math.min(100, ((clientX - rect.left - offset.current.x) / pw) * 100))
      const y = Math.max(0, Math.min(95,  ((clientY - rect.top  - offset.current.y) / ph) * 100))
      onMove(draggingId.current, Math.round(x), Math.round(y))
    }
    const up = () => { draggingId.current = null }
    // pointer events ครอบคลุมทั้งเมาส์และทัช (แท็บเล็ต/iPad) ในตัวเดียว
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [onMove, pw, ph])

  return (
    <div
      ref={canvasRef}
      className="relative bg-white rounded-lg shadow-md select-none mx-auto overflow-hidden"
      style={{ width: pw, height: ph, fontFamily: 'monospace', border: '2px dashed #d1d5db', touchAction: 'none' }}
      onClick={() => onSelect(null)}
    >
      {layout.map(field => {
        if (!field.visible) return null
        const isSel = selectedId === field.id
        const selStyle = isSel ? { outline: '2px solid #3b82f6', background: 'rgba(59,130,246,0.07)', borderRadius: 3 } : {}

        if (field.type === 'divider') {
          const yPx = (field.y / 100) * ph
          return (
            <div key={field.id}
              style={{
                position: 'absolute', top: yPx, left: 4, right: 4,
                borderTop: '1.5px solid #aaa', cursor: editable ? 'ns-resize' : 'default', ...selStyle, outlineOffset: 3,
              }}
              onPointerDown={e => startDrag(e, field)}
            />
          )
        }

        const content = getContent(field, storeName, mock)
        const { dh, dw } = tsplMeta(field.fontSize || 9)
        const fontSizePx = Math.max(5, dh * scaleY)
        const yPx = (field.y / 100) * ph

        // ความกว้างที่พิมพ์ได้จริง (dots) ตามตำแหน่ง/align — สูตรเดียวกับ print-server/server.js
        // เพื่อให้ preview ขึ้นบรรทัดใหม่ตรงกับของจริงเป๊ะๆ แทนที่จะปล่อยล้น canvas
        const xBaseDot = (field.x / 100) * wDot
        const margin = 4
        const maxWidthDot = field.align === 'center'
          ? Math.max(30, 2 * Math.min(xBaseDot, wDot - xBaseDot) - margin)
          : field.align === 'right'
            ? Math.max(30, xBaseDot - margin)
            : Math.max(30, wDot - xBaseDot - margin)

        const lines         = wrapPreviewLines(content, maxWidthDot, dw)
        const lineHeightDot = dh + 3

        return (
          <div key={field.id} title={field.label}>
            {lines.map((line, i) => {
              const xPx = fieldLeftPx(field, line)
              const lineTopPx = i * lineHeightDot * scaleY
              return (
                <div key={i}
                  onPointerDown={e => startDrag(e, field, lineTopPx)}
                  style={{
                    position: 'absolute',
                    left: xPx, top: yPx + lineTopPx,
                    fontSize: fontSizePx,
                    fontWeight: field.bold ? 'bold' : 'normal',
                    lineHeight: 1, whiteSpace: 'nowrap',
                    cursor: editable ? 'grab' : 'default', padding: '0 1px', touchAction: 'none',
                    ...selStyle,
                  }}
                >
                  {line}
                </div>
              )
            })}
          </div>
        )
      })}
      <div className="absolute bottom-1 right-1.5 text-[7px] text-gray-300 pointer-events-none select-none">
        ลาก · คลิก
      </div>
    </div>
  )
}

// ─── Properties Panel ─────────────────────────────────────────────────────────
function FieldProperties({ field, onUpdate, onDelete, editable = true }) {
  if (!field) return (
    <div className="flex flex-col items-center justify-center py-5 text-center gap-2">
      <Type size={18} className="text-gray-300" />
      <p className="text-xs text-gray-400">
        {editable ? 'คลิก field บน preview เพื่อแก้ไข' : 'กด "แก้ไข" ด้านบนก่อนเพื่อเลือก field'}
      </p>
    </div>
  )

  const isCustom = field.id.startsWith('custom_')

  return (
    <div className="space-y-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-800">{field.label}</span>
        {isCustom && (
          <button onClick={onDelete} disabled={!editable} className="text-red-400 hover:text-red-600 transition-colors disabled:opacity-30 disabled:pointer-events-none">
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Custom text input */}
      {field.type === 'custom' && (
        <div>
          <label className="label text-xs">ข้อความ</label>
          <input className="input text-sm" value={field.text || ''} placeholder="พิมพ์ข้อความ..." disabled={!editable}
            onChange={e => onUpdate('text', e.target.value)} />
        </div>
      )}

      {/* Font size */}
      {field.type !== 'divider' && (
        <div>
          <label className="label text-xs">ขนาด font</label>
          <div className="flex gap-1 flex-wrap items-end">
            {[7, 8, 9, 10, 11, 12, 14, 16, 18, 20].map(sz => (
              <button key={sz} onClick={() => onUpdate('fontSize', sz)} disabled={!editable}
                aria-label={`ขนาด font ${sz}`}
                aria-pressed={field.fontSize === sz}
                className={`w-8 py-1 rounded font-medium border transition-colors disabled:opacity-40 disabled:pointer-events-none
                  ${field.fontSize === sz ? 'bg-cocoa-700 text-white border-cocoa-700' : 'bg-white text-gray-600 border-gray-200 hover:border-cocoa-300'}`}
                style={{ fontSize: Math.min(15, 9 + sz / 4) }}>
                {sz}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bold + Align */}
      {field.type !== 'divider' && (
        <div className="flex items-end gap-4">
          <div>
            <label className="label text-xs">สไตล์</label>
            <button onClick={() => onUpdate('bold', !field.bold)} disabled={!editable}
              aria-label="ตัวหนา" aria-pressed={!!field.bold}
              className={`px-3 py-1.5 rounded-lg border text-sm font-bold transition-colors disabled:opacity-40 disabled:pointer-events-none
                ${field.bold ? 'bg-cocoa-700 text-white border-cocoa-700' : 'bg-white text-gray-600 border-gray-200 hover:border-cocoa-300'}`}>
              B
            </button>
          </div>
          <div>
            <label className="label text-xs">จัดตำแหน่ง</label>
            <div className="flex gap-1">
              {[['left', AlignLeft, 'ชิดซ้าย'], ['center', AlignCenter, 'กึ่งกลาง'], ['right', AlignRight, 'ชิดขวา']].map(([val, Icon, labelTh]) => (
                <button key={val} onClick={() => onUpdate('align', val)} disabled={!editable}
                  aria-label={`จัดตำแหน่ง ${labelTh}`} aria-pressed={field.align === val}
                  className={`p-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:pointer-events-none
                    ${field.align === val ? 'bg-cocoa-700 text-white border-cocoa-700' : 'bg-white text-gray-600 border-gray-200 hover:border-cocoa-300'}`}>
                  <Icon size={13} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* X / Y sliders */}
      <div className="grid grid-cols-2 gap-3">
        {[['X', 'x', 0, 100], ['Y', 'y', 0, 95]].map(([lbl, key, min, max]) => (
          <div key={key}>
            <div className="flex justify-between mb-1">
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{lbl}</label>
              <span className="text-[10px] text-gray-400">{Math.round(field[key])}%</span>
            </div>
            <input type="range" min={min} max={max} value={Math.round(field[key])} disabled={!editable}
              onChange={e => onUpdate(key, parseInt(e.target.value))}
              className="w-full h-1.5 accent-cocoa-700 disabled:opacity-40" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Toggle Switch ─────────────────────────────────────────────────────────────
function Toggle({ on }) {
  return (
    <div className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${on ? 'bg-cocoa-600' : 'bg-gray-200'}`}>
      <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function LabelSettingsPage() {
  const { addToast } = useToast()
  const [layout,     setLayout]     = useState(DEFAULT_LAYOUT.map(f => ({ ...f })))
  const [selectedId, setSelectedId] = useState(null)
  const [storeName,  setStoreName]  = useState('BSK coffee&bakery')
  const [copies,     setCopies]     = useState(1)
  const [printerIp,  setPrinterIp]  = useState('192.168.1.100')
  const [printerPort,setPrinterPort]= useState(3001)
  const [labelW,     setLabelW]     = useState(50)
  const [labelH,     setLabelH]     = useState(30)
  const [saveStatus, setSaveStatus] = useState('idle')
  const [testStatus, setTestStatus] = useState('idle')
  const [loading,    setLoading]    = useState(true)
  const [editMode,   setEditMode]   = useState(false) // false = ล็อกไว้ (ดูอย่างเดียว), true = แก้ไขได้
  const [previewVariant, setPreviewVariant] = useState('full') // 'full' | 'simple'
  const saveRipple = useRipple()
  const testRipple = useRipple()
  // เก็บค่าที่บันทึกไว้ล่าสุดไว้ย้อนกลับ ถ้ากด "ยกเลิก" หลังแก้ไขโดยไม่กดบันทึก
  const savedSnapshotRef = useRef(null)

  const activeMock = previewVariant === 'simple' ? MOCK_SIMPLE : MOCK

  // field ไหนขึ้นหลายบรรทัดแล้วอาจไปทับ field อื่นด้านล่าง — เตือนไว้ในลิสต์ด้านซ้าย
  const wrapWarnings = useMemo(
    () => computeWrapOverlaps(layout, labelW, labelH, storeName, activeMock),
    [layout, labelW, labelH, storeName, activeMock]
  )

  // ── Load ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const [labelRes, storeRes] = await Promise.all([
        supabase.from('settings').select('value').eq('key', 'label_settings').maybeSingle(),
        supabase.from('settings').select('value').eq('key', 'store_name').maybeSingle(),
      ])
      let nextLayout = DEFAULT_LAYOUT.map(f => ({ ...f }))
      let nextCopies = 1, nextIp = '192.168.1.100', nextPort = 3001, nextW = 50, nextH = 30
      if (labelRes.data?.value) {
        try {
          const saved = JSON.parse(labelRes.data.value)
          if (saved.layout) {
            // Merge: คง field เดิม + เพิ่ม field ใหม่จาก DEFAULT_LAYOUT ที่ยังไม่มี
            const savedIds = new Set(saved.layout.map(f => f.id))
            const newFields = DEFAULT_LAYOUT.filter(f => !savedIds.has(f.id))
            nextLayout = [...saved.layout, ...newFields]
          }
          if (saved.copies)      nextCopies = saved.copies
          if (saved.printerIp)   nextIp     = saved.printerIp
          if (saved.printerPort) nextPort   = saved.printerPort
          if (saved.labelW)      nextW      = saved.labelW
          if (saved.labelH)      nextH      = saved.labelH
        } catch {}
      }
      setLayout(nextLayout); setCopies(nextCopies); setPrinterIp(nextIp)
      setPrinterPort(nextPort); setLabelW(nextW); setLabelH(nextH)
      if (storeRes.data?.value) setStoreName(storeRes.data.value)
      // snapshot ไว้ย้อนกลับตอนกด "ยกเลิก"
      savedSnapshotRef.current = {
        layout: nextLayout.map(f => ({ ...f })),
        copies: nextCopies, printerIp: nextIp, printerPort: nextPort, labelW: nextW, labelH: nextH,
      }
      setLoading(false)
    }
    load()
  }, [])

  const selectedField = layout.find(f => f.id === selectedId) ?? null

  // ── Handlers ────────────────────────────────────────────────────────────────
  const updateField = useCallback((id, key, val) => {
    setLayout(prev => prev.map(f => f.id === id ? { ...f, [key]: val } : f))
  }, [])

  const updateSelected = useCallback((key, val) => {
    if (selectedId) updateField(selectedId, key, val)
  }, [selectedId, updateField])

  const handleMove = useCallback((id, x, y) => {
    setLayout(prev => prev.map(f => f.id === id ? { ...f, x, y } : f))
  }, [])

  const toggleField = (id) => {
    setLayout(prev => prev.map(f => f.id === id ? { ...f, visible: !f.visible } : f))
  }

  const addCustom = () => {
    const id = `custom_${Date.now()}`
    setLayout(prev => [...prev, { id, type: 'custom', label: 'ข้อความ', visible: true,
      x: 50, y: 82, fontSize: 9, bold: false, align: 'center', text: '' }])
    setSelectedId(id)
  }

  const ensureField = (type, label) => {
    const ex = layout.find(f => f.type === type)
    if (ex) {
      setLayout(prev => prev.map(f => f.id === ex.id ? { ...f, visible: true } : f))
      setSelectedId(ex.id)
    } else {
      const id = `${type}_${Date.now()}`
      setLayout(prev => [...prev, { id, type, label, visible: true,
        x: 50, y: 82, fontSize: 9, bold: false, align: 'center' }])
      setSelectedId(id)
    }
  }

  const deleteSelected = () => {
    if (!selectedId) return
    setLayout(prev => prev.filter(f => f.id !== selectedId))
    setSelectedId(null)
  }

  // เข้าโหมดแก้ไข — ปลดล็อกฟิลด์ทั้งหมดให้แก้ได้
  const handleEdit = () => setEditMode(true)

  // ยกเลิก — ทิ้งการแก้ไขทั้งหมด คืนค่าเป็นค่าที่บันทึกไว้ล่าสุด แล้วล็อกกลับ
  const handleCancel = () => {
    const snap = savedSnapshotRef.current
    if (snap) {
      setLayout(snap.layout.map(f => ({ ...f })))
      setCopies(snap.copies)
      setPrinterIp(snap.printerIp)
      setPrinterPort(snap.printerPort)
      setLabelW(snap.labelW)
      setLabelH(snap.labelH)
    }
    setSelectedId(null)
    setEditMode(false)
  }

  const handleSave = async (e) => {
    saveRipple.trigger(e); setSaveStatus('saving')
    const value = JSON.stringify({ layout, copies, printerIp, printerPort, labelW, labelH })
    const { error } = await supabase.from('settings')
      .upsert({ key: 'label_settings', value }, { onConflict: 'key' })
    if (error) { addToast('บันทึกไม่สำเร็จ: ' + error.message, 'error'); setSaveStatus('idle') }
    else {
      // อัปเดต snapshot เป็นค่าที่เพิ่งบันทึก แล้วล็อกกลับ
      savedSnapshotRef.current = {
        layout: layout.map(f => ({ ...f })), copies, printerIp, printerPort, labelW, labelH,
      }
      setSaveStatus('saved'); addToast('บันทึกการตั้งค่าฉลากแล้ว', 'success')
      setTimeout(() => setSaveStatus('idle'), 2500)
      setEditMode(false)
      setSelectedId(null)
    }
  }

  const handleTest = async (e) => {
    testRipple.trigger(e); setTestStatus('testing')
    try {
      const res = await fetch(`http://${printerIp}:${printerPort}/health`, { signal: AbortSignal.timeout(5000) })
      const d = await res.json()
      const isOnline = d.printerOnline || d.printerFound || false
      if (d.status === 'ok' && isOnline) {
        setTestStatus('ok')
      } else if (d.status === 'ok' && !isOnline) {
        setTestStatus('printer_offline')   // server รัน แต่ printer ไม่ตอบ
      } else {
        setTestStatus('error')
      }
    } catch {
      setTestStatus('error')               // server ไม่รัน / เข้าไม่ถึง
    }
    setTimeout(() => setTestStatus('idle'), 6000)
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-cocoa-300 border-t-cocoa-600 rounded-full animate-spin" />
    </div>
  )

  const fixedFields  = layout.filter(f => !f.id.startsWith('custom_'))
  const customFields = layout.filter(f =>  f.id.startsWith('custom_'))
  const previewH     = Math.round(PW * labelH / labelW)

  return (
    <div className="max-w-5xl mx-auto space-y-4">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">ตั้งค่าฉลากแก้ว</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {editMode ? 'ลากตำแหน่ง · ปรับ font · เพิ่มข้อความพิเศษ' : 'กด "แก้ไข" เพื่อเริ่มปรับการตั้งค่า'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!editMode ? (
            <button onClick={handleEdit} className="btn-secondary flex items-center gap-2">
              <SlidersHorizontal size={16} /> แก้ไข
            </button>
          ) : (
            <>
              <button onClick={handleCancel} className="btn-secondary">ยกเลิก</button>
              <button ref={saveRipple.ref} onClick={handleSave} disabled={saveStatus === 'saving'}
                className="btn-primary relative overflow-hidden flex items-center gap-2 disabled:opacity-50">
                {saveStatus === 'saving' && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {saveStatus === 'saved'  && <CheckCircle size={16} />}
                {saveStatus === 'idle'   && <Save size={16} />}
                {saveStatus === 'saving' ? 'กำลังบันทึก...' : saveStatus === 'saved' ? 'บันทึกแล้ว!' : 'บันทึก'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Paper size ──────────────────────────────────────────────────────── */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-gray-800">📐 ขนาดกระดาษ</h2>
        <div className="flex flex-wrap gap-2">
          {[[50,30],[60,40],[75,50],[80,50],[100,150]].map(([w,h]) => (
            <button key={`${w}x${h}`} onClick={() => { setLabelW(w); setLabelH(h) }} disabled={!editMode}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-40 disabled:pointer-events-none
                ${labelW===w && labelH===h ? 'bg-cocoa-700 text-white border-cocoa-700' : 'bg-white text-gray-600 border-gray-200 hover:border-cocoa-300'}`}>
              {w}×{h} mm
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label text-xs">กว้าง (mm)</label>
            <input type="number" className="input" min="20" max="110" value={labelW} disabled={!editMode}
              onChange={e => setLabelW(parseInt(e.target.value) || 50)} />
          </div>
          <div>
            <label className="label text-xs">สูง (mm)</label>
            <input type="number" className="input" min="15" max="200" value={labelH} disabled={!editMode}
              onChange={e => setLabelH(parseInt(e.target.value) || 30)} />
          </div>
        </div>
      </div>

      {/* ── Main layout ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Left: field list + settings */}
        <div className="lg:col-span-2 space-y-4">

          {/* Field toggles */}
          <div className="card space-y-2">
            <h2 className="font-semibold text-gray-800">📋 Field บนฉลาก</h2>
            <p className="text-xs text-gray-400">Toggle เปิด/ปิด · คลิกเพื่อเลือกแก้ไข</p>

            <div className="space-y-0.5">
              {fixedFields.map(field => {
                const Icon = FIELD_ICON[field.type]
                const isSel = selectedId === field.id
                return (
                  <button key={field.id}
                    type="button"
                    className={`w-full flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed
                      ${isSel ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'}`}
                    aria-pressed={isSel} disabled={!editMode}
                    onClick={() => { if (!editMode) return; toggleField(field.id); setSelectedId(field.id) }}>
                    <div className="flex items-center gap-2 min-w-0">
                      {Icon && <Icon size={12} className={field.visible ? 'text-cocoa-600' : 'text-gray-300'} />}
                      <span className={`text-xs font-medium ${field.visible ? 'text-gray-800' : 'text-gray-400'}`}>
                        {field.label}
                      </span>
                      {wrapWarnings[field.id] && (
                        <span title={`ข้อความยาวจนขึ้นหลายบรรทัด อาจทับ ${wrapWarnings[field.id].join(', ')}`}>
                          <AlertTriangle size={11} className="text-amber-500 shrink-0" />
                        </span>
                      )}
                    </div>
                    <Toggle on={field.visible} />
                  </button>
                )
              })}
            </div>

            {/* Custom fields */}
            {customFields.length > 0 && (
              <div className="border-t border-gray-100 pt-2 space-y-0.5">
                {customFields.map(field => (
                  <div key={field.id}
                    className={`flex items-center justify-between p-2 rounded-lg transition-colors
                      ${selectedId === field.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'}`}>
                    <button
                      type="button"
                      className="flex-1 flex items-center gap-2 text-left cursor-pointer"
                      aria-pressed={selectedId === field.id}
                      onClick={() => setSelectedId(field.id)}>
                      <FileText size={12} className="text-gray-400" />
                      <span className="text-xs font-medium text-gray-700 truncate max-w-[120px]">
                        {field.text || '(ว่าง)'}
                      </span>
                    </button>
                    <button onClick={e => { e.stopPropagation(); setLayout(prev => prev.filter(f => f.id !== field.id)); if (selectedId === field.id) setSelectedId(null) }}
                      aria-label={`ลบ ${field.text || 'ข้อความกำหนดเอง'}`} disabled={!editMode}
                      className="text-gray-300 hover:text-red-400 transition-colors shrink-0 pl-2 disabled:opacity-30 disabled:pointer-events-none">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add field buttons */}
            <div className="border-t border-gray-100 pt-2">
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1.5">+ เพิ่ม field</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  ['ข้อความ', addCustom],
                  ['Platform', () => ensureField('platform', 'Platform')],
                  ['วันที่',   () => ensureField('date', 'วันที่')],
                  ['Note',     () => ensureField('note', 'Note')],
                ].map(([label, fn]) => (
                  <button key={label} onClick={fn} disabled={!editMode}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-medium text-gray-700 transition-colors disabled:opacity-40 disabled:pointer-events-none">
                    <Plus size={11} /> {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Copies */}
          <div className="card space-y-3">
            <h2 className="font-semibold text-gray-800">🖨️ จำนวนสำเนา</h2>
            <div className="flex gap-2">
              {[1, 2, 3].map(n => (
                <button key={n} onClick={() => setCopies(n)} disabled={!editMode}
                  className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors disabled:opacity-40 disabled:pointer-events-none
                    ${copies === n ? 'bg-cocoa-700 text-white border-cocoa-700' : 'bg-white text-gray-600 border-gray-200 hover:border-cocoa-300'}`}>
                  {n} ใบ
                </button>
              ))}
            </div>
          </div>

          {/* Print server */}
          <div className="card space-y-3">
            <h2 className="font-semibold text-gray-800">🌐 Print Server</h2>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="label text-xs">IP Address</label>
                <input type="text" className="input font-mono" placeholder="192.168.1.xxx" disabled={!editMode}
                  value={printerIp} onChange={e => setPrinterIp(e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">Port</label>
                <input type="number" className="input" value={printerPort} disabled={!editMode}
                  onChange={e => setPrinterPort(parseInt(e.target.value) || 3001)} />
              </div>
            </div>
            <p className="text-xs text-gray-400">
              ใส่ IP คอมพิวเตอร์ที่รัน print-server
              {editMode && (
                <>
                  {' '}<span className="text-cocoa-600 font-medium cursor-pointer" onClick={() => ensureField('store_name', 'ชื่อร้าน')}>
                    แก้ชื่อร้านได้ที่ ตั้งค่า → ข้อมูลร้าน
                  </span>
                </>
              )}
            </p>
            <button ref={testRipple.ref} onClick={handleTest} disabled={testStatus === 'testing'}
              className={`relative overflow-hidden flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-colors disabled:opacity-50
                ${testStatus === 'ok'             ? 'border-green-300 bg-green-50 text-green-700'
                : testStatus === 'printer_offline' ? 'border-amber-300 bg-amber-50 text-amber-700'
                : testStatus === 'error'           ? 'border-red-300 bg-red-50 text-red-600'
                : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
              {testStatus === 'testing'        && <RefreshCw size={14} className="animate-spin" />}
              {testStatus === 'ok'             && <CheckCircle size={14} className="text-green-600" />}
              {testStatus === 'printer_offline' && <Wifi size={14} className="text-amber-500" />}
              {testStatus === 'error'          && <Wifi size={14} className="text-red-500" />}
              {testStatus === 'idle'           && <Wifi size={14} />}
              {testStatus === 'testing'         ? 'กำลังทดสอบ...'
                : testStatus === 'ok'           ? 'เชื่อมต่อสำเร็จ ✓'
                : testStatus === 'printer_offline' ? 'Server OK · Printer ออฟไลน์ ⚠'
                : testStatus === 'error'        ? 'Server เชื่อมต่อไม่ได้ ✗'
                : 'ทดสอบการเชื่อมต่อ'}
            </button>
          </div>
        </div>

        {/* Right: Canvas + Properties */}
        <div className="lg:col-span-3 space-y-4">
          <div className="card space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-semibold text-gray-800">👁️ Preview — {labelW}×{labelH} mm</h2>
              <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                {[['full', 'ตัวอย่างเต็ม'], ['simple', 'ตัวอย่างเรียบง่าย']].map(([val, label]) => (
                  <button key={val} onClick={() => setPreviewVariant(val)}
                    aria-pressed={previewVariant === val}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors
                      ${previewVariant === val ? 'bg-white text-cocoa-700 shadow-sm' : 'text-gray-500'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <LabelCanvas
              layout={layout}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMove={handleMove}
              storeName={storeName}
              pw={PW}
              ph={previewH}
              labelW={labelW}
              labelH={labelH}
              mock={activeMock}
              editable={editMode}
            />

            <p className="text-center text-xs text-gray-400">
              {editMode ? 'ลากเพื่อย้ายตำแหน่ง · คลิก field เพื่อแก้ไข' : 'กด "แก้ไข" ด้านบนเพื่อลากตำแหน่ง/แก้ไข field'}
            </p>

            {/* Properties */}
            <div className="border-t border-gray-100 pt-3">
              <FieldProperties
                field={selectedField}
                onUpdate={updateSelected}
                onDelete={deleteSelected}
                editable={editMode}
              />
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
