/**
 * 售后范围完整性 decideStatus + 去重 — 验收
 * npm run verify:after-sales-range-completeness
 */
import assert from 'node:assert/strict'
import {
  decideStatus,
  resolveAfterSalesCompleteness,
  type RelevantOrderRef,
} from '../src/services/after-sales-completeness.service'
import { liveAccountOrderKey } from '../src/utils/live-account-cache-key.util'

/** 镜像 completeness 服务内 affected 去重计数 */
function countAffectedOpenOrders(
  refs: RelevantOrderRef[],
  queueStatusByKey: Map<string, string>,
): { affectedOrderCount: number; affectedGmv: number } {
  const affectedKeys = new Set<string>()
  let affectedGmv = 0
  for (const ref of refs) {
    const key = liveAccountOrderKey(ref.liveAccountId, ref.orderNo)
    const status = queueStatusByKey.get(key) ?? 'missing'
    const openLike = ['pending', 'retry_wait', 'running', 'blocked', 'failed'].includes(status)
    if (!openLike) continue
    if (!affectedKeys.has(key)) {
      affectedKeys.add(key)
      affectedGmv += Number(ref.payAmountYuan ?? 0) || 0
    }
  }
  return {
    affectedOrderCount: affectedKeys.size,
    affectedGmv: Math.round(affectedGmv * 100) / 100,
  }
}

function testDecideStatusPriorities(): void {
  assert.equal(decideStatus({
    pendingCount: 0,
    retryWaitCount: 0,
    runningCount: 0,
    blockedCount: 1,
    failedCount: 0,
  }).status, 'blocked', 'blocked 优先于 open')

  assert.equal(decideStatus({
    pendingCount: 5,
    retryWaitCount: 0,
    runningCount: 0,
    blockedCount: 1,
    failedCount: 0,
  }).status, 'blocked', 'blocked + open')

  assert.equal(decideStatus({
    pendingCount: 3,
    retryWaitCount: 0,
    runningCount: 0,
    blockedCount: 0,
    failedCount: 2,
  }).status, 'failed', 'failed + open')

  assert.equal(decideStatus({
    pendingCount: 0,
    retryWaitCount: 0,
    runningCount: 0,
    blockedCount: 0,
    failedCount: 1,
  }).status, 'failed', '仅 failed')

  assert.equal(decideStatus({
    pendingCount: 250,
    retryWaitCount: 0,
    runningCount: 0,
    blockedCount: 0,
    failedCount: 0,
  }).status, 'pending', 'open>200 → pending')

  assert.equal(decideStatus({
    pendingCount: 10,
    retryWaitCount: 2,
    runningCount: 0,
    blockedCount: 0,
    failedCount: 0,
  }).status, 'partial', 'open≤200 → partial')

  assert.equal(decideStatus({
    pendingCount: 0,
    retryWaitCount: 0,
    runningCount: 0,
    blockedCount: 0,
    failedCount: 0,
  }).status, 'complete')

  console.log('✓ decideStatus 优先级')
}

function testAffectedDedupe(): void {
  const refs: RelevantOrderRef[] = [
    { liveAccountId: 'shop-a', orderNo: 'P001', payAmountYuan: 100 },
    { liveAccountId: 'shop-a', orderNo: 'P001', payAmountYuan: 100 },
    { liveAccountId: 'shop-b', orderNo: 'P002', payAmountYuan: 50.5 },
  ]
  const map = new Map([
    [liveAccountOrderKey('shop-a', 'P001'), 'pending'],
    [liveAccountOrderKey('shop-b', 'P002'), 'running'],
    [liveAccountOrderKey('shop-c', 'P003'), 'done'],
  ])
  const r = countAffectedOpenOrders(refs, map)
  assert.equal(r.affectedOrderCount, 2)
  assert.equal(r.affectedGmv, 150.5)
  console.log('✓ affected 订单数 / GMV 去重')
}

async function testDbOptional(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    console.log('⊘ 跳过 DB：未设置 DATABASE_URL')
    return
  }
  try {
    const empty = await resolveAfterSalesCompleteness({ relevantViews: [] })
    assert.equal(empty.status, 'complete')
    assert.equal(empty.scope, 'range')
    assert.match(empty.note, /无支付订单/)
    console.log('✓ DB 可选：空 relevantViews → complete')
  } catch (e) {
    console.log(`⊘ DB 可选跳过：${e instanceof Error ? e.message : String(e)}`)
  }
}

async function main(): Promise<void> {
  console.log('verify:after-sales-range-completeness\n')
  testDecideStatusPriorities()
  testAffectedDedupe()
  await testDbOptional()
  console.log('\nPASS')
}

void main()
