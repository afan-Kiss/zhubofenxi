/**
 * 单订单 GMV 纳入诊断：P795491110326121261
 * npx tsx scripts/diag-order-p795491.ts
 */
import path from 'node:path'
import { config } from 'dotenv'
import { buildGmvOrderDiagnostic } from '../src/services/gmv-diagnostic.service'

config({ path: path.resolve(__dirname, '../.env') })

const PKG = 'P795491110326121261'

async function main(): Promise<void> {
  const d = await buildGmvOrderDiagnostic(PKG, 'custom', '2026-05-28', '2026-05-28')
  console.log(JSON.stringify(d, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
