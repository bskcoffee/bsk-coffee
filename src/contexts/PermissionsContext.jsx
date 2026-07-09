import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const PermissionsContext = createContext(null)

// The 7 daily-ops pages every role can normally reach — Admin/Super Admin can
// restrict which of these Staff is allowed to see, via UserManagementPage.
export const STAFF_PAGES = [
  { to: '/',         label: 'หน้าหลัก' },
  { to: '/sales',    label: 'กรอกยอดขาย' },
  { to: '/history',  label: 'ประวัติยอดขาย' },
  { to: '/reports',  label: 'รายงาน & Export' },
  { to: '/menu',     label: 'จัดการเมนู' },
  { to: '/cost',     label: 'ต้นทุนเมนู' },
  { to: '/cashflow', label: 'รายรับรายจ่าย' },
]
const DEFAULT_STAFF_ACCESS = STAFF_PAGES.map(p => p.to)
const STAFF_KEY = 'staff_page_access'

// The 6 special-permission pages — Super Admin decides which of these the
// Admin role is also allowed into. Super Admin itself always has all 6.
export const ADMIN_PAGES = [
  { to: '/settings',       label: 'ตั้งค่า' },
  { to: '/label-settings', label: 'ตั้งค่าฉลาก' },
  { to: '/users',          label: 'การจัดการผู้ใช้งาน' },
  { to: '/import',         label: 'นำเข้าข้อมูล' },
  { to: '/ai',             label: 'AI Memory' },
  { to: '/system',         label: 'System Architecture' },
]
// Default matches the app's original fixed behavior: Admin has the first 3,
// Import/AI/System start Super-Admin-only until granted.
const DEFAULT_ADMIN_ACCESS = ['/settings', '/label-settings', '/users']
const ADMIN_KEY = 'admin_page_access'

export function PermissionsProvider({ children }) {
  const [staffPageAccess, setStaffPageAccess] = useState(DEFAULT_STAFF_ACCESS)
  const [adminPageAccess, setAdminPageAccess] = useState(DEFAULT_ADMIN_ACCESS)
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(() => {
    supabase
      .from('settings')
      .select('key, value')
      .in('key', [STAFF_KEY, ADMIN_KEY])
      .then(({ data }) => {
        (data ?? []).forEach(row => {
          try {
            const arr = JSON.parse(row.value)
            if (!Array.isArray(arr)) return
            if (row.key === STAFF_KEY) setStaffPageAccess(arr)
            if (row.key === ADMIN_KEY) setAdminPageAccess(arr)
          } catch { /* ignore malformed value, keep default */ }
        })
        setLoaded(true)
      })
  }, [])

  useEffect(() => { reload() }, [reload])

  // Persists the new list and updates local state immediately (optimistic).
  const saveStaffPageAccess = async (nextList) => {
    setStaffPageAccess(nextList)
    return supabase
      .from('settings')
      .upsert({ key: STAFF_KEY, value: JSON.stringify(nextList) }, { onConflict: 'key' })
  }

  const saveAdminPageAccess = async (nextList) => {
    setAdminPageAccess(nextList)
    return supabase
      .from('settings')
      .upsert({ key: ADMIN_KEY, value: JSON.stringify(nextList) }, { onConflict: 'key' })
  }

  return (
    <PermissionsContext.Provider value={{
      staffPageAccess, adminPageAccess, loaded,
      saveStaffPageAccess, saveAdminPageAccess, reload,
    }}>
      {children}
    </PermissionsContext.Provider>
  )
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext)
  if (!ctx) throw new Error('usePermissions must be used inside PermissionsProvider')
  return ctx
}

// Shared rule for the 6 special pages: super_admin always in; admin only if
// granted via adminPageAccess; staff never.
export function canAccessAdminPage(role, adminPageAccess, path) {
  if (role === 'super_admin') return true
  if (role === 'admin') return adminPageAccess.includes(path)
  return false
}
