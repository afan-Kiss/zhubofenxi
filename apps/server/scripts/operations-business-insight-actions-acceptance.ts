/**
 * 经营建议处理状态验收
 * 用法: npm run accept:operations-business-insight-actions
 */
import './operations-acceptance-auth'
import {
  attachBusinessInsightActions,
  BusinessInsightActionValidationError,
  listBusinessInsightActions,
  mergeBusinessInsightActions,
  upsertBusinessInsightAction,
  validateUpsertBusinessInsightActionParams,
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
        id: 'review_product|ret1|2026-06-01|2026-06-07',
        type: 'review_product',
        priority: 'high',
        title: '复查高退货商品：测试商品',
        reason: '测试原因',
        suggestedAction: '测试动作',
        evidence: [{ label: '退货订单数', value: 2, source: 'product_ranking' }],
        relatedEntity: { type: 'product', id: 'ret1', name: '测试商品' },
        dataQuality: { reliable: true, confidence: 'high', warnings: [] },
      },
      {
        id: 'data_quality_slow_pool|2026-06-01|2026-06-07',
        type: 'data_quality_warning',
        priority: 'medium',
        title: '补充主推商品池',
        reason: '无候选池',
        suggestedAction: '维护 ProductDimension',
        evidence: [{ label: '状态', value: 'insufficient_data', source: 'operations_rankings' }],
        relatedEntity: { type: 'system', name: '数据维护' },
        dataQuality: { reliable: false, confidence: 'insufficient', warnings: [] },
      },
    ],
    dataQuality: { reliable: true, warnings: [] },
  }
}

async function main() {
  const issues: string[] = []
  const range = {
    rangeStartDate: '2026-06-01',
    rangeEndDate: '2026-06-07',
    scope: 'custom' as const,
  }

  try {
    validateUpsertBusinessInsightActionParams({
      insightId: 'x',
      insightType: 'review_product',
      entityType: 'product',
      entityName: '测试',
      ...range,
      status: 'bad_status',
    })
    issues.push('非法 status 应抛错')
  } catch (e) {
    assert(e instanceof BusinessInsightActionValidationError, '非法 status 异常类型不对', issues)
  }

  try {
    validateUpsertBusinessInsightActionParams({
      insightId: 'x',
      insightType: 'review_product',
      entityType: 'product',
      entityName: '测试',
      rangeStartDate: 'bad',
      rangeEndDate: '2026-06-07',
      scope: 'custom',
      status: 'pending',
    })
    issues.push('非法日期应抛错')
  } catch (e) {
    assert(e instanceof BusinessInsightActionValidationError, '非法日期异常类型不对', issues)
  }

  try {
    validateUpsertBusinessInsightActionParams({
      insightId: 'x',
      insightType: 'review_product',
      entityType: 'product',
      entityName: '测试',
      ...range,
      status: 'pending',
      note: 'x'.repeat(501),
    })
    issues.push('超长 note 应被拒绝')
  } catch (e) {
    assert(e instanceof BusinessInsightActionValidationError, '超长 note 异常类型不对', issues)
  }

  const created = await upsertBusinessInsightAction({
    insightId: 'accept-insight-1',
    insightType: 'review_product',
    entityType: 'product',
    entityId: 'p1',
    entityName: '验收商品',
    ...range,
    status: 'pending',
    note: '待跟进',
  })
  assert(created.status === 'pending', '创建 action 失败', issues)
  assert(created.note === '待跟进', '创建 note 不对', issues)

  const updated = await upsertBusinessInsightAction({
    insightId: 'accept-insight-1',
    insightType: 'review_product',
    entityType: 'product',
    entityId: 'p1',
    entityName: '验收商品',
    ...range,
    status: 'handled',
    note: '已联系主播',
    remindTomorrow: true,
  })
  assert(updated.status === 'handled', '更新 action 失败', issues)
  assert(updated.remindTomorrow === true, 'remindTomorrow 未保存', issues)

  const list = await listBusinessInsightActions({
    startDate: range.rangeStartDate,
    endDate: range.rangeEndDate,
    scope: range.scope,
  })
  const matched = list.filter((a) => a.insightId === 'accept-insight-1')
  assert(matched.length === 1, '同 insightId/dateRange/scope 不应重复创建', issues)

  const ignored = await upsertBusinessInsightAction({
    insightId: 'accept-insight-2',
    insightType: 'data_quality_warning',
    entityType: 'system',
    entityName: '数据维护',
    ...range,
    status: 'ignored',
  })
  assert(ignored.status === 'ignored', '忽略状态保存失败', issues)

  const mergedDefault = mergeBusinessInsightActions(mockPayload(), [])
  assert(
    mergedDefault.items.every((i) => i.actionState?.status === 'pending'),
    '默认 actionState 应为 pending',
    issues,
  )
  assert(
    mergedDefault.items.every((i) => i.evidence.length > 0),
    '合并后 evidence 不应丢失',
    issues,
  )

  const payload = mockPayload()
  payload.items[0].id = 'accept-insight-1'
  payload.items[1].id = 'accept-insight-2'

  const mergedHandled = mergeBusinessInsightActions(payload, [updated, ignored])
  assert(
    mergedHandled.items.find((i) => i.id === 'accept-insight-1')?.actionState?.status === 'handled',
    'handled 状态未合并',
    issues,
  )
  assert(
    mergedHandled.items.find((i) => i.id === 'accept-insight-2')?.actionState?.status === 'ignored',
    'ignored 状态未合并',
    issues,
  )

  const attached = await attachBusinessInsightActions(payload, {
    startDate: range.rangeStartDate,
    endDate: range.rangeEndDate,
    scope: range.scope,
  })
  assert(
    attached.items.find((i) => i.id === 'accept-insight-1')?.actionState?.status === 'handled',
    'attach 后应有 handled',
    issues,
  )
  assert(
    attached.items.find((i) => i.id === 'accept-insight-2')?.actionState?.status === 'ignored',
    'ignored 建议仍存在且状态正确',
    issues,
  )

  scanPrivacy({ actions: list, insights: attached }, issues)

  if (issues.length > 0) {
    console.error('[operations-business-insight-actions-acceptance] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[operations-business-insight-actions-acceptance] OK')
}

function scanPrivacy(payload: unknown, issues: string[]) {
  const json = JSON.stringify(payload)
  for (const f of PRIVACY_FIELDS) {
    assert(!json.includes(`"${f}"`), `响应含隐私字段 ${f}`, issues)
  }
}

main()
  .catch((e) => {
    console.error('[operations-business-insight-actions-acceptance] FAIL', e)
    process.exit(1)
  })
  .finally(async () => {
    const { prisma } = await import('../src/lib/prisma')
    await prisma.operationsBusinessInsightAction.deleteMany({
      where: { insightId: { startsWith: 'accept-insight-' } },
    })
    await prisma.$disconnect()
  })
