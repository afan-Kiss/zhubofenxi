import React, { useMemo } from 'react'
import { OperationsChartCard } from './OperationsChartCard'
import { OperationsBarChart } from './OperationsBarChart'
import { OperationsPieChart } from './OperationsPieChart'
import { useOperationsBiDrill } from '../OperationsBiDrillProvider'
import { useChartTopLimit } from './useChartTopLimit'
import {
  buildAfterSalesReasonDrill,
  buildAnchorAmountDrill,
  buildPriceBandAmountDrill,
  buildProductHotDrill,
} from './operationsChartDrill'
import type { OperationsBiDrillContextProps } from '../../../pages/operations/operationsBiDrillTypes'
import type { OperationsRankingsPayload } from '../../../pages/operations/operationsReportTypes'
import { formatChartCount } from './operationsChartFormat'

type RankingsTab = 'summary' | 'anchors' | 'products' | 'priceBands' | 'afterSales'

interface Props {
  tab: RankingsTab
  data: OperationsRankingsPayload
  drillContext: OperationsBiDrillContextProps
  insightStats?: {
    pending: number
    handled: number
    reviewed: number
    ignored: number
  } | null
}

export const RankingsTabChart: React.FC<Props> = ({ tab, data, drillContext, insightStats }) => {
  const { openDrill } = useOperationsBiDrill()
  const topLimit = useChartTopLimit()

  const anchorItems = useMemo(
    () =>
      data.anchors.byAmount.items.slice(0, topLimit).map((a) => ({
        key: a.anchorName,
        label: a.anchorName,
        value: a.validAmountYuan,
        fullLabel: a.anchorName,
      })),
    [data.anchors.byAmount.items, topLimit],
  )

  const productItems = useMemo(
    () =>
      data.products.hot.items.slice(0, topLimit).map((p) => ({
        key: p.productKey,
        label: p.productName,
        value: p.validAmountYuan,
        fullLabel: p.productName,
      })),
    [data.products.hot.items, topLimit],
  )

  const priceBandItems = useMemo(
    () =>
      data.priceBands.byAmount.items
        .filter((b) => b.validAmountYuan > 0)
        .map((b) => ({ key: b.bandLabel, label: b.bandLabel, value: b.validAmountYuan })),
    [data.priceBands.byAmount.items],
  )

  const afterItems = useMemo(
    () =>
      data.afterSales.byReason.items.slice(0, topLimit).map((r) => ({
        key: r.category,
        label: r.categoryLabel,
        value: r.orderCount,
        fullLabel: r.categoryLabel,
      })),
    [data.afterSales.byReason.items, topLimit],
  )

  const insightItems = useMemo(() => {
    if (!insightStats) return []
    return [
      { key: 'pending', label: '待处理', value: insightStats.pending },
      { key: 'handled', label: '已处理', value: insightStats.handled },
      { key: 'reviewed', label: '已复盘', value: insightStats.reviewed },
      { key: 'ignored', label: '已忽略', value: insightStats.ignored },
    ].filter((i) => i.value > 0)
  }, [insightStats])

  if (tab === 'summary') {
    if (insightItems.length === 0) return null
    return (
      <OperationsChartCard title="各类建议处理情况" description="看经营建议处理进度。">
        <OperationsPieChart items={insightItems} valueFormatter={formatChartCount} />
      </OperationsChartCard>
    )
  }

  if (tab === 'anchors') {
    return (
      <OperationsChartCard
        title="主播成交排行"
        description="按有效成交金额排序。"
        hint="点柱子可以看组成订单"
      >
        <OperationsBarChart
          items={anchorItems}
          onItemClick={(item) => openDrill(buildAnchorAmountDrill(drillContext, item.label))}
        />
      </OperationsChartCard>
    )
  }

  if (tab === 'products') {
    return (
      <OperationsChartCard
        title="商品成交排行"
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
    )
  }

  if (tab === 'priceBands') {
    return (
      <OperationsChartCard
        title="价位成交占比"
        description="看钱主要从哪个价位来。"
        hint="点扇形可以看这个价位的订单"
      >
        <OperationsPieChart
          items={priceBandItems}
          onItemClick={(item) => openDrill(buildPriceBandAmountDrill(drillContext, item.label))}
        />
      </OperationsChartCard>
    )
  }

  if (tab === 'afterSales') {
    return (
      <OperationsChartCard
        title="售后原因排行"
        description="看售后问题集中在哪里。"
        hint="点柱子可以看对应订单"
      >
        <OperationsBarChart
          items={afterItems}
          valueFormatter={formatChartCount}
          onItemClick={(item) =>
            openDrill(
              buildAfterSalesReasonDrill(
                drillContext,
                item.key,
                item.fullLabel ?? item.label,
              ),
            )
          }
        />
      </OperationsChartCard>
    )
  }

  return null
}
