import { useState, useRef, useEffect } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import LoginPage       from './pages/LoginPage'
import POSPage         from './pages/POSPage'
import OrderManagePage from './pages/OrderManagePage'
import MenuOptionModal from './components/MenuOptionModal'
import { supabase } from './lib/supabase'
import { ShoppingCart, ClipboardList, LayoutDashboard, X, Package, Printer, Search, Loader2, ChevronRight } from 'lucide-react'

const ADDON_CATS  = ['Addon', 'addon', 'ADDON']
const REFILL_CATS = ['Refill', 'refill', 'REFILL']
const HIDDEN_CATS = [...ADDON_CATS, ...REFILL_CATS]

function PrintLabelModal({ onClose }) {
  const [menus,       setMenus]       = useState([])
  const [loadingM,    setLoadingM]    = useState(true)
  const [search,      setSearch]      = useState('')
  const [selected,    setSelected]    = useState(null)
  const [showOptions, setShowOptions] = useState(false)
  const [printing,    setPrinting]    = useState(false)

  useEffect(() => {
    supabase
      .from('menus')
      .select('id, name, category, image_url, menu_prices(platform, price)')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => { setMenus(data ?? []); setLoadingM(false) })
  }, [])

  const mainMenus   = menus.filter(m => !HIDDEN_CATS.includes(m.category))
  const addonMenus  = menus.filter(m => ADDON_CATS.includes(m.category))
  const refillMenus = menus.filter(m => REFILL_CATS.includes(m.category))
  const filtered    = mainMenus.filter(m => m.name.toLowerCase().includes(search.toLowerCase()))

  const handlePrint = async (options) => {
    setPrinting(true)
    try {
      const labelRes = await supabase.from('settings').select('value').eq('key', 'label_settings').maybeSingle()
      const labelSettings = labelRes.data?.value ? JSON.parse(labelRes.data.value) : {}
      const ip   = labelSettings.printerIp   ?? '192.168.1.100'
      const port = labelSettings.printerPort ?? 3001
      await fetch(`http://${ip}:${port}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: 'TEST',
          platform: 'GRAB',
          items: [{ name: selected.name, qty: 1, item_options: options, isCampaign: false }],
          labelSettings,
        }),
        signal: AbortSignal.timeout(5000),
      })
    } catch (err) { console.warn('test print failed:', err.message) }
    setPrinting(false)
    setShowOptions(false)
    setSelected(null)
  }

  if (showOptions && selected) {
    return (
      <MenuOptionModal
        menu={selected}
        platform="GRAB"
        addons={addonMenus}
        refills={refillMenus}
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

  // Read URL params for deep-link from cocoa-house history page
  const params      = new URLSearchParams(window.location.search)
  const initTab     = params.get('tab') ?? 'pos'
  const initDate    = params.get('date') ?? null
  const initHighlight = params.get('highlight') ?? null

  const [activeTab, setActiveTab] = useState(initTab)

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

        {/* Spacer */}
        <div className="flex-1" />

        {/* Go to Cocoa House */}
        <button
          onClick={() => setShowPasskey(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-cocoa-600 text-white hover:bg-cocoa-500 transition-all text-sm font-semibold border border-cocoa-400"
          title="ไปที่ Cocoa House"
        >
          <LayoutDashboard size={16} />
          <span>Cocoa House</span>
        </button>
        {/* Go to Cocoa LIFF */}
        <button
          onClick={() => setShowLiff(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-700 text-white hover:bg-green-600 transition-all text-sm font-semibold border border-green-500/40"
          title="ไปที่ Cocoa LIFF"
        >
          <Package size={16} />
          <span>Cocoa LIFF</span>
        </button>
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'pos'    && <POSPage />}
        {activeTab === 'orders' && <OrderManagePage initialDate={initDate} highlightRef={initHighlight} />}
      </div>

      {/* Passkey Modal */}
      {showPasskey && (
        <PasskeyModal
          title="ไปที่ Cocoa House"
          onConfirm={() => { setShowPasskey(false); window.open(HOUSE_URL, '_blank') }}
          onClose={() => setShowPasskey(false)}
        />
      )}
      {showLiff && (
        <PasskeyModal
          title="ไปที่ Cocoa LIFF"
          onConfirm={() => { setShowLiff(false); window.open(LIFF_URL, '_blank') }}
          onClose={() => setShowLiff(false)}
        />
      )}
      {showPrintModal && (
        <PrintLabelModal onClose={() => setShowPrintModal(false)} />
      )}
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
