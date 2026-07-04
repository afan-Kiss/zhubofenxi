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
  showDrill?: boolean
}

export const AnchorRankingTable: React.FC<Props> = ({
  rows,
  drillContext,
  drillTarget = 'anchor_amount',
  showDrill = true,
}) => {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">暂无数据</p>
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-[1200px] w-full text-left text-xs">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2">主播</th>
            <th className="px-3 py-2">店铺</th>
            <th className="px-3 py-2">成交金额</th>
            <th className="px-3 py-2">成交订单</th>
            <th className="px-3 py-2">支付订单</th>
            <th className="px-3 py-2">客单价</th>
            <th className="px-3 py-2">退货订单</th>
            <th className="px-3 py-2">退货率</th>
            <th className="px-3 py-2">直播时长</th>
            <th className="px-3 py-2">每小时成交</th>
            <th className="px-3 py-2">场观</th>
            <th className="px-3 py-2">进房</th>
            <th className="px-3 py-2">成交人数</th>
            <th className="px-3 py-2">成交率</th>
            <th className="px-3 py-2">新增粉丝</th>
            <th className="px-3 py-2">粉丝转化率</th>
            <th className="px-3 py-2">上榜原因</th>
            {drillContext && showDrill ? <th className="px-3 py-2">操作</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.anchorName} className="border-t border-slate-100">
              <td className="px-3 py-2 font-medium">{row.anchorName}</td>
              <td className="px-3 py-2 text-slate-600">{row.shopName}</td>
              <td className="px-3 py-2">{formatIntegerMoney(row.validAmountYuan)}</td>
              <td className="px-3 py-2">{formatOrderCount(row.soldOrderCount)}</td>
              <td className="px-3 py-2">{formatOrderCount(row.paidOrderCount)}</td>
              <td className="px-3 py-2">{formatIntegerMoney(row.averageOrderValueYuan)}</td>
              <td className="px-3 py-2">{formatOrderCount(row.returnOrderCount)}</td>
              <td className="px-3 py-2">{formatRatePercent(row.returnRate)}</td>
              <td className="px-3 py-2">{row.liveDurationMinutes}分</td>
              <td className="px-3 py-2">{formatHourly(row.hourlyAmountYuan)}</td>
              <td className="px-3 py-2">{formatPeopleCount(row.viewSessionCount)}</td>
              <td className="px-3 py-2">{formatPeopleCount(row.joinUserCount)}</td>
              <td className="px-3 py-2">{formatPeopleCount(row.dealUserCount)}</td>
              <td className="px-3 py-2">{formatRatePercent(row.dealConversionRate)}</td>
              <td className="px-3 py-2">{formatPeopleCount(row.newFollowerCount)}</td>
              <td className="px-3 py-2">{formatRatePercent(row.followerConversionRate)}</td>
              <td className="px-3 py-2 text-slate-500">{row.rankReason}</td>
              {drillContext && showDrill ? (
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
