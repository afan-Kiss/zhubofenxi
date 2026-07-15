import { loadEnv } from '../src/config/env'
import { syncCsChatSessions } from '../src/services/refund-analysis/cs-chat-sync.service'

async function main() {
  loadEnv()
  const preferLive = process.argv.includes('--live')
  const result = await syncCsChatSessions({ preferLive, days: 60 })
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
