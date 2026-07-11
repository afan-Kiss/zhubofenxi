import React from 'react'
import { Line, LineChart, ResponsiveContainer } from 'recharts'
import { bossSparklineMargin, useBossChartCompact } from './boss-chart-layout'

interface Props {
  points: Array<{ date: string; score: number | null }>
  color?: string
}

export const BossScoreSparkline: React.FC<Props> = ({ points, color = '#334155' }) => {
  const compact = useBossChartCompact()
  const data = points
    .filter((p) => p.score != null)
    .map((p) => ({ date: p.date.slice(5), score: p.score }))

  if (data.length === 0) {
    return <div className="mt-1 h-8 text-[11px] text-slate-400">暂无近期走势</div>
  }

  if (data.length === 1) {
    return (
      <div className="mt-1 text-[11px] text-slate-400">
        {data[0].date} · {data[0].score}
      </div>
    )
  }

  return (
    <div className="mt-1 h-9 w-full min-w-0 overflow-hidden">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={bossSparklineMargin(compact)}>
          <Line
            type="monotone"
            dataKey="score"
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
