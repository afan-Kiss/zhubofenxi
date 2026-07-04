#!/usr/bin/env tsx
import fs from 'node:fs'
import path from 'node:path'
import { config as loadDotenv } from 'dotenv'

const serverEnv = path.resolve(process.cwd(), 'apps/server/.env')
if (fs.existsSync(serverEnv)) loadDotenv({ path: serverEnv })
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:../data/app.db'

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
