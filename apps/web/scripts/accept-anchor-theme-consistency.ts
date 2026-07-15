/**
 * 主播颜色一致性静态验收（web）
 * npx tsx apps/web/scripts/accept-anchor-theme-consistency.ts
 */
import assert from 'node:assert/strict'
import {
  resolveAnchorColor,
  fallbackAnchorColor,
  isValidAnchorColor,
  colorsTooSimilar,
} from '../src/lib/anchor-theme'

function main() {
  console.log('accept-anchor-theme-consistency')
  assert.equal(isValidAnchorColor('#ff2442'), true)
  assert.equal(isValidAnchorColor('not-a-color'), false)

  const a = resolveAnchorColor({ id: 'id-1', name: '子杰', color: '#FF2442' })
  assert.equal(a.toLowerCase(), '#ff2442')

  const hash1 = fallbackAnchorColor('stable-id', '甲')
  const hash2 = fallbackAnchorColor('stable-id', '乙改名')
  assert.equal(hash1, hash2, '同 id 备用色应稳定，不随名字变')

  const byIndexTrap1 = resolveAnchorColor({ id: 'x', name: 'A', color: null })
  const byIndexTrap2 = resolveAnchorColor({ id: 'y', name: 'B', color: null })
  assert.notEqual(byIndexTrap1, byIndexTrap2, '不同 id 备用色应不同')

  // 同主播不论排序位置
  const c1 = resolveAnchorColor({ id: 'p1', name: '小红', color: '#ff0000' })
  const c2 = resolveAnchorColor({ id: 'p1', name: '小红', color: '#ff0000' })
  assert.equal(c1, c2)

  assert.equal(colorsTooSimilar('#ffffff', '#fefefe'), true)

  console.log(
    JSON.stringify({
      explicit: a,
      hashSameId: hash1,
      differentIds: [byIndexTrap1, byIndexTrap2],
    }),
  )
  console.log('PASS accept-anchor-theme-consistency')
}

main()
