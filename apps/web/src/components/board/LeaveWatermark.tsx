import React from 'react'

/** 主播状态水印：倾斜 15°、红色加粗；上层主播/店铺名需自带更高层级 */
export const LeaveWatermark: React.FC<{
  className?: string
  /** 相对卡片垂直居中再下移（日报图避免压住店铺/主播标题） */
  offsetY?: string
  /** 默认「休假」；长周期业绩可用「已离职」 */
  label?: string
}> = ({ className, offsetY = '12%', label = '休假' }) => (
  <div
    className={`pointer-events-none absolute inset-0 z-[5] flex items-center justify-center overflow-hidden ${className ?? ''}`}
    aria-hidden
  >
    <span
      className="select-none whitespace-nowrap text-[clamp(2.75rem,18vw,4.5rem)] font-extrabold leading-none tracking-widest text-red-600/[0.42]"
      style={{ transform: `translateY(${offsetY}) rotate(-15deg)` }}
    >
      {label}
    </span>
  </div>
)
