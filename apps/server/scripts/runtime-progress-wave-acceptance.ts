/**
 * npx tsx apps/server/scripts/runtime-progress-wave-acceptance.ts
 * 验收：售后进度本轮口径 + 新入队时百分比不回退
 */
import {
  resetAfterSalesWaveProgressForTests,
  resolveAfterSalesWaveProgress,
} from '../src/services/runtime-progress.service'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

function step(
  done: number,
  open: number,
  prev: { startDone: number; lastPercent: number } | null,
) {
  return resolveAfterSalesWaveProgress({ done, open, prev })
}

resetAfterSalesWaveProgressForTests()

// 1) 本轮开始：历史 done 很大也不该把条直接拉满
{
  const a = step(500, 100, null)
  assert(a.percent === 0, `开局应为 0%，实际 ${a.percent}`)
  assert(a.waveDone === 0, `开局本轮已查应为 0，实际 ${a.waveDone}`)
  assert(a.countLabel === '本轮已查 0 · 还剩 100', `文案不对: ${a.countLabel}`)

  // 2) 消化一部分 → 上涨
  const b = step(540, 60, a.next)
  assert(b.percent === 40, `消化后应为 40%，实际 ${b.percent}`)
  assert(b.waveDone === 40, `本轮已查应为 40，实际 ${b.waveDone}`)

  // 3) 新入队 30：瞬时比例变低，但展示百分比不得回退
  const c = step(540, 90, b.next)
  assert(c.percent === 40, `新入队后不得回退，期望 40% 实际 ${c.percent}`)
  assert(c.waveDone === 40, `本轮已查仍为 40，实际 ${c.waveDone}`)
  assert(c.countLabel === '本轮已查 40 · 还剩 90', `文案不对: ${c.countLabel}`)

  // 4) 继续消化 → 只增
  const d = step(590, 40, c.next)
  assert((d.percent ?? 0) >= 40, `继续消化后应 ≥40%，实际 ${d.percent}`)
  assert(d.percent === 69, `期望 69%（90/130），实际 ${d.percent}`)

  // 5) 清空积压 → 重置本轮（空闲时调用方也不再画满格 100%）
  const e = step(630, 0, d.next)
  assert(e.next === null, '积压清空后应重置本轮状态')
  assert(e.percent === null, '清空后 percent 应为 null（空闲不画进度条）')
}

// 6) 新一轮从头计
{
  const a = step(630, 50, null)
  assert(a.percent === 0, `新一轮开局应为 0%，实际 ${a.percent}`)
  assert(a.waveDone === 0, `新一轮本轮已查应为 0，实际 ${a.waveDone}`)
}

console.log('✓ runtime-progress-wave-acceptance')
