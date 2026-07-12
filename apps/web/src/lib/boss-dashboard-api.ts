export interface BossFundView {
  shopKey: string
  liveAccountId: string
  availableAmountCent: number | null
  withdrawingAmountCent: number | null
  withdrawnAmountCent: number | null
  balanceAmountCent: number | null
  frozenAmountCent: number | null
  afterSaleFrozenAmountCent: number | null
  depositBalanceCent: number | null
  depositRequiredCent: number | null
  depositStandardCent: number | null
  baseDueDepositCent: number | null
  riskDepositCent: number | null
  debtAmountCent: number | null
  todayIncomeCent: number | null
  yesterdayIncomeCent: number | null
  canWithdraw: boolean | null
  cannotWithdrawReason: string | null
  leftWithdrawTimesToday: number | null
  totalWithdrawTimesToday: number | null
  statementPeriodDays: number | null
  lastSyncedAt: string | null
  isStale: boolean
  syncStatus: string
  syncError: string | null
}

export interface BossScoreView {
  shopKey: string
  scoreDate: string
  qualityScore: number | null
  logisticsScore: number | null
  serviceScore: number | null
  officialOverallScore: number | null
  qualityDelta: number | null
  logisticsDelta: number | null
  serviceDelta: number | null
  fetchedAt: string | null
  scoreLabel: string
}

export interface BossPendingSettlementView {
  amountCent: number | null
  orderCount: number | null
  settlePeriodDays: number | null
  fetchedAt: string | null
  syncStatus: string
  syncError: string | null
  reconciliationDiffCent: number | null
}

export interface BossCurrentMonthBillView {
  settlementNetCent: number | null
  statementInCent: number | null
  statementRefundCent: number | null
  otherFeeCent: number | null
  commissionCent: number | null
  settleOrderCount: number | null
  dataThroughDate: string | null
  isPartialMonth: boolean
}

export interface BossMonthlySettlementTrendPoint {
  month: string
  amountCent: number | null
  source: 'official_month' | 'day_aggregate'
  isPartialMonth: boolean
}

export interface BossAnnouncementView {
  id: string
  kind: string
  shopKey: string | null
  shopName: string | null
  title: string
  content: string
  tone: string
  suggestion: string | null
  scoreDate: string | null
  metricKey: string | null
  previousScore: number | null
  currentScore: number | null
  deltaScore: number | null
  createdAt: string
  isRead: boolean
  popupShown: boolean
}

export interface BossMoneyTrendPoint {
  month: string
  amountCent: number | null
  shiyuju: number | null
  hetianyayu: number | null
  xiangyu: number | null
  xyxiangyu: number | null
}

export type BossTrendPoint = BossMoneyTrendPoint

export const BOSS_TREND_KEYS = ['total', 'shiyuju', 'hetianyayu', 'xiangyu', 'xyxiangyu'] as const

export const BOSS_TREND_LABELS: Record<(typeof BOSS_TREND_KEYS)[number], string> = {
  total: '四店合计',
  shiyuju: '拾玉居和田玉',
  hetianyayu: '和田雅玉',
  xiangyu: '祥钰珠宝',
  xyxiangyu: 'XY祥钰珠宝',
}

export interface BossDashboardPayload {
  generatedAt: string
  dataNotes: string[]
  totals: {
    availableAmountCent: number
    withdrawingAmountCent: number
    withdrawnAmountCent: number
    afterSaleFrozenAmountCent: number
    todayIncomeCent: number
    pendingSettlementAmountCent: number
    pendingSettlementOrderCount: number
    currentMonthSettlementNetCent: number
    currentMonthCommissionCent: number
    billReconciliationWarningShopCount: number
    scoreDownShopCount: number
    cannotWithdrawShopCount: number
  }
  combinedMonthlyIncome: BossMoneyTrendPoint[]
  combinedMonthlySettlement: BossMoneyTrendPoint[]
  shops: Array<{
    rank: number
    shopKey: string
    shopName: string
    fund: BossFundView | null
    score: BossScoreView | null
    monthlyIncome: Array<{ month: string; amountCent: number }>
    monthlySettlementTrend: BossMonthlySettlementTrendPoint[]
    pendingSettlement: BossPendingSettlementView
    currentMonthBill: BossCurrentMonthBillView
    billReconciliationStatus: string
    scoreTrend: {
      quality: Array<{ date: string; score: number | null }>
      logistics: Array<{ date: string; score: number | null }>
      service: Array<{ date: string; score: number | null }>
    }
    advice: Array<{ level: string; text: string }>
  }>
  announcements: BossAnnouncementView[]
  unreadAnnouncementCount: number
  lastBossSyncAt: string | null
  lastBossSyncStatus: string | null
}

export interface BossBillOrderView {
  shopKey: string
  shopName: string
  packageId: string | null
  orderCreateTime: string | null
  orderStatus: string | null
  expectedSettleAmountCent: number | null
  expectedSettleTime: string | null
  actualSettleTime: string | null
  platformCommissionCent: number | null
  settleStatus: string | null
}

export type BossBillOrderRow = BossBillOrderView
export type BossShopView = BossDashboardPayload['shops'][number]

const API_BASE = '/api/boss-dashboard'

async function parseJson<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { ok?: boolean; data?: T; message?: string }
  if (!res.ok || body.ok === false) {
    throw new Error(body.message ?? `请求失败 (${res.status})`)
  }
  return (body.data ?? body) as T
}

export async function fetchBossDashboard(): Promise<BossDashboardPayload> {
  const res = await fetch(`${API_BASE}`, { credentials: 'include' })
  return parseJson<BossDashboardPayload>(res)
}

export async function fetchBossBillOrders(params: {
  status: 'pending' | 'settled'
  shopKey?: string
  page: number
  pageSize: number
}): Promise<{ items: BossBillOrderView[]; total: number; page: number; pageSize: number }> {
  const qs = new URLSearchParams({
    status: params.status,
    page: String(params.page),
    pageSize: String(params.pageSize),
  })
  if (params.shopKey) qs.set('shopKey', params.shopKey)
  const res = await fetch(`${API_BASE}/bill-orders?${qs.toString()}`, { credentials: 'include' })
  return parseJson(res)
}

export async function fetchBossAnnouncements(): Promise<{
  announcements: BossAnnouncementView[]
  unreadCount: number
  popupCandidate: BossAnnouncementView | null
}> {
  const res = await fetch(`${API_BASE}/announcements`, { credentials: 'include' })
  return parseJson(res)
}

export async function markBossAnnouncementRead(id: string): Promise<void> {
  await fetch(`${API_BASE}/announcements/${id}/read`, {
    method: 'POST',
    credentials: 'include',
  })
}

export async function markAllBossAnnouncementsRead(): Promise<void> {
  await fetch(`${API_BASE}/announcements/read-all`, {
    method: 'POST',
    credentials: 'include',
  })
}

export async function markBossAnnouncementPopupShown(id: string): Promise<void> {
  await fetch(`${API_BASE}/announcements/${id}/popup-shown`, {
    method: 'POST',
    credentials: 'include',
  })
}

export async function createBossAnnouncement(input: {
  title: string
  content: string
  startsAt?: string
  endsAt?: string
  enabled?: boolean
}): Promise<void> {
  const res = await fetch(`${API_BASE}/announcements`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  await parseJson(res)
}

export function centToDisplayYuan(cent: number | null | undefined): string {
  if (cent == null) return '—'
  return `¥${(cent / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function deltaClass(delta: number | null | undefined): string {
  if (delta == null || delta === 0) return 'text-slate-500'
  return delta > 0 ? 'text-emerald-600' : 'text-rose-600'
}

export function announcementTextClass(tone: string): string {
  if (tone === 'positive') return 'text-emerald-700'
  if (tone === 'negative') return 'text-rose-700'
  return 'text-slate-800'
}
