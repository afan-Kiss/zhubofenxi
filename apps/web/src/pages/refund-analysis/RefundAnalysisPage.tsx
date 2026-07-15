import React, { useMemo } from 'react'

/**
 * 退款分析：嵌入老板版「近两个月退款真实原因」报告。
 * 会话列表 / 聊天记录入口已隐藏，仅展示本报告。
 */
export const RefundAnalysisPage: React.FC = () => {
  const reportUrl = useMemo(() => {
    const base = import.meta.env.BASE_URL || '/'
    const prefix = base.endsWith('/') ? base : `${base}/`
    return `${prefix}refund-boss-report.html`
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="refund-analysis-page">
      <iframe
        title="近两个月退款真实原因分析"
        src={reportUrl}
        className="h-[calc(100dvh-7.5rem)] w-full flex-1 rounded-2xl border border-slate-200/80 bg-[#f2efe9]"
        style={{ minHeight: 720 }}
      />
    </div>
  )
}
