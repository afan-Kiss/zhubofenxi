import { prisma } from '../../lib/prisma'
import type { GoodReviewShopDefinition } from '../../config/good-review-shops.constants'
import type { ParsedBossShopScores } from './boss-dashboard-normalize.service'
import type { BossShopScoreSnapshot } from '@prisma/client'

const METRIC_LABELS: Record<string, string> = {
  qualityScore: '品质分',
  logisticsScore: '物流分',
  serviceScore: '服务分',
  officialOverallScore: '综合体验分',
}

const SCORE_ADVICE: Record<string, string> = {
  qualityScore:
    '品质分下降，优先检查直播中颜色、材质、证书、天然包容和尺寸是否说清楚，并查看最近新增的品质负向反馈。',
  logisticsScore:
    '物流分下降，检查付款后超过24小时仍未揽收的订单，以及异常中转、错发和漏发情况。',
  serviceScore:
    '服务分下降，检查客服三分钟回复率、售后响应速度、满意度和平台介入订单。',
}

function metricDelta(
  prev: BossShopScoreSnapshot | null,
  current: ParsedBossShopScores,
  key: keyof ParsedBossShopScores,
): { previous: number | null; current: number | null; delta: number | null } {
  const cur = current[key]
  const previous =
    prev && key in prev ? (prev[key as keyof BossShopScoreSnapshot] as number | null) : null
  if (typeof cur !== 'number' || typeof previous !== 'number') {
    return { previous: typeof previous === 'number' ? previous : null, current: typeof cur === 'number' ? cur : null, delta: null }
  }
  const delta = Math.round((cur - previous) * 100) / 100
  return { previous, current: cur, delta }
}

export async function createScoreChangeAnnouncements(params: {
  shop: GoodReviewShopDefinition
  scoreDate: string
  previous: BossShopScoreSnapshot | null
  current: ParsedBossShopScores
}): Promise<void> {
  const metrics: Array<keyof ParsedBossShopScores> = [
    'qualityScore',
    'logisticsScore',
    'serviceScore',
  ]
  for (const key of metrics) {
    const { previous, current, delta } = metricDelta(params.previous, params.current, key)
    if (delta == null || delta === 0 || current == null || previous == null) continue
    const label = METRIC_LABELS[key] ?? key
    const tone = delta > 0 ? 'positive' : 'negative'
    const dedupeKey = `score:${params.shop.shopKey}:${params.scoreDate}:${key}:${current}`
    const suggestion = SCORE_ADVICE[key] ?? null
    await prisma.bossAnnouncement.upsert({
      where: { dedupeKey },
      create: {
        kind: 'score_change',
        shopKey: params.shop.shopKey,
        shopName: params.shop.shopName,
        title: `${params.shop.shopName}${label}${delta > 0 ? '上升' : '下降'}`,
        content: `${label}由 ${previous} 变为 ${current}（${delta > 0 ? '+' : ''}${delta}）`,
        scoreDate: params.scoreDate,
        metricKey: key,
        previousScore: previous,
        currentScore: current,
        deltaScore: delta,
        suggestion,
        tone,
        dedupeKey,
        enabled: true,
      },
      update: {
        content: `${label}由 ${previous} 变为 ${current}（${delta > 0 ? '+' : ''}${delta}）`,
        enabled: true,
      },
    })
  }
}

export async function createManualAnnouncement(params: {
  title: string
  content: string
  startsAt?: Date | null
  endsAt?: Date | null
  enabled?: boolean
  createdBy?: string | null
}) {
  return prisma.bossAnnouncement.create({
    data: {
      kind: 'manual',
      title: params.title.trim(),
      content: params.content.trim(),
      startsAt: params.startsAt ?? null,
      endsAt: params.endsAt ?? null,
      enabled: params.enabled ?? true,
      createdBy: params.createdBy ?? null,
      tone: 'neutral',
    },
  })
}

export async function listActiveAnnouncements(userId?: string) {
  const now = new Date()
  const rows = await prisma.bossAnnouncement.findMany({
    where: {
      enabled: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  if (!userId) return rows.map((r) => ({ ...r, isRead: false, popupShown: false }))
  const states = await prisma.bossAnnouncementUserState.findMany({
    where: { userId, announcementId: { in: rows.map((r) => r.id) } },
  })
  const stateMap = new Map(states.map((s) => [s.announcementId, s]))
  return rows.map((r) => {
    const st = stateMap.get(r.id)
    return {
      ...r,
      isRead: Boolean(st?.readAt),
      popupShown: Boolean(st?.popupShownAt),
    }
  })
}

export async function markAnnouncementRead(userId: string, announcementId: string) {
  return prisma.bossAnnouncementUserState.upsert({
    where: { userId_announcementId: { userId, announcementId } },
    create: { userId, announcementId, readAt: new Date() },
    update: { readAt: new Date() },
  })
}

export async function markAllAnnouncementsRead(userId: string) {
  const rows = await listActiveAnnouncements()
  await Promise.all(rows.map((r) => markAnnouncementRead(userId, r.id)))
}

export async function markAnnouncementPopupShown(userId: string, announcementId: string) {
  return prisma.bossAnnouncementUserState.upsert({
    where: { userId_announcementId: { userId, announcementId } },
    create: { userId, announcementId, popupShownAt: new Date(), readAt: new Date() },
    update: { popupShownAt: new Date() },
  })
}

export async function countUnreadAnnouncements(userId: string): Promise<number> {
  const rows = await listActiveAnnouncements(userId)
  return rows.filter((r) => !r.isRead).length
}

export async function findPendingScoreDropPopup(userId: string) {
  const rows = await listActiveAnnouncements(userId)
  return rows.find((r) => r.kind === 'score_change' && r.tone === 'negative' && !r.popupShown)
}
