import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase, updateMenuCost, getMenuCostHistory, getCostSchema } from '../lib/supabase'
import { calcMenuCostBreakdown, buildDynamicLookups, formatBaht, formatPct } from '../utils/calculations'
import { Calculator, X, Save, History, ChevronRight, AlertTriangle, Settings2, Info } from 'lucide-react'
import ConfirmModal from '../components/ConfirmModal'
import { useToast } from '../contexts/ToastContext'

const PLATFORMS = ['GRAB', 'LINE', 'SHOPEE', 'The metro', 'TU']
const DELIVERY_PLATS = ['GRAB', 'LINE', 'SHOPEE']
const INSTORE_PLATS  = ['The metro', 'TU']
const PLAT_FEE_KEYS = { GRAB: 'grab_fee_pct', LINE: 'line_fee_pct', SHOPEE: 'shopee_fee_pct', 'The metro': 'the_metro_fee_pct', TU: 'tu_fee_pct' }
const CATEGORIES = ['Cocoa', 'Coffee', 'Matcha', 'Classic', 'Hot', 'Bun', 'Refill', 'Addon']

const PKG_TYPE_OPTIONS = [
  { value: 'beverage', label: '🧋 เครื่องดื่ม' },
  { value: 'bun',      label: '🍞 ขนมปัง' },
  { value: 'none',     label: '— ไม่มีบรรจุภัณฑ์' },
]

const DEFAULT_PKG_TYPE_BY_CATEGORY = {
  Bun: 'bun', Refill: 'none', Addon: 'none',
}

// วัตถุดิบแยกตาม category
const INGREDIENT_FIELDS = {
  bun: [
    { key: 'main_ingredient', label: 'ขนมปัง' },
    { key: 'milk_condensed',  label: 'เนย' },
    { key: 'milk_mixed',      label: 'Topping' },
  ],
  beverage: [
    { key: 'main_ingredient', label: 'วัตถุดิบหลัก' },
    { key: 'milk_condensed',  label: 'นมข้นหวาน' },
    { key: 'milk_mixed',      label: 'นมผสม' },
    { key: 'milk_fresh',      label: 'นมสด Meji' },
  ],
}

function getIngredientFields(category) {
  return category === 'Bun' ? INGREDIENT_FIELDS.bun : INGREDIENT_FIELDS.beverage
}

// Profit color + badge
function profitColor(pct) {
  if (pct >= 20) return 'text-green-600'
  if (pct >= 15) return 'text-amber-600'
  return 'text-red-600'
}

function ProfitBadge({ pct }) {
  if (pct == null) return null
  const style = pct >= 20
    ? 'bg-green-50 text-green-700 border-green-200'
    : pct >= 15
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-red-50 text-red-700 border-red-200'
  const icon = pct >= 20 ? '✅' : pct >= 15 ? '⚠️' : '❌'
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${style}`}>
      {icon} {formatPct(pct)}
    </span>
  )
}

// ─── Cost Editor Modal ───────────────────────────────────────

function CostEditorModal({ menu, costSettings, costSchema, platformFees, onClose, onSave }) {
  const { addToast } = useToast()
  const [form, setForm] = useState({
    main_ingredient: 0,
    milk_condensed:  0,
    milk_mixed:      0,
    milk_fresh:      0,
    packaging_type:  DEFAULT_PKG_TYPE_BY_CATEGORY[menu.category] ?? 'beverage',
    custom_costs:    [],   // [{ label: '', amount: 0 }]
  })
  const [platform, setPlatform] = useState('GRAB')
  const [history, setHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingCost, setLoadingCost] = useState(true)
  const savedFormRef = useRef(null)  // tracks form state at load time for dirty check

  // Load current cost for this menu
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('menu_costs')
        .select('*')
        .eq('menu_id', menu.id)
        .is('effective_to', null)
        .order('effective_from', { ascending: false })
        .limit(1)
        .single()

      if (data) {
        const loaded = {
          main_ingredient: data.main_ingredient ?? 0,
          milk_condensed:  data.milk_condensed  ?? 0,
          milk_mixed:      data.milk_mixed       ?? 0,
          milk_fresh:      data.milk_fresh       ?? 0,
          packaging_type:  data.packaging_type   ?? 'beverage',
          custom_costs:    Array.isArray(data.custom_costs) ? data.custom_costs : [],
        }
        setForm(loaded)
        savedFormRef.current = loaded
      } else {
        savedFormRef.current = {
          main_ingredient: 0, milk_condensed: 0, milk_mixed: 0, milk_fresh: 0,
          packaging_type: DEFAULT_PKG_TYPE_BY_CATEGORY[menu.category] ?? 'beverage',
          custom_costs: [],
        }
      }
      setLoadingCost(false)
    }
    load()
  }, [menu.id])

  // Current selling price for selected platform
  const price = useMemo(() => {
    const prices = {}
    for (const p of menu.menu_prices ?? []) {
      if (!p.effective_to) prices[p.platform] = p.price
    }
    return Number(prices[platform] ?? 0)
  }, [menu.menu_prices, platform])

  // Live breakdown
  const bd = useMemo(() => {
    const feePct = platformFees[platform] ?? 0
    return calcMenuCostBreakdown(form, costSettings, price, feePct, costSchema)
  }, [form, costSettings, price, platform, platformFees, costSchema])

  const loadHistory = async () => {
    const hist = await getMenuCostHistory(menu.id)
    setHistory(hist)
    setShowHistory(true)
  }

  // Warn if form has unsaved changes
  const isFormDirty = savedFormRef.current
    ? JSON.stringify(form) !== JSON.stringify(savedFormRef.current)
    : false

  const handleClose = () => {
    if (isFormDirty) { setShowCloseConfirm(true); return }
    onClose()
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const { error: costErr } = await updateMenuCost(menu.id, form)
      if (costErr) throw costErr

      // Sync gp_cost field on menu for backward compat (use GRAB price)
      const grabPrice = (() => {
        const prices = {}
        for (const p of menu.menu_prices ?? []) {
          if (!p.effective_to) prices[p.platform] = p.price
        }
        return Number(prices['GRAB'] ?? 0)
      })()
      const grabBd = calcMenuCostBreakdown(form, costSettings, grabPrice, 0, costSchema)
      if (grabBd) {
        const { error } = await supabase.from('menus').update({ gp_cost: grabBd.gpCost }).eq('id', menu.id)
        if (error) throw error
      }

      onSave()
      onClose()
    } catch (err) {
      addToast('บันทึกต้นทุนไม่สำเร็จ: ' + err.message, 'error')
    }
    setSaving(false)
  }

  if (loadingCost) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-8 text-gray-400">กำลังโหลด...</div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white w-full md:max-w-2xl md:rounded-2xl rounded-t-2xl shadow-xl max-h-[94vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white z-10">
          <div>
            <h2 className="font-bold text-gray-900">{menu.name}</h2>
            <p className="text-xs text-gray-400">{menu.category}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={showHistory ? () => setShowHistory(false) : loadHistory}
              className={`p-2 rounded-lg transition-colors ${showHistory ? 'bg-cocoa-50 text-cocoa-700' : 'text-gray-400 hover:bg-gray-100'}`}
              title="ประวัติต้นทุน"
            >
              <History size={18} />
            </button>
            <button onClick={handleClose} className="p-2 rounded-lg text-gray-400 hover:bg-gray-100">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Platform selector */}
          <div>
            <label className="label">เลือก Platform เพื่อดู Margin</label>
            <div className="flex gap-2">
              {PLATFORMS.map(p => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    platform === p
                      ? 'bg-cocoa-700 text-white border-cocoa-700'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-cocoa-300'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              ราคาขาย: <strong>{formatBaht(price, 2)}</strong> &nbsp;|&nbsp;
              Platform Fee: <strong>{platformFees[platform] ?? 0}%</strong>
              {price === 0 && <span className="ml-2 text-amber-600">⚠ ยังไม่มีราคา กรุณาตั้งราคาใน "จัดการเมนู"</span>}
            </p>
          </div>

          {/* Ingredient inputs */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              {menu.category === 'Bun' ? '🍞 วัตถุดิบ (฿ ต่อชิ้น)' : '🧪 วัตถุดิบ (฿ ต่อแก้ว)'}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {getIngredientFields(menu.category).map(({ key, label }) => (
                <div key={key}>
                  <label className="text-xs text-gray-500">{label} (฿)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input text-right"
                    value={form[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Custom costs */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700">➕ ค่าใช้จ่ายเพิ่มเติม (ต่อชิ้น)</h3>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, custom_costs: [...f.custom_costs, { label: '', amount: 0 }] }))}
                className="text-xs text-cocoa-600 hover:text-cocoa-800 font-medium flex items-center gap-1"
              >
                + เพิ่มรายการ
              </button>
            </div>

            {form.custom_costs.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">ยังไม่มีรายการ — กด "เพิ่มรายการ" เพื่อเพิ่มต้นทุนพิเศษ เช่น น้ำตาลทราย, ซอส</p>
            ) : (
              <div className="space-y-2">
                {form.custom_costs.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="รายละเอียด เช่น น้ำตาลทราย"
                      className="input flex-1 text-sm"
                      value={item.label}
                      onChange={e => setForm(f => {
                        const next = [...f.custom_costs]
                        next[idx] = { ...next[idx], label: e.target.value }
                        return { ...f, custom_costs: next }
                      })}
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0"
                      className="input w-24 text-right text-sm"
                      value={item.amount || ''}
                      onChange={e => setForm(f => {
                        const next = [...f.custom_costs]
                        next[idx] = { ...next[idx], amount: parseFloat(e.target.value) || 0 }
                        return { ...f, custom_costs: next }
                      })}
                    />
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, custom_costs: f.custom_costs.filter((_, i) => i !== idx) }))}
                      className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
                <p className="text-xs text-gray-400 text-right">
                  รวม: {formatBaht(form.custom_costs.reduce((s, c) => s + (Number(c.amount) || 0), 0), 2)}
                </p>
              </div>
            )}
          </div>

          {/* Packaging type */}
          <div>
            <label className="label">ประเภทบรรจุภัณฑ์</label>
            <div className="grid grid-cols-3 gap-2">
              {PKG_TYPE_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setForm(f => ({ ...f, packaging_type: value }))}
                  className={`py-2.5 px-3 rounded-xl text-sm border transition-colors ${
                    form.packaging_type === value
                      ? 'bg-cocoa-50 border-cocoa-400 text-cocoa-700 font-semibold'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Cost breakdown (read-only from cost_settings) */}
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">⚙️ รายละเอียดต้นทุน</h3>
              <Link
                to="/settings"
                onClick={onClose}
                className="text-xs text-cocoa-600 hover:underline flex items-center gap-1"
              >
                แก้ไขค่ากลาง <Settings2 size={11} />
              </Link>
            </div>

            <div className="space-y-1.5 text-sm">
              {/* Ingredient breakdown */}
              {(() => {
                const fields = getIngredientFields(menu.category)
                const rows = fields.filter(f => (Number(form[f.key]) || 0) > 0)
                if (rows.length === 0) return null
                return (
                  <>
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                      🧪 วัตถุดิบ
                    </p>
                    {rows.map(f => (
                      <div key={f.key} className="flex justify-between text-gray-600">
                        <span>{f.label}</span>
                        <span>{formatBaht(Number(form[f.key]) || 0, 2)}</span>
                      </div>
                    ))}
                    <div className="border-t border-gray-200 my-1" />
                  </>
                )
              })()}

              {/* Packaging items */}
              {bd?.packagingBreakdown.length > 0 && (
                <>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                    📦 บรรจุภัณฑ์
                  </p>
                  {bd.packagingBreakdown.map(item => (
                    <div key={item.key} className="flex justify-between text-gray-600">
                      <span>{item.label}</span>
                      <span>{formatBaht(item.value, 2)}</span>
                    </div>
                  ))}
                  <div className="border-t border-gray-200 my-1" />
                </>
              )}

              {/* Custom costs */}
              {bd?.customCostRows?.length > 0 && (
                <>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                    ➕ ต้นทุนเพิ่มเติม
                  </p>
                  {bd.customCostRows.map((c, i) => (
                    <div key={i} className="flex justify-between text-gray-600">
                      <span>{c.label || `รายการ ${i + 1}`}</span>
                      <span>{formatBaht(Number(c.amount) || 0, 2)}</span>
                    </div>
                  ))}
                  <div className="border-t border-gray-200 my-1" />
                </>
              )}

              {(bd?.sharedBreakdown?.length ?? 0) > 0 && (
                <>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                    ⚙️ ต้นทุนร่วม
                  </p>
                  {bd.sharedBreakdown.map(item => (
                    <div key={item.key} className="flex justify-between text-gray-600">
                      <span>{item.label}</span>
                      <span>{formatBaht(item.value, 2)}</span>
                    </div>
                  ))}
                  <div className="border-t border-gray-200 my-1" />
                </>
              )}
              <div className="flex justify-between text-gray-600">
                <span>ค่าแรง {costSettings.labor_pct ?? 0}% × {formatBaht(price)}</span>
                <span>{formatBaht(bd?.laborCost ?? 0, 2)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Platform Fee {platformFees[platform] ?? 0}% × {formatBaht(price)}</span>
                <span>{formatBaht(bd?.platformFee ?? 0, 2)}</span>
              </div>
              <div className="border-t border-gray-200 my-1" />
              <div className="flex justify-between text-gray-600">
                <span>Marketing {costSettings.marketing_pct ?? 0}% × {formatBaht(price)}</span>
                <span>{formatBaht(bd?.marketingCost ?? 0, 2)}</span>
              </div>
            </div>
          </div>

          {/* Summary table */}
          {bd && (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-2 divide-x divide-y divide-gray-100">
                <div className="px-4 py-3 bg-gray-50">
                  <p className="text-xs text-gray-400 mb-0.5">
                    Material Cost {price > 0 ? `(${((bd.materialCost / price) * 100).toFixed(1)}%)` : ''}
                  </p>
                  <p className="font-semibold text-gray-800">{formatBaht(bd.materialCost, 2)}</p>
                </div>
                <div className="px-4 py-3 bg-gray-50">
                  <p className="text-xs text-gray-400 mb-0.5">Platform Fee ({platformFees[platform] ?? 0}%)</p>
                  <p className="font-semibold text-gray-800">{formatBaht(bd.platformFee, 2)}</p>
                </div>
                <div className="px-4 py-3 bg-gray-50">
                  <p className="text-xs text-gray-400 mb-0.5">Labor Cost ({costSettings.labor_pct ?? 0}%)</p>
                  <p className="font-semibold text-gray-800">{formatBaht(bd.laborCost, 2)}</p>
                </div>
                <div className="px-4 py-3 bg-gray-50">
                  <p className="text-xs text-gray-400 mb-0.5">Marketing Cost ({costSettings.marketing_pct ?? 0}%)</p>
                  <p className="font-semibold text-gray-800">{formatBaht(bd.marketingCost, 2)}</p>
                </div>
              </div>
              {(() => {
                const costPct = price > 0 ? (bd.totalCost / price) * 100 : null
                const bgStyle = costPct == null ? 'bg-gray-100'
                  : costPct <= 80 ? 'bg-green-50'
                  : costPct <= 85 ? 'bg-amber-50'
                  : 'bg-red-50'
                const badgeStyle = costPct == null ? ''
                  : costPct <= 80 ? 'bg-green-100 text-green-700 border-green-200'
                  : costPct <= 85 ? 'bg-amber-100 text-amber-700 border-amber-200'
                  : 'bg-red-100 text-red-700 border-red-200'
                const icon = costPct == null ? '' : costPct <= 80 ? '✅' : costPct <= 85 ? '⚠️' : '❌'
                return (
                  <div className={`border-t border-gray-200 px-4 py-3 flex justify-between items-center ${bgStyle}`}>
                    <span className="text-sm font-semibold text-gray-700">Total Cost</span>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900">{formatBaht(bd.totalCost, 2)}</span>
                      {costPct != null && (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${badgeStyle}`}>
                          {icon} {costPct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                )
              })()}
              <div className={`border-t border-gray-200 px-4 py-3 flex justify-between items-center ${bd.profit >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                <span className="text-sm font-semibold text-gray-800">Profit ({platform})</span>
                <div className="flex items-center gap-2">
                  <span className={`text-lg font-bold ${bd.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {formatBaht(bd.profit, 2)}
                  </span>
                  <ProfitBadge pct={bd.profitPct} />
                </div>
              </div>
            </div>
          )}

          {/* Warning */}
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <p>การบันทึกจะมีผลตั้งแต่วันนี้เป็นต้นไป ข้อมูลก่อนหน้าจะยังคำนวณด้วยต้นทุนเดิม</p>
          </div>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary w-full py-3.5 flex items-center justify-center gap-2 text-base"
          >
            <Save size={18} />
            {saving ? 'กำลังบันทึก...' : 'บันทึก — มีผลตั้งแต่วันนี้เป็นต้นไป'}
          </button>
        </div>

        {/* History panel */}
        {showHistory && (
          <div className="border-t p-5">
            <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <History size={16} /> ประวัติต้นทุน
            </h3>
            {history.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">ยังไม่มีประวัติ</p>
            ) : (
              <div className="space-y-2">
                {history.map(h => (
                  <div key={h.id} className="bg-gray-50 rounded-xl p-3 text-sm">
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="font-medium text-gray-700">
                        {h.effective_from}
                        {h.effective_to ? ` → ${h.effective_to}` : ' (ปัจจุบัน)'}
                      </span>
                      <span className="text-xs text-gray-400 bg-white border rounded-full px-2 py-0.5">
                        {PKG_TYPE_OPTIONS.find(o => o.value === h.packaging_type)?.label ?? h.packaging_type}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 text-xs text-gray-500">
                      <span>วัตถุดิบหลัก: {formatBaht(h.main_ingredient, 2)}</span>
                      <span>นมข้นหวาน: {formatBaht(h.milk_condensed, 2)}</span>
                      <span>นมผสม: {formatBaht(h.milk_mixed, 2)}</span>
                      <span>นมสด: {formatBaht(h.milk_fresh, 2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmModal
        open={showCloseConfirm}
        title="มีข้อมูลที่ยังไม่ได้บันทึก"
        message="ต้องการปิดหน้านี้โดยไม่บันทึกหรือไม่?"
        confirmLabel="ปิดโดยไม่บันทึก"
        danger
        onConfirm={() => { setShowCloseConfirm(false); onClose() }}
        onCancel={() => setShowCloseConfirm(false)}
      />
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────

export default function MenuCostPage() {
  const [menus, setMenus] = useState([])
  const [costSettings, setCostSettings] = useState({})
  const [costSchema, setCostSchema] = useState(null)
  const [platformFees, setPlatformFees] = useState({ GRAB: 30, LINE: 30, SHOPEE: 30, 'The metro': 0, TU: 0 })
  const [loading, setLoading] = useState(true)
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterMargin, setFilterMargin]     = useState('all')
  const [editMenu, setEditMenu] = useState(null)

  const loadData = async () => {
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)

    const [menusRes, costRes, settingsRes, menuCostsRes, schema] = await Promise.all([
      supabase
        .from('menus')
        .select('*, menu_prices(platform, price, effective_from, effective_to)')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name'),
      supabase
        .from('cost_settings')
        .select('key, value, effective_from')
        .lte('effective_from', today)
        .or(`effective_to.is.null,effective_to.gt.${today}`)
        .order('effective_from', { ascending: false }),
      supabase.from('settings').select('key, value'),
      supabase.from('menu_costs').select('*').is('effective_to', null),
      getCostSchema(),
    ])

    // Build cost settings map (latest per key)
    const cs = {}
    for (const row of costRes.data ?? []) {
      if (!(row.key in cs)) cs[row.key] = Number(row.value)
    }
    setCostSettings(cs)
    setCostSchema(schema)

    // Build platform fees — prefer platform_config JSON, fallback to legacy keys
    const pf = { GRAB: 30, LINE: 30, SHOPEE: 30, 'The metro': 0, TU: 0 }
    const platConfigRow = (settingsRes.data ?? []).find(r => r.key === 'platform_config')
    if (platConfigRow?.value) {
      try {
        const arr = JSON.parse(platConfigRow.value)
        for (const p of arr) pf[p.name] = p.fee ?? 0
      } catch { /* ignore */ }
    } else {
      for (const row of settingsRes.data ?? []) {
        if (row.key === 'grab_fee_pct')       pf.GRAB          = parseFloat(row.value) || 0
        if (row.key === 'line_fee_pct')       pf.LINE          = parseFloat(row.value) || 0
        if (row.key === 'shopee_fee_pct')     pf.SHOPEE        = parseFloat(row.value) || 0
        if (row.key === 'the_metro_fee_pct')  pf['The metro']  = parseFloat(row.value) || 0
        if (row.key === 'tu_fee_pct')         pf.TU            = parseFloat(row.value) || 0
      }
    }
    setPlatformFees(pf)

    // Map menu_costs to menus
    const costMap = {}
    for (const mc of menuCostsRes.data ?? []) costMap[mc.menu_id] = mc

    setMenus((menusRes.data ?? []).map(m => ({ ...m, currentCost: costMap[m.id] ?? null })))
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  // Helper: current prices for a menu
  const getPrices = (menu) => {
    const prices = {}
    for (const p of menu.menu_prices ?? []) {
      if (!p.effective_to) prices[p.platform] = p.price
    }
    return prices
  }

  // Get full GRAB breakdown for list display
  const getGrabBreakdown = (menu) => {
    if (!menu.currentCost) return null
    const price = getPrices(menu)['GRAB'] ?? 0
    if (!price) return null
    return calcMenuCostBreakdown(menu.currentCost, costSettings, price, platformFees.GRAB, costSchema)
  }

  // Get margin tier for a menu based on GRAB
  const getMarginTier = (menu) => {
    const bd = getGrabBreakdown(menu)
    if (!bd) return null
    if (bd.profitPct >= 20) return 'good'
    if (bd.profitPct >= 15) return 'warn'
    return 'bad'
  }

  const marginCounts = {
    good: menus.filter(m => getMarginTier(m) === 'good').length,
    warn: menus.filter(m => getMarginTier(m) === 'warn').length,
    bad:  menus.filter(m => getMarginTier(m) === 'bad').length,
  }

  const filtered = menus.filter(m => {
    if (filterCategory !== 'all' && m.category !== filterCategory) return false
    if (filterMargin !== 'all' && getMarginTier(m) !== filterMargin) return false
    return true
  })
  const grouped = CATEGORIES.reduce((acc, cat) => {
    const items = filtered.filter(m => m.category === cat)
    if (items.length > 0) acc[cat] = items
    return acc
  }, {})

  const noDataCount = menus.filter(m => !m.currentCost).length

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">ต้นทุนเมนู</h1>
          <p className="text-xs text-gray-400 mt-0.5">คลิกเมนูเพื่อกรอก/แก้ไขวัตถุดิบ</p>
        </div>
        <p className="text-xs text-gray-400">Margin แสดงผล GRAB</p>
      </div>

      {/* Alert if menus have no cost data */}
      {!loading && noDataCount > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3.5 mb-4 text-sm">
          <Info size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-amber-700">
            <strong>{noDataCount} เมนู</strong> ยังไม่มีข้อมูลวัตถุดิบ คลิกเมนูที่มีป้าย <span className="bg-amber-100 text-amber-600 text-xs px-1.5 py-0.5 rounded-full">ยังไม่มีข้อมูล</span> เพื่อกรอก
          </p>
        </div>
      )}

      {/* Margin filter */}
      <div className="flex gap-2 flex-wrap mb-3">
        <button
          onClick={() => setFilterMargin('all')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
            filterMargin === 'all'
              ? 'bg-gray-700 text-white border-gray-700'
              : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
          }`}
        >
          ทุก Margin ({menus.length})
        </button>
        <button
          onClick={() => setFilterMargin('good')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
            filterMargin === 'good'
              ? 'bg-green-600 text-white border-green-600'
              : 'bg-green-50 text-green-700 border-green-200 hover:border-green-400'
          }`}
        >
          ✅ ≥20% ({marginCounts.good})
        </button>
        <button
          onClick={() => setFilterMargin('warn')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
            filterMargin === 'warn'
              ? 'bg-amber-500 text-white border-amber-500'
              : 'bg-amber-50 text-amber-700 border-amber-200 hover:border-amber-400'
          }`}
        >
          ⚠️ 15-20% ({marginCounts.warn})
        </button>
        <button
          onClick={() => setFilterMargin('bad')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
            filterMargin === 'bad'
              ? 'bg-red-600 text-white border-red-600'
              : 'bg-red-50 text-red-700 border-red-200 hover:border-red-400'
          }`}
        >
          ❌ &lt;15% ({marginCounts.bad})
        </button>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 flex-wrap mb-4">
        <button
          onClick={() => setFilterCategory('all')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${filterCategory === 'all' ? 'bg-cocoa-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'}`}
        >
          ทั้งหมด ({menus.length})
        </button>
        {CATEGORIES.map(cat => {
          const count = menus.filter(m => m.category === cat).length
          if (count === 0) return null
          return (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${filterCategory === cat ? 'bg-cocoa-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'}`}
            >
              {cat} ({count})
            </button>
          )
        })}
      </div>

      {/* Menu list */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">กำลังโหลด...</div>
      ) : (
        Object.entries(grouped).map(([cat, items]) => (
          <div key={cat} className="mb-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {cat} ({items.length})
            </h2>
            <div className="space-y-2">
              {items.map(menu => {
                const hasCost = !!menu.currentCost
                const prices = getPrices(menu)

                // Build group summaries
                const buildGroup = (plats) => {
                  const rows = plats
                    .map(p => {
                      const price = prices[p] ?? 0
                      if (!price) return null
                      const bd = hasCost
                        ? calcMenuCostBreakdown(menu.currentCost, costSettings, price, platformFees[p] ?? 0, costSchema)
                        : null
                      return { platform: p, price, bd }
                    })
                    .filter(Boolean)
                  if (rows.length === 0) return null

                  // Check if all prices in group are identical
                  const allSamePrice = rows.every(r => r.price === rows[0].price)

                  return { rows, allSamePrice }
                }

                const deliveryGroup = buildGroup(DELIVERY_PLATS)
                const instoreGroup  = buildGroup(INSTORE_PLATS)

                return (
                  <button
                    key={menu.id}
                    onClick={() => setEditMenu(menu)}
                    className="card w-full flex items-start gap-3 hover:border-cocoa-300 hover:shadow-md transition-all text-left group"
                  >
                    <div className={`w-2 h-2 rounded-full shrink-0 mt-2 ${hasCost ? 'bg-green-400' : 'bg-gray-200'}`} />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <p className="font-medium text-gray-900 text-sm truncate">{menu.name}</p>
                        {!hasCost && (
                          <span className="shrink-0 text-xs bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full">
                            ยังไม่มีข้อมูล
                          </span>
                        )}
                      </div>

                      {(deliveryGroup || instoreGroup) ? (
                        <div className="grid grid-cols-2 gap-2">
                          {/* Delivery group */}
                          {deliveryGroup ? (
                            <div className="bg-gray-50 rounded-xl p-2.5">
                              <p className="text-xs text-gray-400 font-medium mb-1.5">
                                🛵 Delivery
                                {deliveryGroup.allSamePrice
                                  ? ` · ${formatBaht(deliveryGroup.rows[0].price)}`
                                  : ''}
                              </p>
                              {deliveryGroup.allSamePrice ? (
                                // All same price → show one summary row using GRAB fee (lowest GP benefit)
                                (() => {
                                  const grabRow = deliveryGroup.rows.find(r => r.platform === 'GRAB') ?? deliveryGroup.rows[0]
                                  return grabRow.bd ? (
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs text-gray-500">
                                        Cost {formatBaht(grabRow.bd.totalCost, 2)} · Profit {formatBaht(grabRow.bd.profit, 2)}
                                      </span>
                                      <ProfitBadge pct={grabRow.bd.profitPct} />
                                    </div>
                                  ) : <span className="text-xs text-gray-400">ยังไม่มีต้นทุน</span>
                                })()
                              ) : (
                                // Different prices → show each platform
                                <div className="space-y-1">
                                  {deliveryGroup.rows.map(({ platform: p, price, bd }) => (
                                    <div key={p} className="flex items-center justify-between">
                                      <span className="text-xs text-gray-500">{p} {formatBaht(price)}</span>
                                      {bd ? <ProfitBadge pct={bd.profitPct} /> : <span className="text-xs text-gray-300">—</span>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="bg-gray-50 rounded-xl p-2.5 flex items-center justify-center">
                              <span className="text-xs text-gray-300">ไม่มีราคา Delivery</span>
                            </div>
                          )}

                          {/* In-store group */}
                          {instoreGroup ? (
                            <div className="bg-blue-50 rounded-xl p-2.5">
                              <p className="text-xs text-blue-400 font-medium mb-1.5">
                                🏪 In-store
                                {instoreGroup.allSamePrice
                                  ? ` · ${formatBaht(instoreGroup.rows[0].price)}`
                                  : ''}
                              </p>
                              {instoreGroup.allSamePrice ? (
                                (() => {
                                  const row = instoreGroup.rows[0]
                                  return row.bd ? (
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs text-blue-600">
                                        Cost {formatBaht(row.bd.totalCost, 2)} · Profit {formatBaht(row.bd.profit, 2)}
                                      </span>
                                      <ProfitBadge pct={row.bd.profitPct} />
                                    </div>
                                  ) : <span className="text-xs text-gray-400">ยังไม่มีต้นทุน</span>
                                })()
                              ) : (
                                <div className="space-y-1">
                                  {instoreGroup.rows.map(({ platform: p, price, bd }) => (
                                    <div key={p} className="flex items-center justify-between">
                                      <span className="text-xs text-blue-500">{p} {formatBaht(price)}</span>
                                      {bd ? <ProfitBadge pct={bd.profitPct} /> : <span className="text-xs text-gray-300">—</span>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="bg-blue-50 rounded-xl p-2.5 flex items-center justify-center">
                              <span className="text-xs text-blue-200">ไม่มีราคา In-store</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">ยังไม่มีราคา</p>
                      )}
                    </div>

                    <ChevronRight size={18} className="text-gray-300 group-hover:text-gray-400 shrink-0 transition-colors mt-1" />
                  </button>
                )
              })}
            </div>
          </div>
        ))
      )}

      {/* Cost Editor Modal */}
      {editMenu && (
        <CostEditorModal
          menu={editMenu}
          costSettings={costSettings}
          costSchema={costSchema}
          platformFees={platformFees}
          onClose={() => setEditMenu(null)}
          onSave={() => { setEditMenu(null); loadData() }}
        />
      )}
    </div>
  )
}
