import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState(null) // 'super_admin' | 'admin' | 'staff' | null
  const [accessExpiresAt, setAccessExpiresAt] = useState(null) // null = ไม่จำกัดวันใช้งาน

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

  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password })

  const signOut = () => supabase.auth.signOut()

  return (
    <AuthContext.Provider value={{ session, loading, role, signIn, signOut, accessExpiresAt, isAccessExpired }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
