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
import { trimLeadingEmptyMonths } from '../../lib/boss-chart-months'
import type { BossMoneyTrendPoint } from '../../lib/boss-dashboard-api'

type TrendRow = Record<string, string | number | null | undefined>
import {
  BOSS_CHART_LEGEND_STYLE,
  bossLineChartMargin,
  bossMoneyYAxisWidth,
  useBossChartCompact,
} from './boss-chart-layout'
import { BossMoneyTrendTooltip } from './BossMoneyTrendTooltip'

const SHOP_COLORS: Record<string, string> = {
  total: '#0f172a',
  shiyuju: '#e11d48',
  hetianyayu: '#0284c7',
  xiangyu: '#16a34a',
  xyxiangyu: '#9333ea',
}

const LINES = [
  { key: 'total', label: '四店合计', color: SHOP_COLORS.total },
  { key: 'shiyuju', label: '拾玉居和田玉', color: SHOP_COLORS.shiyuju },
  { key: 'hetianyayu', label: '和田雅玉', color: SHOP_COLORS.hetianyayu },
  { key: 'xiangyu', label: '祥钰珠宝', color: SHOP_COLORS.xiangyu },
  { key: 'xyxiangyu', label: 'XY祥钰珠宝', color: SHOP_COLORS.xyxiangyu },
]

interface Props {
  incomePoints: BossMoneyTrendPoint[]
  settlementPoints: BossMoneyTrendPoint[]
  height?: number
}

function formatAxisTickFromCent(cent: number): string {
  const yuan = cent / 100
  return Math.round(yuan).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

export const BossMoneyTrendChart: React.FC<Props> = ({
  incomePoints,
  settlementPoints,
  height = 280,
}) => {
  const compact = useBossChartCompact()
  const [mode, setMode] = useState<'income' | 'settlement'>('income')
  const [visible, setVisible] = useState<Record<string, boolean>>({
    total: true,
    shiyuju: true,
    hetianyayu: true,
    xiangyu: true,
    xyxiangyu: true,
  })
  const [activeKey, setActiveKey] = useState<string | undefined>()

  const source = mode === 'income' ? incomePoints : settlementPoints

  const trimmedPoints = useMemo(
    () => trimLeadingEmptyMonths(source, (p) => p.amountCent),
    [source],
  )

  const data = useMemo(
    () =>
      trimmedPoints.map((p) => ({
        month: p.month.slice(5),
        fullMonth: p.month,
        total: p.amountCent,
        shiyuju: p.shiyuju,
        hetianyayu: p.hetianyayu,
        xiangyu: p.xiangyu,
        xyxiangyu: p.xyxiangyu,
      })),
    [trimmedPoints],
  )

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
        暂无趋势数据
      </div>
    )
  }

  return (
    <div className="w-full min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">资金趋势</h3>
        <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5 text-xs">
          {[
            ['income', '实际到账'],
            ['settlement', '结算净额'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`rounded-full px-3 py-1 transition ${
                mode === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              }`}
              onClick={() => setMode(key as 'income' | 'settlement')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {mode === 'settlement' ? (
        <p className="mb-2 text-[11px] text-slate-500">
          到账流水与结算账单口径不同；完整月优先使用平台月账单，当前月按日账单累计。
        </p>
      ) : null}
      <div className="w-full min-w-0 overflow-hidden" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={bossLineChartMargin(compact)}
            onMouseMove={(state) => {
              if (state?.activePayload?.[0]?.dataKey) {
                setActiveKey(String(state.activePayload[0].dataKey))
              }
            }}
            onMouseLeave={() => setActiveKey(undefined)}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fontSize: compact ? 10 : 11 }}
              tickMargin={4}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={compact ? 8 : 12}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              width={bossMoneyYAxisWidth(compact)}
              axisLine={false}
              tickLine={false}
              tickFormatter={formatAxisTickFromCent}
            />
            <Tooltip
              content={({ label, payload }) => (
                <BossMoneyTrendTooltip
                  label={String(label ?? '')}
                  payload={(payload ?? []).map((p) => p.payload as TrendRow)}
                  activeKey={activeKey}
                  visible={visible}
                />
              )}
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
            {LINES.map((line) =>
              visible[line.key] ? (
                <Line
                  key={line.key}
                  type="monotone"
                  dataKey={line.key}
                  name={line.label}
                  stroke={line.color}
                  strokeWidth={line.key === activeKey ? 2.5 : 2}
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
