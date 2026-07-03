/**
 * 用外部 Cookie 测试品退接口（签名 + summaryList）
 * 用法: tsx scripts/dev/test-external-cookie-quality-api.ts [cookieFile]
 */
import fs from 'node:fs'
import path from 'node:path'
import { probeQualityBadcaseSignForAccount } from '../../src/services/quality-badcase-sign.service'
import { inspectCookieForSigning } from '../../src/services/xhs-sign.service'

async function main(): Promise<void> {
  const cookieFile =
    process.argv[2] ||
    path.resolve('../../../千帆中转机器人/tmp/latest-tap-cookie.txt')
  const cookie = fs.existsSync(cookieFile) ? fs.readFileSync(cookieFile, 'utf8').trim() : ''
  const inspect = inspectCookieForSigning(cookie)

  console.log('\n=== 品退接口 Cookie 测试 ===')
  console.log('cookieFile:', cookieFile)
  console.log('cookieLength:', inspect.cookieLength)
  console.log('hasA1:', inspect.hasA1)
  console.log('hasWebSession:', inspect.hasWebSession)
  console.log('hasAccessTokenArk:', inspect.hasAccessTokenArk)

  const result = await probeQualityBadcaseSignForAccount({
    accountName: 'tap-captured',
    liveAccountId: 'external-cookie-test',
    cookie,
  })

  console.log('\n--- 结果 ---')
  console.log('signOk:', result.signOk)
  console.log('qualityApiOk:', result.qualityApiOk)
  if (result.errorReason) console.log('errorReason:', result.errorReason)
  if (result.signError) console.log('signError:', result.signError)
  if (result.qualityApiError) console.log('qualityApiError:', result.qualityApiError)
  if (result.pythonCommand) console.log('pythonCommand:', result.pythonCommand)
  if (result.diagnostics?.stderr?.trim()) {
    console.log('stderr:', result.diagnostics.stderr.trim().slice(0, 800))
  }

  if (!result.signOk || !result.qualityApiOk) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
