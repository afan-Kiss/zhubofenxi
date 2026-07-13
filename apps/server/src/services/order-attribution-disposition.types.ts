/** 人工处置状态：pending 不落库 */
export type AttributionDispositionKind = 'pending' | 'anchor' | 'non_live'

export type NonLiveReasonCode =
  | 'offline_communication'
  | 'private_domain'
  | 'customer_service'
  | 'owner_sale'
  | 'other'

export const NON_LIVE_REASON_LABELS: Record<NonLiveReasonCode, string> = {
  offline_communication: '线下沟通成交',
  private_domain: '私域成交',
  customer_service: '客服成交',
  owner_sale: '老板/管理人员成交',
  other: '其他',
}

export const NON_LIVE_DISPLAY_NAME = '非直播成交'
export const PENDING_UNASSIGNED_DISPLAY_NAME = '未归属'

export const NON_LIVE_REASON_CODES = Object.keys(NON_LIVE_REASON_LABELS) as NonLiveReasonCode[]

export function isNonLiveReasonCode(value: string): value is NonLiveReasonCode {
  return (NON_LIVE_REASON_CODES as string[]).includes(value)
}

export function nonLiveReasonLabel(code: string | null | undefined, otherText?: string | null): string {
  const key = String(code ?? '').trim()
  if (key === 'other') {
    const text = String(otherText ?? '').trim()
    return text || NON_LIVE_REASON_LABELS.other
  }
  if (isNonLiveReasonCode(key)) return NON_LIVE_REASON_LABELS[key]
  return key || '非直播成交'
}

export interface OrderAttributionDispositionEntry {
  orderKey: string
  disposition: 'anchor' | 'non_live'
  anchorId: string | null
  anchorName: string | null
  nonLiveReason: NonLiveReasonCode | null
  nonLiveReasonText: string | null
  confirmedBy: string | null
  confirmedAt: Date | null
  confirmNote: string | null
}

export type DispositionLogAction =
  | 'assign_anchor'
  | 'mark_non_live'
  | 'update_non_live'
  | 'clear_to_pending'
  | 'migrate_manual_override'
