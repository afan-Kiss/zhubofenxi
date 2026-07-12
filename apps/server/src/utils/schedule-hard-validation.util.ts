/**
 * 排班保存/确认硬校验：模板偏离、疑似互换、跨店同主播等
 */
import {
  NEW_SCHEDULE_TEMPLATE_SEEDS_20260701,
  type ScheduleTemplateSeed,
} from '../services/anchor-schedule-template.service'
import {
  buildScheduleBounds,
  detectScheduleConflicts,
  type ScheduleConflict,
} from './anchor-schedule-time.util'

export type ScheduleHardConflictType =
  | ScheduleConflict['type']
  | 'template_swap'
  | 'cross_shop_overlap_needs_reason'
  | 'confirmed_conflict'

export interface ScheduleHardConflict {
  type: ScheduleHardConflictType
  message: string
}

export interface ScheduleDraftRow {
  anchorName: string
  shopName: string
  liveRoomName: string
  startTime: string
  endTime: string
  enabled?: boolean
  note?: string | null
}

function templatesForDate(dateKey: string): ScheduleTemplateSeed[] {
  return NEW_SCHEDULE_TEMPLATE_SEEDS_20260701.filter((t) => {
    if (t.effectiveFrom && dateKey < t.effectiveFrom) return false
    if (t.effectiveTo && dateKey > t.effectiveTo) return false
    return true
  })
}

function normalizeShop(name: string): string {
  return name.trim().replace(/\s+/g, '')
}

/** 按直播号找模板主播：优先精确时段，否则取同店任意模板行 */
function templateAnchorForRow(
  dateKey: string,
  row: ScheduleDraftRow,
): ScheduleTemplateSeed | null {
  const templates = templatesForDate(dateKey)
  const shop = normalizeShop(row.shopName)
  const exact = templates.find(
    (t) =>
      normalizeShop(t.shopName) === shop &&
      t.startTime === row.startTime.trim() &&
      t.endTime === row.endTime.trim(),
  )
  if (exact) return exact
  const byStart = templates.find(
    (t) => normalizeShop(t.shopName) === shop && t.startTime === row.startTime.trim(),
  )
  if (byStart) return byStart
  return templates.find((t) => normalizeShop(t.shopName) === shop) ?? null
}

/** 两直播号主播互换：A 店当前 = B 模板，B 店当前 = A 模板 */
export function detectTemplateAnchorSwap(
  dateKey: string,
  rows: ScheduleDraftRow[],
): ScheduleHardConflict | null {
  const enabled = rows.filter((r) => r.enabled !== false)
  const templates = templatesForDate(dateKey)
  if (templates.length < 2) return null

  const currentByShopSlot = new Map<string, string>()
  for (const r of enabled) {
    const key = `${normalizeShop(r.shopName)}|${r.startTime.trim()}`
    currentByShopSlot.set(key, r.anchorName.trim())
  }

  for (let i = 0; i < templates.length; i++) {
    for (let j = i + 1; j < templates.length; j++) {
      const a = templates[i]!
      const b = templates[j]!
      if (normalizeShop(a.shopName) === normalizeShop(b.shopName)) continue
      const keyA = `${normalizeShop(a.shopName)}|${a.startTime}`
      const keyB = `${normalizeShop(b.shopName)}|${b.startTime}`
      const curA = currentByShopSlot.get(keyA)
      const curB = currentByShopSlot.get(keyB)
      if (!curA || !curB) continue
      if (curA === b.anchorName && curB === a.anchorName && curA !== a.anchorName) {
        return {
          type: 'template_swap',
          message: `疑似直播号主播互换：${a.shopName} 应为${a.anchorName}实际为${curA}；${b.shopName} 应为${b.anchorName}实际为${curB}。禁止直接确认，请按直播号核对后修正。`,
        }
      }
    }
  }

  // 宽松：仅按直播号（忽略时段差几分钟）对比模板主播集合是否整体对调
  const tplByShop = new Map<string, string>()
  for (const t of templates) {
    tplByShop.set(normalizeShop(t.shopName), t.anchorName)
  }
  const curByShop = new Map<string, string[]>()
  for (const r of enabled) {
    const shop = normalizeShop(r.shopName)
    if (!curByShop.has(shop)) curByShop.set(shop, [])
    curByShop.get(shop)!.push(r.anchorName.trim())
  }
  const shops = [...tplByShop.keys()]
  for (let i = 0; i < shops.length; i++) {
    for (let j = i + 1; j < shops.length; j++) {
      const sa = shops[i]!
      const sb = shops[j]!
      const ta = tplByShop.get(sa)!
      const tb = tplByShop.get(sb)!
      const ca = curByShop.get(sa) ?? []
      const cb = curByShop.get(sb) ?? []
      if (ca.includes(tb) && cb.includes(ta) && !ca.includes(ta) && !cb.includes(tb)) {
        return {
          type: 'template_swap',
          message: `疑似直播号主播互换：${sa} 出现了模板给 ${sb} 的主播「${tb}」，${sb} 出现了模板给 ${sa} 的主播「${ta}」。禁止直接确认。`,
        }
      }
    }
  }

  return null
}

export function buildTemplateDeviationWarnings(
  dateKey: string,
  rows: ScheduleDraftRow[],
): string[] {
  const warnings: string[] = []
  for (const r of rows.filter((x) => x.enabled !== false)) {
    const tpl = templateAnchorForRow(dateKey, r)
    if (!tpl) continue
    if (tpl.anchorName.trim() === r.anchorName.trim()) continue
    warnings.push(
      `${r.shopName} ${r.startTime}–${r.endTime} 模板为「${tpl.anchorName}」，当前为「${r.anchorName.trim()}」`,
    )
  }
  return warnings
}

export function buildConfirmPreviewLines(rows: ScheduleDraftRow[]): string[] {
  return rows
    .filter((r) => r.enabled !== false)
    .map(
      (r) =>
        `${r.shopName.trim() || r.liveRoomName.trim()} ${r.startTime.trim()}–${r.endTime.trim()} → ${r.anchorName.trim()}`,
    )
}

export function validateScheduleHardRules(params: {
  date: string
  schedules: ScheduleDraftRow[]
  allowCrossShopOverlap?: boolean
  changeReason?: string
  forConfirm?: boolean
}): {
  ok: boolean
  conflicts: ScheduleHardConflict[]
  warnings: string[]
  confirmPreviewLines: string[]
} {
  const enabled = params.schedules.filter((r) => r.enabled !== false)
  const conflicts: ScheduleHardConflict[] = []
  const warnings: string[] = []

  const intervals = enabled.map((r) => {
    const { startAt, endAt } = buildScheduleBounds(params.date, r.startTime, r.endTime)
    return {
      anchorName: r.anchorName.trim(),
      shopName: r.shopName.trim(),
      liveRoomName: r.liveRoomName.trim(),
      startAt,
      endAt,
    }
  })

  conflicts.push(...detectScheduleConflicts(intervals))

  const crossShop = conflicts.filter((c) => c.type === 'anchor_overlap')
  if (crossShop.length > 0) {
    const reason = params.changeReason?.trim() ?? ''
    if (!params.allowCrossShopOverlap || !reason) {
      conflicts.push({
        type: 'cross_shop_overlap_needs_reason',
        message:
          '同一主播同一时段不能跨两个直播号。如确需临时安排，请勾选允许并填写原因。',
      })
    } else {
      // allow: remove blocking anchor_overlap only when explicitly allowed
      for (let i = conflicts.length - 1; i >= 0; i--) {
        if (conflicts[i]?.type === 'anchor_overlap') conflicts.splice(i, 1)
      }
      warnings.push(`已允许同主播跨直播号：${reason}`)
    }
  }

  warnings.push(...buildTemplateDeviationWarnings(params.date, params.schedules))

  const swap = detectTemplateAnchorSwap(params.date, params.schedules)
  if (swap) {
    if (params.forConfirm) {
      conflicts.push(swap)
    } else {
      warnings.push(swap.message)
    }
  }

  const confirmPreviewLines = buildConfirmPreviewLines(params.schedules)

  return {
    ok: conflicts.length === 0,
    conflicts,
    warnings,
    confirmPreviewLines,
  }
}
