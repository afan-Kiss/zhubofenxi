import React, { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import {
  CHART_COLORS,
  formatChartMoney,
  takeTopWithOther,
} from './operationsChartFormat'
import { OperationsChartEmpty } from './OperationsChartEmpty'

export interface OperationsPieChartItem {
  key: string
  label: string
  value: number
  isOther?: boolean
}

interface Props {
  items: OperationsPieChartItem[]
  valueFormatter?: (value: number) => string
  onItemClick?: (item: OperationsPieChartItem) => void
  emptyMessage?: string
  height?: number
  mergeTop?: number
}

export const OperationsPieChart: React.FC<Props> = ({
  items,
  valueFormatter = formatChartMoney,
  onItemClick,
  emptyMessage,
  height = 260,
  mergeTop = 5,
}) => {
  const { data, total } = useMemo(() => {
    const filtered = items.filter((i) => i.value > 0)
    const merged = takeTopWithOther(filtered, mergeTop).map((i) => ({
      ...i,
      key: i.isOther ? '__other__' : i.key,
    }))
    const sum = merged.reduce((s, r) => s + r.value, 0)
    return { data: merged, total: sum }
  }, [items, mergeTop])

  if (data.length === 0 || total <= 0) {
    return <OperationsChartEmpty message={emptyMessage} />
  }

  return (
    <div className="w-full">
      <div style={{ height: height - 48 }} className="min-w-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius="52%"
              outerRadius="78%"
              paddingAngle={1}
              onClick={(_, index) => {
                const item = data[index]
                if (item && !item.isOther && onItemClick) onItemClick(item)
              }}
              className={onItemClick ? 'cursor-pointer' : undefined}
            >
              {data.map((entry, index) => (
                <Cell
                  key={entry.key}
                  fill={entry.isOther ? '#cbd5e1' : CHART_COLORS[index % CHART_COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number, _n, props) => {
                const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0'
                return [`${valueFormatter(v)}（${pct}%）`, '占比']
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-slate-600">
        {data.map((entry, index) => (
          <li key={entry.key} className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                backgroundColor: entry.isOther
                  ? '#cbd5e1'
                  : CHART_COLORS[index % CHART_COLORS.length],
              }}
            />
            {entry.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
