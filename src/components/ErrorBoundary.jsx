import { Component } from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const msg = this.state.error?.message ?? 'Unknown error'

    return (
      <div className="min-h-screen flex items-center justify-center bg-cocoa-50 px-4">
        <div className="max-w-md w-full card text-center space-y-4">
          <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto">
            <AlertTriangle size={28} className="text-red-500" />
          </div>

          <div>
            <h1 className="text-lg font-bold text-gray-900">เกิดข้อผิดพลาด</h1>
            <p className="text-sm text-gray-500 mt-1">บางอย่างพังไป กรุณาลองรีเฟรช</p>
          </div>

          <div className="bg-gray-50 rounded-lg px-4 py-3 text-left">
            <p className="text-xs font-mono text-red-600 break-all">{msg}</p>
          </div>

          <div className="flex gap-3 justify-center">
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="btn-primary flex items-center gap-2"
            >
              <RefreshCw size={15} /> ลองใหม่
            </button>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = '/' }}
              className="btn-secondary flex items-center gap-2"
            >
              <Home size={15} /> หน้าหลัก
            </button>
          </div>
        </div>
      </div>
    )
  }
}
