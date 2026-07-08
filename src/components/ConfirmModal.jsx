import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────
// Shared, accessible confirm dialog — ใช้แทน window.confirm() ทุกที่
// เพื่อให้ UX ของการยืนยัน/ลบข้อมูลเหมือนกันทั้งแอป (role="dialog",
// ปิดด้วย Escape ได้, ปุ่มยืนยัน/ยกเลิกชัดเจน แทนกล่อง confirm ของเบราว์เซอร์)
// ─────────────────────────────────────────────────────────────────
export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'ยืนยัน',
  cancelLabel  = 'ยกเลิก',
  onConfirm,
  onCancel,
  danger = false,
  icon: Icon = AlertTriangle,
}) {
  // ปิดด้วยปุ่ม Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
    >
      <div className="card max-w-sm w-full text-center space-y-4">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto ${danger ? 'bg-red-100' : 'bg-amber-100'}`}>
          <Icon size={22} className={danger ? 'text-red-600' : 'text-amber-600'} />
        </div>
        <div>
          <p id="confirm-modal-title" className="font-semibold text-gray-900">{title}</p>
          {message && <p className="text-sm text-gray-500 mt-1">{message}</p>}
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="btn-secondary flex-1">{cancelLabel}</button>
          <button onClick={onConfirm} className={`flex-1 ${danger ? 'btn-danger' : 'btn-primary'}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
