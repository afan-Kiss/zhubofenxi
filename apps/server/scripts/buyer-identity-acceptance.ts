/**
 * 买家唯一标识验收（momo 拆分等）
 * npx tsx apps/server/scripts/buyer-identity-acceptance.ts
 */
import path from 'node:path'
import { config } from 'dotenv'
import { buildRawAnalyzeBundleAll } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../src/services/business-analysis.service'
import { buildBuyerRankingSummaryFromViews } from '../src/services/buyer-ranking.service'
import {
  isStaleBuyerRankingKey,
  pickBuyerNicknameFromView,
  resolveBuyerIdentityFromView,
  viewMatchesBuyerKey,
} from '../src/services/buyer-identity.service'

config({ path: path.resolve(__dirname, '../.env') })

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

async function main() {
  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle) {
    console.log('跳过：无本地订单')
    return
  }

  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const views = artifacts.views

  const momoViews = views.filter((v) => {
    const n = pickBuyerNicknameFromView(v).toLowerCase()
    return n === 'momo' || n.includes('momo')
  })
  console.log(`\nmomo 订单数: ${momoViews.length}`)

  const keySet = new Set<string>()
  for (const v of momoViews) {
    const identity = resolveBuyerIdentityFromView(v)
    const orderNo = v.displayOrderNo || v.officialOrderNo || v.packageId
    const refund = v.buyerProductRefundAmountCent ?? 0
    const paid = v.statPaidAmountCent ?? (v.includedInGmv ? v.paymentBaseCent : 0)
    console.log({
      orderNo,
      buyerNickname: pickBuyerNicknameFromView(v),
      buyerKey: identity?.buyerKey,
      identitySource: identity?.identitySource,
      receivableAmountCent: v.receivableAmountCent,
      statPaidAmountCent: paid,
      buyerRefundAmountCent: refund,
    })
    if (identity) {
      keySet.add(identity.buyerKey)
      assert(identity.buyerKey !== 'momo', `订单 ${orderNo} buyerKey 不能等于昵称 momo`)
      assert(!identity.buyerKey.startsWith('nick:'), `订单 ${orderNo} 禁止使用 nick: 键`)
      assert(
        !isStaleBuyerRankingKey(identity.buyerKey, 'momo'),
        `订单 ${orderNo} buyerKey 不能仅用昵称`,
      )
    }
  }

  if (momoViews.length >= 2) {
    assert(
      keySet.size > 1,
      `momo 订单 ${momoViews.length} 笔但仅 ${keySet.size} 个 buyerKey，存在昵称合并`,
    )
  }

  const { items } = buildBuyerRankingSummaryFromViews(views)
  const momoBuyers = items.filter((i) => {
    const n = String(i.nickname ?? i.buyerNickname ?? '').toLowerCase()
    return n === 'momo' || n.includes('momo')
  })
  console.log(`\n买家排行 momo 记录数: ${momoBuyers.length}`)
  for (const b of momoBuyers) {
    console.log({
      buyerKey: b.buyerKey,
      buyerIdentityCode: b.buyerIdentityCode,
      orderCount: b.orderCount,
      statPaidAmount: b.statPaidAmount ?? b.gmv,
      productRefundAmount: b.productRefundAmount,
    })
    assert(b.buyerKey !== 'momo', '排行 buyerKey 不能为 momo')
    assert(b.buyerKey !== b.nickname, '排行 buyerKey 不能等于昵称')
  }

  if (momoViews.length >= 2) {
    assert(momoBuyers.length > 1, '买家排行应将多个 momo 拆成多条记录')
  }

  const targetNo = 'P795271256620453611'
  const targetView = views.find((v) => (v.displayOrderNo || v.packageId || '').includes(targetNo))
  if (targetView) {
    const targetKey = resolveBuyerIdentityFromView(targetView)?.buyerKey
    assert(targetKey, `${targetNo} 应有 buyerKey`)
    const sameKeyViews = views.filter((v) => viewMatchesBuyerKey(v, targetKey!))
    const wrongMerged = momoViews.filter(
      (v) => viewMatchesBuyerKey(v, targetKey!) && v !== targetView,
    )
    console.log(`\n${targetNo} buyerKey=${targetKey}，同 key 订单 ${sameKeyViews.length} 笔`)
    for (const v of sameKeyViews) {
      console.log('  -', v.displayOrderNo || v.packageId)
    }
    assert(
      wrongMerged.every((v) => resolveBuyerIdentityFromView(v)?.buyerKey === targetKey),
      `${targetNo} 不应与其他 momo 错误合并`,
    )
  } else {
    console.log(`\n未找到订单 ${targetNo}，跳过单订单 Drawer 验收`)
  }

  console.log('\n买家身份验收通过')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
