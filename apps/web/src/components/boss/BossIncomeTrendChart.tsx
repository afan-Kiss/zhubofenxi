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
import { trimLeadingEmptyMonths } from '../../lib/boss-chart-months'
import {
  BOSS_CHART_LEGEND_STYLE,
  bossLineChartMargin,
  bossMoneyYAxisWidth,
  formatBossMoneyAxisTick,
  useBossChartCompact,
} from './boss-chart-layout'

const SHOP_COLORS: Record<string, string> = {
  total: '#0f172a',
  shiyuju: '#e11d48',
  hetianyayu: '#0284c7',
  xiangyu: '#16a34a',
  xyxiangyu: '#9333ea',
}

interface Point {
  month: string
  amountCent: number | null
  shiyuju: number | null
  hetianyayu: number | null
  xiangyu: number | null
  xyxiangyu: number | null
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
  height = 240,
}) => {
  const compact = useBossChartCompact()
  const [visible, setVisible] = useState<Record<string, boolean>>({
    total: true,
    shiyuju: true,
    hetianyayu: true,
    xiangyu: true,
    xyxiangyu: true,
  })

  const trimmedPoints = useMemo(
    () => trimLeadingEmptyMonths(points, (p) => p.amountCent),
    [points],
  )

  const data = useMemo(
    () =>
      trimmedPoints.map((p) => ({
        month: p.month.slice(5),
        fullMonth: p.month,
        total: p.amountCent != null ? p.amountCent / 100 : null,
        shiyuju: p.shiyuju != null ? p.shiyuju / 100 : null,
        hetianyayu: p.hetianyayu != null ? p.hetianyayu / 100 : null,
        xiangyu: p.xiangyu != null ? p.xiangyu / 100 : null,
        xyxiangyu: p.xyxiangyu != null ? p.xyxiangyu / 100 : null,
      })),
    [trimmedPoints],
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
    return (
      <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
        暂无到账趋势数据
      </div>
    )
  }

  if (data.length === 1 && mode === 'shop') {
    const row = data[0]
    const key = shopKey ?? 'total'
    const rawCent = trimmedPoints[0]?.amountCent
    if (rawCent == null) {
      return (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
          暂无到账趋势数据
        </div>
      )
    }
    const value = row[key as keyof typeof row]
    return (
      <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
        <div className="text-xs text-slate-500">{row.fullMonth} 月到账</div>
        <div className="mt-1 text-lg font-semibold text-slate-900">
          {centToDisplayYuan(Math.round(Number(value) * 100))}
        </div>
      </div>
    )
  }

  return (
    <div className="w-full min-w-0 overflow-hidden">
      <div className="w-full min-w-0" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={bossLineChartMargin(compact)}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fontSize: compact ? 10 : 11 }}
              tickMargin={4}
              axisLine={false}
              tickLine={false}
              padding={{ left: 0, right: 0 }}
              interval="preserveStartEnd"
              minTickGap={compact ? 8 : 12}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              width={bossMoneyYAxisWidth(compact)}
              axisLine={false}
              tickLine={false}
              tickFormatter={formatBossMoneyAxisTick}
            />
            <Tooltip
              wrapperStyle={{ zIndex: 20, maxWidth: compact ? 220 : undefined }}
              formatter={(value, name) => [
                value == null || typeof value !== 'number'
                  ? '—'
                  : centToDisplayYuan(Math.round(value * 100)),
                String(name),
              ]}
              labelFormatter={(label, payload) => {
                const full = payload?.[0]?.payload?.fullMonth
                return full ? `${full}（${label}）` : String(label)
              }}
            />
            <Legend
              verticalAlign="top"
              align="right"
              iconSize={8}
              wrapperStyle={BOSS_CHART_LEGEND_STYLE}
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
                  dot={{ r: 2 }}
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
