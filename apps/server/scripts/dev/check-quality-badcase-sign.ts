/**
 * 品退 / 商品问题接口签名自检（不拉全量数据）
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../../src/lib/prisma'
import { decryptText } from '../../src/utils/crypto'
import {
  inspectCookieForSigning,
} from '../../src/services/xhs-sign.service'
import {
  probeQualityBadcaseSignForAccount,
  type QualityBadcaseSignCheckResult,
} from '../../src/services/quality-badcase-sign.service'

config({ path: path.resolve(__dirname, '../../.env') })

async function main(): Promise<void> {
  console.log('\n=== 品退接口签名自检 ===\n')

  const accounts = await prisma.platformCredential.findMany({
    where: { enabled: true },
    orderBy: { displayName: 'asc' },
  })

  if (accounts.length === 0) {
    console.log('无启用的直播号')
    return
  }

  let failCount = 0
  const results: QualityBadcaseSignCheckResult[] = []

  for (const account of accounts) {
    const cookie = account.cookieEncrypted?.trim()
      ? decryptText(account.cookieEncrypted)
      : ''
    const inspect = inspectCookieForSigning(cookie)
    console.log(`--- ${account.displayName?.trim() || account.platformName} (${account.id}) ---`)
    console.log(
      `  hasA1=${inspect.hasA1} hasWebSession=${inspect.hasWebSession} hasAccessTokenArk=${inspect.hasAccessTokenArk} cookieLength=${inspect.cookieLength}`,
    )

    if (!cookie.trim()) {
      failCount += 1
      console.log('  signOk=false errorReason=no_cookie')
      results.push({
        accountName: account.displayName?.trim() || account.platformName,
        liveAccountId: account.id,
        hasA1: false,
        hasWebSession: false,
        hasAccessTokenArk: false,
        cookieLength: 0,
        pythonCommand: null,
        scriptPath: null,
        scriptExists: false,
        signOk: false,
        qualityApiOk: false,
        errorReason: 'no_cookie',
        signError: '尚未配置 Cookie',
        qualityApiError: null,
        diagnostics: null,
      })
      continue
    }

    const result = await probeQualityBadcaseSignForAccount({
      accountName: account.displayName?.trim() || account.platformName,
      liveAccountId: account.id,
      cookie,
    })
    results.push(result)

    console.log(`  pythonCommand=${result.pythonCommand ?? '—'}`)
    console.log(`  scriptPath=${result.scriptPath ?? '—'}`)
    console.log(`  scriptExists=${result.scriptExists}`)
    console.log(`  signOk=${result.signOk}`)
    console.log(`  qualityApiOk=${result.qualityApiOk}`)
    if (result.errorReason) console.log(`  errorReason=${result.errorReason}`)
    if (result.signError) console.log(`  signError=${result.signError}`)
    if (result.qualityApiError) console.log(`  qualityApiError=${result.qualityApiError}`)
    if (result.diagnostics?.stderr?.trim()) {
      console.log(`  stderr=${result.diagnostics.stderr.trim().slice(0, 500)}`)
    }
    if (!result.signOk) failCount += 1
    console.log('')
  }

  console.log('=== 汇总 ===')
  for (const r of results) {
    console.log(
      `${r.accountName}: signOk=${r.signOk} qualityApiOk=${r.qualityApiOk}${r.errorReason ? ` reason=${r.errorReason}` : ''}`,
    )
  }

  if (failCount > 0) {
    console.error(`\n${failCount}/${results.length} 个账号签名自检未通过\n`)
    process.exit(1)
  }
  console.log(`\n全部 ${results.length} 个账号签名自检通过\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
