import { useState, useRef, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, ShoppingCart, ClipboardList, UtensilsCrossed, Calculator, BarChart3, Settings, Users, GripVertical, LogOut, FileUp, Wallet } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

const ALL_NAV = [
  { to: '/',         iconName: 'LayoutDashboard', label: 'Dashboard',           end: true,  adminOnly: false },
  { to: '/sales',    iconName: 'ShoppingCart',    label: 'กรอกยอดขาย',         adminOnly: false },
  { to: '/history',  iconName: 'ClipboardList',   label: 'ประวัติยอดขาย',      adminOnly: false },
  { to: '/menu',     iconName: 'UtensilsCrossed', label: 'จัดการเมนู',         adminOnly: false },
  { to: '/cost',     iconName: 'Calculator',      label: 'ต้นทุนเมนู',         adminOnly: false },
  { to: '/reports',  iconName: 'BarChart3',       label: 'รายงาน & Export',     adminOnly: false },
  { to: '/settings', iconName: 'Settings',        label: 'ตั้งค่า',             adminOnly: true  },
  { to: '/users',    iconName: 'Users',           label: 'การจัดการผู้ใช้งาน', adminOnly: true  },
  { to: '/import',    iconName: 'FileUp',          label: 'นำเข้าข้อมูล',        adminOnly: true  },
  { to: '/cashflow',  iconName: 'Wallet',          label: 'รายรับรายจ่าย',       adminOnly: false },
]

const ICON_MAP = { LayoutDashboard, ShoppingCart, ClipboardList, UtensilsCrossed, Calculator, BarChart3, Settings, Users, FileUp, Wallet }
const STORAGE_KEY = 'cocoa-nav-order'

function applyOrder(order) {
  if (!order || !Array.isArray(order)) return ALL_NAV
  const defaultTos = new Set(ALL_NAV.map(n => n.to))
  if (!order.every(to => defaultTos.has(to))) return ALL_NAV
  const ordered = order.map(to => ALL_NAV.find(n => n.to === to)).filter(Boolean)
  // append any new items not yet in saved order
  const orderedSet = new Set(ordered.map(n => n.to))
  const rest = ALL_NAV.filter(n => !orderedSet.has(n.to))
  return [...ordered, ...rest]
}

function loadLocalOrder() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : null
  } catch { return null }
}

export default function Sidebar() {
  const { signOut, role } = useAuth()
  const [items, setItems] = useState(() => applyOrder(loadLocalOrder()))
  const dragIdx   = useRef(null)
  const overIdx   = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [dragOver, setDragOver] = useState(null)
  const [showSignOutModal, setShowSignOutModal] = useState(false)

  // Fetch nav order from Supabase on mount — syncs across all devices
  useEffect(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('key', 'nav_order')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value) {
          try {
            const order = JSON.parse(data.value)
            setItems(applyOrder(order))
            // cache locally for next fast render
            localStorage.setItem(STORAGE_KEY, data.value)
          } catch {}
        }
      })
  }, [])

  // Only show admin-only items when role is confirmed admin
  const visibleItems = items.filter(item => !item.adminOnly || role === 'admin')

  const handleDragStart = (e, idx) => {
    dragIdx.current = idx
    setDragging(true)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e, idx) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (overIdx.current !== idx) {
      overIdx.current = idx
      setDragOver(idx)
    }
  }

  const handleDrop = async (e, idx) => {
    e.preventDefault()
    const from = dragIdx.current
    const to   = idx
    if (from === null || from === to) return
    const reordered = [...items]
    const [moved]   = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    setItems(reordered)

    const orderJson = JSON.stringify(reordered.map(n => n.to))
    // 1. Save locally (instant)
    try { localStorage.setItem(STORAGE_KEY, orderJson) } catch {}
    // 2. Save to Supabase (syncs to all devices)
    await supabase
      .from('settings')
      .upsert({ key: 'nav_order', value: orderJson }, { onConflict: 'key' })

    dragIdx.current = null
    overIdx.current = null
    setDragging(false)
    setDragOver(null)
  }

  const handleDragEnd = () => {
    setDragging(false)
    setDragOver(null)
    dragIdx.current = null
    overIdx.current = null
  }

  return (
    <aside className="hidden md:flex flex-col w-56 bg-cocoa-800 text-white shrink-0">
      {/* Logo */}
      <div className="p-5 border-b border-cocoa-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-cocoa-500 rounded-lg flex items-center justify-center text-xl">☕</div>
          <div>
            <p className="font-bold text-sm leading-tight">Cocoa House</p>
            <p className="text-cocoa-300 text-xs">
              {role === 'admin' ? 'ผู้ดูแลระบบ' : role === 'staff' ? 'พนักงาน' : 'ระบบจัดการยอดขาย'}
            </p>
          </div>
        </div>
      </div>

      {/* Nav — draggable */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {visibleItems.map(({ to, iconName, label, end }, idx) => {
          const Icon       = ICON_MAP[iconName]
          const isOver     = dragOver === idx
          const isDragging = dragging && dragIdx.current === idx

          return (
            <div
              key={to}
              draggable
              onDragStart={e => handleDragStart(e, idx)}
              onDragOver={e  => handleDragOver(e, idx)}
              onDrop={e      => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              className={`group relative transition-all ${isDragging ? 'opacity-30' : 'opacity-100'}`}
            >
              {isOver && dragIdx.current !== idx && (
                <div className="absolute -top-px left-2 right-2 h-0.5 bg-cocoa-300 rounded-full z-10" />
              )}

              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-2 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-grab active:cursor-grabbing ${
                    isActive
                      ? 'bg-cocoa-600 text-white'
                      : 'text-cocoa-200 hover:bg-cocoa-700 hover:text-white'
                  } ${isOver && dragIdx.current !== idx ? 'bg-cocoa-700' : ''}`
                }
              >
                <GripVertical size={14} className="shrink-0 text-cocoa-500 group-hover:text-cocoa-300 transition-colors" aria-hidden="true" />
                <Icon size={16} className="shrink-0" />
                <span className="truncate">{label}</span>
              </NavLink>
            </div>
          )
        })}
      </nav>

      <div className="p-3 border-t border-cocoa-700 space-y-2">
        <button
          onClick={() => setShowSignOutModal(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors"
        >
          <LogOut size={15} /> ออกจากระบบ
        </button>
        <p className="text-cocoa-400 text-xs text-center">v1.2.0</p>
      </div>

      {/* Sign-out confirm modal */}
      {showSignOutModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-xs w-full shadow-xl space-y-4">
            <div className="text-center">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <LogOut size={22} className="text-red-600" />
              </div>
              <p className="font-semibold text-gray-900">ออกจากระบบ?</p>
              <p className="text-sm text-gray-500 mt-1">คุณจะต้องเข้าสู่ระบบใหม่อีกครั้ง</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowSignOutModal(false)} className="btn-secondary flex-1">ยกเลิก</button>
              <button onClick={signOut} className="btn-danger flex-1">ออกจากระบบ</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
