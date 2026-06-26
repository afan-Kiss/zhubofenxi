import React, { useState } from 'react'
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
  const [sampleExpanded, setSampleExpanded] = useState(false)
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
      {showTable ? <div className="overflow-x-auto">{children}</div> : (
        <p className="text-sm text-slate-500">
          {dataQuality.warnings[0] ?? '数据不足，暂无法展示可靠排行'}
        </p>
      )}
      {sampleTooSmall ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setSampleExpanded((v) => !v)}
            className="text-xs font-medium text-amber-700 hover:underline"
          >
            {sampleExpanded ? '收起样本不足参考' : '样本太少，只能先参考（展开查看）'}
          </button>
          {sampleExpanded ? <div className="mt-2 overflow-x-auto">{sampleTooSmall}</div> : null}
        </div>
      ) : null}
    </section>
  )
}
