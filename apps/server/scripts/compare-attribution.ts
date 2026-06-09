import path from 'node:path'
import { config } from 'dotenv'
import { resolveDateRange } from '../src/utils/date-range'
import { buildRawAnalyzeBundle } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../src/services/business-analysis.service'
import { attributeOrders } from '../src/services/order-attribution.service'
import { refreshAnchorConfigCache } from '../src/services/anchor.service'

config({ path: path.resolve(__dirname, '../.env') })

const ids = [
  'P795490183646098221',
  'P795488136122205841',
  'P795487315710005941',
  'P795491110326121261',
]

async function main(): Promise<void> {
  await refreshAnchorConfigCache()
  const range = resolveDateRange('custom', '2026-05-28', '2026-05-28')
  const bundle = await buildRawAnalyzeBundle(range)
  if (!bundle) return
  const art = prepareAnalysisArtifactsFromRaw(bundle)
  const anchorConfig = await refreshAnchorConfigCache()
  const attr = attributeOrders(art.dedupe.uniqueOrders, bundle.liveSessions, anchorConfig)
  for (const id of ids) {
    const o = art.dedupe.uniqueOrders.find((x) => x.matchOrderId === id)
  console.log(id, attr.get(id) ?? '未归属', o?.orderStatusText, o?.afterSaleStatusText)
  }
  console.log('live:', bundle.liveSessions.map((s) => ({ id: s.id, anchor: s.anchorName, start: s.startTimeText })))
}

main().catch(console.error)
