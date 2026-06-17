import { useState, useEffect, useRef } from 'react'
import { supabase, getSetting, setSetting, getCurrentCostSettings, updateCostSettings, getCostSettingsHistory } from '../lib/supabase'
import { COST_KEY_LABELS, formatBaht } from '../utils/calculations'
import { Save, AlertTriangle, History, Pencil, GripVertical, X, Plus } from 'lucide-react'

async function getLatestFeeUpdatedAt(feeKeys) {
  const { data } = await supabase
    .from('settings')
    .select('updated_at')
    .in('key', feeKeys)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()
  return data?.updated_at ? new Date(data.updated_at) : null
}

// Fallback defaults for migration from old individual fee settings
const LEGACY_PLATFORMS = [
  { name: 'GRAB',      fee: 30 },
  { name: 'LINE',      fee: 30 },
  { name: 'SHOPEE',    fee: 30 },
  { name: 'The metro', fee: 0  },
  { name: 'TU',        fee: 0  },
  { name: 'Other',     fee: 0  },
]

const OVERHEAD_KEYS = ['labor_pct', 'marketing_pct']

const PACKAGING_SECTIONS = [
  {
    title: '🧋 บรรจุภัณฑ์เครื่องดื่ม',
    keys: ['packaging_bev_cup', 'packaging_bev_sticker', 'packaging_bev_straw', 'packaging_bev_seal', 'packaging_bev_bag'],
  },
  {
    title: '🍞 บรรจุภัณฑ์ขนมปัง',
    keys: ['packaging_bun_box', 'packaging_bun_sticker', 'packaging_bun_bag'],
  },
  {
    title: '⚡ ต้นทุนร่วม',
    keys: ['consumables', 'operation_cost'],
  },
]

function thaiDate(dateStr) {
  if (!dateStr) return '—'
  try {
    return new Date(dateStr).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

function EditBadge({ editing, onEdit }) {
  return !editing ? (
    <button
      onClick={onEdit}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 text-sm font-medium hover:bg-amber-200 transition-colors"
    >
      <Pencil size={14} /> แก้ไข
    </button>
  ) : (
    <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded-full border border-amber-200">
      <Pencil size={12} /> กำลังแก้ไข
    </span>
  )
}

export default function SettingsPage() {
  // ─── Platform Fee (dynamic) ───────────────────────────────────
  const [platforms, setPlatforms]         = useState(LEGACY_PLATFORMS)
  const [savedPlatforms, setSavedPlatforms] = useState(null)
  const [feeEditing, setFeeEditing]       = useState(false)
  const [feeUpdatedAt, setFeeUpdatedAt]   = useState(null)
  const [saving, setSaving]               = useState(false)
  const [feeStatus, setFeeStatus]         = useState('')
  const platDragItem                      = useRef(null)
  const [platDragOver, setPlatDragOver]   = useState(null)

  // ─── Overhead Cost (labor_pct, marketing_pct) ────────────────
  const [overheadEditing, setOverheadEditing]   = useState(false)
  const [overheadUpdatedAt, setOverheadUpdatedAt] = useState(null)
  const [savingOverhead, setSavingOverhead]       = useState(false)
  const [overheadStatus, setOverheadStatus]       = useState('')

  // ─── Global Cost Settings (packaging + shared) ───────────────
  const [costValues, setCostValues]           = useState({})
  const [savedCostValues, setSavedCostValues] = useState({})
  const [costEditing, setCostEditing]         = useState(false)
  const [costUpdatedAt, setCostUpdatedAt]     = useState(null)
  const [savingCost, setSavingCost]           = useState(false)
  const [costStatus, setCostStatus]           = useState('')
  const [costHistory, setCostHistory]         = useState([])
  const [showCostHistory, setShowCostHistory] = useState(false)

  useEffect(() => {
    const load = async () => {
      const [platConfigRaw, latestFeeAt, cs, latestCostRes] = await Promise.all([
        getSetting('platform_config'),
        getLatestFeeUpdatedAt(['platform_config']),
        getCurrentCostSettings(),
        supabase.from('cost_settings').select('effective_from').is('effective_to', null)
          .order('effective_from', { ascending: false }).limit(1).single(),
      ])

      let loadedPlatforms
      if (platConfigRaw) {
        loadedPlatforms = JSON.parse(platConfigRaw)
      } else {
        // Migrate from old individual fee settings
        const [grabFee, lineFee, shopeeFee, themetroFee, tuFee] = await Promise.all([
          getSetting('grab_fee_pct'), getSetting('line_fee_pct'),
          getSetting('shopee_fee_pct'), getSetting('the_metro_fee_pct'), getSetting('tu_fee_pct'),
        ])
        loadedPlatforms = [
          { name: 'GRAB',      fee: parseFloat(grabFee)     || 30 },
          { name: 'LINE',      fee: parseFloat(lineFee)     || 30 },
          { name: 'SHOPEE',    fee: parseFloat(shopeeFee)   || 30 },
          { name: 'The metro', fee: parseFloat(themetroFee) || 0  },
          { name: 'TU',        fee: parseFloat(tuFee)       || 0  },
          { name: 'Other',     fee: 0 },
        ]
      }
      setPlatforms(loadedPlatforms)
      setSavedPlatforms(loadedPlatforms)
      setFeeUpdatedAt(latestFeeAt)

      setCostValues(cs)
      setSavedCostValues(cs)

      const latestCostAt = latestCostRes?.data?.effective_from
      if (latestCostAt) {
        const d = new Date(latestCostAt)
        setCostUpdatedAt(d)
        setOverheadUpdatedAt(d) // same table, same date initially
      }
    }
    load()
  }, [])

  // ─── Platform Fee handlers ────────────────────────────────────
  const savePlatformSettings = async () => {
    setSaving(true)
    try {
      await setSetting('platform_config', JSON.stringify(platforms))
      setFeeUpdatedAt(new Date())
      setSavedPlatforms([...platforms])
      setFeeEditing(false)
      setFeeStatus('บันทึกสำเร็จ!')
    } catch {
      setFeeStatus('เกิดข้อผิดพลาด')
    }
    setSaving(false)
    setTimeout(() => setFeeStatus(''), 3000)
  }

  const cancelFeeEdit = () => {
    if (savedPlatforms) setPlatforms([...savedPlatforms])
    setFeeEditing(false)
    setFeeStatus('')
  }

  const handlePlatDrop = (toIdx) => {
    const fromIdx = platDragItem.current
    if (fromIdx === null || fromIdx === toIdx) { setPlatDragOver(null); return }
    const next = [...platforms]
    const [removed] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, removed)
    setPlatforms(next)
    platDragItem.current = null
    setPlatDragOver(null)
  }

  const updatePlatform = (i, key, val) =>
    setPlatforms(prev => prev.map((p, idx) => idx === i ? { ...p, [key]: val } : p))

  const addPlatform = () =>
    setPlatforms(prev => [...prev, { name: 'Platform ใหม่', fee: 0 }])

  const removePlatform = (i) =>
    setPlatforms(prev => prev.filter((_, idx) => idx !== i))

  // ─── Overhead Cost handlers ───────────────────────────────────
  const saveOverhead = async () => {
    setSavingOverhead(true)
    const overheadNew   = Object.fromEntries(OVERHEAD_KEYS.map(k => [k, costValues[k]   ?? 0]))
    const overheadSaved = Object.fromEntries(OVERHEAD_KEYS.map(k => [k, savedCostValues[k] ?? 0]))
    try {
      const result = await updateCostSettings(overheadNew, overheadSaved)
      if (result.changed === 0) {
        setOverheadStatus('ไม่มีอะไรเปลี่ยนแปลง')
      } else {
        setSavedCostValues(prev => ({ ...prev, ...overheadNew }))
        setOverheadUpdatedAt(new Date())
        setOverheadEditing(false)
        setOverheadStatus(`บันทึกสำเร็จ! (${result.changed} รายการ)`)
      }
    } catch {
      setOverheadStatus('เกิดข้อผิดพลาด')
    }
    setSavingOverhead(false)
    setTimeout(() => setOverheadStatus(''), 3000)
  }

  const cancelOverheadEdit = () => {
    setCostValues(prev => ({
      ...prev,
      ...Object.fromEntries(OVERHEAD_KEYS.map(k => [k, savedCostValues[k] ?? 0])),
    }))
    setOverheadEditing(false)
    setOverheadStatus('')
  }

  // ─── Global Cost (packaging) handlers ────────────────────────
  const saveGlobalCosts = async () => {
    setSavingCost(true)
    // Only save non-overhead keys
    const packagingKeys = PACKAGING_SECTIONS.flatMap(s => s.keys)
    const packagingNew   = Object.fromEntries(packagingKeys.map(k => [k, costValues[k]      ?? 0]))
    const packagingSaved = Object.fromEntries(packagingKeys.map(k => [k, savedCostValues[k] ?? 0]))
    try {
      const result = await updateCostSettings(packagingNew, packagingSaved)
      if (result.changed === 0) {
        setCostStatus('ไม่มีอะไรเปลี่ยนแปลง')
      } else {
        setSavedCostValues(prev => ({ ...prev, ...packagingNew }))
        setCostUpdatedAt(new Date())
        setCostEditing(false)
        setCostStatus(`บันทึกสำเร็จ! (${result.changed} รายการ)`)
      }
    } catch {
      setCostStatus('เกิดข้อผิดพลาด')
    }
    setSavingCost(false)
    setTimeout(() => setCostStatus(''), 3000)
  }

  const cancelCostEdit = () => {
    const packagingKeys = PACKAGING_SECTIONS.flatMap(s => s.keys)
    setCostValues(prev => ({
      ...prev,
      ...Object.fromEntries(packagingKeys.map(k => [k, savedCostValues[k] ?? 0])),
    }))
    setCostEditing(false)
    setCostStatus('')
  }

  const toggleCostHistory = async () => {
    if (!showCostHistory && costHistory.length === 0) {
      const hist = await getCostSettingsHistory(30)
      setCostHistory(hist)
    }
    setShowCostHistory(v => !v)
  }

  const fmt = (val, isPct) => isPct ? `${val ?? 0}%` : formatBaht(val ?? 0, 2)

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <h1 className="text-xl font-bold text-gray-900">ตั้งค่า</h1>

      {/* ── 1. Platform Fee % ──────────────────────────────────── */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-800">Platform Fee (%)</h2>
            {feeUpdatedAt && (
              <p className="text-xs text-gray-400 mt-0.5">
                อัปเดตล่าสุด {feeUpdatedAt.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            )}
          </div>
          <EditBadge editing={feeEditing} onEdit={() => setFeeEditing(true)} />
        </div>

        {!feeEditing && (
          <div className="flex flex-wrap gap-2">
            {platforms.map((p, i) => (
              <div key={i} className="bg-gray-50 rounded-xl px-4 py-2.5 text-center min-w-[80px]">
                <p className="text-xs text-gray-500 mb-1">{p.name}</p>
                <p className="text-lg font-bold text-gray-800">{p.fee}%</p>
              </div>
            ))}
          </div>
        )}

        {feeEditing && (
          <>
            <p className="text-xs text-amber-600 flex items-start gap-1">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              เปลี่ยนชื่อ Platform ไม่กระทบข้อมูลเก่า — % ใหม่มีผลกับยอดที่บันทึกหลังจากนี้
            </p>

            <div className="space-y-2">
              {platforms.map((p, i) => (
                <div
                  key={i}
                  draggable
                  onDragStart={() => { platDragItem.current = i }}
                  onDragOver={e => { e.preventDefault(); setPlatDragOver(i) }}
                  onDrop={() => handlePlatDrop(i)}
                  onDragEnd={() => { platDragItem.current = null; setPlatDragOver(null) }}
                  className={`flex items-center gap-2 p-2.5 rounded-xl border transition-colors ${
                    platDragOver === i ? 'border-amber-400 bg-amber-50 opacity-60' : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <GripVertical size={16} className="text-gray-400 shrink-0 cursor-grab active:cursor-grabbing" aria-hidden="true" />
                  <label htmlFor={`plat-name-${i}`} className="sr-only">ชื่อ Platform {i + 1}</label>
                  <input
                    id={`plat-name-${i}`}
                    type="text"
                    className="input flex-1 text-sm py-1.5 min-w-0"
                    value={p.name}
                    onChange={e => updatePlatform(i, 'name', e.target.value)}
                    placeholder="ชื่อ Platform"
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    <label htmlFor={`plat-fee-${i}`} className="sr-only">Fee % สำหรับ {p.name || `Platform ${i + 1}`}</label>
                    <input
                      id={`plat-fee-${i}`}
                      type="number"
                      className="input w-20 text-right text-sm py-1.5"
                      min="0" max="100" step="0.1"
                      value={p.fee}
                      onChange={e => updatePlatform(i, 'fee', parseFloat(e.target.value) || 0)}
                    />
                    <span className="text-xs text-gray-500 w-3" aria-hidden="true">%</span>
                  </div>
                  <button
                    onClick={() => removePlatform(i)}
                    disabled={platforms.length <= 1}
                    aria-label={`ลบ ${p.name || `Platform ${i + 1}`}`}
                    title={platforms.length <= 1 ? 'ต้องมีอย่างน้อย 1 Platform' : `ลบ ${p.name}`}
                    className="text-gray-300 hover:text-red-500 disabled:opacity-20 transition-colors p-1 shrink-0"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              ))}

              <button
                onClick={addPlatform}
                className="flex items-center gap-1.5 text-sm text-cocoa-600 hover:text-cocoa-800 font-medium px-1 py-1"
              >
                <Plus size={15} /> เพิ่ม Platform
              </button>
            </div>

            <div className="flex gap-2">
              <button onClick={savePlatformSettings} disabled={saving} className="btn-primary flex items-center gap-2">
                <Save size={16} />{saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
              <button onClick={cancelFeeEdit} disabled={saving} className="btn-secondary">ยกเลิก</button>
            </div>
            {feeStatus && <p className={`text-sm ${feeStatus.includes('สำเร็จ') ? 'text-green-600' : 'text-red-600'}`}>{feeStatus}</p>}
          </>
        )}
      </div>

      {/* ── 2. Overhead Cost (labor + marketing %) ────────────── */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-800">Overhead Cost (%)</h2>
            {overheadUpdatedAt && (
              <p className="text-xs text-gray-400 mt-0.5">
                อัปเดตล่าสุด {overheadUpdatedAt.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            )}
          </div>
          <EditBadge editing={overheadEditing} onEdit={() => setOverheadEditing(true)} />
        </div>

        {!overheadEditing && (
          <div className="grid grid-cols-2 gap-3">
            {OVERHEAD_KEYS.map(key => (
              <div key={key} className="bg-gray-50 rounded-xl px-3 py-2.5 text-center">
                <p className="text-xs text-gray-500 mb-1">{COST_KEY_LABELS[key] ?? key}</p>
                <p className="text-lg font-bold text-gray-800">{costValues[key] ?? 0}%</p>
              </div>
            ))}
          </div>
        )}

        {overheadEditing && (
          <>
            <p className="text-xs text-amber-600 flex items-start gap-1">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              การบันทึกจะสร้าง Version ใหม่ — ไม่กระทบการคำนวณต้นทุนย้อนหลัง
            </p>
            <div className="grid grid-cols-2 gap-3">
              {OVERHEAD_KEYS.map(key => (
                <div key={key}>
                  <label className="text-xs text-gray-500">{COST_KEY_LABELS[key] ?? key} (%)</label>
                  <input
                    type="number" min="0" step="0.5" className="input text-right"
                    value={costValues[key] ?? 0}
                    onChange={e => setCostValues(v => ({ ...v, [key]: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={saveOverhead} disabled={savingOverhead} className="btn-primary flex items-center gap-2">
                <Save size={16} />{savingOverhead ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
              <button onClick={cancelOverheadEdit} disabled={savingOverhead} className="btn-secondary">ยกเลิก</button>
            </div>
            {overheadStatus && (
              <p className={`text-sm ${overheadStatus.includes('สำเร็จ') ? 'text-green-600' : overheadStatus.includes('ไม่มี') ? 'text-gray-500' : 'text-red-600'}`}>
                {overheadStatus}
              </p>
            )}
          </>
        )}
      </div>

      {/* ── 3. Global Cost Settings (packaging + shared) ─────── */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-800">ค่าใช้จ่ายส่วนกลาง</h2>
            {costUpdatedAt && (
              <p className="text-xs text-gray-400 mt-0.5">
                อัปเดตล่าสุด {costUpdatedAt.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={toggleCostHistory} className="text-xs text-cocoa-600 hover:underline flex items-center gap-1">
              <History size={13} />{showCostHistory ? 'ซ่อนประวัติ' : 'ดูประวัติ'}
            </button>
            <EditBadge editing={costEditing} onEdit={() => setCostEditing(true)} />
          </div>
        </div>

        {/* Read-only */}
        {!costEditing && (
          <div className="space-y-4">
            {PACKAGING_SECTIONS.map(({ title, keys }) => (
              <div key={title}>
                <h3 className="text-sm font-semibold text-gray-600 mb-2">{title}</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {keys.map(key => (
                    <div key={key} className="bg-gray-50 rounded-xl px-3 py-2.5 text-center">
                      <p className="text-xs text-gray-500 mb-1">{COST_KEY_LABELS[key] ?? key}</p>
                      <p className="text-lg font-bold text-gray-800">{formatBaht(costValues[key] ?? 0, 2)}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Edit */}
        {costEditing && (
          <>
            <p className="text-xs text-amber-600 flex items-start gap-1">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              การบันทึกจะสร้าง Version ใหม่ — ไม่กระทบการคำนวณต้นทุนย้อนหลัง
            </p>
            {PACKAGING_SECTIONS.map(({ title, keys }) => (
              <div key={title}>
                <h3 className="text-sm font-semibold text-gray-600 mb-2">{title}</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {keys.map(key => (
                    <div key={key}>
                      <label className="text-xs text-gray-500">{COST_KEY_LABELS[key] ?? key} (฿)</label>
                      <input
                        type="number" min="0" step="0.01" className="input text-right"
                        value={costValues[key] ?? 0}
                        onChange={e => setCostValues(v => ({ ...v, [key]: parseFloat(e.target.value) || 0 }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <button onClick={saveGlobalCosts} disabled={savingCost} className="btn-primary flex items-center gap-2">
                <Save size={16} />{savingCost ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
              <button onClick={cancelCostEdit} disabled={savingCost} className="btn-secondary">ยกเลิก</button>
            </div>
            {costStatus && (
              <p className={`text-sm ${costStatus.includes('สำเร็จ') ? 'text-green-600' : costStatus.includes('ไม่มี') ? 'text-gray-500' : 'text-red-600'}`}>
                {costStatus}
              </p>
            )}
          </>
        )}

        {showCostHistory && (
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">📋 ประวัติการแก้ไขค่าใช้จ่ายส่วนกลาง</h3>
            {costHistory.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">ยังไม่มีประวัติ</p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {costHistory.map(h => (
                  <div key={h.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                    <span className="text-gray-400 text-xs w-20 shrink-0">{thaiDate(h.effective_from)}</span>
                    <span className="flex-1 text-gray-700 font-medium px-2">{COST_KEY_LABELS[h.key] ?? h.key}</span>
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${h.effective_to ? 'text-gray-400' : 'text-cocoa-700'}`}>
                        {h.key.endsWith('_pct') ? `${h.value}%` : formatBaht(h.value, 2)}
                      </span>
                      {!h.effective_to && (
                        <span className="text-xs bg-green-50 text-green-600 border border-green-200 px-1.5 py-0.5 rounded-full">ปัจจุบัน</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
