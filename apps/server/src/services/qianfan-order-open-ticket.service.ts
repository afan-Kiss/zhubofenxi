/**
 * 千帆订单详情：后端短票据换票，前端不接触 Cookie。
 * 思路参考 saomaqiang 查退货「千帆详情」与 arkSsoTicketService。
 */
import { prisma } from '../lib/prisma'
import { signXhsRequest } from './xhs-sign.service'
import { listEnabledLiveAccountsWithCookie, getDecryptedCookieByAccountId } from './live-account.service'
import { resolveLiveAccountCookie } from './qianfan-cookie-resolver.service'
import { resolveCanonicalShopName } from '../config/qianfan-shops.constants'
import {
  getGoodReviewShopName,
  resolveGoodReviewShopKey,
  type GoodReviewShopKey,
} from '../config/good-review-shops.constants'
import { logWarn } from '../utils/server-log'

const SERVICE_TICKET_URL = 'https://customer.xiaohongshu.com/api/cas/customer/web/service-ticket'
const ARK_ROOT = 'https://ark.xiaohongshu.com'
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const TICKET_TTL_MS = 60_000

type TicketEntry = {
  redirectUrl: string
  createdAt: number
  used: boolean
}

const ticketStore = new Map<string, TicketEntry>()

function parseCookieMap(cookie: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of cookie.split(';')) {
    const idx = part.indexOf('=')
    if (idx <= 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) out[k] = v
  }
  return out
}

function extractAuthorizationFromCookie(cookie: string): string {
  const m = parseCookieMap(cookie)
  for (const [key, val] of Object.entries(m)) {
    if (!key.includes('access-token-ark') || key.includes('beta')) continue
    const v = String(val || '').trim()
    if (v.startsWith('customer.ark.')) return v.slice('customer.ark.'.length)
    if (v) return v
  }
  return ''
}

export function normalizePackageId(packageId: string): string {
  const raw = String(packageId || '').trim()
  if (!raw) return ''
  return raw.startsWith('P') ? raw : `P${raw}`
}

export function buildDetailServiceUrl(packageId: string): string {
  const pkg = normalizePackageId(packageId)
  if (!pkg) return ''
  return `${ARK_ROOT}/app-order/order/detail/${encodeURIComponent(pkg)}`
}

function getOrderDetailUrlTemplate(): string | null {
  const tpl = process.env.QIANFAN_ORDER_DETAIL_URL_TEMPLATE?.trim()
  return tpl || null
}

function buildConfiguredDetailUrl(orderId: string): string | null {
  const tpl = getOrderDetailUrlTemplate()
  if (!tpl) return null
  return tpl
    .replace(/\{orderId\}/g, encodeURIComponent(orderId))
    .replace(/\{packageId\}/g, encodeURIComponent(normalizePackageId(orderId)))
}

function extractTicketFromResponse(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const obj = data as Record<string, unknown>
  const nested = obj.data as Record<string, unknown> | undefined
  const direct = nested?.ticket ?? obj.ticket ?? nested?.st ?? ''
  const s = String(direct || '').trim()
  return s.startsWith('ST-') ? s : ''
}

async function postServiceTicket(
  cookie: string,
  body: Record<string, unknown>,
  opts: { origin?: string; referer?: string; authorization?: string } = {},
): Promise<string> {
  const signed = await signXhsRequest({
    method: 'POST',
    url: SERVICE_TICKET_URL,
    body,
    cookie,
    logContext: { tag: 'xhs-sign' },
  })
  const headers: Record<string, string> = {
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json;charset=UTF-8',
    origin: opts.origin || 'https://customer.xiaohongshu.com',
    referer: opts.referer || 'https://customer.xiaohongshu.com/',
    'user-agent': DEFAULT_UA,
    cookie,
    'x-s': signed['x-s'],
    'x-t': signed['x-t'],
    'x-s-common': signed['x-s-common'],
  }
  if (opts.authorization || signed.authorization) {
    headers.authorization = opts.authorization || signed.authorization
  }

  const res = await fetch(SERVICE_TICKET_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  })
  const text = await res.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return ''
  }
  if (!res.ok) return ''
  return extractTicketFromResponse(data)
}

async function fetchTicketWithCookie(cookie: string, serviceUrl: string): Promise<string> {
  const enc = encodeURIComponent(serviceUrl)
  const sid = String(parseCookieMap(cookie)['customer-sso-sid'] || '').trim()
  const bodies: Record<string, unknown>[] = [
    { service: ARK_ROOT, type: 'at' },
    { service: enc, type: 'at', sid, source: '' },
    { service: enc, type: 'st', sid, source: '' },
    { service: enc, type: 'sso', sid, source: '' },
  ]
  const auth = extractAuthorizationFromCookie(cookie)
  const headerVariants = [
    {},
    {
      origin: 'https://ark.xiaohongshu.com',
      referer: 'https://ark.xiaohongshu.com/app-order/order/query',
      authorization: auth,
    },
  ]
  for (const hv of headerVariants) {
    for (const body of bodies) {
      if (body.type !== 'at' && !sid) continue
      try {
        const ticket = await postServiceTicket(cookie, body, hv)
        if (ticket) return ticket
      } catch (err) {
        logWarn('千帆详情', `换票失败：${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
  return ''
}

function buildArkUrlWithTicket(serviceUrl: string, ticket: string): string {
  const u = new URL(serviceUrl)
  u.searchParams.set('ticket', ticket)
  return u.toString()
}

async function resolveCookieForOrder(orderNo: string): Promise<{
  cookie: string | null
  packageId: string
}> {
  const normalized = normalizePackageId(orderNo)
  const row = await prisma.xhsRawOrder.findFirst({
    where: {
      OR: [{ packageId: normalized }, { packageId: orderNo }, { orderId: orderNo }],
    },
    orderBy: { orderTime: 'desc' },
  })
  if (!row) {
    return { cookie: null, packageId: normalized || orderNo }
  }
  const accounts = await listEnabledLiveAccountsWithCookie()
  const account =
    accounts.find((a) => a.id === row.liveAccountId) ??
    accounts.find((a) => (a.name || '').trim() === (row.liveAccountName || '').trim()) ??
    accounts[0]
  let cookie: string | null = null
  if (account) {
    try {
      cookie = await getDecryptedCookieByAccountId(account.id)
    } catch {
      cookie = null
    }
  }
  if (!cookie) {
    return { cookie: null, packageId: row.packageId || normalized || orderNo }
  }
  return {
    cookie,
    packageId: row.packageId || normalized || orderNo,
  }
}

export class QianfanOrderOpenTicketError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QianfanOrderOpenTicketError'
  }
}

export async function createQianfanOrderOpenTicket(orderNo: string): Promise<{
  ticket: string
  expiresInSeconds: number
  openUrl: string
}> {
  const trimmed = String(orderNo || '').trim()
  if (!trimmed) {
    throw new QianfanOrderOpenTicketError('请提供订单号')
  }

  const { cookie, packageId } = await resolveCookieForOrder(trimmed)
  if (!cookie) {
    throw new QianfanOrderOpenTicketError(
      '平台登录信息过期了，请到系统设置重新粘贴 Cookie。',
    )
  }

  const serviceUrl =
    buildConfiguredDetailUrl(packageId) || buildDetailServiceUrl(packageId)
  if (!serviceUrl) {
    throw new QianfanOrderOpenTicketError('还没有配置订单详情地址，暂时不能跳千帆。')
  }

  const ticketValue = await fetchTicketWithCookie(cookie, serviceUrl)
  if (!ticketValue) {
    throw new QianfanOrderOpenTicketError(
      '暂时换不到千帆详情入口，请确认该店铺 Cookie 有效后再试。',
    )
  }

  const redirectUrl = buildArkUrlWithTicket(serviceUrl, ticketValue)
  const ticket = `qf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  ticketStore.set(ticket, { redirectUrl, createdAt: Date.now(), used: false })

  return {
    ticket,
    expiresInSeconds: 60,
    openUrl: `/api/board/qianfan-order-detail/open?ticket=${encodeURIComponent(ticket)}`,
  }
}

export function consumeQianfanOrderOpenTicket(ticket: string): {
  ok: true
  redirectUrl: string
} | {
  ok: false
  html: string
} {
  const key = String(ticket || '').trim()
  const entry = ticketStore.get(key)
  if (!entry) {
    return {
      ok: false,
      html: htmlErrorPage('这个订单详情入口已过期，请回到报表重新点一次。'),
    }
  }
  if (entry.used) {
    return {
      ok: false,
      html: htmlErrorPage('这个订单详情入口已过期，请回到报表重新点一次。'),
    }
  }
  if (Date.now() - entry.createdAt > TICKET_TTL_MS) {
    ticketStore.delete(key)
    return {
      ok: false,
      html: htmlErrorPage('这个订单详情入口已过期，请回到报表重新点一次。'),
    }
  }
  entry.used = true
  ticketStore.delete(key)
  return { ok: true, redirectUrl: entry.redirectUrl }
}

function htmlErrorPage(message: string): string {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>打开千帆订单详情</title>
<style>body{font-family:system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;color:#334155}
.box{background:#fff7ed;border:1px solid #fdba74;border-radius:12px;padding:16px;margin:16px 0}
</style></head><body><h1>暂时打不开</h1><div class="box"><p>${message}</p></div></body></html>`
}

export function __testOnlyQianfanTicketCount(): number {
  return ticketStore.size
}

export function __testOnlySeedQianfanTicket(ticket: string, redirectUrl: string): void {
  ticketStore.set(ticket, { redirectUrl, createdAt: Date.now(), used: false })
}

/** 按店铺精确匹配 Cookie，不做 silent fallback 到其他店 */
export async function resolveCookieForShopStrict(shopKeyOrName: string): Promise<{
  cookie: string
  shopKey: GoodReviewShopKey
  shopName: string
  accountId: string
} | null> {
  const shopKey = resolveGoodReviewShopKey(shopKeyOrName)
  if (!shopKey) return null

  const shopName = getGoodReviewShopName(shopKey)
  const targetCanonical = resolveCanonicalShopName(shopName)
  if (!targetCanonical) return null

  const accounts = await prisma.platformCredential.findMany({
    where: { enabled: true },
    orderBy: { createdAt: 'asc' },
  })

  const matched = accounts.find((row) => {
    const name = row.displayName?.trim() || row.platformName
    return resolveCanonicalShopName(name) === targetCanonical
  })
  if (!matched) return null

  const displayName = matched.displayName?.trim() || matched.platformName
  const cookie = await resolveLiveAccountCookie(matched.id, displayName)
  if (!cookie?.trim()) return null

  return { cookie, shopKey, shopName, accountId: matched.id }
}

export interface GoodReviewArkOrderDetailResult {
  ok: boolean
  url: string
  serviceUrl: string
  shop: string
  hasTicket: boolean
  error?: string
}

export async function buildGoodReviewArkOrderDetail(params: {
  orderId: string
  shop: string
}): Promise<GoodReviewArkOrderDetailResult> {
  const packageId = normalizePackageId(params.orderId)
  const shopKey = resolveGoodReviewShopKey(params.shop)
  if (!packageId) {
    throw new QianfanOrderOpenTicketError('请提供订单号')
  }
  if (!shopKey) {
    throw new QianfanOrderOpenTicketError('无效的店铺参数')
  }

  const serviceUrl =
    buildConfiguredDetailUrl(packageId) || buildDetailServiceUrl(packageId)
  if (!serviceUrl) {
    throw new QianfanOrderOpenTicketError('还没有配置订单详情地址，暂时不能跳千帆。')
  }

  const resolved = await resolveCookieForShopStrict(shopKey)
  if (!resolved) {
    return {
      ok: false,
      url: serviceUrl,
      serviceUrl,
      shop: shopKey,
      hasTicket: false,
      error: `未找到店铺「${getGoodReviewShopName(shopKey)}」的 Cookie 配置`,
    }
  }

  const ticketValue = await fetchTicketWithCookie(resolved.cookie, serviceUrl)
  if (ticketValue) {
    return {
      ok: true,
      url: buildArkUrlWithTicket(serviceUrl, ticketValue),
      serviceUrl,
      shop: shopKey,
      hasTicket: true,
    }
  }

  return {
    ok: false,
    url: serviceUrl,
    serviceUrl,
    shop: shopKey,
    hasTicket: false,
    error: '未能换到 ST ticket',
  }
}

export function htmlGoodReviewArkOrderFallbackPage(params: {
  serviceUrl: string
  shopName: string
  message?: string
}): string {
  const msg =
    params.message?.trim() ||
    '未能自动切换到对应店铺，请先打开千帆客服工作台并保持该店铺登录，然后再点一次。'
  const safeMsg = msg.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const safeUrl = params.serviceUrl.replace(/"/g, '&quot;')
  const safeShop = params.shopName.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>打开千帆订单详情</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#334155;line-height:1.6}
.box{background:#fff7ed;border:1px solid #fdba74;border-radius:12px;padding:16px;margin:16px 0}
a{color:#e11d48;word-break:break-all}</style></head><body>
<h1>暂时无法自动打开千帆订单详情</h1>
<p>店铺：${safeShop}</p>
<div class="box"><p>${safeMsg}</p></div>
<p>你也可以先手动打开基础链接：</p>
<p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a></p>
</body></html>`
}
