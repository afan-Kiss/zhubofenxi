/**
 * 售后工作台批量 keywords 解析验收（HAR fixture，无网络）
 * npx tsx apps/server/scripts/after-sales-workbench-batch-keywords-acceptance.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  buildWorkbenchRefundFromList,
  chunkWorkbenchOrderNos,
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
    const refund = buildWorkbenchRefundFromList(list, exp.orderNo, 'test-shop')
    assert(refund.fetchStatus === 'success', `${exp.orderNo} 处理中详情应为 success`)
    assert((refund.matchedRecordCount ?? 0) >= 1, '应有 matchedRecordCount')
    assert(Array.isArray(refund.rawDetail) && refund.rawDetail.length >= 1, '应保留 rawDetail')
  }

  const miss = buildWorkbenchRefundFromList(list, 'P999999999999999999', 'test-shop')
  assert(miss.fetchStatus === 'empty', '未命中应为 empty')

  let threw = false
  try {
    normalizeWorkbenchBatchOrderNos(
      Array.from({ length: 11 }, (_, i) => `P${String(i).padStart(18, '0')}`),
    )
  } catch (e) {
    threw = String((e as Error).message).includes('BATCH_ORDER_LIMIT_EXCEEDED')
  }
  assert(threw, '超过10单应抛 BATCH_ORDER_LIMIT_EXCEEDED')

  const chunks = chunkWorkbenchOrderNos(
    Array.from({ length: 25 }, (_, i) => `P${String(i).padStart(18, '0')}`),
  )
  assert(chunks.length === 3, '25 单应分 3 块')
  assert(chunks[0]!.length === 10 && chunks[2]!.length === 5, '分块大小')
  assert(chunks.reduce((n, c) => n + c.length, 0) === 25, '分块不得丢单')

  const h1 = buildXhsRequestHash({
    apiName: 'after_sales_workbench',
    url: 'https://ark.xiaohongshu.com/api/edith/after-sales/returns/v3?keywords=P1,P2',
  })
  const h2 = buildXhsRequestHash({
    apiName: 'after_sales_workbench',
    url: 'https://ark.xiaohongshu.com/api/edith/after-sales/returns/v3?keywords=P3,P4',
  })
  assert(h1 !== h2, '不同 keywords 应不同 hash')

  console.log('✓ after-sales-workbench-batch-keywords-acceptance')
}

main()
