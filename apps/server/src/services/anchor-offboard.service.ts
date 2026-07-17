/**
 * 正式主播离职：记录 effectiveTo、截断模板、清理未来排班、写操作日志、失效缓存。
 */
import { prisma } from '../lib/prisma'
import { writeOperationLog } from './audit.service'
import {
  assertValidOffboardDate,
  isAnchorEffectiveOnDate,
  isBusinessDateKey,
} from '../utils/anchor-effective-date.util'
import { refreshAnchorConfigCache } from './anchor.service'
import { invalidateBusinessBoardCache } from './business-cache.service'
import { invalidateBusinessBoardCacheForDate } from './anchor-schedule-cache.service'

export interface OffboardAnchorResult {
  anchorId: string
  anchorName: string
  /** @deprecated 兼容旧字段 */
  id: string
  /** @deprecated 兼容旧字段 */
  name: string
  effectiveFrom: string | null
  effectiveTo: string
  truncatedTemplateCount: number
  disabledTemplateCount: number
  removedFutureScheduleCount: number
  affectedDates: string[]
  /** 兼容旧命名 */
  templatesTruncated: number
  templatesDisabled: number
  futureSchedulesCleared: number
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

export async function offboardAnchor(params: {
  id: string
  effectiveTo: string
  reason?: string
  operatorUsername?: string | null
  operatorUserId?: string | null
  operatorRole?: string | null
  /** 仅验收注入：事务中某阶段后抛错以验证回滚 */
  __verifyInjectFailureAfter?: 'anchor' | 'templates' | 'schedules'
}): Promise<OffboardAnchorResult> {
  const existing = await prisma.anchor.findFirst({
    where: { id: params.id, deletedAt: null },
  })
  if (!existing) throw new Error('主播不存在')

  const effectiveTo = assertValidOffboardDate({
    effectiveTo: params.effectiveTo,
    effectiveFrom: existing.effectiveFrom,
  })
  const reason = (params.reason ?? '主播离职').trim() || '主播离职'

  let templatesTruncated = 0
  let templatesDisabled = 0
  let futureSchedulesCleared = 0
  const affectedDates: string[] = []

  await prisma.$transaction(async (tx) => {
    await tx.anchor.update({
      where: { id: existing.id },
      data: {
        enabled: false,
        effectiveTo,
      },
    })
    if (params.__verifyInjectFailureAfter === 'anchor') {
      throw new Error('VERIFY_INJECT: after_anchor')
    }

    const templates = await tx.anchorScheduleTemplate.findMany({
      where: {
        OR: [
          { anchorId: existing.id },
          { anchorName: existing.name },
        ],
        enabled: true,
      },
    })

    for (const tpl of templates) {
      const byId = tpl.anchorId === existing.id
      const byName =
        !tpl.anchorId && normalizeName(tpl.anchorName) === normalizeName(existing.name)
      if (!byId && !byName) continue

      const tplFrom = tpl.effectiveFrom?.trim() || null
      // 模板从离职次日才开始 → 停用
      if (tplFrom && isBusinessDateKey(tplFrom) && tplFrom > effectiveTo) {
        await tx.anchorScheduleTemplate.update({
          where: { id: tpl.id },
          data: { enabled: false },
        })
        templatesDisabled++
        continue
      }
      // 模板覆盖离职日：将 effectiveTo 截到离职日（保留历史）
      const tplTo = tpl.effectiveTo?.trim() || null
      if (!tplTo || tplTo > effectiveTo) {
        await tx.anchorScheduleTemplate.update({
          where: { id: tpl.id },
          data: { effectiveTo },
        })
        templatesTruncated++
      }
    }
    if (params.__verifyInjectFailureAfter === 'templates') {
      throw new Error('VERIFY_INJECT: after_templates')
    }

    const futureRows = await tx.anchorDailySchedule.findMany({
      where: {
        scheduleDate: { gt: effectiveTo },
        OR: [
          { anchorId: existing.id },
          { anchorName: existing.name },
        ],
      },
      select: { id: true, scheduleDate: true, anchorId: true, anchorName: true },
    })

    const toClear = futureRows.filter((row) => {
      if (row.anchorId === existing.id) return true
      return normalizeName(row.anchorName) === normalizeName(existing.name)
    })

    for (const row of toClear) {
      if (!affectedDates.includes(row.scheduleDate)) affectedDates.push(row.scheduleDate)
    }

    if (toClear.length) {
      await tx.anchorDailySchedule.deleteMany({
        where: { id: { in: toClear.map((r) => r.id) } },
      })
      futureSchedulesCleared = toClear.length
    }
    if (params.__verifyInjectFailureAfter === 'schedules') {
      throw new Error('VERIFY_INJECT: after_schedules')
    }
  })

  await writeOperationLog({
    userId: params.operatorUserId,
    username: params.operatorUsername,
    role: params.operatorRole,
    action: 'unknown',
    module: 'settings',
    description: `主播离职：${existing.name}，最后工作日 ${effectiveTo}`,
    meta: {
      anchorId: existing.id,
      anchorName: existing.name,
      effectiveFrom: existing.effectiveFrom,
      effectiveTo,
      templatesTruncated,
      templatesDisabled,
      futureSchedulesCleared,
      affectedDates,
      reason,
    },
  })

  await refreshAnchorConfigCache()
  invalidateBusinessBoardCache()
  invalidateBusinessBoardCacheForDate(effectiveTo)
  for (const d of affectedDates) {
    invalidateBusinessBoardCacheForDate(d)
  }

  return {
    anchorId: existing.id,
    anchorName: existing.name,
    id: existing.id,
    name: existing.name,
    effectiveFrom: existing.effectiveFrom,
    effectiveTo,
    truncatedTemplateCount: templatesTruncated,
    disabledTemplateCount: templatesDisabled,
    removedFutureScheduleCount: futureSchedulesCleared,
    affectedDates,
    templatesTruncated,
    templatesDisabled,
    futureSchedulesCleared,
  }
}

/** 撤销离职：清空 effectiveTo 并恢复 enabled */
export async function reinstateAnchor(params: {
  id: string
  operatorUsername?: string | null
  operatorUserId?: string | null
  operatorRole?: string | null
}): Promise<{ id: string; name: string }> {
  const existing = await prisma.anchor.findFirst({
    where: { id: params.id, deletedAt: null },
  })
  if (!existing) throw new Error('主播不存在')

  await prisma.anchor.update({
    where: { id: existing.id },
    data: {
      enabled: true,
      effectiveTo: null,
    },
  })

  await writeOperationLog({
    userId: params.operatorUserId,
    username: params.operatorUsername,
    role: params.operatorRole,
    action: 'unknown',
    module: 'settings',
    description: `撤销主播离职：${existing.name}（已清空离职日期）`,
    meta: {
      anchorId: existing.id,
      anchorName: existing.name,
      previousEffectiveTo: existing.effectiveTo,
    },
  })

  await refreshAnchorConfigCache()
  invalidateBusinessBoardCache()

  return { id: existing.id, name: existing.name }
}

/** 补录离职日期（已停用且缺日期） */
export async function patchOffboardDate(params: {
  id: string
  effectiveTo: string
  reason?: string
  operatorUsername?: string | null
  operatorUserId?: string | null
  operatorRole?: string | null
}): Promise<OffboardAnchorResult> {
  const existing = await prisma.anchor.findFirst({
    where: { id: params.id, deletedAt: null },
  })
  if (!existing) throw new Error('主播不存在')
  if (existing.enabled) {
    throw new Error('主播仍在职，请使用「办理离职」')
  }
  return offboardAnchor(params)
}

/** 正式主播是否允许安排在指定业务日（含缺离职日期的已停用拦截） */
export function canScheduleFormalAnchorOnDate(
  anchor: {
    enabled: boolean
    effectiveFrom?: string | null
    effectiveTo?: string | null
    attributionMode?: string | null
    systemKey?: string | null
  },
  dateKey: string,
): { ok: boolean; message?: string } {
  if (anchor.systemKey || anchor.attributionMode === 'manual') {
    return { ok: false, message: '系统/手动主播不可用于排班' }
  }
  if (anchor.enabled === false && !anchor.effectiveTo?.trim()) {
    return { ok: false, message: '该主播已停用但离职日期待补录，不能用于新排班' }
  }
  if (!isAnchorEffectiveOnDate(anchor, dateKey)) {
    const to = anchor.effectiveTo?.trim()
    if (to && dateKey > to) {
      return {
        ok: false,
        message: `主播最后工作日为${to}，不能安排到${dateKey}`,
      }
    }
    const from = anchor.effectiveFrom?.trim()
    if (from && dateKey < from) {
      return {
        ok: false,
        message: `主播上岗日期为${from}，不能安排到${dateKey}`,
      }
    }
    return { ok: false, message: `主播在${dateKey}不可用` }
  }
  return { ok: true }
}
