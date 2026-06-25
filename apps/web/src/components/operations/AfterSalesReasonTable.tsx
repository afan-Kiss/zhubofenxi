import React from 'react'
import type { AfterSalesReasonRow } from '../../pages/operations/operationsReportTypes'
import { formatIntegerMoney, formatOrderCount, formatPercent } from './operationsReportFormatters'

interface Props {
  rows: AfterSalesReasonRow[]
}

export const AfterSalesReasonTable: React.FC<Props> = ({ rows }) => {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">暂无售后原因数据</p>
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-[560px] w-full text-left text-xs">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2">原因分类</th>
            <th className="px-3 py-2">订单数</th>
            <th className="px-3 py-2">退款金额</th>
            <th className="px-3 py-2">占比</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.category} className="border-t border-slate-100">
              <td className="px-3 py-2 font-medium text-slate-900">{row.categoryLabel}</td>
              <td className="px-3 py-2">{formatOrderCount(row.orderCount)}</td>
              <td className="px-3 py-2">{formatIntegerMoney(row.refundAmountYuan)}</td>
              <td className="px-3 py-2">{formatPercent(row.sharePercent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
