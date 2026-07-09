import { useState, useEffect, useRef } from 'react'
import {
  supabase,
  updateCostSettings, getCostSettingsHistory,
  getCostSettingsForDate, getCostSchema, saveCostSchema,
  getPlatformConfigForMonth, savePlatformConfigForMonth,
  DEFAULT_COST_SCHEMA,
} from '../lib/supabase'
import { COST_KEY_LABELS, formatBaht } from '../utils/calculations'
import { Save, AlertTriangle, History, Pencil, GripVertical, X, Plus, Loader2, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Calendar, CheckCircle2, XCircle, Info } from 'lucide-react'
import ConfirmModal from '../components/ConfirmModal'

// Status line with an icon alongside color, so success/error/neutral don't rely on color alone
function StatusMessage({ status }) {
  if (!status) return null
  const isSuccess = status.includes('สำเร็จ')
  const isNone = status.includes('ไม่มี')
  const Icon = isSuccess ? CheckCircle2 : isNone ? Info : XCircle
  const color = isSuccess ? 'text-green-600' : isNone ? 'text-gray-500' : 'text-red-600'
  return (
    <p className={`text-sm flex items-center gap-1.5 ${color}`}>
      <Icon size={14} className="shrink-0" />
      {status}
    </p>
  )
}


// ─── Month helpers ─────────────────────────────────────────────────────────

const TODAY_MONTH = new Date().toISOString().slice(0, 7) // "2026-06"

function prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number)
  if (m === 1) return `${y - 1}-12`
  return `${y}-${String(m - 1).padStart(2, '0')}`
}
function nextMonth(ym) {
  const [y, m] = ym.split('-').map(Number)
  if (m === 12) return `${y + 1}-01`
  return `${y}-${String(m + 1).padStart(2, '0')}`
}
function thaiMonthYear(ym) {
  const [y, m] = ym.split('-').map(Number)
  const names = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
  return `${names[m - 1]} ${y + 543}`
}
function monthFirstDay(ym) { return `${ym}-01` }
function monthLastDay(ym) {
  const [y, m] = ym.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return `${ym}-${String(lastDay).padStart(2, '0')}`
}
function todayStr() { return new Date().toISOString().slice(0, 10) }

function MonthPicker({ month, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5">
        <button
          onClick={() => onChange(prevMonth(month))}
          className="p-2 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-900 transition-colors"
          aria-label="เดือนก่อน"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="font-medium text-sm min-w-[96px] text-center px-1">{thaiMonthYear(month)}</span>
        <button
          onClick={() => onChange(nextMonth(month))}
          disabled={month >= TODAY_MONTH}
          className="p-2 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="เดือนถัดไป"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      {month === TODAY_MONTH && (
        <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full font-medium">
          เดือนนี้
        </span>
      )}
    </div>
  )
}

// ─── Misc helpers ──────────────────────────────────────────────────────────

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

const LEGACY_PLATFORMS = [
  { name: 'GRAB',      fee: 30 },
  { name: 'LINE',      fee: 30 },
  { name: 'SHOPEE',    fee: 30 },
  { name: 'The metro', fee: 0  },
  { name: 'TU',        fee: 0  },
  { name: 'Other',     fee: 0  },
]

const OVERHEAD_KEYS = ['labor_pct', 'marketing_pct']

function thaiDate(dateStr) {
  if (!dateStr) return '—'
  try {
    return new Date(dateStr).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

function EditBadge({ editing, onEdit, disabled }) {
  return !editing ? (
    <button
      onClick={onEdit}
      disabled={disabled}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 text-sm font-medium hover:bg-amber-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
    >
      <Pencil size={14} /> แก้ไข
    </button>
  ) : (
    <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded-full border border-amber-200">
      <Pencil size={12} /> กำลังแก้ไข
    </span>
  )
}

function ReadOnlyBadge() {
  return (
    <span
      title="แก้ไขได้เฉพาะเดือนปัจจุบัน"
      className="text-xs bg-gray-100 text-gray-500 border border-gray-200 px-2.5 py-1 rounded-full cursor-default"
    >
      ดูได้อย่างเดียว
    </span>
  )
}

// ─── Main Settings Page ────────────────────────────────────────────────────

export default function SettingsPage() {
  // ── Month navigation ──────────────────────────────────────────
  const [selectedMonth, setSelectedMonth] = useState(TODAY_MONTH)
  const isCurrentMonth = selectedMonth === TODAY_MONTH

  // ─── Month change guard ───────────────────────────────────────
  const [monthLoading, setMonthLoading] = useState(false)
  const [pendingMonth, setPendingMonth] = useState(null) // เดือนที่รอ confirm เมื่อมีข้อมูลยังไม่ได้บันทึก

  const handleMonthChange = (newMonth) => {
    if (feeEditing || overheadEditing || costEditing) {
      setPendingMonth(newMonth)
      return
    }
    setSelectedMonth(newMonth)
  }

  const confirmMonthChange = () => {
    if (pendingMonth == null) return
    setSelectedMonth(pendingMonth)
    setPendingMonth(null)
  }

  // ─── Platform Fee (dynamic) ───────────────────────────────────
  const [platforms, setPlatforms]           = useState(LEGACY_PLATFORMS)
  const [savedPlatforms, setSavedPlatforms] = useState(null)
  const [feeEditing, setFeeEditing]         = useState(false)
  const [feeUpdatedAt, setFeeUpdatedAt]     = useState(null)
  const [saving, setSaving]                 = useState(false)
  const [feeStatus, setFeeStatus]           = useState('')
  const platDragItem                        = useRef(null)
  const [platDragOver, setPlatDragOver]     = useState(null)

  // ─── Overhead Cost (labor_pct, marketing_pct) ────────────────
  const [overheadEditing, setOverheadEditing]     = useState(false)
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

  // ─── Cost Schema (structure + labels) ────────────────────────
  const [costSchema, setCostSchema]     = useState(null)
  const [draftSchema, setDraftSchema]   = useState(null)

  // Load schema once (not month-specific)
  useEffect(() => {
    getCostSchema().then(s => {
      setCostSchema(s)
      setDraftSchema(s)
    })
  }, [])

  // Load platform fee + cost settings per selected month
  useEffect(() => {
    const load = async () => {
      setMonthLoading(true)
      const firstDay  = monthFirstDay(selectedMonth)
      // Use today for current month (catches mid-month changes), last day for past months
      const queryDate = isCurrentMonth ? todayStr() : monthLastDay(selectedMonth)

      const [platConfig, latestFeeAt, cs, latestCostRes] = await Promise.all([
        getPlatformConfigForMonth(selectedMonth),
        getLatestFeeUpdatedAt([`platform_config_${selectedMonth}`, 'platform_config']),
        getCostSettingsForDate(queryDate),
        supabase.from('cost_settings')
          .select('effective_from')
          .lte('effective_from', queryDate)
          .order('effective_from', { ascending: false })
          .limit(1).single(),
      ])

      const loadedPlatforms = platConfig ?? LEGACY_PLATFORMS
      setPlatforms(loadedPlatforms)
      setSavedPlatforms(loadedPlatforms)
      setFeeUpdatedAt(latestFeeAt)

      setCostValues(cs)
      setSavedCostValues(cs)

      const latestCostAt = latestCostRes?.data?.effective_from
      if (latestCostAt) {
        const d = new Date(latestCostAt)
        setCostUpdatedAt(d)
        setOverheadUpdatedAt(d)
      } else {
        setCostUpdatedAt(null)
        setOverheadUpdatedAt(null)
      }

      // Close any open edits when navigating months
      setFeeEditing(false)
      setOverheadEditing(false)
      setCostEditing(false)
      setMonthLoading(false)
    }
    load()
  }, [selectedMonth])

  // ─── Platform Fee handlers ────────────────────────────────────
  const savePlatformSettings = async () => {
    setSaving(true)
    let success = false
    try {
      await savePlatformConfigForMonth(selectedMonth, platforms, isCurrentMonth)
      setFeeUpdatedAt(new Date())
      setSavedPlatforms([...platforms])
      setFeeEditing(false)
      setFeeStatus('บันทึกสำเร็จ!')
      success = true
    } catch {
      setFeeStatus('เกิดข้อผิดพลาด — กรุณาลองอีกครั้ง')
    }
    setSaving(false)
    if (success) setTimeout(() => setFeeStatus(''), 3000)
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

  // Keyboard-accessible alternative to drag-and-drop
  const movePlatform = (i, direction) => {
    const target = i + direction
    if (target < 0 || target >= platforms.length) return
    const next = [...platforms]
    ;[next[i], next[target]] = [next[target], next[i]]
    setPlatforms(next)
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
    const overheadNew   = Object.fromEntries(OVERHEAD_KEYS.map(k => [k, costValues[k]      ?? 0]))
    const overheadSaved = Object.fromEntries(OVERHEAD_KEYS.map(k => [k, savedCostValues[k] ?? 0]))
    let autoFade = true
    try {
      const result = await updateCostSettings(overheadNew, overheadSaved, monthFirstDay(selectedMonth))
      if (result.changed === 0) {
        setOverheadStatus('ไม่มีอะไรเปลี่ยนแปลง')
      } else {
        setSavedCostValues(prev => ({ ...prev, ...overheadNew }))
        setOverheadUpdatedAt(new Date())
        setOverheadEditing(false)
        setOverheadStatus(`บันทึกสำเร็จ! (${result.changed} รายการ)`)
      }
    } catch {
      setOverheadStatus('เกิดข้อผิดพลาด — กรุณาลองอีกครั้ง')
      autoFade = false
    }
    setSavingOverhead(false)
    if (autoFade) setTimeout(() => setOverheadStatus(''), 3000)
  }

  const cancelOverheadEdit = () => {
    setCostValues(prev => ({
      ...prev,
      ...Object.fromEntries(OVERHEAD_KEYS.map(k => [k, savedCostValues[k] ?? 0])),
    }))
    setOverheadEditing(false)
    setOverheadStatus('')
  }

  // ─── Global Cost (packaging + shared via schema) handlers ────
  const saveGlobalCosts = async () => {
    setSavingCost(true)
    let autoFade = true
    try {
      // Save schema (labels + structure)
      await saveCostSchema(draftSchema)
      setCostSchema(draftSchema)

      // Save all values for keys in draftSchema sections
      const allKeys = (draftSchema?.sections ?? []).flatMap(s => (s.items ?? []).map(i => i.key))
      const newVals   = Object.fromEntries(allKeys.map(k => [k, costValues[k]      ?? 0]))
      const savedVals = Object.fromEntries(allKeys.map(k => [k, savedCostValues[k] ?? 0]))
      const result = await updateCostSettings(newVals, savedVals, monthFirstDay(selectedMonth))

      const schemaChanged = JSON.stringify(draftSchema) !== JSON.stringify(costSchema)
      if (result.changed === 0 && !schemaChanged) {
        setCostStatus('ไม่มีอะไรเปลี่ยนแปลง')
      } else {
        setSavedCostValues(prev => ({ ...prev, ...newVals }))
        setCostUpdatedAt(new Date())
        setCostEditing(false)
        setCostStatus(`บันทึกสำเร็จ!${result.changed > 0 ? ` (${result.changed} รายการ)` : ''}`)
      }
    } catch {
      setCostStatus('เกิดข้อผิดพลาด — กรุณาลองอีกครั้ง')
      autoFade = false
    }
    setSavingCost(false)
    if (autoFade) setTimeout(() => setCostStatus(''), 3000)
  }

  const cancelCostEdit = () => {
    const allKeys = (costSchema?.sections ?? []).flatMap(s => (s.items ?? []).map(i => i.key))
    setCostValues(prev => ({
      ...prev,
      ...Object.fromEntries(allKeys.map(k => [k, savedCostValues[k] ?? 0])),
    }))
    setDraftSchema(costSchema)
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

  // ─── Schema mutation helpers ──────────────────────────────────
  const addItemToSection = (sectionId) => {
    const newKey = `custom_${Date.now()}`
    setDraftSchema(prev => ({
      ...prev,
      sections: prev.sections.map(s =>
        s.id === sectionId
          ? { ...s, items: [...(s.items ?? []), { key: newKey, label: 'รายการใหม่' }] }
          : s
      ),
    }))
    setCostValues(prev => ({ ...prev, [newKey]: 0 }))
  }

  const removeItemFromSection = (sectionId, key) => {
    setDraftSchema(prev => ({
      ...prev,
      sections: prev.sections.map(s =>
        s.id === sectionId
          ? { ...s, items: (s.items ?? []).filter(i => i.key !== key) }
          : s
      ),
    }))
  }

  const updateItemLabel = (sectionId, key, label) => {
    setDraftSchema(prev => ({
      ...prev,
      sections: prev.sections.map(s =>
        s.id === sectionId
          ? { ...s, items: (s.items ?? []).map(i => i.key === key ? { ...i, label } : i) }
          : s
      ),
    }))
  }

  const updateSectionTitle = (sectionId, title) => {
    setDraftSchema(prev => ({
      ...prev,
      sections: prev.sections.map(s => s.id === sectionId ? { ...s, title } : s),
    }))
  }

  const addSection = () => {
    const newId = `section_${Date.now()}`
    setDraftSchema(prev => ({
      ...prev,
      sections: [
        ...prev.sections,
        { id: newId, title: '🆕 หมวดใหม่', pkg_type: newId, items: [] },
      ],
    }))
  }

  const removeSection = (sectionId) => {
    setDraftSchema(prev => ({
      ...prev,
      sections: prev.sections.filter(s => s.id !== sectionId),
    }))
  }

  const fmt = (val, isPct) => isPct ? `${val ?? 0}%` : formatBaht(val ?? 0, 2)

  const activeSchema = costSchema ?? DEFAULT_COST_SCHEMA

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <h1 className="text-xl font-bold text-gray-900">ตั้งค่า</h1>

      {/* ── Month picker ───────────────────────────────────────── */}
      <div className="card py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-gray-400" />
            <span className="text-sm text-gray-600 font-medium">ดูข้อมูลตามเดือน</span>
            {monthLoading && <Loader2 size={14} className="animate-spin text-gray-400" />}
          </div>
          <MonthPicker month={selectedMonth} onChange={handleMonthChange} />
        </div>
        {!isCurrentMonth && (
          <p className="text-xs text-amber-600 mt-2">
            กำลังดูข้อมูล {thaiMonthYear(selectedMonth)} — บันทึกจะบันทึกย้อนหลังไปเดือนนั้น
          </p>
        )}
      </div>

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
                  {/* Keyboard-accessible reorder alternative to drag-and-drop */}
                  <div className="flex flex-col shrink-0">
                    <button
                      type="button"
                      draggable={false}
                      onClick={() => movePlatform(i, -1)}
                      disabled={i === 0}
                      aria-label={`ย้าย ${p.name || `Platform ${i + 1}`} ขึ้น`}
                      className="p-0.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      type="button"
                      draggable={false}
                      onClick={() => movePlatform(i, 1)}
                      disabled={i === platforms.length - 1}
                      aria-label={`ย้าย ${p.name || `Platform ${i + 1}`} ลง`}
                      className="p-0.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <ChevronDown size={13} />
                    </button>
                  </div>
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
                    className="text-gray-300 hover:text-red-500 disabled:opacity-20 transition-colors p-2.5 shrink-0"
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
            <StatusMessage status={feeStatus} />
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
                  <label htmlFor={`overhead-${key}`} className="text-xs text-gray-500">{COST_KEY_LABELS[key] ?? key} (%)</label>
                  <input
                    id={`overhead-${key}`}
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
            <StatusMessage status={overheadStatus} />
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
            <button onClick={toggleCostHistory} aria-expanded={showCostHistory} className="text-xs text-cocoa-600 hover:underline flex items-center gap-1">
              <History size={13} />{showCostHistory ? 'ซ่อนประวัติ' : 'ดูประวัติ'}
            </button>
            <EditBadge editing={costEditing} onEdit={() => setCostEditing(true)} />
          </div>
        </div>

        {/* Read-only: render from costSchema */}
        {!costEditing && (
          <div className="space-y-4">
            {activeSchema.sections.map(({ id, title, items }) => (
              <div key={id ?? title}>
                <h3 className="text-sm font-semibold text-gray-600 mb-2">{title}</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {(items ?? []).map(({ key, label }) => (
                    <div key={key} className="bg-gray-50 rounded-xl px-3 py-2.5 text-center">
                      <p className="text-xs text-gray-500 mb-1">{label}</p>
                      <p className="text-lg font-bold text-gray-800">{formatBaht(costValues[key] ?? 0, 2)}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Edit: schema editor */}
        {costEditing && draftSchema && (
          <>
            <p className="text-xs text-amber-600 flex items-start gap-1">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              แก้ไขชื่อ/เพิ่มรายการได้เลย — การบันทึกสร้าง Version ใหม่ ไม่กระทบย้อนหลัง
            </p>

            <div className="space-y-5">
              {draftSchema.sections.map((section) => (
                <div key={section.id} className="border border-gray-100 rounded-xl p-3 space-y-2">
                  {/* Section header */}
                  <div className="flex items-center gap-2">
                    <input
                      className="input flex-1 text-sm font-semibold py-1.5"
                      value={section.title}
                      onChange={e => updateSectionTitle(section.id, e.target.value)}
                      placeholder="ชื่อหมวด"
                    />
                    {draftSchema.sections.length > 1 && (
                      <button
                        onClick={() => removeSection(section.id)}
                        className="text-gray-300 hover:text-red-500 transition-colors p-2.5"
                        title="ลบหมวดนี้"
                        aria-label={`ลบหมวด ${section.title}`}
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>

                  {/* Items */}
                  {(section.items ?? []).map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-2">
                      <input
                        className="input flex-1 text-sm py-1.5 min-w-0"
                        value={label}
                        placeholder="ชื่อรายการ"
                        onChange={e => updateItemLabel(section.id, key, e.target.value)}
                      />
                      <input
                        type="number" min="0" step="0.01"
                        aria-label={`มูลค่า ${label} (บาท)`}
                        className="input w-24 text-right text-sm py-1.5 shrink-0"
                        value={costValues[key] ?? 0}
                        onChange={e => setCostValues(v => ({ ...v, [key]: parseFloat(e.target.value) || 0 }))}
                      />
                      <span className="text-xs text-gray-400 w-3 shrink-0">฿</span>
                      <button
                        onClick={() => removeItemFromSection(section.id, key)}
                        className="text-gray-300 hover:text-red-500 transition-colors p-2.5 shrink-0"
                        aria-label={`ลบ ${label}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}

                  {/* Add item */}
                  <button
                    onClick={() => addItemToSection(section.id)}
                    className="flex items-center gap-1.5 text-xs text-cocoa-600 hover:text-cocoa-800 font-medium px-1 py-1"
                  >
                    <Plus size={13} /> เพิ่มรายการ
                  </button>
                </div>
              ))}

              {/* Add section */}
              <button
                onClick={addSection}
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 border border-dashed border-gray-300 hover:border-gray-400 rounded-xl px-4 py-3 w-full justify-center transition-colors"
              >
                <Plus size={15} /> เพิ่มหมวดใหม่
              </button>
            </div>

            <div className="flex gap-2">
              <button onClick={saveGlobalCosts} disabled={savingCost} className="btn-primary flex items-center gap-2">
                <Save size={16} />{savingCost ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
              <button onClick={cancelCostEdit} disabled={savingCost} className="btn-secondary">ยกเลิก</button>
            </div>
            <StatusMessage status={costStatus} />
          </>
        )}

        {/* Show status when read-only */}
        {!costEditing && <StatusMessage status={costStatus} />}

        {showCostHistory && (
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">📋 ประวัติการแก้ไขค่าใช้จ่ายส่วนกลาง</h3>
            {costHistory.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">ยังไม่มีประวัติ</p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {costHistory.map(h => {
                  // Find label from costSchema
                  let label = h.key
                  for (const sec of activeSchema.sections) {
                    const found = (sec.items ?? []).find(i => i.key === h.key)
                    if (found) { label = found.label; break }
                  }
                  return (
                    <div key={h.id ?? `${h.key}-${h.effective_from}`} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                      <span className="text-gray-400 text-xs w-20 shrink-0">{thaiDate(h.effective_from)}</span>
                      <span className="flex-1 text-gray-700 font-medium px-2">{label}</span>
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold ${h.effective_to ? 'text-gray-400' : 'text-cocoa-700'}`}>
                          {h.key.endsWith('_pct') ? `${h.value}%` : formatBaht(h.value, 2)}
                        </span>
                        {!h.effective_to && (
                          <span className="text-xs bg-green-50 text-green-600 border border-green-200 px-1.5 py-0.5 rounded-full">ปัจจุบัน</span>
 )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmModal
        open={pendingMonth != null}
        title="มีการแก้ไขที่ยังไม่ได้บันทึก"
        message="ต้องการเปลี่ยนเดือนหรือไม่? การแก้ไขที่ยังไม่บันทึกจะหายไป"
        confirmLabel="เปลี่ยนเดือน"
        danger
        onConfirm={confirmMonthChange}
        onCancel={() => setPendingMonth(null)}
      />
    </div>
  )
}
