/**
 * 老板查看数据完整性验收（纯函数 / fixture）
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  sumCompleteOrNull,
  sumWithCoverage,
} from '../src/services/boss-dashboard/boss-dashboard-coverage.util'
import { buildRecentMonthKeys } from '../src/services/boss-dashboard/boss-dashboard-flow.service'
import { buildRecentBillMonthKeys, rankBossShops } from '../src/services/boss-dashboard/boss-dashboard-bill-query.service'
import { buildBossShopAdvice } from '../src/services/boss-dashboard/boss-dashboard-advice.service'

const REQUIRED = ['shiyuju', 'hetianyayu', 'xiangyu', 'xyxiangyu'] as const
const issues: string[] = []
function ok(msg: string) {
  console.log(`[ok] ${msg}`)
}
function fail(msg: string) {
  console.error(`[FAIL] ${msg}`)
  issues.push(msg)
}

function main() {
  // 1) 缺一家时完整合计必须为 null，并返回缺失店名
  const partial = sumWithCoverage(
    [
      { shopKey: 'shiyuju', valueCent: 100 },
      { shopKey: 'hetianyayu', valueCent: 200 },
      { shopKey: 'xiangyu', valueCent: 300 },
      // xyxiangyu missing
    ],
    REQUIRED,
  )
  assert.equal(partial.complete, false)
  assert.equal(partial.valueCent, null)
  assert.equal(partial.partialValueCent, 600)
  assert.deepEqual(partial.missingShopKeys, ['xyxiangyu'])
  assert.equal(sumCompleteOrNull(
    [
      { shopKey: 'shiyuju', valueCent: 100 },
      { shopKey: 'hetianyayu', valueCent: 200 },
      { shopKey: 'xiangyu', valueCent: 300 },
    ],
    REQUIRED,
  ), null)
  ok('缺店时完整合计为 null，并列出缺失店铺')

  // 2) 四店齐全含真实 0
  const full = sumWithCoverage(
    REQUIRED.map((shopKey, i) => ({ shopKey, valueCent: i === 0 ? 0 : 100 })),
    REQUIRED,
  )
  assert.equal(full.complete, true)
  assert.equal(full.valueCent, 300)
  ok('真实 0 参与完整合计')

  // 3) stale 店铺使 complete=false
  const stale = sumWithCoverage(
    REQUIRED.map((shopKey) => ({
      shopKey,
      valueCent: 10,
      stale: shopKey === 'xiangyu',
    })),
    REQUIRED,
  )
  assert.equal(stale.complete, false)
  assert.equal(stale.valueCent, null)
  assert.deepEqual(stale.staleShopKeys, ['xiangyu'])
  ok('流水/数据 stale 时合计不可用')

  // 4) 月份生成：不跳月、不重复（相对 bill keys 一致算法）
  const flowKeys = buildRecentMonthKeys(12)
  const billKeys = buildRecentBillMonthKeys(12)
  assert.equal(flowKeys.length, 12)
  assert.equal(new Set(flowKeys).size, 12)
  assert.deepEqual(flowKeys, billKeys)
  ok('月份键与账单月份算法一致且无重复')

  // 边界：用假日期验证整数递减不会因 setMonth 跳月
  // buildRecentMonthKeys 内部用上海今天；至少保证相邻月差 1
  for (let i = 1; i < flowKeys.length; i++) {
    const [y0, m0] = flowKeys[i - 1]!.split('-').map(Number)
    const [y1, m1] = flowKeys[i]!.split('-').map(Number)
    const idx0 = y0! * 12 + m0!
    const idx1 = y1! * 12 + m1!
    assert.equal(idx1 - idx0, 1)
  }
  ok('相邻月份严格递增 1 个月')

  // 5) 可提现不再作为经营名次：固定顺序
  const ranked = rankBossShops([
    { shopKey: 'xyxiangyu' as const },
    { shopKey: 'xiangyu' as const },
    { shopKey: 'hetianyayu' as const },
    { shopKey: 'shiyuju' as const },
  ])
  assert.deepEqual(
    ranked.map((s) => s.shopKey),
    ['shiyuju', 'hetianyayu', 'xiangyu', 'xyxiangyu'],
  )
  ok('店铺顺序为固定展示序，非可提现排名')

  // 6) 评分缺失不生成下降建议（数据不完整时只返回维护提示）
  const adviceIncomplete = buildBossShopAdvice({
    fund: null,
    score: null,
    previousScore: null,
  })
  if (adviceIncomplete.some((a) => /品质分下降|物流分下降|服务分下降/.test(a.text))) {
    fail('数据不完整时仍生成评分下降建议')
  } else if (!adviceIncomplete.some((a) => /同步|刷新|维护/.test(a.text))) {
    fail('数据不完整时应给出维护提示')
  } else {
    ok('评分/数据缺失时不生成下降建议')
  }

  const adviceNullCurScore = buildBossShopAdvice({
    fund: {
      availableAmountCent: 10000,
      withdrawingAmountCent: 0,
      frozenAmountCent: 0,
      afterSaleFrozenAmountCent: 0,
      canWithdraw: true,
      isStale: false,
      syncStatus: 'success',
      syncError: null,
    } as never,
    score: {
      qualityScore: null,
      logisticsScore: 4.5,
      serviceScore: 4.5,
    } as never,
    previousScore: {
      qualityScore: 4.8,
      logisticsScore: 4.5,
      serviceScore: 4.5,
    } as never,
  })
  // isAdviceDataIncomplete requires both scores - if score exists but quality null,
  // scoreDropped should still not fire for quality
  if (adviceNullCurScore.some((a) => a.text.includes('品质分下降'))) {
    fail('当前品质分为 null 时仍生成下降建议')
  } else {
    ok('当前评分为 null 时不触发下降')
  }
  // 7) 源码：流水失败必须进入资金状态
  const fundSrc = fs.readFileSync(
    path.join(__dirname, '../src/services/boss-dashboard/boss-dashboard-fund.service.ts'),
    'utf8',
  )
  if (!fundSrc.includes('流水同步失败')) {
    fail('fund 服务未将流水失败写入错误')
  } else {
    ok('流水同步失败进入资金状态')
  }

  // 8) 趋势不得预填 0
  const flowSrc = fs.readFileSync(
    path.join(__dirname, '../src/services/boss-dashboard/boss-dashboard-flow.service.ts'),
    'utf8',
  )
  if (/for \(const m of monthKeys\) map\.set\(m,\s*0\)/.test(flowSrc)) {
    fail('月度趋势仍预填 0')
  } else {
    ok('月度趋势不再预填 0')
  }

  // 9) commonDataThroughDate 存在于 query
  const querySrc = fs.readFileSync(
    path.join(__dirname, '../src/services/boss-dashboard/boss-dashboard-query.service.ts'),
    'utf8',
  )
  if (!querySrc.includes('commonDataThroughDate')) fail('缺少 commonDataThroughDate')
  else ok('暴露 commonDataThroughDate')

  if (issues.length) {
    console.error(`\nFAILED ${issues.length}`)
    process.exit(1)
  }
  console.log('\nALL PASS: verify:boss-dashboard-data-integrity')
}

main()
