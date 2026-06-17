import { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, ShoppingCart, ClipboardList, BarChart3,
  Settings, UtensilsCrossed, Calculator, Users, LogOut,
  MoreHorizontal, X,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

const ALL_ITEMS = [
  { to: '/',         icon: LayoutDashboard, label: 'หน้าหลัก',  end: true,  adminOnly: false },
  { to: '/sales',    icon: ShoppingCart,    label: 'กรอกยอด',               adminOnly: false },
  { to: '/history',  icon: ClipboardList,   label: 'ประวัติ',               adminOnly: false },
  { to: '/reports',  icon: BarChart3,       label: 'รายงาน',                adminOnly: false },
  { to: '/settings', icon: Settings,        label: 'ตั้งค่า',               adminOnly: true  },
  { to: '/menu',     icon: UtensilsCrossed, label: 'จัดการเมนู',            adminOnly: false },
  { to: '/cost',     icon: Calculator,      label: 'ต้นทุนเมนู',            adminOnly: false },
  { to: '/users',    icon: Users,           label: 'จัดการผู้ใช้',          adminOnly: true  },
]

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
  const navigate = useNavigate()
  const [items, setItems]           = useState(ALL_ITEMS)
  const [sheetOpen, setSheetOpen]   = useState(false)
  const [signOutModal, setSignOutModal] = useState(false)

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

  const isAdmin = role === 'admin'

  const mainItems = items
    .filter(i => MAIN_TOS.has(i.to) && (!i.adminOnly || isAdmin))
    .slice(0, 4)

  const sheetItems = items.filter(
    i => !MAIN_TOS.has(i.to) && (!i.adminOnly || isAdmin)
  )

  const handleSheetNav = (to) => {
    setSheetOpen(false)
    navigate(to)
  }

  return (
    <>
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 safe-bottom z-50">
        <div className="flex">
          {mainItems.map(({ to, icon: Icon, label, end }) => (
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
          ))}

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
              {sheetItems.map(({ to, icon: Icon, label }) => (
                <button
                  key={to}
                  onClick={() => handleSheetNav(to)}
                  className="flex flex-col items-center gap-1.5 py-3 px-1 rounded-xl hover:bg-gray-100 active:bg-gray-200 transition-colors"
                >
                  <div className="w-12 h-12 bg-cocoa-50 rounded-xl flex items-center justify-center">
                    <Icon size={22} className="text-cocoa-700" />
                  </div>
                  <span className="text-xs text-gray-600 text-center leading-tight">{label}</span>
                </button>
              ))}
            </div>

            <div className="border-t border-gray-100 pt-3">
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

      {signOutModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl p-6 max-w-xs w-full shadow-xl space-y-4">
            <div className="text-center">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <LogOut size={22} className="text-red-600" />
              </div>
              <p className="font-semibold text-gray-900">ออกจากระบบ?</p>
              <p className="text-sm text-gray-500 mt-1">คุณจะต้องเข้าสู่ระบบใหม่อีกครั้ง</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setSignOutModal(false)} className="btn-secondary flex-1">ยกเลิก</button>
              <button onClick={signOut} className="btn-danger flex-1">ออกจากระบบ</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
