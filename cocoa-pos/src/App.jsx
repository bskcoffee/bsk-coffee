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
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'pos'    && <POSPage />}
        {activeTab === 'orders' && <OrderManagePage />}
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
