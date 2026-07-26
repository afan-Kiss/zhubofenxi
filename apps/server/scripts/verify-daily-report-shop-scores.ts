/**
 * 日报体验分：排序 / 文案 / 精度 / 状态验收
 * npm run verify:daily-report-shop-scores
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  DAILY_REPORT_SHOP_SCORE_ORDER,
  formatOverallShopScore,
  formatShopScore,
  formatShopScoreDelta,
  orderDailyReportShopScores,
  shopScoreDeltaTone,
  shopScoreTrendLabel,
  type DailyReportShopScoreItem,
} from '../../web/src/components/board/DailyReportShopScoreSection'
import {
  DAILY_REPORT_SHOP_SCORE_ORDER as SERVER_ORDER,
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

console.log('\n=== 固定排序 ===')
assert(
  DAILY_REPORT_SHOP_SCORE_ORDER.join(',') === 'shiyuju,xyxiangyu,hetianyayu,xiangyu',
  '前端顺序：拾玉居 → XY祥钰 → 和田雅玉 → 祥钰',
)
assert(SERVER_ORDER.join(',') === DAILY_REPORT_SHOP_SCORE_ORDER.join(','), '前后端顺序一致')
{
  const messy: DailyReportShopScoreItem[] = [
    {
      shopKey: 'xiangyu',
      shopName: '祥钰珠宝',
      scoreDate: null,
      previousScoreDate: null,
      overallScore: 4.3,
      overallDelta: 0,
      qualityScore: 4.3,
      logisticsScore: 4.3,
      serviceScore: 4.3,
      qualityDelta: 0,
      logisticsDelta: 0,
      serviceDelta: 0,
      available: true,
    },
    {
      shopKey: 'shiyuju',
      shopName: '拾玉居和田玉',
      scoreDate: null,
      previousScoreDate: null,
      overallScore: 4.5,
      overallDelta: 0.1,
      qualityScore: 4.5,
      logisticsScore: 4.5,
      serviceScore: 4.5,
      qualityDelta: 0,
      logisticsDelta: 0,
      serviceDelta: 0,
      available: true,
    },
  ]
  const ordered = orderDailyReportShopScores(messy)
  assert(ordered.length === 4, '缺店也补齐 4 位')
  assert(
    ordered.map((s) => s.shopKey).join(',') === 'shiyuju,xyxiangyu,hetianyayu,xiangyu',
    '乱序输入仍固定输出',
  )
  assert(ordered[1]!.available === false, '缺失的 XY 祥钰占位且暂无数据')
  assert(ordered[0]!.shopName === '拾玉居和田玉', '店名规范')
}

console.log('\n=== 综合分官方 1 位小数 ===')
assert(formatOverallShopScore(4.57) === '4.6', '4.57 → 4.6')
assert(formatOverallShopScore(4.54) === '4.5', '4.54 → 4.5')
assert(formatOverallShopScore(4.5) === '4.5', '4.5 保持')
assert(formatOverallShopScore(null) === '—', 'null → —')
assert(formatShopScore(4.57) === '4.57', '分项仍两位')

console.log('\n=== delta / 上升下降持平 ===')
assert(scoreDelta(4.57, 4.53) === 0.04, 'delta 计算两位精度不变')
assert(shopScoreTrendLabel(0.04) === '上升', 'delta>0 上升')
assert(shopScoreTrendLabel(-0.04) === '下降', 'delta<0 下降')
assert(shopScoreTrendLabel(0) === '持平', 'delta=0 持平')
assert(shopScoreTrendLabel(null) === '持平', 'null 持平')
assert(shopScoreDeltaTone(0.1).text.includes('emerald'), '上升绿色')
assert(shopScoreDeltaTone(-0.1).text.includes('rose'), '下降红色')
assert(shopScoreDeltaTone(0).text.includes('slate'), '持平灰色')
assert(formatShopScoreDelta(0.14) === '+0.1', '综合旁数值 1 位')
assert(resolveOverallScore(4.9, 4.8, 4.7, 4.85) === 4.85, '优先官方综合分值')
assert(resolveOverallScore(4.9, 4.8, 4.7, null) === roundScore2((4.9 + 4.8 + 4.7) / 3), '无官方时均值')
assert(
  hasUsableShopScore({
    overallScore: null,
    qualityScore: null,
    logisticsScore: null,
    serviceScore: null,
  }) === false,
  '全空不可用',
)

console.log('\n=== 文案静态检查 ===')
{
  const sectionPath = path.resolve(
    __dirname,
    '../../web/src/components/board/DailyReportShopScoreSection.tsx',
  )
  const section = fs.readFileSync(sectionPath, 'utf-8')
  assert(section.includes('店铺体验分'), '标题保留')
  assert(section.includes('仅供店铺状态参考'), '口语化说明')
  assert(!section.includes('快照'), '无「快照」字样')
  assert(!section.includes('非日报日'), '无「非日报日」')
  assert(!section.includes('更新于'), '无更新时间文案')
  assert(!section.includes('一般'), '无「一般」等级')
  assert(!section.includes('优秀'), '无「优秀」等级')
  assert(!section.includes('良好'), '无「良好」等级')
  assert(section.includes('上升') && section.includes('下降') && section.includes('持平'), '含上升下降持平')
  assert(!section.includes("'↑'") && !section.includes('"↑"'), '不再用箭头字符作为状态')
}

console.log('\n=== 结果 ===')
if (failures.length) {
  console.log(`失败 ${failures.length} 项`)
  process.exit(1)
}
console.log('全部通过')
