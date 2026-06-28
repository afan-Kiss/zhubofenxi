import React, { useEffect, useMemo } from 'react'
import { OperationsChartCard } from './OperationsChartCard'
import { OperationsBarChart } from './OperationsBarChart'
import { OperationsPieChart } from './OperationsPieChart'
import { OperationsLineChart } from './OperationsLineChart'
import { OperationsChartEmpty } from './OperationsChartEmpty'
import { useOperationsBiDrill } from '../OperationsBiDrillProvider'
import { useChartTopLimit } from './useChartTopLimit'
import {
  buildAfterSalesReasonDrill,
  buildAfterSalesRefundAmountDrill,
  buildAnchorAmountDrill,
  buildAnchorOrdersDrill,
  buildAnchorReturnRateDrill,
  buildDailyAmountDrill,
  buildPriceBandAmountDrill,
  buildPriceBandOrdersDrill,
  buildPriceBandReturnRateDrill,
  buildProductHighReturnDrill,
  buildProductHotDrill,
} from './operationsChartDrill'
import type { OperationsBiDrillContextProps } from '../../../pages/operations/operationsBiDrillTypes'
import type { OperationsRankingsPayload } from '../../../pages/operations/operationsReportTypes'
import { formatChartCount, formatChartMoney } from './operationsChartFormat'
import { warnIfDailyTrendLooksAggregated } from './operationsChartTrendWarn'

type RankingsTab = 'summary' | 'anchors' | 'products' | 'priceBands' | 'afterSales'

interface Props {
  tab: RankingsTab
  data: OperationsRankingsPayload
  drillContext: OperationsBiDrillContextProps
  isSingleDay: boolean
  insightStats?: {
    pending: number
    handled: number
    reviewed: number
    ignored: number
  } | null
}

const CHART_HINT = '点图可以看组成订单。'
const CHART_HEIGHT = 260

export const RankingsTabCharts: React.FC<Props> = ({
  tab,
  data,
  drillContext,
  isSingleDay,
  insightStats,
}) => {
  const { openDrill } = useOperationsBiDrill()
  const topLimit = useChartTopLimit()

  const trendPoints = useMemo(
    () =>
      (data.dailyTrend ?? []).map((d) => ({
        dateKey: d.date,
        dateLabel: d.date,
        amountYuan: d.validAmountYuan,
        orderCount: d.soldOrderCount,
      })),
    [data.dailyTrend],
  )

  useEffect(() => {
    warnIfDailyTrendLooksAggregated(data.dailyTrend ?? [], 'rankings-dailyTrend')
  }, [data.dailyTrend])

  const insightItems = useMemo(() => {
    if (!insightStats) return []
    return [
      { key: 'pending', label: '待处理', value: insightStats.pending },
      { key: 'handled', label: '已处理', value: insightStats.handled },
      { key: 'reviewed', label: '已复盘', value: insightStats.reviewed },
      { key: 'ignored', label: '已忽略', value: insightStats.ignored },
    ].filter((i) => i.value > 0)
  }, [insightStats])

  const summaryPriceBandItems = useMemo(
    () =>
      data.priceBands.byAmount.items
        .slice(0, 5)
        .filter((b) => b.validAmountYuan > 0)
        .map((b) => ({ key: b.bandLabel, label: b.bandLabel, value: b.validAmountYuan })),
    [data.priceBands.byAmount.items],
  )

  const anchorAmountItems = useMemo(
    () =>
      data.anchors.byAmount.items.slice(0, topLimit).map((a) => ({
        key: a.anchorName,
        label: a.anchorName,
        value: a.validAmountYuan,
        fullLabel: a.anchorName,
      })),
    [data.anchors.byAmount.items, topLimit],
  )

  const anchorOrderItems = useMemo(
    () =>
      data.anchors.byOrders.items.slice(0, topLimit).map((a) => ({
        key: a.anchorName,
        label: a.anchorName,
        value: a.soldOrderCount,
        fullLabel: a.anchorName,
      })),
    [data.anchors.byOrders.items, topLimit],
  )

  const anchorReturnItems = useMemo(
    () =>
      data.anchors.byReturnRate.items.slice(0, topLimit).map((a) => ({
        key: a.anchorName,
        label: a.anchorName,
        value: (a.returnRate ?? 0) * 100,
        fullLabel: a.anchorName,
      })),
    [data.anchors.byReturnRate.items, topLimit],
  )

  const hotProductItems = useMemo(
    () =>
      data.products.hot.items.slice(0, topLimit).map((p) => ({
        key: p.productKey,
        label: p.productName,
        value: p.validAmountYuan,
        fullLabel: p.productName,
      })),
    [data.products.hot.items, topLimit],
  )

  const highReturnProductItems = useMemo(
    () =>
      data.products.highReturn.items.slice(0, topLimit).map((p) => ({
        key: p.productKey,
        label: p.productName,
        value: (p.returnRate ?? 0) * 100,
        fullLabel: p.productName,
      })),
    [data.products.highReturn.items, topLimit],
  )

  const hotProductPieItems = useMemo(
    () =>
      data.products.hot.items
        .slice(0, 5)
        .filter((p) => p.validAmountYuan > 0)
        .map((p) => ({
          key: p.productKey,
          label: p.productName,
          value: p.validAmountYuan,
        })),
    [data.products.hot.items],
  )

  const priceBandAmountItems = useMemo(
    () =>
      data.priceBands.byAmount.items
        .filter((b) => b.validAmountYuan > 0)
        .map((b) => ({ key: b.bandLabel, label: b.bandLabel, value: b.validAmountYuan })),
    [data.priceBands.byAmount.items],
  )

  const priceBandOrderItems = useMemo(
    () =>
      data.priceBands.byOrders.items.slice(0, topLimit).map((b) => ({
        key: b.bandLabel,
        label: b.bandLabel,
        value: b.soldOrderCount,
        fullLabel: b.bandLabel,
      })),
    [data.priceBands.byOrders.items, topLimit],
  )

  const priceBandReturnItems = useMemo(
    () =>
      data.priceBands.byReturnRate.items.slice(0, topLimit).map((b) => ({
        key: b.bandLabel,
        label: b.bandLabel,
        value: (b.productReturnOrderRate ?? 0) * 100,
        fullLabel: b.bandLabel,
      })),
    [data.priceBands.byReturnRate.items, topLimit],
  )

  const afterReasonItems = useMemo(
    () =>
      data.afterSales.byReason.items.slice(0, topLimit).map((r) => ({
        key: r.category,
        label: r.categoryLabel,
        value: r.orderCount,
        fullLabel: r.categoryLabel,
      })),
    [data.afterSales.byReason.items, topLimit],
  )

  const afterRefundItems = useMemo(
    () =>
      data.afterSales.byRefundAmount.items.slice(0, topLimit).map((r) => ({
        key: r.category,
        label: r.categoryLabel,
        value: r.refundAmountYuan,
        fullLabel: r.categoryLabel,
      })),
    [data.afterSales.byRefundAmount.items, topLimit],
  )

  const afterReasonPieItems = useMemo(
    () =>
      data.afterSales.byReason.items
        .filter((r) => r.orderCount > 0)
        .map((r) => ({
          key: r.category,
          label: r.categoryLabel,
          value: r.orderCount,
        })),
    [data.afterSales.byReason.items],
  )

  if (tab === 'summary') {
    return (
      <div className="grid grid-cols-1 gap-4" data-operations-rankings-charts="summary">
        <OperationsChartCard
          title="这段时间每天卖得怎么样"
          description="看成交金额是变好、变差，还是某天突然波动。"
          hint={CHART_HINT}
        >
          {isSingleDay ? (
            <OperationsChartEmpty message="当前只选了一天，走势先不用看。" />
          ) : (
            <OperationsLineChart
              points={trendPoints}
              height={CHART_HEIGHT}
              emptyMessage="暂无数据，先不用看这个图。"
              onPointClick={(p) => openDrill(buildDailyAmountDrill(drillContext, p.dateKey))}
            />
          )}
        </OperationsChartCard>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <OperationsChartCard
            title="经营建议处理得怎么样"
            description="看建议是处理了、复盘了，还是还没动。"
          >
            {insightItems.length === 0 ? (
              <OperationsChartEmpty message="暂无数据，先不用看这个图。" />
            ) : (
              <OperationsPieChart
                items={insightItems}
                valueFormatter={formatChartCount}
                height={CHART_HEIGHT}
              />
            )}
          </OperationsChartCard>

          <OperationsChartCard
            title="钱主要来自哪些价位"
            description="看成交金额集中在哪些价位上。"
            hint={CHART_HINT}
          >
            <OperationsPieChart
              items={summaryPriceBandItems}
              height={CHART_HEIGHT}
              emptyMessage="暂无数据，先不用看这个图。"
              onItemClick={(item) =>
                openDrill(buildPriceBandAmountDrill(drillContext, item.label))
              }
            />
          </OperationsChartCard>
        </div>
      </div>
    )
  }

  if (tab === 'anchors') {
    return (
      <div
        className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        data-operations-rankings-charts="anchors"
      >
        <OperationsChartCard
          title="哪些主播成交高"
          description="按有效成交金额排序。"
          hint={CHART_HINT}
        >
          <OperationsBarChart
            items={anchorAmountItems}
            height={CHART_HEIGHT}
            emptyMessage="暂无数据，先不用看这个图。"
            onItemClick={(item) => openDrill(buildAnchorAmountDrill(drillContext, item.label))}
          />
        </OperationsChartCard>

        <OperationsChartCard
          title="哪些主播出单多"
          description="按成交订单数排序。"
          hint={CHART_HINT}
        >
          <OperationsBarChart
            items={anchorOrderItems}
            height={CHART_HEIGHT}
            valueFormatter={formatChartCount}
            emptyMessage="暂无数据，先不用看这个图。"
            onItemClick={(item) => openDrill(buildAnchorOrdersDrill(drillContext, item.label))}
          />
        </OperationsChartCard>

        <div className="lg:col-span-2">
          <OperationsChartCard
            title="哪些主播退货偏高"
            description="只看样本够的正式榜，样本太少别直接下结论。"
            hint={CHART_HINT}
          >
            {anchorReturnItems.length === 0 ? (
              <OperationsChartEmpty message="暂无样本足够的主播退货排行。" />
            ) : (
              <OperationsBarChart
                items={anchorReturnItems}
                height={CHART_HEIGHT}
                valueFormatter={(v) => `${v.toFixed(1)}%`}
                emptyMessage="暂无数据，先不用看这个图。"
                onItemClick={(item) =>
                  openDrill(buildAnchorReturnRateDrill(drillContext, item.label))
                }
              />
            )}
          </OperationsChartCard>
        </div>
      </div>
    )
  }

  if (tab === 'products') {
    return (
      <div
        className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        data-operations-rankings-charts="products"
      >
        <OperationsChartCard title="哪些商品卖得好" description="按有效成交金额排序。" hint={CHART_HINT}>
          <OperationsBarChart
            items={hotProductItems}
            height={CHART_HEIGHT}
            emptyMessage="暂无数据，先不用看这个图。"
            onItemClick={(item) =>
              openDrill(buildProductHotDrill(drillContext, item.key, item.fullLabel))
            }
          />
        </OperationsChartCard>

        <OperationsChartCard title="哪些商品退货偏高" description="按退货率排序。" hint={CHART_HINT}>
          <OperationsBarChart
            items={highReturnProductItems}
            height={CHART_HEIGHT}
            valueFormatter={(v) => `${v.toFixed(1)}%`}
            emptyMessage="暂无数据，先不用看这个图。"
            onItemClick={(item) =>
              openDrill(buildProductHighReturnDrill(drillContext, item.key, item.fullLabel))
            }
          />
        </OperationsChartCard>

        <div className="lg:col-span-2">
          <OperationsChartCard
            title="成交主要靠哪些商品"
            description="看成交金额集中在哪些商品上。"
            hint={CHART_HINT}
          >
            <OperationsPieChart
              items={hotProductPieItems}
              height={CHART_HEIGHT}
              emptyMessage="暂无数据，先不用看这个图。"
              onItemClick={(item) =>
                openDrill(buildProductHotDrill(drillContext, item.key, item.label))
              }
            />
          </OperationsChartCard>
        </div>
      </div>
    )
  }

  if (tab === 'priceBands') {
    return (
      <div
        className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        data-operations-rankings-charts="priceBands"
      >
        <OperationsChartCard title="钱主要来自哪些价位" description="看成交金额集中在哪些价位上。" hint={CHART_HINT}>
          <OperationsPieChart
            items={priceBandAmountItems}
            height={CHART_HEIGHT}
            emptyMessage="暂无数据，先不用看这个图。"
            onItemClick={(item) => openDrill(buildPriceBandAmountDrill(drillContext, item.label))}
          />
        </OperationsChartCard>

        <OperationsChartCard title="哪些价位出单多" description="按成交订单数排序。" hint={CHART_HINT}>
          <OperationsBarChart
            items={priceBandOrderItems}
            height={CHART_HEIGHT}
            valueFormatter={formatChartCount}
            emptyMessage="暂无数据，先不用看这个图。"
            onItemClick={(item) =>
              openDrill(buildPriceBandOrdersDrill(drillContext, item.label))
            }
          />
        </OperationsChartCard>

        <div className="lg:col-span-2">
          <OperationsChartCard title="哪些价位退货偏高" description="按退货率排序。" hint={CHART_HINT}>
            <OperationsBarChart
              items={priceBandReturnItems}
              height={CHART_HEIGHT}
              valueFormatter={(v) => `${v.toFixed(1)}%`}
              emptyMessage="暂无数据，先不用看这个图。"
              onItemClick={(item) =>
                openDrill(buildPriceBandReturnRateDrill(drillContext, item.label))
              }
            />
          </OperationsChartCard>
        </div>
      </div>
    )
  }

  if (tab === 'afterSales') {
    return (
      <div
        className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        data-operations-rankings-charts="afterSales"
      >
        <OperationsChartCard
          title="顾客主要因为什么不满意"
          description="按售后订单数排序。"
          hint={CHART_HINT}
        >
          <OperationsBarChart
            items={afterReasonItems}
            height={CHART_HEIGHT}
            valueFormatter={formatChartCount}
            emptyMessage="暂无数据，先不用看这个图。"
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

        <OperationsChartCard title="哪些问题退款金额高" description="按退款金额排序。" hint={CHART_HINT}>
          <OperationsBarChart
            items={afterRefundItems}
            height={CHART_HEIGHT}
            valueFormatter={formatChartMoney}
            emptyMessage="暂无数据，先不用看这个图。"
            onItemClick={(item) =>
              openDrill(
                buildAfterSalesRefundAmountDrill(
                  drillContext,
                  item.key,
                  item.fullLabel ?? item.label,
                ),
              )
            }
          />
        </OperationsChartCard>

        <div className="lg:col-span-2">
          <OperationsChartCard
            title="售后问题主要集中在哪"
            description="看售后订单主要集中在哪些原因。"
            hint={CHART_HINT}
          >
            <OperationsPieChart
              items={afterReasonPieItems}
              height={CHART_HEIGHT}
              mergeTop={5}
              valueFormatter={formatChartCount}
              emptyMessage="暂无数据，先不用看这个图。"
              onItemClick={(item) =>
                openDrill(
                  buildAfterSalesReasonDrill(
                    drillContext,
                    item.key,
                    item.label,
                  ),
                )
              }
            />
          </OperationsChartCard>
        </div>
      </div>
    )
  }

  return null
}

export { RankingsTabCharts as RankingsTabChart }
