/**
 * 经营同步 debug：输出 businessSync / activeJob / 最近任务
 * 用法: npm run debug:sync
 */
import { getJson } from './metrics-acceptance/api-client'

async function main(): Promise<void> {
  const { url, data } = await getJson<Record<string, unknown>>('/api/board/sync-debug')
  console.log('[debug:sync] url=', url)
  console.log(JSON.stringify(data, null, 2))
}

main().catch((err) => {
  console.error('[debug:sync] FAIL', err)
  process.exit(1)
})
