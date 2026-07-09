import { useState, useRef, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, ShoppingCart, ClipboardList, UtensilsCrossed, Calculator, BarChart3, Settings, Users, GripVertical, LogOut, FileUp, Wallet, Tablet, X, Printer, Package, Network, Brain, ChevronUp, ChevronDown, Lock } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { usePermissions, canAccessAdminPage } from '../contexts/PermissionsContext'
import { supabase } from '../lib/supabase'
import ConfirmModal from './ConfirmModal'

const PASSKEY   = '18879'
const POS_URL  = 'https://cocoa-pos.vercel.app'
const LIFF_URL = 'https://cocoa-liff.vercel.app'

function PasskeyModal({ title = 'ไปที่ BSK POS', onConfirm, onClose }) {
  const [val, setVal]     = useState('')
  const [error, setError] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSubmit = () => {
    if (val === PASSKEY) { onConfirm() }
    else { setError(true); setVal('') }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80] p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-xs shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-bold text-gray-900">{title}</p>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div>
          <label htmlFor="sidebar-passkey" className="text-sm text-gray-600 mb-1.5 block">กรอก Passkey</label>
          <input
            id="sidebar-passkey"
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
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600">ยกเลิก</button>
          <button onClick={handleSubmit} className="flex-1 py-2.5 rounded-xl bg-cocoa-700 text-white text-sm font-bold">เข้าใช้งาน</button>
        </div>
      </div>
    </div>
  )
}

const ALL_NAV = [
  { to: '/',         iconName: 'LayoutDashboard', label: 'Dashboard',           end: true,  adminOnly: false },
  { to: '/sales',    iconName: 'ShoppingCart',    label: 'กรอกยอดขาย',         adminOnly: false },
  { to: '/history',  iconName: 'ClipboardList',   label: 'ประวัติยอดขาย',      adminOnly: false },
  { to: '/menu',     iconName: 'UtensilsCrossed', label: 'จัดการเมนู',         adminOnly: false },
  { to: '/cost',     iconName: 'Calculator',      label: 'ต้นทุนเมนู',         adminOnly: false },
  { to: '/reports',  iconName: 'BarChart3',       label: 'รายงาน & Export',     adminOnly: false },
  { to: '/settings',       iconName: 'Settings',  label: 'ตั้งค่า',             special: true },
  { to: '/label-settings', iconName: 'Printer',   label: 'ตั้งค่าฉลาก',         special: true },
  { to: '/users',    iconName: 'Users',           label: 'การจัดการผู้ใช้งาน', special: true },
  { to: '/import',    iconName: 'FileUp',          label: 'นำเข้าข้อมูล',        special: true },
  { to: '/cashflow',  iconName: 'Wallet',          label: 'รายรับรายจ่าย',       adminOnly: false },
  { to: '/ai',        iconName: 'Brain',           label: 'AI Memory',           special: true },
  { to: '/system',    iconName: 'Network',         label: 'System Architecture', special: true },
]

// Operational pages whose visibility to 'staff' is controlled by the
// staff_page_access setting (edited from UserManagementPage). Admin/Super
// Admin always see these regardless of the setting.
const STAFF_GATED = new Set(['/', '/sales', '/history', '/reports', '/menu', '/cost', '/cashflow'])

const ICON_MAP = { LayoutDashboard, ShoppingCart, ClipboardList, UtensilsCrossed, Calculator, BarChart3, Settings, Users, FileUp, Wallet, Printer, Tablet, Network, Brain }
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
  const { staffPageAccess, adminPageAccess } = usePermissions()
  const [items, setItems] = useState(() => applyOrder(loadLocalOrder()))
  const dragIdx   = useRef(null)
  const overIdx   = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [dragOver, setDragOver] = useState(null)
  const [showSignOutModal, setShowSignOutModal] = useState(false)
  const [showPasskey, setShowPasskey]           = useState(false)
  const [showLiff, setShowLiff]                 = useState(false)

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

  // 3-tier access: special pages follow admin_page_access (super_admin
  // always in, admin only if granted); ops pages follow staff_page_access
  // for staff (admin/super_admin always have access). Items without access
  // are still rendered (per menu-visibility rule below) but disabled.
  const hasAccess = (item) => {
    if (item.special) return canAccessAdminPage(role, adminPageAccess, item.to)
    if (STAFF_GATED.has(item.to)) return role !== 'staff' || staffPageAccess.includes(item.to)
    return true
  }

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

  // Keyboard-accessible alternative to drag-and-drop: move item up/down
  // among all items (in display order), persisting the same way as drop.
  const moveItem = async (to, direction) => {
    const tos       = items.map(i => i.to)
    const pos       = tos.indexOf(to)
    const targetPos = pos + direction
    if (pos === -1 || targetPos < 0 || targetPos >= tos.length) return
    const neighborTo = tos[targetPos]

    const reordered  = [...items]
    const fromIdx     = reordered.findIndex(i => i.to === to)
    const neighborIdx = reordered.findIndex(i => i.to === neighborTo)
    ;[reordered[fromIdx], reordered[neighborIdx]] = [reordered[neighborIdx], reordered[fromIdx]]
    setItems(reordered)

    const orderJson = JSON.stringify(reordered.map(n => n.to))
    try { localStorage.setItem(STORAGE_KEY, orderJson) } catch {}
    await supabase
      .from('settings')
      .upsert({ key: 'nav_order', value: orderJson }, { onConflict: 'key' })
  }

  return (
    <>
    <aside className="hidden md:flex flex-col w-56 bg-cocoa-800 text-white shrink-0">
      {/* Logo */}
      <div className="p-5 border-b border-cocoa-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-cocoa-500 rounded-lg flex items-center justify-center text-xl">☕</div>
          <div>
            <p className="font-bold text-sm leading-tight">BSK coffee&bakery</p>
            <p className="text-cocoa-300 text-xs">
              {role === 'super_admin' ? 'ผู้ดูแลระบบสูงสุด'
                : role === 'admin' ? 'ผู้ดูแลระบบ'
                : role === 'staff' ? 'พนักงาน'
                : 'ระบบจัดการยอดขาย'}
            </p>
          </div>
        </div>
      </div>

      {/* Nav — draggable. Items without access are still shown, greyed out
          and non-clickable, so staff/admin can see what exists without
          being able to enter it. */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {items.map((navItem, idx) => {
          const { to, iconName, label, end } = navItem
          const Icon       = ICON_MAP[iconName]
          const isOver     = dragOver === idx
          const isDragging = dragging && dragIdx.current === idx
          const allowed    = hasAccess(navItem)

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

              {allowed ? (
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
                  <span className="truncate flex-1">{label}</span>
                  {/* Keyboard-accessible reorder alternative to drag-and-drop */}
                  <span className="hidden group-hover:flex group-focus-within:flex shrink-0 flex-col -my-1">
                    <button
                      type="button"
                      draggable={false}
                      onClick={e => { e.preventDefault(); e.stopPropagation(); moveItem(to, -1) }}
                      disabled={idx === 0}
                      aria-label={`ย้าย ${label} ขึ้น`}
                      className="p-0.5 rounded text-cocoa-300 hover:text-white hover:bg-cocoa-600 disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      type="button"
                      draggable={false}
                      onClick={e => { e.preventDefault(); e.stopPropagation(); moveItem(to, 1) }}
                      disabled={idx === items.length - 1}
                      aria-label={`ย้าย ${label} ลง`}
                      className="p-0.5 rounded text-cocoa-300 hover:text-white hover:bg-cocoa-600 disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <ChevronDown size={12} />
                    </button>
                  </span>
                </NavLink>
              ) : (
                <div
                  aria-disabled="true"
                  title="ไม่มีสิทธิ์เข้าถึงเมนูนี้"
                  className={`flex items-center gap-2 px-2 py-2.5 rounded-lg text-sm font-medium text-cocoa-400/40 cursor-not-allowed select-none ${
                    isOver && dragIdx.current !== idx ? 'bg-cocoa-700/40' : ''
                  }`}
                >
                  <GripVertical size={14} className="shrink-0 text-cocoa-500/40" aria-hidden="true" />
                  <Icon size={16} className="shrink-0 opacity-50" />
                  <span className="truncate flex-1">{label}</span>
                  <Lock size={12} className="shrink-0 opacity-60" aria-hidden="true" />
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="p-3 border-t border-cocoa-700 space-y-2">
        {/* Go to BSK POS */}
        <button
          onClick={() => setShowPasskey(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-cocoa-600 hover:bg-cocoa-500 text-white text-sm font-medium transition-colors"
        >
          <Tablet size={15} /> BSK POS
        </button>
        {/* Go to BSK LIFF */}
        <button
          onClick={() => setShowLiff(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm font-medium transition-colors"
        >
          <Package size={15} /> BSK
        </button>
        <button
          onClick={() => setShowSignOutModal(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors"
        >
          <LogOut size={15} /> ออกจากระบบ
        </button>
        <p className="text-cocoa-400 text-xs text-center">v1.2.0</p>
      </div>

    </aside>

    {/* Passkey modal — outside aside to avoid event capture */}
    {showPasskey && (
      <PasskeyModal
        title="ไปที่ BSK POS"
        onConfirm={() => { setShowPasskey(false); window.open(POS_URL, '_blank') }}
        onClose={() => setShowPasskey(false)}
      />
    )}
    {showLiff && (
      <PasskeyModal
        title="ไปที่ BSK"
        onConfirm={() => { setShowLiff(false); window.open(LIFF_URL, '_blank') }}
        onClose={() => setShowLiff(false)}
      />
    )}

    {/* Sign-out confirm modal */}
    <ConfirmModal
      open={showSignOutModal}
      title="ออกจากระบบ?"
      message="คุณจะต้องเข้าสู่ระบบใหม่อีกครั้ง"
      confirmLabel="ออกจากระบบ"
      danger
      icon={LogOut}
      onConfirm={signOut}
      onCancel={() => setShowSignOutModal(false)}
    />
    </>
  )
}
