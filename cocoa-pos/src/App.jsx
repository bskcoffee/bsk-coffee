import { useState, useRef, useEffect, useMemo } from 'react'
import { format } from 'date-fns'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import LoginPage       from './pages/LoginPage'
import POSPage         from './pages/POSPage'
import OrderManagePage from './pages/OrderManagePage'
import MenuOptionModal from './components/MenuOptionModal'
import { supabase } from './lib/supabase'
import { ShoppingCart, ClipboardList, LayoutDashboard, X, Package, Printer, Search, Loader2, ChevronRight, ScrollText } from 'lucide-react'

async function sendLabelPrint(menu, options) {
  const labelRes = await supabase.from('settings').select('value').eq('key', 'label_settings').maybeSingle()
  const labelSettings = labelRes.data?.value ? JSON.parse(labelRes.data.value) : {}
  const ip   = labelSettings.printerIp   ?? '192.168.1.100'
  const port = labelSettings.printerPort ?? 3001
  const res  = await fetch(`http://${ip}:${port}/print`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      orderId: 'TEST',
      platform: 'GRAB',
      items: [{ name: menu.name, qty: 1, item_options: options, isCampaign: false }],
      labelSettings,
    }),
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

function buildOptionsSummary(options) {
  const parts = []
  if (options?.sweetness != null) parts.push(`หวาน ${options.sweetness}%`)
  if (options?.packaging)        parts.push(options.packaging)
  ;(options?.optionGroups ?? []).forEach(g => {
    (g.choices ?? []).forEach(c => parts.push(`${c.label}${c.qty > 1 ? ` ×${c.qty}` : ''}`))
  })
  return parts.join(' · ') || '—'
}

function PrintLabelModal({ onClose, onAddLog }) {
  const [menus,        setMenus]        = useState([])
  const [optionGroups, setOptionGroups] = useState([])
  const [loadingM,    setLoadingM]    = useState(true)
  const [search,      setSearch]      = useState('')
  const [selected,    setSelected]    = useState(null)
  const [showOptions, setShowOptions] = useState(false)
  const [printing,     setPrinting]     = useState(false)
  const [printStatus,  setPrintStatus]  = useState(null)  // null | 'success' | 'error'

  useEffect(() => {
    Promise.all([
      supabase
        .from('menus')
        .select('id, name, category, image_url, menu_prices(platform, price)')
        .eq('is_active', true)
        .order('sort_order'),
      supabase.from('menu_option_groups')
        .select('*, menu_option_choices(*)')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
    ]).then(([menusRes, optionGroupsRes]) => {
      setMenus(menusRes.data ?? [])
      setOptionGroups((optionGroupsRes.data ?? []).map(g => ({
        ...g,
        choices: (g.menu_option_choices ?? [])
          .filter(c => c.is_active)
          .sort((a, b) => a.sort_order - b.sort_order),
      })))
      setLoadingM(false)
    })
  }, [])

  const filtered = menus.filter(m => m.name.toLowerCase().includes(search.toLowerCase()))
  const groupsForSelected = useMemo(() => {
    if (!selected) return []
    return optionGroups.filter(g => (g.categories ?? []).includes(selected.category))
  }, [optionGroups, selected])

  const handlePrint = async (options) => {
    setPrinting(true)
    setPrintStatus(null)
    let status = 'success'
    try {
      await sendLabelPrint(selected, options)
    } catch (err) {
      console.warn('test print failed:', err.message)
      status = 'error'
    }
    onAddLog?.({
      id:        Date.now(),
      menuName:  selected.name,
      menuObj:   selected,
      options,
      summary:   buildOptionsSummary(options),
      status,
      timestamp: new Date(),
    })
    setPrintStatus(status)
    setPrinting(false)
    setShowOptions(false)
    setSelected(null)
    setTimeout(() => setPrintStatus(null), 4000)
  }

  if (showOptions && selected) {
    return (
      <MenuOptionModal
        menu={selected}
        platform="GRAB"
        optionGroups={groupsForSelected}
        onConfirm={handlePrint}
        onClose={() => setShowOptions(false)}
        confirmLabel={printing ? 'กำลังพิมพ์...' : '🖨 พิมพ์ฉลาก'}
      />
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end z-50" onClick={onClose}>
      <div className="bg-white rounded-t-3xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 shrink-0">
          <p className="font-bold text-gray-900 flex items-center gap-2">
            <Printer size={16} /> พิมพ์ฉลาก
          </p>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        {/* Status banner */}
        {printStatus === 'success' && (
          <div className="mx-5 mt-3 px-4 py-2.5 rounded-xl bg-green-50 border border-green-200 flex items-center gap-2 shrink-0">
            <span className="text-green-600 text-lg">✓</span>
            <p className="text-sm font-semibold text-green-700">ส่งคำสั่งพิมพ์สำเร็จ</p>
          </div>
        )}
        {printStatus === 'error' && (
          <div className="mx-5 mt-3 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2 shrink-0">
            <span className="text-red-500 text-lg">✕</span>
            <p className="text-sm font-semibold text-red-600">พิมพ์ไม่สำเร็จ — ตรวจสอบ print server</p>
          </div>
        )}
        {printing && (
          <div className="mx-5 mt-3 px-4 py-2.5 rounded-xl bg-blue-50 border border-blue-200 flex items-center gap-2 shrink-0">
            <Loader2 size={15} className="animate-spin text-blue-500" />
            <p className="text-sm font-semibold text-blue-600">กำลังส่งคำสั่งพิมพ์...</p>
          </div>
        )}

        <div className="px-5 pt-3 pb-1 shrink-0">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหาเมนู..."
              autoFocus
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:border-cocoa-400"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {loadingM ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={22} className="animate-spin text-cocoa-400" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">ไม่พบเมนู</p>
          ) : filtered.map(menu => (
            <button
              key={menu.id}
              onClick={() => { setSelected(menu); setShowOptions(true) }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 hover:border-cocoa-300 hover:bg-cocoa-50 text-left transition-all active:scale-[0.98]"
            >
              {menu.image_url
                ? <img src={menu.image_url} alt={menu.name} className="w-10 h-10 rounded-lg object-cover shrink-0" />
                : <div className="w-10 h-10 rounded-lg bg-gray-100 shrink-0 flex items-center justify-center text-xl">☕</div>
              }
              <span className="flex-1 text-sm font-semibold text-gray-800">{menu.name}</span>
              <ChevronRight size={16} className="text-gray-400 shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function PrintLogModal({ printLog, onUpdateLog, onClear, onClose }) {
  const [retrying, setRetrying] = useState(null)

  const handleRetry = async (entry) => {
    setRetrying(entry.id)
    let status = 'success'
    try {
      await sendLabelPrint(entry.menuObj, entry.options)
    } catch (err) {
      console.warn('retry print failed:', err.message)
      status = 'error'
    }
    onUpdateLog(entry.id, status)
    setRetrying(null)
  }

  const failCount = printLog.filter(e => e.status === 'error').length

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end z-50" onClick={onClose}>
      <div className="bg-white rounded-t-3xl w-full max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 shrink-0">
          <p className="font-bold text-gray-900 flex items-center gap-2">
            <ScrollText size={16} /> ประวัติการพิมพ์
            {failCount > 0 && (
              <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded-full font-semibold">
                {failCount} ล้มเหลว
              </span>
            )}
          </p>
          <div className="flex items-center gap-2">
            {printLog.length > 0 && (
              <button
                onClick={onClear}
                className="text-xs text-gray-400 hover:text-red-500 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
              >
                ล้าง log
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
              <X size={18} className="text-gray-400" />
            </button>
          </div>
        </div>

        {/* Log list */}
        <div className="flex-1 overflow-y-auto">
          {printLog.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <ScrollText size={36} className="mb-3 opacity-20" />
              <p className="text-sm">ยังไม่มีประวัติการพิมพ์</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {printLog.map(entry => (
                <div
                  key={entry.id}
                  className={`flex items-center gap-3 px-5 py-3.5 transition-colors ${
                    entry.status === 'error' ? 'bg-red-50' : 'bg-white'
                  }`}
                >
                  {/* Status icon */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    entry.status === 'success' ? 'bg-green-100' : 'bg-red-100'
                  }`}>
                    {entry.status === 'success'
                      ? <span className="text-green-600 font-bold text-base">✓</span>
                      : <span className="text-red-500 font-bold text-base">✕</span>
                    }
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{entry.menuName}</p>
                    <p className="text-xs text-gray-400 truncate">{entry.summary}</p>
                  </div>

                  {/* Time + retry */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-gray-400">
                      {entry.timestamp.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {entry.status === 'error' && (
                      <button
                        onClick={() => handleRetry(entry)}
                        disabled={retrying === entry.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 text-red-600 text-xs font-semibold bg-white hover:bg-red-50 active:bg-red-100 disabled:opacity-50 transition-colors"
                      >
                        {retrying === entry.id
                          ? <Loader2 size={11} className="animate-spin" />
                          : <Printer size={11} />
                        }
                        พิมพ์ซ้ำ
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const todayStr = () => format(new Date(), 'yyyy-MM-dd')

const TABS = [
  { key: 'pos',    label: 'POS',        icon: ShoppingCart  },
  { key: 'orders', label: 'ออเดอร์',   icon: ClipboardList },
]

const PASSKEY   = '18879'
const HOUSE_URL = 'https://cocoa-house.vercel.app'
const LIFF_URL  = 'https://cocoa-liff.vercel.app'

function PasskeyModal({ title, onConfirm, onClose }) {
  const [val, setVal]     = useState('')
  const [error, setError] = useState(false)
  const inputRef          = useRef(null)

  const handleSubmit = () => {
    if (val === PASSKEY) {
      onConfirm()
    } else {
      setError(true)
      setVal('')
      inputRef.current?.focus()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-xs shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-bold text-gray-900">{title}</p>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        <div>
          <label className="text-sm text-gray-600 mb-1.5 block">กรอก Passkey</label>
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            value={val}
            onChange={e => { setVal(e.target.value); setError(false) }}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            autoFocus
            className={`w-full px-4 py-3 border-2 rounded-xl text-base text-center tracking-widest font-mono outline-none transition-colors
              ${error ? 'border-red-400 bg-red-50' : 'border-gray-200 focus:border-cocoa-400'}`}
            placeholder="● ● ● ● ●"
          />
          {error && <p className="text-xs text-red-500 mt-1.5 text-center">Passkey ไม่ถูกต้อง</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600">
            ยกเลิก
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 py-2.5 rounded-xl bg-cocoa-700 text-white text-sm font-bold"
          >
            เข้าใช้งาน
          </button>
        </div>
      </div>
    </div>
  )
}

function AppInner() {
  const { session, loading } = useAuth()
  const [showPasskey,    setShowPasskey]    = useState(false)
  const [showLiff,       setShowLiff]       = useState(false)
  const [showPrintModal, setShowPrintModal] = useState(false)
  const [showLogModal,   setShowLogModal]   = useState(false)
  const [printLog,       setPrintLog]       = useState([])

  const addPrintLog    = (entry)       => setPrintLog(prev => [entry, ...prev])
  const updatePrintLog = (id, status)  => setPrintLog(prev => prev.map(e => e.id === id ? { ...e, status } : e))
  const clearPrintLog  = ()            => setPrintLog([])

  const failCount = printLog.filter(e => e.status === 'error').length

  // Read URL params for deep-link from cocoa-house history page
  const params      = new URLSearchParams(window.location.search)
  const initTab     = params.get('tab') ?? 'pos'
  const initDate    = params.get('date') ?? null
  const initHighlight = params.get('highlight') ?? null

  const [activeTab, setActiveTab] = useState(initTab)
  const [posDate,   setPosDate]   = useState(initDate ?? todayStr())

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cocoa-50">
        <div className="w-12 h-12 border-4 border-cocoa-700 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) return <LoginPage />

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top nav bar */}
      <div className="bg-cocoa-800 flex items-center px-4 py-2 shrink-0 gap-2">
        {TABS.map(tab => {
          const Icon   = tab.icon
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all
                ${active
                  ? 'bg-white text-cocoa-800 shadow-md'
                  : 'text-cocoa-300 hover:text-white hover:bg-cocoa-700'
                }`}
            >
              <Icon size={17} strokeWidth={active ? 2.5 : 2} />
              {tab.label}
            </button>
          )
        })}

        {/* Print label utility */}
        <button
          onClick={() => setShowPrintModal(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-cocoa-300 hover:text-white hover:bg-cocoa-700 transition-all text-sm font-semibold"
          title="พิมพ์ฉลาก"
        >
          <Printer size={16} />
          <span>พิมพ์ฉลาก</span>
        </button>

        {/* Print Log */}
        <button
          onClick={() => setShowLogModal(true)}
          className="relative flex items-center gap-2 px-3 py-2 rounded-xl text-cocoa-300 hover:text-white hover:bg-cocoa-700 transition-all text-sm font-semibold"
          title="ประวัติการพิมพ์"
        >
          <ScrollText size={16} />
          <span>Print Log</span>
          {failCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] text-white flex items-center justify-center font-bold leading-none">
              {failCount}
            </span>
          )}
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Go to BSK coffee&bakery */}
        <button
          onClick={() => setShowPasskey(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-cocoa-600 text-white hover:bg-cocoa-500 transition-all text-sm font-semibold border border-cocoa-400"
          title="ไปที่ BSK coffee&bakery"
        >
          <LayoutDashboard size={16} />
          <span>BSK coffee&bakery</span>
        </button>
        {/* Go to BSK LIFF */}
        <button
          onClick={() => setShowLiff(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-700 text-white hover:bg-green-600 transition-all text-sm font-semibold border border-green-500/40"
          title="ไปที่ BSK"
        >
          <Package size={16} />
          <span>BSK</span>
        </button>
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'pos'    && <POSPage onDateChange={setPosDate} />}
        {activeTab === 'orders' && <OrderManagePage initialDate={posDate} highlightRef={initHighlight} onAddLog={addPrintLog} />}
      </div>

      {/* Passkey Modal */}
      {showPasskey && (
        <PasskeyModal
          title="ไปที่ BSK coffee&bakery"
          onConfirm={() => { setShowPasskey(false); window.open(HOUSE_URL, '_blank') }}
          onClose={() => setShowPasskey(false)}
        />
      )}
      {showLiff && (
        <PasskeyModal
          title="ไปที่ BSK"
          onConfirm={() => { setShowLiff(false); window.open(LIFF_URL, '_blank') }}
          onClose={() => setShowLiff(false)}
        />
      )}
      {showPrintModal && (
        <PrintLabelModal
          onClose={() => setShowPrintModal(false)}
          onAddLog={addPrintLog}
        />
      )}
      {showLogModal && (
        <PrintLogModal
          printLog={printLog}
          onUpdateLog={updatePrintLog}
          onClear={clearPrintLog}
          onClose={() => setShowLogModal(false)}
        />
      )}
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </AuthProvider>
  )
}
