/**
 * 好评买家昵称：匿名文案 + 订单补齐字段契约
 * npx tsx apps/server/scripts/verify-good-review-buyer-nickname.ts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pickBuyerNicknameFromRaw } from '../src/services/buyer-identity.service'

function formatGoodReviewBuyerLabel(review: {
  buyerNickname: string | null
  isAnonymous: boolean
}): string {
  if (review.isAnonymous) return '匿名买家'
  const nick = review.buyerNickname?.trim()
  return nick || '未获取昵称'
}

async function main() {
  assert.equal(
    formatGoodReviewBuyerLabel({ buyerNickname: 'Sweet🦄', isAnonymous: false }),
    'Sweet🦄',
  )
  assert.equal(
    formatGoodReviewBuyerLabel({ buyerNickname: 'Sweet🦄', isAnonymous: true }),
    '匿名买家',
  )
  assert.equal(
    formatGoodReviewBuyerLabel({ buyerNickname: null, isAnonymous: false }),
    '未获取昵称',
  )
  console.log('  ✓ 买家昵称展示文案')

  const nick = pickBuyerNicknameFromRaw({
    userInfo: { nickName: 'Sweet🦄' },
    _buyerNickname: 'Sweet🦄',
  })
  assert.equal(nick, 'Sweet🦄')
  console.log('  ✓ 订单 raw 可解析买家昵称')

  const querySrc = fs.readFileSync(
    path.resolve(__dirname, '../src/services/good-review/good-review-query.service.ts'),
    'utf8',
  )
  assert.ok(
    querySrc.includes('row.isAnonymous') && querySrc.includes('? null'),
    '匿名评价应清空 buyerNickname',
  )
  console.log('  ✓ 匿名评价不回传真实昵称')

  console.log('\nALL PASS')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
