// src/components/StepIndicator.tsx
export function StepIndicator({ step }: { step: number }) {
  const steps = ['ตะกร้า', 'ที่อยู่', 'ชำระเงิน']
  return (
    <div className="bg-white border-b flex items-center px-4 py-2.5">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center flex-1">
          <div className="flex flex-col items-center flex-1">
            <div className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${
              i + 1 < step ? 'bg-green-500 text-white' :
              i + 1 === step ? 'bg-green-500 text-white ring-4 ring-green-100' :
              'bg-gray-100 text-gray-400'
            }`}>
              {i + 1 < step ? '✓' : i + 1}
            </div>
            <p className={`text-xs mt-1 ${i + 1 === step ? 'text-green-600 font-semibold' : 'text-gray-400'}`}>
              {label}
            </p>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-0.5 mb-4 ${i + 1 < step ? 'bg-green-500' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}
