/**
 * 官方品退 + 售后单交叉匹配验收（只读）
 *
 * DATE=2026-06-01 npm run verify:quality-refund-cross-match
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache, loadAllQualityBadCases } from '../src/services/quality-badcase-store.service'
import { buildAnchorQualityRefundDrill } from '../src/services/board-drill.service'
import { resolveQualityRefundInfo } from '../src/services/quality-refund-resolution.service'
import { getBoardScopedViewsForRange } from '../src/services/board-scoped-views.service'
import {
  buildLiveAccountOrderQueries,
  loadAfterSalesBundleForOrderNos,
} from '../src/services/xhs-after-sales-workbench.service'
import { liveAccountOrderKey } from '../src/utils/live-account-cache-key.util'
import { filterViewsForCoreMetrics } from '../src/services/metrics-exclusion.service'
import { resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'

config({ path: path.resolve(__dirname, '../.env') })

const TARGET_ORDER = 'P795876371867202831'
const TARGET_AFTER_SALE = 'R6720283133492612'
const TARGET_BUYER = '果果鸭pki'
const TARGET_OFFICIAL_REASON = '做工粗糙/有瑕疵'
const TARGET_AFTER_REASON = '多拍/拍错/不想要'
const TARGET_AFTER_STATUS = '退款成功'
const TARGET_REFUND_YUAN = 149.5
const TARGET_ANCHOR = '飞云'

const failures: string[] = []
const warnings: string[] = []

function fail(msg: string): void {
  failures.push(msg)
  console.log(`✗ FAIL: ${msg}`)
}

function warn(msg: string): void {
  warnings.push(msg)
  console.log(`⚠ ${msg}`)
}

function ok(msg: string): void {
  console.log(`✓ ${msg}`)
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}

function approxEqual(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) <= eps
}

function loadHarAfterSaleSnapshot(): {
  reason?: string
  status?: string
  refund?: number
} | null {
  const harDir = process.env.HAR_DIR?.trim()
  if (!harDir || !fs.existsSync(harDir)) return null
  const patterns = ['订单', '账单', '售后']
  for (const file of fs.readdirSync(harDir)) {
    if (!file.endsWith('.har')) continue
    if (!patterns.some((p) => file.includes(p))) continue
    const full = path.join(harDir, file)
    try {
      const text = fs.readFileSync(full, 'utf-8')
      if (!text.includes(TARGET_ORDER) && !text.includes(TARGET_AFTER_SALE)) continue
      if (!text.includes(TARGET_AFTER_SALE)) continue
      return {
        reason: text.includes(TARGET_AFTER_REASON) ? TARGET_AFTER_REASON : undefined,
        status: text.includes('退款成功') ? TARGET_AFTER_STATUS : undefined,
        refund: text.includes(String(TARGET_REFUND_YUAN)) ? TARGET_REFUND_YUAN : undefined,
      }
    } catch {
      continue
    }
  }
  return null
}

function tryParseHarAfterSale(): void {
  section('HAR 辅助核对')
  const harDir = process.env.HAR_DIR?.trim()
  if (!harDir || !fs.existsSync(harDir)) {
    warn('未设置 HAR_DIR 或目录不存在，跳过 HAR 辅助核对')
    return
  }
  const snapshot = loadHarAfterSaleSnapshot()
  if (!snapshot) {
    warn('HAR 中未找到目标订单/售后单（可能 HAR 未导出该日数据）')
    return
  }
  if (snapshot.reason) ok(`HAR 含最终售后理由 ${snapshot.reason}`)
  if (snapshot.status) ok(`HAR 含售后状态 ${snapshot.status}`)
  if (snapshot.refund) ok(`HAR 含退款金额 ${snapshot.refund}`)
}

async function main(): Promise<void> {
  const dateKey = process.env.DATE?.trim() || '2026-06-01'
  console.log(`[verify:quality-refund-cross-match] 只读体检 DATE=${dateKey}`)

  section('基础数据')
  const [orders, liveSessions, qualityCases, creds, users] = await Promise.all([
    prisma.xhsRawOrder.count(),
    prisma.xhsRawLiveSession.count(),
    prisma.qualityBadCase.count(),
    prisma.platformCredential.count(),
    prisma.user.count(),
  ])
  console.log(`XhsRawOrder: ${orders}`)
  console.log(`XhsRawLiveSession: ${liveSessions}`)
  console.log(`QualityBadCase: ${qualityCases}`)
  console.log(`PlatformCredential: ${creds}`)
  console.log(`User: ${users}`)

  await bootstrapQualityBadCaseCache()

  section(`订单 ${TARGET_ORDER}`)
  const rawOrder = await prisma.xhsRawOrder.findFirst({
    where: {
      OR: [{ packageId: TARGET_ORDER }, { orderId: TARGET_ORDER }],
    },
  })
  if (!rawOrder) {
    fail(`订单 ${TARGET_ORDER} 不存在于 XhsRawOrder`)
  } else {
    ok(`订单存在 liveAccountId=${rawOrder.liveAccountId}`)
  }

  const officialCase = (await loadAllQualityBadCases()).find(
    (c) => c.packageId === TARGET_ORDER || c.matchedOrderNo === TARGET_ORDER,
  )
  if (!officialCase) {
    fail(`官方品退 QualityBadCase 未命中 ${TARGET_ORDER}`)
  } else {
    ok(`官方品退存在 matchStatus=${officialCase.matchStatus}`)
    const reasons = officialCase.negativeReasons.join('、')
    if (!reasons.includes('做工粗糙') && !reasons.includes('瑕疵')) {
      fail(`官方品退原因不符，实际: ${reasons || '—'}`)
    } else {
      ok(`官方品退原因含「${TARGET_OFFICIAL_REASON}」`)
    }
  }

  const workbench = await prisma.xhsAfterSalesWorkbenchCache.findFirst({
    where: { orderNo: TARGET_ORDER },
  })
  const hasWorkbenchAfterSale =
    Boolean(workbench?.returnsIds?.includes(TARGET_AFTER_SALE)) ||
    JSON.stringify(workbench?.rawDetail ?? '').includes(TARGET_AFTER_SALE)
  const hasOfficialAfterSale =
    Boolean(officialCase?.matchedAfterSaleId?.includes(TARGET_AFTER_SALE)) ||
    Boolean(officialCase?.sourceBizId?.includes(TARGET_AFTER_SALE))

  if (!workbench && !hasOfficialAfterSale) {
    fail(
      `官方品退存在，但售后单 ${TARGET_AFTER_SALE} 未进入系统售后记录；这是数据同步缺口，不是品退判断问题。`,
    )
  } else if (workbench) {
    ok(`售后工作台缓存存在 fetchStatus=${workbench.fetchStatus}`)
    if (!hasWorkbenchAfterSale && !hasOfficialAfterSale) {
      fail(
        `官方品退存在，但售后单 ${TARGET_AFTER_SALE} 未进入系统售后记录；这是数据同步缺口，不是品退判断问题。`,
      )
    } else if (hasWorkbenchAfterSale) {
      ok(`售后工作台含售后单 ${TARGET_AFTER_SALE}`)
    } else {
      ok(`官方品退记录含售后单 ${officialCase?.matchedAfterSaleId || officialCase?.sourceBizId}`)
    }
  } else {
    ok(`官方品退记录含售后单 ${officialCase?.matchedAfterSaleId || officialCase?.sourceBizId}`)
  }

  section('品退解析')
  const harSnapshot = loadHarAfterSaleSnapshot()
  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
  })
  const coreViews = filterViewsForCoreMetrics(scoped.views)
  const view = coreViews.find((v) => resolveMetricOrderNo(v) === TARGET_ORDER)
  if (!view) {
    fail(`经营视图未找到 ${TARGET_ORDER}（可能不在 ${dateKey} 支付范围）`)
  } else {
    const queries = buildLiveAccountOrderQueries([
      {
        liveAccountId: view.liveAccountId,
        displayOrderNo: TARGET_ORDER,
        packageId: view.packageId,
      },
    ])
    const { rawAfterSalesByOrderNo } = await loadAfterSalesBundleForOrderNos(queries)
    const cacheKey = liveAccountOrderKey(view.liveAccountId, TARGET_ORDER)
    const afterSaleRecords = rawAfterSalesByOrderNo.get(cacheKey) ?? []
    const qualityInfo = resolveQualityRefundInfo({
      view,
      afterSaleRecords,
      officialCase,
      verifySource: 'after_sale_workbench',
    })

    const statusText = qualityInfo.afterSaleStatus || '—'
    const statusOk =
      statusText.includes('退款成功') ||
      statusText.includes('售后完成') ||
      statusText.includes('成功')

    if (!qualityInfo.isQualityRefund) fail('未计入品退')
    else ok('仍计入品退')

    if (qualityInfo.qualityMainSource !== 'official_bad_case') {
      fail(`品退主来源应为 official_bad_case，实际 ${qualityInfo.qualityMainSource}`)
    } else {
      ok('主来源 official_bad_case')
    }

    if (afterSaleRecords.length === 0 && !hasOfficialAfterSale) {
      fail(
        `官方品退存在，但售后单 ${TARGET_AFTER_SALE} 未进入系统售后记录；这是数据同步缺口，不是品退判断问题。`,
      )
    } else if (afterSaleRecords.length > 0) {
      ok(`售后记录 ${afterSaleRecords.length} 条`)
    } else {
      ok('售后信息来自官方品退匹配字段')
    }

    if (qualityInfo.afterSaleOrderNo !== TARGET_AFTER_SALE) {
      fail(`售后单号应为 ${TARGET_AFTER_SALE}，实际 ${qualityInfo.afterSaleOrderNo || '—'}`)
    } else {
      ok(`售后单号 ${TARGET_AFTER_SALE}`)
    }

    if (!statusOk) {
      fail(`售后状态应为 ${TARGET_AFTER_STATUS}，实际 ${statusText}`)
    } else {
      ok(`售后状态 ${statusText}`)
    }

    const finalReason = qualityInfo.afterSaleFinalReasonText || qualityInfo.afterSaleReasonText
    const reasonOk =
      finalReason.includes('多拍') ||
      finalReason.includes('不想要') ||
      finalReason.includes('拍错')
    if (!reasonOk) {
      if (harSnapshot?.reason) {
        warn(
          `DB 未入库最终售后理由，HAR 可见「${harSnapshot.reason}」；这是数据同步缺口，不是品退判断问题。`,
        )
      } else {
        fail(`最终售后理由应为 ${TARGET_AFTER_REASON}，实际 ${finalReason || '—'}`)
      }
    } else {
      ok(`最终售后理由 ${finalReason}`)
    }

    const refundYuan = qualityInfo.afterSaleRefundAmountCent / 100
    if (!approxEqual(refundYuan, TARGET_REFUND_YUAN)) {
      fail(`退款金额应为 ${TARGET_REFUND_YUAN}，实际 ${refundYuan}`)
    } else {
      ok(`退款金额 ${refundYuan}`)
    }

    if (qualityInfo.verifyDisplayLabel.includes('暂未匹配')) {
      fail(`展示标签不应含「暂未匹配到售后单」，实际 ${qualityInfo.verifyDisplayLabel}`)
    } else {
      ok(`展示标签 ${qualityInfo.verifyDisplayLabel}`)
    }

    if (!qualityInfo.verifyDisplayLabel.includes('售后单已匹配')) {
      fail(`展示标签应为「官方品退，售后单已匹配」，实际 ${qualityInfo.verifyDisplayLabel}`)
    } else {
      ok('展示标签含「售后单已匹配」')
    }

    if (!qualityInfo.extraHint.includes('买家后续可能改过售后理由')) {
      if (reasonOk) {
        fail(`缺少提示：买家后续可能改过售后理由，实际 extraHint=${qualityInfo.extraHint || '—'}`)
      } else if (harSnapshot?.reason) {
        warn('DB 缺售后理由，无法校验 extraHint；HAR 可见理由已变更')
      } else {
        fail(`缺少提示：买家后续可能改过售后理由，实际 extraHint=${qualityInfo.extraHint || '—'}`)
      }
    } else {
      ok('含「买家后续可能改过售后理由」提示')
    }

    if (!qualityInfo.afterSaleReasonChanged) {
      warn('afterSaleReasonChanged=false（若售后理由已变更，期望为 true）')
    } else {
      ok('afterSaleReasonChanged=true')
    }
  }

  section('主播品退 drill API')
  const drill = await buildAnchorQualityRefundDrill({
    preset: 'custom',
    anchorName: TARGET_ANCHOR,
    startDate: dateKey,
    endDate: dateKey,
    page: 1,
    pageSize: 100,
  })
  const row = drill.rows.find((r) => r.orderNo === TARGET_ORDER)
  if (!row) {
    fail(`飞云品退 drill 未返回 ${TARGET_ORDER}`)
  } else {
    ok(`drill 返回目标订单`)
    if (row.paymentAnchorName !== TARGET_ANCHOR) {
      fail(`支付归属主播应为 ${TARGET_ANCHOR}，实际 ${row.paymentAnchorName}`)
    } else {
      ok(`支付归属主播 ${TARGET_ANCHOR}`)
    }
    if (row.qualityAttributionAnchorName !== TARGET_ANCHOR) {
      fail(`归属主播应为 ${TARGET_ANCHOR}，实际 ${row.qualityAttributionAnchorName}`)
    } else {
      ok(`归属主播 ${TARGET_ANCHOR}`)
    }
    if (!row.qianfanDetailAvailable) fail('未返回 qianfanDetailAvailable')
    else ok('qianfanDetailAvailable=true')
    if (row.buyerNickname && !row.buyerNickname.includes('果果')) {
      warn(`买家昵称 ${row.buyerNickname}（期望含 ${TARGET_BUYER}）`)
    } else {
      ok(`买家 ${row.buyerNickname || TARGET_BUYER}`)
    }
  }

  section('前端静态检查')
  const drawerPath = path.resolve(
    __dirname,
    '../../web/src/components/board/AnchorQualityRefundDrawer.tsx',
  )
  const drawer = fs.readFileSync(drawerPath, 'utf-8')
  if (!drawer.includes('QianfanOrderDetailButton')) fail('抽屉未接入千帆详情按钮')
  else ok('抽屉含千帆详情按钮')
  if (!drawer.includes('extraHint')) fail('抽屉未展示 extraHint')
  else ok('抽屉展示 extraHint')
  if (!drawer.includes('afterSaleOrderNo')) fail('抽屉未展示售后单号')
  else ok('抽屉展示售后单号')

  tryParseHarAfterSale()

  section('汇总')
  console.log(`warnings: ${warnings.length}`)
  console.log(`failures: ${failures.length}`)
  for (const w of warnings) console.log(`  ⚠ ${w}`)
  for (const f of failures) console.log(`  ✗ ${f}`)

  if (failures.length > 0) {
    console.log('\nverify:quality-refund-cross-match FAIL')
    process.exit(1)
  }
  console.log('\nverify:quality-refund-cross-match OK')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
