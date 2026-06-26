import React, { useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  formatChartCount,
  formatChartMoney,
  formatMobileDate,
} from './operationsChartFormat'
import { OperationsChartEmpty } from './OperationsChartEmpty'

export interface OperationsLineChartPoint {
  dateKey: string
  dateLabel?: string
  amountYuan: number
  orderCount: number
}

type LineMetric = 'amount' | 'orders'

interface Props {
  points: OperationsLineChartPoint[]
  onPointClick?: (point: OperationsLineChartPoint) => void
  emptyMessage?: string
  height?: number
}

export const OperationsLineChart: React.FC<Props> = ({
  points,
  onPointClick,
  emptyMessage,
  height = 260,
}) => {
  const [metric, setMetric] = useState<LineMetric>('amount')

  const data = useMemo(
    () =>
      points.map((p) => ({
        ...p,
        shortDate: formatMobileDate(p.dateKey),
        value: metric === 'amount' ? p.amountYuan : p.orderCount,
      })),
    [points, metric],
  )

  if (points.length === 0 || points.every((p) => p.amountYuan <= 0 && p.orderCount <= 0)) {
    return <OperationsChartEmpty message={emptyMessage} />
  }

  const formatter = metric === 'amount' ? formatChartMoney : formatChartCount

  return (
    <div className="w-full">
      <div className="mb-2 flex gap-2">
        <button
          type="button"
          onClick={() => setMetric('amount')}
          className={`rounded-full px-3 py-1 text-xs ${
            metric === 'amount'
              ? 'bg-rose-100 text-rose-800'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          成交金额
        </button>
        <button
          type="button"
          onClick={() => setMetric('orders')}
          className={`rounded-full px-3 py-1 text-xs ${
            metric === 'orders'
              ? 'bg-rose-100 text-rose-800'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          订单数
        </button>
      </div>
      <div style={{ height }} className="min-w-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            onClick={(state) => {
              const row = state?.activePayload?.[0]?.payload as OperationsLineChartPoint | undefined
              if (row?.dateKey && onPointClick) onPointClick(row)
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="shortDate"
              tick={{ fontSize: 11, fill: '#64748b' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#64748b' }}
              axisLine={false}
              tickLine={false}
              width={metric === 'amount' ? 48 : 32}
            />
            <Tooltip
              formatter={(v: number) => [formatter(v), metric === 'amount' ? '成交金额' : '订单数']}
              labelFormatter={(_, payload) => {
                const row = payload?.[0]?.payload as OperationsLineChartPoint | undefined
                return row?.dateLabel ?? row?.dateKey ?? ''
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#e11d48"
              strokeWidth={2}
              dot={{ r: 3, fill: '#e11d48' }}
              activeDot={{ r: 5, cursor: onPointClick ? 'pointer' : 'default' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {onPointClick ? (
        <p className="mt-1 text-xs text-slate-400">点某一天可以看当天组成订单</p>
      ) : null}
    </div>
  )
}
