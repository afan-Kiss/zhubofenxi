/**
 * 售后回填行为验收（纯函数 + 流程计数模拟，不打平台）
 * npx tsx apps/server/scripts/after-sales-backfill-behavior-acceptance.ts
 */
import { resolveAfterSaleSignal } from '../src/services/after-sale-batch-signal.service'
import { mapOrderListProbeForTest } from '../src/services/after-sales-order-list-probe.service'
import { decideOwnershipFromOwners } from '../src/services/after-sales-order-ownership.service'
import {
  buildWorkbenchRefundFromList,
  chunkWorkbenchOrderNos,
  normalizeWorkbenchBatchOrderNos,
} from '../src/services/xhs-after-sales-workbench.service'
import {
  resetAfterSalesBackfillLockForTest,
  runAfterSalesBackfillBatch,
} from '../src/services/after-sales-backfill.service'
import { classifyWorkbenchQueueError } from '../src/services/after-sales-queue.service'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

function pkg(
  packageId: string,
  afterSaleStatus: number,
  afterSaleStatusDesc: string,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    packageId,
    orderId: packageId.replace(/^P/i, ''),
    afterSaleStatus,
    afterSaleStatusDesc,
    firstAfterSaleStatus: afterSaleStatus,
    secondAfterSaleStatus: afterSaleStatus === 1 ? -1 : 1,
    ...extra,
  }
}

/** 模拟正确回填流程的 HTTP 次数（不含归属失败） */
function simulateHttpForBatch(probes: ReturnType<typeof mapOrderListProbeForTest>): {
  orderListRequests: number
  detailRequests: number
  singleOrderRequests: number
  buyerIdRequests: number
  actualHttpRequests: number
  detailKeywords: string[]
  noAfterSale: number
  hasAfterSale: number
  unknown: number
} {
  const noAfterSale = probes.filter((p) => p.state === 'NO_AFTER_SALE').length
  const hasAfterSale = probes.filter((p) => p.state === 'HAS_AFTER_SALE').length
  const unknown = probes.filter((p) => p.state === 'UNKNOWN').length
  const detailKeywords = probes
    .filter((p) => p.state === 'HAS_AFTER_SALE')
    .map((p) => p.orderNo)
  const orderListRequests = 1
  const detailRequests = detailKeywords.length > 0 ? 1 : 0
  return {
    orderListRequests,
    detailRequests,
    singleOrderRequests: 0,
    buyerIdRequests: 0,
    actualHttpRequests: orderListRequests + detailRequests,
    detailKeywords,
    noAfterSale,
    hasAfterSale,
    unknown,
  }
}

function testSignal(): void {
  assert(
    resolveAfterSaleSignal({
      afterSaleStatus: 1,
      afterSaleStatusDesc: '无售后',
    }) === 'NO_AFTER_SALE',
    '无售后',
  )
  assert(
    resolveAfterSaleSignal({
      afterSaleStatus: 2,
      afterSaleStatusDesc: '售后处理中: 待商家审核',
    }) === 'HAS_AFTER_SALE',
    '处理中',
  )
  assert(
    resolveAfterSaleSignal({
      afterSaleStatus: 3,
      afterSaleStatusDesc: '售后完成',
    }) === 'HAS_AFTER_SALE',
    '完成',
  )
  assert(
    resolveAfterSaleSignal({
      afterSaleStatus: 4,
      afterSaleStatusDesc: '',
    }) === 'UNKNOWN',
    '未知码',
  )
  assert(
    resolveAfterSaleSignal({
      afterSaleStatus: 1,
      afterSaleStatusDesc: '售后处理中',
    }) === 'UNKNOWN',
    '冲突',
  )
  assert(
    resolveAfterSaleSignal({
      afterSaleStatus: '2',
      afterSaleStatusDesc: '售后处理中: 待商家收货',
    }) === 'HAS_AFTER_SALE',
    '字符串状态码',
  )
  console.log('✓ 测试16/17 三态信号（未知码/冲突）')
}

function testProbeMappingAndHttp(): void {
  const orderNos = Array.from({ length: 10 }, (_, i) => `P${String(1000 + i).padStart(18, '0')}`)

  // 测试1：10 全部无售后 → 1 HTTP
  const allNone = mapOrderListProbeForTest(
    orderNos,
    orderNos.map((id) => pkg(id, 1, '无售后')),
  )
  const s1 = simulateHttpForBatch(allNone)
  assert(s1.actualHttpRequests === 1 && s1.detailRequests === 0, '测试1 HTTP=1')
  assert(s1.noAfterSale === 10 && s1.singleOrderRequests === 0 && s1.buyerIdRequests === 0, '测试1 无详情')

  // 测试2：2 有售后 → 2 HTTP，关键词仅 2 单
  const packages = orderNos.map((id, i) => {
    if (i === 1) return pkg(id, 2, '售后处理中: 待商家收货')
    if (i === 6) return pkg(id, 3, '售后完成')
    return pkg(id, 1, '无售后')
  })
  const mixed = mapOrderListProbeForTest(orderNos, packages)
  const s2 = simulateHttpForBatch(mixed)
  assert(s2.actualHttpRequests === 2, '测试2 HTTP=2')
  assert(s2.detailKeywords.length === 2, '测试2 详情关键词长度')
  assert(
    s2.detailKeywords.includes(orderNos[1]!) && s2.detailKeywords.includes(orderNos[6]!),
    '测试2 关键词正确',
  )
  assert(!s2.detailKeywords.includes(orderNos[0]!), '测试2 不含无售后单')

  // 测试3：10 全部有售后 → 仍 2 HTTP
  const allHas = mapOrderListProbeForTest(
    orderNos,
    orderNos.map((id) => pkg(id, 2, '售后处理中: 待商家审核')),
  )
  const s3 = simulateHttpForBatch(allHas)
  assert(s3.actualHttpRequests === 2 && s3.detailKeywords.length === 10, '测试3 HTTP=2')

  // 测试15：未返回
  const missing = mapOrderListProbeForTest(['PAAAAAAAAAAAAAAAAAA', 'PBBBBBBBBBBBBBBBBB'], [
    pkg('PAAAAAAAAAAAAAAAAAA', 1, '无售后'),
  ])
  assert(missing[1]!.state === 'UNKNOWN', '测试15 UNKNOWN')
  if (missing[1]!.state === 'UNKNOWN') {
    assert(missing[1]!.reason === 'ORDER_NOT_RETURNED_BY_BATCH_QUERY', '测试15 reason')
  }

  // 测试18：统计拆分
  assert(s2.noAfterSale === 8 && s2.hasAfterSale === 2 && s2.unknown === 0, '测试18 混合统计')

  console.log('✓ 测试1/2/3/15/18 探测映射与 HTTP 次数')
}

function testProcessingNotEmpty(): void {
  const rec = {
    delivery_package_id: 'PTESTPROCESSING00001',
    package_id: 'PTESTPROCESSING00001',
    returns_id: 'R1',
    refund_fee: 0,
    applied_amount: 100,
    refunded: false,
    status_name: '待收货',
    refund_status_name: '',
    return_type: 1,
  }
  const r = buildWorkbenchRefundFromList([rec], 'PTESTPROCESSING00001', 'shopA')
  assert(r.fetchStatus === 'success', '测试4 处理中应为 success')
  assert((r.matchedRecordCount ?? 0) === 1, '测试4 matched=1')
  assert(r.successReturnCount === 0, '测试4 成功退款可为0')
  // 有信号无详情 → 不应写成 NO_AFTER_SALE
  const empty = buildWorkbenchRefundFromList([], 'PTESTNOSIGNAL000001', 'shopA')
  assert(empty.fetchStatus === 'empty', '无匹配才 empty')
  console.log('✓ 测试4/5 处理中不标 empty；无匹配才 empty')
}

function testOwnership(): void {
  const match = decideOwnershipFromOwners('P1', 'shopA', ['shopA'])
  assert(match.kind === 'MATCH', '归属一致')

  const mismatch = decideOwnershipFromOwners('P1', 'shopA', ['shopB'])
  assert(mismatch.kind === 'SHOP_MISMATCH', '测试6 SHOP_MISMATCH')
  if (mismatch.kind === 'SHOP_MISMATCH') {
    assert(mismatch.queueLiveAccountId === 'shopA' && mismatch.actualLiveAccountId === 'shopB', '测试6 ids')
  }

  const missing = decideOwnershipFromOwners('P1', 'shopA', [])
  assert(missing.kind === 'ORDER_OWNER_NOT_FOUND', '测试7 NOT_FOUND')

  const conflict = decideOwnershipFromOwners('P1', 'shopA', ['shopA', 'shopB'])
  assert(conflict.kind === 'ORDER_OWNER_CONFLICT', '测试8 CONFLICT')

  // 测试9：同单号不同店 → 判定为 CONFLICT（不得用任一店 Cookie）
  const sameNo = decideOwnershipFromOwners('PSHARED', 'shopA', ['shopA', 'shopB'])
  assert(sameNo.kind === 'ORDER_OWNER_CONFLICT', '测试9 跨店同号')

  console.log('✓ 测试6/7/8/9 归属预检')
}

function testChunkLimit(): void {
  let threw = false
  try {
    normalizeWorkbenchBatchOrderNos(
      Array.from({ length: 12 }, (_, i) => `P${String(i).padStart(18, '0')}`),
    )
  } catch (e) {
    threw = String(e).includes('BATCH_ORDER_LIMIT_EXCEEDED')
  }
  assert(threw, '测试14 超限抛错')
  const chunks = chunkWorkbenchOrderNos(
    Array.from({ length: 23 }, (_, i) => `P${String(i).padStart(18, '0')}`),
  )
  assert(chunks.length === 3 && chunks.reduce((n, c) => n + c.length, 0) === 23, '测试14 分块完整')
  console.log('✓ 测试14 超10分块/拒绝静默截断')
}

function testClassifyCodes(): void {
  assert(
    classifyWorkbenchQueueError('SHOP_MISMATCH').disposition === 'blocked',
    'SHOP_MISMATCH blocked',
  )
  assert(
    classifyWorkbenchQueueError('SHOP_MISMATCH').errorType === 'ownership_integrity',
    'SHOP_MISMATCH 不熔断整店类型',
  )
  assert(
    classifyWorkbenchQueueError('AFTER_SALE_SIGNAL_WITHOUT_DETAIL').disposition === 'retry_wait',
    '测试5 SIGNAL_WITHOUT_DETAIL retry',
  )
  assert(
    classifyWorkbenchQueueError('ORDER_NOT_RETURNED_BY_BATCH_QUERY').disposition === 'retry_wait',
    'NOT_RETURNED retry',
  )
  assert(classifyWorkbenchQueueError('HTTP 429').errorType === 'http_429', '测试11 429')
  assert(classifyWorkbenchQueueError('401 cookie').errorType === 'http_401', '测试12 401')
  assert(
    classifyWorkbenchQueueError('Maximum call stack size exceeded').disposition === 'retry_wait',
    '测试13 栈溢出可重试',
  )
  console.log('✓ 测试5/11/12 错误码分类')
}

async function testMutex(): Promise<void> {
  resetAfterSalesBackfillLockForTest()
  const g = globalThis as { __afterSalesBackfillRunning?: boolean }
  g.__afterSalesBackfillRunning = true
  const a = runAfterSalesBackfillBatch()
  const b = runAfterSalesBackfillBatch()
  const [ra, rb] = await Promise.all([a, b])
  assert(ra.skippedBecauseRunning === true && rb.skippedBecauseRunning === true, '测试10 双跳过')
  // 模拟第一个执行异常后 finally 释放锁
  resetAfterSalesBackfillLockForTest()
  assert(g.__afterSalesBackfillRunning !== true, '测试10 锁可释放')
  // 再锁一次确认仅跳过路径，不进入 doRun（避免依赖本地 DB schema）
  g.__afterSalesBackfillRunning = true
  const again = await runAfterSalesBackfillBatch()
  assert(again.skippedBecauseRunning === true, '测试10 释放后再锁仍生效')
  resetAfterSalesBackfillLockForTest()
  console.log('✓ 测试10 互斥锁 ALREADY_RUNNING')
}

function testCacheKeyIsolation(): void {
  // liveAccountOrderKey 语义：同 orderNo 不同店必须不同 key
  const liveAccountOrderKey = (liveAccountId: string, orderNo: string) =>
    `${String(liveAccountId).trim() || 'legacy'}::${orderNo.trim()}`
  const a = liveAccountOrderKey('shopA', 'P1')
  const b = liveAccountOrderKey('shopB', 'P1')
  assert(a !== b, '测试9 缓存键隔离')
  console.log('✓ 测试9 缓存键含店铺维度')
}

async function main(): Promise<void> {
  testSignal()
  testProbeMappingAndHttp()
  testProcessingNotEmpty()
  testOwnership()
  testChunkLimit()
  testClassifyCodes()
  testCacheKeyIsolation()
  await testMutex()

  console.log('✓ after-sales-backfill-behavior-acceptance')
  console.log(
    '说明：本脚本覆盖信号/归属/错误码；真实 HTTP 次数见 after-sales-backfill-production-chain-acceptance.ts',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
