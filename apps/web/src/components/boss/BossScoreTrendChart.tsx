import React, { useMemo } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

interface SeriesPoint {
  date: string
  score: number | null
}

interface Props {
  quality: SeriesPoint[]
  logistics: SeriesPoint[]
  service: SeriesPoint[]
  height?: number
}

export const BossScoreTrendChart: React.FC<Props> = ({
  quality,
  logistics,
  service,
  height = 220,
}) => {
  const data = useMemo(() => {
    const dates = new Set<string>()
    for (const row of [...quality, ...logistics, ...service]) dates.add(row.date)
    return [...dates]
      .sort()
      .map((date) => ({
        date: date.slice(5),
        quality: quality.find((q) => q.date === date)?.score ?? null,
        logistics: logistics.find((q) => q.date === date)?.score ?? null,
        service: service.find((q) => q.date === date)?.score ?? null,
      }))
  }, [quality, logistics, service])

  if (data.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">暂无体验分趋势</div>
  }

  return (
    <div className="w-full overflow-x-auto">
      <div className="min-w-[280px]" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis domain={[0, 5]} tick={{ fontSize: 10 }} width={32} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="quality" name="品质分" stroke="#e11d48" dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="logistics" name="物流分" stroke="#0284c7" dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="service" name="服务分" stroke="#16a34a" dot={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
