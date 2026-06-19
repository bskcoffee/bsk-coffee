import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
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
  // While role is loading, show nothing to avoid flash
  if (loading || role === null) return (
    <div className="flex items-center justify-center py-16 text-gray-400">
      <div className="w-6 h-6 border-2 border-cocoa-300 border-t-cocoa-600 rounded-full animate-spin" />
    </div>
  )
  if (role !== 'admin') return <Navigate to="/" replace />
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
