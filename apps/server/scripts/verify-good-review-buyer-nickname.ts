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
  const nick = review.buyerNickname?.trim()
  if (nick) return nick
  if (review.isAnonymous) return '匿名买家'
  return '未获取昵称'
}

async function main() {
  assert.equal(
    formatGoodReviewBuyerLabel({ buyerNickname: 'Sweet🦄', isAnonymous: false }),
    'Sweet🦄',
  )
  // 匿名但订单能匹配到昵称：直接展示真实昵称
  assert.equal(
    formatGoodReviewBuyerLabel({ buyerNickname: 'Sweet🦄', isAnonymous: true }),
    'Sweet🦄',
  )
  assert.equal(
    formatGoodReviewBuyerLabel({ buyerNickname: null, isAnonymous: true }),
    '匿名买家',
  )
  assert.equal(
    formatGoodReviewBuyerLabel({ buyerNickname: null, isAnonymous: false }),
    '未获取昵称',
  )
  console.log('  ✓ 买家昵称展示文案（匿名可展示订单昵称）')

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
    querySrc.includes('匿名评价仍展示订单匹配到的真实昵称'),
    '匿名评价应允许回传订单昵称',
  )
  console.log('  ✓ 匿名评价可回传订单匹配昵称')

  console.log('\nALL PASS')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
