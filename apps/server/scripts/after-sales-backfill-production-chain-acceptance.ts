/**
 * 售后回填生产链路验收（mock HTTP，调用真实生产函数）
 * npx tsx apps/server/scripts/after-sales-backfill-production-chain-acceptance.ts
 */
import {
  resetAfterSalesBackfillLockForTest,
  runAfterSalesBackfillBatch,
  setAfterSalesBackfillDepsForTest,
  type AfterSalesBatchMetrics,
} from '../src/services/after-sales-backfill.service'
import {
  resetAfterSalesHttpDepsForTest,
  setAfterSalesHttpDepsForTest,
  type AfterSalesHttpCallParams,
} from '../src/services/after-sales-http-deps'
import {
  buildWorkbenchPageUrl,
  buildWorkbenchRefundFromList,
  fetchAfterSalesWorkbenchByOrderNos,
  fetchAfterSalesWorkbenchByOrderNosWithMeta,
  partitionWorkbenchOrderNos,
} from '../src/services/xhs-after-sales-workbench.service'
import { liveAccountOrderKey } from '../src/utils/live-account-cache-key.util'
import {
  AFTER_SALES_SHOP_MIN_GAP_MS,
  resetShopEndpointSlotsForTest,
  waitShopPlatformSlot,
} from '../src/services/after-sales-shop-rate.service'
import { AfterSalesRequestError } from '../src/services/after-sales-request-error'
import type { SelectedAfterSalesQueueTask } from '../src/services/after-sales-queue.service'
import type { AfterSalesWorkbenchRefund } from '../src/services/xhs-after-sales-workbench.service'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

function orderNo(i: number): string {
  return `P${String(i).padStart(18, '0')}`
}

function task(liveAccountId: string, no: string, id: string): SelectedAfterSalesQueueTask {
  return {
    id,
    liveAccountId,
    orderNo: no,
    temporaryAttemptCount: 0,
    claimToken: `tok-${id}`,
    workerId: 'test-worker',
  }
}

function pkg(no: string, status: number, desc: string): Record<string, unknown> {
  return {
    packageId: no,
    orderId: no.replace(/^P/i, ''),
    afterSaleStatus: status,
    afterSaleStatusDesc: desc,
    firstAfterSaleStatus: status,
    secondAfterSaleStatus: status === 1 ? -1 : 1,
  }
}

function processingDetail(no: string): Record<string, unknown> {
  return {
    delivery_package_id: no,
    package_id: no,
    returns_id: `R-${no.slice(-6)}`,
    refund_fee: 0,
    applied_amount: 88.5,
    refunded: false,
    status_name: '待商家收货',
    refund_status_name: '',
    return_type: 1,
    reason: '质量问题',
    user_id: 'buyer-uid-001',
  }
}

function cleanup(): void {
  resetAfterSalesHttpDepsForTest()
  setAfterSalesBackfillDepsForTest(null)
  resetAfterSalesBackfillLockForTest()
  resetShopEndpointSlotsForTest()
}

async function testHarness(
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  cleanup()
  try {
    await fn()
    console.log(`✓ ${name}`)
  } finally {
    cleanup()
  }
}

/** 场景：URL 对齐 HAR */
async function testHarUrl(): Promise<void> {
  const url = buildWorkbenchPageUrl({
    keywords: 'P1,P2',
    page: 1,
    pageSize: 20,
  })
  const u = new URL(url)
  assert(u.pathname.endsWith('/after-sales/returns/v3'), 'path')
  assert(u.searchParams.get('keywords') === 'P1,P2', 'keywords')
  assert(u.searchParams.get('page') === '1', 'page')
  assert(u.searchParams.get('number') === '20', 'number')
  assert(u.searchParams.get('sort') === 'deadline_for_sort_v1', 'sort')
  assert(u.searchParams.get('order') === 'asc', 'order')
  assert(u.searchParams.has('status_in'), 'status_in exists')
  assert(u.searchParams.get('status_in') === '', 'status_in empty')
  assert(!u.search.includes('goods_source'), 'no goods_source')
  assert(!u.searchParams.has('return_type_in'), 'no return_type_in')
}

/** 场景：进行中结构化字段 */
async function testProcessingStructured(): Promise<void> {
  const no = orderNo(1)
  const r = buildWorkbenchRefundFromList([processingDetail(no)], no, 'shopA')
  assert(r.fetchStatus === 'success', 'success')
  assert((r.matchedRecordCount ?? 0) === 1, 'matched=1')
  assert(r.successReturnCount === 0, 'successReturn=0')
  assert(r.officialRefundAmountCent === 0, 'refund amount 0')
  assert(r.returnsIds.includes(`R-${no.slice(-6)}`), 'returnsIds')
  assert(String(r.afterSaleStatus).includes('待商家收货') || String(r.afterSaleStatus).includes('待收货'), 'status')
  assert(!!r.afterSaleReason, 'reason')
  assert(r.buyerUserId === 'buyer-uid-001', 'buyer')
  assert(r.afterSaleType !== 'none' || (r.returnTypeCodes ?? '').includes('1'), 'type/codes')
}

/** 场景：12 单自动分块不丢 */
async function testTwelveOrders(): Promise<void> {
  const nos = Array.from({ length: 12 }, (_, i) => orderNo(i))
  const calls: AfterSalesHttpCallParams[] = []
  setAfterSalesHttpDepsForTest({
    cookieProvider: async () => 'cookie-shopA',
    waitShopSlot: async () => undefined,
    httpExecutor: async (p) => {
      calls.push(p)
      const kws = new URL(p.url).searchParams.get('keywords')!.split(',')
      return {
        data: {
          total_count: 0,
          after_sales: kws.map((n) => ({
            delivery_package_id: n,
            returns_id: `R-${n}`,
            status_name: '待商家收货',
            refunded: false,
            return_type: 1,
            reason: 'x',
            user_id: 'u1',
          })),
        },
      }
    },
  })
  const map = await fetchAfterSalesWorkbenchByOrderNos(nos, 'shopA')
  assert(map.size === 12, `应有12结果 got=${map.size}`)
  for (const n of nos) assert(map.has(n), `缺少 ${n}`)
  assert(calls.length === 2, `应分2块 HTTP got=${calls.length}`)

  const mixed = partitionWorkbenchOrderNos([...nos.slice(0, 9), 'BAD', orderNo(99)])
  assert(mixed.invalid.some((x) => x.error === 'INVALID_ORDER_NO'), '非法单明确')
  assert(mixed.chunks.reduce((n, c) => n + c.length, 0) === 10, '合法10单')
}

/** 场景：分页45条 / 未完成抛错 */
async function testPagination(): Promise<void> {
  const nos = [orderNo(1), orderNo(2)]
  let pageHits = 0
  setAfterSalesHttpDepsForTest({
    cookieProvider: async () => 'c',
    waitShopSlot: async () => undefined,
    httpExecutor: async (p) => {
      pageHits++
      const page = Number(new URL(p.url).searchParams.get('page') || '1')
      const start = (page - 1) * 20
      const rows = Array.from({ length: 20 }, (_, i) => {
        const idx = start + i
        if (idx >= 45) return null
        return {
          delivery_package_id: nos[idx % 2]!,
          returns_id: `R${idx}`,
          status_name: '售后完成',
          refunded: true,
          refund_fee: 1,
          return_type: 2,
        }
      }).filter(Boolean)
      return { data: { total_count: 45, after_sales: rows } }
    },
  })
  const { results, httpRequests } = await fetchAfterSalesWorkbenchByOrderNosWithMeta(nos, 'shopA')
  assert(httpRequests === 3, `45条应3页 got=${httpRequests}`)
  assert(pageHits === 3, 'pageHits=3')
  assert(results.size === 2, '2 orders')

  // 205 条 → 10 页上限未完成
  pageHits = 0
  setAfterSalesHttpDepsForTest({
    cookieProvider: async () => 'c',
    waitShopSlot: async () => undefined,
    httpExecutor: async (p) => {
      pageHits++
      const page = Number(new URL(p.url).searchParams.get('page') || '1')
      const rows = Array.from({ length: 20 }, (_, i) => ({
        delivery_package_id: nos[0],
        returns_id: `R${(page - 1) * 20 + i}`,
        status_name: '售后完成',
        refunded: true,
        refund_fee: 1,
      }))
      return { data: { total_count: 205, after_sales: rows } }
    },
  })
  let threw: unknown
  try {
    await fetchAfterSalesWorkbenchByOrderNosWithMeta(nos, 'shopA')
  } catch (e) {
    threw = e
  }
  assert(threw instanceof AfterSalesRequestError, 'PAGINATION_INCOMPLETE')
  assert(String((threw as Error).message).includes('PAGINATION_INCOMPLETE'), 'msg')
  assert((threw as AfterSalesRequestError).httpRequests === 10, 'http=10')
  assert(pageHits === 10, 'pages=10')
}

/** 场景：第2页429保留httpRequests */
async function test429HttpCount(): Promise<void> {
  const nos = [orderNo(1)]
  setAfterSalesHttpDepsForTest({
    cookieProvider: async () => 'c',
    waitShopSlot: async () => undefined,
    httpExecutor: async (p) => {
      const page = Number(new URL(p.url).searchParams.get('page') || '1')
      if (page === 1) {
        return {
          data: {
            total_count: 25,
            after_sales: Array.from({ length: 20 }, (_, i) => ({
              delivery_package_id: nos[0],
              returns_id: `R${i}`,
              status_name: '售后完成',
              refunded: true,
              refund_fee: 1,
            })),
          },
        }
      }
      throw new Error('HTTP 429 Too Many Requests')
    },
  })
  let err: unknown
  try {
    await fetchAfterSalesWorkbenchByOrderNosWithMeta(nos, 'shopA')
  } catch (e) {
    err = e
  }
  assert(err instanceof AfterSalesRequestError, 'AfterSalesRequestError')
  assert((err as AfterSalesRequestError).httpRequests === 2, 'httpRequests=2')
}

function makeProbePayload(orderNos: string[], hasAt: Set<number>): unknown {
  return {
    data: {
      total: orderNos.length,
      packages: orderNos.map((n, i) =>
        hasAt.has(i)
          ? pkg(n, 2, '售后处理中: 待商家收货')
          : pkg(n, 1, '无售后'),
      ),
    },
  }
}

async function runBackfillWithHttp(
  tasks: SelectedAfterSalesQueueTask[],
  http: (p: AfterSalesHttpCallParams) => Promise<unknown>,
  extra?: {
    cookies?: Record<string, string>
    completeStatuses?: Map<string, 'done' | 'retry_wait' | 'blocked' | 'failed'>
  },
): Promise<{ metrics: AfterSalesBatchMetrics; httpCalls: AfterSalesHttpCallParams[]; released: string[]; saved: AfterSalesWorkbenchRefund[] }> {
  const httpCalls: AfterSalesHttpCallParams[] = []
  const released: string[] = []
  const saved: AfterSalesWorkbenchRefund[] = []
  const cookies = extra?.cookies ?? {}

  setAfterSalesHttpDepsForTest({
    cookieProvider: async (id) => {
      const c = cookies[id] ?? `cookie-${id}`
      return c
    },
    waitShopSlot: async () => undefined,
    httpExecutor: async (p) => {
      httpCalls.push(p)
      return http(p)
    },
  })

  setAfterSalesBackfillDepsForTest({
    getApiSyncEnabled: async () => true,
    recoverStuck: async () => undefined,
    selectTasks: async () => tasks,
    partitionOwnership: async (orderNos, shop) => ({
      matched: orderNos,
      mismatches: [],
    }),
    resolveAccountName: async (id) => id,
    openCircuit: async () => undefined,
    releaseTasks: async ({ tasks: ts }) => {
      for (const t of ts) released.push(t.orderNo)
    },
    saveCache: async (r) => {
      saved.push(r)
    },
    completeTask: async ({ orderNo }) => {
      return extra?.completeStatuses?.get(orderNo) ?? 'done'
    },
  })

  const metrics = await runAfterSalesBackfillBatch()
  return { metrics, httpCalls, released, saved }
}

/** 场景1：10无售后 → 仅1次订单列表 */
async function testTenNone(): Promise<void> {
  const shop = 'shopA'
  const nos = Array.from({ length: 10 }, (_, i) => orderNo(i))
  const tasks = nos.map((n, i) => task(shop, n, `t${i}`))
  const { metrics, httpCalls } = await runBackfillWithHttp(tasks, async (p) => {
    if (p.method === 'POST' || p.url.includes('/fulfillment/order/page')) {
      return makeProbePayload(nos, new Set())
    }
    throw new Error('unexpected detail')
  })
  const listCalls = httpCalls.filter((c) => c.url.includes('/fulfillment/order/page'))
  const detailCalls = httpCalls.filter((c) => c.url.includes('/after-sales/returns/v3'))
  assert(listCalls.length === 1, `list=1 got=${listCalls.length}`)
  assert(detailCalls.length === 0, 'detail=0')
  assert(metrics.actualHttpRequests === 1, `http=1 got=${metrics.actualHttpRequests}`)
  assert(metrics.noAfterSale === 10, `noAfterSale=10 got=${metrics.noAfterSale}`)
}

/** 场景2：2有售后 → list+detail，keywords仅2单 */
async function testTwoHas(): Promise<void> {
  const shop = 'shopA'
  const nos = Array.from({ length: 10 }, (_, i) => orderNo(i))
  const has = new Set([1, 6])
  const tasks = nos.map((n, i) => task(shop, n, `t${i}`))
  const { metrics, httpCalls, saved } = await runBackfillWithHttp(tasks, async (p) => {
    if (p.url.includes('/fulfillment/order/page')) {
      return makeProbePayload(nos, has)
    }
    const kws = new URL(p.url).searchParams.get('keywords')!.split(',')
    assert(kws.length === 2, `detail keywords len=2 got=${kws.length}`)
    assert(kws.includes(nos[1]!) && kws.includes(nos[6]!), 'keywords exact')
    assert(!kws.includes(nos[0]!), 'no none order')
    return {
      data: {
        total_count: 2,
        after_sales: kws.map((n) => processingDetail(n)),
      },
    }
  })
  const listCalls = httpCalls.filter((c) => c.url.includes('/fulfillment/order/page'))
  const detailCalls = httpCalls.filter((c) => c.url.includes('/after-sales/returns/v3'))
  assert(listCalls.length === 1 && detailCalls.length === 1, 'http 1+1')
  assert(metrics.actualHttpRequests === 2, `http=2 got=${metrics.actualHttpRequests}`)
  assert(saved.some((s) => (s.matchedRecordCount ?? 0) > 0 && s.successReturnCount === 0), 'processing saved')
}

/** 场景4：429 熔断 */
async function testShop429(): Promise<void> {
  const shop = 'shopA'
  const nos = Array.from({ length: 5 }, (_, i) => orderNo(i))
  const tasks = nos.map((n, i) => task(shop, n, `t${i}`))
  const { metrics, httpCalls, released } = await runBackfillWithHttp(tasks, async () => {
    throw new Error('HTTP 429')
  })
  assert(httpCalls.length === 1, `仅1次 got=${httpCalls.length}`)
  assert(metrics.actualHttpRequests === 1, 'http count 1')
  assert(released.length === 5, `release 5 got=${released.length}`)
  assert(metrics.rateLimited >= 1, 'rateLimited')
}

/** 场景5：真实互斥 */
async function testRealMutex(): Promise<void> {
  let releaseEnter!: () => void
  const entered = new Promise<void>((r) => {
    releaseEnter = r
  })
  let firstEntered = false
  setAfterSalesBackfillDepsForTest({
    getApiSyncEnabled: async () => true,
    recoverStuck: async () => undefined,
    selectTasks: async () => [],
    onEntered: async () => {
      firstEntered = true
      releaseEnter()
      await new Promise((r) => setTimeout(r, 80))
    },
  })
  resetAfterSalesBackfillLockForTest()
  const p1 = runAfterSalesBackfillBatch()
  await entered
  const p2 = runAfterSalesBackfillBatch()
  const r2 = await p2
  assert(r2.skippedBecauseRunning === true, 'second ALREADY_RUNNING')
  assert(firstEntered, 'first entered body')
  await p1
  // 第三次可进入
  setAfterSalesBackfillDepsForTest({
    getApiSyncEnabled: async () => true,
    recoverStuck: async () => undefined,
    selectTasks: async () => [],
  })
  const r3 = await runAfterSalesBackfillBatch()
  assert(r3.skippedBecauseRunning !== true, 'third ok')
}

/** 场景6：生产 liveAccountOrderKey */
async function testCacheKey(): Promise<void> {
  const a = liveAccountOrderKey('shopA', 'P1')
  const b = liveAccountOrderKey('shopB', 'P1')
  assert(a !== b, 'isolated')
  assert(a.includes('shopA') && a.includes('P1'), 'key content')
}

/** 场景：同店限流并发不穿透 */
async function testShopRateConcurrency(): Promise<void> {
  resetShopEndpointSlotsForTest()
  const starts: number[] = []
  const gap = 50
  await Promise.all([
    (async () => {
      await waitShopPlatformSlot('shopX', { gapMs: gap, jitterMs: 0 })
      starts.push(Date.now())
    })(),
    (async () => {
      await waitShopPlatformSlot('shopX', { gapMs: gap, jitterMs: 0 })
      starts.push(Date.now())
    })(),
  ])
  starts.sort((a, b) => a - b)
  assert(starts.length === 2, '2 starts')
  assert(starts[1]! - starts[0]! >= gap - 5, `gap>=${gap} got=${starts[1]! - starts[0]!}`)
  // 不同店可并行（间隔独立）
  resetShopEndpointSlotsForTest()
  const t0 = Date.now()
  await Promise.all([
    waitShopPlatformSlot('shopY', { gapMs: 80, jitterMs: 0 }),
    waitShopPlatformSlot('shopZ', { gapMs: 80, jitterMs: 0 }),
  ])
  assert(Date.now() - t0 < 60, '不同店不互相阻塞')
  void AFTER_SALES_SHOP_MIN_GAP_MS
}

async function main(): Promise<void> {
  await testHarness('HAR URL 对齐', testHarUrl)
  await testHarness('进行中结构化字段', testProcessingStructured)
  await testHarness('12单自动分块不丢', testTwelveOrders)
  await testHarness('分页45/未完成报错', testPagination)
  await testHarness('429保留httpRequests=2', test429HttpCount)
  await testHarness('生产链路10无售后HTTP=1', testTenNone)
  await testHarness('生产链路2有售后HTTP=2', testTwoHas)
  await testHarness('生产链路429熔断', testShop429)
  await testHarness('真实互斥锁', testRealMutex)
  await testHarness('生产liveAccountOrderKey', testCacheKey)
  await testHarness('同店限流并发', testShopRateConcurrency)
  console.log('✓ after-sales-backfill-production-chain-acceptance')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
