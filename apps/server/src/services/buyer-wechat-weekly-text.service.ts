import { buildBuyerRankingAllItems, type BuyerRankingItem } from './buyer-ranking.service'
import {
  resolveBuyerRankingDateRange,
  BUYER_RANKING_PRESET_LABELS,
  type BuyerRankingPreset,
} from '../utils/buyer-ranking-date-range'
import { buildRawAnalyzeBundle } from './xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from './business-analysis.service'
import { buyerRankingRangeToAnalysisRange } from '../utils/buyer-ranking-date-range'
import { filterViewsForBuyerRanking } from './low-price-brush-order.service'
import { attachRawByMatchToViews } from './low-price-brush-order.service'
import {
  buildBuyerShopMapFromViews,
  type BuyerShopAggregate,
} from './buyer-shop-aggregate.service'
import {
  buildBuyerValueProfile,
  isAfterSaleFocusTagBuyer,
  isHighAovTagBuyer,
  isHighValueTagBuyer,
  isRepurchaseTagBuyer,
  isStableSignedTagBuyer,
  type BuyerValueProfile,
} from './buyer-value-profile.service'
import { isQualityRankingBuyer, isSpendRankingBuyer } from './buyer-ranking-tab-filters'

function formatMoneyYuanFull(yuan: number): string {
  return `¥${yuan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export type WechatWeeklyRankingKind = 'highValue' | 'spend' | 'stableSigned' | 'highAov'

export interface WechatWeeklyTextRow {
  rank: number
  buyerDisplayName: string
  buyerShortCode: string
  amountYuan: number
  signedOrderCount: number
  refundOrderCount: number
  mainTag: string
  shopLabel: string
}

export function formatWechatWeeklyLine(row: WechatWeeklyTextRow): string {
  return `${row.rank}. ${row.buyerDisplayName}｜消费 ${formatMoneyYuanFull(row.amountYuan)}｜签收 ${row.signedOrderCount} 单｜退货 ${row.refundOrderCount} 单｜${row.mainTag}｜${row.shopLabel}`
}

export function composeWechatWeeklyText(params: {
  title: string
  dateRangeLabel: string
  rows: WechatWeeklyTextRow[]
}): string {
  if (params.rows.length === 0) {
    return `${params.title}\n时间：${params.dateRangeLabel}\n\n本期暂时没有符合条件的客户，不代表没有值得跟进的买家，可以换个周期再看看。`
  }
  const lines = params.rows.map(formatWechatWeeklyLine)
  return [
    params.title,
    `时间：${params.dateRangeLabel}`,
    '',
    ...lines,
    '',
    '说明：按本期真实成交金额、签收、退货综合排序。高价值不代表一定马上成交，主播跟进时注意真诚维护。',
  ].join('\n')
}

export interface WechatWeeklyTextResult {
  title: string
  dateRangeLabel: string
  text: string
  rows: WechatWeeklyTextRow[]
  empty: boolean
  dataNote: string
}

const RANKING_TITLES: Record<WechatWeeklyRankingKind, string> = {
  highValue: '高价值买家榜',
  spend: '消费买家榜',
  stableSigned: '稳定签收买家榜',
  highAov: '高客单买家榜',
}

function filterByRankingKind(items: BuyerRankingItem[], kind: WechatWeeklyRankingKind): BuyerRankingItem[] {
  switch (kind) {
    case 'highAov':
      return items.filter((i) => isHighAovTagBuyer(i))
    case 'stableSigned':
      return items.filter((i) => isStableSignedTagBuyer(i))
    case 'spend':
      return items.filter((i) => isSpendRankingBuyer(i))
    case 'highValue':
    default:
      return items.filter((i) => isHighValueTagBuyer(i) || isSpendRankingBuyer(i))
  }
}

function sortByRankingKind(
  items: Array<{ item: BuyerRankingItem; profile: BuyerValueProfile }>,
  kind: WechatWeeklyRankingKind,
): void {
  items.sort((a, b) => {
    if (kind === 'highValue') {
      const s = b.profile.customerValueScore - a.profile.customerValueScore
      if (s !== 0) return s
    }
    if (kind === 'stableSigned') {
      const signed = b.profile.signedOrderCount - a.profile.signedOrderCount
      if (signed !== 0) return signed
      const rr = (a.profile.refundRate ?? 1) - (b.profile.refundRate ?? 1)
      if (rr !== 0) return rr
    }
    if (kind === 'highAov') {
      const aov = b.profile.averageOrderValueYuan - a.profile.averageOrderValueYuan
      if (aov !== 0) return aov
    }
    const g = b.profile.realDealAmountYuan - a.profile.realDealAmountYuan
    if (g !== 0) return g
    return String(b.item.lastOrderTime ?? '').localeCompare(String(a.item.lastOrderTime ?? ''))
  })
}

async function loadShopMapForRange(
  preset: string,
  startDate?: string,
  endDate?: string,
): Promise<Map<string, BuyerShopAggregate>> {
  const range = resolveBuyerRankingDateRange(preset, startDate, endDate)
  const bundle = await buildRawAnalyzeBundle(buyerRankingRangeToAnalysisRange(range))
  if (!bundle) return new Map()
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const rawByMatch = new Map<string, Record<string, unknown>>()
  for (const o of artifacts?.dedupe.uniqueOrders ?? []) {
    if (o.raw) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)
  }
  const views = filterViewsForBuyerRanking(
    attachRawByMatchToViews(artifacts?.views ?? [], rawByMatch),
  )
  return buildBuyerShopMapFromViews(views)
}

export async function buildWechatWeeklyBuyerRankingText(params: {
  preset?: string
  startDate?: string
  endDate?: string
  limit?: number
  ranking?: string
}): Promise<WechatWeeklyTextResult> {
  const preset = params.preset ?? 'thisWeek'
  const range = resolveBuyerRankingDateRange(preset, params.startDate, params.endDate)
  const limit = Math.min(30, Math.max(1, Math.floor(params.limit ?? 10)))
  const kind = (['highValue', 'spend', 'stableSigned', 'highAov'].includes(String(params.ranking))
    ? String(params.ranking)
    : 'highValue') as WechatWeeklyRankingKind

  const items = await buildBuyerRankingAllItems({
    preset,
    startDate: params.startDate,
    endDate: params.endDate,
    type: 'all',
  })

  const shopMap = await loadShopMapForRange(preset, params.startDate, params.endDate)
  const enriched = items
    .map((item) => ({
      item,
      profile: buildBuyerValueProfile(item, shopMap.get(item.buyerKey)),
    }))
    .filter(({ item }) => filterByRankingKind([item], kind).length > 0)

  sortByRankingKind(enriched, kind)
  const top = enriched.slice(0, limit)

  const presetLabel = BUYER_RANKING_PRESET_LABELS[range.preset as BuyerRankingPreset] ?? range.preset
  const dateRangeLabel = `${range.startDate} ~ ${range.endDate}`
  const title = `【${presetLabel}${RANKING_TITLES[kind]}】`

  if (top.length === 0) {
    return {
      title,
      dateRangeLabel,
      text: `${title}\n时间：${dateRangeLabel}\n\n本期暂时没有符合条件的客户，不代表没有值得跟进的买家，可以换个周期再看看。`,
      rows: [],
      empty: true,
      dataNote: '不按主播区分；所有主播共用同一份公司公共客户榜。',
    }
  }

  const rows: WechatWeeklyTextRow[] = top.map(({ item, profile }, idx) => ({
    rank: idx + 1,
    buyerDisplayName: item.buyerDisplayName ?? item.nickname ?? '未知买家',
    buyerShortCode: item.buyerShortCode ?? item.buyerIdentityCode ?? '—',
    amountYuan: profile.realDealAmountYuan,
    signedOrderCount: profile.signedOrderCount,
    refundOrderCount: profile.refundOrderCount,
    mainTag: profile.mainTag,
    shopLabel: profile.shopLabel,
  }))

  const lines = rows.map(formatWechatWeeklyLine)

  const text = composeWechatWeeklyText({ title, dateRangeLabel, rows })

  return {
    title,
    dateRangeLabel,
    text,
    rows,
    empty: false,
    dataNote: '不按主播区分；所有主播共用同一份公司公共客户榜。',
  }
}
