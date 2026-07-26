/**
 * 官方店铺体验分展示口径（与千帆店铺分页一致）
 *
 * get_shop_score → data.shop_score_dto.score（字符串，如 "4.5"）即页面「总分」
 * 禁止用分项均值/加权/内部精细值冒充总分
 */
export type OfficialScoreTrendStatus = 'up' | 'down' | 'flat'

export type OfficialScoreTrendLabel = '上升' | '下降' | '持平'

const FLAT_STATUS_RE = /无变化|持平|不变|unchanged|same|flat|stable/i
const UP_STATUS_RE = /上升|上涨|升高|提升|up|increase|升/i
const DOWN_STATUS_RE = /下降|下跌|降低|down|decrease|降/i

/** 官方页面展示精度：1 位小数 */
export function normalizeOfficialDisplayScore(
  value: number | null | undefined,
): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.round(value * 10) / 10
}

export function formatOfficialDisplayScore(
  value: number | null | undefined,
): string {
  const n = normalizeOfficialDisplayScore(value)
  if (n == null) return '—'
  return n.toFixed(1)
}

export function formatOfficialScoreDelta(
  displayDelta: number | null | undefined,
): string {
  if (displayDelta == null || !Number.isFinite(displayDelta)) return '—'
  if (displayDelta === 0) return ''
  const abs = Math.abs(displayDelta).toFixed(1)
  return displayDelta > 0 ? `+${abs}` : `-${abs}`
}

export function officialTrendLabel(
  status: OfficialScoreTrendStatus,
): OfficialScoreTrendLabel {
  if (status === 'up') return '上升'
  if (status === 'down') return '下降'
  return '持平'
}

/**
 * 从官方接口文案解析较前日状态；无法识别则返回 null（改走数值比较）
 */
export function parseOfficialCompareStatus(
  raw: string | null | undefined,
): OfficialScoreTrendStatus | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  if (FLAT_STATUS_RE.test(s)) return 'flat'
  if (UP_STATUS_RE.test(s)) return 'up'
  if (DOWN_STATUS_RE.test(s)) return 'down'
  return null
}

/**
 * 趋势与展示差值必须基于同一标准化口径。
 * 优先官方「较前日」状态；否则比较官方展示 1 位小数。
 * displayDelta===0 → 持平，禁止「上升 +0.0」
 */
export function resolveOfficialTrend(params: {
  current: number | null | undefined
  previous: number | null | undefined
  /** 官方接口较前日文案，如「无变化」 */
  officialCompareStatus?: string | null
}): {
  status: OfficialScoreTrendStatus
  displayDelta: number | null
  label: OfficialScoreTrendLabel
} {
  const fromOfficial = parseOfficialCompareStatus(params.officialCompareStatus)
  if (fromOfficial != null) {
    if (fromOfficial === 'flat') {
      return { status: 'flat', displayDelta: 0, label: '持平' }
    }
    // 官方上升/下降优先；展示差值仅用于旁注，为 0 时不显示 +0.0
    const cur = normalizeOfficialDisplayScore(params.current)
    const prev = normalizeOfficialDisplayScore(params.previous)
    let displayDelta: number | null = null
    if (cur != null && prev != null) {
      const d = Math.round((cur - prev) * 10) / 10
      displayDelta = d === 0 ? null : d
    }
    return {
      status: fromOfficial,
      displayDelta,
      label: officialTrendLabel(fromOfficial),
    }
  }

  const cur = normalizeOfficialDisplayScore(params.current)
  const prev = normalizeOfficialDisplayScore(params.previous)
  if (cur == null || prev == null) {
    return { status: 'flat', displayDelta: null, label: '持平' }
  }
  const displayDelta = Math.round((cur - prev) * 10) / 10
  if (displayDelta > 0) {
    return { status: 'up', displayDelta, label: '上升' }
  }
  if (displayDelta < 0) {
    return { status: 'down', displayDelta, label: '下降' }
  }
  return { status: 'flat', displayDelta: 0, label: '持平' }
}

/**
 * 日报综合分：仅官方总分；缺失则 null（前端显示 —），禁止分项均值兜底
 */
export function resolveOfficialOverallScore(
  official: number | null | undefined,
): number | null {
  if (official == null || !Number.isFinite(official)) return null
  return normalizeOfficialDisplayScore(official)
}
