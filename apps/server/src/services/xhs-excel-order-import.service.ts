import path from 'node:path'
import fs from 'node:fs'
import ExcelJS from 'exceljs'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { parseMoneyToCent } from '../utils/money'
import { parseDateTime } from '../utils/time'

const PACKAGE_ID_HEADER = '订单号'
const STATUS_HEADER = '订单状态'
const AFTER_SALE_HEADER = '售后状态'
const PRODUCT_TOTAL_HEADER = '商品总价(元)'
const USER_PAY_HEADER = '用户应付金额(元)'
const SELLER_RECEIVE_HEADER = '商家应收金额(元)（支付金额）'
const ORDER_TIME_HEADERS = ['订单创建时间', '支付时间', '下单时间']
const BUYER_HEADER = '用户编号'

function parseHeaderRow(sheet: ExcelJS.Worksheet): Map<string, number> {
  const map = new Map<string, number>()
  const row = sheet.getRow(1)
  row.eachCell((cell, col) => {
    const h = String(cell.value ?? '').trim()
    if (h) map.set(h, col)
  })
  return map
}

function cellStr(row: ExcelJS.Row, col: number | undefined): string {
  if (!col) return ''
  const v = row.getCell(col).value
  if (v == null) return ''
  if (typeof v === 'object' && v !== null && 'text' in v) {
    return String((v as { text?: string }).text ?? '').trim()
  }
  return String(v).trim()
}

function cellMoney(row: ExcelJS.Row, col: number | undefined): number {
  const s = cellStr(row, col)
  if (!s) return 0
  const parsed = parseMoneyToCent(s)
  return parsed.ok ? parsed.cent : 0
}

function cellDate(row: ExcelJS.Row, headers: Map<string, number>): Date | null {
  for (const h of ORDER_TIME_HEADERS) {
    const col = headers.get(h)
    if (!col) continue
    const raw = row.getCell(col).value
    const parsed = parseDateTime(raw)
    if (parsed.ok) return parsed.date
  }
  return null
}

function buildRawJsonFromExcelRow(
  row: ExcelJS.Row,
  headers: Map<string, number>,
): Record<string, unknown> | null {
  const packageId = cellStr(row, headers.get(PACKAGE_ID_HEADER))
  if (!packageId) return null

  const productTotalCent = cellMoney(row, headers.get(PRODUCT_TOTAL_HEADER))
  const userPayCent = cellMoney(row, headers.get(USER_PAY_HEADER))
  const sellerReceiveCent = cellMoney(row, headers.get(SELLER_RECEIVE_HEADER))
  const orderTime = cellDate(row, headers)
  const statusDesc = cellStr(row, headers.get(STATUS_HEADER))
  const afterSaleStatusDesc = cellStr(row, headers.get(AFTER_SALE_HEADER))
  const buyerId = cellStr(row, headers.get(BUYER_HEADER)) || undefined

  const orderedAt = orderTime ? orderTime.getTime() : undefined

  return {
    packageId,
    orderedAt,
    paidAt: orderedAt,
    statusDesc,
    afterSaleStatusDesc,
    buyerId,
    userInfo: buyerId ? { userId: buyerId } : undefined,
    actualSellerReceiveAmount: sellerReceiveCent / 100,
    totalOrderAmount: userPayCent / 100,
    receivableAmount: userPayCent / 100,
    actualPaid: userPayCent / 100,
    productTotalAmount: productTotalCent / 100,
    skus:
      productTotalCent > 0
        ? [
            {
              skuName: cellStr(row, headers.get('商品名称')) || '—',
              totalPayAmount: productTotalCent / 100,
            },
          ]
        : [],
    _importSource: 'xhs_order_query_excel',
  }
}

export async function importXhsOrderQueryExcel(
  filePath: string,
  syncJobId?: string | null,
): Promise<{
  filePath: string
  rowCount: number
  savedCount: number
  packageIds: string[]
  warnings: string[]
}> {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)
  if (!fs.existsSync(abs)) {
    throw new Error(`文件不存在: ${abs}`)
  }

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(abs)
  const sheet = wb.worksheets[0]
  if (!sheet) throw new Error('Excel 无工作表')

  const headers = parseHeaderRow(sheet)
  if (!headers.has(PACKAGE_ID_HEADER)) {
    throw new Error(`缺少列「${PACKAGE_ID_HEADER}」`)
  }

  const warnings: string[] = []
  const packageIds: string[] = []
  let savedCount = 0
  let rowCount = 0

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    if (row.cellCount === 0) continue
    const rawJson = buildRawJsonFromExcelRow(row, headers)
    if (!rawJson) continue
    rowCount++
    const packageId = String(rawJson.packageId)
    const orderTime = cellDate(row, headers)

    await prisma.xhsRawOrder.upsert({
      where: {
        liveAccountId_packageId: {
          liveAccountId: 'legacy',
          packageId,
        },
      },
      create: {
        packageId,
        liveAccountId: 'legacy',
        orderId: packageId,
        orderTime,
        buyerId: rawJson.buyerId ? String(rawJson.buyerId) : null,
        rawJson: rawJson as Prisma.InputJsonValue,
        syncJobId: syncJobId ?? null,
      },
      update: {
        orderId: packageId,
        orderTime,
        buyerId: rawJson.buyerId ? String(rawJson.buyerId) : null,
        rawJson: rawJson as Prisma.InputJsonValue,
        syncJobId: syncJobId ?? null,
      },
    })
    packageIds.push(packageId)
    savedCount++
  }

  if (rowCount === 0) {
    warnings.push('未解析到有效订单行')
  }

  return { filePath: abs, rowCount, savedCount, packageIds, warnings }
}

function resolveRealTableDir(): string {
  const candidates = [
    path.resolve(process.cwd(), '真实表格'),
    path.resolve(process.cwd(), '..', '..', '真实表格'),
    path.resolve(process.cwd(), '../../真实表格'),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir
  }
  throw new Error('未找到 真实表格 目录（请在项目根目录放置）')
}

/** 导入项目内「真实表格」目录下最新小红书订单查询表（super_admin 调试用） */
export async function importLatestOrderQueryExcelFromRealTableDir(): Promise<
  Awaited<ReturnType<typeof importXhsOrderQueryExcel>>
> {
  const dir = resolveRealTableDir()
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.includes('小红书订单查询') && f.endsWith('.xlsx'))
    .sort()
  const latest = files[files.length - 1]
  if (!latest) throw new Error('真实表格目录下无小红书订单查询 xlsx')
  return importXhsOrderQueryExcel(path.join(dir, latest))
}
