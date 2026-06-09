import React from 'react'
import { getMetricExplain, type BoardMetricExplainKey } from '../../lib/metricExplain'
import { MetricInfoTooltip } from './MetricInfoTooltip'

interface Props {
  label: string
  metricKey: BoardMetricExplainKey
  /** 覆盖默认说明（如高价值客户后端规则） */
  infoText?: string
  className?: string
}

export const MetricStatLabel: React.FC<Props> = ({
  label,
  metricKey,
  infoText,
  className = '',
}) => {
  const text = infoText ?? getMetricExplain(metricKey)
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span>{label}</span>
      <MetricInfoTooltip text={text} />
    </span>
  )
}
