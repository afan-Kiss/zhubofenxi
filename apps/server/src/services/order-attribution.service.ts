import type {
  AnchorConfig,
  LiveSession,
  NormalizedOrder,
  OrderAttribution,
} from '../types/analysis'
import { isShopOrInvalidAnchorLabel, mapLiveNickToKnownAnchor } from '../utils/anchor-label'
import { resolveAnchorFromOrderFields } from './anchor-attribution.util'
import { findAnchorByName, matchTimeRule } from './anchor-rules.service'
import { findBestLiveSession } from './live-session.service'

const UNASSIGNED = { anchorId: '', anchorName: '未归属' }

function findSessionForOrder(
  order: NormalizedOrder,
  sessions: LiveSession[],
): LiveSession | null {
  const liveId = order.orderLiveId?.trim()
  if (liveId) {
    const byLiveId = sessions.find(
      (s) => s.id === liveId || String((s.raw as Record<string, unknown>)?.liveId ?? '') === liveId,
    )
    if (byLiveId) return byLiveId
  }
  return findBestLiveSession(order.orderTime, sessions)
}

export function attributeOrder(
  order: NormalizedOrder,
  sessions: LiveSession[],
  config: AnchorConfig,
): OrderAttribution {
  if (!order.orderId || order.errors.length > 0) {
    return {
      ...UNASSIGNED,
      attributionType: 'abnormal',
      attributionWarning: order.errors.join('；') || '订单数据异常',
    }
  }

  const fromOrder = resolveAnchorFromOrderFields(order, config)
  if (fromOrder) {
    return {
      ...fromOrder,
      attributionType: 'order_anchor_field',
    }
  }

  // 经营看板口径：以支付时间命中主播时间段配置（优先于直播场次推断）
  const payTime = order.paymentTime ?? order.orderTime
  const payTimeRule = matchTimeRule(payTime, config)
  if (payTimeRule) {
    return {
      anchorId: payTimeRule.anchor.id,
      anchorName: payTimeRule.anchor.name,
      attributionType: 'time_rule',
      matchedRuleId: payTimeRule.rule.id,
      matchedRuleName: payTimeRule.rule.name,
    }
  }

  const session = findSessionForOrder(order, sessions)
  if (session) {
    if (session.anchorId || session.anchorName) {
      if (session.anchorId) {
        const anchor = config.anchors.find((a) => a.id === session.anchorId)
        if (anchor) {
          return {
            anchorId: anchor.id,
            anchorName: anchor.name,
            attributionType: 'live_anchor_field',
            matchedLiveSessionId: session.id,
            matchedLiveStartTime: session.startTimeText,
            matchedLiveEndTime: session.endTimeText,
          }
        }
      }
      if (session.anchorName) {
        const trimmed = session.anchorName.trim()
        if (!isShopOrInvalidAnchorLabel(trimmed)) {
          const mapped = mapLiveNickToKnownAnchor(trimmed)
          const lookupName = mapped ?? trimmed
          const found = findAnchorByName(config, lookupName)
          if (found) {
            return {
              anchorId: found.id,
              anchorName: found.name,
              attributionType: 'live_anchor_field',
              matchedLiveSessionId: session.id,
              matchedLiveStartTime: session.startTimeText,
              matchedLiveEndTime: session.endTimeText,
            }
          }
        }
      }
    }

    const inferred = matchTimeRule(session.startTime, config)
    if (inferred) {
      return {
        anchorId: inferred.anchor.id,
        anchorName: inferred.anchor.name,
        attributionType: 'live_time_rule',
        matchedRuleId: inferred.rule.id,
        matchedRuleName: inferred.rule.name,
        matchedLiveSessionId: session.id,
        matchedLiveStartTime: session.startTimeText,
        matchedLiveEndTime: session.endTimeText,
      }
    }
  }

  const ruleMatch = matchTimeRule(order.orderTime, config)
  if (ruleMatch) {
    return {
      anchorId: ruleMatch.anchor.id,
      anchorName: ruleMatch.anchor.name,
      attributionType: 'time_rule',
      matchedRuleId: ruleMatch.rule.id,
      matchedRuleName: ruleMatch.rule.name,
    }
  }

  return { ...UNASSIGNED, attributionType: 'unassigned' }
}

export function attributeOrders(
  orders: NormalizedOrder[],
  sessions: LiveSession[],
  config: AnchorConfig,
): Map<number, OrderAttribution> {
  const map = new Map<number, OrderAttribution>()
  for (const order of orders) {
    map.set(order.sourceRowIndex, attributeOrder(order, sessions, config))
  }
  return map
}
