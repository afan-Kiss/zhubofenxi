/**
 * 手动重建买家排行缓存
 * 用法：npx tsx apps/server/scripts/rebuild-buyer-ranking-cache.ts
 */
import path from 'node:path'
import { config } from 'dotenv'
import { rebuildBuyerRankingCache, getBuyerRankingProfile } from '../src/services/buyer-ranking-cache.service'
import {
  filterBuyerRankingByTab,
  isRefundRankingBuyer,
  BUYER_TAB_FILTER_DESCRIPTIONS,
} from '../src/services/buyer-ranking-tab-filters'

config({ path: path.resolve(__dirname, '../.env') })

async function main() {
  const result = await rebuildBuyerRankingCache('cli-script')
  const profile = await getBuyerRankingProfile()
  const items = profile?.items ?? []
  console.log('rebuild ok:', result)
  console.log('summary:', profile?.summary)
  console.log('tab counts:', {
    spend: filterBuyerRankingByTab(items, 'spend').length,
    repurchase: filterBuyerRankingByTab(items, 'repurchase').length,
    refund: filterBuyerRankingByTab(items, 'refund').length,
    quality: filterBuyerRankingByTab(items, 'quality').length,
    blacklist: filterBuyerRankingByTab(items, 'blacklist').length,
  })
  const momo = items.find((i) => (i.nickname ?? '').toLowerCase().includes('momo'))
  if (momo) {
    console.log('momo sample:', {
      refundAmount: momo.productRefundAmount,
      refundRelatedOrderCount: momo.refundRelatedOrderCount,
      refundTimes: momo.refundTimes,
      inRefundTab: isRefundRankingBuyer(momo),
    })
  }
  const xiangxiang = items.find((i) => (i.nickname ?? '').includes('湘湘'))
  if (xiangxiang) {
    console.log('湘湘 acceptance:', {
      gmv: xiangxiang.gmv,
      productRefundAmount: xiangxiang.productRefundAmount,
      refundTimes: xiangxiang.refundTimes,
      refundRelatedOrderCount: xiangxiang.refundRelatedOrderCount,
      inRefundTab: isRefundRankingBuyer(xiangxiang),
    })
  }
  console.log('filter rules:', BUYER_TAB_FILTER_DESCRIPTIONS)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
