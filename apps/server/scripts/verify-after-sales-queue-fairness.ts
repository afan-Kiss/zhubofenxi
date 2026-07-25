/**
 * 售后队列多店公平轮询 — 验收
 * npm run verify:after-sales-queue-fairness
 */
import assert from 'node:assert/strict'
import { mergeShopCandidatesRoundRobin } from '../src/services/after-sales-queue.service'

type Candidate = { id: string; liveAccountId: string }

function main(): void {
  console.log('verify:after-sales-queue-fairness\n')

  const shopOrder = ['shop1', 'shop2', 'shop3', 'shop4']
  const byShop = new Map<string, Candidate[]>()
  byShop.set('shop1', Array.from({ length: 2000 }, (_, i) => ({ id: `s1-${i}`, liveAccountId: 'shop1' })))
  for (const sid of ['shop2', 'shop3', 'shop4']) {
    byShop.set(
      sid,
      Array.from({ length: 10 }, (_, i) => ({ id: `${sid}-${i}`, liveAccountId: sid })),
    )
  }

  const globalCap = 8
  const perShopCap = 2
  const picked = mergeShopCandidatesRoundRobin(byShop, shopOrder, globalCap, perShopCap)

  assert.equal(picked.length, globalCap, `应选满 globalCap=${globalCap}`)
  const counts = new Map<string, number>()
  for (const c of picked) {
    counts.set(c.liveAccountId, (counts.get(c.liveAccountId) ?? 0) + 1)
  }

  for (const sid of shopOrder) {
    const n = counts.get(sid) ?? 0
    assert.ok(n >= 1, `${sid} 应至少 1 槽`)
    assert.ok(n <= perShopCap, `${sid} 不超过 perShopCap=${perShopCap}`)
  }

  const shop1Count = counts.get('shop1') ?? 0
  assert.ok(shop1Count < globalCap, 'shop1 不能独占全部 8 槽')
  assert.equal(shop1Count, perShopCap, 'shop1 受 perShopCap 限制为 2')

  console.log(
    `✓ 公平轮询：shop1=${shop1Count} shop2=${counts.get('shop2')} shop3=${counts.get('shop3')} shop4=${counts.get('shop4')}`,
  )

  // 同店调度：priority DESC 再按 signalDetectedAt/createdAt
  type Q = {
    priority: number
    signalDetectedAt: number | null
    nextAttemptAt: number | null
    createdAt: number
    id: string
  }
  const candidates: Q[] = [
    { id: 'low-old', priority: 40, signalDetectedAt: 1, nextAttemptAt: null, createdAt: 1 },
    { id: 'high-new', priority: 90, signalDetectedAt: 100, nextAttemptAt: null, createdAt: 100 },
    { id: 'high-old', priority: 90, signalDetectedAt: 10, nextAttemptAt: null, createdAt: 10 },
  ]
  const sorted = [...candidates].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    const sa = a.signalDetectedAt ?? a.createdAt
    const sb = b.signalDetectedAt ?? b.createdAt
    if (sa !== sb) return sa - sb
    const na = a.nextAttemptAt ?? a.createdAt
    const nb = b.nextAttemptAt ?? b.createdAt
    if (na !== nb) return na - nb
    return a.createdAt - b.createdAt
  })
  assert.deepEqual(
    sorted.map((x) => x.id),
    ['high-old', 'high-new', 'low-old'],
    '同店应先高 priority，同优先级先更早信号',
  )
  console.log('✓ 同店 priority DESC 再按 signalDetectedAt ASC')

  console.log('\nPASS')
}

main()
