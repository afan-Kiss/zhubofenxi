/**
 * 四店规范化 + XY/祥钰不得交叉
 * npx tsx apps/server/scripts/verify-four-shop-normalization.ts
 */
import assert from 'node:assert/strict'
import { resolveCanonicalShopName } from '../src/config/qianfan-shops.constants'
import { normalizeShopSessionKey } from '../src/services/shop-session-fallback.service'
import { orderLiveRoomMatchesSchedule, shopNamesMatch } from '../src/utils/shop-name-normalize.util'

function ok(msg: string) {
  console.log(`  ✓ ${msg}`)
}

function main() {
  console.log('verify-four-shop-normalization')
  assert.equal(resolveCanonicalShopName('XY祥钰珠宝'), 'XY祥钰珠宝')
  assert.equal(resolveCanonicalShopName('xy祥钰珠宝'), 'XY祥钰珠宝')
  assert.equal(resolveCanonicalShopName('祥钰珠宝'), '祥钰珠宝')
  assert.equal(resolveCanonicalShopName('拾玉居'), '拾玉居和田玉')
  assert.equal(resolveCanonicalShopName('拾玉居和田玉'), '拾玉居和田玉')
  assert.equal(resolveCanonicalShopName('和田雅玉'), '和田雅玉')
  ok('canonical 四店拆分')

  assert.equal(normalizeShopSessionKey('XY祥钰珠宝'), 'xyxiangyu')
  assert.equal(normalizeShopSessionKey('xy祥钰珠宝'), 'xyxiangyu')
  assert.equal(normalizeShopSessionKey('祥钰珠宝'), 'xiangyu')
  assert.equal(normalizeShopSessionKey('拾玉居'), 'shiyu')
  assert.equal(normalizeShopSessionKey('和田雅玉'), 'hetian')
  ok('sessionKey 四店独立')

  assert.equal(shopNamesMatch('XY祥钰珠宝', '祥钰珠宝'), false)
  assert.equal(shopNamesMatch('祥钰珠宝', 'XY祥钰珠宝'), false)
  assert.equal(shopNamesMatch('XY祥钰珠宝', 'XY祥钰珠宝'), true)
  assert.equal(
    orderLiveRoomMatchesSchedule('XY祥钰珠宝', '祥钰珠宝', '祥钰珠宝'),
    false,
  )
  assert.equal(
    orderLiveRoomMatchesSchedule('祥钰珠宝', 'XY祥钰珠宝', 'XY祥钰珠宝'),
    false,
  )
  assert.equal(
    orderLiveRoomMatchesSchedule('XY祥钰珠宝', 'XY祥钰珠宝', 'XY祥钰珠宝'),
    true,
  )
  ok('XY 与普通祥钰不得交叉匹配')
  console.log('ALL PASS')
}

main()
