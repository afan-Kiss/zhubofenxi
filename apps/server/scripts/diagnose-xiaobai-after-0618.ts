/**
 * 只读诊断：2026-06-18～06-30 小白场次候选订单
 *
 * START_DATE=2026-06-18 END_DATE=2026-06-30 \
 *   npx tsx apps/server/scripts/diagnose-xiaobai-after-0618.ts
 */
import { prisma } from '../src/lib/prisma'
import { ANCHOR_XIAOBAI_SCHEDULE_START_DATE } from '../src/config/anchor-schedule.constants'
import { refreshAnchorConfigCache } from '../src/services/anchor.service'
import { loadBoardArtifactsForRange } from '../src/services/board-metrics.service'
import { attachRawByMatchToViews } from '../src/services/low-price-brush-order.service'
import { filterViewsForCoreMetrics } from '../src/services/metrics-exclusion.service'
import {
  resolveCanonicalOrderAttribution,
  parseViewOrderCreateTimeMs,
  CANONICAL_ATTRIBUTION_VERSION,
} from '../src/services/canonical-order-attribution.service'
import {
  normalizeShopSessionKey,
  parseViewPayTimeMs,
} from '../src/services/anchor-performance-attribution.service'
import { isInXiaoBaiOrderSlot } from '../src/services/anchor-xiaobai-slot.util'
import { isEffectiveSignedView } from '../src/services/strict-after-sale-metrics.service'
import { resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { getEffectiveScheduleTableForDate } from '../src/services/anchor-daily-schedule.service'
import { formatDateKeyShanghai } from '../src/utils/business-timezone'
import { ensureManualAnchorOverrideCache } from '../src/services/order-anchor-manual-override.service'
import { orderLiveRoomMatchesSchedule } from '../src/utils/shop-name-normalize.util'
import { matchPlatformReturnReason } from '../src/utils/quality-return'

const START = (process.env.START_DATE ?? '2026-06-18').trim()
const END = (process.env.END_DATE ?? '2026-06-30').trim()

function yuan(cent: number): string {
  return `¥${(cent / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function addDay(dateKey: string): string {
  return formatDateKeyShanghai(new Date(Date.parse(`${dateKey}T12:00:00+08:00`) + 86_400_000))
}

function eachDay(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = start; d <= end; d = addDay(d)) out.push(d)
  return out
}

async function main() {
  console.log('=== diagnose-xiaobai-after-0618 (readonly) ===')
  console.log(`range: ${START} ~ ${END}`)
  console.log(`CANONICAL_ATTRIBUTION_VERSION=${CANONICAL_ATTRIBUTION_VERSION}`)
  console.log(`XIAOBAI_HIRE=${ANCHOR_XIAOBAI_SCHEDULE_START_DATE}`)
  console.log('')

  await refreshAnchorConfigCache()
  await ensureManualAnchorOverrideCache()

  // 入职日前人工排班小白警告
  console.log('=== WARN: 小白人工排班早于入职日 ===')
  const earlyManual = await prisma.anchorDailySchedule.findMany({
    where: {
      anchorName: '小白',
      enabled: true,
      source: 'manual',
      scheduleDate: { lt: ANCHOR_XIAOBAI_SCHEDULE_START_DATE },
    },
    orderBy: { scheduleDate: 'asc' },
  })
  if (!earlyManual.length) {
    console.log('(none)')
  } else {
    for (const r of earlyManual) {
      console.log(
        JSON.stringify({
          scheduleDate: r.scheduleDate,
          shopName: r.shopName,
          liveRoomName: r.liveRoomName,
          startAt: r.startAt.toISOString(),
          endAt: r.endAt.toISOString(),
          source: r.source,
          createdAt: r.createdAt?.toISOString?.() ?? null,
          updatedAt: r.updatedAt?.toISOString?.() ?? null,
          id: r.id,
        }),
      )
    }
  }
  console.log('')

  // 期内小白有效排班统计
  console.log('=== 期内小白有效排班 ===')
  let manualXbDays = 0
  for (const day of eachDay(START, END)) {
    const table = await getEffectiveScheduleTableForDate(day)
    const xb = table.rows.filter((r) => r.anchorName === '小白' && r.enabled)
    if (!xb.length) continue
    const sources = xb.map((r) => r.source).join(',')
    const hasManual = xb.some((r) => r.source === 'manual')
    if (hasManual) manualXbDays++
    console.log(
      `[${day}] xbRows=${xb.length} sources=${sources} confirmed=${table.confirmed}`,
    )
  }
  console.log(`manual小白场次天数: ${manualXbDays}`)
  console.log('')

  const { views, rawByMatch } = await loadBoardArtifactsForRange('custom', START, END)
  const core = filterViewsForCoreMetrics(attachRawByMatchToViews(views, rawByMatch)).filter(
    (v) => v.includedInGmv,
  )

  type Row = {
    orderNo: string
    createTime: string
    payTime: string
    liveAccountName: string
    originalAnchorName: string
    effectiveScheduleSource: string
    effectiveScheduleAnchorName: string
    matchedScheduleId: string | null
    canonicalAnchorName: string
    canonicalAttributionType: string
    attributionExplain: string
    paymentBaseCent: number
    actualSignAmountCent: number
    isEffectiveSigned: boolean
    refundCent: number
    qualityReturn: boolean
    bucket: string
  }

  const rows: Row[] = []
  let missingCreate = 0
  let missingLive = 0
  let conflictN = 0

  for (const v of core) {
    const create = parseViewOrderCreateTimeMs(v)
    const dateKey = create.ms != null ? formatDateKeyShanghai(new Date(create.ms)) : null
    if (dateKey == null || dateKey < START || dateKey > END) continue

    const shop = (v.liveAccountName ?? '').trim()
    if (!shop) {
      missingLive++
      continue
    }
    if (create.ms == null) {
      missingCreate++
      continue
    }

    const table = await getEffectiveScheduleTableForDate(dateKey)
    const schedHit = table.rows.find(
      (r) =>
        r.enabled &&
        r.anchorName === '小白' &&
        orderLiveRoomMatchesSchedule(shop, r.shopName, r.liveRoomName) &&
        create.ms! >= new Date(r.startAt).getTime() &&
        create.ms! < new Date(r.endAt).getTime(),
    )
    const xiangyuAfternoon =
      normalizeShopSessionKey(shop) === 'xiangyu' && isInXiaoBaiOrderSlot(new Date(create.ms))
    if (!schedHit && !xiangyuAfternoon) continue

    const c = await resolveCanonicalOrderAttribution(v)
    if (c.attributionType === 'conflict') conflictN++

    let bucket = 'other'
    if (c.canonicalAnchorName === '小白') bucket = 'ok_xiaobai'
    else if (c.canonicalAnchorName === '子杰') bucket = 'err_zijie'
    else if (c.canonicalAnchorName === '小艺') bucket = 'err_xiaoyi'
    else if (c.canonicalAnchorName === '未归属') bucket = 'unassigned'
    else bucket = 'err_other'

    const payMs = parseViewPayTimeMs(v)
    rows.push({
      orderNo: resolveMetricOrderNo(v),
      createTime: create.text,
      payTime:
        payMs != null
          ? new Date(payMs).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
          : '—',
      liveAccountName: shop,
      originalAnchorName: (v.anchorName ?? '').trim() || '未归属',
      effectiveScheduleSource: schedHit?.source ?? (xiangyuAfternoon ? 'fixed_xiaobai_slot' : '—'),
      effectiveScheduleAnchorName: schedHit?.anchorName ?? (xiangyuAfternoon ? '小白' : '—'),
      matchedScheduleId: c.matchedScheduleId,
      canonicalAnchorName: c.canonicalAnchorName,
      canonicalAttributionType: c.attributionType,
      attributionExplain: c.attributionExplain,
      paymentBaseCent: v.paymentBaseCent ?? 0,
      actualSignAmountCent: v.actualSignedAmountCent ?? 0,
      isEffectiveSigned: isEffectiveSignedView(v),
      refundCent: v.boardRefundAmountCent ?? v.returnAmountCent ?? 0,
      qualityReturn: Boolean(
        (v as { qualityReturn?: boolean }).qualityReturn ??
          matchPlatformReturnReason(String((v as { returnReason?: string }).returnReason ?? ''))
            .isQualityReturn,
      ),
      bucket,
    })
  }

  const sum = (list: Row[]) => list.reduce((s, r) => s + r.paymentBaseCent, 0)
  const by = (b: string) => rows.filter((r) => r.bucket === b)
  const ok = by('ok_xiaobai')
  const signed = ok.filter((r) => r.isEffectiveSigned)

  console.log('=== Overview ===')
  console.log(`candidates: ${rows.length} / GMV ${yuan(sum(rows))}`)
  console.log(`正确归小白: ${ok.length} / ${yuan(sum(ok))}`)
  console.log(`错误归子杰: ${by('err_zijie').length} / ${yuan(sum(by('err_zijie')))}`)
  console.log(`错误归小艺: ${by('err_xiaoyi').length} / ${yuan(sum(by('err_xiaoyi')))}`)
  console.log(`错误归其他: ${by('err_other').length} / ${yuan(sum(by('err_other')))}`)
  console.log(`未归属: ${by('unassigned').length} / ${yuan(sum(by('unassigned')))}`)
  console.log(`缺少下单时间(区间内跳过计数): ${missingCreate}`)
  console.log(`缺少直播号: ${missingLive}`)
  console.log(`归属冲突: ${conflictN}`)
  console.log(
    `小白已签收: ${signed.length} / ${yuan(signed.reduce((s, r) => s + r.actualSignAmountCent, 0))}`,
  )
  console.log('')

  console.log('=== Each candidate ===')
  for (const r of rows) {
    const { bucket: _b, ...rest } = r
    console.log(JSON.stringify(rest))
  }

  console.log('\nDONE (readonly)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
