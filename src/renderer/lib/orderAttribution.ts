import type { Anchor, AnchorConfig, LiveSession, OrderAttribution } from '../types/anchor'
import type { StandardOrder } from '../types/order'
import { findAnchorById, findAnchorByName, matchTimeRule } from './anchorRules'
import { findBestLiveSession } from './liveSessionMatcher'

const UNASSIGNED_ID = ''
const UNASSIGNED_NAME = '未归属'

export interface EphemeralAnchor {
  id: string
  name: string
  color: string
}

function createEphemeralAnchor(name: string): EphemeralAnchor {
  const slug = name.trim().toLowerCase().replace(/\s+/g, '-')
  return {
    id: `ephemeral-${slug}-${Date.now()}`,
    name: name.trim(),
    color: '#94a3b8',
  }
}

function resolveAnchorFromSession(
  session: LiveSession,
  config: AnchorConfig,
  ephemeralAnchors: Map<string, EphemeralAnchor>,
  warnings: string[],
): { anchorId: string; anchorName: string } | null {
  if (session.anchorId) {
    const a = findAnchorById(config, session.anchorId)
    if (a?.enabled) return { anchorId: a.id, anchorName: a.name }
  }
  if (session.anchorName) {
    const found = findAnchorByName(config, session.anchorName)
    if (found?.enabled) return { anchorId: found.id, anchorName: found.name }

    const key = session.anchorName.trim().toLowerCase()
    let ep = [...ephemeralAnchors.values()].find((e) => e.name.toLowerCase() === key)
    if (!ep) {
      ep = createEphemeralAnchor(session.anchorName)
      ephemeralAnchors.set(ep.id, ep)
      warnings.push(`已临时纳入未知主播「${session.anchorName}」，可在主播规则设置中确认`)
    }
    return { anchorId: ep.id, anchorName: ep.name }
  }
  return null
}

export function attributeOrder(
  order: StandardOrder,
  sessions: LiveSession[],
  config: AnchorConfig,
  ephemeralAnchors: Map<string, EphemeralAnchor>,
  warnings: string[],
): OrderAttribution {
  if (order.errors.length > 0 || !order.orderId) {
    return {
      anchorId: UNASSIGNED_ID,
      anchorName: UNASSIGNED_NAME,
      attributionType: 'abnormal',
      attributionWarning: order.errors.join('；') || '订单数据异常',
    }
  }

  const session = findBestLiveSession(order.orderTime, sessions)
  if (session) {
    if (session.anchorId || session.anchorName) {
      const resolved = resolveAnchorFromSession(session, config, ephemeralAnchors, warnings)
      if (resolved) {
        return {
          anchorId: resolved.anchorId,
          anchorName: resolved.anchorName,
          attributionType: 'live_anchor_field',
          matchedLiveSessionId: session.id,
          matchedLiveStartTime: session.startTimeText,
          matchedLiveEndTime: session.endTimeText,
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

    return {
      anchorId: UNASSIGNED_ID,
      anchorName: UNASSIGNED_NAME,
      attributionType: 'unassigned',
      matchedLiveSessionId: session.id,
      matchedLiveStartTime: session.startTimeText,
      matchedLiveEndTime: session.endTimeText,
      attributionWarning: '已匹配直播场次，但无法确定主播',
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

  return {
    anchorId: UNASSIGNED_ID,
    anchorName: UNASSIGNED_NAME,
    attributionType: 'unassigned',
    attributionWarning: '未匹配直播场次且未命中时间规则',
  }
}

export function attributeOrders(
  orders: StandardOrder[],
  sessions: LiveSession[],
  config: AnchorConfig,
): { attributions: Map<number, OrderAttribution>; warnings: string[] } {
  const warnings: string[] = []
  const ephemeralAnchors = new Map<string, EphemeralAnchor>()
  const attributions = new Map<number, OrderAttribution>()

  for (const order of orders) {
    attributions.set(
      order.sourceRowIndex,
      attributeOrder(order, sessions, config, ephemeralAnchors, warnings),
    )
  }

  return { attributions, warnings: [...new Set(warnings)] }
}

export function getAttributionTypeLabel(type: OrderAttribution['attributionType']): string {
  switch (type) {
    case 'live_anchor_field':
      return '直播场次-主播字段'
    case 'live_time_rule':
      return '直播场次-时间推断'
    case 'time_rule':
      return '时间规则'
    case 'unassigned':
      return '未归属'
    case 'abnormal':
      return '异常订单'
    default:
      return type
  }
}

export function mergeAnchorsForDisplay(
  config: AnchorConfig,
  ephemeralNames: Set<string>,
): Anchor[] {
  const list = config.anchors.filter((a) => a.enabled)
  const names = new Set(list.map((a) => a.name.toLowerCase()))
  for (const name of ephemeralNames) {
    if (!names.has(name.toLowerCase())) {
      list.push({
        id: `ephemeral-display-${name}`,
        name,
        color: '#94a3b8',
        enabled: true,
        createdAt: new Date().toISOString(),
      })
    }
  }
  return list
}
