/**
 * 经营动作建议验收（纯函数 + schema）
 * 用法: npm run accept:operations-business-insights
 */
import type { DailyOperationsAnchorRow } from '../src/services/daily-operations-report.service'
import type { OperationsProductRow } from '../src/services/operations-product-analysis.service'
import type { OperationsPriceBandRow } from '../src/services/operations-price-band.service'
import { buildAllAnchorRankings } from '../src/services/operations-anchor-ranking.service'
import { buildAfterSalesRankingLists } from '../src/services/operations-after-sales-ranking.service'
import {
  buildBusinessInsightsFromSource,
  type BusinessInsightsSource,
} from '../src/services/operations-business-insights.service'
import type {
  BusinessInsightItem,
  BusinessInsightPriority,
  BusinessInsightConfidence,
} from '../src/services/operations-business-insights.types'
import { buildPriceBandRankingLists } from '../src/services/operations-price-band-ranking.service'
import { buildProductRankingLists } from '../src/services/operations-product-ranking-lists.service'
import { OPERATIONS_PRODUCT_RANKING } from '../src/config/operations-product-ranking.config'
import { emptyRankingList } from '../src/services/operations-rankings.types'

const PRIVACY_FIELDS = [
  'phone',
  'mobile',
  'address',
  'receiver',
  'buyerName',
  'buyerPhone',
  'platformRawJson',
  'rawJson',
  'idCard',
  'buyerId',
  'buyerKey',
]

const VALID_PRIORITIES: BusinessInsightPriority[] = ['high', 'medium', 'low']
const VALID_CONFIDENCE: BusinessInsightConfidence[] = [
  'high',
  'medium',
  'low',
  'insufficient',
]

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function mockAnchor(
  overrides: Partial<DailyOperationsAnchorRow> & { anchorName: string },
): DailyOperationsAnchorRow {
  return {
    anchorName: overrides.anchorName,
    sessionLabel: '场次',
    shopName: overrides.shopName ?? '店',
    livePeriodText: '—',
    liveDurationText: '60分钟',
    liveDurationMinutes: overrides.liveDurationMinutes ?? 120,
    validAmountYuan: overrides.validAmountYuan ?? 0,
    soldOrderCount: overrides.soldOrderCount ?? 0,
    invalidOrderCount: 0,
    returnOrderCount: overrides.returnOrderCount ?? 0,
    returnOrderRate: null,
    avgOrderAmountYuan: null,
    hourlyAmountYuan: overrides.hourlyAmountYuan ?? null,
    amountRatio: null,
    viewSessionCount: overrides.viewSessionCount ?? null,
    joinUserCount: overrides.joinUserCount ?? null,
    avgOnlineUserCount: null,
    avgViewDurationSeconds: null,
    newFollowerCount: overrides.newFollowerCount ?? null,
    dealUserCount: overrides.dealUserCount ?? null,
    dealConversionRate: overrides.dealConversionRate ?? null,
    newFollowerRate: null,
  }
}

function mockProduct(
  overrides: Partial<OperationsProductRow> & { productKey: string },
): OperationsProductRow {
  return {
    productKey: overrides.productKey,
    itemId: overrides.productKey,
    productName: overrides.productName ?? overrides.productKey,
    skuName: overrides.skuName ?? '',
    shopName: overrides.shopName ?? '店',
    productCode: null,
    ringSize: '未识别',
    barType: '未识别',
    soldCount: overrides.soldCount ?? 0,
    soldOrderCount: overrides.soldOrderCount ?? 0,
    paidOrderCount: overrides.paidOrderCount ?? overrides.soldOrderCount ?? 0,
    soldAmountYuan: overrides.soldAmountYuan ?? 0,
    buyerCount: 0,
    returnOrderCount: overrides.returnOrderCount ?? 0,
    returnRate: overrides.returnRate ?? null,
    productRole: overrides.productRole ?? 'normal',
    productRoleLabel: overrides.productRoleLabel ?? '常规',
  }
}

function buildSource(params: {
  anchors: DailyOperationsAnchorRow[]
  products: OperationsProductRow[]
  priceBands?: OperationsPriceBandRow[]
  afterSales?: Array<{
    category: string
    categoryLabel: string
    orderCount: number
    refundAmountYuan: number
    sharePercent: number | null
  }>
  dimensions?: Array<{ productKey: string; productRole?: string | null }>
  summaryTraffic?: BusinessInsightsSource['summaryTraffic']
}): BusinessInsightsSource {
  const limit = 10
  const products = buildProductRankingLists({
    products: params.products,
    dimensions: params.dimensions ?? [],
    reviewNote: null,
    limit,
  })
  const anchors = buildAllAnchorRankings(params.anchors, limit)
  const priceBands = buildPriceBandRankingLists(params.priceBands ?? [], limit)
  const afterSales = buildAfterSalesRankingLists(
    params.afterSales ?? [
      {
        category: 'other',
        categoryLabel: '其他',
        orderCount: 5,
        refundAmountYuan: 1000,
        sharePercent: 50,
      },
    ],
    limit,
  )
  return {
    startDate: '2026-06-01',
    endDate: '2026-06-07',
    scope: 'weekly',
    anchors,
    products,
    priceBands,
    afterSales,
    summaryTraffic: params.summaryTraffic,
  }
}

function validateItem(item: BusinessInsightItem, issues: string[]) {
  assert(!!item.type, `insight 缺少 type: ${item.id}`, issues)
  assert(VALID_PRIORITIES.includes(item.priority), `非法 priority: ${item.priority}`, issues)
  assert(!!item.title, `insight 缺少 title: ${item.id}`, issues)
  assert(!!item.reason, `insight 缺少 reason: ${item.id}`, issues)
  assert(!!item.suggestedAction, `insight 缺少 suggestedAction: ${item.id}`, issues)
  assert(item.evidence.length > 0, `insight evidence 为空: ${item.id}`, issues)
  assert(!!item.dataQuality, `insight 缺少 dataQuality: ${item.id}`, issues)
  assert(
    VALID_CONFIDENCE.includes(item.dataQuality.confidence),
    `非法 confidence: ${item.dataQuality.confidence}`,
    issues,
  )
}

function scanPrivacy(payload: unknown, issues: string[]) {
  const json = JSON.stringify(payload)
  for (const f of PRIVACY_FIELDS) {
    assert(!json.includes(`"${f}"`), `响应含隐私字段名 ${f}`, issues)
  }
}

function main() {
  const issues: string[] = []

  const richProducts = [
    mockProduct({
      productKey: 'hot1',
      productName: '热卖A',
      soldAmountYuan: 5000,
      soldOrderCount: 5,
      returnOrderCount: 0,
      returnRate: 0,
    }),
    mockProduct({
      productKey: 'hot2',
      productName: '热卖B',
      soldAmountYuan: 3000,
      soldOrderCount: 3,
      returnRate: 0.05,
    }),
    mockProduct({
      productKey: 'ret1',
      productName: '高退C',
      soldAmountYuan: 100,
      soldOrderCount: 4,
      paidOrderCount: 4,
      returnOrderCount: 3,
      returnRate: 0.75,
    }),
    mockProduct({
      productKey: 'ret2',
      productName: '低样本D',
      soldAmountYuan: 50,
      soldOrderCount: 2,
      paidOrderCount: 2,
      returnOrderCount: 2,
      returnRate: 1,
    }),
  ]

  const richAnchors = [
    mockAnchor({
      anchorName: '飞云',
      validAmountYuan: 20000,
      soldOrderCount: 20,
      returnOrderCount: 2,
      liveDurationMinutes: 180,
      hourlyAmountYuan: 400,
      joinUserCount: 5000,
      dealUserCount: 50,
      dealConversionRate: 0.01,
      viewSessionCount: 6000,
    }),
    mockAnchor({
      anchorName: '子杰',
      validAmountYuan: 8000,
      soldOrderCount: 10,
      returnOrderCount: 1,
      liveDurationMinutes: 120,
      hourlyAmountYuan: 200,
      joinUserCount: 8000,
      dealUserCount: 8,
      dealConversionRate: 0.001,
      viewSessionCount: 9000,
    }),
  ]

  const priceBands: OperationsPriceBandRow[] = [
    {
      bandLabel: '1999+',
      amountYuan: 50000,
      orderCount: 15,
      paidOrderCount: 15,
      buyerCount: 12,
      amountSharePercent: 60,
      avgOrderAmountYuan: 3333,
      returnOrderCount: 2,
      returnRate: 0.13,
    },
    {
      bandLabel: '800~999',
      amountYuan: 8000,
      orderCount: 8,
      paidOrderCount: 8,
      buyerCount: 7,
      amountSharePercent: 20,
      avgOrderAmountYuan: 1000,
      returnOrderCount: 1,
      returnRate: 0.125,
    },
  ]

  const rich = buildBusinessInsightsFromSource(
    buildSource({
      anchors: richAnchors,
      products: richProducts,
      priceBands,
      afterSales: [
        {
          category: 'size_mismatch',
          categoryLabel: '尺寸不符',
          orderCount: 12,
          refundAmountYuan: 5000,
          sharePercent: 40,
        },
        {
          category: 'quality_issue',
          categoryLabel: '质量问题',
          orderCount: 8,
          refundAmountYuan: 3000,
          sharePercent: 30,
        },
      ],
      summaryTraffic: {
        dealUserCount: 58,
        joinUserCount: 13000,
        viewSessionCount: 15000,
      },
    }),
  )

  for (const item of rich.items) validateItem(item, issues)
  scanPrivacy(rich, issues)
  assert(rich.items.length <= 8, `建议条数超过 8：${rich.items.length}`, issues)
  assert(
    rich.items.some((i) => i.type === 'promote_product'),
    '应生成继续主推建议',
    issues,
  )
  assert(
    rich.items.some((i) => i.type === 'review_product' && i.priority === 'high'),
    '应生成高退货正式榜复查建议',
    issues,
  )
  const sampleOnly = buildBusinessInsightsFromSource(
    buildSource({
      anchors: [mockAnchor({ anchorName: 'A', validAmountYuan: 100, soldOrderCount: 1 })],
      products: [
        mockProduct({
          productKey: 'sample1',
          productName: '低样本E',
          soldAmountYuan: 80,
          soldOrderCount: 2,
          paidOrderCount: 2,
          returnOrderCount: 2,
          returnRate: 1,
        }),
      ],
      priceBands: [],
      afterSales: [],
    }),
  )
  assert(
    sampleOnly.items.some(
      (i) =>
        i.type === 'review_product' &&
        i.dataQuality.warnings.some((w) => w.includes('样本不足')),
    ),
    '应生成低样本高退货参考建议',
    issues,
  )
  assert(
    rich.items.some((i) => i.type === 'increase_anchor_schedule'),
    '应生成可考虑加场建议',
    issues,
  )
  assert(
    rich.items.some((i) => i.type === 'review_anchor'),
    '应生成转化偏低复盘建议',
    issues,
  )
  assert(
    rich.items.some((i) => i.type === 'focus_price_band'),
    '应生成重点价格带建议',
    issues,
  )
  assert(
    rich.items.some((i) => i.type === 'after_sales_check'),
    '应生成售后原因排查建议',
    issues,
  )
  assert(
    rich.items.filter((i) => i.type === 'after_sales_check').length <= 2,
    '售后建议最多 2 条',
    issues,
  )

  const promoteAndReturn = rich.items.filter(
    (i) =>
      i.relatedEntity.type === 'product' &&
      (i.type === 'promote_product' || i.type === 'review_product'),
  )
  const productKeys = new Set(
    promoteAndReturn.filter((i) => i.type === 'review_product').map((i) => i.relatedEntity.id),
  )
  for (const p of promoteAndReturn.filter((i) => i.type === 'promote_product')) {
    assert(
      !productKeys.has(p.relatedEntity.id),
      '同一商品不应同时继续主推与高退货复查',
      issues,
    )
  }

  const noTraffic = buildBusinessInsightsFromSource(
    buildSource({
      anchors: [
        mockAnchor({
          anchorName: '无流量',
          joinUserCount: null,
          dealUserCount: null,
          dealConversionRate: null,
          viewSessionCount: null,
          validAmountYuan: 1000,
          soldOrderCount: 5,
        }),
      ],
      products: richProducts,
      summaryTraffic: { dealUserCount: null, joinUserCount: null, viewSessionCount: null },
    }),
  )
  assert(
    !noTraffic.items.some((i) => i.type === 'review_anchor'),
    '缺少官方成交人数时不应生成转化复盘建议',
    issues,
  )

  const slowOnly = buildBusinessInsightsFromSource({
    startDate: '2026-06-01',
    endDate: '2026-06-07',
    scope: 'custom',
    anchors: buildAllAnchorRankings([], 10),
    products: {
      ...buildProductRankingLists({ products: [], dimensions: [], reviewNote: null, limit: 10 }),
      slow: emptyRankingList(
        'product_slow',
        '滞销',
        '无池',
        '—',
        'insufficient_data',
        ['无官方曝光/讲解数据，且无人工主推候选池，暂无法可靠判断滞销'],
      ),
    },
    priceBands: buildPriceBandRankingLists([], 10),
    afterSales: buildAfterSalesRankingLists([], 10),
  })
  assert(
    !slowOnly.items.some((i) => i.title.includes('复盘主推未成交')),
    '无人工主推池时不应生成主推未成交复盘',
    issues,
  )
  assert(
    slowOnly.items.some((i) => i.type === 'data_quality_warning'),
    '无主推池应生成数据维护建议',
    issues,
  )
  assert(
    slowOnly.items.filter((i) => i.type === 'data_quality_warning').length <= 2,
    '数据维护建议最多 2 条',
    issues,
  )

  const slowWithPool = buildBusinessInsightsFromSource(
    buildSource({
      anchors: richAnchors,
      products: [
        mockProduct({
          productKey: 'main1',
          productName: '主推未卖',
          soldAmountYuan: 0,
          soldOrderCount: 0,
          productRole: 'main',
          productRoleLabel: '主推',
        }),
        ...richProducts,
      ],
      dimensions: [{ productKey: 'main1', productRole: 'main' }],
    }),
  )
  assert(
    slowWithPool.items.some((i) => i.title.includes('复盘主推未成交')),
    '有人工主推池且无成交时应生成复盘建议',
    issues,
  )

  if (issues.length > 0) {
    console.error('[operations-business-insights-acceptance] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[operations-business-insights-acceptance] OK')
}

main()
