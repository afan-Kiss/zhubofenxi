#!/usr/bin/env tsx
import { runMonthlyCloseAuto } from '../src/services/monthly-close-auto.service'

async function main() {
  const force = process.argv.includes('--force')
  const monthArg = process.argv.find((a) => a.startsWith('--month='))
  const month = monthArg?.split('=')[1]
  const report = await runMonthlyCloseAuto({ month, force, fullScan: true })
  console.log(JSON.stringify(report, null, 2))
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
