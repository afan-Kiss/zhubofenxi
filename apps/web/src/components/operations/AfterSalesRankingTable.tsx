import React from 'react'
import type { AfterSalesRankItem } from '../../pages/operations/operationsReportTypes'
import { formatIntegerMoney, formatOrderCount, formatPercent } from './operationsReportFormatters'

interface Props {
  rows: AfterSalesRankItem[]
}

export const AfterSalesRankingTable: React.FC<Props> = ({ rows }) => {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">暂无数据</p>
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-[640px] w-full text-left text-xs">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2">售后原因</th>
            <th className="px-3 py-2">订单数</th>
            <th className="px-3 py-2">退款金额</th>
            <th className="px-3 py-2">占比</th>
            <th className="px-3 py-2">说明</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.category} className="border-t border-slate-100">
              <td className="px-3 py-2 font-medium">{row.categoryLabel}</td>
              <td className="px-3 py-2">{formatOrderCount(row.orderCount)}</td>
              <td className="px-3 py-2">{formatIntegerMoney(row.refundAmountYuan)}</td>
              <td className="px-3 py-2">{formatPercent(row.sharePercent)}</td>
              <td className="px-3 py-2 text-slate-500">{row.rankReason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
