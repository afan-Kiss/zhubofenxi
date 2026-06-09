/**
 * HAR 样例品退数据（开发/验收兜底，非生产 API 替代）
 * 来源：品退真实接口.har 中本月可查到的 P 单
 */
import { attributeOrders } from './order-attribution.service'
import { getAnchorConfigSync } from './anchor.service'
import {
  loadOrdersForQualityMatchByPackageIds,
  matchQualityBadCases,
} from './quality-badcase-match.service'
import { prisma } from '../lib/prisma'
import {
  buildLiveAccountOrderQueries,
  loadAfterSalesBundleForOrderNos,
} from './xhs-after-sales-workbench.service'
import {
  loadAllQualityBadCases,
  saveQualityBadCases,
} from './quality-badcase-store.service'
import type { NormalizedQualityBadCase } from './quality-badcase.types'

export const HAR_SAMPLE_PACKAGE_IDS = [
  'P795229266485040251',
  'P794284642850380311',
] as const

export function buildHarQualityBadCaseFixtures(): NormalizedQualityBadCase[] {
  return [
    {
      caseKey: 'har_P795229266485040251',
      liveAccountId: 'legacy',
      packageId: 'P795229266485040251',
      sourceBizId: null,
      itemId: 'har_fixture_item',
      itemName: 'HAR样例商品',
      itemImage: '',
      problemType: '品质问题',
      negativeReasons: ['质量问题'],
      feedbackContent: '',
      feedbackTime: null,
      packagePayTime: '2026-05-25 10:47:52',
      matchedOrderNo: 'P795229266485040251',
      matchedOrderId: '',
      matchedAfterSaleId: '',
      matchedBuyerId: '',
      matchedBuyerNickname: '',
      matchedAnchorId: '',
      matchedAnchorName: '',
      afterSaleStatus: '',
      afterSaleReason: '',
      afterSaleRefundAmount: 0,
      afterSaleRefunded: false,
      source: 'official_quality_badcase',
      matchStatus: 'unmatched',
      confidence: 'high',
      platformName: 'har_fixture',
    },
    {
      caseKey: 'har_P794284642850380311',
      liveAccountId: 'legacy',
      packageId: 'P794284642850380311',
      sourceBizId: null,
      itemId: 'har_fixture_item',
      itemName: 'HAR样例商品',
      itemImage: '',
      problemType: '品质问题',
      negativeReasons: ['做工粗糙/有瑕疵'],
      feedbackContent:
        '直播间买的 说好的包容点只有两个小矿点  刚拿到手打开 发现有水线 裂纹 裂纹明显与直播间陈述不符',
      feedbackTime: null,
      packagePayTime: '2026-05-14 12:24:13',
      matchedOrderNo: 'P794284642850380311',
      matchedOrderId: '',
      matchedAfterSaleId: '',
      matchedBuyerId: '',
      matchedBuyerNickname: '',
      matchedAnchorId: '',
      matchedAnchorName: '',
      afterSaleStatus: '',
      afterSaleReason: '',
      afterSaleRefundAmount: 0,
      afterSaleRefunded: false,
      source: 'official_quality_badcase',
      matchStatus: 'unmatched',
      confidence: 'high',
      platformName: 'har_fixture',
    },
  ]
}

/** 将 HAR 样例写入 DB 并与订单主表重新匹配（仅当表为空或显式 seed 时） */
export async function seedHarQualityBadCaseFixturesIfNeeded(options?: {
  force?: boolean
}): Promise<{ seeded: number; matchedOrderCount: number }> {
  const existing = await loadAllQualityBadCases(true)
  if (!options?.force && existing.length > 0) {
    return {
      seeded: 0,
      matchedOrderCount: existing.filter((c) => c.matchStatus !== 'unmatched').length,
    }
  }

  const fixtures = buildHarQualityBadCaseFixtures()
  const orders = await loadOrdersForQualityMatchByPackageIds([...HAR_SAMPLE_PACKAGE_IDS])
  const anchorConfig = getAnchorConfigSync()
  const attributions = attributeOrders(orders, [], anchorConfig)
  const orderQueries = buildLiveAccountOrderQueries(orders)
  const paidOrderNos = new Set(orderQueries.map((q) => q.orderNo))
  const afterSales = await loadAfterSalesBundleForOrderNos(orderQueries, paidOrderNos)
  const matched = matchQualityBadCases({
    cases: fixtures,
    orders,
    attributions,
    rawAfterSalesByOrderNo: afterSales.rawAfterSalesByOrderNo,
  })
  if (options?.force) {
    await prisma.qualityBadCase.deleteMany({
      where: { caseKey: { in: fixtures.map((f) => f.caseKey) } },
    })
  }
  await saveQualityBadCases(matched)
  await loadAllQualityBadCases(true)
  return {
    seeded: matched.length,
    matchedOrderCount: matched.filter((c) => c.matchStatus !== 'unmatched').length,
  }
}
