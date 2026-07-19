/**
 * 福袋同步状态口径 + 物流号关键词识别
 * npx tsx apps/server/scripts/verify-lucky-gift-sync-status.ts
 */
import assert from 'node:assert/strict'
import { classifyLuckyGiftListPage } from '../src/services/lucky-gift/lucky-gift-platform-response.util'

function looksLikeTrackingKeyword(raw: string): boolean {
  const k = raw.replace(/\s+/g, '')
  if (k.length < 8) return false
  return /^(sf|yt|zt|jd|sto|yd|ems)?\d{8,}$/i.test(k) || /^[A-Za-z]{0,4}\d{10,}$/.test(k)
}

function hardFailCount(roomStats: Array<{ status: string }>): number {
  return roomStats.filter((r) =>
    ['auth_failed', 'parse_failed', 'request_failed', 'parameter_failed'].includes(r.status),
  ).length
}

async function main() {
  const emptyAmbiguous = classifyLuckyGiftListPage(
    {
      infos: [],
      totalCount: null,
      rawIdTexts: [],
      platformCode: 0,
      platformSuccess: true,
      platformMsg: null,
      resultCode: 0,
      resultMessage: null,
      topKeys: [],
      dataKeys: [],
      listFieldFound: false,
      rawLen: 20,
    },
    '{"success":true,"data":{}}',
  )
  assert.equal(emptyAmbiguous.status, 'ambiguous_empty')

  const roomStats = [
    { status: 'success_with_data' },
    { status: 'confirmed_empty' },
    { status: 'ambiguous_empty' },
    { status: 'ambiguous_empty' },
    { status: 'parameter_failed' },
  ]
  assert.equal(hardFailCount(roomStats), 1, '仅硬失败计入异常')
  const softNoise = roomStats.filter(
    (r) => r.status !== 'success_with_data' && r.status !== 'confirmed_empty',
  )
  assert.ok(softNoise.length > hardFailCount(roomStats), '旧逻辑会把 ambiguous 算异常')
  console.log('  ✓ 空场次/未确认不再等同硬失败')

  assert.equal(looksLikeTrackingKeyword('SF1464539449246'), true)
  assert.equal(looksLikeTrackingKeyword('sf1464539048407'), true)
  assert.equal(looksLikeTrackingKeyword('1464539449246'), true)
  assert.equal(looksLikeTrackingKeyword('小猪'), false)
  console.log('  ✓ 物流号关键词识别')

  console.log('\nALL PASS')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
