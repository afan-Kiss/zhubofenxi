import React from 'react'
import type { AnchorRankItem } from '../../pages/operations/operationsReportTypes'
import type {
  OperationsBiDrillContextProps,
  OperationsBiDrillTarget,
} from '../../pages/operations/operationsBiDrillTypes'
import { OperationsBiDrillLinkButton } from './OperationsBiDrillProvider'
import {
  formatHourly,
  formatIntegerMoney,
  formatOrderCount,
  formatPeopleCount,
  formatRatePercent,
} from './operationsReportFormatters'

interface Props {
  rows: AnchorRankItem[]
  drillContext?: OperationsBiDrillContextProps
  drillTarget?: OperationsBiDrillTarget
}

export const AnchorRankingTable: React.FC<Props> = ({
  rows,
  drillContext,
  drillTarget = 'anchor_amount',
}) => {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">暂无数据</p>
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-[1000px] w-full text-left text-xs">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2">主播</th>
            <th className="px-3 py-2">店铺</th>
            <th className="px-3 py-2">成交金额</th>
            <th className="px-3 py-2">成交订单</th>
            <th className="px-3 py-2">退货订单</th>
            <th className="px-3 py-2">退货率</th>
            <th className="px-3 py-2">直播时长</th>
            <th className="px-3 py-2">每小时成交</th>
            <th className="px-3 py-2">成交人数</th>
            <th className="px-3 py-2">成交率</th>
            <th className="px-3 py-2">新增粉丝</th>
            <th className="px-3 py-2">上榜原因</th>
            {drillContext ? <th className="px-3 py-2">操作</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.anchorName} className="border-t border-slate-100">
              <td className="px-3 py-2 font-medium">{row.anchorName}</td>
              <td className="px-3 py-2 text-slate-600">{row.shopName}</td>
              <td className="px-3 py-2">{formatIntegerMoney(row.validAmountYuan)}</td>
              <td className="px-3 py-2">{formatOrderCount(row.soldOrderCount)}</td>
              <td className="px-3 py-2">{formatOrderCount(row.returnOrderCount)}</td>
              <td className="px-3 py-2">{formatRatePercent(row.returnRate)}</td>
              <td className="px-3 py-2">{row.liveDurationMinutes}分</td>
              <td className="px-3 py-2">{formatHourly(row.hourlyAmountYuan)}</td>
              <td className="px-3 py-2">{formatPeopleCount(row.dealUserCount)}</td>
              <td className="px-3 py-2">{formatRatePercent(row.dealConversionRate)}</td>
              <td className="px-3 py-2">{formatPeopleCount(row.newFollowerCount)}</td>
              <td className="px-3 py-2 text-slate-500">{row.rankReason}</td>
              {drillContext ? (
                <td className="px-3 py-2">
                  <OperationsBiDrillLinkButton
                    request={{
                      ...drillContext,
                      source: 'anchor_ranking',
                      target: drillTarget,
                      anchorName: row.anchorName,
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
