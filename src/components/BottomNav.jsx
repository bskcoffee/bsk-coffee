import { NavLink } from 'react-router-dom'
import { LayoutDashboard, ShoppingCart, ClipboardList, BarChart3, Settings } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const ALL_ITEMS = [
  { to: '/',        icon: LayoutDashboard, label: 'หน้าหลัก', end: true,  adminOnly: false },
  { to: '/sales',   icon: ShoppingCart,   label: 'กรอกยอด',             adminOnly: false },
  { to: '/history', icon: ClipboardList,  label: 'ประวัติ',              adminOnly: false },
  { to: '/reports', icon: BarChart3,      label: 'รายงาน',               adminOnly: false },
  { to: '/settings',icon: Settings,       label: 'ตั้งค่า',              adminOnly: true  },
]

export default function BottomNav() {
  const { role } = useAuth()
  const navItems = ALL_ITEMS.filter(item => !item.adminOnly || role === 'admin')

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 safe-bottom z-50">
      <div className="flex">
        {navItems.map(({ to, icon: Icon, label, end }) => (
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
      </div>
    </nav>
  )
}
