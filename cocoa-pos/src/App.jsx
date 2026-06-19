import { useState, useRef } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import LoginPage      from './pages/LoginPage'
import POSPage        from './pages/POSPage'
import OrderManagePage from './pages/OrderManagePage'
import { ShoppingCart, ClipboardList, LayoutDashboard, X } from 'lucide-react'

const TABS = [
  { key: 'pos',    label: 'POS',        icon: ShoppingCart  },
  { key: 'orders', label: 'ออเดอร์',   icon: ClipboardList },
]

const PASSKEY = '18879'
const HOUSE_URL = 'https://cocoa-house.vercel.app'

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
  const [activeTab, setActiveTab]     = useState('pos')
  const [showPasskey, setShowPasskey] = useState(false)

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

        {/* Spacer */}
        <div className="flex-1" />

        {/* Go to Cocoa House */}
        <button
          onClick={() => setShowPasskey(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-cocoa-300 hover:text-white hover:bg-cocoa-700 transition-all text-sm font-medium"
          title="ไปที่ Cocoa House"
        >
          <LayoutDashboard size={17} />
          <span className="hidden sm:inline">Cocoa House</span>
        </button>
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'pos'    && <POSPage />}
        {activeTab === 'orders' && <OrderManagePage />}
      </div>

      {/* Passkey Modal */}
      {showPasskey && (
        <PasskeyModal
          title="ไปที่ Cocoa House"
          onConfirm={() => { setShowPasskey(false); window.open(HOUSE_URL, '_blank') }}
          onClose={() => setShowPasskey(false)}
        />
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
