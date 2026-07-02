import React from 'react'

interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

export const DailyReportAttendanceCheckbox: React.FC<Props> = ({
  checked,
  onChange,
  disabled = false,
  className = '',
}) => (
  <label
    className={`inline-flex cursor-pointer select-none items-center gap-2 text-sm text-slate-700 ${disabled ? 'cursor-not-allowed opacity-50' : ''} ${className}`}
  >
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
    />
    显示迟到早退
  </label>
)
