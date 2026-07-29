/**
 * npx tsx apps/server/scripts/after-sales-dedupe-key-stack-acceptance.ts
 * 验收：缺 returns_id 的深嵌套售后行去重不得再 JSON.stringify 炸栈
 */
import { aggregateClassifiedAfterSalesForOrder } from '../src/services/classify-after-sale-record.service'
import { classifyWorkbenchQueueError } from '../src/services/after-sales-queue.service'
import {
  normalizeAfterSaleRecords,
  stableAfterSaleRecordDedupeKey,
} from '../src/services/strict-after-sale-metrics.service'
import { aggregateWorkbenchRefund } from '../src/services/xhs-after-sales-workbench.service'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

/** 构造会让 JSON.stringify 炸栈、但业务去重必须仍可用的深嵌套对象 */
function buildDeepNest(depth: number): Record<string, unknown> {
  let nest: Record<string, unknown> = { leaf: true }
  for (let i = 0; i < depth; i++) {
    nest = { nest, i }
  }
  return {
    delivery_package_id: 'P_STACK_TEST_001',
    status_name: '退款成功',
    reason: '不想要了',
    refund_fee: 12.34,
    refund_ok_time: '2026-07-29 12:00:00',
    // 业务字段在顶层；深嵌套挂在旁路字段上（贴近平台 payload）
    extraDeep: nest,
  }
}

const deep = buildDeepNest(12_000)

let stringifyExploded = false
try {
  JSON.stringify(deep)
} catch (e) {
  stringifyExploded = e instanceof RangeError || /call stack/i.test(String(e))
}
if (!stringifyExploded) {
  console.warn(
    '[warn] 本机 JSON.stringify(深嵌套) 未炸栈，仍验证浅层去重键路径不依赖 stringify',
  )
} else {
  console.log('对照：JSON.stringify(深嵌套) 会炸栈（符合预期）')
}

const key = stableAfterSaleRecordDedupeKey(deep)
assert(key.startsWith('combo:'), `缺 returns_id 时应走 combo 键，实际 ${key}`)
assert(key.includes('P_STACK_TEST_001'), `去重键应含包裹号，实际 ${key}`)

const normalized = normalizeAfterSaleRecords([deep, deep])
assert(normalized.length === 1, `去重后应为 1 条，实际 ${normalized.length}`)

const agg = aggregateWorkbenchRefund([deep], 'P_STACK_TEST_001')
assert(typeof agg.officialRefundAmountCent === 'number', 'aggregateWorkbenchRefund 应正常返回')
assert(!/call stack/i.test(agg.fetchError ?? ''), `不应写入栈溢出错误: ${agg.fetchError}`)

const classified = aggregateClassifiedAfterSalesForOrder([deep])
assert(typeof classified.productRefundAmountCent === 'number', 'classify 聚合应正常返回')

const cls = classifyWorkbenchQueueError('Maximum call stack size exceeded')
assert(cls.disposition === 'retry_wait', `栈溢出应可重试，实际 ${cls.disposition}`)

console.log('✓ after-sales-dedupe-key-stack-acceptance')
