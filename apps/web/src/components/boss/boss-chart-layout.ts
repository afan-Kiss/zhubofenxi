/** 老板看板 Recharts 共用布局（收紧左侧留白，绘图区居中） */

import { useEffect, useState } from 'react'

export const BOSS_LINE_CHART_MARGIN_WIDE = {
  top: 28,
  right: 6,
  left: -18,
  bottom: 2,
} as const

export const BOSS_LINE_CHART_MARGIN_NARROW = {
  top: 28,
  right: 6,
  left: -4,
  bottom: 2,
} as const

export const BOSS_LINE_CHART_MARGIN = BOSS_LINE_CHART_MARGIN_WIDE

export const BOSS_SPARKLINE_MARGIN_WIDE = {
  top: 2,
  right: 0,
  left: -12,
  bottom: 2,
} as const

export const BOSS_SPARKLINE_MARGIN_NARROW = {
  top: 2,
  right: 0,
  left: 0,
  bottom: 2,
} as const

export const BOSS_SPARKLINE_MARGIN = BOSS_SPARKLINE_MARGIN_WIDE

export const BOSS_CHART_LEGEND_STYLE = {
  fontSize: 11,
  paddingBottom: 2,
  lineHeight: '14px',
} as const

export const BOSS_MONEY_Y_AXIS_WIDTH_WIDE = 40
export const BOSS_MONEY_Y_AXIS_WIDTH_NARROW = 34
export const BOSS_MONEY_Y_AXIS_WIDTH = BOSS_MONEY_Y_AXIS_WIDTH_WIDE

export const BOSS_SCORE_Y_AXIS_WIDTH_WIDE = 18
export const BOSS_SCORE_Y_AXIS_WIDTH_NARROW = 24
export const BOSS_SCORE_Y_AXIS_WIDTH = BOSS_SCORE_Y_AXIS_WIDTH_WIDE

const MOBILE_MAX_WIDTH = 640

/** 手机端放宽左侧 margin，避免 Y 轴刻度被裁切 */
export function useBossChartCompact(): boolean {
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches : false,
  )

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`)
    const onChange = () => setCompact(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return compact
}

export function bossLineChartMargin(compact: boolean) {
  return compact ? BOSS_LINE_CHART_MARGIN_NARROW : BOSS_LINE_CHART_MARGIN_WIDE
}

export function bossSparklineMargin(compact: boolean) {
  return compact ? BOSS_SPARKLINE_MARGIN_NARROW : BOSS_SPARKLINE_MARGIN_WIDE
}

export function bossMoneyYAxisWidth(compact: boolean) {
  return compact ? BOSS_MONEY_Y_AXIS_WIDTH_NARROW : BOSS_MONEY_Y_AXIS_WIDTH_WIDE
}

export function bossScoreYAxisWidth(compact: boolean) {
  return compact ? BOSS_SCORE_Y_AXIS_WIDTH_NARROW : BOSS_SCORE_Y_AXIS_WIDTH_WIDE
}

/** Y 轴刻度：轴上省略 ¥，Tooltip 仍展示完整金额 */
export function formatBossMoneyAxisTick(yuan: number): string {
  const n = Math.round(yuan)
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}
