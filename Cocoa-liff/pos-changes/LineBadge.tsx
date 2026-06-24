// pos-changes/LineBadge.tsx
// เพิ่ม badge นี้ใน OrderCard ของ POS เมื่อ order.source === 'line'

interface LineBadgeProps {
  scheduledAt?: string | null
}

export function LineBadge({ scheduledAt }: LineBadgeProps) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 bg-[#06C755] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
        LINE
      </span>
      {scheduledAt && (
        <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">
          📅 {new Date(scheduledAt).toLocaleString('th-TH', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
        </span>
      )}
    </div>
  )
}
