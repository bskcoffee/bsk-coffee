import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { usePermissions, STAFF_PAGES, ADMIN_PAGES } from '../contexts/PermissionsContext'
import { Save, Eye, EyeOff, UserPlus, Users, LogOut, AlertTriangle, ShieldCheck, Shield, Crown, KeyRound } from 'lucide-react'
import ConfirmModal from '../components/ConfirmModal'

const CREATE_COOLDOWN_SEC = 30

const ROLE_LABEL = { super_admin: 'ผู้ดูแลระบบสูงสุด', admin: 'ผู้ดูแลระบบ', staff: 'พนักงาน' }

export default function UserManagementPage() {
  const { signOut, updatePassword, updateEmail, session, role: myRole } = useAuth()
  const { addToast } = useToast()
  const { staffPageAccess, saveStaffPageAccess, adminPageAccess, saveAdminPageAccess } = usePermissions()

  // --- สิทธิ์การเข้าถึงเมนู (พนักงาน) ---
  const [pendingAccess, setPendingAccess] = useState(staffPageAccess)
  const [savingAccess, setSavingAccess]   = useState(false)

  useEffect(() => { setPendingAccess(staffPageAccess) }, [staffPageAccess])

  const toggleAccess = (path) => {
    setPendingAccess(prev =>
      prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]
    )
  }

  const saveAccess = async () => {
    setSavingAccess(true)
    try {
      const { error } = await saveStaffPageAccess(pendingAccess)
      if (error) throw error
      addToast('บันทึกสิทธิ์การเข้าถึงเมนูแล้ว', 'success')
    } catch (err) {
      addToast('บันทึกสิทธิ์ไม่สำเร็จ: ' + err.message, 'error')
    }
    setSavingAccess(false)
  }

  // --- สิทธิ์การเข้าถึงเมนู (ผู้ดูแลระบบ) — Super Admin เท่านั้นที่แก้ได้ ---
  const [pendingAdminAccess, setPendingAdminAccess] = useState(adminPageAccess)
  const [savingAdminAccess, setSavingAdminAccess]   = useState(false)

  useEffect(() => { setPendingAdminAccess(adminPageAccess) }, [adminPageAccess])

  const toggleAdminAccess = (path) => {
    setPendingAdminAccess(prev =>
      prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]
    )
  }

  const saveAdminAccess = async () => {
    setSavingAdminAccess(true)
    try {
      const { error } = await saveAdminPageAccess(pendingAdminAccess)
      if (error) throw error
      addToast('บันทึกสิทธิ์การเข้าถึงเมนูแล้ว', 'success')
    } catch (err) {
      addToast('บันทึกสิทธิ์ไม่สำเร็จ: ' + err.message, 'error')
    }
    setSavingAdminAccess(false)
  }

  // --- บัญชีของฉัน ---
  const [newEmail, setNewEmail]               = useState(session?.user?.email ?? '')
  const [newPassword, setNewPassword]         = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword]       = useState(false)
  const [savingAuth, setSavingAuth]           = useState(false)

  // --- จัดการผู้ใช้งาน ---
  const [userList, setUserList]               = useState([])
  const [usersLoading, setUsersLoading]       = useState(true)
  const [newUserEmail, setNewUserEmail]       = useState('')
  const [newUserPass, setNewUserPass]         = useState('')
  const [showNewUserPass, setShowNewUserPass] = useState(false)
  const [creatingUser, setCreatingUser]       = useState(false)
  const [userMgmtStatus, setUserMgmtStatus]   = useState('')
  const [cooldown, setCooldown]               = useState(0)
  const cooldownRef                           = useRef(null)
  const [roleChangeTarget, setRoleChangeTarget] = useState(null) // { id, newRole } | null
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)

  useEffect(() => { loadUsers() }, [])
  useEffect(() => () => { if (cooldownRef.current) clearInterval(cooldownRef.current) }, [])

  const startCooldown = useCallback(() => {
    setCooldown(CREATE_COOLDOWN_SEC)
    cooldownRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) { clearInterval(cooldownRef.current); cooldownRef.current = null; return 0 }
        return prev - 1
      })
    }, 1000)
  }, [])

  // ── Load users from profiles table (no admin.listUsers needed) ───────────
  const loadUsers = async () => {
    setUsersLoading(true)
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, role, created_at')
        .order('created_at', { ascending: true })
      if (error) throw error
      setUserList(data ?? [])
    } catch (err) {
      addToast('โหลดรายชื่อผู้ใช้งานไม่สำเร็จ: ' + err.message, 'error')
    }
    setUsersLoading(false)
  }

  // ── Change role via secure RPC (authorization enforced in DB) ─────────────
  // 3-tier rule: super_admin can move anyone between all 3 roles; admin can
  // only toggle staff ⇄ admin and can't touch/grant super_admin (buttons for
  // that are simply not rendered for an admin viewer — DB also enforces it).
  const requestChangeRole = (userId, newRole) => {
    setRoleChangeTarget({ id: userId, newRole })
  }

  const confirmChangeRole = async () => {
    if (!roleChangeTarget) return
    const { id: userId, newRole } = roleChangeTarget
    const label = ROLE_LABEL[newRole] ?? newRole
    setRoleChangeTarget(null)
    const { error } = await supabase.rpc('change_user_role', {
      target_id: userId,
      new_role:  newRole,
    })
    if (error) {
      addToast('เปลี่ยน role ไม่สำเร็จ: ' + error.message, 'error')
    } else {
      addToast(`เปลี่ยน role เป็น ${label} แล้ว`, 'success')
      loadUsers()
    }
  }

  // ── Update own email/password ─────────────────────────────────────────────
  const saveAuth = async () => {
    if (newPassword && newPassword !== confirmPassword) {
      addToast('รหัสผ่านไม่ตรงกัน', 'error')
      return
    }
    setSavingAuth(true)
    try {
      if (newEmail !== session?.user?.email) {
        const { error } = await updateEmail(newEmail)
        if (error) throw error
      }
      if (newPassword) {
        const { error } = await updatePassword(newPassword)
        if (error) throw error
      }
      addToast('อัปเดตบัญชีสำเร็จ', 'success')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      addToast('เกิดข้อผิดพลาด: ' + err.message, 'error')
    }
    setSavingAuth(false)
  }

  // ── Create new user via signUp ────────────────────────────────────────────
  const createUser = async () => {
    if (cooldown > 0) return
    if (!newUserEmail || !newUserPass) {
      setUserMgmtStatus('กรุณากรอกอีเมลและรหัสผ่าน')
      setTimeout(() => setUserMgmtStatus(''), 3000)
      return
    }
    if (newUserPass.length < 6) {
      setUserMgmtStatus('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร')
      setTimeout(() => setUserMgmtStatus(''), 3000)
      return
    }
    setCreatingUser(true)
    try {
      const { error } = await supabase.auth.signUp({
        email: newUserEmail,
        password: newUserPass,
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) throw error
      setUserMgmtStatus(`✅ สร้างบัญชี ${newUserEmail} สำเร็จ! ระบบส่งอีเมลยืนยันให้แล้ว`)
      setNewUserEmail('')
      setNewUserPass('')
      loadUsers()
      startCooldown()
    } catch (err) {
      setUserMgmtStatus('❌ เกิดข้อผิดพลาด: ' + err.message)
    }
    setCreatingUser(false)
    setTimeout(() => setUserMgmtStatus(''), 5000)
  }

  const isCreateDisabled = creatingUser || cooldown > 0

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <h1 className="text-xl font-bold text-gray-900">การจัดการผู้ใช้งาน</h1>

      {/* ── บัญชีผู้ใช้ของฉัน ─────────────────────────────────────── */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-gray-800">บัญชีผู้ใช้ของฉัน</h2>
        <p className="text-xs text-gray-500">
          อีเมลปัจจุบัน: <strong>{session?.user?.email}</strong>
        </p>

        <div>
          <label htmlFor="my-email" className="label">อีเมลใหม่</label>
          <input id="my-email" type="email" className="input" value={newEmail}
            onChange={e => setNewEmail(e.target.value)} />
        </div>

        <div>
          <label htmlFor="my-password" className="label">รหัสผ่านใหม่</label>
          <div className="relative">
            <input
              id="my-password"
              type={showPassword ? 'text' : 'password'}
              className="input pr-10"
              placeholder="เว้นว่างถ้าไม่ต้องการเปลี่ยน"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
            />
            <button type="button" onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {newPassword && (
          <div>
            <label htmlFor="my-password-confirm" className="label">ยืนยันรหัสผ่านใหม่</label>
            <input id="my-password-confirm" type={showPassword ? 'text' : 'password'} className="input"
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
          </div>
        )}

        <button onClick={saveAuth} disabled={savingAuth} className="btn-primary flex items-center gap-2">
          <Save size={16} />
          {savingAuth ? 'กำลังอัปเดต...' : 'อัปเดตบัญชี'}
        </button>
      </div>

      {/* ── รายชื่อผู้ใช้ (จาก profiles table) ──────────────────────── */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-cocoa-600" />
          <h2 className="font-semibold text-gray-800">ผู้ใช้งานในระบบ</h2>
          <span className="ml-auto text-xs text-gray-400">{userList.length} บัญชี</span>
        </div>

        {usersLoading ? (
          <p className="text-sm text-gray-400 text-center py-4">กำลังโหลด...</p>
        ) : userList.length > 0 ? (
          <div className="space-y-2">
            {userList.map(u => {
              const isMe = u.id === session?.user?.id
              const canManageThisRow =
                !isMe && (myRole === 'super_admin' || (myRole === 'admin' && u.role !== 'super_admin'))

              return (
                <div key={u.id}
                  className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5 text-sm">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                    u.role === 'super_admin' ? 'bg-purple-100'
                    : u.role === 'admin' ? 'bg-cocoa-100' : 'bg-gray-200'
                  }`}>
                    {u.role === 'super_admin'
                      ? <Crown size={14} className="text-purple-700" />
                      : u.role === 'admin'
                        ? <ShieldCheck size={14} className="text-cocoa-700" />
                        : <Shield size={14} className="text-gray-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-800 truncate">{u.email || '(ไม่ระบุ)'}</p>
                    <p className="text-xs text-gray-400">
                      {ROLE_LABEL[u.role] ?? u.role}
                      {isMe && ' · คุณ'}
                    </p>
                  </div>
                  {canManageThisRow && (
                    <div className="flex gap-1.5 shrink-0">
                      {u.role === 'staff' && (
                        <button
                          onClick={() => requestChangeRole(u.id, 'admin')}
                          className="text-xs px-2.5 py-1 rounded-lg font-medium transition-colors bg-cocoa-50 text-cocoa-700 hover:bg-cocoa-100"
                        >→ Admin</button>
                      )}
                      {u.role === 'admin' && (
                        <button
                          onClick={() => requestChangeRole(u.id, 'staff')}
                          className="text-xs px-2.5 py-1 rounded-lg font-medium transition-colors bg-amber-50 text-amber-700 hover:bg-amber-100"
                        >→ Staff</button>
                      )}
                      {u.role === 'admin' && myRole === 'super_admin' && (
                        <button
                          onClick={() => requestChangeRole(u.id, 'super_admin')}
                          className="text-xs px-2.5 py-1 rounded-lg font-medium transition-colors bg-purple-50 text-purple-700 hover:bg-purple-100"
                        >→ Super Admin</button>
                      )}
                      {u.role === 'super_admin' && myRole === 'super_admin' && (
                        <button
                          onClick={() => requestChangeRole(u.id, 'admin')}
                          className="text-xs px-2.5 py-1 rounded-lg font-medium transition-colors bg-amber-50 text-amber-700 hover:bg-amber-100"
                        >→ Admin</button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">ยังไม่มีผู้ใช้งานในระบบ</p>
        )}
      </div>

      {/* ── สิทธิ์การเข้าถึงเมนู (พนักงาน) ──────────────────────────── */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound size={18} className="text-cocoa-600" />
          <h2 className="font-semibold text-gray-800">สิทธิ์การเข้าถึงเมนู (พนักงาน)</h2>
        </div>
        <p className="text-xs text-gray-500">
          เลือกหน้าที่ role &ldquo;พนักงาน&rdquo; เข้าถึงได้ — ผู้ดูแลระบบและผู้ดูแลระบบสูงสุดเห็นทุกหน้าเสมอ
        </p>
        <div className="grid grid-cols-2 gap-2">
          {STAFF_PAGES.map(p => (
            <label key={p.to} className="flex items-center gap-2 text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-cocoa-600 focus:ring-cocoa-400"
                checked={pendingAccess.includes(p.to)}
                onChange={() => toggleAccess(p.to)}
              />
              {p.label}
            </label>
          ))}
        </div>
        <button onClick={saveAccess} disabled={savingAccess} className="btn-primary flex items-center gap-2">
          <Save size={16} />
          {savingAccess ? 'กำลังบันทึก...' : 'บันทึกสิทธิ์'}
        </button>
      </div>

      {/* ── สิทธิ์การเข้าถึงเมนู (ผู้ดูแลระบบ) — Super Admin เท่านั้น ──── */}
      {myRole === 'super_admin' && (
        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <Crown size={18} className="text-purple-600" />
            <h2 className="font-semibold text-gray-800">สิทธิ์การเข้าถึงเมนู (ผู้ดูแลระบบ)</h2>
          </div>
          <p className="text-xs text-gray-500">
            เลือกหน้าที่ role &ldquo;ผู้ดูแลระบบ&rdquo; เข้าถึงได้ — ผู้ดูแลระบบสูงสุดเห็นทุกหน้าเสมอ
            และเป็นคนเดียวที่แก้ไขสิทธิ์ชุดนี้ได้
          </p>
          <div className="grid grid-cols-2 gap-2">
            {ADMIN_PAGES.map(p => (
              <label key={p.to} className="flex items-center gap-2 text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-purple-600 focus:ring-purple-400"
                  checked={pendingAdminAccess.includes(p.to)}
                  onChange={() => toggleAdminAccess(p.to)}
                />
                {p.label}
              </label>
            ))}
          </div>
          <button onClick={saveAdminAccess} disabled={savingAdminAccess} className="btn-primary flex items-center gap-2">
            <Save size={16} />
            {savingAdminAccess ? 'กำลังบันทึก...' : 'บันทึกสิทธิ์'}
          </button>
        </div>
      )}

      {/* ── เพิ่มผู้ใช้ใหม่ ──────────────────────────────────────────── */}
      <div className="card space-y-4">
        <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
          <UserPlus size={15} /> เพิ่มผู้ใช้งานใหม่
        </p>
        <div className="text-xs text-amber-600 flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>
            ระบบจะส่งอีเมลยืนยันไปให้ผู้ใช้ก่อนสามารถเข้าสู่ระบบได้
            <br /><strong>หมายเหตุ:</strong> ตรวจสอบว่า Supabase → Auth → Email confirmations = <strong>ON</strong> มิฉะนั้นจะทำให้ session ปัจจุบันหลุด
          </span>
        </div>

        <div>
          <label htmlFor="new-user-email" className="label">อีเมล</label>
          <input id="new-user-email" type="email" className="input" placeholder="email@example.com"
            value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)}
            disabled={cooldown > 0} />
        </div>

        <div>
          <label htmlFor="new-user-password" className="label">รหัสผ่านเริ่มต้น (อย่างน้อย 6 ตัว)</label>
          <div className="relative">
            <input
              id="new-user-password"
              type={showNewUserPass ? 'text' : 'password'}
              className="input pr-10"
              placeholder="••••••••"
              value={newUserPass}
              onChange={e => setNewUserPass(e.target.value)}
              disabled={cooldown > 0}
            />
            <button type="button" onClick={() => setShowNewUserPass(v => !v)}
              aria-label={showNewUserPass ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              {showNewUserPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <button onClick={createUser} disabled={isCreateDisabled}
          className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
          <UserPlus size={16} />
          {creatingUser ? 'กำลังสร้าง...' : cooldown > 0 ? `รอ ${cooldown} วินาที...` : 'สร้างบัญชีผู้ใช้'}
        </button>

        {cooldown > 0 && (
          <div className="space-y-1">
            <div className="w-full bg-gray-100 rounded-full h-1.5">
              <div className="h-1.5 rounded-full bg-cocoa-400 transition-all duration-1000"
                style={{ width: `${(cooldown / CREATE_COOLDOWN_SEC) * 100}%` }} />
            </div>
            <p className="text-xs text-gray-400 text-right">สามารถสร้างบัญชีใหม่ได้ในอีก {cooldown} วินาที</p>
          </div>
        )}

        {userMgmtStatus && (
          <p className={`text-sm ${
            userMgmtStatus.startsWith('✅') ? 'text-green-600'
            : userMgmtStatus.startsWith('❌') ? 'text-red-600'
            : 'text-amber-600'
          }`}>
            {userMgmtStatus}
          </p>
        )}
      </div>

      {/* ── ออกจากระบบ ──────────────────────────────────────────────── */}
      <div className="card">
        <button
          onClick={() => setShowSignOutConfirm(true)}
          className="btn-danger flex items-center gap-2"
        >
          <LogOut size={16} /> ออกจากระบบ
        </button>
      </div>

      <ConfirmModal
        open={!!roleChangeTarget}
        title={`เปลี่ยน role เป็น "${ROLE_LABEL[roleChangeTarget?.newRole] ?? ''}"?`}
        confirmLabel="ยืนยัน"
        onConfirm={confirmChangeRole}
        onCancel={() => setRoleChangeTarget(null)}
      />

      <ConfirmModal
        open={showSignOutConfirm}
        title="ต้องการออกจากระบบ?"
        confirmLabel="ออกจากระบบ"
        danger
        icon={LogOut}
        onConfirm={() => { setShowSignOutConfirm(false); signOut() }}
        onCancel={() => setShowSignOutConfirm(false)}
      />
    </div>
  )
}
