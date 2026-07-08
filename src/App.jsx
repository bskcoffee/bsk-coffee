import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import { useState } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import SalesEntryPage from './pages/SalesEntryPage'
import MenuManagementPage from './pages/MenuManagementPage'
import MenuCostPage from './pages/MenuCostPage'
import ReportsPage from './pages/ReportsPage'
import SalesHistoryPage from './pages/SalesHistoryPage'
import SettingsPage from './pages/SettingsPage'
import UserManagementPage from './pages/UserManagementPage'
import ImportPage from './pages/ImportPage'
import CashFlowPage from './pages/CashFlowPage'
import LabelSettingsPage from './pages/LabelSettingsPage'
import SystemPage from './pages/SystemPage'
import AIPage from './pages/AIPage'

// ── Route Guards ─────────────────────────────────────────────────────────────

function PrivateRoute({ children }) {
  const { session, loading } = useAuth()
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cocoa-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-cocoa-700 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-cocoa-700 font-medium">กำลังโหลด...</p>
        </div>
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  return children
}

function PublicRoute({ children }) {
  const { session, loading } = useAuth()
  if (loading) return null
  if (session) return <Navigate to="/" replace />
  return children
}

function AdminRoute({ children }) {
  const { role, loading } = useAuth()
  if (loading || role === null) return (
    <div className="flex items-center justify-center py-16 text-gray-400">
      <div className="w-6 h-6 border-2 border-cocoa-300 border-t-cocoa-600 rounded-full animate-spin" />
    </div>
  )
  if (role !== 'admin') return <Navigate to="/" replace />
  return children
}

// ── Super Admin Route — เฉพาะ chaiyapord.k@gmail.com + Passkey ทุกครั้ง ──────

const SUPER_ADMIN_EMAIL  = 'chaiyapord.k@gmail.com'
const SUPER_ADMIN_PASSKEY = '18879'

function SuperAdminRoute({ children }) {
  const { session, role, loading } = useAuth()
  const [unlocked, setUnlocked]   = useState(false)
  const [val, setVal]             = useState('')
  const [error, setError]         = useState(false)

  if (loading || role === null) return (
    <div className="flex items-center justify-center py-16 text-gray-400">
      <div className="w-6 h-6 border-2 border-cocoa-300 border-t-cocoa-600 rounded-full animate-spin" />
    </div>
  )

  // 1. ต้องเป็น email ที่กำหนดเท่านั้น
  if (session?.user?.email !== SUPER_ADMIN_EMAIL) return <Navigate to="/" replace />

  // 2. ต้องป้อน Passkey ทุกครั้ง (unlocked reset ทุกครั้งที่ mount)
  if (!unlocked) {
    const handleSubmit = () => {
      if (val === SUPER_ADMIN_PASSKEY) { setUnlocked(true) }
      else { setError(true); setVal('') }
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-cocoa-50 p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-xs space-y-5">
          <div className="text-center">
            <div className="w-12 h-12 bg-cocoa-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg width="22" height="22" fill="none" stroke="#1e40af" strokeWidth="2" viewBox="0 0 24 24">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <h2 className="font-bold text-gray-900 text-lg">Super Admin</h2>
            <p className="text-xs text-gray-500 mt-1">ป้อน Passkey เพื่อเข้าถึงหน้านี้</p>
          </div>
          <div>
            <input
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
            <button onClick={() => window.history.back()}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600">
              ยกเลิก
            </button>
            <button onClick={handleSubmit}
              className="flex-1 py-2.5 rounded-xl bg-cocoa-700 text-white text-sm font-bold">
              เข้าใช้งาน
            </button>
          </div>
        </div>
      </div>
    )
  }

  return children
}

// ── Router ───────────────────────────────────────────────────────────────────
// createBrowserRouter enables data router features: useBlocker, etc.

const router = createBrowserRouter([
  {
    path: '/login',
    element: <PublicRoute><LoginPage /></PublicRoute>,
  },
  {
    path: '/',
    element: (
      <PrivateRoute>
        <Layout />
      </PrivateRoute>
    ),
    children: [
      { index: true,      element: <DashboardPage /> },
      { path: 'sales',    element: <SalesEntryPage /> },
      { path: 'menu',     element: <MenuManagementPage /> },
      { path: 'cost',     element: <MenuCostPage /> },
      { path: 'history',  element: <SalesHistoryPage /> },
      { path: 'reports',  element: <ReportsPage /> },
      { path: 'settings', element: <AdminRoute><SettingsPage /></AdminRoute> },
      { path: 'users',    element: <AdminRoute><UserManagementPage /></AdminRoute> },
      { path: 'import',    element: <AdminRoute><ImportPage /></AdminRoute> },
      { path: 'cashflow',  element: <CashFlowPage /> },
      { path: 'label-settings', element: <AdminRoute><LabelSettingsPage /></AdminRoute> },
      { path: 'system',  element: <SuperAdminRoute><SystemPage /></SuperAdminRoute> },
      { path: 'ai',      element: <AdminRoute><AIPage /></AdminRoute> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

// ── App Root ─────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
