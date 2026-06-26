import React, { useMemo } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CHART_COLORS, formatChartMoney, truncateChartLabel } from './operationsChartFormat'
import { OperationsChartEmpty } from './OperationsChartEmpty'

export interface OperationsBarChartItem {
  key: string
  label: string
  value: number
  fullLabel?: string
}

interface Props {
  items: OperationsBarChartItem[]
  valueFormatter?: (value: number) => string
  onItemClick?: (item: OperationsBarChartItem) => void
  emptyMessage?: string
  height?: number
}

export const OperationsBarChart: React.FC<Props> = ({
  items,
  valueFormatter = formatChartMoney,
  onItemClick,
  emptyMessage,
  height = 260,
}) => {
  const data = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        shortLabel: truncateChartLabel(item.label, 12),
      })),
    [items],
  )

  if (items.length === 0 || items.every((i) => i.value <= 0)) {
    return <OperationsChartEmpty message={emptyMessage} />
  }

  return (
    <div style={{ height }} className="min-w-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="shortLabel"
            width={72}
            tick={{ fontSize: 11, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(244, 63, 94, 0.06)' }}
            formatter={(v: number) => [valueFormatter(v), '数值']}
            labelFormatter={(_, payload) => {
              const row = payload?.[0]?.payload as OperationsBarChartItem | undefined
              return row?.fullLabel ?? row?.label ?? ''
            }}
          />
          <Bar
            dataKey="value"
            radius={[0, 4, 4, 0]}
            onClick={(barData) => {
              const payload = (barData as { payload?: OperationsBarChartItem }).payload
              if (payload && onItemClick) onItemClick(payload)
            }}
            className={onItemClick ? 'cursor-pointer' : undefined}
          >
            {data.map((entry, index) => (
              <Cell key={entry.key} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
