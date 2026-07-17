/**
 * 按业务日解析主播候选（正式 + 临时 + 当日实际归属）
 */
import { prisma } from '../lib/prisma'
import {
  isAnchorEffectiveOnDate,
  isOffboardDateMissing,
} from '../utils/anchor-effective-date.util'
import { getEffectiveScheduleTableForDate } from './anchor-daily-schedule.service'

export interface DateAnchorCandidate {
  key: string
  anchorId: string | null
  temporaryAnchorKey: string | null
  anchorName: string
  color: string | null
  isTemporaryAnchor: boolean
  historical: boolean
  sources: string[]
}

function pushCandidate(
  map: Map<string, DateAnchorCandidate>,
  partial: Omit<DateAnchorCandidate, 'sources'> & { source: string },
) {
  const existing = map.get(partial.key)
  if (existing) {
    if (!existing.sources.includes(partial.source)) existing.sources.push(partial.source)
    if (!existing.color && partial.color) existing.color = partial.color
    return
  }
  map.set(partial.key, {
    key: partial.key,
    anchorId: partial.anchorId,
    temporaryAnchorKey: partial.temporaryAnchorKey,
    anchorName: partial.anchorName,
    color: partial.color,
    isTemporaryAnchor: partial.isTemporaryAnchor,
    historical: partial.historical,
    sources: [partial.source],
  })
}

/** 当日排班可选正式主播（含历史日已离职但仍在区间内的主播） */
export async function listScheduleFormalAnchorOptions(dateKey: string): Promise<
  Array<{
    id: string
    name: string
    color: string | null
    effectiveFrom: string | null
    effectiveTo: string | null
    currentEnabled: boolean
    effectiveOnSelectedDate: boolean
    historical: boolean
    offboardDateMissing: boolean
  }>
> {
  const rows = await prisma.anchor.findMany({
    where: {
      deletedAt: null,
      attributionMode: 'schedule',
      systemKey: null,
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })

  return rows
    .map((a) => {
      const effectiveOnSelectedDate = isAnchorEffectiveOnDate(a, dateKey)
      const missing = isOffboardDateMissing(a)
      const historical = !a.enabled && effectiveOnSelectedDate
      return {
        id: a.id,
        name: a.name,
        color: a.color,
        effectiveFrom: a.effectiveFrom,
        effectiveTo: a.effectiveTo,
        currentEnabled: a.enabled,
        effectiveOnSelectedDate,
        historical,
        offboardDateMissing: missing,
      }
    })
    .filter((a) => {
      if (a.offboardDateMissing) return false
      return a.effectiveOnSelectedDate
    })
}

/**
 * 主播业绩 / 日报候选来源：
 * 当日有效正式主播 + 当日排班（含临时）+ 订单归属姓名 + 直播场次分配姓名
 */
export async function resolveAnchorCandidatesForDate(
  dateKey: string,
  extras?: {
    orderAnchorNames?: string[]
    liveSessionAnchorNames?: string[]
  },
): Promise<DateAnchorCandidate[]> {
  const map = new Map<string, DateAnchorCandidate>()

  const formal = await listScheduleFormalAnchorOptions(dateKey)
  for (const a of formal) {
    pushCandidate(map, {
      key: `id:${a.id}`,
      anchorId: a.id,
      temporaryAnchorKey: null,
      anchorName: a.name,
      color: a.color,
      isTemporaryAnchor: false,
      historical: a.historical,
      source: 'formal_effective',
    })
  }

  const scheduleTable = await getEffectiveScheduleTableForDate(dateKey)
  const dailyRows = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: dateKey, enabled: true },
  })

  for (const row of dailyRows) {
    if (row.isTemporaryAnchor && row.temporaryAnchorKey) {
      pushCandidate(map, {
        key: `temp:${row.temporaryAnchorKey}`,
        anchorId: null,
        temporaryAnchorKey: row.temporaryAnchorKey,
        anchorName: row.anchorName,
        color: row.anchorColorSnapshot,
        isTemporaryAnchor: true,
        historical: false,
        source: 'temporary_schedule',
      })
      continue
    }
    if (row.anchorId) {
      pushCandidate(map, {
        key: `id:${row.anchorId}`,
        anchorId: row.anchorId,
        temporaryAnchorKey: null,
        anchorName: row.anchorName,
        color: null,
        isTemporaryAnchor: false,
        historical: false,
        source: 'daily_schedule',
      })
    } else if (row.anchorName.trim()) {
      pushCandidate(map, {
        key: `name:${row.anchorName.trim().toLowerCase()}`,
        anchorId: null,
        temporaryAnchorKey: null,
        anchorName: row.anchorName.trim(),
        color: null,
        isTemporaryAnchor: false,
        historical: true,
        source: 'daily_schedule_name',
      })
    }
  }

  for (const row of scheduleTable.rows) {
    if (!row.enabled || !row.anchorName.trim()) continue
    const name = row.anchorName.trim()
    // EffectiveScheduleRow 暂无临时标记时，靠 dailyRows 已覆盖临时；此处补正式姓名
    const alreadyTemp = [...map.values()].some(
      (c) => c.isTemporaryAnchor && c.anchorName === name,
    )
    if (alreadyTemp) continue
    const formalHit = formal.find((f) => f.name === name)
    if (formalHit) {
      pushCandidate(map, {
        key: `id:${formalHit.id}`,
        anchorId: formalHit.id,
        temporaryAnchorKey: null,
        anchorName: formalHit.name,
        color: formalHit.color,
        isTemporaryAnchor: false,
        historical: formalHit.historical,
        source: 'effective_schedule',
      })
    } else {
      pushCandidate(map, {
        key: `name:${name.toLowerCase()}`,
        anchorId: null,
        temporaryAnchorKey: null,
        anchorName: name,
        color: null,
        isTemporaryAnchor: false,
        historical: true,
        source: 'effective_schedule_name',
      })
    }
  }

  for (const name of extras?.orderAnchorNames ?? []) {
    const n = name.trim()
    if (!n || n === '未归属') continue
    const formalHit = formal.find((f) => f.name === n)
    if (formalHit) {
      pushCandidate(map, {
        key: `id:${formalHit.id}`,
        anchorId: formalHit.id,
        temporaryAnchorKey: null,
        anchorName: formalHit.name,
        color: formalHit.color,
        isTemporaryAnchor: false,
        historical: formalHit.historical,
        source: 'order_attribution',
      })
    } else {
      const tempHit = [...map.values()].find((c) => c.isTemporaryAnchor && c.anchorName === n)
      if (tempHit) {
        pushCandidate(map, { ...tempHit, source: 'order_attribution' })
      } else {
        pushCandidate(map, {
          key: `name:${n.toLowerCase()}`,
          anchorId: null,
          temporaryAnchorKey: null,
          anchorName: n,
          color: null,
          isTemporaryAnchor: false,
          historical: true,
          source: 'order_attribution',
        })
      }
    }
  }

  for (const name of extras?.liveSessionAnchorNames ?? []) {
    const n = name.trim()
    if (!n || n === '未归属') continue
    const formalHit = formal.find((f) => f.name === n)
    if (formalHit) {
      pushCandidate(map, {
        key: `id:${formalHit.id}`,
        anchorId: formalHit.id,
        temporaryAnchorKey: null,
        anchorName: formalHit.name,
        color: formalHit.color,
        isTemporaryAnchor: false,
        historical: formalHit.historical,
        source: 'live_session',
      })
    } else {
      const tempHit = [...map.values()].find((c) => c.isTemporaryAnchor && c.anchorName === n)
      if (tempHit) {
        pushCandidate(map, { ...tempHit, source: 'live_session' })
      } else {
        pushCandidate(map, {
          key: `name:${n.toLowerCase()}`,
          anchorId: null,
          temporaryAnchorKey: null,
          anchorName: n,
          color: null,
          isTemporaryAnchor: false,
          historical: true,
          source: 'live_session',
        })
      }
    }
  }

  return [...map.values()].sort((a, b) => a.anchorName.localeCompare(b.anchorName, 'zh-CN'))
}
