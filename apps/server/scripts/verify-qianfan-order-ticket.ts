/**
 * 千帆订单详情换票验收（结构 + 可选 live）
 * 用法: npm run verify:qianfan-order-ticket
 */
import {
  buildArkUrlWithTicketDirect,
  buildDetailServiceUrl,
  buildTicketRequestBodies,
  extractTicketFromResponse,
  normalizePackageId,
  resolveQianfanOrderDetail,
} from '../src/services/qianfan-order-open-ticket.service'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

async function run(): Promise<void> {
  const issues: string[] = []
  const orderId = 'P797767202889118491'

  assert(normalizePackageId('797767202889118491') === orderId, 'normalizePackageId 应补 P 前缀', issues)
  assert(
    buildDetailServiceUrl(orderId) ===
      'https://ark.xiaohongshu.com/app-order/order/detail/P797767202889118491',
    'buildDetailServiceUrl 路径不对',
    issues,
  )

  const fakeCookie =
    'customer-sso-sid=sid123; x-user-id-ark.xiaohongshu.com=seller1; web_session=ws1; a1=abc'
  const bodies = buildTicketRequestBodies(buildDetailServiceUrl(orderId), fakeCookie)
  assert(bodies.some((b) => b.tag === 'at+root'), '应包含 at+root body', issues)
  assert(bodies.some((b) => b.tag === 'st+sid'), '应包含 st+sid body', issues)

  assert(
    extractTicketFromResponse({ data: { ticket: 'ST-abc' } }) === 'ST-abc',
    '应解析 ST ticket',
    issues,
  )
  assert(extractTicketFromResponse({ data: { ticket: 'AT-abc' } }) === '', 'AT 不应作为 ST 写入 URL', issues)

  const withTicket = buildArkUrlWithTicketDirect(
    buildDetailServiceUrl(orderId),
    'ST-test-ticket',
  )
  assert(withTicket.includes('ticket=ST-test-ticket'), '带 ticket URL 拼接失败', issues)

  if (process.env.RUN_QIANFAN_LIVE === '1') {
    const live = await resolveQianfanOrderDetail({
      orderId,
      shop: 'shiyuju',
      source: 'good-review',
    })
    assert(live.attempts.length > 0, 'live 模式应有 attempts', issues)
    assert(Boolean(live.serviceUrl), 'live 模式应有 serviceUrl', issues)
    assert(
      live.hasTicket || live.fallbackToBaseUrl,
      'live 模式应成功换票或 fallback',
      issues,
    )
    console.log(
      `[verify:qianfan-order-ticket] live hasTicket=${live.hasTicket} fallback=${live.fallbackToBaseUrl} attempts=${live.attempts.length}`,
    )
  } else {
    console.log('[verify:qianfan-order-ticket] 跳过 live（设置 RUN_QIANFAN_LIVE=1 可测真实 Cookie）')
  }

  if (issues.length) {
    console.error('verify:qianfan-order-ticket FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('verify:qianfan-order-ticket OK')
}

void run()
