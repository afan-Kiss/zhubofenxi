/**
 * 部署后只读：输出四店 boss v2 冷却 hash 前缀（不含 Cookie）
 * npx tsx apps/server/scripts/preview-boss-cooldown-hashes.ts
 */
import { BOSS_DASHBOARD_SHOPS } from '../src/config/boss-dashboard.constants'
import { previewBossAggregateRequestHash } from '../src/services/boss-dashboard/boss-dashboard-api.service'

async function main(): Promise<void> {
  for (const shop of BOSS_DASHBOARD_SHOPS) {
    const p = await previewBossAggregateRequestHash(shop)
    if (!p) {
      console.log(`${shop.shopKey} NONE`)
      continue
    }
    console.log(`${p.shopKey} scope=${p.scopeKey.slice(0, 28)} hash=${p.hash.slice(0, 12)}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
