import { getTimeMinutes } from './time'

/** 默认时间规则：06:00-14:59 子杰，15:00-23:59 飞云 */
export function assignAnchorByDefaultTimeRule(date: Date | null): string {
  if (!date) return '未归属'
  const minutes = getTimeMinutes(date)
  if (minutes >= 360 && minutes < 900) return '子杰'
  if (minutes >= 900 || minutes < 360) return '飞云'
  return '未归属'
}

export const DEFAULT_ANCHOR_RULE_HINT =
  '当前使用默认时间规则归属主播（06:00-14:59 子杰，15:00-23:59 飞云），后续可在时间规则中自定义。'
