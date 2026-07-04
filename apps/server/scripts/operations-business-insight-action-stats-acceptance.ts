/**
 * 经营建议执行统计验收
 * 用法: npm run accept:operations-business-insight-action-stats
 */
import './operations-acceptance-auth'
import { prisma } from '../src/lib/prisma'
import {
  attachBusinessInsightActions,
  getBusinessInsightActionStats,
  upsertBusinessInsightAction,
} from '../src/services/operations-business-insight-action.service'
import type { BusinessInsightsPayload } from '../src/services/operations-business-insights.types'

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

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function mockPayload(): BusinessInsightsPayload {
  return {
    items: [
      {
        id: 'accept-stats-1',
        type: 'review_product',
        priority: 'high',
        title: '统计验收商品',
        reason: '测试',
        suggestedAction: '测试',
        evidence: [{ label: '退货订单数', value: 2, source: 'product_ranking' }],
        relatedEntity: { type: 'product', id: 'p-stats', name: '统计商品' },
        dataQuality: { reliable: true, confidence: 'high', warnings: [] },
      },
    ],
    dataQuality: { reliable: true, warnings: [] },
  }
}

function scanPrivacy(payload: unknown, issues: string[]) {
  const json = JSON.stringify(payload)
  for (const f of PRIVACY_FIELDS) {
    if (json.includes(`"${f}"`)) issues.push(`响应含隐私字段 ${f}`)
  }
}

async function main() {
  const issues: string[] = []
  const range = {
    rangeStartDate: '2026-06-10',
    rangeEndDate: '2026-06-10',
    scope: 'daily' as const,
  }

  await upsertBusinessInsightAction({
    insightId: 'accept-stats-1',
    insightType: 'review_product',
    entityType: 'product',
    entityId: 'p-stats',
    entityName: '统计商品',
    ...range,
    status: 'handled',
    note: '已处理备注',
  })
  await upsertBusinessInsightAction({
    insightId: 'accept-stats-2',
    insightType: 'review_anchor',
    entityType: 'anchor',
    entityId: 'a-stats',
    entityName: '统计主播',
    ...range,
    status: 'ignored',
  })
  await upsertBusinessInsightAction({
    insightId: 'accept-stats-3',
    insightType: 'data_quality_warning',
    entityType: 'system',
    entityName: '数据维护',
    ...range,
    status: 'reviewed',
    reviewResult: '已复盘',
  })

  const stats = await getBusinessInsightActionStats({
    startDate: range.rangeStartDate,
    endDate: range.rangeEndDate,
    scope: range.scope,
  })

  const { summary } = stats
  assert(summary.total >= 3, '统计 total 应包含测试记录', issues)
  assert(
    summary.total === summary.pending + summary.handled + summary.reviewed + summary.ignored,
    '统计总数应等于各状态相加',
    issues,
  )
  assert(
    summary.handleRate != null && summary.handleRate >= 0 && summary.handleRate <= 1,
    'handleRate 应为 0~1',
    issues,
  )
  assert(stats.byType.length > 0, 'byType 应有数据', issues)
  assert(stats.byEntityType.length > 0, 'byEntityType 应有数据', issues)
  assert(stats.dailyTrend.length === 7, 'dailyTrend 应为 7 天', issues)

  const emptyStats = await getBusinessInsightActionStats({
    startDate: '2099-01-01',
    endDate: '2099-01-01',
    scope: 'daily',
  })
  assert(emptyStats.summary.total === 0, '空范围 total 应为 0', issues)
  assert(emptyStats.summary.handleRate === null, 'total=0 时 handleRate 应为 null', issues)
  assert(emptyStats.summary.ignoreRate === null, 'total=0 时 ignoreRate 应为 null', issues)

  const payloadBefore = mockPayload()
  const payloadAfter = await attachBusinessInsightActions(payloadBefore, {
    startDate: range.rangeStartDate,
    endDate: range.rangeEndDate,
    scope: range.scope,
  })
  assert(payloadBefore.items.length === payloadAfter.items.length, 'businessInsights 条数不变', issues)
  assert(
    JSON.stringify(payloadBefore.items[0]?.evidence) ===
      JSON.stringify(payloadAfter.items[0]?.evidence),
    'businessInsights evidence 不变',
    issues,
  )
  assert(payloadAfter.items[0]?.actionState != null, '仍可合并 actionState', issues)

  scanPrivacy(stats, issues)

  await prisma.operationsBusinessInsightAction.deleteMany({
    where: { insightId: { startsWith: 'accept-stats-' } },
  })

  if (issues.length > 0) {
    console.error('[operations-business-insight-action-stats-acceptance] FAIL')
    for (const i of issues) console.error(`  - ${i}`)
    process.exit(1)
  }
  console.log('[operations-business-insight-action-stats-acceptance] OK')
}

main().catch((err) => {
  console.error('[operations-business-insight-action-stats-acceptance] FAIL', err)
  process.exit(1)
})
