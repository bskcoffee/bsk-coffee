import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import { useState } from 'react'
import { ShieldOff, Lock } from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import { PermissionsProvider, usePermissions, canAccessAdminPage } from './contexts/PermissionsContext'
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

// เมื่อ admin/staff หมดอายุการใช้งาน — บล็อกเข้าทั้งระบบ ไม่ว่าจะเข้า route ไหน
// (super_admin ไม่ถูกเช็คเงื่อนไขนี้เลย)
function AccessExpiredScreen({ accessExpiresAt, onSignOut }) {
  const dateStr = accessExpiresAt
    ? new Date(accessExpiresAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
    : null
  return (
    <div className="min-h-screen flex items-center justify-center bg-cocoa-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full text-center space-y-4">
        <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto">
          <Lock size={26} className="text-red-600" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">หมดอายุการใช้งาน</h1>
          {dateStr && <p className="text-sm text-gray-500 mt-1">บัญชีนี้ใช้งานได้ถึงวันที่ {dateStr}</p>}
        </div>
        <p className="text-sm text-gray-600">กรุณาติดต่อผู้ดูแลระบบสูงสุดเพื่อต่ออายุการใช้งาน</p>
        <button onClick={onSignOut} className="btn-secondary w-full">ออกจากระบบ</button>
      </div>
    </div>
  )
}

function PrivateRoute({ children }) {
  const { session, loading, isAccessExpired, accessExpiresAt, signOut } = useAuth()
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
  if (isAccessExpired) return <AccessExpiredScreen accessExpiresAt={accessExpiresAt} onSignOut={signOut} />
  return children
}

function PublicRoute({ children }) {
  const { session, loading } = useAuth()
  if (loading) return null
  if (session) return <Navigate to="/" replace />
  return children
}

// The 6 special pages (Settings, Label Settings, User Management, Import, AI
// Memory, System): Super Admin always in; Admin only if granted via the
// admin_page_access setting (configurable from UserManagementPage — Super
// Admin only can edit it); Staff never.
function AdminPageRoute({ path, children }) {
  const { role, loading } = useAuth()
  const { adminPageAccess, loaded } = usePermissions()
  if (loading || role === null || !loaded) return (
    <div className="flex items-center justify-center py-16 text-gray-400">
      <div className="w-6 h-6 border-2 border-cocoa-300 border-t-cocoa-600 rounded-full animate-spin" />
    </div>
  )
  if (!canAccessAdminPage(role, adminPageAccess, path)) return <Navigate to="/" replace />
  return children
}

// Daily-ops pages (Dashboard, Sales Entry, History, Reports, Menu, Cost, Cash
// Flow): Admin/Super Admin always allowed; Staff is gated by the
// staff_page_access setting (configurable from UserManagementPage).
function StaffPageRoute({ path, children }) {
  const { role, loading } = useAuth()
  const { staffPageAccess, loaded } = usePermissions()
  if (loading || role === null || !loaded) return (
    <div className="flex items-center justify-center py-16 text-gray-400">
      <div className="w-6 h-6 border-2 border-cocoa-300 border-t-cocoa-600 rounded-full animate-spin" />
    </div>
  )
  if (role === 'staff' && !staffPageAccess.includes(path)) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-2">
        <ShieldOff size={32} />
        <p className="text-sm">คุณไม่มีสิทธิ์เข้าถึงหน้านี้</p>
      </div>
    )
  }
  return children
}

// ── System Architecture Route — ต้องมีสิทธิ์ + Passkey ทุกครั้ง ──────

const SUPER_ADMIN_PASSKEY = '18879'

function SystemRoute({ children }) {
  const { role, loading } = useAuth()
  const { adminPageAccess, loaded } = usePermissions()
  const [unlocked, setUnlocked]   = useState(false)
  const [val, setVal]             = useState('')
  const [error, setError]         = useState(false)

  if (loading || role === null || !loaded) return (
    <div className="flex items-center justify-center py-16 text-gray-400">
      <div className="w-6 h-6 border-2 border-cocoa-300 border-t-cocoa-600 rounded-full animate-spin" />
    </div>
  )

  // 1. ต้องมีสิทธิ์เข้าหน้านี้ (super_admin เสมอ, admin ถ้าได้รับสิทธิ์)
  if (!canAccessAdminPage(role, adminPageAccess, '/system')) return <Navigate to="/" replace />

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
      { index: true,      element: <StaffPageRoute path="/"><DashboardPage /></StaffPageRoute> },
      { path: 'sales',    element: <StaffPageRoute path="/sales"><SalesEntryPage /></StaffPageRoute> },
      { path: 'menu',     element: <StaffPageRoute path="/menu"><MenuManagementPage /></StaffPageRoute> },
      { path: 'cost',     element: <StaffPageRoute path="/cost"><MenuCostPage /></StaffPageRoute> },
      { path: 'history',  element: <StaffPageRoute path="/history"><SalesHistoryPage /></StaffPageRoute> },
      { path: 'reports',  element: <StaffPageRoute path="/reports"><ReportsPage /></StaffPageRoute> },
      { path: 'settings', element: <AdminPageRoute path="/settings"><SettingsPage /></AdminPageRoute> },
      { path: 'users',    element: <AdminPageRoute path="/users"><UserManagementPage /></AdminPageRoute> },
      { path: 'import',    element: <AdminPageRoute path="/import"><ImportPage /></AdminPageRoute> },
      { path: 'cashflow',  element: <StaffPageRoute path="/cashflow"><CashFlowPage /></StaffPageRoute> },
      { path: 'label-settings', element: <AdminPageRoute path="/label-settings"><LabelSettingsPage /></AdminPageRoute> },
      { path: 'system',  element: <SystemRoute><SystemPage /></SystemRoute> },
      { path: 'ai',      element: <AdminPageRoute path="/ai"><AIPage /></AdminPageRoute> },
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
          <PermissionsProvider>
            <RouterProvider router={router} />
          </PermissionsProvider>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
