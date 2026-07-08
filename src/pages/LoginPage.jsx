import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Coffee } from 'lucide-react'

export default function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await signIn(email, password)
    if (error) {
      setError('อีเมล หรือ รหัสผ่านไม่ถูกต้อง')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-cocoa-800 to-cocoa-600 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-white/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Coffee size={40} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">BSK coffee&bakery</h1>
          <p className="text-cocoa-200 text-sm mt-1">ระบบจัดการยอดขาย</p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl p-6 shadow-xl">
          <h2 className="text-lg font-semibold text-gray-800 mb-5">เข้าสู่ระบบ</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="label">อีเมล</label>
              <input
                id="login-email"
                type="email"
                className="input"
                placeholder="admin@cocoahouse.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="label">รหัสผ่าน</label>
              <input
                id="login-password"
                type="password"
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3 text-base"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  กำลังเข้าสู่ระบบ...
                </span>
              ) : 'เข้าสู่ระบบ'}
            </button>
          </form>

          <p className="text-xs text-gray-400 text-center mt-4">
            ติดต่อผู้ดูแลระบบหากลืมรหัสผ่าน
          </p>
        </div>
      </div>
    </div>
  )
}
