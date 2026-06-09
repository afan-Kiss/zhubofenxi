import React from 'react'
import type { AnalyzedOrderView } from '../types/business'
import { formatCentToMoney } from '../lib/businessAnalyzer'
import { getAttributionTypeLabel } from '../lib/orderAttribution'

interface AttributionDiagnosticsPanelProps {
  orders: AnalyzedOrderView[]
  abnormalOrders: AnalyzedOrderView[]
}

export const AttributionDiagnosticsPanel: React.FC<AttributionDiagnosticsPanelProps> = ({
  orders,
  abnormalOrders,
}) => {
  const all = [...orders, ...abnormalOrders]

  return (
    <div className="xhs-scroll max-h-[180px] overflow-y-auto rounded-lg border border-slate-100 bg-white">
      <table className="w-full text-[9px]">
        <thead className="sticky top-0 bg-slate-50 text-slate-500">
          <tr>
            <th className="px-1 py-1 text-left">订单号</th>
            <th className="text-left">下单时间</th>
            <th className="text-left">主播</th>
            <th className="text-left">方式</th>
            <th className="text-left">规则/场次</th>
            <th className="text-left">GMV</th>
            <th className="text-left">异常</th>
          </tr>
        </thead>
        <tbody>
          {all.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-2 py-4 text-center text-slate-400">
                完成分析后可查看归属诊断
              </td>
            </tr>
          ) : (
            all.slice(0, 200).map((o) => (
              <tr key={`${o.orderId}-${o.sourceRowIndex}`} className="border-t border-slate-50">
                <td className="max-w-[72px] truncate px-1 py-0.5">{o.orderId}</td>
                <td className="whitespace-nowrap px-1">{o.orderTimeText}</td>
                <td className="px-1">{o.anchorName}</td>
                <td className="px-1">{getAttributionTypeLabel(o.attributionType)}</td>
                <td className="max-w-[100px] truncate px-1" title={o.matchedRuleName ?? o.matchedLiveSessionId}>
                  {o.matchedRuleName ??
                    (o.matchedLiveStartTime
                      ? `${o.matchedLiveStartTime} ~ ${o.matchedLiveEndTime}`
                      : '—')}
                </td>
                <td className="px-1">{formatCentToMoney(o.gmvCent)}</td>
                <td className="max-w-[80px] truncate px-1 text-amber-600">
                  {(o.attributionWarning ?? o.errors.join('；')) || '—'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
