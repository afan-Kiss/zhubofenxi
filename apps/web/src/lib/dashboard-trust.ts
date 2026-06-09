export type AnalysisTrustStatus =
  | 'official_ready'
  | 'preview_only'
  | 'blocked'
  | 'error'

export interface DashboardTrustSummary {
  status: AnalysisTrustStatus
  statusLabel: string
  statusHint: string
  canReport: boolean
  isPreviewOnly: boolean
  isBlocked: boolean
  riskHints: string[]
  selectedRange: { startDate: string; endDate: string } | null
}

export const TRUST_BANNER_STYLES: Record<
  AnalysisTrustStatus,
  { border: string; bg: string; text: string; dot: string }
> = {
  official_ready: {
    border: 'border-emerald-200',
    bg: 'bg-emerald-50',
    text: 'text-emerald-800',
    dot: 'bg-emerald-500',
  },
  preview_only: {
    border: 'border-amber-200',
    bg: 'bg-amber-50',
    text: 'text-amber-900',
    dot: 'bg-amber-500',
  },
  blocked: {
    border: 'border-rose-200',
    bg: 'bg-rose-50',
    text: 'text-rose-800',
    dot: 'bg-rose-500',
  },
  error: {
    border: 'border-rose-200',
    bg: 'bg-rose-50',
    text: 'text-rose-800',
    dot: 'bg-rose-500',
  },
}
