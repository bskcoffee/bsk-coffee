import { useState, useEffect, useCallback } from 'react'
import {
  Wallet, TrendingUp, TrendingDown, Plus, Trash2,
  ChevronLeft, ChevronRight, X, ShoppingCart,
  Package, Zap, MoreHorizontal, ArrowDownCircle, User, BarChart2,
} from 'lucide-react'
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from 'date-fns'
import { supabase } from '../lib/supabase'
import { formatBaht } from '../utils/calculations'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'

// ─── Category Config ──────────────────────────────────────────

const MAT_CATEGORIES = [
  { key: 'วัตถุดิบ',    icon: ShoppingCart,   color: 'bg-orange-100 text-orange-600'  },
  { key: 'บรรจุภัณฑ์', icon: Package,        color: 'bg-blue-100 text-blue-600'      },
  { key: 'สาธารณูปโภค',icon: Zap,            color: 'bg-yellow-100 text-yellow-700'  },
  { key: 'อื่นๆ',       icon: MoreHorizontal, color: 'bg-gray-100 text-gray-600'      },
]

const PROFIT_CATEGORIES = [
  { key: 'ถอนออก',  icon: ArrowDownCircle, color: 'bg-red-100 text-red-600'      },
  { key: 'ส่วนตัว', icon: User,            color: 'bg-purple-100 text-purple-600' },
  { key: 'ลงทุน',   icon: BarChart2,       color: 'bg-green-100 text-green-600'   },
  { key: 'อื่นๆ',   icon: MoreHorizontal,  color: 'bg-gray-100 text-gray-600'     },
]

function catConfig(book, key) {
  const list = book === 'mat' ? MAT_CATEGORIES : PROFIT_CATEGORIES
  return list.find(c => c.key === key) ?? list[list.length - 1]
}

// ─── Helpers ─────────────────────────────────────────────────

function thaiShortDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
}

function monthLabel(m) {
  const d = new Date(m + '-01')
  return d.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })
}

// ─── Sub-components ──────────────────────────────────────────

function WalletCard({ book, received, spent, onClick, active }) {
  const balance = received - spent
  const label   = book === 'mat' ? 'กระเป๋า Mat Cost' : 'กระเป๋ากำไร'
  const bgActive = book === 'mat' ? 'bg-orange-500' : 'bg-emerald-600'
  const bgIdle   = 'bg-white border border-gray-200'
  const isActive = active === book

  return (
    <button
      onClick={() => onClick(book)}
      className={`flex-1 rounded-2xl p-4 text-left transition-all active:scale-95 ${
        isActive ? `${bgActive} text-white shadow-md` : `${bgIdle} text-gray-800`
      }`}
    >
      <Wallet size={18} className={isActive ? 'text-white/80 mb-2' : 'text-gray-400 mb-2'} />
      <p className={`text-xs font-medium mb-1 ${isActive ? 'text-white/80' : 'text-gray-500'}`}>{label}</p>
      <p className={`text-xl font-bold leading-tight ${balance < 0 ? (isActive ? 'text-red-200' : 'text-red-600') : ''}`}>
        {formatBaht(balance)}
      </p>
      <div className={`flex gap-3 mt-2 text-[11px] ${isActive ? 'text-white/70' : 'text-gray-400'}`}>
        <span>↑ {formatBaht(received)}</span>
        <span>↓ {formatBaht(spent)}</span>
      </div>
    </button>
  )
}

function CategoryBar({ entries, categories }) {
  const total = entries.reduce((s, e) => s + Number(e.amount), 0)
  if (total === 0) return null

  const grouped = {}
  for (const e of entries) {
    grouped[e.category] = (grouped[e.category] ?? 0) + Number(e.amount)
  }

  return (
    <div className="space-y-2">
      {categories.map(({ key, icon: Icon, color }) => {
        const amt = grouped[key] ?? 0
        if (amt === 0) return null
        const pct = Math.round((amt / total) * 100)
        return (
          <div key={key}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <span className={`w-5 h-5 rounded-md flex items-center justify-center ${color}`}>
                  <Icon size={11} />
                </span>
                <span className="text-xs text-gray-600">{key}</span>
              </div>
              <span className="text-xs font-semibold text-gray-800">{formatBaht(amt)}</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-current rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, color: color.split(' ')[1]?.replace('text-', '') }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── AddEntry Modal ───────────────────────────────────────────

function AddEntryModal({ book, onClose, onSaved }) {
  const { addToast } = useToast()
  const { user } = useAuth()
  const categories = book === 'mat' ? MAT_CATEGORIES : PROFIT_CATEGORIES
  const [form, setForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    description: '',
    category: categories[0].key,
    amount: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSave = async () => {
    if (!form.description.trim()) { addToast('กรุณาใส่รายละเอียด', 'error'); return }
    const amt = parseFloat(form.amount)
    if (!amt || amt <= 0) { addToast('จำนวนเงินต้องมากกว่า 0', 'error'); return }

    setSaving(true)
    const { error } = await supabase.from('cashbook_entries').insert({
      book,
      date:        form.date,
      description: form.description.trim(),
      category:    form.category,
      amount:      amt,
      notes:       form.notes.trim() || null,
      created_by:  user?.id,
    })
    setSaving(false)

    if (error) { addToast('บันทึกไม่สำเร็จ: ' + error.message, 'error'); return }
    addToast('บันทึกรายการเรียบร้อย', 'success')
    onSaved()
    onClose()
  }

  const accentCls = book === 'mat'
    ? 'bg-orange-500 hover:bg-orange-600 text-white'
    : 'bg-emerald-600 hover:bg-emerald-700 text-white'

  return (
    <div className="fixed inset-0 bg-black/50 flex flex-col justify-end z-50" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl px-4 pt-5 pb-8 safe-bottom space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="font-bold text-gray-900">
            + บันทึกรายจ่าย {book === 'mat' ? 'Mat Cost' : 'กำไร'}
          </p>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {/* Date */}
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">วันที่</label>
          <input
            type="date"
            value={form.date}
            onChange={e => set('date', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-cocoa-400"
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">รายละเอียด</label>
          <input
            type="text"
            placeholder="เช่น ซื้อนมสดสำหรับสัปดาห์..."
            value={form.description}
            onChange={e => set('description', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-cocoa-400"
          />
        </div>

        {/* Category chips */}
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-2">หมวดหมู่</label>
          <div className="flex flex-wrap gap-2">
            {categories.map(({ key, icon: Icon, color }) => (
              <button
                key={key}
                onClick={() => set('category', key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  form.category === key
                    ? `${color} border-current`
                    : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-300'
                }`}
              >
                <Icon size={12} /> {key}
              </button>
            ))}
          </div>
        </div>

        {/* Amount */}
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">จำนวนเงิน (บาท)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">฿</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.amount}
              onChange={e => set('amount', e.target.value)}
              className="w-full border border-gray-200 rounded-xl pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:border-cocoa-400"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">หมายเหตุ (ไม่บังคับ)</label>
          <textarea
            rows={2}
            placeholder="รายละเอียดเพิ่มเติม..."
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-cocoa-400 resize-none"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className={`w-full py-3 rounded-xl font-semibold text-sm transition-all ${accentCls} ${saving ? 'opacity-60' : ''}`}
        >
          {saving ? 'กำลังบันทึก...' : 'บันทึกรายจ่าย'}
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────

export default function CashFlowPage() {
  const { role } = useAuth()
  const { addToast } = useToast()
  const isAdmin = role === 'admin'

  const [month,      setMonth]      = useState(format(new Date(), 'yyyy-MM'))
  const [activeBook, setActiveBook] = useState('mat')
  const [tsData,     setTsData]     = useState([])   // transfer_status rows (mat/profit amounts)
  const [entries,    setEntries]    = useState([])   // cashbook_entries rows
  const [loading,    setLoading]    = useState(true)
  const [showAdd,    setShowAdd]    = useState(false)
  const [deleting,   setDeleting]   = useState(null)

  const start = format(startOfMonth(new Date(month + '-01')), 'yyyy-MM-dd')
  const end   = format(endOfMonth(new Date(month + '-01')),   'yyyy-MM-dd')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch all transfer_status rows that have been transferred (ever, not just this month)
      // We sum ALL history so the wallet balance is a running total
      const [tsRes, entRes] = await Promise.all([
        supabase
          .from('transfer_status')
          .select('sale_date, mat_transferred, mat_amount, profit_transferred, profit_amount')
          .or('mat_transferred.eq.true,profit_transferred.eq.true'),
        supabase
          .from('cashbook_entries')
          .select('*')
          .order('date', { ascending: false }),
      ])
      setTsData(tsRes.data ?? [])
      setEntries(entRes.data ?? [])
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Wallet totals (all-time running balance) ──

  const matReceived    = tsData.filter(t => t.mat_transferred).reduce((s, t) => s + Number(t.mat_amount ?? 0), 0)
  const profitReceived = tsData.filter(t => t.profit_transferred).reduce((s, t) => s + Number(t.profit_amount ?? 0), 0)
  const matSpent       = entries.filter(e => e.book === 'mat').reduce((s, e) => s + Number(e.amount), 0)
  const profitSpent    = entries.filter(e => e.book === 'profit').reduce((s, e) => s + Number(e.amount), 0)

  // ── This-month entries for the active book ──

  const monthEntries = entries.filter(e =>
    e.book === activeBook && e.date >= start && e.date <= end
  )

  // This-month received for active book
  const monthTsData = tsData.filter(t => t.sale_date >= start && t.sale_date <= end)
  const monthReceived = activeBook === 'mat'
    ? monthTsData.filter(t => t.mat_transferred).reduce((s, t) => s + Number(t.mat_amount ?? 0), 0)
    : monthTsData.filter(t => t.profit_transferred).reduce((s, t) => s + Number(t.profit_amount ?? 0), 0)
  const monthSpent = monthEntries.reduce((s, e) => s + Number(e.amount), 0)

  // ── Derived ──

  const activeReceived = activeBook === 'mat' ? matReceived    : profitReceived
  const activeSpent    = activeBook === 'mat' ? matSpent       : profitSpent
  const activeBalance  = activeReceived - activeSpent

  const categories = activeBook === 'mat' ? MAT_CATEGORIES : PROFIT_CATEGORIES
  const accentCls  = activeBook === 'mat' ? 'bg-orange-500' : 'bg-emerald-600'

  // ── Delete ──

  const handleDelete = async (id) => {
    if (!window.confirm('ลบรายการนี้?')) return
    setDeleting(id)
    const { error } = await supabase.from('cashbook_entries').delete().eq('id', id)
    setDeleting(null)
    if (error) { addToast('ลบไม่สำเร็จ', 'error'); return }
    addToast('ลบรายการแล้ว', 'success')
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  // ── Month nav ──

  const prevMonth = () => setMonth(m => format(subMonths(new Date(m + '-01'), 1), 'yyyy-MM'))
  const nextMonth = () => {
    const next = format(addMonths(new Date(month + '-01'), 1), 'yyyy-MM')
    if (next <= format(new Date(), 'yyyy-MM')) setMonth(next)
  }
  const isCurrentMonth = month === format(new Date(), 'yyyy-MM')

  // ─────────────────────────────────────────────

  return (
    <div className="max-w-lg mx-auto px-4 py-4 pb-24 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">รายรับรายจ่าย</h1>
          <p className="text-xs text-gray-400">ยอดคงเหลือสะสมทุกเวลา</p>
        </div>
      </div>

      {/* Wallet Cards */}
      <div className="flex gap-3">
        <WalletCard
          book="mat"
          received={matReceived}
          spent={matSpent}
          onClick={setActiveBook}
          active={activeBook}
        />
        <WalletCard
          book="profit"
          received={profitReceived}
          spent={profitSpent}
          onClick={setActiveBook}
          active={activeBook}
        />
      </div>

      {/* Active wallet detail header */}
      <div className={`rounded-2xl p-4 text-white ${accentCls}`}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold opacity-90">
            {activeBook === 'mat' ? '🧺 กระเป๋า Mat Cost' : '💰 กระเป๋ากำไร'}
          </p>
          <p className="text-2xl font-bold">{formatBaht(activeBalance)}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs opacity-80">
          <div className="bg-white/20 rounded-xl px-3 py-2">
            <p>รับเข้าทั้งหมด</p>
            <p className="font-bold text-base mt-0.5">{formatBaht(activeReceived)}</p>
          </div>
          <div className="bg-white/20 rounded-xl px-3 py-2">
            <p>จ่ายออกทั้งหมด</p>
            <p className="font-bold text-base mt-0.5">{formatBaht(activeSpent)}</p>
          </div>
        </div>
      </div>

      {/* Month nav + Add button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <ChevronLeft size={18} />
          </button>
          <p className="text-sm font-semibold text-gray-700 w-32 text-center">{monthLabel(month)}</p>
          <button onClick={nextMonth} disabled={isCurrentMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 disabled:opacity-30">
            <ChevronRight size={18} />
          </button>
        </div>

        {isAdmin && (
          <button
            onClick={() => setShowAdd(true)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-white text-xs font-semibold ${accentCls}`}
          >
            <Plus size={14} /> บันทึกรายจ่าย
          </button>
        )}
      </div>

      {/* This-month summary bar */}
      <div className="bg-gray-50 rounded-2xl px-4 py-3 flex items-center justify-between text-sm">
        <div>
          <p className="text-xs text-gray-400">รับเข้า (เดือนนี้)</p>
          <p className="font-bold text-gray-800">{formatBaht(monthReceived)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">จ่ายออก (เดือนนี้)</p>
          <p className="font-bold text-red-600">{formatBaht(monthSpent)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">คงเหลือ (เดือนนี้)</p>
          <p className={`font-bold ${(monthReceived - monthSpent) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
            {formatBaht(monthReceived - monthSpent)}
          </p>
        </div>
      </div>

      {/* Category breakdown */}
      {monthEntries.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">หมวดหมู่</p>
          <CategoryBar entries={monthEntries} categories={categories} />
        </div>
      )}

      {/* Entries list */}
      <div className="space-y-2">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-cocoa-300 border-t-cocoa-600 rounded-full animate-spin" />
          </div>
        ) : monthEntries.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <Wallet size={36} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">ยังไม่มีรายการในเดือนนี้</p>
            {isAdmin && <p className="text-xs mt-1">กด "+ บันทึกรายจ่าย" เพื่อเพิ่มรายการ</p>}
          </div>
        ) : (
          monthEntries.map(entry => {
            const cfg = catConfig(activeBook, entry.category)
            const Icon = cfg.icon
            return (
              <div key={entry.id} className="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${cfg.color}`}>
                  <Icon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{entry.description}</p>
                  <p className="text-[11px] text-gray-400">{thaiShortDate(entry.date)} · {entry.category}</p>
                  {entry.notes && <p className="text-[11px] text-gray-400 truncate">{entry.notes}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-red-600">-{formatBaht(entry.amount)}</p>
                  {isAdmin && (
                    <button
                      onClick={() => handleDelete(entry.id)}
                      disabled={deleting === entry.id}
                      className="text-gray-300 hover:text-red-400 transition-colors mt-0.5"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Add modal */}
      {showAdd && (
        <AddEntryModal
          book={activeBook}
          onClose={() => setShowAdd(false)}
          onSaved={loadData}
        />
      )}
    </div>
  )
}
