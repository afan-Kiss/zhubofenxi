/** 2026-06-13 起：日报 / 主播业绩按「直播号 + 早晚场」固定归属 */
export const SHOP_SESSION_ANCHOR_CUTOFF_MS = Date.parse('2026-06-13T00:00:00+08:00')

export {
  XIAOBAI_ANCHOR_CUTOFF_MS,
  XIAOBAI_SLOT_START_MINUTES,
  XIAOBAI_SLOT_END_MINUTES,
  isInXiaoBaiOrderSlot,
  isXiaoBaiAttributionActive,
} from './anchor-xiaobai-slot.util'
