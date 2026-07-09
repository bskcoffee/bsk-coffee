import { createContext, useContext, useState, useCallback } from 'react'

const ToastContext = createContext(null)

const TYPE_STYLES = {
  success: { bg: '#f0fdf4', border: '#86efac', icon: '✓', color: '#15803d' },
  error:   { bg: '#fef2f2', border: '#fca5a5', icon: '✕', color: '#b91c1c' },
  warning: { bg: '#fffbeb', border: '#fcd34d', icon: '⚠', color: '#b45309' },
  info:    { bg: '#eff6ff', border: '#93c5fd', icon: 'ℹ', color: '#1d4ed8' },
}

function Toast({ toast, onRemove }) {
  const s = TYPE_STYLES[toast.type] ?? TYPE_STYLES.info
  return (
    <div
      onClick={() => onRemove(toast.id)}
      style={{
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: '12px',
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        cursor: 'pointer',
        animation: 'toast-in 0.2s ease',
        maxWidth: '360px',
        width: '100%',
      }}
    >
      <span style={{ color: s.color, fontWeight: 700, fontSize: '14px', flexShrink: 0, lineHeight: '20px' }}>
        {s.icon}
      </span>
      <span style={{ color: s.color, fontSize: '13px', lineHeight: '1.5', flex: 1 }}>
        {toast.message}
      </span>
    </div>
  )
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <style>{`@keyframes toast-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }`}</style>
      {toasts.length > 0 && (
        <div style={{
          position: 'fixed',
          bottom: '16px',
          right: '16px',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          alignItems: 'flex-end',
        }}>
          {toasts.map(t => (
            <Toast key={t.id} toast={t} onRemove={removeToast} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
