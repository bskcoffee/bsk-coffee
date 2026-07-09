import { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, ShoppingCart, ClipboardList, BarChart3,
  Settings, UtensilsCrossed, Calculator, Users, LogOut,
  MoreHorizontal, X, FileUp, Wallet, Tablet, Lock,
} from 'lucide-react'

const PASSKEY = '18879'
const POS_URL = 'https://cocoa-pos.vercel.app'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions, canAccessAdminPage } from '../contexts/PermissionsContext'
import { supabase } from '../lib/supabase'
import ConfirmModal from './ConfirmModal'

const ALL_ITEMS = [
  { to: '/',         icon: LayoutDashboard, label: 'หน้าหลัก',  end: true,  adminOnly: false },
  { to: '/sales',    icon: ShoppingCart,    label: 'กรอกยอด',               adminOnly: false },
  { to: '/history',  icon: ClipboardList,   label: 'ประวัติ',               adminOnly: false },
  { to: '/reports',  icon: BarChart3,       label: 'รายงาน',                adminOnly: false },
  { to: '/settings', icon: Settings,        label: 'ตั้งค่า',               special: true },
  { to: '/menu',     icon: UtensilsCrossed, label: 'จัดการเมนู',            adminOnly: false },
  { to: '/cost',     icon: Calculator,      label: 'ต้นทุนเมนู',            adminOnly: false },
  { to: '/users',    icon: Users,           label: 'จัดการผู้ใช้',          special: true },
  { to: '/import',    icon: FileUp,          label: 'นำเข้าข้อมูล',          special: true },
  { to: '/cashflow',  icon: Wallet,          label: 'รายรับรายจ่าย',         adminOnly: false },
]

// Operational pages gated by staff_page_access for the 'staff' role only.
const STAFF_GATED = new Set(['/', '/sales', '/history', '/reports', '/menu', '/cost', '/cashflow'])

const MAIN_TOS   = new Set(['/', '/sales', '/history', '/reports'])
const ITEM_MAP   = Object.fromEntries(ALL_ITEMS.map(i => [i.to, i]))
const BOTTOM_TOS = new Set(ALL_ITEMS.map(i => i.to))

function applyOrder(order) {
  if (!order || !Array.isArray(order)) return ALL_ITEMS
  const ordered = order.filter(to => BOTTOM_TOS.has(to)).map(to => ITEM_MAP[to]).filter(Boolean)
  const orderedSet = new Set(ordered.map(i => i.to))
  const rest = ALL_ITEMS.filter(i => !orderedSet.has(i.to))
  return [...ordered, ...rest]
}

export default function BottomNav() {
  const { role, signOut } = useAuth()
  const { staffPageAccess, adminPageAccess } = usePermissions()
  const navigate = useNavigate()
  const [items, setItems]           = useState(ALL_ITEMS)
  const [sheetOpen, setSheetOpen]       = useState(false)
  const [signOutModal, setSignOutModal] = useState(false)
  const [showPasskey, setShowPasskey]   = useState(false)
  const [passkeyVal, setPasskeyVal]     = useState('')
  const [passkeyError, setPasskeyError] = useState(false)

  useEffect(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('key', 'nav_order')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value) {
          try { setItems(applyOrder(JSON.parse(data.value))) } catch {}
        }
      })
  }, [])

  // Escape-to-close for the hand-rolled sheet + passkey modal
  useEffect(() => {
    if (!sheetOpen && !showPasskey) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (showPasskey) { setShowPasskey(false); setPasskeyVal(''); setPasskeyError(false) }
      else if (sheetOpen) setSheetOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheetOpen, showPasskey])

  // Items without access are still shown (not filtered out) — just greyed
  // out and non-navigable — so users can see what exists without entering it.
  const canSee = (item) => {
    if (item.special) return canAccessAdminPage(role, adminPageAccess, item.to)
    if (STAFF_GATED.has(item.to)) return role !== 'staff' || staffPageAccess.includes(item.to)
    return true
  }

  const mainItems = items
    .filter(i => MAIN_TOS.has(i.to))
    .slice(0, 4)

  const sheetItems = items.filter(i => !MAIN_TOS.has(i.to))

  const handleSheetNav = (to, allowed) => {
    if (!allowed) return
    setSheetOpen(false)
    navigate(to)
  }

  return (
    <>
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 safe-bottom z-50">
        <div className="flex">
          {mainItems.map((item) => {
            const { to, icon: Icon, label, end } = item
            const allowed = canSee(item)

            if (!allowed) {
              return (
                <div
                  key={to}
                  aria-disabled="true"
                  title="ไม่มีสิทธิ์เข้าถึงเมนูนี้"
                  className="flex-1 flex flex-col items-center justify-center py-2 text-xs gap-0.5 text-gray-300 cursor-not-allowed select-none"
                >
                  <Icon size={22} strokeWidth={1.5} className="opacity-50" />
                  <span className="flex items-center gap-0.5">{label} <Lock size={9} /></span>
                  <span className="w-1 h-1 rounded-full bg-transparent" />
                </div>
              )
            }

            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex-1 flex flex-col items-center justify-center py-2 text-xs gap-0.5 transition-colors ${
                    isActive ? 'text-cocoa-700' : 'text-gray-500'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={22} strokeWidth={isActive ? 2.5 : 1.5} />
                    <span className={isActive ? 'font-semibold' : ''}>{label}</span>
                    <span className={`w-1 h-1 rounded-full transition-all ${isActive ? 'bg-cocoa-700' : 'bg-transparent'}`} />
                  </>
                )}
              </NavLink>
            )
          })}

          <button
            onClick={() => setSheetOpen(true)}
            className={`flex-1 flex flex-col items-center justify-center py-2 text-xs gap-0.5 transition-colors ${
              sheetOpen ? 'text-cocoa-700' : 'text-gray-500'
            }`}
          >
            <MoreHorizontal size={22} strokeWidth={sheetOpen ? 2.5 : 1.5} />
            <span className={sheetOpen ? 'font-semibold' : ''}>เพิ่มเติม</span>
            <span className={`w-1 h-1 rounded-full transition-all ${sheetOpen ? 'bg-cocoa-700' : 'bg-transparent'}`} />
          </button>
        </div>
      </nav>

      {sheetOpen && (
        <div
          className="md:hidden fixed inset-0 z-[60] flex flex-col justify-end"
          onClick={() => setSheetOpen(false)}
        >
          <div className="absolute inset-0 bg-black/40" />

          <div
            className="relative bg-white rounded-t-2xl px-4 pt-5 pb-8 safe-bottom"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />

            <div className="flex items-center justify-between mb-4">
              <p className="font-semibold text-gray-800 text-sm">เมนูทั้งหมด</p>
              <button onClick={() => setSheetOpen(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2 mb-4">
              {sheetItems.map((item) => {
                const { to, icon: Icon, label } = item
                const allowed = canSee(item)
                return (
                  <button
                    key={to}
                    onClick={() => handleSheetNav(to, allowed)}
                    aria-disabled={!allowed}
                    title={!allowed ? 'ไม่มีสิทธิ์เข้าถึงเมนูนี้' : undefined}
                    className={`flex flex-col items-center gap-1.5 py-3 px-1 rounded-xl transition-colors ${
                      allowed
                        ? 'hover:bg-gray-100 active:bg-gray-200'
                        : 'cursor-not-allowed'
                    }`}
                  >
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center relative ${
                      allowed ? 'bg-cocoa-50' : 'bg-gray-100'
                    }`}>
                      <Icon size={22} className={allowed ? 'text-cocoa-700' : 'text-gray-300'} />
                      {!allowed && (
                        <Lock size={11} className="absolute -top-1 -right-1 text-gray-400 bg-white rounded-full p-0.5" />
                      )}
                    </div>
                    <span className={`text-xs text-center leading-tight ${allowed ? 'text-gray-600' : 'text-gray-300'}`}>{label}</span>
                  </button>
                )
              })}
            </div>

            <div className="border-t border-gray-100 pt-3 space-y-1">
              {/* Go to BSK POS */}
              <button
                onClick={() => { setSheetOpen(false); setShowPasskey(true) }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-cocoa-700 hover:bg-cocoa-50 active:bg-cocoa-100 transition-colors"
              >
                <Tablet size={20} />
                <span className="font-medium text-sm">BSK POS</span>
              </button>
              <button
                onClick={() => { setSheetOpen(false); setSignOutModal(true) }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-600 hover:bg-red-50 active:bg-red-100 transition-colors"
              >
                <LogOut size={20} />
                <span className="font-medium text-sm">ออกจากระบบ</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showPasskey && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-xs shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-bold text-gray-900">ไปที่ BSK POS</p>
              <button onClick={() => { setShowPasskey(false); setPasskeyVal(''); setPasskeyError(false) }} className="p-1 text-gray-400">
                <X size={18} />
              </button>
            </div>
            <div>
              <label htmlFor="bottomnav-passkey" className="text-sm text-gray-600 mb-1.5 block">กรอก Passkey</label>
              <input
                id="bottomnav-passkey"
                type="password"
                inputMode="numeric"
                value={passkeyVal}
                onChange={e => { setPasskeyVal(e.target.value); setPasskeyError(false) }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    if (passkeyVal === PASSKEY) { setShowPasskey(false); setPasskeyVal(''); window.open(POS_URL, '_blank') }
                    else { setPasskeyError(true); setPasskeyVal('') }
                  }
                }}
                autoFocus
                className={`w-full px-4 py-3 border-2 rounded-xl text-base text-center tracking-widest font-mono outline-none transition-colors
                  ${passkeyError ? 'border-red-400 bg-red-50' : 'border-gray-200 focus:border-cocoa-400'}`}
                placeholder="● ● ● ● ●"
              />
              {passkeyError && <p className="text-xs text-red-500 mt-1.5 text-center">Passkey ไม่ถูกต้อง</p>}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowPasskey(false); setPasskeyVal(''); setPasskeyError(false) }}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600"
              >ยกเลิก</button>
              <button
                onClick={() => {
                  if (passkeyVal === PASSKEY) { setShowPasskey(false); setPasskeyVal(''); window.open(POS_URL, '_blank') }
                  else { setPasskeyError(true); setPasskeyVal('') }
                }}
                className="flex-1 py-2.5 rounded-xl bg-cocoa-700 text-white text-sm font-bold"
              >เข้าใช้งาน</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={signOutModal}
        title="ออกจากระบบ?"
        message="คุณจะต้องเข้าสู่ระบบใหม่อีกครั้ง"
        confirmLabel="ออกจากระบบ"
        danger
        icon={LogOut}
        onConfirm={signOut}
        onCancel={() => setSignOutModal(false)}
      />
    </>
  )
}
