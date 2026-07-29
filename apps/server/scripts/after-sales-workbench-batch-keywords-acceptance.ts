/**
 * 售后工作台批量 keywords 解析验收（HAR fixture，无网络）
 * npx tsx apps/server/scripts/after-sales-workbench-batch-keywords-acceptance.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  AFTER_SALES_WORKBENCH_BATCH_MAX_ORDERS,
} from '../src/services/after-sales-queue.types'
import {
  buildWorkbenchRefundFromList,
  extractAfterSalesList,
  normalizeWorkbenchBatchOrderNos,
  recordMatchesOrderNo,
} from '../src/services/xhs-after-sales-workbench.service'
import { buildXhsRequestHash } from '../src/services/sync-request-audit.service'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

function main(): void {
  const fixturePath = path.join(
    __dirname,
    'fixtures',
    'after-sales-workbench-batch-keywords.json',
  )
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
    keywords: string[]
    payload: unknown
    expected: Array<{ orderNo: string; appliedAmountCent: number; returnsId: string }>
  }

  const list = extractAfterSalesList(fixture.payload)
  assert(list.length === 3, `after_sales 应有 3 条，实际 ${list.length}`)

  for (const exp of fixture.expected) {
    const matched = list.filter((r) => recordMatchesOrderNo(r, exp.orderNo))
    assert(matched.length >= 1, `${exp.orderNo} 应能匹配`)
    const rawApplied = Number(matched[0]?.applied_amount ?? 0)
    assert(
      Math.round(rawApplied * 100) === exp.appliedAmountCent,
      `${exp.orderNo} raw applied_amount 期望 ${exp.appliedAmountCent / 100} 实际 ${rawApplied}`,
    )
    assert(
      String(matched[0]?.returns_id ?? '') === exp.returnsId,
      `${exp.orderNo} returns_id`,
    )
    // HAR 样本为处理中售后：官方成功退款口径下 fetchStatus=empty、金额 0（与现 aggregate 一致）
    const refund = buildWorkbenchRefundFromList(list, exp.orderNo, 'test-shop')
    assert(refund.fetchStatus === 'empty', `${exp.orderNo} 处理中应为 empty`)
    assert(Array.isArray(refund.rawDetail) && refund.rawDetail.length >= 1, '应保留 rawDetail')
  }

  // 未命中单不得当成 success+0
  const miss = buildWorkbenchRefundFromList(list, 'P999999999999999999', 'test-shop')
  assert(miss.fetchStatus === 'empty', '未命中应为 empty')
  assert(miss.officialRefundAmountCent === 0, '未命中官方退款应为 0')

  const capped = normalizeWorkbenchBatchOrderNos([
    ...Array.from({ length: 40 }, (_, i) => `P${String(i).padStart(18, '0')}`),
    'bad',
    'P1',
    'P1',
  ])
  assert(capped.length === AFTER_SALES_WORKBENCH_BATCH_MAX_ORDERS, '硬上限 15')
  assert(new Set(capped).size === capped.length, '去重')

  const h1 = buildXhsRequestHash({
    apiName: 'after_sales_workbench',
    url: 'https://ark.xiaohongshu.com/api/edith/after-sales/returns/v3?keywords=P1,P2',
  })
  const h2 = buildXhsRequestHash({
    apiName: 'after_sales_workbench',
    url: 'https://ark.xiaohongshu.com/api/edith/after-sales/returns/v3?keywords=P3,P4',
  })
  const h3 = buildXhsRequestHash({
    apiName: 'after_sales_workbench',
    body: null,
  })
  assert(h1 !== h2, '不同 keywords 应不同 hash')
  assert(h1 !== h3, '带 url keywords 与无 url 应不同 hash')

  console.log('✓ after-sales-workbench-batch-keywords-acceptance')
}

main()
