/**
 * 品退关键词边界验收：禁止单字「断/裂」误伤；保留明确断裂/开裂短语。
 * 运行：npm run verify:quality-keyword-boundaries
 */
import assert from 'node:assert/strict'
import { matchPlatformReturnReason } from '../src/utils/quality-return'

const failures: string[] = []

function ok(msg: string): void {
  console.log(`✓ ${msg}`)
}

function check(label: string, fn: () => void): void {
  try {
    fn()
    ok(label)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    failures.push(`${label}: ${msg}`)
    console.log(`✗ FAIL: ${label}: ${msg}`)
  }
}

function main(): void {
  console.log('verify:quality-keyword-boundaries\n')

  const mustNotHit = [
    '买断',
    '断货',
    '垄断',
    '诊断',
    '断舍离',
    '不断更新',
    '已断开直播',
    '直播断开',
    '买断价',
    '断码',
    'zq8366线下成交买断',
    '尺寸不合适',
    '尺码/尺寸不合适',
    '多拍/拍错/不想要',
  ]
  for (const text of mustNotHit) {
    check(`非品退：「${text}」`, () => {
      assert.equal(matchPlatformReturnReason(text).isQualityReturn, false)
    })
  }

  const mustHit = [
    '手链断裂',
    '珠串断了',
    '商品开裂',
    '收到后发现有裂纹',
    '有裂纹',
    '玉石破裂',
    '商品断裂',
    '质量问题',
    '做工粗糙',
    '商品破损/污渍',
    '商品损坏',
  ]
  for (const text of mustHit) {
    check(`应品退：「${text}」`, () => {
      assert.equal(matchPlatformReturnReason(text).isQualityReturn, true)
    })
  }

  check('单字「断」本身不算品退', () => {
    assert.equal(matchPlatformReturnReason('断').isQualityReturn, false)
  })
  check('单字「裂」本身不算品退', () => {
    assert.equal(matchPlatformReturnReason('裂').isQualityReturn, false)
  })

  if (failures.length) {
    console.error(`\nFAIL ${failures.length} case(s)`)
    process.exit(1)
  }
  console.log('\nALL PASS')
}

main()
