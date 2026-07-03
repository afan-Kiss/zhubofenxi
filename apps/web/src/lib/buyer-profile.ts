import { apiRequest } from './api'
import type { BuyerOrderDrawerBuyer } from '../components/board/BuyerOrderDrawer'
import { resolveDisplayEarnedAmountCent } from './buyer-earned-amount'

import type { QualityFeedbackStatus } from '../components/board/OfficialQualitySyncNote'

export interface BuyerProfileSummary {
  highValueCount: number
  repurchaseCount: number
  refundCount: number
  qualityHeavyCount: number
  blacklistCount: number
}

export interface BuyerRankingSampleMeta {
  lastUpdatedAt: string | null
  sampleOrderCount: number
  sampleCustomerCount: number
  sampleStartTime: string | null
  sampleEndTime: string | null
  sampleTimeField: 'payTime'
  sampleDescription: string
}

export interface HighValueCustomerDefinition {
  label: string
  ruleText: string
  amountThreshold: number
  orderCountThreshold: number
}

export interface BuyerProfileData {
  source: 'buyer_profile_cache'
  cacheVersion?: string
  expectedCacheVersion?: string
  cacheCompatible?: boolean
  items: Array<Record<string, unknown>>
  summary: BuyerProfileSummary
  blacklistedBuyerIds: string[]
  updatedAt: string | null
  builtAt: string | null
  orderCount: number
  buyerCount: number
  lastTrigger: string | null
  rebuilding?: boolean
  cacheStale?: boolean
  cacheStaleReason?: string
  sampleMeta?: BuyerRankingSampleMeta | null
  highValueCustomerDefinition?: HighValueCustomerDefinition | null
  qualityFeedback?: QualityFeedbackStatus | null
  pagination?: {
    page: number
    pageSize: number
    total: number
    totalPages: number
    rankingTab: string
  }
}

export async function fetchWechatWeeklyBuyerText(params?: {
  preset?: string
  startDate?: string
  endDate?: string
  limit?: number
  ranking?: string
}): Promise<WechatWeeklyBuyerTextData> {
  const qs = new URLSearchParams()
  if (params?.preset) qs.set('preset', params.preset)
  if (params?.startDate) qs.set('startDate', params.startDate)
  if (params?.endDate) qs.set('endDate', params.endDate)
  if (params?.limit != null) qs.set('limit', String(params.limit))
  if (params?.ranking) qs.set('ranking', params.ranking)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return apiRequest<WechatWeeklyBuyerTextData>(
    `/api/board/buyer-ranking/wechat-weekly-text${suffix}`,
  )
}

export interface WechatWeeklyBuyerTextData {
  title: string
  dateRangeLabel: string
  text: string
  rows: Array<{
    rank: number
    buyerDisplayName: string
    amountYuan: number
    scoreText: string
    signedOrderCount: number
    completedOrderCount: number
    afterSaleOrderCount: number
    mainTag: string
    shopLabel: string
  }>
  empty: boolean
  dataNote: string
}

export interface BadBuyerRankingData {
  items: Array<Record<string, unknown>>
  range: {
    preset: string
    presetLabel: string
    startDate: string
    endDate: string
  }
  limit: number
  empty: boolean
  dataNote: string
}

export async function fetchBadBuyerRanking(params?: {
  preset?: string
  startDate?: string
  endDate?: string
  limit?: number
}): Promise<BadBuyerRankingData> {
  const qs = new URLSearchParams()
  if (params?.preset) qs.set('preset', params.preset)
  if (params?.startDate) qs.set('startDate', params.startDate)
  if (params?.endDate) qs.set('endDate', params.endDate)
  if (params?.limit != null) qs.set('limit', String(params.limit))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return apiRequest<BadBuyerRankingData>(`/api/board/buyer-ranking/bad-buyers${suffix}`)
}

export interface BuyerValueRankingData {
  range: {
    preset: string
    presetLabel: string
    startDate: string
    endDate: string
    isAll: boolean
  }
  summary: {
    totalBuyerCount: number
    trueHighValueCount: number
    highSpendNeedAttentionCount: number
    potentialCustomerCount: number
    totalSignedAmountCent: number
    avgSignedRate: number | null
    avgRefundRate: number
  }
  items: Array<Record<string, unknown>>
  limit: number
  empty: boolean
  dataNote: string
}

export async function fetchBuyerValueRanking(params?: {
  preset?: string
  startDate?: string
  endDate?: string
  type?: string
  limit?: number
}): Promise<BuyerValueRankingData> {
  const qs = new URLSearchParams()
  if (params?.preset) qs.set('preset', params.preset)
  if (params?.startDate) qs.set('startDate', params.startDate)
  if (params?.endDate) qs.set('endDate', params.endDate)
  if (params?.type) qs.set('type', params.type)
  if (params?.limit != null) qs.set('limit', String(params.limit))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return apiRequest<BuyerValueRankingData>(`/api/board/buyer-value-ranking${suffix}`)
}

export async function fetchBuyerProfile(
  params?: { rankingTab?: string; page?: number; pageSize?: number },
  signal?: AbortSignal,
): Promise<BuyerProfileData> {
  const qs = new URLSearchParams()
  if (params?.rankingTab) qs.set('rankingTab', params.rankingTab)
  if (params?.page != null) qs.set('page', String(params.page))
  if (params?.pageSize != null) qs.set('pageSize', String(params.pageSize))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return apiRequest<BuyerProfileData>(`/api/board/buyer-profile${suffix}`, { signal })
}

export interface BuyerProfileRefreshData {
  rebuilt: boolean
  lastUpdatedAt: string
  sampleOrderCount: number
  sampleCustomerCount: number
  sampleStartTime: string | null
  sampleEndTime: string | null
  sampleTimeField: 'payTime'
  summary: {
    highValueCustomerCount: number
    repeatCustomerCount: number
    afterSaleRiskCustomerCount: number
    qualityIssueCustomerCount: number
  }
  cacheVersion: string
  profile: BuyerProfileData | null
  buyerCount: number
  orderCount: number
}

export async function refreshBuyerProfile(): Promise<BuyerProfileRefreshData> {
  return apiRequest<BuyerProfileRefreshData>('/api/board/buyer-profile/refresh', {
    method: 'POST',
  })
}

export interface BuyerProfileAutoRebuildData {
  scheduled: boolean
  rebuilding: boolean
  cacheVersion?: string | null
  expectedCacheVersion?: string
  cacheCompatible?: boolean
}

/** 检测到缓存版本过旧时自动排队重建（无需系统设置权限） */
export async function autoRebuildBuyerProfile(): Promise<BuyerProfileAutoRebuildData> {
  return apiRequest<BuyerProfileAutoRebuildData>('/api/board/buyer-profile/auto-rebuild', {
    method: 'POST',
  })
}

function shortCodeFromRow(row: Record<string, unknown>): string {
  const code = String(row.buyerShortCode ?? row.buyerIdentityCode ?? '').trim()
  if (code && code !== '—') return code
  const key = String(row.buyerKey ?? row.buyerId ?? '').trim()
  if (!key || key === '—') return '—'
  if (key.includes(':')) {
    const tail = key.split(':').pop() ?? key
    return tail.length <= 6 ? tail.toUpperCase() : tail.slice(-6).toUpperCase()
  }
  return key.length <= 6 ? key : key.slice(-6)
}

function displayNameFromRow(row: Record<string, unknown>): string {
  const label = String(row.buyerDisplayLabel ?? '').trim()
  if (label && !label.startsWith('未知买家 #')) {
    const hashIdx = label.lastIndexOf(' #')
    if (hashIdx > 0) return label.slice(0, hashIdx).trim()
    return label
  }
  const nick = String(row.buyerNickname ?? row.nickname ?? '').trim()
  if (nick && nick !== '未知买家') return nick
  const display = String(row.buyerDisplayName ?? '').trim()
  if (display && display !== '未知买家') return display
  return '未知买家'
}

/** 仅昵称，不含识别码 */
export function buyerDisplayNameFromRow(row: Record<string, unknown>): string {
  return displayNameFromRow(row)
}

/** @deprecated Drawer/标题请用 buyerDisplayNameFromRow；列表识别码请单独展示 */
export function buyerDisplayLabelFromRow(row: Record<string, unknown>): string {
  return buyerDisplayNameFromRow(row)
}

/** @deprecated 使用 shortCodeFromRow */
export function formatDisplayBuyerId(buyerId: string | null | undefined): string {
  const id = (buyerId ?? '').trim()
  if (!id || id === '—' || id === '未知买家') return '—'
  if (id.startsWith('nick:')) return '—'
  if (id.includes(':')) {
    const tail = id.split(':').pop() ?? id
    return tail.length <= 6 ? tail.toUpperCase() : tail.slice(-6).toUpperCase()
  }
  return id.length <= 12 ? id : id.slice(-6)
}

export function buyerIdentityCodeFromRow(row: Record<string, unknown>): string {
  return shortCodeFromRow(row)
}

export function rowToDrawerBuyer(row: Record<string, unknown>): BuyerOrderDrawerBuyer {
  const buyerKey = String(row.buyerKey ?? row.buyerId ?? '').trim()
  const blocked =
    Boolean(row.isBlacklisted) || buyerQualityCountFromRow(row) >= 1
  const summary = row.buyerSummary as Record<string, unknown> | undefined
  const refundAmountCent = Number(summary?.refundAmountCent ?? NaN)
  const productRefundAmount = Number.isFinite(refundAmountCent)
    ? refundAmountCent / 100
    : Number(row.productRefundAmount ?? row.refundAmount ?? 0)
  const refundCount = Number.isFinite(Number(summary?.refundOrderCount))
    ? Number(summary?.refundOrderCount)
    : Number(row.refundCount ?? row.refundTimes ?? 0)
  const qualityReturnCount = Number.isFinite(Number(summary?.qualityRefundOrderCount))
    ? Number(summary?.qualityRefundOrderCount)
    : Number(row.qualityReturnCount ?? 0)
  const payAmountCent = Number(summary?.payAmountCent ?? NaN)
  const gmv = Number.isFinite(payAmountCent)
    ? payAmountCent / 100
    : Number(row.statPaidAmount ?? row.gmv ?? 0)
  const receivableCent = Number(summary?.receivableAmountCent ?? NaN)
  const receivableAmount = Number.isFinite(receivableCent)
    ? receivableCent / 100
    : Number(row.receivableAmount ?? 0)
  const orderCount = Number.isFinite(Number(summary?.orderCount))
    ? Number(summary?.orderCount)
    : Number(row.orderCount ?? 0)
  const paidOrderCount = Number.isFinite(Number(summary?.paidOrderCount))
    ? Number(summary?.paidOrderCount)
    : Number(row.paidOrderCount ?? 0)
  const listBuyerSummary = summary
    ? {
        receivableAmountCent: Number(summary.receivableAmountCent ?? 0),
        payAmountCent: Number(summary.payAmountCent ?? 0),
        refundAmountCent: Number(summary.refundAmountCent ?? 0),
        netDealAmountCent: Number(
          summary.netDealAmountCent ??
            Math.max(0, Number(summary.payAmountCent ?? 0) - Number(summary.refundAmountCent ?? 0)),
        ),
        realDealAmountCent: Number(summary.realDealAmountCent ?? 0),
        displayEarnedAmountCent: resolveDisplayEarnedAmountCent({
          displayEarnedAmountCent: Number(summary.displayEarnedAmountCent),
          netDealAmountCent: Number(summary.netDealAmountCent),
          realDealAmountCent: Number(summary.realDealAmountCent),
        }),
        orderCount,
        paidOrderCount,
        realDealOrderCount: Number(summary.realDealOrderCount ?? 0),
        refundOrderCount: refundCount,
        qualityRefundOrderCount: qualityReturnCount,
        pendingAfterSaleOrderCount: Number(summary.pendingAfterSaleOrderCount ?? 0),
      }
    : undefined
  return {
    buyerKey,
    buyerId: buyerKey,
    officialBuyerId: String(row.buyerId ?? '').trim() || undefined,
    nickname: displayNameFromRow(row),
    buyerDisplayName: displayNameFromRow(row),
    buyerDisplayLabel: displayNameFromRow(row),
    buyerIdentityCode: shortCodeFromRow(row),
    buyerShortCode: shortCodeFromRow(row),
    identitySource: row.identitySource != null ? String(row.identitySource) : undefined,
    gmv,
    receivableAmount,
    orderCount,
    paidOrderCount,
    productRefundAmount,
    refundCount,
    refundTimes: refundCount,
    afterSaleCount: Number(row.afterSaleCount ?? row.refundRelatedOrderCount ?? 0),
    qualityReturnCount,
    signedOrderCount: Number(row.signedOrderCount ?? 0),
    returnRefundCount: Number(row.returnRefundCount ?? 0),
    freightRefundCount: Number(row.freightRefundCount ?? 0),
    signedAmount: Number(row.signedAmount ?? 0),
    isBlacklisted: blocked,
    listBuyerSummary,
  }
}

function buyerQualityCountFromRow(row: Record<string, unknown>): number {
  const summary = row.buyerSummary as Record<string, unknown> | undefined
  if (summary && Number.isFinite(Number(summary.qualityRefundOrderCount))) {
    return Number(summary.qualityRefundOrderCount)
  }
  return Number(row.qualityReturnCount ?? 0)
}
