/**
 * 主播业务日生效区间：闭区间 [effectiveFrom, effectiveTo]
 * 离职日期 = effectiveTo = 最后一个允许出现的业务日；次日起不可用。
 */
export interface AnchorEffectiveInterval {
  effectiveFrom?: string | null
  effectiveTo?: string | null
  enabled?: boolean
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isBusinessDateKey(value: string | null | undefined): value is string {
  return Boolean(value && DATE_RE.test(value))
}

/**
 * 正式主播在指定业务日是否有效。
 * 不以当前 enabled 作为历史日期依据；仅看 effectiveFrom/effectiveTo。
 * - effectiveFrom 存在且 date < from → 不可用
 * - effectiveTo 存在且 date > to → 不可用（to 当天仍可用）
 */
export function isAnchorEffectiveOnDate(
  anchor: AnchorEffectiveInterval | null | undefined,
  dateKey: string,
): boolean {
  if (!anchor || !isBusinessDateKey(dateKey)) return false
  const from = anchor.effectiveFrom?.trim() || null
  const to = anchor.effectiveTo?.trim() || null
  if (from && isBusinessDateKey(from) && dateKey < from) return false
  if (to && isBusinessDateKey(to) && dateKey > to) return false
  return true
}

/** 已停用且缺少离职日期：未来排班禁止，需人工补录 */
export function isOffboardDateMissing(anchor: {
  enabled?: boolean
  effectiveTo?: string | null
}): boolean {
  return anchor.enabled === false && !anchor.effectiveTo?.trim()
}

export function assertValidOffboardDate(params: {
  effectiveTo: string
  effectiveFrom?: string | null
}): string {
  const to = params.effectiveTo.trim()
  if (!isBusinessDateKey(to)) {
    throw new Error('离职日期格式须为 YYYY-MM-DD')
  }
  const from = params.effectiveFrom?.trim() || null
  if (from && isBusinessDateKey(from) && to < from) {
    throw new Error(`离职日期不得早于上岗日期（${from}）`)
  }
  return to
}

/** Asia/Shanghai 今日 / 昨日业务日 */
export function shanghaiTodayDateKey(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

export function shanghaiYesterdayDateKey(now = new Date()): string {
  const today = shanghaiTodayDateKey(now)
  const [y, m, d] = today.split('-').map(Number)
  const utc = Date.UTC(y!, m! - 1, d!) - 24 * 60 * 60 * 1000
  return new Date(utc).toISOString().slice(0, 10)
}

/** 临时主播仅允许创建到今天或昨天 */
export function assertTemporaryAnchorDateAllowed(scheduleDate: string, now = new Date()): void {
  if (!isBusinessDateKey(scheduleDate)) {
    throw new Error('排班日期格式须为 YYYY-MM-DD')
  }
  const today = shanghaiTodayDateKey(now)
  const yesterday = shanghaiYesterdayDateKey(now)
  if (scheduleDate !== today && scheduleDate !== yesterday) {
    throw new Error('临时主播只能录入今天或昨天的试播排班')
  }
}

export function isTemporaryAnchorDateAllowed(scheduleDate: string, now = new Date()): boolean {
  try {
    assertTemporaryAnchorDateAllowed(scheduleDate, now)
    return true
  } catch {
    return false
  }
}

export function buildTemporaryAnchorKey(scheduleDate: string, uuid: string): string {
  return `temp:${scheduleDate}:${uuid}`
}
