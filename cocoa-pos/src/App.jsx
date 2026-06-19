import { useState } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import LoginPage      from './pages/LoginPage'
import POSPage        from './pages/POSPage'
import OrderManagePage from './pages/OrderManagePage'
import { ShoppingCart, ClipboardList } from 'lucide-react'

const TABS = [
  { key: 'pos',    label: 'POS',        icon: ShoppingCart  },
  { key: 'orders', label: 'ออเดอร์',   icon: ClipboardList },
]

function AppInner() {
  const { session, loading } = useAuth()
  const [activeTab, setActiveTab] = useState('pos')

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
      {/* Page content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'pos'    && <POSPage />}
        {activeTab === 'orders' && <OrderManagePage />}
      </div>

      {/* Bottom tab bar */}
      <div className="bg-white border-t border-gray-200 flex shrink-0 safe-area-inset-bottom">
        {TABS.map(tab => {
          const Icon    = tab.icon
          const active  = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors
                ${active
                  ? 'text-cocoa-700'
                  : 'text-gray-400 hover:text-gray-600'
                }`}
            >
              <Icon size={22} strokeWidth={active ? 2.5 : 1.8} />
              <span className={`text-[11px] font-semibold ${active ? 'text-cocoa-700' : 'text-gray-400'}`}>
                {tab.label}
              </span>
            </button>
          )
        })}
      </div>
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
