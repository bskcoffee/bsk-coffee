import { useState, useEffect, useRef } from 'react'
import {
  Save, Printer, RefreshCw, CheckCircle, Wifi,
  AlignLeft, AlignCenter, AlignRight,
  Coffee, Hash, Clock, Tag, Layers, Package, SlidersHorizontal,
  Milk, Percent, RotateCcw, FileText,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../contexts/ToastContext'

// ─── Mock data for preview ────────────────────────────────────────────────────
const MOCK_ITEM = {
  name: 'Cocoa Latte',
  qty: 1,
  item_options: { milk: 'นมสด', sweetness: 50, refill: false, note: '' },
}
const MOCK_ORDER = { orderId: 'GF-012', platform: 'GRAB', date: new Date().toISOString() }

// ─── Default settings ─────────────────────────────────────────────────────────
const DEFAULT = {
  paperWidth: 50, paperHeight: 30,
  showMenuName: true,  menuNameSize: 'large',
  showOptions: true,   showOptionMilk: true, showOptionSweet: true,
  showOptionRefill: true, showOptionNote: true,
  showOrderId: true,   showQty: true, showIndex: true,
  showTime: true,      showStoreName: true,
  textAlign: 'center',
  printerIp: '192.168.1.100', printerPort: 9100, copies: 1,
}

// ─── Template Presets ─────────────────────────────────────────────────────────
const PRESETS = {
  cup: {
    label: 'ฉลากแก้ว', desc: 'ชื่อ · options · order', icon: '☕',
    settings: {
      showMenuName: true,  menuNameSize: 'large',
      showOptions: true,   showOptionMilk: true, showOptionSweet: true,
      showOptionRefill: false, showOptionNote: true,
      showOrderId: true,   showQty: true, showIndex: true,
      showTime: true,      showStoreName: false, textAlign: 'center',
    },
  },
  kitchen: {
    label: 'Kitchen ticket', desc: 'order · ชื่อ · note', icon: '🍳',
    settings: {
      showMenuName: true,  menuNameSize: 'medium',
      showOptions: false,  showOptionMilk: false, showOptionSweet: false,
      showOptionRefill: false, showOptionNote: true,
      showOrderId: true,   showQty: true, showIndex: true,
      showTime: false,     showStoreName: false, textAlign: 'left',
    },
  },
  minimal: {
    label: 'Minimal', desc: 'ชื่อเมนูอย่างเดียว', icon: '✦',
    settings: {
      showMenuName: true,  menuNameSize: 'large',
      showOptions: false,  showOptionMilk: false, showOptionSweet: false,
      showOptionRefill: false, showOptionNote: false,
      showOrderId: false,  showQty: false, showIndex: false,
      showTime: false,     showStoreName: false, textAlign: 'center',
    },
  },
}

// ─── Field chip definitions ───────────────────────────────────────────────────
const CHIP_COLORS = {
  content: { on: '#085041', offBg: '#E1F5EE', offText: '#085041' },
  order:   { on: '#0C447C', offBg: '#E6F1FB', offText: '#0C447C' },
  meta:    { on: '#633806', offBg: '#FAEEDA', offText: '#633806' },
}

function FieldChip({ label, icon: Icon, active, onClick, category }) {
  const c = CHIP_COLORS[category] ?? CHIP_COLORS.meta
  return (
    <button
      onClick={onClick}
      style={active
        ? { background: c.on, color: '#fff', borderColor: c.on }
        : { background: c.offBg, color: c.offText, borderColor: 'transparent' }
      }
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all active:scale-95"
    >
      {Icon && <Icon size={11} />}
      {label}
    </button>
  )
}

// ─── Mini label preview (used inside preset cards) ────────────────────────────
function MiniPreview({ settings }) {
  const s = { ...DEFAULT, ...settings }
  return (
    <div
      className="bg-white border border-dashed border-gray-300 rounded overflow-hidden shrink-0"
      style={{ width: 80, height: 48, padding: '3px 4px', fontFamily: 'monospace', textAlign: s.textAlign }}
    >
      {s.showMenuName && (
        <div style={{ fontSize: s.menuNameSize === 'large' ? 7 : 6, fontWeight: 'bold', lineHeight: 1.2 }}>
          Cocoa Latte
        </div>
      )}
      {s.showOptions && (
        <div style={{ fontSize: 4.5, color: '#666', marginTop: 1 }}>นมสด · 50%</div>
      )}
      <div style={{ borderTop: '1px dashed #ccc', margin: '2px 0' }} />
      <div style={{ fontSize: 4, color: '#888', display: 'flex', justifyContent: 'space-between' }}>
        {s.showOrderId && <span>#GF-012</span>}
        {s.showQty     && <span>×1</span>}
        {s.showTime    && <span>14:30</span>}
      </div>
    </div>
  )
}

// ─── Full label preview ───────────────────────────────────────────────────────
function LabelPreview({ s, storeName }) {
  const opts = []
  if (s.showOptions) {
    if (s.showOptionMilk   && MOCK_ITEM.item_options.milk)       opts.push(MOCK_ITEM.item_options.milk)
    if (s.showOptionSweet  && MOCK_ITEM.item_options.sweetness !== undefined) opts.push(`${MOCK_ITEM.item_options.sweetness}%`)
    if (s.showOptionRefill && MOCK_ITEM.item_options.refill)     opts.push('รีฟิล')
    if (s.showOptionNote   && MOCK_ITEM.item_options.note)       opts.push(MOCK_ITEM.item_options.note)
  }
  const timeStr = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
  const w = s.paperWidth  * 5
  const h = s.paperHeight * 5

  const noFieldsVisible = !s.showMenuName && opts.length === 0 && !s.showOrderId
    && !s.showQty && !s.showIndex && !s.showTime && !s.showStoreName

  if (noFieldsVisible) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center">
          <Printer size={22} className="text-cocoa-600" />
        </div>
        <p className="font-medium text-gray-700">ยังไม่มี field บนฉลาก</p>
        <p className="text-sm text-gray-400">เปิด field ด้านซ้าย หรือเลือก template</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">
        Preview — {s.paperWidth}×{s.paperHeight} mm
      </p>
      <div
        className="bg-white border-2 border-dashed border-gray-300 rounded shadow-md flex flex-col justify-between overflow-hidden"
        style={{ width: w, height: h, padding: '6px 8px', fontFamily: 'monospace', textAlign: s.textAlign ?? 'center' }}
      >
        {s.showMenuName && (
          <div className="font-bold leading-tight" style={{ fontSize: s.menuNameSize === 'large' ? 16 : 13 }}>
            {MOCK_ITEM.name}
          </div>
        )}
        {opts.length > 0 && (
          <div className="text-gray-600" style={{ fontSize: 10 }}>{opts.join(' · ')}</div>
        )}
        <div style={{ borderTop: '1px dashed #ccc', margin: '2px 0' }} />
        <div style={{ fontSize: 9, color: '#555', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          {s.showOrderId   && <span>#{MOCK_ORDER.orderId.slice(-6)}</span>}
          {s.showQty       && <span>×{MOCK_ITEM.qty}</span>}
          {s.showTime      && <span>{timeStr}</span>}
          {s.showIndex     && <span>1/3</span>}
          {s.showStoreName && <span style={{ width: '100%', textAlign: 'center' }}>{storeName || 'Cocoa House'}</span>}
        </div>
      </div>
      <p className="text-xs text-gray-400">(แสดงขนาด 5× จากจริง)</p>
    </div>
  )
}

// ─── Ripple helper ────────────────────────────────────────────────────────────
function useRipple() {
  const ref = useRef(null)
  const trigger = (e) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const size = Math.max(rect.width, rect.height) * 2
    const x = (e.clientX - rect.left) - size / 2
    const y = (e.clientY - rect.top)  - size / 2
    const span = document.createElement('span')
    span.style.cssText = `position:absolute;border-radius:50%;background:rgba(255,255,255,.25);
      width:${size}px;height:${size}px;left:${x}px;top:${y}px;
      animation:rippleAnim .5s linear forwards;pointer-events:none`
    el.appendChild(span)
    setTimeout(() => span.remove(), 500)
  }
  return { ref, trigger }
}

// inject ripple keyframe once
if (!document.getElementById('ripple-style')) {
  const st = document.createElement('style')
  st.id = 'ripple-style'
  st.textContent = '@keyframes rippleAnim{to{transform:scale(4);opacity:0}}'
  document.head.appendChild(st)
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function LabelSettingsPage() {
  const { addToast } = useToast()
  const [s, setS]           = useState(DEFAULT)
  const [storeName, setStoreName] = useState('Cocoa House')
  const [saveStatus, setSaveStatus] = useState('idle')   // idle | saving | saved
  const [loading,   setLoading]   = useState(true)
  const [testStatus, setTestStatus] = useState('idle')  // idle | testing | ok | error
  const [activePreset, setActivePreset] = useState(null)
  const saveRipple = useRipple()
  const testRipple = useRipple()

  useEffect(() => {
    const load = async () => {
      const [labelRes, storeRes] = await Promise.all([
        supabase.from('settings').select('value').eq('key', 'label_settings').maybeSingle(),
        supabase.from('settings').select('value').eq('key', 'store_name').maybeSingle(),
      ])
      if (labelRes.data?.value) {
        try { setS({ ...DEFAULT, ...JSON.parse(labelRes.data.value) }) } catch {}
      }
      if (storeRes.data?.value) setStoreName(storeRes.data.value)
      setLoading(false)
    }
    load()
  }, [])

  const set = (key, val) => { setS(prev => ({ ...prev, [key]: val })); setActivePreset(null) }

  const loadPreset = (key) => {
    const preset = PRESETS[key]
    if (!preset) return
    setS(prev => ({ ...prev, ...preset.settings }))
    setActivePreset(key)
  }

  const handleSave = async (e) => {
    saveRipple.trigger(e)
    setSaveStatus('saving')
    const { error } = await supabase
      .from('settings')
      .upsert({ key: 'label_settings', value: JSON.stringify(s) }, { onConflict: 'key' })
    if (error) {
      addToast('บันทึกไม่สำเร็จ: ' + error.message, 'error')
      setSaveStatus('idle')
    } else {
      setSaveStatus('saved')
      addToast('บันทึกการตั้งค่าฉลากแล้ว', 'success')
      setTimeout(() => setSaveStatus('idle'), 2500)
    }
  }

  const handleTestPrint = async (e) => {
    testRipple.trigger(e)
    setTestStatus('testing')
    try {
      const res = await fetch(`http://${s.printerIp}:${s.printerPort}/health`, { signal: AbortSignal.timeout(4000) })
      const data = await res.json()
      setTestStatus(data.status === 'ok' ? 'ok' : 'error')
    } catch {
      setTestStatus('error')
    }
    setTimeout(() => setTestStatus('idle'), 4000)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400">
        <div className="w-6 h-6 border-2 border-cocoa-300 border-t-cocoa-600 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">ตั้งค่าฉลากแก้ว</h1>
          <p className="text-sm text-gray-400 mt-0.5">กำหนด template และข้อมูลที่จะพิมพ์บนฉลาก 50×30 mm</p>
        </div>
        <button
          ref={saveRipple.ref}
          onClick={handleSave}
          disabled={saveStatus === 'saving'}
          className="btn-primary relative overflow-hidden flex items-center gap-2 disabled:opacity-50"
        >
          {saveStatus === 'saving' && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {saveStatus === 'saved'  && <CheckCircle size={16} />}
          {saveStatus === 'idle'   && <Save size={16} />}
          {saveStatus === 'saving' ? 'กำลังบันทึก...' : saveStatus === 'saved' ? 'บันทึกแล้ว!' : 'บันทึก'}
        </button>
      </div>

      {/* ─── 1. Template Presets ──────────────────────────────────────────────── */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-gray-800">⚡ Template สำเร็จรูป</h2>
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(PRESETS).map(([key, preset]) => {
            const isActive = activePreset === key
            return (
              <button
                key={key}
                onClick={() => loadPreset(key)}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all text-left
                  ${isActive
                    ? 'border-cocoa-500 bg-cocoa-50 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-cocoa-300 hover:bg-gray-50'
                  }`}
              >
                <MiniPreview settings={preset.settings} />
                <div className="text-center">
                  <p className={`text-xs font-bold ${isActive ? 'text-cocoa-700' : 'text-gray-800'}`}>
                    {preset.icon} {preset.label}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{preset.desc}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Main layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* ─── Left: Settings ──────────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Paper size */}
          <div className="card space-y-3">
            <h2 className="font-semibold text-gray-800">📐 ขนาดกระดาษ</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label text-xs">ความกว้าง (mm)</label>
                <input type="number" className="input" min={30} max={80}
                  value={s.paperWidth}
                  onChange={e => set('paperWidth', parseInt(e.target.value) || 50)} />
              </div>
              <div>
                <label className="label text-xs">ความสูง (mm)</label>
                <input type="number" className="input" min={20} max={100}
                  value={s.paperHeight}
                  onChange={e => set('paperHeight', parseInt(e.target.value) || 30)} />
              </div>
            </div>
          </div>

          {/* ─── 2. Color-coded Field Chips ───────────────────────────────────── */}
          <div className="card space-y-3">
            <h2 className="font-semibold text-gray-800">📋 ข้อมูลบนฉลาก</h2>
            <p className="text-xs text-gray-400 -mt-1">กดเพื่อเปิด/ปิด field</p>

            {/* Content fields */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Content</p>
              <div className="flex flex-wrap gap-1.5">
                <FieldChip
                  label="ชื่อเมนู" icon={Coffee}
                  active={s.showMenuName} category="content"
                  onClick={() => set('showMenuName', !s.showMenuName)}
                />
                <FieldChip
                  label="Options" icon={SlidersHorizontal}
                  active={s.showOptions} category="content"
                  onClick={() => set('showOptions', !s.showOptions)}
                />
                {s.showOptions && (
                  <>
                    <FieldChip label="นม"        icon={Milk}    active={s.showOptionMilk}   category="content" onClick={() => set('showOptionMilk',   !s.showOptionMilk)}   />
                    <FieldChip label="ความหวาน"  icon={Percent} active={s.showOptionSweet}  category="content" onClick={() => set('showOptionSweet',  !s.showOptionSweet)}  />
                    <FieldChip label="รีฟิล"      icon={RotateCcw} active={s.showOptionRefill} category="content" onClick={() => set('showOptionRefill', !s.showOptionRefill)} />
                    <FieldChip label="โน้ต"       icon={FileText} active={s.showOptionNote}  category="content" onClick={() => set('showOptionNote',   !s.showOptionNote)}   />
                  </>
                )}
              </div>
            </div>

            {/* Menu name size (only when showMenuName is on) */}
            {s.showMenuName && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 shrink-0">ขนาดชื่อ:</span>
                {['large', 'medium'].map(sz => (
                  <button key={sz}
                    onClick={() => set('menuNameSize', sz)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors
                      ${s.menuNameSize === sz ? 'bg-cocoa-700 text-white border-cocoa-700' : 'bg-white text-gray-600 border-gray-200 hover:border-cocoa-300'}`}
                  >
                    {sz === 'large' ? 'ใหญ่' : 'กลาง'}
                  </button>
                ))}
              </div>
            )}

            {/* Order fields */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Order</p>
              <div className="flex flex-wrap gap-1.5">
                <FieldChip label="Order ID" icon={Hash}    active={s.showOrderId} category="order" onClick={() => set('showOrderId', !s.showOrderId)} />
                <FieldChip label="จำนวน"    icon={Package} active={s.showQty}     category="order" onClick={() => set('showQty',     !s.showQty)}     />
                <FieldChip label="ลำดับ"     icon={Layers}  active={s.showIndex}   category="order" onClick={() => set('showIndex',   !s.showIndex)}   />
              </div>
            </div>

            {/* Meta fields */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Meta</p>
              <div className="flex flex-wrap gap-1.5">
                <FieldChip label="เวลา"     icon={Clock} active={s.showTime}      category="meta" onClick={() => set('showTime',      !s.showTime)}      />
                <FieldChip label="ชื่อร้าน" icon={Tag}   active={s.showStoreName} category="meta" onClick={() => set('showStoreName', !s.showStoreName)} />
              </div>
              {s.showStoreName && (
                <p className="text-[10px] text-gray-400">
                  แก้ชื่อร้านได้ที่ <span className="text-cocoa-600 font-medium">ตั้งค่า → ข้อมูลร้าน</span>
                </p>
              )}
            </div>
          </div>

          {/* Copies */}
          <div className="card space-y-3">
            <h2 className="font-semibold text-gray-800">🖨️ จำนวนสำเนา</h2>
            <div className="flex gap-2">
              {[1, 2, 3].map(n => (
                <button key={n}
                  onClick={() => set('copies', n)}
                  className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors
                    ${s.copies === n ? 'bg-cocoa-700 text-white border-cocoa-700' : 'bg-white text-gray-600 border-gray-200 hover:border-cocoa-300'}`}
                >
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
                <label className="label text-xs">IP Address ของ Print Server</label>
                <input type="text" className="input font-mono" placeholder="192.168.1.xxx"
                  value={s.printerIp} onChange={e => set('printerIp', e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">Port</label>
                <input type="number" className="input" value={s.printerPort}
                  onChange={e => set('printerPort', parseInt(e.target.value) || 3001)} />
              </div>
            </div>
            <p className="text-xs text-gray-400">
              ES-9960 WiFi ต้องต่อ network เดียวกับ print server
            </p>
            <button
              ref={testRipple.ref}
              onClick={handleTestPrint}
              disabled={testStatus === 'testing'}
              className="relative overflow-hidden flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {testStatus === 'testing' && <RefreshCw size={14} className="animate-spin" />}
              {testStatus === 'ok'      && <CheckCircle size={14} className="text-green-600" />}
              {testStatus === 'error'   && <Wifi size={14} className="text-red-500" />}
              {testStatus === 'idle'    && <Wifi size={14} />}
              {testStatus === 'testing' ? 'กำลังทดสอบ...'
                : testStatus === 'ok'   ? 'เชื่อมต่อสำเร็จ ✓'
                : testStatus === 'error' ? 'เชื่อมต่อไม่ได้ ✗'
                : 'ทดสอบการเชื่อมต่อ'}
            </button>
          </div>
        </div>

        {/* ─── Right: Preview ──────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="card flex flex-col items-center py-6 gap-4">

            {/* ─── 4. Alignment Quick Actions ─────────────────────────────── */}
            <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-lg w-fit">
              {[
                { align: 'left',   icon: AlignLeft,   label: 'ชิดซ้าย' },
                { align: 'center', icon: AlignCenter, label: 'กลาง'    },
                { align: 'right',  icon: AlignRight,  label: 'ชิดขวา'  },
              ].map(({ align, icon: Icon, label }) => (
                <button
                  key={align}
                  onClick={() => set('textAlign', align)}
                  title={label}
                  className={`p-1.5 rounded-md transition-all ${
                    s.textAlign === align
                      ? 'bg-white text-cocoa-700 shadow-sm'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  <Icon size={15} />
                </button>
              ))}
            </div>

            <LabelPreview s={s} storeName={storeName} />
          </div>

          {/* Data fields reference */}
          <div className="card space-y-3">
            <h2 className="font-semibold text-gray-800">📦 ข้อมูลที่ดึงได้จาก POS</h2>
            <div className="space-y-1.5 text-sm">
              {[
                { field: 'ชื่อเมนู',   source: 'order_items.name',       example: '"Cocoa Latte"' },
                { field: 'จำนวน',      source: 'order_items.qty',        example: '×2' },
                { field: 'ประเภทนม',   source: 'item_options.milk',      example: '"นมสด"' },
                { field: 'ความหวาน',   source: 'item_options.sweetness', example: '"50%"' },
                { field: 'รีฟิล',      source: 'item_options.refill',    example: 'true/false' },
                { field: 'โน้ตพิเศษ', source: 'item_options.note',      example: '"ไม่ใส่น้ำแข็ง"' },
                { field: 'Order ID',   source: 'orders.id',              example: '"GF-012"' },
                { field: 'Platform',   source: 'orders.platform',        example: '"GRAB"' },
                { field: 'เวลาพิมพ์',  source: 'new Date() ตอนพิมพ์',   example: '"14:30"' },
                { field: 'ลำดับฉลาก',  source: 'คำนวณจาก items array',  example: '"1/3"' },
              ].map(({ field, source, example }) => (
                <div key={field} className="flex items-start justify-between gap-2 py-1.5 border-b border-gray-50">
                  <div>
                    <span className="font-medium text-gray-800">{field}</span>
                    <span className="ml-2 text-xs text-gray-400 font-mono">{source}</span>
                  </div>
                  <span className="text-xs text-cocoa-700 bg-cocoa-50 px-2 py-0.5 rounded font-mono shrink-0">{example}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
