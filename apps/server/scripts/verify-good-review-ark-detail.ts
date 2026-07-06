/**
 * 千帆订单详情（好评中心）验收（只读）
 *
 * npm run verify:good-review-ark-detail
 */
import { config } from 'dotenv'
import path from 'node:path'
import { prisma } from '../src/lib/prisma'
import { buildGoodReviewArkOrderDetail } from '../src/services/qianfan-order-open-ticket.service'

config({ path: path.resolve(__dirname, '../.env') })

const issues: string[] = []

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}

function fail(msg: string): void {
  issues.push(msg)
  console.log(`  ✗ ${msg}`)
}

async function main(): Promise<void> {
  console.log('verify-good-review-ark-detail')

  const empty = await buildGoodReviewArkOrderDetail({ orderId: '', shop: 'shiyuju' })
  if (!empty.ok && empty.error) ok('空 orderId 返回可控错误')
  else fail('空 orderId 应返回 ok=false')

  const badShop = await buildGoodReviewArkOrderDetail({
    orderId: 'P798535644148309221',
    shop: 'invalid-shop-key',
  })
  if (!badShop.ok && badShop.error?.includes('无效')) ok('无效 shop 返回可控错误')
  else fail('无效 shop 应返回友好错误')

  const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
  const sample = await prisma.goodReview.findFirst({
    where: {
      orderId: { not: null },
      reviewTime: { gte: cutoff },
    },
    orderBy: { reviewTime: 'desc' },
  })

  if (sample?.orderId) {
    console.log(`  样本 orderId=${sample.orderId} shop=${sample.shopKey}`)
    try {
      const result = await buildGoodReviewArkOrderDetail({
        orderId: sample.orderId,
        shop: sample.shopKey,
      })
      const ticketOk =
        result.hasTicket && result.finalOpenUrl.includes('ticket')
      const fallbackOk =
        result.fallbackToBaseUrl && result.finalOpenUrl.includes('ark.xiaohongshu.com')
      if (ticketOk || fallbackOk || (result.finalOpenUrl && result.serviceUrl)) {
        ok(
          `有效订单 resolve ok=${result.ok} hasTicket=${result.hasTicket} fallback=${result.fallbackToBaseUrl}`,
        )
      } else {
        fail(`有效订单 resolve 异常：${result.error ?? '无 finalOpenUrl'}`)
      }
    } catch (err) {
      fail(`有效订单不应抛错：${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    ok('本地无最近两天带 orderId 样本，跳过有效订单 resolve（空/无效 shop 已验）')
  }

  console.log('\n=== 结果 ===')
  if (issues.length > 0) {
    console.log(`FAIL (${issues.length})`)
    for (const i of issues) console.log(` - ${i}`)
    await prisma.$disconnect()
    process.exit(1)
  }
  console.log('PASS')
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
