/**
 * 历史订单唯一归属 dry-run / 正式重算（缓存失效）
 *
 * 用法:
 *   npx tsx apps/server/scripts/remap-canonical-order-attribution.ts
 *   npx tsx apps/server/scripts/remap-canonical-order-attribution.ts --apply
 *   START_DATE=2026-07-01 END_DATE=2026-07-12 npx tsx ...
 *
 * 说明：归属在运行时 remap，不落库覆盖历史；--apply 会确认写入口径并全量失效经营缓存。
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { buildRawAnalyzeBundleAll } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../src/services/business-analysis.service'
import { attachRawByMatchToViews } from '../src/services/low-price-brush-order.service'
import { resolveCanonicalOrderAttribution } from '../src/services/canonical-order-attribution.service'
import { parseViewOrderCreateTimeMs } from '../src/services/canonical-order-attribution.service'
import { parseViewPayTimeMs } from '../src/services/anchor-performance-attribution.service'
import { resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { viewCountsAsQualityRefund } from '../src/services/quality-refund-resolution.service'
import { invalidateAndRebuildBusinessBoardCache } from '../src/services/business-cache.service'
import { clearCanonicalAttributionCache } from '../src/services/canonical-order-attribution.service'
import { formatDateKeyShanghai } from '../src/utils/business-timezone'

config({ path: path.resolve(__dirname, '../.env') })

const START = process.env.START_DATE?.trim() || '2026-07-01'
const END = process.env.END_DATE?.trim() || formatDateKeyShanghai(new Date())

type AnchorAgg = {
  oldPayCent: number
  newPayCent: number
  oldPayCnt: number
  newPayCnt: number
  oldSignCent: number
  newSignCent: number
  oldRefundCent: number
  newRefundCent: number
  oldQr: number
  newQr: number
}

function dateKeyFromMs(ms: number | null): string | null {
  if (ms == null) return null
  return formatDateKeyShanghai(new Date(ms))
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  console.log(`[remap-canonical] range=${START}..${END} apply=${apply}`)

  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle) throw new Error('无法加载分析包')
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const rawByMatch = new Map(
    (artifacts.dedupe.uniqueOrders ?? []).map((o) => [o.matchOrderId, o.raw]),
  )
  const withRaw = attachRawByMatchToViews(artifacts.views, rawByMatch)

  let changed = 0
  let scanned = 0
  let missingCreate = 0
  let missingShop = 0
  const byAnchor = new Map<string, AnchorAgg>()
  const sampleChanges: Array<Record<string, unknown>> = []

  let shopOldPay = 0
  let shopNewPay = 0
  let shopOldSign = 0
  let shopNewSign = 0
  let shopOldRefund = 0
  let shopNewRefund = 0
  let shopOldQr = 0
  let shopNewQr = 0

  for (const view of withRaw) {
    const create = parseViewOrderCreateTimeMs(view)
    const dk = dateKeyFromMs(create.ms)
    if (!dk || dk < START || dk > END) continue
    scanned += 1
    if (!view.liveAccountName?.trim() && !(view as { raw?: Record<string, unknown> }).raw) {
      missingShop += 1
    }
    if (create.ms == null) missingCreate += 1

    const oldAnchor = view.anchorName?.trim() || '未归属'
    const canonical = await resolveCanonicalOrderAttribution(view)
    const newAnchor = canonical.canonicalAnchorName
    const payCent = view.paymentBaseCent ?? view.actualPaidCent ?? 0
    const signCent = view.actualSignedAmountCent ?? 0
    const refundCent = view.productRefundAmountCent ?? view.returnAmountCent ?? 0
    const isQr = viewCountsAsQualityRefund(view)

    shopOldPay += payCent
    shopNewPay += payCent
    shopOldSign += signCent
    shopNewSign += signCent
    shopOldRefund += refundCent
    shopNewRefund += refundCent
    if (isQr) {
      shopOldQr += 1
      shopNewQr += 1
    }

    const bump = (name: string, which: 'old' | 'new') => {
      const cur = byAnchor.get(name) ?? {
        oldPayCent: 0,
        newPayCent: 0,
        oldPayCnt: 0,
        newPayCnt: 0,
        oldSignCent: 0,
        newSignCent: 0,
        oldRefundCent: 0,
        newRefundCent: 0,
        oldQr: 0,
        newQr: 0,
      }
      if (which === 'old') {
        cur.oldPayCent += payCent
        cur.oldPayCnt += 1
        cur.oldSignCent += signCent
        cur.oldRefundCent += refundCent
        if (isQr) cur.oldQr += 1
      } else {
        cur.newPayCent += payCent
        cur.newPayCnt += 1
        cur.newSignCent += signCent
        cur.newRefundCent += refundCent
        if (isQr) cur.newQr += 1
      }
      byAnchor.set(name, cur)
    }
    bump(oldAnchor, 'old')
    bump(newAnchor, 'new')

    if (oldAnchor !== newAnchor) {
      changed += 1
      if (sampleChanges.length < 40) {
        const payMs = parseViewPayTimeMs(view)
        sampleChanges.push({
          orderNo: resolveMetricOrderNo(view),
          liveAccountName: view.liveAccountName,
          createTime: create.text,
          payTime: payMs != null ? new Date(payMs).toISOString() : null,
          oldAnchor,
          newAnchor,
          attributionType: canonical.attributionType,
          matchedLiveSessionId: canonical.matchedLiveSessionId,
          matchedScheduleId: canonical.matchedScheduleId,
          isQuality: isQr,
          payYuan: payCent / 100,
        })
      }
    }
  }

  console.log(`\n扫描订单: ${scanned}`)
  console.log(`归属变化: ${changed}`)
  console.log(`缺下单时间: ${missingCreate}`)
  console.log(`缺直播号(粗): ${missingShop}`)
  console.log(
    `全店守恒检查: pay ${shopOldPay === shopNewPay} sign ${shopOldSign === shopNewSign} refund ${shopOldRefund === shopNewRefund} qr ${shopOldQr === shopNewQr}`,
  )
  console.log('\n主播汇总（旧→新）:')
  for (const [name, a] of [...byAnchor.entries()].sort((x, y) => x[0].localeCompare(y[0], 'zh-CN'))) {
    if (
      a.oldPayCent === a.newPayCent &&
      a.oldPayCnt === a.newPayCnt &&
      a.oldQr === a.newQr &&
      a.oldSignCent === a.newSignCent &&
      a.oldRefundCent === a.newRefundCent
    ) {
      continue
    }
    console.log(
      `  ${name}: pay¥${(a.oldPayCent / 100).toFixed(2)}→${(a.newPayCent / 100).toFixed(2)} (Δ${((a.newPayCent - a.oldPayCent) / 100).toFixed(2)}) ` +
        `cnt ${a.oldPayCnt}→${a.newPayCnt} sign¥${(a.oldSignCent / 100).toFixed(2)}→${(a.newSignCent / 100).toFixed(2)} ` +
        `refund¥${(a.oldRefundCent / 100).toFixed(2)}→${(a.newRefundCent / 100).toFixed(2)} qr ${a.oldQr}→${a.newQr}`,
    )
  }
  console.log('\n变化样例:')
  for (const row of sampleChanges) {
    console.log(JSON.stringify(row))
  }

  if (apply) {
    clearCanonicalAttributionCache()
    await invalidateAndRebuildBusinessBoardCache('remap-canonical-order-attribution')
    console.log('\n已失效并重建经营缓存（正式重算）')
  } else {
    console.log('\n只读 dry-run。加 --apply 执行缓存正式重算。')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
