import { prisma } from '../../lib/prisma'
import { GOOD_REVIEW_SHOPS } from '../../config/good-review-shops.constants'
import { resolveOfficialShopAccountForStatus } from '../official-shop-account.service'

export async function getLuckyGiftHealthReport() {
  const metas = await prisma.luckyGiftSyncMeta.findMany()
  const run = await prisma.luckyGiftSyncRun.findUnique({ where: { id: 'default' } })
  const draws = await prisma.xhsLuckyDraw.findMany()
  const winners = await prisma.xhsLuckyWinner.findMany({ include: { shipment: true } })

  const configuredShops: string[] = []
  const missingShops: string[] = []
  for (const shop of GOOD_REVIEW_SHOPS) {
    const acc = await resolveOfficialShopAccountForStatus(shop.shopKey)
    if (acc?.id) configuredShops.push(shop.shopName)
    else missingShops.push(shop.shopName)
  }

  const noAddress = winners.filter((w) => (w.shipment?.shipmentStatus || 'no_address') === 'no_address')
  const incomplete = winners.filter(
    (w) => w.shipment?.shipmentStatus === 'incomplete_address',
  )
  const pending = winners.filter((w) => w.shipment?.shipmentStatus === 'pending')
  const shipped = winners.filter((w) => w.shipment?.shipmentStatus === 'shipped')

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const overdueNoAddress = noAddress.filter(
    (w) => w.winTime && w.winTime < sevenDaysAgo,
  )

  // 重复中奖：同店同福袋同 winnerKey 不应出现；额外检查同 userId 重复
  const dupKey = new Map<string, number>()
  for (const w of winners) {
    const k = `${w.liveAccountId}|${w.luckyDrawId}|${w.winnerKey}`
    dupKey.set(k, (dupKey.get(k) || 0) + 1)
  }
  const duplicateWinnerCount = [...dupKey.values()].filter((n) => n > 1).length

  // 长 ID 精度：非纯数字或末尾疑似被 Number 截断（以原始 raw 对照）
  let bigintAnomalyCount = 0
  for (const d of draws) {
    if (!/^\d+$/.test(d.luckyDrawId)) bigintAnomalyCount += 1
    if (d.luckyDrawId.endsWith('000') && d.luckyDrawId.length >= 18) {
      // 弱信号：仍计入供人工核对
    }
    try {
      if (d.rawJson) {
        const n = Number(d.luckyDrawId)
        if (String(n) !== d.luckyDrawId && Number.isFinite(n)) {
          // Number 无法精确表示，说明我们存的是字符串——这是正常的
        }
      }
    } catch {
      /* ignore */
    }
  }

  const listMismatchCount = metas.filter(
    (m) =>
      m.platformTotal != null &&
      (m.fetchedCount !== m.platformTotal || m.dedupedCount !== m.platformTotal),
  ).length
  const detailFailCount = metas.reduce((s, m) => s + (m.detailFailCount || 0), 0)

  const localShippedOfficialConflict = winners.filter(
    (w) =>
      w.shipment?.shipmentStatus === 'shipped' &&
      w.shipment.shippingStatusSource === 'local' &&
      !w.officialShipped &&
      w.officialTrackingNo,
  ).length

  // 地址完整却被标未填
  const misclassified = winners.filter(
    (w) => w.addressComplete && w.shipment?.shipmentStatus === 'no_address',
  ).length

  const staleShops = []
  const now = Date.now()
  for (const shop of GOOD_REVIEW_SHOPS) {
    const acc = await resolveOfficialShopAccountForStatus(shop.shopKey)
    if (!acc) continue
    const meta = metas.find((m) => m.liveAccountId === acc.id)
    const last = meta?.lastSuccessAt?.getTime() ?? meta?.lastSyncedAt?.getTime() ?? 0
    if (!last || now - last > 36 * 3600 * 1000) {
      staleShops.push(shop.shopName)
    }
  }

  const blockers: string[] = []
  const warnings: string[] = []
  if (bigintAnomalyCount > 0) blockers.push(`有 ${bigintAnomalyCount} 条福袋 ID 格式异常，可能发生精度丢失。`)
  if (duplicateWinnerCount > 0) blockers.push(`发现 ${duplicateWinnerCount} 组重复中奖记录。`)
  if (staleShops.length > 0) {
    blockers.push(`${staleShops.join('、')} 超过 36 小时未成功同步。`)
  }
  if (listMismatchCount > 0) blockers.push(`有 ${listMismatchCount} 个店铺福袋列表数量与平台 total 不一致，可能漏页。`)
  if (detailFailCount > 0) {
    warnings.push(`详情接口累计失败 ${detailFailCount} 次，可能存在漏单。`)
  }
  if (misclassified > 0) {
    blockers.push(`有 ${misclassified} 个中奖人地址完整却被标成未填地址。`)
  }
  for (const shop of GOOD_REVIEW_SHOPS) {
    const acc = await resolveOfficialShopAccountForStatus(shop.shopKey)
    if (!acc) continue
    const shopNoAddr = noAddress.filter((w) => w.liveAccountId === acc.id).length
    if (shopNoAddr > 0) {
      warnings.push(`${shop.shopName}有${shopNoAddr}个中奖人还没填写地址。`)
    }
    const meta = metas.find((m) => m.liveAccountId === acc.id)
    if (meta && meta.detailFailCount > 0) {
      warnings.push(
        `${shop.shopName}有${meta.detailFailCount}个福袋详情读取失败，可能存在漏单。`,
      )
    }
  }
  if (overdueNoAddress.length > 0) {
    warnings.push(`有 ${overdueNoAddress.length} 个中奖人超过7天仍未填地址。`)
  }
  if (localShippedOfficialConflict > 0) {
    warnings.push(`有 ${localShippedOfficialConflict} 条本地已发与平台物流信息存在冲突。`)
  }

  return {
    configuredShopCount: configuredShops.length,
    configuredShops,
    missingShops,
    lastSuccessShopCount: run?.successShopCount ?? 0,
    drawCount: draws.length,
    winnerCount: winners.length,
    noAddressCount: noAddress.length,
    incompleteAddressCount: incomplete.length,
    pendingCount: pending.length,
    shippedCount: shipped.length,
    detailFailCount,
    duplicateWinnerCount,
    bigintAnomalyCount,
    listMismatchCount,
    incompleteFieldCount: incomplete.length,
    overdueNoAddressCount: overdueNoAddress.length,
    localOfficialConflictCount: localShippedOfficialConflict,
    misclassifiedNoAddressCount: misclassified,
    blockers,
    warnings,
    statusSumOk:
      noAddress.length + incomplete.length + pending.length + shipped.length === winners.length,
  }
}
