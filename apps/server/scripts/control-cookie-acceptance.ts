/**
 * 总控千帆 Cookie 接入验收（不打印完整 Cookie）
 */
import { config as loadDotenv } from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { QIANFAN_SHOPS } from '../src/config/qianfan-shops.constants'
import { getQianfanCookie } from '../src/lib/controlCookieClient'
import {
  bootstrapQianfanCookiesForSync,
  clearSessionCookieCache,
} from '../src/services/qianfan-cookie-resolver.service'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
loadDotenv({ path: path.join(ROOT, '.env') })

async function main() {
  const lines: string[] = []
  const token = String(process.env.CONTROL_SERVICE_TOKEN || '').trim()
  const base = process.env.CONTROL_SERVER_URL || 'http://47.108.21.50/control'

  lines.push(`CONTROL_SERVER_URL=${base}`)
  lines.push(`CONTROL_SERVICE_TOKEN configured=${Boolean(token)}`)

  if (!token) {
    lines.push('SKIP live resolve: no token')
  } else {
    for (const shop of QIANFAN_SHOPS) {
      const r = await getQianfanCookie({ shopName: shop })
      lines.push(
        `${shop}: source=${r.source} ok=${r.ok} len=${r.value.length} hash8=${String(r.cookieHash || '').slice(0, 8)}`,
      )
    }
  }

  clearSessionCookieCache()
  const savedToken = process.env.CONTROL_SERVICE_TOKEN
  process.env.CONTROL_SERVICE_TOKEN = 'bad-token-for-test'
  const bad403 = await getQianfanCookie({
    shopName: QIANFAN_SHOPS[0]!,
    fallbackValue: 'fallback-test=2',
  })
  process.env.CONTROL_SERVICE_TOKEN = savedToken
  lines.push(`bad-token fallback: source=${bad403.source} len=${bad403.value.length}`)

  if (token) {
    process.env.CONTROL_SERVICE_TOKEN = token
    const summary = await bootstrapQianfanCookiesForSync()
    lines.push(
      `bootstrap: control=${summary.controlOk} env=${summary.envFallback} sqlite=${summary.sqliteFallback} missing=${summary.missing}`,
    )
  }

  console.log(lines.join('\n'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
