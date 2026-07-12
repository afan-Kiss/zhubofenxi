import React from 'react'
import { Line, LineChart, ResponsiveContainer } from 'recharts'
import { bossSparklineMargin, useBossChartCompact } from './boss-chart-layout'

interface Props {
  points: Array<{ month: string; amountCent: number }>
  color?: string
}

export const BossIncomeSparkline: React.FC<Props> = ({ points, color = '#64748b' }) => {
  const compact = useBossChartCompact()
  const data = points.map((p) => ({ month: p.month.slice(5), amountCent: p.amountCent }))

  if (data.length === 0) {
    return <div className="mt-1 h-8 text-[11px] text-slate-400">暂无近期走势</div>
  }

  if (data.length === 1) {
    return <div className="mt-1 h-8 text-[11px] text-slate-400">{data[0].month} 有到账</div>
  }

  return (
    <div className="mt-1 h-9 w-full min-w-0 overflow-hidden">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={bossSparklineMargin(compact)}>
          <Line
            type="monotone"
            dataKey="amountCent"
            stroke={color}
            dot={false}
            connectNulls={false}
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
