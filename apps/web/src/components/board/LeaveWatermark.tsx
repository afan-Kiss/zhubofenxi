import React from 'react'

/** 主播请假水印：倾斜 15°、红色加粗，铺满卡片；上层主播/店铺名需自带更高层级 */
export const LeaveWatermark: React.FC<{ className?: string }> = ({ className }) => (
  <div
    className={`pointer-events-none absolute inset-0 z-[5] flex items-center justify-center overflow-hidden ${className ?? ''}`}
    aria-hidden
  >
    <span
      className="select-none whitespace-nowrap text-[clamp(2.75rem,18vw,4.5rem)] font-extrabold leading-none tracking-widest text-red-600/[0.42]"
      style={{ transform: 'rotate(-15deg)' }}
    >
      休假
    </span>
  </div>
)
