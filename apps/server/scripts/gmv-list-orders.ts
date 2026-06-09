import path from 'node:path'
import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { resolveDateRange } from '../src/utils/date-range'
import { buildRawAnalyzeBundle } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../src/services/business-analysis.service'
import { centToYuan } from '../src/utils/money'

config({ path: path.resolve(__dirname, '../.env') })
const prisma = new PrismaClient()

async function main(): Promise<void> {
  const range = resolveDateRange('custom', '2026-05-28', '2026-05-28')
  const bundle = await buildRawAnalyzeBundle(range)
  if (!bundle) {
    console.log('no bundle')
    return
  }
  console.log('raw rows', bundle.orders.length)
  for (const o of bundle.orders) {
    console.log({
      match: o.matchOrderId,
      pkg: o.packageId,
      biz: o.bizOrderId,
      gmv: centToYuan(o.gmvCent),
      recv: centToYuan(o.receivableAmountCent),
      source: o.gmvSourceUsed,
      errors: o.errors,
      time: o.orderTime?.toISOString(),
    })
  }
  const art = prepareAnalysisArtifactsFromRaw(bundle)
  console.log('deduped', art.dedupe.uniqueOrders.length)
  for (const o of art.dedupe.uniqueOrders) {
    console.log('UNIQUE', o.matchOrderId, centToYuan(o.gmvCent), o.gmvSourceUsed)
  }
  console.log('views gmv', centToYuan(art.views.reduce((s, v) => s + v.gmvCent, 0)))
}

main()
  .catch(console.error)
  .finally(() => void prisma.$disconnect())
