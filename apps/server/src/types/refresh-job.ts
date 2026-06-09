export const REFRESH_JOB_TYPES = ['manual', 'scheduled'] as const
export type RefreshJobType = (typeof REFRESH_JOB_TYPES)[number]

export const REFRESH_JOB_STATUSES = [
  'pending',
  'running',
  'success',
  'partial_success',
  'failed',
  'failed_timeout',
  'skipped',
] as const
export type RefreshJobStatus = (typeof REFRESH_JOB_STATUSES)[number]

export const REFRESH_STEPS = [
  'idle',
  'downloading_order',
  'downloading_live',
  'downloading_pending',
  'downloading_settled',
  'parsing_excel',
  'validating_data',
  'analyzing_business',
  'saving_snapshot',
  'completed',
  'failed',
] as const
export type RefreshStep = (typeof REFRESH_STEPS)[number]

export const REFRESH_STEP_LABELS: Record<RefreshStep, string> = {
  idle: '等待开始',
  downloading_order: '正在下载订单表',
  downloading_live: '正在下载直播场次',
  downloading_pending: '正在下载待结算明细',
  downloading_settled: '正在下载已结算明细',
  parsing_excel: '正在解析 Excel',
  validating_data: '正在校验数据完整性',
  analyzing_business: '正在生成经营看板',
  saving_snapshot: '正在保存最新数据',
  completed: '刷新完成',
  failed: '刷新失败',
}

export const REFRESH_STEP_PROGRESS: Partial<Record<RefreshStep, number>> = {
  idle: 0,
  downloading_order: 5,
  downloading_live: 20,
  downloading_pending: 35,
  downloading_settled: 50,
  parsing_excel: 75,
  validating_data: 85,
  analyzing_business: 95,
  saving_snapshot: 100,
  completed: 100,
  failed: 0,
}

export const RUNNING_JOB_TIMEOUT_MS = 30 * 60 * 1000
