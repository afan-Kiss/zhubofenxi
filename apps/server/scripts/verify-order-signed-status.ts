/**
 * 验证订单是否计入实际签收
 * npx tsx apps/server/scripts/verify-order-signed-status.ts P796633571104420891 ...
 */
import path from 'node:path'
import { config } from 'dotenv'
import { loadBoardArtifactsForRange } from '../src/services/board-metrics.service'
import { isEffectiveSignedView } from '../src/services/strict-after-sale-metrics.service'

config({ path: path.resolve(__dirname, '../.env') })

const orderNos = new Set(process.argv.slice(2).filter((a) => /^P/i.test(a)))
if (orderNos.size === 0) {
  console.error('用法: npx tsx apps/server/scripts/verify-order-signed-status.ts P796633571104420891 ...')
  process.exit(1)
}

async function main(): Promise<void> {
  const { views } = await loadBoardArtifactsForRange('custom', '2026-06-01', '2026-06-18')
  for (const no of orderNos) {
    const v = views.find((x) => (x.displayOrderNo || x.officialOrderNo || '') === no)
    if (!v) {
      console.log(`${no}: 不在 2026-06 视图内`)
      continue
    }
    console.log(
      JSON.stringify(
        {
          orderNo: no,
          productRefundYuan: (v.productRefundAmountCent ?? 0) / 100,
          buyerRefundYuan: (v.buyerProductRefundAmountCent ?? 0) / 100,
          refundSource: v.buyerProductRefundSource,
          isEffectiveSigned: v.isEffectiveSigned,
          isEffectiveSignedView: isEffectiveSignedView(v),
          actualSignYuan: (v.actualSignAmountCent ?? 0) / 100,
        },
        null,
        2,
      ),
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
