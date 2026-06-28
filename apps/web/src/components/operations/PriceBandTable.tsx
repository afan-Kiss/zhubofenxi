import React from 'react'
import type { OperationsPriceBandRow } from '../../pages/operations/operationsReportTypes'
import { formatIntegerMoney, formatOrderCount, formatPercent, formatRatePercent } from './operationsReportFormatters'

interface Props {
  rows: OperationsPriceBandRow[]
}

export const PriceBandTable: React.FC<Props> = ({ rows }) => {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">暂无价格带数据</p>
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-[720px] w-full text-left text-xs">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2">价格带</th>
            <th className="px-3 py-2">订单数</th>
            <th className="px-3 py-2">金额</th>
            <th className="px-3 py-2">占比</th>
            <th className="px-3 py-2">客单价</th>
            <th className="px-3 py-2">退货单</th>
            <th className="px-3 py-2">退货单率</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.bandLabel} className="border-t border-slate-100">
              <td className="px-3 py-2 font-medium text-slate-900">{row.bandLabel}</td>
              <td className="px-3 py-2">{formatOrderCount(row.orderCount)}</td>
              <td className="px-3 py-2">{formatIntegerMoney(row.amountYuan)}</td>
              <td className="px-3 py-2">{formatPercent(row.amountSharePercent)}</td>
              <td className="px-3 py-2">{formatIntegerMoney(row.avgOrderAmountYuan)}</td>
              <td className="px-3 py-2">{formatOrderCount(row.returnOrderCount)}</td>
              <td className="px-3 py-2">{formatRatePercent(row.returnRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
