/**
 * 只读诊断：扫描本地 OfflineDeal，检查备注是否曾会误入品退关键词，
 * 以及修复后是否仍被判为品退。
 *
 * 运行：npm run diagnose:offline-quality-misclassification
 * 不修改数据库、不部署。
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { offlineDealToAnalyzedView } from '../src/services/offline-deal.service'
import { viewCountsAsQualityRefund } from '../src/services/quality-refund-resolution.service'
import { matchPlatformReturnReason } from '../src/utils/quality-return'

config({ path: path.resolve(__dirname, '../.env') })

/** 旧版过度宽泛关键词（用于复现历史误判） */
const LEGACY_OVERBROAD = ['断', '裂'] as const

function findLegacyHits(note: string): string[] {
  const n = note.trim()
  if (!n) return []
  return LEGACY_OVERBROAD.filter((kw) => n.includes(kw))
}

function findCurrentKeywordHits(note: string): string[] {
  const n = note.trim()
  if (!n) return []
  const m = matchPlatformReturnReason(n)
  return m.isQualityReturn ? [n] : []
}

async function main(): Promise<void> {
  console.log('diagnose:offline-quality-misclassification (read-only)\n')

  const rows = await prisma.offlineDeal.findMany({
    where: { deletedAt: null },
    orderBy: { dealAt: 'asc' },
  })

  let misclassifiedByLegacy = 0
  let stillQualityAfterFix = 0
  let affectedGmvCent = 0
  const anchors = new Set<string>()
  const buyers = new Set<string>()
  const samples: Array<Record<string, unknown>> = []

  for (const deal of rows) {
    const view = offlineDealToAnalyzedView(deal)
    const note = deal.note?.trim() || ''
    const legacyHits = findLegacyHits(note)
    const currentHits = findCurrentKeywordHits(note)
    const isQualityNow = viewCountsAsQualityRefund(view)

    // 历史误判候选：备注曾含「断/裂」单字，或当前短语若被当成售后原因会命中
    const wouldHaveBeenMisclassified =
      legacyHits.length > 0 || (currentHits.length > 0 && note.length > 0)

    if (wouldHaveBeenMisclassified) {
      misclassifiedByLegacy += 1
      affectedGmvCent += deal.amountCent
      if (deal.anchorName?.trim()) anchors.add(deal.anchorName.trim())
      if (deal.customerLabel?.trim()) buyers.add(deal.customerLabel.trim())
    }
    if (isQualityNow) stillQualityAfterFix += 1

    if (wouldHaveBeenMisclassified || isQualityNow || deal.dealKey === 'OFF-20260714-ESOE5V') {
      samples.push({
        dealKey: deal.dealKey,
        dealAt: deal.dealAt.toISOString(),
        anchorName: deal.anchorName,
        amountYuan: deal.amountCent / 100,
        refundYuan: deal.refundCent / 100,
        note,
        legacyKeywordHits: legacyHits,
        noteWouldMatchCurrentQualityKeyword: currentHits.length > 0,
        reasonTextOnView: view.reasonText || '',
        offlineDealNote: view.offlineDealNote || '',
        isQualityRefundNow: isQualityNow,
        expectedAfterFix: false,
        qualityVerifyWouldBe: 'none',
      })
    }
  }

  console.log('=== 样本（误判候选 / 目标单 / 修复后仍品退）===')
  for (const s of samples) {
    console.log(JSON.stringify(s, null, 0))
  }

  console.log('\n=== 汇总 ===')
  console.log(`线下成交总数: ${rows.length}`)
  console.log(`历史误判候选（备注含单字断/裂，或备注本身含品退短语）: ${misclassifiedByLegacy}`)
  console.log(`修复后仍被判品退: ${stillQualityAfterFix}`)
  console.log(`受影响 GMV（候选）: ¥${(affectedGmvCent / 100).toFixed(2)}`)
  console.log(`受影响主播数: ${anchors.size} → ${[...anchors].join('、') || '—'}`)
  console.log(`受影响买家数: ${buyers.size}`)

  const target = rows.find((r) => r.dealKey === 'OFF-20260714-ESOE5V')
  if (target) {
    const v = offlineDealToAnalyzedView(target)
    console.log('\n=== OFF-20260714-ESOE5V ===')
    console.log(`note: ${target.note}`)
    console.log(`legacy hits: ${findLegacyHits(target.note || '').join(',') || '—'}`)
    console.log(`reasonText: "${v.reasonText}"`)
    console.log(`offlineDealNote: "${v.offlineDealNote}"`)
    console.log(`isQualityRefund now: ${viewCountsAsQualityRefund(v)}`)
  } else {
    console.log('\n本地库未找到 OFF-20260714-ESOE5V，使用同结构 fixture 复现旧误判路径：')
    const fixtureNote = 'zq8366线下成交买断'
    const fixture = offlineDealToAnalyzedView({
      id: 'fixture',
      dealKey: 'OFF-20260714-ESOE5V',
      amountCent: 80000,
      refundCent: 0,
      dealAt: new Date('2026-07-14T15:00:00.000+08:00'),
      status: 'confirmed',
      anchorId: 'a-yifan',
      anchorName: '逸凡',
      customerLabel: 'zq8366',
      note: fixtureNote,
    })
    const legacy = findLegacyHits(fixtureNote)
    console.log(`note: ${fixtureNote}`)
    console.log(`旧逻辑关键词命中: ${legacy.join(',') || '—'}（「买断」含单字「断」）`)
    console.log(`旧路径：若 reasonText=note → matchPlatformReturnReason(note)=${matchPlatformReturnReason(fixtureNote).isQualityReturn}`)
    console.log(`修复后 reasonText="${fixture.reasonText}" offlineDealNote="${fixture.offlineDealNote}"`)
    console.log(`修复后 isQualityRefund=${viewCountsAsQualityRefund(fixture)}`)
  }

  if (stillQualityAfterFix > 0) {
    console.error('\nFAIL: 修复后仍有线下成交被判品退')
    process.exit(1)
  }
  console.log('\n诊断完成：修复后线下成交均非品退（只读，未改库）')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
