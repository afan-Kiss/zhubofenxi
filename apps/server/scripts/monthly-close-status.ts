#!/usr/bin/env tsx
import { getMonthlyCloseStatus } from '../src/services/monthly-close-auto.service'

async function main() {
  const status = await getMonthlyCloseStatus()
  console.log(JSON.stringify(status, null, 2))
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
