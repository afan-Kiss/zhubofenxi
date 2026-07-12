/**
 * 福袋同步专项验收（纯函数 / mock，不访问生产）
 */
import { classifyLuckyGiftListPage, isLuckyGiftLoginPageResponse, parseLuckyGiftListPage } from '../src/services/lucky-gift/lucky-gift-platform-response.util'
import { normalizeLuckyDrawListPayload } from '../src/services/lucky-gift/lucky-gift-normalize.service'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

const SAMPLE_HISTORY = JSON.stringify({
  code: 0,
  success: true,
  msg: '成功',
  data: {
    result: { code: 0, message: '', success: true },
    infos: [
      {
        id: '138008565063504647',
        room_id: '570353976377029856',
        gift_name: '时尚手镯（运费自理）',
        lucky_count: 1,
        status: 2,
        create_time: 1783500552000,
        start_time: 1783502353000,
        sender: { user_id: '68998c30000000002900ae2c', nickname: '和田雅玉' },
      },
    ],
  },
})

const SAMPLE_DETAIL = JSON.stringify({
  code: 0,
  success: true,
  msg: '成功',
  data: {
    result: { code: 0, message: '', success: true },
    info: { id: '138008565063504647', gift_name: '时尚手镯（运费自理）', room_id: '570353976377029856' },
    boys: [
      {
        user_info: { user_id: '5ad2181511be10292ebb092d', nickname: '一枚玻璃糖', red_id: '187650242' },
        address: { name: '张三', phone: '13800000000', province: '新疆', city: '和田', district: '和田市', detail: '测试路1号' },
      },
    ],
  },
})

async function paginateMock(total: number, pageSize: number): Promise<string[]> {
  const out: string[] = []
  const seen = new Set<string>()
  let page = 1
  while (page <= 20) {
    const start = (page - 1) * pageSize
    if (start >= total) break
    const count = Math.min(pageSize, total - start)
    const ids: string[] = []
    for (let i = 0; i < count; i++) ids.push(`draw-${start + i}`)
    if (ids.length === 0) break
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
    if (ids.length < pageSize) break
    page += 1
  }
  return out
}

async function main(): Promise<void> {
  const issues: string[] = []

  const bizFail = classifyLuckyGiftListPage(
    parseLuckyGiftListPage({ code: 401, success: false, msg: '未登录', data: {} }, '{"code":401,"success":false,"msg":"未登录","data":{}}'),
    '{"code":401,"success":false,"msg":"未登录","data":{}}',
  )
  assert(bizFail.status === 'parameter_failed', 'HTTP200业务code失败不能算成功', issues)

  const loginPage = classifyLuckyGiftListPage(
    parseLuckyGiftListPage({}, '<html><body>login xiaohongshu</body></html>'),
    '<html><body>login xiaohongshu</body></html>',
  )
  assert(loginPage.status === 'auth_failed', '登录页响应不能解析为空列表', issues)
  assert(isLuckyGiftLoginPageResponse('<html>login xiaohongshu</html>'), '登录页识别', issues)

  const missingList = classifyLuckyGiftListPage(
    parseLuckyGiftListPage({ code: 0, success: true, data: { totalCount: 3 } }, '{"code":0,"data":{"totalCount":3}}'),
    '{"code":0,"data":{"totalCount":3}}',
  )
  assert(missingList.status === 'parse_failed', 'total>0但list缺失必须报parse_failed', issues)

  const confirmedEmpty = classifyLuckyGiftListPage(
    parseLuckyGiftListPage({ code: 0, success: true, data: { infos: [], totalCount: 0 } }, '{"code":0,"data":{"infos":[],"totalCount":0}}'),
    '{"code":0,"data":{"infos":[],"totalCount":0}}',
  )
  assert(confirmedEmpty.status === 'confirmed_empty', '真空数组且total=0才可confirmed_empty', issues)

  const ambiguous = classifyLuckyGiftListPage(
    parseLuckyGiftListPage({ code: 0, success: true, data: { infos: [] } }, '{"code":0,"data":{"infos":[]}}'),
    '{"code":0,"data":{"infos":[]}}',
  )
  assert(ambiguous.status === 'ambiguous_empty', '无total的空列表应为ambiguous_empty', issues)

  const parsedHistory = normalizeLuckyDrawListPayload(JSON.parse(SAMPLE_HISTORY), SAMPLE_HISTORY)
  assert(parsedHistory.infos.length === 1, '生产样本应能解析出1条福袋', issues)
  assert(parsedHistory.infos[0]?.luckyDrawId === '138008565063504647', 'luckyDrawId应保持字符串精度', issues)
  assert(parsedHistory.infos[0]?.roomId === '570353976377029856', 'roomId应保持字符串', issues)

  const multi = await paginateMock(120, 50)
  assert(multi.length === 120, '多页列表应全部拉取', issues)

  const cursorLike = await paginateMock(75, 20)
  assert(cursorLike.length === 75, 'cursor式分页应全部拉取', issues)

  const dupGuard = new Set<string>()
  for (const id of ['a', 'a', 'b']) {
    if (!dupGuard.has(id)) dupGuard.add(id)
  }
  assert(dupGuard.size === 2, '重复页保护', issues)

  const detailParsed = JSON.parse(SAMPLE_DETAIL)
  const data = detailParsed.data
  assert(Array.isArray(data.boys) && data.boys.length === 1, '详情样本应有中奖人', issues)

  if (issues.length > 0) {
    console.error('[verify:lucky-gifts] FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:lucky-gifts] OK')
}

void main()
