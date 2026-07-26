/**
 * 日报体验分：口径 / null 防护 / delta 精度验收
 * npm run verify:daily-report-shop-scores
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  formatShopScore,
  formatShopScoreDelta,
  shopScoreDeltaTone,
} from '../../web/src/components/board/DailyReportShopScoreSection'
import {
  hasUsableShopScore,
  resolveOverallScore,
  scoreDelta,
  roundScore2,
} from '../src/services/daily-report-shop-scores.service'

const failures: string[] = []

function ok(msg: string) {
  console.log(`✓ ${msg}`)
}
function fail(msg: string) {
  failures.push(msg)
  console.log(`✗ FAIL: ${msg}`)
}
function assert(cond: boolean, msg: string) {
  if (cond) ok(msg)
  else fail(msg)
}

console.log('\n=== scoreDelta / 精度 ===')
assert(scoreDelta(4.57, 4.53) === 0.04, '上涨 +0.04 保留两位')
assert(scoreDelta(4.5, 4.54) === -0.04, '下降 -0.04 保留两位')
assert(scoreDelta(4.5, 4.5) === 0, '持平为 0')
assert(scoreDelta(null, 4.5) == null, '当前缺失 → null')
assert(scoreDelta(4.5, null) == null, '上次缺失 → null')
assert(scoreDelta(Number.NaN, 4.5) == null, 'NaN → null')
assert(formatShopScore(4.5) === '4.50', '展示两位小数 4.50')
assert(formatShopScore(4.04) === '4.04', '展示不丢 0.04')
assert(formatShopScore(null) === '—', 'null 显示 —')
assert(formatShopScore(Number.NaN) === '—', 'NaN 显示 —')
assert(formatShopScoreDelta(0.04) === '+0.04', 'delta 文案 +0.04')
assert(formatShopScoreDelta(-0.04) === '-0.04', 'delta 文案 -0.04')
assert(formatShopScoreDelta(0) === '0.00', '持平文案 0.00')
assert(formatShopScoreDelta(null) === '—', 'delta null 显示 —')

console.log('\n=== 箭头颜色（越高越好）===')
assert(shopScoreDeltaTone(0.04).arrow === '↑' && shopScoreDeltaTone(0.04).text.includes('emerald'), '上涨绿↑')
assert(shopScoreDeltaTone(-0.04).arrow === '↓' && shopScoreDeltaTone(-0.04).text.includes('rose'), '下降红↓')
assert(shopScoreDeltaTone(0).arrow === '→' && shopScoreDeltaTone(0).text.includes('slate'), '持平灰→')
assert(shopScoreDeltaTone(null).arrow === '→', 'null 视为持平样式')

console.log('\n=== overall / available ===')
assert(resolveOverallScore(4.9, 4.8, 4.7, 4.85) === 4.85, '优先官方综合分')
assert(resolveOverallScore(4.9, 4.8, 4.7, null) === roundScore2((4.9 + 4.8 + 4.7) / 3), '无官方时取分项均值')
assert(resolveOverallScore(null, null, null, null) == null, '全空 overall=null')
assert(
  hasUsableShopScore({
    overallScore: null,
    qualityScore: null,
    logisticsScore: null,
    serviceScore: null,
  }) === false,
  '全空不可用',
)
assert(
  hasUsableShopScore({
    overallScore: null,
    qualityScore: 4.5,
    logisticsScore: null,
    serviceScore: null,
  }) === true,
  '仅品质分也可用',
)

console.log('\n=== 文案口径静态检查 ===')
{
  const sectionPath = path.resolve(
    __dirname,
    '../../web/src/components/board/DailyReportShopScoreSection.tsx',
  )
  const timelinePath = path.resolve(
    __dirname,
    '../../web/src/components/board/DailyReportImageTimeline.tsx',
  )
  const sheetPath = path.resolve(
    __dirname,
    '../../web/src/components/board/DailyReportImageSheet.tsx',
  )
  const section = fs.readFileSync(sectionPath, 'utf-8')
  const timeline = fs.readFileSync(timelinePath, 'utf-8')
  const sheet = fs.readFileSync(sheetPath, 'utf-8')

  assert(section.includes('上次快照'), '区块文案含「上次快照」')
  assert(section.includes('不是日报经营日环比'), '明确非经营日环比')
  assert(section.includes('日报日'), '区分日报日')
  assert(section.includes('快照'), '含快照日期')
  assert(!section.includes('昨日变化') && !section.includes('较昨日'), '不写昨日变化')
  assert(!timeline.includes('体验分'), '时间轴不再展示体验分')
  assert(!timeline.includes('shopScores'), '时间轴不接收 shopScores')
  assert(sheet.includes('DailyReportShopScoreSection'), 'Sheet 保留唯一体验分区')
  assert(
    sheet.includes('<DailyReportImageTimeline sessions={sessions} />'),
    'Sheet 不向时间轴传 shopScores',
  )
}

console.log('\n=== 结果 ===')
if (failures.length) {
  console.log(`失败 ${failures.length} 项`)
  process.exit(1)
}
console.log('全部通过')
