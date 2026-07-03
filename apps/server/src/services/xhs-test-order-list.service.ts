import { getDecryptedCookie } from './credential.service'
import { requestXhsJsonWithSyncAudit } from './sync-request-audit.service'
import { type XhsRequestAuditContext } from './xhs-http.service'

const ORDER_LIST_URL =
  'https://ark.xiaohongshu.com/api/edith/fulfillment/order/page'

const ORDER_LIST_REFERER =
  'https://ark.xiaohongshu.com/app-order/order/query'

const ORDER_LIST_BODY = {
  page_no: 1,
  page_size: 50,
  multi_search_field: '',
  order_tag_list: [],
  order_type_list: [],
  promise_ship_time_type_list: [],
  after_sale_status_list: [],
  seller_mark_priority_list: [],
  seller_mark_note_status_list: [],
  status: [],
  time_range_list: [
    {
      time_type: 3,
      start_time: 1779552000000,
      end_time: 1779724799999,
    },
  ],
  overdue_status: -2,
  sort_by: {
    sort_field: 'ordered_at',
    desc: true,
  },
  need_declare_info: true,
  need_declare_times: true,
  allow_es_fallback: true,
} as const

export interface XhsOrderListTestResult {
  success: boolean
  code: number | string | null
  msg: string | null
  total: number | null
  itemCount: number
  firstOrderId: string | null
  firstPackageId: string | null
}

type XhsEnvelope = {
  code?: number | string
  success?: boolean
  msg?: string
  message?: string
  data?: unknown
}

function extractList(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') return []
  const root = payload as Record<string, unknown>
  const inner =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : root
  const list = inner.list ?? inner.records ?? inner.items ?? inner.packages
  if (!Array.isArray(list)) return []
  return list.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object')
}

function extractTotal(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  const inner =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : root
  const total = inner.total ?? inner.totalCount ?? inner.total_count
  return typeof total === 'number' ? total : null
}

function pickId(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key]
    if (value != null && String(value).trim()) return String(value)
  }
  return null
}

function toSanitizedResult(payload: XhsEnvelope): XhsOrderListTestResult {
  const list = extractList(payload)
  const first = list[0]
  const code = payload.code ?? null
  const success =
    payload.success === true ||
    code === 0 ||
    code === '0' ||
    (payload.success !== false && list.length > 0)

  return {
    success,
    code,
    msg: payload.msg ?? payload.message ?? null,
    total: extractTotal(payload),
    itemCount: list.length,
    firstOrderId: first
      ? pickId(first, ['orderId', 'order_id', 'orderNo', 'order_no'])
      : null,
    firstPackageId: first
      ? pickId(first, ['packageId', 'package_id', 'packageNo', 'package_no'])
      : null,
  }
}

export async function fetchXhsOrderListTest(
  audit?: XhsRequestAuditContext,
): Promise<XhsOrderListTestResult> {
  const cookie = await getDecryptedCookie()

  try {
    const payload = await requestXhsJsonWithSyncAudit<XhsEnvelope>({
      apiName: 'order_list_test',
      method: 'POST',
      urlKey: ORDER_LIST_URL,
      trigger: 'manual',
      options: {
        method: 'POST',
        url: ORDER_LIST_URL,
        body: ORDER_LIST_BODY,
        cookie,
        referer: ORDER_LIST_REFERER,
        needSign: true,
        parseEnvelope: false,
        audit: audit ? { ...audit, module: 'xhs_export' } : undefined,
      },
    })
    return toSanitizedResult(payload)
  } catch (err) {
    const message = err instanceof Error ? err.message : '请求失败'
    return {
      success: false,
      code: null,
      msg: message,
      total: null,
      itemCount: 0,
      firstOrderId: null,
      firstPackageId: null,
    }
  }
}
