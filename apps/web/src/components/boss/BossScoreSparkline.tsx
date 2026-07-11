import React from 'react'
import { Line, LineChart, ResponsiveContainer } from 'recharts'

interface Props {
  points: Array<{ date: string; score: number | null }>
  color?: string
}

export const BossScoreSparkline: React.FC<Props> = ({ points, color = '#334155' }) => {
  const data = points.map((p) => ({ date: p.date.slice(5), score: p.score }))
  if (!data.some((d) => d.score != null)) {
    return <div className="h-10 text-xs text-slate-400">—</div>
  }
  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey="score" stroke={color} dot={false} connectNulls={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
