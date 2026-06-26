import React, { useMemo, useState } from 'react'
import { OperationsChartCard } from './OperationsChartCard'
import { OperationsBarChart } from './OperationsBarChart'
import { OperationsPieChart } from './OperationsPieChart'
import { OperationsLineChart } from './OperationsLineChart'
import { useOperationsBiDrill } from '../OperationsBiDrillProvider'
import { useChartTopLimit } from './useChartTopLimit'
import {
  buildAnchorAmountDrill,
  buildDailyAmountDrill,
  buildPriceBandAmountDrill,
  buildProductHotDrill,
} from './operationsChartDrill'
import type { OperationsBiDrillContextProps } from '../../../pages/operations/operationsBiDrillTypes'
import type {
  OperationsPriceBandRow,
  WeeklyDailyTrendRow,
  WeeklyOperationsReportPayload,
} from '../../../pages/operations/operationsReportTypes'

interface Props {
  drillContext: OperationsBiDrillContextProps
  dailyTrend: WeeklyDailyTrendRow[]
  anchors: WeeklyOperationsReportPayload['anchors']
  hotProducts: WeeklyOperationsReportPayload['hotProducts']
  priceBands: OperationsPriceBandRow[]
}

export const WeeklyReportCharts: React.FC<Props> = ({
  drillContext,
  dailyTrend,
  anchors,
  hotProducts,
  priceBands,
}) => {
  const { openDrill } = useOperationsBiDrill()
  const topLimit = useChartTopLimit()

  const trendPoints = useMemo(
    () =>
      dailyTrend.map((d) => ({
        dateKey: d.dateKey,
        dateLabel: d.dateLabel,
        amountYuan: d.validAmountYuan,
        orderCount: d.soldOrderCount,
      })),
    [dailyTrend],
  )

  const anchorItems = useMemo(
    () =>
      [...anchors]
        .sort((a, b) => b.validAmountYuan - a.validAmountYuan)
        .slice(0, topLimit)
        .map((a) => ({
          key: a.anchorName,
          label: a.anchorName,
          value: a.validAmountYuan,
          fullLabel: a.anchorName,
        })),
    [anchors, topLimit],
  )

  const productItems = useMemo(
    () =>
      [...hotProducts]
        .sort((a, b) => (b.validAmountYuan ?? b.soldAmountYuan) - (a.validAmountYuan ?? a.soldAmountYuan))
        .slice(0, topLimit)
        .map((p) => ({
          key: p.productKey,
          label: p.productName,
          value: p.validAmountYuan ?? p.soldAmountYuan,
          fullLabel: p.productName,
        })),
    [hotProducts, topLimit],
  )

  const priceBandItems = useMemo(
    () =>
      priceBands
        .filter((b) => b.amountYuan > 0)
        .map((b) => ({ key: b.bandLabel, label: b.bandLabel, value: b.amountYuan })),
    [priceBands],
  )

  return (
    <div className="grid gap-4">
      <OperationsChartCard
        title="本周每天卖得怎么样"
        description="看这一周成交金额是变好、变差，还是某天突然波动。"
        hint="手机上可以左右滑动查看更多。"
      >
        <OperationsLineChart
          points={trendPoints}
          onPointClick={(p) => openDrill(buildDailyAmountDrill(drillContext, p.dateKey))}
        />
      </OperationsChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <OperationsChartCard
          title="本周哪些主播成交高"
          description="按有效成交金额排序。"
          hint="点柱子可以看组成订单"
        >
          <OperationsBarChart
            items={anchorItems}
            onItemClick={(item) => openDrill(buildAnchorAmountDrill(drillContext, item.label))}
          />
        </OperationsChartCard>

        <OperationsChartCard
          title="本周哪些商品卖得好"
          description="按有效成交金额排序。"
          hint="点柱子可以看组成订单"
        >
          <OperationsBarChart
            items={productItems}
            onItemClick={(item) =>
              openDrill(buildProductHotDrill(drillContext, item.key, item.fullLabel))
            }
          />
        </OperationsChartCard>

        <OperationsChartCard
          title="本周钱主要来自哪些价位"
          description="看钱主要从哪个价位来。"
          hint="点扇形可以看这个价位的订单"
        >
          <OperationsPieChart
            items={priceBandItems}
            onItemClick={(item) => openDrill(buildPriceBandAmountDrill(drillContext, item.label))}
          />
        </OperationsChartCard>
      </div>
    </div>
  )
}
