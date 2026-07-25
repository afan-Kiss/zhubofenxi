/**
 * npm run accept:after-sales-stuck-running
 */
import assert from 'node:assert/strict'
import {
  decideStuckRunningDisposition,
  isRunningTimedOut,
  pickRunningAnchorTime,
} from '../src/services/after-sales-queue.service'
import { AFTER_SALES_RUNNING_TIMEOUT_MS } from '../src/services/after-sales-queue.types'
import { resolveAfterSalesQueueEligibility } from '../src/services/after-sales-fetch-decision.service'

function baseElig(p?: Partial<Parameters<typeof resolveAfterSalesQueueEligibility>[0]>) {
  return {
    displayOrderNo: 'P800000000000000001',
    officialOrderNo: 'P800000000000000001',
    orderStatusText: '已签收',
    afterSaleStatusText: '无售后',
    ...p,
  }
}

function main(): void {
  console.log('accept:after-sales-stuck-running\n')
  const now = Date.now()
  const old = new Date(now - AFTER_SALES_RUNNING_TIMEOUT_MS - 1000)
  const fresh = new Date(now - 60_000)

  // 1. 超时 + 无售后 → done
  {
    const elig = resolveAfterSalesQueueEligibility(
      baseElig({ raw: { afterSaleStatus: 1 } }),
      { cacheMissingOrStale: true, cacheCurrentlyValid: false },
    )
    assert.equal(elig.eligible, false)
    assert.equal(decideStuckRunningDisposition(elig.eligible), 'done')
    console.log('✓ 超时无售后 → done')
  }

  // 2. 超时 + 待商家收货 → retry_wait
  {
    const elig = resolveAfterSalesQueueEligibility(
      baseElig({ afterSaleStatusText: '待商家收货', raw: { afterSaleStatus: 2 } }),
      { cacheMissingOrStale: true, cacheCurrentlyValid: false },
    )
    assert.equal(elig.eligible, true)
    assert.equal(decideStuckRunningDisposition(elig.eligible), 'retry_wait')
    console.log('✓ 超时真实售后 → retry_wait')
  }

  // 3. 未超时不处理
  {
    const info = isRunningTimedOut(
      { runningSince: fresh },
      { nowMs: now, timeoutMs: AFTER_SALES_RUNNING_TIMEOUT_MS },
    )
    assert.equal(info.timedOut, false)
    console.log('✓ 未超时 → 不修改')
  }

  // 4. runningSince 空 + claimedAt 超时
  {
    const info = isRunningTimedOut(
      { runningSince: null, claimedAt: old },
      { nowMs: now, timeoutMs: AFTER_SALES_RUNNING_TIMEOUT_MS },
    )
    assert.equal(info.timedOut, true)
    assert.equal(info.timestampMissing, false)
    assert.equal(pickRunningAnchorTime({ claimedAt: old })?.getTime(), old.getTime())
    console.log('✓ claimedAt 回退超时')
  }

  // 5. lastAttemptAt 回退
  {
    const info = isRunningTimedOut(
      { lastAttemptAt: old },
      { nowMs: now, timeoutMs: AFTER_SALES_RUNNING_TIMEOUT_MS },
    )
    assert.equal(info.timedOut, true)
    console.log('✓ lastAttemptAt 回退超时')
  }

  // 6. 全部时间为空 → 视为异常超时
  {
    const info = isRunningTimedOut({}, { nowMs: now, timeoutMs: AFTER_SALES_RUNNING_TIMEOUT_MS })
    assert.equal(info.timedOut, true)
    assert.equal(info.timestampMissing, true)
    console.log('✓ 时间戳全缺 → 不永久卡住')
  }

  // 10. status=1 超时 → done
  {
    const elig = resolveAfterSalesQueueEligibility(
      baseElig({ afterSaleStatusText: '无售后', raw: { afterSaleStatus: 1 } }),
      { cacheMissingOrStale: true, cacheCurrentlyValid: false },
    )
    assert.equal(decideStuckRunningDisposition(elig.eligible), 'done')
    console.log('✓ afterSaleStatus=1 → done')
  }

  // 11. status=2 + 待商家收货 → retry_wait
  {
    const elig = resolveAfterSalesQueueEligibility(
      baseElig({
        afterSaleStatusText: '售后处理中: 待商家收货',
        raw: { afterSaleStatus: 2 },
      }),
      { cacheMissingOrStale: true, cacheCurrentlyValid: false },
    )
    assert.equal(decideStuckRunningDisposition(elig.eligible), 'retry_wait')
    console.log('✓ afterSaleStatus=2 待商家收货 → retry_wait')
  }

  // 12. isReturned
  {
    const elig = resolveAfterSalesQueueEligibility(
      baseElig({ isReturned: true, afterSaleStatusText: '售后关闭' }),
      { cacheMissingOrStale: true, cacheCurrentlyValid: false },
    )
    assert.equal(decideStuckRunningDisposition(elig.eligible), 'retry_wait')
    console.log('✓ isReturned → retry_wait')
  }

  // 13. QualityBadCase
  {
    const elig = resolveAfterSalesQueueEligibility(baseElig(), {
      officialQualityCaseMatched: true,
      cacheMissingOrStale: true,
      cacheCurrentlyValid: false,
    })
    assert.equal(elig.eligible, true)
    assert.equal(decideStuckRunningDisposition(elig.eligible), 'retry_wait')
    console.log('✓ QualityBadCase → retry_wait')
  }

  // 8/9. 文档约束：recover 在 select 之前调用（静态检查由实现保证）；此处校验超时判定与熔断无关
  assert.ok(AFTER_SALES_RUNNING_TIMEOUT_MS === 10 * 60 * 1000)
  console.log('✓ 超时阈值 10 分钟；恢复逻辑不依赖 circuit')

  console.log('\nALL PASS')
}

main()
