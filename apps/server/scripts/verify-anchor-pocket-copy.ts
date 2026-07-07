/**
 * 主播预计留下金额文案验收
 *
 * npm run verify:anchor-pocket-copy
 */
import path from 'node:path'
import { config } from 'dotenv'
import {
  ANCHOR_POCKET_CALIBER_NOTE,
  buildAnchorPocketSummary,
} from '../src/services/anchor-pocket-revenue.service'

config({ path: path.resolve(__dirname, '../.env') })

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}
function fail(msg: string): void {
  console.error(`  ✗ FAIL: ${msg}`)
}

async function main(): Promise<void> {
  console.log('verify-anchor-pocket-copy\n')
  let failures = 0

  const requiredPhrases = ['不是平台结算到账金额', '平台佣金', '服务费', '账期差异未计入']

  if (!requiredPhrases.every((p) => ANCHOR_POCKET_CALIBER_NOTE.includes(p))) {
    fail(`ANCHOR_POCKET_CALIBER_NOTE 缺少必要说明: ${ANCHOR_POCKET_CALIBER_NOTE}`)
    failures++
  } else {
    ok('ANCHOR_POCKET_CALIBER_NOTE 含平台结算说明')
  }

  try {
    const summary = await buildAnchorPocketSummary({
      preset: 'thisMonth',
      role: 'super_admin',
      username: 'verify-script',
    })
    const note = summary.caliber.note
    const settlementNote = summary.caliber.settlementNote
    if (!requiredPhrases.every((p) => note.includes(p))) {
      fail('API caliber.note 缺少平台结算说明')
      failures++
    } else {
      ok('API caliber.note 含不是平台结算到账金额')
    }
    if (!settlementNote.includes('不是平台结算到账金额')) {
      fail(`API settlementNote 缺少说明: ${settlementNote}`)
      failures++
    } else {
      ok('API caliber.settlementNote 含不是平台结算到账金额')
    }
  } catch (err) {
    fail(`buildAnchorPocketSummary 失败: ${err instanceof Error ? err.message : String(err)}`)
    failures++
  }

  if (failures > 0) {
    console.log(`\nFAIL (${failures} 项)`)
    process.exit(1)
  }
  console.log('\nPASS')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
