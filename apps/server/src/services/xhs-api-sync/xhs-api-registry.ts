import type { XhsApiDefinition, XhsApiKey } from './xhs-api-types'

/** 接口配置仅在后端维护，勿暴露给前端 */
export const XHS_API_REGISTRY: Record<XhsApiKey, XhsApiDefinition> = {
  order_list: {
    key: 'order_list',
    name: '订单列表',
    method: 'POST',
    url: 'https://ark.xiaohongshu.com/api/edith/fulfillment/order/page',
    referer: 'https://ark.xiaohongshu.com/app-order/order/query',
    enabled: true,
    needSign: true,
    pageMode: 'page_no',
    pageSize: 50,
  },
  order_detail: {
    key: 'order_detail',
    name: '订单详情',
    method: 'POST',
    url: 'https://ark.xiaohongshu.com/api/edith/fulfillment/order/detail',
    referer: 'https://ark.xiaohongshu.com/app-order/order/query',
    enabled: true,
    needSign: true,
    pageMode: 'none',
    pageSize: 1,
  },
  live_session_list: {
    key: 'live_session_list',
    name: '直播场次列表',
    method: 'POST',
    url: 'https://ark.xiaohongshu.com/api/edith/butterfly/data?type=sellerLiveDetailData',
    referer: 'https://ark.xiaohongshu.com/app-datacenter/live',
    enabled: true,
    needSign: true,
    pageMode: 'page',
    pageSize: 10,
  },
  live_overview: {
    key: 'live_overview',
    name: '直播回放概览',
    method: 'GET',
    url: 'https://ark.xiaohongshu.com/api/edith/live/replay/overview',
    referer: 'https://ark.xiaohongshu.com/app-datacenter/live',
    enabled: true,
    needSign: true,
    pageMode: 'none',
    pageSize: 1,
  },
  live_traffic_core: {
    key: 'live_traffic_core',
    name: '直播流量核心指标',
    method: 'GET',
    url: 'https://ark.xiaohongshu.com/api/edith/live/replay/traffic/core',
    referer: 'https://ark.xiaohongshu.com/app-datacenter/live',
    enabled: true,
    needSign: true,
    pageMode: 'none',
    pageSize: 1,
  },
  live_realtime_metric: {
    key: 'live_realtime_metric',
    name: '直播大屏实时指标',
    method: 'POST',
    url: 'https://ark.xiaohongshu.com/api/edith/ecomlivedata/realtime/metric',
    referer: 'https://ark.xiaohongshu.com/live_screen/operation',
    enabled: true,
    needSign: true,
    pageMode: 'none',
    pageSize: 1,
  },
  pending_settlement_list: {
    key: 'pending_settlement_list',
    name: '待结算列表',
    method: 'POST',
    url: 'https://ark.xiaohongshu.com/api/edith/settlebill/query_settle_bill_list',
    referer: 'https://ark.xiaohongshu.com/',
    enabled: true,
    needSign: true,
    pageMode: 'pageNum',
    pageSize: 20,
  },
  settled_settlement_list: {
    key: 'settled_settlement_list',
    name: '已结算列表',
    method: 'POST',
    url: 'https://ark.xiaohongshu.com/api/edith/settlebill/query_settle_bill_list',
    referer: 'https://ark.xiaohongshu.com/',
    enabled: true,
    needSign: true,
    pageMode: 'pageNum',
    pageSize: 20,
  },
  settlement_detail: {
    key: 'settlement_detail',
    name: '结算详情',
    method: 'POST',
    url: 'https://ark.xiaohongshu.com/api/edith/settlebill/query_settle_bill_detail',
    referer: 'https://ark.xiaohongshu.com/',
    enabled: true,
    needSign: true,
    pageMode: 'none',
    pageSize: 1,
  },
}

export function getApiDefinition(key: XhsApiKey): XhsApiDefinition {
  return XHS_API_REGISTRY[key]
}

export function isApiConfigured(key: XhsApiKey): boolean {
  const def = XHS_API_REGISTRY[key]
  return def.enabled && def.url.trim().length > 0
}

export function hasAnyEnabledApi(): boolean {
  return Object.values(XHS_API_REGISTRY).some((d) => isApiConfigured(d.key))
}

export function listConfiguredApiKeys(): XhsApiKey[] {
  return (Object.keys(XHS_API_REGISTRY) as XhsApiKey[]).filter(isApiConfigured)
}
