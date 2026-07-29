/**
 * 售后回填稳定性验收：拒绝/取消/关闭、分页边界、schema 阻断、网络计数
 * npx tsx apps/server/scripts/after-sales-stability-acceptance.ts
 */
import {
  decideAfterSalesPagination,
  parseFiniteNonNegativeInt,
} from '../src/services/after-sales-pagination.service'
import {
  resolveWorkbenchRecordLifecycle,
} from '../src/services/workbench-record-lifecycle.service'
import {
  buildWorkbenchRefundFromList,
  fetchAfterSalesWorkbenchByOrderNosWithMeta,
} from '../src/services/xhs-after-sales-workbench.service'
import {
  resetAfterSalesHttpDepsForTest,
  setAfterSalesHttpDepsForTest,
  type AfterSalesHttpCallParams,
  type AfterSalesHttpExecutionResult,
} from '../src/services/after-sales-http-deps'
import { AfterSalesRequestError } from '../src/services/after-sales-request-error'
import {
  resetAfterSalesBackfillLockForTest,
  runAfterSalesBackfillBatch,
  setAfterSalesBackfillDepsForTest,
} from '../src/services/after-sales-backfill.service'
import {
  ensureAfterSalesQueueSchemaOnce,
  ensureAfterSalesSchemaOnce,
  resetAfterSalesQueueSchemaEnsureForTest,
  getAfterSalesQueueSchemaState,
} from '../src/services/after-sales-queue-schema-ensure.service'
import {
  resolveWorkbenchCacheTtl,
  WORKBENCH_SUCCESS_TTL_IN_PROGRESS_MS,
  WORKBENCH_SUCCESS_TTL_TERMINAL_MS,
} from '../src/services/workbench-cache-validity.service'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

function orderNo(i: number): string {
  return `P${String(i).padStart(18, '0')}`
}

function okResult(payload: unknown): AfterSalesHttpExecutionResult {
  return { payload, networkSent: true, decision: 'network_success' }
}

function cleanup(): void {
  resetAfterSalesHttpDepsForTest()
  setAfterSalesBackfillDepsForTest(null)
  resetAfterSalesBackfillLockForTest()
  resetAfterSalesQueueSchemaEnsureForTest()
}

async function harness(name: string, fn: () => Promise<void> | void): Promise<void> {
  cleanup()
  try {
    await fn()
    console.log(`✓ ${name}`)
  } finally {
    cleanup()
  }
}

async function testRejected(): Promise<void> {
  const no = orderNo(1)
  const rec = {
    delivery_package_id: no,
    returns_id: 'R1',
    status_name: '审核拒绝',
    reason: '商品不符合退货条件',
    refunded: false,
    return_type: 1,
  }
  assert(resolveWorkbenchRecordLifecycle(rec) === 'REJECTED', 'lifecycle REJECTED')
  const r = buildWorkbenchRefundFromList([rec], no, 'shopA')
  assert(r.fetchStatus === 'success', 'fetchStatus success')
  assert((r.matchedRecordCount ?? 0) === 1, 'matched=1')
  assert((r.rejectedRecordCount ?? 0) === 1, 'rejected=1')
  assert(r.successReturnCount === 0, 'successReturn=0')
  assert(r.officialRefundAmountCent === 0, 'amount=0')
  assert(r.returnsIds.includes('R1'), 'returnsIds')
  assert(String(r.afterSaleStatus).includes('审核拒绝'), 'status')
}

async function testCanceled(): Promise<void> {
  const no = orderNo(2)
  const r = buildWorkbenchRefundFromList(
    [
      {
        delivery_package_id: no,
        returns_id: 'R2',
        status_name: '买家取消售后',
        refunded: false,
        return_type: 1,
        reason: '不想要了',
      },
    ],
    no,
    'shopA',
  )
  assert(r.fetchStatus === 'success', 'success')
  assert((r.canceledRecordCount ?? 0) === 1, 'canceled=1')
  assert(r.officialRefundAmountCent === 0, 'amount0')
}

async function testClosed(): Promise<void> {
  const no = orderNo(3)
  const r = buildWorkbenchRefundFromList(
    [
      {
        delivery_package_id: no,
        returns_id: 'R3',
        status_name: '售后关闭',
        refunded: false,
        return_type: 2,
      },
    ],
    no,
    'shopA',
  )
  assert(r.fetchStatus === 'success', 'success')
  assert((r.closedRecordCount ?? 0) === 1, 'closed=1')
  assert(r.fetchStatus !== 'empty', 'not empty')
}

async function testShortPage(): Promise<void> {
  const nos = [orderNo(1)]
  let hits = 0
  setAfterSalesHttpDepsForTest({
    cookieProvider: async () => 'c',
    waitShopSlot: async () => undefined,
    httpExecutor: async (p) => {
      hits++
      const page = Number(new URL(p.url).searchParams.get('page') || '1')
      if (page === 1) {
        return okResult({
          data: {
            total_count: 45,
            after_sales: Array.from({ length: 20 }, (_, i) => ({
              delivery_package_id: nos[0],
              returns_id: `R${i}`,
              status_name: '售后完成',
              refunded: true,
              refund_fee: 1,
            })),
          },
        })
      }
      return okResult({
        data: {
          total_count: 45,
          after_sales: Array.from({ length: 10 }, (_, i) => ({
            delivery_package_id: nos[0],
            returns_id: `R${20 + i}`,
            status_name: '售后完成',
            refunded: true,
            refund_fee: 1,
          })),
        },
      })
    },
  })
  let err: unknown
  try {
    await fetchAfterSalesWorkbenchByOrderNosWithMeta(nos, 'shopA')
  } catch (e) {
    err = e
  }
  assert(err instanceof AfterSalesRequestError, 'err type')
  assert(String((err as Error).message).includes('PAGINATION_INCOMPLETE_SHORT_PAGE'), 'short')
  assert((err as AfterSalesRequestError).requestAttempts === 2, 'attempts=2')
  assert(hits === 2, 'hits=2')
}

async function testEmptyPage(): Promise<void> {
  const nos = [orderNo(1)]
  setAfterSalesHttpDepsForTest({
    cookieProvider: async () => 'c',
    waitShopSlot: async () => undefined,
    httpExecutor: async (p) => {
      const page = Number(new URL(p.url).searchParams.get('page') || '1')
      if (page === 1) {
        return okResult({
          data: {
            total_count: 45,
            after_sales: Array.from({ length: 20 }, (_, i) => ({
              delivery_package_id: nos[0],
              returns_id: `E${i}`,
              status_name: '售后完成',
              refunded: true,
              refund_fee: 1,
            })),
          },
        })
      }
      return okResult({ data: { total_count: 45, after_sales: [] } })
    },
  })
  let err: unknown
  try {
    await fetchAfterSalesWorkbenchByOrderNosWithMeta(nos, 'shopA')
  } catch (e) {
    err = e
  }
  assert(String((err as Error).message).includes('PAGINATION_INCOMPLETE_EMPTY_PAGE'), 'empty')
}

async function testStringTotal(): Promise<void> {
  const nos = [orderNo(1), orderNo(2)]
  let hits = 0
  setAfterSalesHttpDepsForTest({
    cookieProvider: async () => 'c',
    waitShopSlot: async () => undefined,
    httpExecutor: async (p) => {
      hits++
      const page = Number(new URL(p.url).searchParams.get('page') || '1')
      const start = (page - 1) * 20
      const rows = Array.from({ length: 20 }, (_, i) => {
        const idx = start + i
        if (idx >= 45) return null
        return {
          delivery_package_id: nos[idx % 2]!,
          returns_id: `S${idx}`,
          status_name: '售后完成',
          refunded: true,
          refund_fee: 1,
        }
      }).filter(Boolean)
      return okResult({ data: { total_count: '45', after_sales: rows } })
    },
  })
  const { requestAttempts, results } = await fetchAfterSalesWorkbenchByOrderNosWithMeta(nos, 'shopA')
  assert(requestAttempts === 3, `3 pages got=${requestAttempts}`)
  assert(hits === 3, 'hits3')
  assert(results.size === 2, '2 orders')
  assert(parseFiniteNonNegativeInt('45') === 45, 'parse45')
  assert(parseFiniteNonNegativeInt('45.0') === 45, 'parse45.0')
  assert(parseFiniteNonNegativeInt('abc') == null, 'parse abc')
  assert(parseFiniteNonNegativeInt(-1) == null, 'parse -1')
}

async function testNoTotalFull10(): Promise<void> {
  const nos = [orderNo(1)]
  let hits = 0
  setAfterSalesHttpDepsForTest({
    cookieProvider: async () => 'c',
    waitShopSlot: async () => undefined,
    httpExecutor: async (p) => {
      hits++
      const page = Number(new URL(p.url).searchParams.get('page') || '1')
      return okResult({
        data: {
          after_sales: Array.from({ length: 20 }, (_, i) => ({
            delivery_package_id: nos[0],
            returns_id: `N${(page - 1) * 20 + i}`,
            status_name: '售后完成',
            refunded: true,
            refund_fee: 1,
          })),
        },
      })
    },
  })
  let err: unknown
  try {
    await fetchAfterSalesWorkbenchByOrderNosWithMeta(nos, 'shopA')
  } catch (e) {
    err = e
  }
  assert(String((err as Error).message).includes('PAGINATION_INCOMPLETE_TOTAL_UNKNOWN'), 'unknown')
  assert((err as AfterSalesRequestError).requestAttempts === 10, 'attempts10')
  assert(hits === 10, 'hits10')
}

async function testPageLoop(): Promise<void> {
  const seen = new Set<string>()
  const d1 = decideAfterSalesPagination({
    page: 1,
    pageSize: 20,
    pageRowsLength: 20,
    totalCount: null,
    rawFetchedCount: 20,
    uniqueFetchedCount: 20,
    pageHardLimit: 10,
    pageFingerprint: 'A',
    seenFingerprints: seen,
  })
  assert(d1.action === 'continue', 'p1 continue')
  seen.add('A')
  const d2 = decideAfterSalesPagination({
    page: 2,
    pageSize: 20,
    pageRowsLength: 20,
    totalCount: null,
    rawFetchedCount: 40,
    uniqueFetchedCount: 40,
    pageHardLimit: 10,
    pageFingerprint: 'B',
    seenFingerprints: seen,
  })
  assert(d2.action === 'continue', 'p2 continue')
  seen.add('B')
  const d3 = decideAfterSalesPagination({
    page: 3,
    pageSize: 20,
    pageRowsLength: 20,
    totalCount: null,
    rawFetchedCount: 60,
    uniqueFetchedCount: 60,
    pageHardLimit: 10,
    pageFingerprint: 'A',
    seenFingerprints: seen,
  })
  assert(d3.action === 'fail' && d3.code === 'PAGINATION_STALLED', 'stalled')

  // 集成：HTTP 页指纹循环
  const nos = [orderNo(9)]
  setAfterSalesHttpDepsForTest({
    cookieProvider: async () => 'c',
    waitShopSlot: async () => undefined,
    httpExecutor: async (p) => {
      const page = Number(new URL(p.url).searchParams.get('page') || '1')
      const mk = (prefix: string) =>
        Array.from({ length: 20 }, (_, i) => ({
          delivery_package_id: nos[0],
          returns_id: `${prefix}${i}`,
          status_name: '售后完成',
          refunded: true,
          refund_fee: 1,
        }))
      if (page === 1) return okResult({ data: { after_sales: mk('A') } })
      if (page === 2) return okResult({ data: { after_sales: mk('B') } })
      return okResult({ data: { after_sales: mk('A') } })
    },
  })
  let err: unknown
  try {
    await fetchAfterSalesWorkbenchByOrderNosWithMeta(nos, 'shopA')
  } catch (e) {
    err = e
  }
  assert(String((err as Error).message).includes('PAGINATION_STALLED'), 'http stalled')
}

async function testSchemaBlock(): Promise<void> {
  let selectCalled = 0
  let recoverCalled = 0
  let cookieCalled = 0
  setAfterSalesBackfillDepsForTest({
    ensureSchema: async () => {
      throw new Error('ALTER TABLE failed: no such table')
    },
    getApiSyncEnabled: async () => true,
    recoverStuck: async () => {
      recoverCalled++
    },
    selectTasks: async () => {
      selectCalled++
      return []
    },
  })
  setAfterSalesHttpDepsForTest({
    cookieProvider: async () => {
      cookieCalled++
      return 'c'
    },
    waitShopSlot: async () => undefined,
    httpExecutor: async () => okResult({}),
  })
  const m = await runAfterSalesBackfillBatch()
  assert(m.schemaEnsureFailed === true, 'schemaEnsureFailed')
  assert(m.skippedReason === 'SCHEMA_ENSURE_FAILED', 'skippedReason')
  assert(selectCalled === 0, 'select not called')
  assert(recoverCalled === 0, 'recover not called')
  assert(cookieCalled === 0, 'cookie not called')
  assert(m.requestAttempts === 0 && m.networkRequests === 0, 'http=0')
}

async function testSchemaOnce(): Promise<void> {
  let runs = 0
  const fakeClient = {
    $queryRawUnsafe: async (q: string) => {
      if (String(q).includes('PRAGMA')) {
        runs++
        return [
          { name: 'id' },
          ...[
            'temporaryAttemptCount',
            'permanentFailureCount',
            'errorType',
            'nextAttemptAt',
            'lastAttemptAt',
            'completedAt',
            'runningSince',
            'workerId',
            'claimToken',
            'claimedAt',
            'statusChangedAt',
            'priority',
            'triggerReason',
            'signalDetectedAt',
            'matchedRecordCount',
            'processingRecordCount',
            'completedRecordCount',
            'rejectedRecordCount',
            'canceledRecordCount',
            'closedRecordCount',
            'recordLifecycleSummary',
          ].map((name) => ({ name })),
        ]
      }
      return []
    },
    $executeRawUnsafe: async () => 0,
  } as unknown as import('@prisma/client').PrismaClient

  resetAfterSalesQueueSchemaEnsureForTest()
  // monkey: call ensure with client via direct ensureAfterSalesQueueSchemaOnce
  // Once 绑定全局；第一次用 fake client
  const { ensureAfterSalesQueueSchema } = await import(
    '../src/services/after-sales-queue-schema-ensure.service'
  )
  // 用 ensureOnce 包装：手动设置 once promise
  resetAfterSalesQueueSchemaEnsureForTest()
  const p1 = ensureAfterSalesQueueSchema({ client: fakeClient, dryRun: true })
  const p2 = ensureAfterSalesQueueSchema({ client: fakeClient, dryRun: true })
  await Promise.all([p1, p2])
  // dryRun 各自独立；Once 单例测：
  resetAfterSalesQueueSchemaEnsureForTest()
  let alterCount = 0
  const onceClient = {
    $queryRawUnsafe: async (q: string) => {
      if (String(q).includes('PRAGMA')) {
        alterCount++
        const table = String(q)
        if (table.includes('Queue')) {
          return [{ name: 'id' }, { name: 'priority' }, ...Array.from({ length: 13 }, (_, i) => ({ name: `c${i}` }))]
        }
        return [{ name: 'id' }, { name: 'matchedRecordCount' }]
      }
      return []
    },
    $executeRawUnsafe: async () => {
      alterCount += 10
      return 0
    },
  } as unknown as import('@prisma/client').PrismaClient

  // 补齐 PRAGMA 返回所有列，避免 ALTER
  const allQueue = [
    'id',
    'temporaryAttemptCount',
    'permanentFailureCount',
    'errorType',
    'nextAttemptAt',
    'lastAttemptAt',
    'completedAt',
    'runningSince',
    'workerId',
    'claimToken',
    'claimedAt',
    'statusChangedAt',
    'priority',
    'triggerReason',
    'signalDetectedAt',
  ]
  const allCache = [
    'id',
    'matchedRecordCount',
    'processingRecordCount',
    'completedRecordCount',
    'rejectedRecordCount',
    'canceledRecordCount',
    'closedRecordCount',
    'unknownRecordCount',
    'recordLifecycleSummary',
  ]
  let pragmaCalls = 0
  const sharedClient = {
    $queryRawUnsafe: async (q: string) => {
      if (String(q).includes('PRAGMA')) {
        pragmaCalls++
        if (String(q).includes('Queue')) return allQueue.map((name) => ({ name }))
        return allCache.map((name) => ({ name }))
      }
      return []
    },
    $executeRawUnsafe: async () => 0,
  } as unknown as import('@prisma/client').PrismaClient

  resetAfterSalesQueueSchemaEnsureForTest()
  const a = ensureAfterSalesSchemaOnce({ client: sharedClient })
  const b = ensureAfterSalesSchemaOnce({ client: sharedClient })
  assert(a === b, 'same promise')
  await Promise.all([a, b])
  assert(pragmaCalls === 2, `pragma once-round got=${pragmaCalls}`) // queue+cache
  assert(getAfterSalesQueueSchemaState().status === 'ready', 'ready')
  void runs
  void alterCount
  void p1
  void p2
}

async function testSchemaRetryAfterFail(): Promise<void> {
  resetAfterSalesQueueSchemaEnsureForTest()
  let n = 0
  const client = {
    $queryRawUnsafe: async () => {
      n++
      if (n === 1) throw new Error('boom1')
      return [
        { name: 'id' },
        { name: 'priority' },
        { name: 'temporaryAttemptCount' },
        { name: 'permanentFailureCount' },
        { name: 'errorType' },
        { name: 'nextAttemptAt' },
        { name: 'lastAttemptAt' },
        { name: 'completedAt' },
        { name: 'runningSince' },
        { name: 'workerId' },
        { name: 'claimToken' },
        { name: 'claimedAt' },
        { name: 'statusChangedAt' },
        { name: 'triggerReason' },
        { name: 'signalDetectedAt' },
        { name: 'matchedRecordCount' },
        { name: 'processingRecordCount' },
        { name: 'completedRecordCount' },
        { name: 'rejectedRecordCount' },
        { name: 'canceledRecordCount' },
        { name: 'closedRecordCount' },
        { name: 'unknownRecordCount' },
        { name: 'recordLifecycleSummary' },
      ]
    },
    $executeRawUnsafe: async () => 0,
  } as unknown as import('@prisma/client').PrismaClient

  let firstErr = false
  try {
    await ensureAfterSalesSchemaOnce({ client })
  } catch {
    firstErr = true
  }
  assert(firstErr, 'first throws')
  assert(getAfterSalesQueueSchemaState().status === 'failed', 'failed state')
  // Once 已清空，第二次成功
  await ensureAfterSalesSchemaOnce({ client })
  assert(getAfterSalesQueueSchemaState().status === 'ready', 'ready after retry')
}

async function testNetworkCounters(): Promise<void> {
  const nos = [orderNo(1)]
  // 本地冷却：networkSent false
  setAfterSalesHttpDepsForTest({
    cookieProvider: async () => 'c',
    waitShopSlot: async () => undefined,
    httpExecutor: async () => {
      throw new AfterSalesRequestError({
        message: '页面接口禁止：冷却中',
        requestAttempts: 1,
        networkRequests: 0,
        networkSent: false,
        causeCode: 'local_throttled',
      })
    },
  })
  let err: unknown
  try {
    await fetchAfterSalesWorkbenchByOrderNosWithMeta(nos, 'shopA')
  } catch (e) {
    err = e
  }
  assert(err instanceof AfterSalesRequestError, 'throttled err')
  const te = err as AfterSalesRequestError
  assert(te.requestAttempts === 1, 'attempts=1')
  assert(te.networkRequests === 0, 'no network')
  assert(te.httpRequests === 0, 'http===network=0')
  assert(te.locallyThrottled >= 1, 'locallyThrottled')

  // 网络成功
  setAfterSalesHttpDepsForTest({
    cookieProvider: async () => 'c',
    waitShopSlot: async () => undefined,
    httpExecutor: async () =>
      okResult({
        data: {
          total_count: 1,
          after_sales: [
            {
              delivery_package_id: nos[0],
              returns_id: 'Rok',
              status_name: '审核拒绝',
              refunded: false,
              return_type: 1,
            },
          ],
        },
      }),
  })
  const ok = await fetchAfterSalesWorkbenchByOrderNosWithMeta(nos, 'shopA')
  assert(ok.requestAttempts === 1 && ok.networkRequests === 1, 'network success counts')
  assert(ok.httpRequests === ok.networkRequests, 'http===network')
  assert(ok.counters.actualHttpRequests === ok.counters.networkRequests, 'actual===network')
  assert(ok.results.get(nos[0]!)?.rejectedRecordCount === 1, 'rejected saved')

  // 网络429
  setAfterSalesHttpDepsForTest({
    cookieProvider: async () => 'c',
    waitShopSlot: async () => undefined,
    httpExecutor: async () => {
      throw new AfterSalesRequestError({
        message: 'HTTP 429',
        requestAttempts: 1,
        networkRequests: 1,
        networkSent: true,
        causeCode: 'http_429',
      })
    },
  })
  let err429: unknown
  try {
    await fetchAfterSalesWorkbenchByOrderNosWithMeta(nos, 'shopA')
  } catch (e) {
    err429 = e
  }
  const e429 = err429 as AfterSalesRequestError
  assert(e429.requestAttempts === 1 && e429.networkRequests === 1, '429 network counted')
  assert(e429.httpRequests === 1 && e429.locallyThrottled === 0, '429 not local')

  // Cookie 失败：attempts=0，执行器未调用
  let execCalls = 0
  setAfterSalesHttpDepsForTest({
    cookieProvider: async () => {
      throw new Error('Cookie 未配置')
    },
    waitShopSlot: async () => undefined,
    httpExecutor: async () => {
      execCalls++
      return okResult({})
    },
  })
  const cookieFail = await fetchAfterSalesWorkbenchByOrderNosWithMeta(nos, 'shopA')
  assert(cookieFail.requestAttempts === 0 && cookieFail.networkRequests === 0, 'cookie fail 0')
  assert(cookieFail.counters.actualHttpRequests === 0, 'actual 0')
  assert(execCalls === 0, 'executor not called')
}

async function testUnknownLifecycle(): Promise<void> {
  const no = orderNo(1)
  const rec = {
    delivery_package_id: no,
    returns_id: 'R-UNKNOWN-1',
    status: 999,
    status_name: '平台新增状态',
    reason: '未知流程',
    refunded: false,
    return_type: 1,
  }
  assert(resolveWorkbenchRecordLifecycle(rec) === 'UNKNOWN', 'lifecycle UNKNOWN')
  const r = buildWorkbenchRefundFromList([rec], no, 'shopA')
  assert(r.fetchStatus === 'success', 'success')
  assert((r.matchedRecordCount ?? 0) === 1, 'matched=1')
  assert((r.unknownRecordCount ?? 0) === 1, 'unknown=1')
  assert(r.successReturnCount === 0, 'successReturn=0')
  assert(r.officialRefundAmountCent === 0, 'amount0')
  assert(r.returnsIds.includes('R-UNKNOWN-1'), 'returnsIds')
  assert(String(r.afterSaleStatus).includes('平台新增状态'), 'status text')
  assert(String(r.recordLifecycleSummary).includes('UNKNOWN'), 'summary')

  const ttl = resolveWorkbenchCacheTtl(
    {
      fetchStatus: 'success',
      afterSaleStatus: '平台新增状态',
      unknownRecordCount: 1,
      recordLifecycleSummary: 'UNKNOWN',
      fetchedAt: new Date(),
      officialRefundAmountCent: 0,
      successReturnCount: 0,
    },
    { afterSaleStatusText: '平台新增状态' },
  )
  assert(ttl === WORKBENCH_SUCCESS_TTL_IN_PROGRESS_MS, `unknown short ttl got=${ttl}`)

  // 回填 done 不重试
  const shop = 'shopA'
  const completed: string[] = []
  setAfterSalesHttpDepsForTest({
    cookieProvider: async () => 'c',
    waitShopSlot: async () => undefined,
    httpExecutor: async (p: AfterSalesHttpCallParams) => {
      if (p.url.includes('/fulfillment/order/page')) {
        return okResult({
          data: {
            total: 1,
            packages: [
              {
                packageId: no,
                orderId: no.slice(1),
                afterSaleStatus: 2,
                afterSaleStatusDesc: '售后处理中',
                firstAfterSaleStatus: 2,
                secondAfterSaleStatus: 1,
              },
            ],
          },
        })
      }
      return okResult({ data: { total_count: 1, after_sales: [rec] } })
    },
  })
  setAfterSalesBackfillDepsForTest({
    ensureSchema: async () => ({ added: [], alreadyPresent: [] }),
    getApiSyncEnabled: async () => true,
    recoverStuck: async () => undefined,
    selectTasks: async () => [
      {
        id: 'q-unk',
        liveAccountId: shop,
        orderNo: no,
        temporaryAttemptCount: 0,
        claimToken: 'tok',
        workerId: 'w',
      },
    ],
    partitionOwnership: async (orderNos) => ({ matched: orderNos, mismatches: [] }),
    saveCache: async () => undefined,
    completeTask: async ({ orderNo: o, result }) => {
      completed.push(`${o}:${result.fetchStatus}`)
      return 'done'
    },
    releaseTasks: async () => undefined,
    openCircuit: async () => undefined,
    resolveAccountName: async (id) => id,
  })
  const m = await runAfterSalesBackfillBatch()
  assert(m.detailsSaved === 1, 'unknown detailsSaved')
  assert(completed[0] === `${no}:success`, 'done success')
  assert(m.retryWait === 0, 'not retry')
}

async function testSignalWithoutDetail(): Promise<void> {
  const shop = 'shopA'
  const no = orderNo(8)
  const other = orderNo(9)
  const tags: string[] = []
  setAfterSalesHttpDepsForTest({
    cookieProvider: async () => 'c',
    waitShopSlot: async () => undefined,
    httpExecutor: async (p: AfterSalesHttpCallParams) => {
      if (p.url.includes('/fulfillment/order/page')) {
        return okResult({
          data: {
            total: 1,
            packages: [
              {
                packageId: no,
                orderId: no.slice(1),
                afterSaleStatus: 2,
                afterSaleStatusDesc: '售后处理中',
                firstAfterSaleStatus: 2,
                secondAfterSaleStatus: 1,
              },
            ],
          },
        })
      }
      // 详情返回另一笔订单
      return okResult({
        data: {
          total_count: 1,
          after_sales: [
            {
              delivery_package_id: other,
              returns_id: 'R-OTHER',
              status_name: '审核拒绝',
              refunded: false,
              return_type: 1,
            },
          ],
        },
      })
    },
  })
  setAfterSalesBackfillDepsForTest({
    ensureSchema: async () => ({ added: [], alreadyPresent: [] }),
    getApiSyncEnabled: async () => true,
    recoverStuck: async () => undefined,
    selectTasks: async () => [
      {
        id: 'q-miss',
        liveAccountId: shop,
        orderNo: no,
        temporaryAttemptCount: 0,
        claimToken: 'tok',
        workerId: 'w',
      },
    ],
    partitionOwnership: async (orderNos) => ({ matched: orderNos, mismatches: [] }),
    saveCache: async () => undefined,
    completeTask: async ({ result }) => {
      tags.push(result.fetchError ?? result.fetchStatus)
      return result.fetchStatus === 'failed' ? 'retry_wait' : 'done'
    },
    releaseTasks: async () => undefined,
    openCircuit: async () => undefined,
    resolveAccountName: async (id) => id,
  })
  const m = await runAfterSalesBackfillBatch()
  assert(tags.some((t) => t.includes('AFTER_SALE_SIGNAL_WITHOUT_DETAIL')), 'signal without detail')
  assert(m.retryWait === 1, 'retry_wait')
  assert(m.detailsSaved === 0, 'no success cache')
}

async function testTerminalTtl(): Promise<void> {
  const ttl = resolveWorkbenchCacheTtl(
    {
      fetchStatus: 'success',
      afterSaleStatus: '审核拒绝',
      fetchedAt: new Date(),
      officialRefundAmountCent: 0,
      successReturnCount: 0,
    },
    { afterSaleStatusText: '审核拒绝' },
  )
  assert(ttl === WORKBENCH_SUCCESS_TTL_TERMINAL_MS, `terminal ttl got=${ttl}`)
  const ttlP = resolveWorkbenchCacheTtl(
    {
      fetchStatus: 'success',
      afterSaleStatus: '待商家收货',
      fetchedAt: new Date(),
      officialRefundAmountCent: 0,
      successReturnCount: 0,
    },
    { afterSaleStatusText: '待商家收货' },
  )
  assert(ttlP === WORKBENCH_SUCCESS_TTL_IN_PROGRESS_MS, `processing ttl got=${ttlP}`)
}

async function testCountFieldsFromRawDetail(): Promise<void> {
  const no = orderNo(11)
  const raw = [
    {
      delivery_package_id: no,
      returns_id: 'Ra',
      status_name: '待商家收货',
      refunded: false,
      return_type: 1,
    },
    {
      delivery_package_id: no,
      returns_id: 'Rb',
      status_name: '售后完成',
      refunded: true,
      refund_fee: 10,
      return_type: 1,
    },
    {
      delivery_package_id: no,
      returns_id: 'Rc',
      status_name: '审核拒绝',
      refunded: false,
      return_type: 1,
    },
  ]
  const built = buildWorkbenchRefundFromList(raw, no, 'shopA')
  assert((built.matchedRecordCount ?? 0) === 3, 'matched3')
  assert((built.processingRecordCount ?? 0) === 1, 'proc1')
  assert((built.completedRecordCount ?? 0) === 1, 'comp1')
  assert((built.rejectedRecordCount ?? 0) === 1, 'rej1')
  // 模拟 DB 行仅有 rawDetail、数量列为0时，row 路径应能从 rawDetail 重建
  const { aggregateWorkbenchRefund } = await import(
    '../src/services/xhs-after-sales-workbench.service'
  )
  const rebuilt = aggregateWorkbenchRefund(raw as Record<string, unknown>[], no)
  assert((rebuilt.matchedRecordCount ?? 0) === 3, 'rebuild matched')
  assert((rebuilt.rejectedRecordCount ?? 0) === 1, 'rebuild rejected')
}

async function testRejectedBackfillDone(): Promise<void> {
  const shop = 'shopA'
  const no = orderNo(7)
  const saved: unknown[] = []
  const completed: string[] = []
  setAfterSalesHttpDepsForTest({
    cookieProvider: async () => 'c',
    waitShopSlot: async () => undefined,
    httpExecutor: async (p: AfterSalesHttpCallParams) => {
      if (p.url.includes('/fulfillment/order/page')) {
        return okResult({
          data: {
            total: 1,
            packages: [
              {
                packageId: no,
                orderId: no.slice(1),
                afterSaleStatus: 2,
                afterSaleStatusDesc: '售后处理中: 审核中',
                firstAfterSaleStatus: 2,
                secondAfterSaleStatus: 1,
              },
            ],
          },
        })
      }
      return okResult({
        data: {
          total_count: 1,
          after_sales: [
            {
              delivery_package_id: no,
              returns_id: 'Rrej',
              status_name: '审核拒绝',
              reason: '不符合',
              refunded: false,
              return_type: 1,
              user_id: 'u1',
            },
          ],
        },
      })
    },
  })
  setAfterSalesBackfillDepsForTest({
    ensureSchema: async () => ({ added: [], alreadyPresent: [] }),
    getApiSyncEnabled: async () => true,
    recoverStuck: async () => undefined,
    selectTasks: async () => [
      {
        id: 'q1',
        liveAccountId: shop,
        orderNo: no,
        temporaryAttemptCount: 0,
        claimToken: 'tok',
        workerId: 'w',
      },
    ],
    partitionOwnership: async (orderNos) => ({ matched: orderNos, mismatches: [] }),
    saveCache: async (r) => {
      saved.push(r)
    },
    completeTask: async ({ orderNo: o, result }) => {
      completed.push(`${o}:${result.fetchStatus}`)
      return 'done'
    },
    releaseTasks: async () => undefined,
    openCircuit: async () => undefined,
    resolveAccountName: async (id) => id,
  })
  const m = await runAfterSalesBackfillBatch()
  assert(m.detailsSaved === 1, `detailsSaved got=${m.detailsSaved}`)
  assert(completed[0] === `${no}:success`, 'done success')
  const s = saved[0] as { rejectedRecordCount?: number; fetchStatus: string }
  assert(s.fetchStatus === 'success' && (s.rejectedRecordCount ?? 0) === 1, 'rejected persisted shape')
  assert(!completed.some((x) => x.includes('empty')), 'not empty')
}

async function main(): Promise<void> {
  await harness('审核拒绝真实售后', testRejected)
  await harness('买家取消真实售后', testCanceled)
  await harness('售后关闭真实售后', testClosed)
  await harness('已知total短页失败', testShortPage)
  await harness('已知total空页失败', testEmptyPage)
  await harness('字符串total完整分页', testStringTotal)
  await harness('无total满10页失败', testNoTotalFull10)
  await harness('分页循环STALLED', testPageLoop)
  await harness('schema失败阻断回填', testSchemaBlock)
  await harness('schema Once并发单例', testSchemaOnce)
  await harness('schema失败后可重试', testSchemaRetryAfterFail)
  await harness('网络计数拆分', testNetworkCounters)
  await harness('UNKNOWN生命周期done短TTL', testUnknownLifecycle)
  await harness('详情无匹配SIGNAL_WITHOUT_DETAIL', testSignalWithoutDetail)
  await harness('终端态TTL', testTerminalTtl)
  await harness('数量字段可从rawDetail重建', testCountFieldsFromRawDetail)
  await harness('拒绝售后回填done不重试', testRejectedBackfillDone)
  console.log('✓ after-sales-stability-acceptance')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
