#!/usr/bin/env tsx
import { runDataAccuracyAudit } from '../src/services/data-accuracy-audit.service'
import { resolveMonthlyCloseMonth } from '../src/utils/monthly-close-month.util'

async function main() {
  const autoPrev = process.argv.includes('--auto-prev-month')
  let startDate = process.argv.find((a) => a.startsWith('--startDate='))?.split('=')[1]
  let endDate = process.argv.find((a) => a.startsWith('--endDate='))?.split('=')[1]
  if (autoPrev || (!startDate && !endDate)) {
    const scope = resolveMonthlyCloseMonth({ autoPrevMonth: true })
    startDate = scope.startDate
    endDate = scope.endDate
  }
  if (!startDate || !endDate) {
    console.error('Usage: data-accuracy-audit.ts --startDate=YYYY-MM-DD --endDate=YYYY-MM-DD')
    process.exit(1)
  }
  const report = await runDataAccuracyAudit({
    startDate,
    endDate,
    fullScan: process.argv.includes('--fullScan'),
  })
  console.log(JSON.stringify(report, null, 2))
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
