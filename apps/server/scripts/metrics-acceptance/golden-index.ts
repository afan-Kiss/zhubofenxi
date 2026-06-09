/**
 * 固定黄金快照验收（不依赖 live 库全天数据）
 *
 * 用法:
 *   npm run test:metrics:golden
 */
import {
  formatMoney,
  hasFailures,
  logFail,
  logPass,
  moneyClose,
  resetResults,
} from './assertions'
import {
  computeGoldenMetricsFromFixture,
  loadGoldenSnapshotFixture,
} from './golden-fixture-calc'
import { GOLDEN_EXPECTATIONS } from './golden-cases'

async function main(): Promise<void> {
  resetResults()
  console.log('[golden-metrics] 开始固定黄金快照验收\n')

  const fixture = loadGoldenSnapshotFixture()
  console.log(`[golden-metrics] fixture=${fixture.id}`)
  console.log(`[golden-metrics] source=${fixture.source}`)
  console.log(`[golden-metrics] note=${fixture.description}\n`)

  const computed = computeGoldenMetricsFromFixture(fixture)

  const checks = [
    {
      name: 'golden:2026-05-28-snapshot:paidAmount',
      expected: GOLDEN_EXPECTATIONS.paidAmountYuan,
      actual: computed.paidAmountYuan,
      isMoney: true,
    },
    {
      name: 'golden:2026-05-28-snapshot:paidOrders',
      expected: GOLDEN_EXPECTATIONS.paidOrderCount,
      actual: computed.paidOrderCount,
      isMoney: false,
    },
    {
      name: 'golden:2026-05-28-snapshot:refundAmount',
      expected: GOLDEN_EXPECTATIONS.refundAmountYuan,
      actual: computed.refundAmountYuan,
      isMoney: true,
    },
  ] as const

  for (const c of checks) {
    const ok = c.isMoney
      ? moneyClose(c.actual, c.expected)
      : c.actual === c.expected
    if (ok) {
      logPass(
        c.name,
        `OK ${c.isMoney ? formatMoney(c.actual) : c.actual}`,
      )
    } else {
      logFail({
        name: c.name,
        message: '固定快照 fixture 计算结果与官方黄金口径不一致',
        expected: c.isMoney ? formatMoney(c.expected) : c.expected,
        actual: c.isMoney ? formatMoney(c.actual) : c.actual,
        hint: `检查 fixtures/official-2026-05-28-snapshot.json 与 aggregateSuccessfulRefundCentInRange 口径`,
      })
    }
  }

  if (
    fixture.expectations.paidAmountCent !== computed.paidAmountCent ||
    fixture.expectations.paidOrderCount !== computed.paidOrderCount ||
    fixture.expectations.refundAmountCent !== computed.refundAmountCent
  ) {
    logFail({
      name: 'golden:fixture-internal',
      message: 'fixture expectations 与 core 计算不一致',
      fields: {
        fixtureExpectations: fixture.expectations,
        computed: {
          paidAmountCent: computed.paidAmountCent,
          paidOrderCount: computed.paidOrderCount,
          refundAmountCent: computed.refundAmountCent,
        },
      },
      hint: '更新 fixture expectations 或修正 golden-fixture-calc',
    })
  }

  finish(hasFailures() ? 1 : 0)
}

function finish(code: number): void {
  console.log('')
  if (code === 0) {
    console.log('[golden-metrics] PASS')
  } else {
    console.error('[golden-metrics] FAIL')
  }
  process.exit(code)
}

main().catch((err) => {
  console.error('[golden-metrics] 未捕获异常:', err)
  process.exit(1)
})
