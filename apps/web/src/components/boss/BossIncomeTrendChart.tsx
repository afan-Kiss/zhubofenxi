import React, { useMemo, useState } from 'react'
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
import { centToDisplayYuan } from '../../lib/boss-dashboard-api'

const SHOP_COLORS: Record<string, string> = {
  total: '#0f172a',
  shiyuju: '#e11d48',
  hetianyayu: '#0284c7',
  xiangyu: '#16a34a',
  xyxiangyu: '#9333ea',
}

interface Point {
  month: string
  amountCent: number
  shiyuju: number
  hetianyayu: number
  xiangyu: number
  xyxiangyu: number
}

interface Props {
  points: Point[]
  mode?: 'combined' | 'shop'
  shopKey?: string
  height?: number
}

export const BossIncomeTrendChart: React.FC<Props> = ({
  points,
  mode = 'combined',
  shopKey,
  height = 260,
}) => {
  const [visible, setVisible] = useState<Record<string, boolean>>({
    total: true,
    shiyuju: true,
    hetianyayu: true,
    xiangyu: true,
    xyxiangyu: true,
  })

  const data = useMemo(
    () =>
      points.map((p) => ({
        month: p.month.slice(5),
        total: p.amountCent / 100,
        shiyuju: p.shiyuju / 100,
        hetianyayu: p.hetianyayu / 100,
        xiangyu: p.xiangyu / 100,
        xyxiangyu: p.xyxiangyu / 100,
      })),
    [points],
  )

  const lines =
    mode === 'shop' && shopKey
      ? [{ key: shopKey, label: '到账金额', color: SHOP_COLORS[shopKey] ?? '#334155' }]
      : [
          { key: 'total', label: '四店合计', color: SHOP_COLORS.total },
          { key: 'shiyuju', label: '拾玉居和田玉', color: SHOP_COLORS.shiyuju },
          { key: 'hetianyayu', label: '和田雅玉', color: SHOP_COLORS.hetianyayu },
          { key: 'xiangyu', label: '祥钰珠宝', color: SHOP_COLORS.xiangyu },
          { key: 'xyxiangyu', label: 'XY祥钰珠宝', color: SHOP_COLORS.xyxiangyu },
        ]

  if (data.length === 0) {
    return <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">暂无到账趋势数据</div>
  }

  return (
    <div className="w-full overflow-x-auto">
      <div className="min-w-[320px]" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={56} />
            <Tooltip
              formatter={(value: number, name: string) => [centToDisplayYuan(Math.round(value * 100)), name]}
            />
            <Legend
              onClick={(e) => {
                const key = String(e.dataKey ?? '')
                setVisible((prev) => ({ ...prev, [key]: !prev[key] }))
              }}
            />
            {lines.map((line) =>
              visible[line.key] ? (
                <Line
                  key={line.key}
                  type="monotone"
                  dataKey={line.key}
                  name={line.label}
                  stroke={line.color}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                />
              ) : null,
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
