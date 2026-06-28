import React, { useEffect, useMemo } from 'react'
import { OperationsChartCard } from './OperationsChartCard'
import { OperationsBarChart } from './OperationsBarChart'
import { OperationsPieChart } from './OperationsPieChart'
import { OperationsLineChart } from './OperationsLineChart'
import { useOperationsBiDrill } from '../OperationsBiDrillProvider'
import { useChartTopLimit } from './useChartTopLimit'
import {
  buildAfterSalesReasonDrill,
  buildAnchorAmountDrill,
  buildDailyAmountDrill,
  buildPriceBandAmountDrill,
  buildProductHotDrill,
} from './operationsChartDrill'
import type { OperationsBiDrillContextProps } from '../../../pages/operations/operationsBiDrillTypes'
import type { MonthlyOperationsReportPayload } from '../../../pages/operations/operationsReportTypes'
import { formatChartCount } from './operationsChartFormat'
import { warnIfDailyTrendLooksAggregated } from './operationsChartTrendWarn'

interface Props {
  drillContext: OperationsBiDrillContextProps
  report: MonthlyOperationsReportPayload
}

export const MonthlyReportCharts: React.FC<Props> = ({ drillContext, report }) => {
  const { openDrill } = useOperationsBiDrill()
  const topLimit = useChartTopLimit()

  const trendPoints = useMemo(
    () =>
      report.dailyTrend.map((d) => ({
        dateKey: d.date,
        dateLabel: d.date,
        amountYuan: d.validAmountYuan,
        orderCount: d.soldOrderCount,
      })),
    [report.dailyTrend],
  )

  useEffect(() => {
    warnIfDailyTrendLooksAggregated(report.dailyTrend, 'monthly-dailyTrend')
  }, [report.dailyTrend])

  const anchorItems = useMemo(
    () =>
      [...report.rankings.anchors.byAmount.items]
        .slice(0, topLimit)
        .map((a) => ({
          key: a.anchorName,
          label: a.anchorName,
          value: a.validAmountYuan,
          fullLabel: a.anchorName,
        })),
    [report.rankings.anchors.byAmount.items, topLimit],
  )

  const productItems = useMemo(
    () =>
      [...report.rankings.products.hot.items]
        .slice(0, topLimit)
        .map((p) => ({
          key: p.productKey,
          label: p.productName,
          value: p.validAmountYuan,
          fullLabel: p.productName,
        })),
    [report.rankings.products.hot.items, topLimit],
  )

  const priceBandItems = useMemo(
    () =>
      report.rankings.priceBands.byAmount.items
        .filter((b) => b.validAmountYuan > 0)
        .map((b) => ({ key: b.bandLabel, label: b.bandLabel, value: b.validAmountYuan })),
    [report.rankings.priceBands.byAmount.items],
  )

  const afterItems = useMemo(() => {
    const items = report.rankings.afterSales.byReason.items
    if (items.length > 5) {
      return items.slice(0, topLimit).map((r) => ({
        key: r.category,
        label: r.categoryLabel,
        value: r.orderCount,
        fullLabel: r.categoryLabel,
      }))
    }
    return items.map((r) => ({
      key: r.category,
      label: r.categoryLabel,
      value: r.orderCount,
      fullLabel: r.categoryLabel,
    }))
  }, [report.rankings.afterSales.byReason.items, topLimit])

  const useBarForAfterSales = report.rankings.afterSales.byReason.items.length > 5

  return (
    <div className="grid gap-4">
      <OperationsChartCard
        title="本月每天卖得怎么样"
        description="看这个月成交走势，找出高峰和低谷。"
      >
        <OperationsLineChart
          points={trendPoints}
          onPointClick={(p) => openDrill(buildDailyAmountDrill(drillContext, p.dateKey))}
        />
      </OperationsChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <OperationsChartCard
          title="本月钱主要来自哪些价位"
          description="看这个月主要靠哪个价格带赚钱。"
          hint="点扇形可以看这个价位的订单"
        >
          <OperationsPieChart
            items={priceBandItems}
            onItemClick={(item) => openDrill(buildPriceBandAmountDrill(drillContext, item.label))}
          />
        </OperationsChartCard>

        <OperationsChartCard
          title="本月哪些主播成交高"
          description="按有效成交金额排序，看看本月主要是谁在撑场面。"
          hint="点柱子可以看组成订单"
        >
          <OperationsBarChart
            items={anchorItems}
            onItemClick={(item) => openDrill(buildAnchorAmountDrill(drillContext, item.label))}
          />
        </OperationsChartCard>

        <OperationsChartCard
          title="本月哪些商品卖得好"
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
          title="本月顾客主要因为什么不满意"
          description="看售后问题集中在哪里。"
          hint="点图可以看对应订单"
        >
          {useBarForAfterSales ? (
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
          ) : (
            <OperationsPieChart
              items={afterItems.map((i) => ({ ...i, value: i.value }))}
              valueFormatter={formatChartCount}
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
          )}
        </OperationsChartCard>
      </div>
    </div>
  )
}
