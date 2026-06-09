/**
 * 买家售后同步诊断
 * npx tsx apps/server/scripts/buyer-after-sales-sync-diagnose.ts --buyerShortCode=38f026
 * npx tsx apps/server/scripts/buyer-after-sales-sync-diagnose.ts --buyerKey=...
 */
import path from 'node:path'
import { config } from 'dotenv'
import { buildRawAnalyzeBundleAll } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../src/services/business-analysis.service'
import {
  isAfterSalesResultPending,
  resolveWorkbenchFetchStatus,
  shouldFetchAfterSalesWorkbench,
  shouldFetchInputFromView,
} from '../src/services/after-sales-fetch-decision.service'
import { viewMatchesBuyerKey, buildBuyerDisplayFields } from '../src/services/buyer-identity.service'
import {
  bootstrapWorkbenchCache,
  getWorkbenchRefundFromMemory,
  loadWorkbenchRefundMapFromDb,
  mergeWorkbenchIntoMemory,
} from '../src/services/xhs-after-sales-workbench.service'

config({ path: path.resolve(__dirname, '../.env') })

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length).trim() : undefined
}

async function main(): Promise<void> {
  const buyerKeyArg = parseArg('buyerKey')
  const buyerShortCodeArg = parseArg('buyerShortCode')

  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle) {
    console.error('无原始订单数据')
    process.exit(1)
  }

  await bootstrapWorkbenchCache()
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const views = artifacts?.views ?? []

  let buyerKey = buyerKeyArg ?? ''
  if (!buyerKey && buyerShortCodeArg) {
    const code = buyerShortCodeArg.toLowerCase()
    const hit = views.find((v) => {
      const raw = v.raw as Record<string, unknown> | undefined
      const k = raw?._buyerKey != null ? String(raw._buyerKey).trim() : v.buyerKey ?? ''
      if (!k) return false
      const display = buildBuyerDisplayFields(
        k,
        raw ?? {},
        raw?._buyerOfficialId != null ? String(raw._buyerOfficialId) : null,
      )
      return display.buyerShortCode.toLowerCase().includes(code)
    })
    if (!hit) {
      console.error(`未找到 buyerShortCode 含 ${buyerShortCodeArg} 的买家`)
      process.exit(1)
    }
    const raw = hit.raw as Record<string, unknown> | undefined
    buyerKey = raw?._buyerKey != null ? String(raw._buyerKey).trim() : hit.buyerKey ?? ''
  }

  if (!buyerKey) {
    console.error('请提供 --buyerKey= 或 --buyerShortCode=')
    process.exit(1)
  }

  const buyerViews = views.filter((v) => viewMatchesBuyerKey(v, buyerKey))
  if (buyerViews.length === 0) {
    console.error(`买家 ${buyerKey} 无订单`)
    process.exit(1)
  }

  const orderNos = [
    ...new Set(
      buyerViews
        .map((v) => (v.displayOrderNo || v.officialOrderNo || v.packageId || '').trim())
        .filter((n) => n && /^P/i.test(n)),
    ),
  ]
  const fromDb = await loadWorkbenchRefundMapFromDb(orderNos)
  for (const [k, v] of fromDb) mergeWorkbenchIntoMemory(k, v)

  const sampleRaw = buyerViews[0]?.raw as Record<string, unknown> | undefined
  const display = buildBuyerDisplayFields(
    buyerKey,
    sampleRaw ?? {},
    sampleRaw?._buyerOfficialId != null ? String(sampleRaw._buyerOfficialId) : null,
  )

  console.log(`buyerDisplayLabel: ${display.buyerDisplayLabel}`)
  console.log(`buyerKey: ${buyerKey}`)
  console.log(`orderCount: ${buyerViews.length}`)
  console.log('---')

  const rawByMatch = new Map<string, Record<string, unknown>>()
  for (const o of bundle.orders) {
    if (o.raw && o.matchOrderId) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)
  }

  const pendingNos: string[] = []

  for (const v of buyerViews.sort((a, b) =>
    (a.displayOrderNo || '').localeCompare(b.displayOrderNo || ''),
  )) {
    const raw =
      (v.raw as Record<string, unknown> | undefined) ??
      rawByMatch.get(v.matchOrderId || v.orderId)
    const input = shouldFetchInputFromView(
      Object.assign({}, v, { raw }) as typeof v & { raw?: Record<string, unknown> },
    )
    const orderNo = (v.displayOrderNo || v.officialOrderNo || v.packageId || '').trim()
    const cached = orderNo ? getWorkbenchRefundFromMemory(orderNo) : undefined
    const shouldFetch = shouldFetchAfterSalesWorkbench(input)
    const pending = isAfterSalesResultPending(input, cached, v.buyerProductRefundSource)
    if (pending && orderNo) pendingNos.push(orderNo)

    const wbStatus = resolveWorkbenchFetchStatus(cached)
    console.log(
      JSON.stringify(
        {
          orderNo,
          orderStatus: v.orderStatusText,
          afterSaleStatus: v.afterSaleStatusText,
          shouldFetchAfterSalesWorkbench: shouldFetch,
          workbenchFetchStatus: wbStatus,
          refundSource: v.buyerProductRefundSource,
          refundAmountCent: v.buyerProductRefundAmountCent ?? 0,
          pending,
          cacheFetchedAt: cached?.fetchedAt?.toISOString() ?? null,
          errorMessage: cached?.fetchError ?? null,
        },
        null,
        2,
      ),
    )
  }

  console.log('---')
  console.log(`needAfterSalesSync: ${pendingNos.length > 0}`)
  console.log(`pendingAfterSalesOrderNos: ${JSON.stringify([...new Set(pendingNos)])}`)
  const refundTotal = buyerViews.reduce((s, v) => s + (v.buyerProductRefundAmountCent ?? 0), 0)
  console.log(`refundTotalCent: ${refundTotal} (${(refundTotal / 100).toFixed(2)} yuan)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
