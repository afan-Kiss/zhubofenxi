import React from 'react'
import type { ProductRankListItem } from '../../pages/operations/operationsReportTypes'
import type {
  OperationsBiDrillContextProps,
  OperationsBiDrillTarget,
} from '../../pages/operations/operationsBiDrillTypes'
import { OperationsBiDrillLinkButton } from './OperationsBiDrillProvider'
import {
  formatIntegerMoney,
  formatOrderCount,
  formatPeopleCount,
  formatRatePercent,
} from './operationsReportFormatters'

interface Props {
  rows: ProductRankListItem[]
  drillContext?: OperationsBiDrillContextProps
  drillTarget?: OperationsBiDrillTarget
}

export const ProductRankingTable: React.FC<Props> = ({
  rows,
  drillContext,
  drillTarget = 'product_amount',
}) => {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">暂无数据</p>
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-[1300px] w-full text-left text-xs">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2">店铺</th>
            <th className="px-3 py-2">货号</th>
            <th className="px-3 py-2">商品</th>
            <th className="px-3 py-2">规格</th>
            <th className="px-3 py-2">圈口</th>
            <th className="px-3 py-2">条型</th>
            <th className="px-3 py-2">商品角色</th>
            <th className="px-3 py-2">成交金额</th>
            <th className="px-3 py-2">成交订单</th>
            <th className="px-3 py-2">支付订单</th>
            <th className="px-3 py-2">成交件数</th>
            <th className="px-3 py-2">买家数</th>
            <th className="px-3 py-2">客单价</th>
            <th className="px-3 py-2">退货订单</th>
            <th className="px-3 py-2">退货率</th>
            <th className="px-3 py-2">说明</th>
            {drillContext ? <th className="px-3 py-2">操作</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.productKey} className="border-t border-slate-100">
              <td className="px-3 py-2">{row.shopName}</td>
              <td className="px-3 py-2">{row.productCode || '—'}</td>
              <td className="px-3 py-2 font-medium">{row.productName}</td>
              <td className="px-3 py-2">{row.skuName || '—'}</td>
              <td className="px-3 py-2">{row.ringSize}</td>
              <td className="px-3 py-2">{row.barType}</td>
              <td className="px-3 py-2">{row.productRoleLabel}</td>
              <td className="px-3 py-2">{formatIntegerMoney(row.validAmountYuan)}</td>
              <td className="px-3 py-2">{formatOrderCount(row.soldOrderCount)}</td>
              <td className="px-3 py-2">{formatOrderCount(row.paidOrderCount)}</td>
              <td className="px-3 py-2">{formatOrderCount(row.soldCount)}</td>
              <td className="px-3 py-2">{formatPeopleCount(row.buyerCount)}</td>
              <td className="px-3 py-2">{formatIntegerMoney(row.averageOrderValueYuan)}</td>
              <td className="px-3 py-2">{formatOrderCount(row.returnOrderCount)}</td>
              <td className="px-3 py-2">{formatRatePercent(row.returnRate)}</td>
              <td className="px-3 py-2 text-slate-500">{row.rankReason}</td>
              {drillContext ? (
                <td className="px-3 py-2">
                  <OperationsBiDrillLinkButton
                    request={{
                      ...drillContext,
                      source: 'product_ranking',
                      target: drillTarget,
                      productKey: row.productKey,
                      productName: row.productName,
                      skuName: row.skuName,
                    }}
                  />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
