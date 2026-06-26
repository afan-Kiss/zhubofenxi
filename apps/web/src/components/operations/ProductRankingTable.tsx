import React from 'react'
import type { ProductRankListItem } from '../../pages/operations/operationsReportTypes'
import {
  formatIntegerMoney,
  formatOrderCount,
  formatRatePercent,
} from './operationsReportFormatters'

interface Props {
  rows: ProductRankListItem[]
}

export const ProductRankingTable: React.FC<Props> = ({ rows }) => {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">暂无数据</p>
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-[1100px] w-full text-left text-xs">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2">店铺</th>
            <th className="px-3 py-2">商品</th>
            <th className="px-3 py-2">规格</th>
            <th className="px-3 py-2">圈口</th>
            <th className="px-3 py-2">条型</th>
            <th className="px-3 py-2">成交金额</th>
            <th className="px-3 py-2">成交订单</th>
            <th className="px-3 py-2">成交件数</th>
            <th className="px-3 py-2">客单价</th>
            <th className="px-3 py-2">退货订单</th>
            <th className="px-3 py-2">退货率</th>
            <th className="px-3 py-2">说明</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.productKey} className="border-t border-slate-100">
              <td className="px-3 py-2">{row.shopName}</td>
              <td className="px-3 py-2 font-medium">{row.productName}</td>
              <td className="px-3 py-2">{row.skuName || '—'}</td>
              <td className="px-3 py-2">{row.ringSize}</td>
              <td className="px-3 py-2">{row.barType}</td>
              <td className="px-3 py-2">{formatIntegerMoney(row.validAmountYuan)}</td>
              <td className="px-3 py-2">{formatOrderCount(row.soldOrderCount)}</td>
              <td className="px-3 py-2">{formatOrderCount(row.soldCount)}</td>
              <td className="px-3 py-2">{formatIntegerMoney(row.averageOrderValueYuan)}</td>
              <td className="px-3 py-2">{formatOrderCount(row.returnOrderCount)}</td>
              <td className="px-3 py-2">{formatRatePercent(row.returnRate)}</td>
              <td className="px-3 py-2 text-slate-500">{row.rankReason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
