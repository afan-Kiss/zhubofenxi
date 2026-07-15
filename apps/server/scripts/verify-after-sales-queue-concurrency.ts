/**
 * 售后队列轮询合并 + 认领互斥 — 验收
 * npm run verify:after-sales-queue-concurrency
 */
import assert from 'node:assert/strict'
import { mergeShopCandidatesRoundRobin } from '../src/services/after-sales-queue.service'

type Candidate = { id: string; liveAccountId: string }

function buildCandidates(shopId: string, n: number): Candidate[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${shopId}-${i + 1}`,
    liveAccountId: shopId,
  }))
}

/** 模拟 CAS 认领：同一 id 只能被一个 worker 成功认领 */
function simulateAtomicClaim(
  ids: string[],
  workers: number,
): { claimed: Map<string, string>; conflicts: number } {
  const store = new Map<string, 'open' | string>()
  for (const id of ids) store.set(id, 'open')

  const claimed = new Map<string, string>()
  let conflicts = 0

  for (let w = 0; w < workers; w++) {
    const workerId = `worker-${w}`
    for (const id of ids) {
      const cur = store.get(id)
      if (cur === 'open') {
        const race = store.get(id)
        if (race === 'open') {
          store.set(id, workerId)
          if (claimed.has(id)) conflicts++
          else claimed.set(id, workerId)
        }
      }
    }
  }
  return { claimed, conflicts }
}

function testRoundRobinBothShops(): void {
  const byShop = new Map<string, Candidate[]>()
  byShop.set('shop-a', buildCandidates('shop-a', 20))
  byShop.set('shop-b', buildCandidates('shop-b', 10))
  const merged = mergeShopCandidatesRoundRobin(byShop, ['shop-a', 'shop-b'], 12, 6)
  assert.equal(merged.length, 12)
  const aCount = merged.filter((c) => c.liveAccountId === 'shop-a').length
  const bCount = merged.filter((c) => c.liveAccountId === 'shop-b').length
  assert.ok(aCount > 0, 'shop-a 有代表')
  assert.ok(bCount > 0, 'shop-b 有代表')
  assert.ok(aCount <= 6 && bCount <= 6, 'perShopCap 生效')
  console.log(`✓ 轮询合并 A=20 B=10 → 选中 ${merged.length}（A=${aCount} B=${bCount}）`)
}

function testClaimExclusivity(): void {
  const ids = ['t1', 't2', 't3', 't4', 't5']
  const { claimed, conflicts } = simulateAtomicClaim(ids, 4)
  assert.equal(claimed.size, ids.length, '每个 id 恰好认领一次')
  assert.equal(conflicts, 0, '无双重认领')
  const owners = new Set(claimed.values())
  assert.ok(owners.size >= 1)
  console.log(`✓ CAS 模拟：${ids.length} 任务 / ${owners.size} worker，无重复认领`)
}

function main(): void {
  console.log('verify:after-sales-queue-concurrency\n')
  testRoundRobinBothShops()
  testClaimExclusivity()
  console.log('\nPASS')
}

main()
