import React from 'react'
import { isMultiDayLateRange } from '../../lib/anchor-late-status'

interface Props {
  startDate: string
  endDate: string
  className?: string
}

/** 多日范围不判断迟播，仅提示用户切换到单日查看 */
export const AnchorLateMultiDayNote: React.FC<Props> = ({
  startDate,
  endDate,
  className = '',
}) => {
  if (!isMultiDayLateRange(startDate, endDate)) return null
  return (
    <p className={`text-xs leading-snug text-slate-500 ${className}`}>
      迟播状态仅单日查看时显示
    </p>
  )
}
