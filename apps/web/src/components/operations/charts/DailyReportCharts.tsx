import React, { useMemo, useState } from 'react'
import { OperationsChartCard } from './OperationsChartCard'
import { OperationsBarChart } from './OperationsBarChart'
import { OperationsPieChart } from './OperationsPieChart'
import { useOperationsBiDrill } from '../OperationsBiDrillProvider'
import { useChartTopLimit } from './useChartTopLimit'
import {
  buildAfterSalesReasonDrill,
  buildAnchorAmountDrill,
  buildPriceBandAmountDrill,
} from './operationsChartDrill'
import type { OperationsBiDrillContextProps } from '../../../pages/operations/operationsBiDrillTypes'
import type {
  AfterSalesReasonRow,
  DailyOperationsAnchorRow,
  OperationsPriceBandRow,
} from '../../../pages/operations/operationsReportTypes'
import { formatChartCount } from './operationsChartFormat'
import { LimitedRows } from './OperationsCoreMetrics'
import { AnchorOperationsTable } from '../AnchorOperationsTable'
import { AfterSalesReasonTable } from '../AfterSalesReasonTable'

interface Props {
  drillContext: OperationsBiDrillContextProps
  priceBands: OperationsPriceBandRow[]
  anchors: DailyOperationsAnchorRow[]
  afterSalesReasons: AfterSalesReasonRow[]
  showAttendanceStatus?: boolean
}

export const DailyReportCharts: React.FC<Props> = ({
  drillContext,
  priceBands,
  anchors,
  afterSalesReasons,
  showAttendanceStatus = true,
}) => {
  const { openDrill } = useOperationsBiDrill()
  const topLimit = useChartTopLimit()
  const [anchorExpanded, setAnchorExpanded] = useState(false)
  const [afterExpanded, setAfterExpanded] = useState(false)

  const priceBandItems = useMemo(
    () =>
      priceBands
        .filter((b) => b.amountYuan > 0)
        .map((b) => ({
          key: b.bandLabel,
          label: b.bandLabel,
          value: b.amountYuan,
        })),
    [priceBands],
  )

  const anchorItems = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of anchors) {
      map.set(a.anchorName, (map.get(a.anchorName) ?? 0) + a.validAmountYuan)
    }
    return [...map.entries()]
      .map(([name, value]) => ({ key: name, label: name, value, fullLabel: name }))
      .sort((a, b) => b.value - a.value)
      .slice(0, topLimit)
  }, [anchors, topLimit])

  const afterItems = useMemo(
    () =>
      afterSalesReasons
        .filter((r) => r.orderCount > 0)
        .map((r) => ({
          key: r.category,
          label: r.categoryLabel,
          value: r.orderCount,
          fullLabel: r.categoryLabel,
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, topLimit),
    [afterSalesReasons, topLimit],
  )

  return (
    <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
      <OperationsChartCard
        title="今天钱主要来自哪些价位"
        description="看今天成交金额主要集中在哪些价格带。"
        hint="点扇形可以看这个价位的订单"
      >
        <OperationsPieChart
          items={priceBandItems}
          onItemClick={(item) => openDrill(buildPriceBandAmountDrill(drillContext, item.label))}
        />
      </OperationsChartCard>

      <OperationsChartCard
        title="今天哪些主播成交高"
        description="按有效成交金额排序，看看今天主要是谁在出成绩。"
        hint="点柱子可以看组成订单"
      >
        <OperationsBarChart
          items={anchorItems}
          onItemClick={(item) => openDrill(buildAnchorAmountDrill(drillContext, item.label))}
        />
      </OperationsChartCard>

      <OperationsChartCard
        title="今天顾客主要因为什么不满意"
        description="看售后原因集中在哪里，方便当天就排查。"
        hint="点柱子可以看对应订单"
        onViewDetail={() =>
          openDrill({
            ...drillContext,
            target: 'summary_return_rate',
          })
        }
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

      <div className="space-y-4 lg:col-span-2">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">主播明细</h3>
            {anchors.length > topLimit ? (
              <button
                type="button"
                onClick={() => setAnchorExpanded((v) => !v)}
                className="text-xs text-rose-700 hover:underline"
              >
                {anchorExpanded ? '收起' : `查看完整榜单（${anchors.length}）`}
              </button>
            ) : null}
          </div>
          <LimitedRows
            rows={anchors}
            limit={topLimit}
            expanded={anchorExpanded}
            render={(rows) => (
              <AnchorOperationsTable rows={rows} showAttendanceStatus={showAttendanceStatus} />
            )}
          />
        </section>
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">售后原因明细</h3>
            {afterSalesReasons.length > topLimit ? (
              <button
                type="button"
                onClick={() => setAfterExpanded((v) => !v)}
                className="text-xs text-rose-700 hover:underline"
              >
                {afterExpanded ? '收起' : `查看完整榜单（${afterSalesReasons.length}）`}
              </button>
            ) : null}
          </div>
          <LimitedRows
            rows={afterSalesReasons}
            limit={topLimit}
            expanded={afterExpanded}
            render={(rows) => <AfterSalesReasonTable rows={rows} />}
          />
        </section>
      </div>
    </div>
  )
}
