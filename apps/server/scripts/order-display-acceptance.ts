/**
 * 订单号展示验收（湘湘买家 Drawer）
 * 用法：npx tsx apps/server/scripts/order-display-acceptance.ts
 */
import path from 'node:path'
import { config } from 'dotenv'
import { buildRawAnalyzeBundleAll } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../src/services/business-analysis.service'
import { mapViewToBoardDrillRow } from '../src/services/order-row-mapper.service'
import {
  isBareNumericOrderDisplay,
  pickOfficialDisplayOrderNo,
} from '../src/services/order-display-no.service'
import {
  pickBuyerNicknameFromView,
  viewMatchesBuyerKey,
} from '../src/services/buyer-identity.service'

config({ path: path.resolve(__dirname, '../.env') })

const EXPECTED_P_PREFIX = [
  'P795347932800039811',
  'P794921366365039051',
  'P794062874666039051',
]

async function main() {
  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle) {
    console.error('无原始订单数据')
    process.exit(1)
  }
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const rawByMatch = new Map<string, Record<string, unknown>>()
  for (const o of artifacts.dedupe.uniqueOrders) {
    if (o.raw) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)
  }

  const buyerKey = '湘湘🍚'
  const buyerViews = artifacts.views.filter(
    (v) =>
      viewMatchesBuyerKey(v, buyerKey) ||
      pickBuyerNicknameFromView(v).includes('湘湘'),
  )

  console.log('湘湘订单数:', buyerViews.length)
  const displayed: string[] = []
  let fail = false

  for (const v of buyerViews) {
    const raw = rawByMatch.get(v.matchOrderId || v.orderId)
    const row = mapViewToBoardDrillRow(
      Object.assign({}, v, { raw }) as typeof v & { raw?: Record<string, unknown> },
      { useBuyerRefund: true },
    )
    const picked = raw ? pickOfficialDisplayOrderNo(raw, { packageId: v.packageId, bizOrderId: v.bizOrderId }) : null
    displayed.push(row.orderNo)
    console.log({
      orderNo: row.orderNo,
      displayOrderNo: row.displayOrderNo,
      source: picked?.source,
      bizOrderId: v.bizOrderId,
      packageId: v.packageId,
      bareBiz: isBareNumericOrderDisplay(v.bizOrderId),
    })
    if (isBareNumericOrderDisplay(row.orderNo)) {
      console.error('FAIL: 展示为裸数字订单号', row.orderNo)
      fail = true
    }
    if (!/^P/i.test(row.orderNo)) {
      console.error('FAIL: 订单号无 P 前缀', row.orderNo)
      fail = true
    }
  }

  for (const exp of EXPECTED_P_PREFIX) {
    if (!displayed.includes(exp)) {
      console.warn('WARN: 未找到预期订单号', exp)
    }
  }

  console.log('\n展示订单号列表:', displayed)
  console.log(fail ? '\n验收未通过' : '\n验收通过')
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
