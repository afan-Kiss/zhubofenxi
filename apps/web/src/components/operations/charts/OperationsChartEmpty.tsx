import React from 'react'

export const OperationsChartEmpty: React.FC<{ message?: string }> = ({
  message = '暂无数据，先不用看这个图。',
}) => (
  <div className="flex h-[220px] items-center justify-center rounded-xl bg-slate-50 px-4 text-center text-sm text-slate-500 md:h-[260px]">
    {message}
  </div>
)
