import path from 'node:path'
import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { normalizeXhsOrderPackage } from '../src/services/xhs-api-sync/xhs-json-normalizer.service'

config({ path: path.resolve(__dirname, '../.env') })
const prisma = new PrismaClient()

const ids = [
  'P795490183646098221',
  'P795488136122205841',
  'P795487315710005941',
  'P795491110326121261',
]

async function main(): Promise<void> {
  for (const id of ids) {
    const r = await prisma.xhsRawOrder.findFirst({ where: { packageId: id } })
    if (!r) {
      console.log(id, 'MISSING')
      continue
    }
    const raw = r.rawJson as Record<string, unknown>
    const n = normalizeXhsOrderPackage(raw, 1)
    console.log('---', id)
    console.log({
      status: raw.statusDesc,
      statusCode: raw.status,
      afterSale: raw.afterSaleStatusDesc,
      afterSaleCode: raw.afterSaleStatus,
      paidAt: raw.paidAt,
      orderedAt: raw.orderedAt,
      gmv: n.gmvCent / 100,
      returned: n.isReturned,
      signed: n.isSigned,
    })
  }
}

main()
  .finally(() => void prisma.$disconnect())
