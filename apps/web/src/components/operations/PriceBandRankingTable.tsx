import React from 'react'
import type { PriceBandRankItem } from '../../pages/operations/operationsReportTypes'
import type {
  OperationsBiDrillContextProps,
  OperationsBiDrillTarget,
} from '../../pages/operations/operationsBiDrillTypes'
import { OperationsBiDrillLinkButton } from './OperationsBiDrillProvider'
import {
  formatIntegerMoney,
  formatOrderCount,
  formatPercent,
  formatRatePercent,
} from './operationsReportFormatters'

interface Props {
  rows: PriceBandRankItem[]
  drillContext?: OperationsBiDrillContextProps
  drillTarget?: OperationsBiDrillTarget
}

export const PriceBandRankingTable: React.FC<Props> = ({
  rows,
  drillContext,
  drillTarget = 'price_band_amount',
}) => {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">暂无数据</p>
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-[800px] w-full text-left text-xs">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2">价格带</th>
            <th className="px-3 py-2">成交金额</th>
            <th className="px-3 py-2">成交订单</th>
            <th className="px-3 py-2">占比</th>
            <th className="px-3 py-2">客单价</th>
            <th className="px-3 py-2">退货订单</th>
            <th className="px-3 py-2">商品退货订单率</th>
            <th className="px-3 py-2">说明</th>
            {drillContext ? <th className="px-3 py-2">操作</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.bandLabel} className="border-t border-slate-100">
              <td className="px-3 py-2 font-medium">{row.bandLabel}</td>
              <td className="px-3 py-2">{formatIntegerMoney(row.validAmountYuan)}</td>
              <td className="px-3 py-2">{formatOrderCount(row.soldOrderCount)}</td>
              <td className="px-3 py-2">{formatPercent(row.amountSharePercent)}</td>
              <td className="px-3 py-2">{formatIntegerMoney(row.averageOrderValueYuan)}</td>
              <td className="px-3 py-2">{formatOrderCount(row.productReturnOrderCount)}</td>
              <td className="px-3 py-2">{formatRatePercent(row.productReturnOrderRate)}</td>
              <td className="px-3 py-2 text-slate-500">{row.rankReason}</td>
              {drillContext ? (
                <td className="px-3 py-2">
                  <OperationsBiDrillLinkButton
                    request={{
                      ...drillContext,
                      source: 'price_band_ranking',
                      target: drillTarget,
                      priceBandLabel: row.bandLabel,
                      priceBandKey: row.bandLabel,
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
