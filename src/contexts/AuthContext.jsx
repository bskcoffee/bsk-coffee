import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [loading, setLoading]  = useState(true)
  const [role, setRole]        = useState(null)      // 'admin' | 'staff' | null
  const [accessExpiresAt, setAccessExpiresAt] = useState(null) // null = ไม่จำกัดวันใช้งาน

  // ── Initial session + auth listener ─────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  // ── Fetch role + access expiry from profiles whenever session changes ────
  useEffect(() => {
    if (!session) {
      setRole(null)
      setAccessExpiresAt(null)
      return
    }
    supabase
      .from('profiles')
      .select('role, access_expires_at')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        setRole(data?.role ?? 'staff')
        setAccessExpiresAt(data?.access_expires_at ?? null)
      })
  }, [session])

  // super_admin ไม่ถูกจำกัดวันใช้งานเลย ไม่ว่ากรณีใด
  const isAccessExpired =
    role !== null && role !== 'super_admin' &&
    !!accessExpiresAt && new Date(accessExpiresAt) < new Date()

  // ── Auth helpers ─────────────────────────────────────────────────
  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const updatePassword = async (newPassword) => {
    return supabase.auth.updateUser({ password: newPassword })
  }

  const updateEmail = async (newEmail) => {
    return supabase.auth.updateUser({ email: newEmail })
  }

  return (
    <AuthContext.Provider value={{
      session, loading, role, signIn, signOut, updatePassword, updateEmail,
      accessExpiresAt, isAccessExpired,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
