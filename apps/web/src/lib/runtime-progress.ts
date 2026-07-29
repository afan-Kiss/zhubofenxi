export type RuntimeTaskStatus =
  | 'running'
  | 'idle'
  | 'paused'
  | 'waiting'
  | 'failed'
  | 'done'

export interface RuntimeTaskProgressItem {
  id: string
  kind: 'business_sync' | 'after_sales' | 'after_sales_shop' | 'buyer_ranking'
  title: string
  status: RuntimeTaskStatus
  statusText: string
  detailText: string | null
  percent: number | null
  doneCount: number | null
  totalCount: number | null
  countLabel: string | null
}

export interface RuntimeProgressSnapshot {
  polledAt: string
  autoSyncEnabled: boolean
  anyRunning: boolean
  headline: string
  tasks: RuntimeTaskProgressItem[]
}

export function statusBadgeClass(status: RuntimeTaskStatus): string {
  switch (status) {
    case 'running':
      return 'bg-sky-50 text-sky-800'
    case 'paused':
      return 'bg-amber-50 text-amber-900'
    case 'waiting':
      return 'bg-violet-50 text-violet-800'
    case 'failed':
      return 'bg-red-50 text-red-800'
    case 'done':
      return 'bg-emerald-50 text-emerald-800'
    case 'idle':
    default:
      return 'bg-slate-100 text-slate-600'
  }
}

export function statusBadgeLabel(status: RuntimeTaskStatus): string {
  switch (status) {
    case 'running':
      return '进行中'
    case 'paused':
      return '已暂停'
    case 'waiting':
      return '排队中'
    case 'failed':
      return '失败'
    case 'done':
      return '已完成'
    case 'idle':
    default:
      return '空闲'
  }
}

export function barColorClass(status: RuntimeTaskStatus): string {
  switch (status) {
    case 'running':
      return 'bg-sky-500'
    case 'paused':
      return 'bg-amber-400'
    case 'waiting':
      return 'bg-violet-400'
    case 'failed':
      return 'bg-red-400'
    case 'done':
      return 'bg-emerald-500'
    case 'idle':
    default:
      return 'bg-slate-300'
  }
}
