import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  Brain, CheckCircle, SkipForward, TrendingUp, TrendingDown,
  Minus, ChevronDown, ChevronUp, RefreshCw, Store, AlertCircle,
  RotateCcw, CalendarOff,
} from 'lucide-react'

const TYPE_LABELS = { daily: 'รายวัน', weekly: 'รายสัปดาห์', monthly: 'รายเดือน' }
const TYPE_COLORS = { daily: '#7C3AED', weekly: '#0891B2', monthly: '#059669' }
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

function fmt(n) {
  if (n == null || isNaN(n)) return '—'
  return Number(n).toLocaleString('th-TH', { maximumFractionDigits: 0 })
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return '—'
  return Number(n).toFixed(1) + '%'
}

// ─── Mark closed via API ──────────────────────────────────────────────────────
async function apiMarkClosed(date, reason) {
  const res = await fetch('/api/report-send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'close_day', date, reason }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function MetricChip({ label, value, pct, good = 'high', target }) {
  let bg = 'bg-gray-100 text-gray-600'
  if (pct && value != null) {
    const ok = good === 'high' ? value >= target : value <= target
    bg = ok ? 'bg-green-100 text-green-800' : value >= (good === 'high' ? target * 0.75 : target * 1.25)
      ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${bg}`}>
      {label}: {pct ? fmtPct(value) : `฿${fmt(value)}`}
    </span>
  )
}

function OutcomeBadge({ outcome }) {
  if (!outcome) return (
    <div className="flex items-center gap-1.5 text-xs text-gray-400 italic">
      <Minus size={12} /> รอ outcome วันพรุ่งนี้
    </div>
  )
  const isUp = outcome.includes('↑')
  const isDown = outcome.includes('↓')
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-xl text-sm ${
      isUp ? 'bg-green-50 text-green-800' : isDown ? 'bg-red-50 text-red-800' : 'bg-gray-50 text-gray-600'
    }`} role="status">
      {isUp ? <TrendingUp size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> :
       isDown ? <TrendingDown size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> :
       <Minus size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
      <span><strong>ผลจริง:</strong> {outcome}</span>
    </div>
  )
}

function ClosedDayCard({ date }) {
  return (
    <div className="bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-gray-200 flex items-center justify-center shrink-0">
        <Store size={18} className="text-gray-400" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-semibold text-gray-500">ร้านปิด</p>
        <p className="text-xs text-gray-400">{date} — ไม่นับใน trend และ outcome</p>
      </div>
    </div>
  )
}

function AICard({ record, onActionTaken, onMarkClosed }) {
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)
  const km    = record.key_metrics ?? {}
  const color = TYPE_COLORS[record.report_type] ?? '#7C3AED'
  const isClosed = km.closed === true

  if (isClosed) return <ClosedDayCard date={record.report_date} />

  async function setAction(action) {
    setSaving(true)
    setError(null)
    try {
      const { error: err } = await supabase
        .from('ai_memory')
        .update({ action_taken: action })
        .eq('id', record.id)
      if (err) throw err
      onActionTaken(record.id, action)
    } catch (e) {
      setError('บันทึกไม่สำเร็จ ลองอีกครั้ง')
    } finally {
      setSaving(false)
    }
  }

  const lines = (record.recommendations ?? '').split('\n').filter(l => l.trim())
  const visibleLines = expanded ? lines : lines.slice(0, 2)
  const hasMore = lines.length > 2

  return (
    <article
      className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden"
      aria-label={`AI รายงาน ${TYPE_LABELS[record.report_type]} วันที่ ${record.report_date}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3"
        style={{ background: color + '0D', borderBottom: `2px solid ${color}20` }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full text-white"
            style={{ background: color }}>
            {TYPE_LABELS[record.report_type]}
          </span>
          <time className="text-sm font-medium text-gray-700 truncate"
            dateTime={record.report_date}>
            {record.report_date}
          </time>
        </div>
        {record.action_taken === 'done' && (
          <span className="shrink-0 flex items-center gap-1 text-xs text-green-700 font-semibold bg-green-50 px-2 py-0.5 rounded-full" role="status">
            <CheckCircle size={12} aria-hidden="true" /> ทำแล้ว
          </span>
        )}
        {record.action_taken === 'skipped' && (
          <span className="shrink-0 flex items-center gap-1 text-xs text-gray-400 font-semibold bg-gray-100 px-2 py-0.5 rounded-full" role="status">
            <SkipForward size={12} aria-hidden="true" /> ข้ามไป
          </span>
        )}
      </div>

      <div className="p-4 space-y-3">
        {/* Metrics */}
        {(km.totalSales != null || km.netProfitPct != null || km.marketingFeePct != null || km.orderCount != null) && (
          <div className="flex flex-wrap gap-1.5" role="list" aria-label="ตัวชี้วัด">
            {km.totalSales != null && (
              <MetricChip label="ยอด" value={km.totalSales} />
            )}
            {km.netProfitPct != null && (
              <MetricChip label="Profit" value={km.netProfitPct} pct target={20} good="high" />
            )}
            {km.marketingFeePct != null && (
              <MetricChip label="Mkt Fee" value={km.marketingFeePct} pct target={20} good="low" />
            )}
            {km.orderCount != null && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                {km.orderCount} ออเดอร์
              </span>
            )}
            {km.aov != null && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                AOV ฿{fmt(km.aov)}
              </span>
            )}
          </div>
        )}

        {/* Outcome */}
        {record.report_type === 'daily' && (
          <OutcomeBadge outcome={record.outcome} />
        )}

        {/* Recommendations */}
        <div className="space-y-2" role="list" aria-label="คำแนะนำ AI">
          {visibleLines.map((line, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-gray-700 leading-relaxed" role="listitem">
              <span className="mt-1 shrink-0" style={{ color }} aria-hidden="true">•</span>
              <span>{line.replace(/^[•\-]\s*/, '')}</span>
            </div>
          ))}
          {hasMore && (
            <button
              onClick={() => setExpanded(p => !p)}
              aria-expanded={expanded}
              className="flex items-center gap-1 text-xs font-semibold mt-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded"
              style={{ color }}
            >
              {expanded
                ? <><ChevronUp size={12} aria-hidden="true" /> แสดงน้อยลง</>
                : <><ChevronDown size={12} aria-hidden="true" /> ดูทั้งหมด ({lines.length} ข้อ)</>
              }
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl" role="alert">
            <AlertCircle size={14} aria-hidden="true" /> {error}
          </div>
        )}

        {/* Action buttons */}
        {!record.action_taken ? (
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setAction('done')}
              disabled={saving}
              aria-label={`ทำแล้ว — คำแนะนำวันที่ ${record.report_date}`}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-semibold bg-green-500 hover:bg-green-600 active:scale-95 text-white transition-all disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-offset-2"
            >
              {saving ? <RefreshCw size={14} className="animate-spin" aria-hidden="true" /> : <CheckCircle size={15} aria-hidden="true" />}
              ทำแล้ว
            </button>
            <button
              onClick={() => setAction('skipped')}
              disabled={saving}
              aria-label={`ข้ามไป — คำแนะนำวันที่ ${record.report_date}`}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-semibold bg-gray-100 hover:bg-gray-200 active:scale-95 text-gray-600 transition-all disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
            >
              {saving ? <RefreshCw size={14} className="animate-spin" aria-hidden="true" /> : <SkipForward size={15} aria-hidden="true" />}
              ข้ามไป
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAction(null)}
            disabled={saving}
            aria-label="รีเซ็ตสถานะการดำเนินการ"
            className="w-full py-2.5 rounded-xl text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 focus-visible:ring-offset-2"
          >
            <RotateCcw size={13} className="inline mr-1" aria-hidden="true" /> รีเซ็ตสถานะ
          </button>
        )}

        {/* Mark closed (for daily records only, if not already closed) */}
        {record.report_type === 'daily' && !isClosed && (
          <button
            onClick={() => onMarkClosed(record.report_date)}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-xl transition focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
            aria-label={`ทำเครื่องหมายว่าร้านปิดวันที่ ${record.report_date}`}
          >
            <Store size={12} aria-hidden="true" /> ร้านปิดวันนี้ — แก้ไขย้อนหลัง
          </button>
        )}
      </div>
    </article>
  )
}

// ─── Close Day Modal ──────────────────────────────────────────────────────────
// date = null → แสดง date picker (retroactive mode)
// date = 'YYYY-MM-DD' → วันที่กำหนดมาแล้ว (จาก card หรือ today banner)
function CloseDayModal({ date: initialDate, onConfirm, onClose }) {
  const today  = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  const [date, setDate]     = useState(initialDate ?? today)
  const [reason, setReason] = useState('ร้านปิด')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const isRetroactive       = !initialDate  // เปิดจากปุ่ม retroactive

  async function handleConfirm() {
    if (!date) { setError('กรุณาเลือกวันที่'); return }
    setSaving(true)
    setError(null)
    try {
      await apiMarkClosed(date, reason)
      onConfirm(date)
    } catch (e) {
      setError('บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4"
      role="dialog" aria-modal="true" aria-labelledby="close-modal-title">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm space-y-4 p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center shrink-0">
            <CalendarOff size={20} className="text-orange-600" aria-hidden="true" />
          </div>
          <div>
            <h2 id="close-modal-title" className="font-bold text-gray-900">
              {isRetroactive ? 'บันทึกวันปิดร้านย้อนหลัง' : `ร้านปิดวันที่ ${date}`}
            </h2>
            <p className="text-xs text-gray-500">AI จะข้ามวันนี้ในการวิเคราะห์ trend</p>
          </div>
        </div>

        {/* Date picker — แสดงเฉพาะ retroactive mode */}
        {isRetroactive && (
          <div>
            <label htmlFor="close-date" className="text-sm font-medium text-gray-700 block mb-1.5">
              วันที่ปิดร้าน
            </label>
            <input
              id="close-date"
              type="date"
              value={date}
              max={today}
              onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
        )}

        <div>
          <label htmlFor="close-reason" className="text-sm font-medium text-gray-700 block mb-1.5">
            เหตุผล
          </label>
          <select
            id="close-reason"
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          >
            <option>ร้านปิด</option>
            <option>วันหยุดนักขัตฤกษ์</option>
            <option>ปรับปรุงร้าน</option>
            <option>เจ้าของป่วย</option>
            <option>สาเหตุอื่น</option>
          </select>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl" role="alert">
            <AlertCircle size={14} aria-hidden="true" /> {error}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300">
            ยกเลิก
          </button>
          <button onClick={handleConfirm} disabled={saving}
            className="flex-1 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2">
            {saving ? <RefreshCw size={14} className="animate-spin inline mr-1" aria-hidden="true" /> : null}
            ยืนยัน
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Close Day Banner (for today) ─────────────────────────────────────────────
function TodayClosedBanner({ date, isClosed, onMark, onUnmark, saving }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  if (date !== today) return null

  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border-2 ${
      isClosed ? 'bg-orange-50 border-orange-200' : 'bg-white border-gray-200'
    }`}>
      <div className="flex items-center gap-2">
        <Store size={18} className={isClosed ? 'text-orange-500' : 'text-gray-400'} aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-gray-800">
            {isClosed ? 'ร้านปิดวันนี้' : 'ร้านเปิดวันนี้'}
          </p>
          <p className="text-xs text-gray-500">
            {isClosed ? 'AI จะข้ามวันนี้ในการวิเคราะห์' : 'กดปุ่มหากร้านปิดวันนี้'}
          </p>
        </div>
      </div>
      <button
        onClick={isClosed ? onUnmark : onMark}
        disabled={saving}
        aria-label={isClosed ? 'ยกเลิกการทำเครื่องหมายปิดร้าน' : 'ทำเครื่องหมายว่าร้านปิดวันนี้'}
        className={`shrink-0 px-3 py-2 rounded-xl text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
          isClosed
            ? 'bg-white border border-orange-300 text-orange-600 hover:bg-orange-50 focus-visible:ring-orange-400'
            : 'bg-orange-500 text-white hover:bg-orange-600 focus-visible:ring-orange-400'
        }`}
      >
        {saving
          ? <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
          : isClosed ? 'ยกเลิก' : 'ปิดร้านวันนี้'
        }
      </button>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AIPage() {
  const [records, setRecords]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('all')
  const [stats, setStats]           = useState({ done: 0, skipped: 0, pending: 0 })
  const [closeDayTarget, setCloseDayTarget]       = useState(null)  // date string → from card
  const [showRetroModal, setShowRetroModal]       = useState(false) // null date → date picker
  const [todayClosed, setTodayClosed]             = useState(false)
  const [todayClosedSaving, setTodayClosedSaving] = useState(false)

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('ai_memory')
      .select('id, report_type, report_date, recommendations, key_metrics, outcome, action_taken')
      .order('report_date', { ascending: false })
      .limit(60)
    const all = data ?? []
    setRecords(all)
    setStats({
      done:    all.filter(r => r.action_taken === 'done').length,
      skipped: all.filter(r => r.action_taken === 'skipped').length,
      pending: all.filter(r => !r.action_taken && !(r.key_metrics?.closed)).length,
    })
    // check if today is marked closed
    const todayRec = all.find(r => r.report_type === 'daily' && r.report_date === today)
    setTodayClosed(todayRec?.key_metrics?.closed === true)
    setLoading(false)
  }, [today])

  useEffect(() => { load() }, [load])

  function handleActionTaken(id, action) {
    setRecords(prev => prev.map(r => r.id === id ? { ...r, action_taken: action } : r))
    setStats(prev => {
      const was = records.find(r => r.id === id)?.action_taken
      const next = { ...prev }
      if (was === 'done') next.done--
      else if (was === 'skipped') next.skipped--
      else next.pending--
      if (action === 'done') next.done++
      else if (action === 'skipped') next.skipped++
      else next.pending++
      return next
    })
  }

  async function handleMarkClosedToday() {
    setTodayClosedSaving(true)
    try {
      await apiMarkClosed(today, 'ร้านปิด')
      setTodayClosed(true)
      await load()
    } catch { /* ignore */ }
    setTodayClosedSaving(false)
  }

  async function handleUnmarkClosedToday() {
    setTodayClosedSaving(true)
    try {
      // delete the closed memory record and settings key
      await supabase.from('ai_memory')
        .delete()
        .eq('report_type', 'daily')
        .eq('report_date', today)
        .contains('key_metrics', { closed: true })
      await supabase.from('settings')
        .delete()
        .eq('key', `closed_${today}`)
      setTodayClosed(false)
      await load()
    } catch { /* ignore */ }
    setTodayClosedSaving(false)
  }

  function handleCloseDayConfirm(date) {
    setCloseDayTarget(null)
    // refresh to show the closed card
    load()
  }

  const countByType = records.reduce((acc, r) => {
    acc[r.report_type] = (acc[r.report_type] ?? 0) + 1
    return acc
  }, {})

  const filtered = filter === 'all' ? records : records.filter(r => r.report_type === filter)

  return (
    <>
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain size={22} className="text-purple-600" aria-hidden="true" />
              <h1 className="text-xl font-bold text-gray-900">AI Memory</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowRetroModal(true)}
                aria-label="บันทึกวันปิดร้านย้อนหลัง"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-orange-600 bg-orange-50 hover:bg-orange-100 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
              >
                <CalendarOff size={15} aria-hidden="true" />
                ย้อนหลัง
              </button>
              <button
                onClick={load}
                disabled={loading}
                aria-label="รีเฟรชข้อมูล"
                className="p-2.5 rounded-xl hover:bg-gray-100 text-gray-500 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Today closed banner */}
          <TodayClosedBanner
            date={today}
            isClosed={todayClosed}
            onMark={handleMarkClosedToday}
            onUnmark={handleUnmarkClosedToday}
            saving={todayClosedSaving}
          />

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3" role="region" aria-label="สถิติ">
            {[
              { label: 'รอดำเนินการ', value: stats.pending, color: 'text-amber-500' },
              { label: 'ทำแล้ว', value: stats.done, color: 'text-green-600' },
              { label: 'ข้ามไป', value: stats.skipped, color: 'text-gray-400' },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-2xl p-3 text-center shadow-sm border border-gray-100">
                <div className={`text-2xl font-bold ${s.color}`} aria-label={`${s.value} ${s.label}`}>
                  {s.value}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="กรองตามประเภท">
            {[
              ['all', 'ทั้งหมด', records.length],
              ['daily', 'รายวัน', countByType.daily ?? 0],
              ['weekly', 'รายสัปดาห์', countByType.weekly ?? 0],
              ['monthly', 'รายเดือน', countByType.monthly ?? 0],
            ].map(([v, label, count]) => (
              <button
                key={v}
                role="tab"
                aria-selected={filter === v}
                onClick={() => setFilter(v)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                  filter === v
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                }`}
              >
                {label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  filter === v ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
                }`}>
                  {count}
                </span>
              </button>
            ))}
          </div>

          {/* Cards */}
          {loading ? (
            <div className="text-center py-16 text-gray-400" role="status" aria-live="polite">
              <RefreshCw size={24} className="animate-spin mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm">กำลังโหลด...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-400" role="status">
              <Brain size={32} className="mx-auto mb-2 opacity-30" aria-hidden="true" />
              <p className="text-sm font-medium">ยังไม่มีข้อมูล AI Memory</p>
              <p className="text-xs mt-1 text-gray-400">จะเริ่มสะสมหลังจาก AI รายงานวันแรก</p>
            </div>
          ) : (
            <div className="space-y-4" role="feed" aria-label="รายการ AI Memory">
              {filtered.map(r => (
                <AICard
                  key={r.id}
                  record={r}
                  onActionTaken={handleActionTaken}
                  onMarkClosed={date => setCloseDayTarget(date)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Close Day Modal — from card (date fixed) */}
      {closeDayTarget && (
        <CloseDayModal
          date={closeDayTarget}
          onConfirm={handleCloseDayConfirm}
          onClose={() => setCloseDayTarget(null)}
        />
      )}

      {/* Retroactive Close Day Modal — date picker */}
      {showRetroModal && (
        <CloseDayModal
          date={null}
          onConfirm={date => { setShowRetroModal(false); load() }}
          onClose={() => setShowRetroModal(false)}
        />
      )}
    </>
  )
}
