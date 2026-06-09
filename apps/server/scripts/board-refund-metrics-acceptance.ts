/**
 * 经营看板退款口径验收
 * npx tsx apps/server/scripts/board-refund-metrics-acceptance.ts
 * GMV_ACCEPT_START=2026-05-28 GMV_ACCEPT_END=2026-05-28 npx tsx apps/server/scripts/board-refund-metrics-acceptance.ts
 */
import path from 'node:path'
import { config } from 'dotenv'
import { executeBoardLiveQuery } from '../src/services/board-live-query.service'
import { OFFICIAL_GMV_ACCEPT_20260528 } from '../src/services/board-metrics-debug.service'
import { centToYuan } from '../src/utils/money'

config({ path: path.resolve(__dirname, '../.env') })

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

async function main(): Promise<void> {
  const start = process.env.GMV_ACCEPT_START?.trim() || OFFICIAL_GMV_ACCEPT_20260528.date
  const end = process.env.GMV_ACCEPT_END?.trim() || start

  const result = await executeBoardLiveQuery({
    preset: 'custom',
    startDate: start,
    endDate: end,
    page: 1,
    pageSize: 5000,
  })

  const s = result.summary
  const paidCount = Number(s.orderCount ?? 0)
  const refundCount = Number(s.returnCount ?? 0)
  const refundAmount = Number(s.returnAmount ?? 0)
  const paidGmv = Number(s.totalGmv ?? s.gmv ?? 0)
  const returnRate = Number(s.returnRate ?? 0)

  console.log(`\n=== ${start} ~ ${end} ===`)
  console.log(`支付金额 ${paidGmv} 支付订单 ${paidCount}`)
  console.log(`退款金额 ${refundAmount} 退款订单 ${refundCount} 退款率 ${(returnRate * 100).toFixed(2)}%`)

  assert(refundCount <= paidCount, '退款订单数不能大于支付订单数')
  if (refundCount > 0) {
    assert(refundAmount > 0, '有退款订单时退款金额应>0')
  }
  if (refundAmount <= 0) {
    assert(refundCount === 0, '退款金额为0时退款订单数应为0')
  }
  if (paidCount > 0 && refundCount < paidCount) {
    assert(returnRate < 1, '非全退时退款率应<100%')
  }

  for (const a of result.anchorLeaderboard ?? []) {
    const name = String(a.anchorName ?? '')
    const pc = Number(a.orderCount ?? 0)
    const rc = Number(a.returnCount ?? 0)
    const ra = Number(a.returnAmount ?? 0)
    const rr = Number(a.returnRate ?? 0)
    console.log(`主播 ${name}: 支付${pc} 退款单${rc} 退款额${ra} 退款率${(rr * 100).toFixed(2)}%`)
    assert(rc <= pc, `${name} 退款订单数>支付订单数`)
    if (rc > 0) assert(ra > 0, `${name} 有退款单但退款额为0`)
    if (rc === pc && pc > 0 && Number(a.signedOrderCount ?? 0) === 0) {
      console.warn(`WARN ${name}: 全退且签收0，请人工核对是否均为真实退款`)
    }
  }

  if (start === OFFICIAL_GMV_ACCEPT_20260528.date) {
    const paidCent = Math.round(paidGmv * 100)
    const refundCent = Math.round(refundAmount * 100)
    console.log('\n官方验收对比:')
    console.log(
      `支付 ${centToYuan(OFFICIAL_GMV_ACCEPT_20260528.paidAmountCent)} vs ${paidGmv} | ` +
        `订单 ${OFFICIAL_GMV_ACCEPT_20260528.paidOrderCount} vs ${paidCount} | ` +
        `退款 ${centToYuan(OFFICIAL_GMV_ACCEPT_20260528.refundAmountCent)} vs ${refundAmount}`,
    )
  }

  console.log('\n✓ board-refund-metrics-acceptance 通过')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
