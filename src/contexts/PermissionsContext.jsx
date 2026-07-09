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
const SETTING_KEY = 'staff_page_access'

export function PermissionsProvider({ children }) {
  const [staffPageAccess, setStaffPageAccess] = useState(DEFAULT_STAFF_ACCESS)
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('key', SETTING_KEY)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value) {
          try {
            const arr = JSON.parse(data.value)
            if (Array.isArray(arr)) setStaffPageAccess(arr)
          } catch { /* ignore malformed value, keep default */ }
        }
        setLoaded(true)
      })
  }, [])

  useEffect(() => { reload() }, [reload])

  // Persists the new list and updates local state immediately (optimistic).
  const saveStaffPageAccess = async (nextList) => {
    setStaffPageAccess(nextList)
    return supabase
      .from('settings')
      .upsert({ key: SETTING_KEY, value: JSON.stringify(nextList) }, { onConflict: 'key' })
  }

  return (
    <PermissionsContext.Provider value={{ staffPageAccess, loaded, saveStaffPageAccess, reload }}>
      {children}
    </PermissionsContext.Provider>
  )
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext)
  if (!ctx) throw new Error('usePermissions must be used inside PermissionsProvider')
  return ctx
}
