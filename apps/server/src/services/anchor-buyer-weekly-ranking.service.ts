/**
 * 主播周榜：按日期范围 + 主播范围实时计算，不读 BuyerRankingCache
 */
import type { UserRole } from '../types/roles'
import { centToYuan } from '../utils/money'
import {
  resolveBuyerRankingDateRange,
  BUYER_RANKING_PRESET_LABELS,
  type BuyerRankingPreset,
} from '../utils/buyer-ranking-date-range'
import {
  buildBuyerRankingAllItems,
  type BuyerRankingItem,
} from './buyer-ranking.service'
import { filterBuyerRankingByTab } from './buyer-ranking-tab-filters'
import { getAnchorConfigSync } from './anchor.service'
import { STAFF_UNBOUND_MESSAGE } from './staff-anchor-scope.service'
import { formatDateTimeShanghai } from '../utils/business-timezone'

export type AnchorWeeklyRankingTab = 'spend' | 'repurchase' | 'refund' | 'quality'

export interface AnchorWeeklyBuyerRankingItem {
  rank: number
  buyerKey: string
  buyerDisplayName: string
  buyerShortCode: string
  buyerDisplayLabel: string
  tags: string[]
  suggestion: string
  weeklyDealAmountYuan: number
  weeklyRealDealOrderCount: number
  weeklyRefundOrderCount: number
  weeklyQualityRefundOrderCount: number
  weeklyRefundAmountYuan: number
  weeklyRefundRate: number | null
  lastOrderTime: string | null
  canOpenOrders: boolean
}

export type AnchorWeeklyRankingScope =
  | { mode: 'all'; anchorName?: string }
  | { mode: 'anchor'; anchorId: string; anchorName: string }
  | { mode: 'unbound'; message: string }

const WEEKLY_DATA_NOTE =
  '本榜只统计当前周期、当前主播范围内的买家数据；不是历史全量客户画像。'

const WEEKLY_EMPTY_TEXT =
  '本周暂时没有符合条件的客户，不代表主播表现不好，可能是本周该类客户少。'

function isAdminRole(role: UserRole): boolean {
  return role === 'super_admin' || role === 'boss' || role === 'local_viewer'
}

/** 只读：按登录名匹配主播（name 或 externalId），不改 schema */
export function resolveAnchorBindingByUsername(
  username: string,
): { anchorId: string; anchorName: string } | null {
  const cfg = getAnchorConfigSync()
  const normalized = username.trim().toLowerCase()
  for (const a of cfg.anchors) {
    if (a.name.trim().toLowerCase() === normalized) {
      return { anchorId: a.id, anchorName: a.name }
    }
    if (a.externalId?.trim().toLowerCase() === normalized) {
      return { anchorId: a.id, anchorName: a.name }
    }
  }
  return null
}

export function resolveAnchorWeeklyRankingScope(
  role: UserRole,
  username: string,
  requestedAnchorName?: string,
): AnchorWeeklyRankingScope {
  const reqName = requestedAnchorName?.trim()
  if (reqName === '全部') {
    if (isAdminRole(role)) return { mode: 'all' }
  }

  if (isAdminRole(role)) {
    if (reqName) {
      const cfg = getAnchorConfigSync()
      const anchor = cfg.anchors.find((a) => a.name === reqName)
      if (anchor) {
        return { mode: 'anchor', anchorId: anchor.id, anchorName: anchor.name }
      }
      return { mode: 'all', anchorName: reqName }
    }
    return { mode: 'all' }
  }

  if (role === 'staff') {
    const binding = resolveAnchorBindingByUsername(username)
    if (!binding) {
      return { mode: 'unbound', message: STAFF_UNBOUND_MESSAGE }
    }
    if (reqName && reqName !== binding.anchorName) {
      return { mode: 'unbound', message: '无权查看该主播数据' }
    }
    return { mode: 'anchor', ...binding }
  }

  return { mode: 'unbound', message: STAFF_UNBOUND_MESSAGE }
}

function weeklyRefundRate(item: BuyerRankingItem): number | null {
  const orderCount = item.buyerSummary?.orderCount ?? item.orderCount
  const refundCount = item.buyerSummary?.refundOrderCount ?? item.refundCount ?? 0
  if (!orderCount) return null
  return refundCount / orderCount
}

function weeklySuggestion(item: BuyerRankingItem, tab: AnchorWeeklyRankingTab): string {
  const tags = item.customerTags ?? []
  if (tab === 'quality' || tags.includes('品退') || tags.includes('品退偏多')) {
    return '售后关注'
  }
  if (tab === 'refund' || tags.includes('售后偏多')) {
    return '发货前确认'
  }
  if (tags.includes('复购客户') || (item.buyerSummary?.realDealOrderCount ?? 0) >= 2) {
    return '复购客户'
  }
  if (tags.includes('优质客户')) {
    return '重点维护'
  }
  return '重点维护'
}

export function mapBuyerRankingItemToWeekly(
  item: BuyerRankingItem,
  rank: number,
  tab: AnchorWeeklyRankingTab,
): AnchorWeeklyBuyerRankingItem {
  const summary = item.buyerSummary
  const dealCent =
    summary?.displayEarnedAmountCent ??
    summary?.realDealAmountCent ??
    summary?.netDealAmountCent ??
    Math.round(item.actualDealAmount * 100)
  const refundCent = summary?.refundAmountCent ?? Math.round(item.productRefundAmount * 100)

  return {
    rank,
    buyerKey: item.buyerKey,
    buyerDisplayName: item.buyerDisplayName ?? item.nickname ?? '未知买家',
    buyerShortCode: item.buyerShortCode ?? item.buyerIdentityCode ?? '—',
    buyerDisplayLabel: item.buyerDisplayLabel ?? item.buyerDisplayName ?? item.nickname,
    tags: [...(item.customerTags ?? [])],
    suggestion: weeklySuggestion(item, tab),
    weeklyDealAmountYuan: centToYuan(dealCent),
    weeklyRealDealOrderCount: summary?.realDealOrderCount ?? item.orderCount,
    weeklyRefundOrderCount: summary?.refundOrderCount ?? item.refundCount ?? 0,
    weeklyQualityRefundOrderCount:
      summary?.qualityRefundOrderCount ?? item.qualityReturnCount ?? 0,
    weeklyRefundAmountYuan: centToYuan(refundCent),
    weeklyRefundRate: weeklyRefundRate(item),
    lastOrderTime: item.lastOrderTime && item.lastOrderTime !== '—' ? item.lastOrderTime : null,
    canOpenOrders: true,
  }
}

export function sortAnchorWeeklyRankingItems(
  items: BuyerRankingItem[],
  tab: AnchorWeeklyRankingTab,
): BuyerRankingItem[] {
  const list = [...items]
  const dealAmount = (i: BuyerRankingItem) =>
    i.buyerSummary?.displayEarnedAmountCent != null
      ? centToYuan(i.buyerSummary.displayEarnedAmountCent)
      : i.earnedAmount ?? i.actualDealAmount ?? 0
  const realDealOrders = (i: BuyerRankingItem) =>
    i.buyerSummary?.realDealOrderCount ?? i.orderCount
  const refundOrders = (i: BuyerRankingItem) =>
    i.buyerSummary?.refundOrderCount ?? i.refundCount ?? 0
  const refundAmount = (i: BuyerRankingItem) =>
    i.buyerSummary ? centToYuan(i.buyerSummary.refundAmountCent) : i.productRefundAmount ?? 0
  const qualityOrders = (i: BuyerRankingItem) =>
    i.buyerSummary?.qualityRefundOrderCount ?? i.qualityReturnCount ?? 0
  const qualityAmount = (i: BuyerRankingItem) =>
    i.qualityReturnAmount ??
    (i.buyerSummary?.qualityRefundOrderCount
      ? centToYuan(Math.round((i.buyerSummary.qualityRefundOrderCount ?? 0) * 100))
      : 0)
  const lastTime = (i: BuyerRankingItem) => String(i.lastOrderTime ?? '')

  switch (tab) {
    case 'repurchase':
      list.sort((a, b) => {
        const oc = realDealOrders(b) - realDealOrders(a)
        if (oc !== 0) return oc
        const g = dealAmount(b) - dealAmount(a)
        if (g !== 0) return g
        return lastTime(b).localeCompare(lastTime(a))
      })
      break
    case 'refund':
      list.sort((a, b) => {
        const d = refundOrders(b) - refundOrders(a)
        if (d !== 0) return d
        const c = refundAmount(b) - refundAmount(a)
        if (c !== 0) return c
        return dealAmount(b) - dealAmount(a)
      })
      break
    case 'quality':
      list.sort((a, b) => {
        const q = qualityOrders(b) - qualityOrders(a)
        if (q !== 0) return q
        const qa = qualityAmount(b) - qualityAmount(a)
        if (qa !== 0) return qa
        return dealAmount(b) - dealAmount(a)
      })
      break
    case 'spend':
    default:
      list.sort((a, b) => {
        const g = dealAmount(b) - dealAmount(a)
        if (g !== 0) return g
        const oc = realDealOrders(b) - realDealOrders(a)
        if (oc !== 0) return oc
        return lastTime(b).localeCompare(lastTime(a))
      })
      break
  }
  return list
}

function buildEmptyWeeklyResponse(
  scope: AnchorWeeklyRankingScope,
  range: ReturnType<typeof resolveBuyerRankingDateRange>,
  rankingTab: AnchorWeeklyRankingTab,
  page: number,
  pageSize: number,
): AnchorWeeklyBuyerRankingResponse {
  const message = scope.mode === 'unbound' ? scope.message : undefined
  return {
    range: {
      preset: range.preset,
      presetLabel: BUYER_RANKING_PRESET_LABELS[range.preset as BuyerRankingPreset] ?? range.preset,
      startDate: range.startDate,
      endDate: range.endDate,
    },
    anchorScope:
      scope.mode === 'anchor'
        ? { mode: 'anchor', anchorName: scope.anchorName, anchorId: scope.anchorId }
        : scope.mode === 'all'
          ? { mode: 'all', anchorName: scope.anchorName ?? null }
          : { mode: 'unbound', message: scope.message },
    rankingTab,
    items: [],
    pagination: {
      page,
      pageSize,
      total: 0,
      totalPages: 1,
    },
    summary: {
      buyerCount: 0,
      orderCountInRange: 0,
    },
    dataNote: WEEKLY_DATA_NOTE,
    generatedAt: formatDateTimeShanghai(new Date()),
    emptyText: message ?? WEEKLY_EMPTY_TEXT,
    message,
    source: 'anchor_weekly_ranking_live',
  }
}

export interface AnchorWeeklyBuyerRankingResponse {
  range: {
    preset: string
    presetLabel: string
    startDate: string
    endDate: string
  }
  anchorScope: {
    mode: 'all' | 'anchor' | 'unbound'
    anchorName?: string | null
    anchorId?: string
    message?: string
  }
  rankingTab: AnchorWeeklyRankingTab
  items: AnchorWeeklyBuyerRankingItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  summary: {
    buyerCount: number
    orderCountInRange: number
  }
  dataNote: string
  generatedAt: string
  emptyText: string
  message?: string
  source: 'anchor_weekly_ranking_live'
}

export async function buildAnchorBuyerWeeklyRanking(params: {
  role: UserRole
  username: string
  preset?: string
  startDate?: string
  endDate?: string
  rankingTab?: string
  anchorName?: string
  page?: number
  pageSize?: number
}): Promise<AnchorWeeklyBuyerRankingResponse> {
  const rankingTab = (['spend', 'repurchase', 'refund', 'quality'].includes(
    String(params.rankingTab ?? 'spend'),
  )
    ? String(params.rankingTab)
    : 'spend') as AnchorWeeklyRankingTab

  const preset = params.preset ?? 'thisWeek'
  const range = resolveBuyerRankingDateRange(preset, params.startDate, params.endDate)
  const page = Math.max(1, Math.floor(params.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize ?? 20)))

  const scope = resolveAnchorWeeklyRankingScope(
    params.role,
    params.username,
    params.anchorName,
  )

  if (scope.mode === 'unbound') {
    return buildEmptyWeeklyResponse(scope, range, rankingTab, page, pageSize)
  }

  const anchorName = scope.mode === 'anchor' ? scope.anchorName : scope.anchorName

  const allItems = await buildBuyerRankingAllItems({
    preset,
    startDate: params.startDate,
    endDate: params.endDate,
    anchorName,
    type: 'all',
  })

  const filtered = filterBuyerRankingByTab(allItems, rankingTab)
  const sorted = sortAnchorWeeklyRankingItems(filtered, rankingTab)
  const total = sorted.length
  const slice = sorted.slice((page - 1) * pageSize, page * pageSize)
  const items = slice.map((item, idx) =>
    mapBuyerRankingItemToWeekly(item, (page - 1) * pageSize + idx + 1, rankingTab),
  )

  return {
    range: {
      preset: range.preset,
      presetLabel: BUYER_RANKING_PRESET_LABELS[range.preset as BuyerRankingPreset] ?? range.preset,
      startDate: range.startDate,
      endDate: range.endDate,
    },
    anchorScope:
      scope.mode === 'anchor'
        ? { mode: 'anchor', anchorName: scope.anchorName, anchorId: scope.anchorId }
        : { mode: 'all', anchorName: anchorName ?? null },
    rankingTab,
    items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    summary: {
      buyerCount: total,
      orderCountInRange: allItems.reduce(
        (sum, i) => sum + (i.buyerSummary?.realDealOrderCount ?? i.orderCount),
        0,
      ),
    },
    dataNote: WEEKLY_DATA_NOTE,
    generatedAt: formatDateTimeShanghai(new Date()),
    emptyText: total === 0 ? WEEKLY_EMPTY_TEXT : '',
    source: 'anchor_weekly_ranking_live',
  }
}
