/**
 * 日报体验分口径回归：官方总分字段 / 禁止均值 / 趋势 / shopKey 绑定
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
  resolveOfficialOverallScore,
  resolveOfficialTrend,
  normalizeOfficialDisplayScore,
} from '../src/services/daily-report-shop-scores.service'
import { parseBossShopScore } from '../src/services/boss-dashboard/boss-dashboard-normalize.service'

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

console.log('\n=== 固定排序 + shopKey 绑定 ===')
assert(
  DAILY_REPORT_SHOP_SCORE_ORDER.join(',') === 'shiyuju,xyxiangyu,hetianyayu,xiangyu',
  '前端顺序：拾玉居 → XY祥钰 → 和田雅玉 → 祥钰',
)
assert(SERVER_ORDER.join(',') === DAILY_REPORT_SHOP_SCORE_ORDER.join(','), '前后端顺序一致')
{
  // 测试8：四店乱序返回，按 shopKey 正确绑定
  const messy: DailyReportShopScoreItem[] = [
    {
      shopKey: 'xiangyu',
      shopName: '祥钰珠宝',
      scoreDate: '2026-07-25',
      previousScoreDate: null,
      overallScore: 4.3,
      overallDelta: 0,
      overallTrend: '持平',
      qualityScore: 4.2,
      logisticsScore: 4.5,
      serviceScore: 4.4,
      qualityDelta: 0,
      logisticsDelta: 0,
      serviceDelta: 0,
      available: true,
    },
    {
      shopKey: 'hetianyayu',
      shopName: '和田雅玉',
      scoreDate: '2026-07-25',
      previousScoreDate: null,
      overallScore: 4.5,
      overallDelta: 0,
      overallTrend: '持平',
      qualityScore: 4.4,
      logisticsScore: 4.6,
      serviceScore: 4.4,
      qualityDelta: 0,
      logisticsDelta: 0,
      serviceDelta: 0,
      available: true,
    },
    {
      shopKey: 'xyxiangyu',
      shopName: 'XY祥钰珠宝',
      scoreDate: '2026-07-25',
      previousScoreDate: null,
      overallScore: 4.6,
      overallDelta: 0,
      overallTrend: '持平',
      qualityScore: 4.4,
      logisticsScore: 5.0,
      serviceScore: 4.5,
      qualityDelta: 0,
      logisticsDelta: 0,
      serviceDelta: 0,
      available: true,
    },
    {
      shopKey: 'shiyuju',
      shopName: '拾玉居和田玉',
      scoreDate: '2026-07-25',
      previousScoreDate: null,
      overallScore: 4.5,
      overallDelta: 0,
      overallTrend: '持平',
      qualityScore: 4.5,
      logisticsScore: 4.9,
      serviceScore: 4.3,
      qualityDelta: 0,
      logisticsDelta: 0,
      serviceDelta: 0,
      available: true,
    },
  ]
  const ordered = orderDailyReportShopScores(messy)
  assert(ordered.map((s) => s.shopKey).join(',') === 'shiyuju,xyxiangyu,hetianyayu,xiangyu', '乱序仍按 shopKey 固定序')
  assert(ordered[0]!.overallScore === 4.5 && ordered[0]!.qualityScore === 4.5, '拾玉居不被串店')
  assert(ordered[0]!.logisticsScore === 4.9 && ordered[0]!.serviceScore === 4.3, '拾玉居分项绑定')
  assert(ordered[2]!.shopKey === 'hetianyayu' && ordered[2]!.overallScore === 4.5, '和田雅玉绑定')
  assert(ordered[3]!.overallScore === 4.3, '祥钰珠宝绑定')
}

console.log('\n=== 测试1：官方总分不被错误四舍五入冒充 ===')
{
  // 解析层取 score="4.5"，即使存在内部精细 4.57 也不该用它（本接口仅返回 score）
  const parsed = parseBossShopScore({
    data: { shop_score_dto: { score: '4.5', shopScore: 4.57 } },
  })
  assert(parsed.officialOverallScore === 4.5, '优先 dto.score=4.5，而非 shopScore=4.57')
  assert(resolveOfficialOverallScore(4.5) === 4.5, '日报综合=4.5')
  assert(formatOverallShopScore(4.5) === '4.5', '展示 4.5')
  assert(formatOverallShopScore(4.5) !== '4.6', '禁止显示 4.6')
}

console.log('\n=== 测试2：禁止分项均值冒充总分 ===')
{
  const overall = resolveOverallScore(4.5, 4.9, 4.3, null)
  assert(overall === null, '官方总分 null → 综合 null（—）')
  assert(resolveOfficialOverallScore(null) === null, 'resolveOfficialOverallScore(null)=null')
  const avg = (4.5 + 4.9 + 4.3) / 3
  assert(overall !== avg && overall !== Math.round(avg * 100) / 100, '禁止算术平均')
  assert(formatOverallShopScore(overall) === '—', '前端展示 —')
}

console.log('\n=== 测试3：拾玉居官方真实样例 ===')
{
  const parsed = parseBossShopScore({
    success: true,
    data: { shop_score_dto: { score: '4.5' } },
  })
  assert(parsed.officialOverallScore === 4.5, '解析总分 4.5')
  const item = {
    overallScore: resolveOfficialOverallScore(parsed.officialOverallScore),
    qualityScore: normalizeOfficialDisplayScore(4.5),
    logisticsScore: normalizeOfficialDisplayScore(4.9),
    serviceScore: normalizeOfficialDisplayScore(4.3),
  }
  assert(item.overallScore === 4.5, '综合 4.5')
  assert(formatShopScore(item.qualityScore) === '4.5', '品质 4.5')
  assert(formatShopScore(item.logisticsScore) === '4.9', '物流 4.9')
  assert(formatShopScore(item.serviceScore) === '4.3', '服务 4.3')
}

console.log('\n=== 测试4：禁止上升 +0.0 ===')
{
  // 官方展示均为 4.5（内部精细 4.54 / 4.46 归一后相同）
  const trend = resolveOfficialTrend({ current: 4.54, previous: 4.46 })
  assert(trend.status === 'flat', '展示精度相同 → flat')
  assert(trend.label === '持平', '标签持平')
  assert(trend.displayDelta === 0, 'displayDelta=0')
  assert(shopScoreTrendLabel(0.04) === '持平', '前端：原始 0.04 按展示精度归持平')
  assert(formatShopScoreDelta(0) === '', '持平不展示 +0.0')
  const tone = shopScoreDeltaTone(0.04)
  assert(tone.label === '持平', 'tone 持平（禁止上升 +0.0）')
}

console.log('\n=== 测试5：上升 +0.1 ===')
{
  const trend = resolveOfficialTrend({ current: 4.5, previous: 4.4 })
  assert(trend.status === 'up' && trend.label === '上升', '上升')
  assert(trend.displayDelta === 0.1, 'delta +0.1')
  assert(formatShopScoreDelta(0.1) === '+0.1', '展示 +0.1')
}

console.log('\n=== 测试6：下降 -0.1 ===')
{
  const trend = resolveOfficialTrend({ current: 4.5, previous: 4.6 })
  assert(trend.status === 'down' && trend.label === '下降', '下降')
  assert(trend.displayDelta === -0.1, 'delta -0.1')
  assert(formatShopScoreDelta(-0.1) === '-0.1', '展示 -0.1')
}

console.log('\n=== 测试7：官方「无变化」优先 ===')
{
  const trend = resolveOfficialTrend({
    current: 4.57,
    previous: 4.43,
    officialCompareStatus: '较前日 无变化',
  })
  assert(trend.status === 'flat' && trend.label === '持平', '官方无变化 → 持平')
  assert(trend.displayDelta === 0, '不展示内部精细差')
}

console.log('\n=== 测试7b：partial 总分追上分项 → 持平（XY 误报下降） ===')
{
  // 上一天总分 4.6 但分项加权已是 4.5；当天 partial 只有总分 4.5
  const trend = resolveOfficialTrend({
    current: 4.5,
    previous: 4.6,
    currentOverallOnly: true,
    previousSubs: { qualityScore: 4.4, logisticsScore: 4.9, serviceScore: 4.5 },
  })
  assert(trend.status === 'flat' && trend.label === '持平', '分项已隐含 4.5 → 持平')
  assert(trend.displayDelta === 0, '不误报 -0.1')
  // 真实下降：当天 4.4 低于分项隐含 4.5
  const realDown = resolveOfficialTrend({
    current: 4.4,
    previous: 4.6,
    currentOverallOnly: true,
    previousSubs: { qualityScore: 4.4, logisticsScore: 4.9, serviceScore: 4.5 },
  })
  assert(realDown.status === 'down' && realDown.displayDelta === -0.2, '真实下降仍保留')
}

console.log('\n=== 解析：仅 score 字符串 ===')
{
  const parsed = parseBossShopScore({
    data: { shop_score_dto: { score: '4.5' } },
  })
  assert(parsed.officialOverallScore === 4.5, '字符串 score → 4.5')
  assert(parsed.qualityScore == null, '主接口无分项时分项为 null（由趋势补）')
}

console.log('\n=== 可用性 ===')
assert(
  hasUsableShopScore({
    overallScore: null,
    qualityScore: 4.5,
    logisticsScore: 4.9,
    serviceScore: 4.3,
  }) === true,
  '仅有分项仍可用',
)
assert(
  hasUsableShopScore({
    overallScore: null,
    qualityScore: null,
    logisticsScore: null,
    serviceScore: null,
  }) === false,
  '全空不可用',
)
assert(shopScoreDeltaTone(0.1).text.includes('emerald'), '上升绿色')
assert(shopScoreDeltaTone(-0.1).text.includes('rose'), '下降红色')
assert(shopScoreDeltaTone(0).text.includes('slate'), '持平灰色')

console.log('\n=== 文案静态检查 ===')
{
  const sectionPath = path.resolve(
    __dirname,
    '../../web/src/components/board/DailyReportShopScoreSection.tsx',
  )
  const section = fs.readFileSync(sectionPath, 'utf-8')
  assert(section.includes('店铺分'), '标题为店铺分')
  assert(!section.includes('平台体验分展示'), '无平台体验分副标题')
  assert(!section.includes('仅供店铺状态参考'), '无店铺状态参考副标题')
  assert(!section.includes('快照'), '无「快照」字样')
  assert(section.includes('上升') && section.includes('下降') && section.includes('持平'), '含上升下降持平')

  const svcPath = path.resolve(__dirname, '../src/services/daily-report-shop-scores.service.ts')
  const svc = fs.readFileSync(svcPath, 'utf-8')
  assert(svc.includes('resolveOfficialOverallScore'), '使用官方总分解析')
  assert(!/parts\.reduce/.test(svc), '日报服务无分项均值')
  assert(svc.includes('byKey.set(shop.shopKey'), '按 shopKey 关联结果')
}

console.log('\n=== 结果 ===')
if (failures.length) {
  console.log(`失败 ${failures.length} 项`)
  process.exit(1)
}
console.log('全部通过')
