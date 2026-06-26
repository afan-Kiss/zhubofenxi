import React from 'react'
import { RankingQualityBadge } from './RankingQualityBadge'
import type { RankingConfidence } from '../../pages/operations/operationsReportTypes'

export const RankingMetricTooltip: React.FC<{ text: string }> = ({ text }) => (
  <p className="text-xs text-slate-500">{text}</p>
)

interface SectionProps {
  title: string
  subtitle: string
  dataQuality: {
    reliable: boolean
    confidence: RankingConfidence
    warnings: string[]
  }
  children: React.ReactNode
  sampleTooSmall?: React.ReactNode
  forceShowTable?: boolean
}

export const RankingSection: React.FC<SectionProps> = ({
  title,
  subtitle,
  dataQuality,
  children,
  sampleTooSmall,
  forceShowTable = false,
}) => {
  const showTable = forceShowTable || dataQuality.reliable || dataQuality.confidence !== 'insufficient'
  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
        <RankingMetricTooltip text={subtitle} />
      </div>
      <RankingQualityBadge
        reliable={dataQuality.reliable}
        confidence={dataQuality.confidence}
        warnings={dataQuality.warnings}
      />
      {showTable ? children : (
        <p className="text-sm text-slate-500">
          {dataQuality.warnings[0] ?? '数据不足，暂无法展示可靠排行'}
        </p>
      )}
      {sampleTooSmall ? (
        <div className="mt-2">
          <p className="mb-1 text-xs font-medium text-amber-700">样本不足，仅参考</p>
          {sampleTooSmall}
        </div>
      ) : null}
    </section>
  )
}
