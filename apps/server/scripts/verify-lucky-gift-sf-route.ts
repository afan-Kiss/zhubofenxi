/**
 * 福袋顺丰轨迹分类静态验收
 * npx tsx apps/server/scripts/verify-lucky-gift-sf-route.ts
 */
import { classifySfRouteNodes } from '../src/services/sf-waybill-fee.service'
import fs from 'node:fs'
import path from 'node:path'

const issues: string[] = []

function assert(cond: boolean, msg: string) {
  if (!cond) issues.push(msg)
}

const rejected = classifySfRouteNodes([
  { acceptTime: '2026-07-01 10:00:00', acceptAddress: null, remark: '顺丰已收件', opCode: '50' },
  { acceptTime: '2026-07-02 12:00:00', acceptAddress: null, remark: '客户拒收，快件退回', opCode: '70' },
])
assert(rejected.outcome === 'rejected', `expected rejected got ${rejected.outcome}`)
assert(rejected.eventAt === '2026-07-02 12:00:00', `rejected eventAt ${rejected.eventAt}`)

const returned = classifySfRouteNodes([
  { acceptTime: '2026-07-01 10:00:00', acceptAddress: null, remark: '顺丰已收件', opCode: '50' },
  {
    acceptTime: '2026-07-03 09:00:00',
    acceptAddress: null,
    remark: '快件已退回/转寄,新单号为: SF999',
    opCode: '648',
  },
])
assert(returned.outcome === 'returned', `expected returned got ${returned.outcome}`)
assert(returned.eventAt === '2026-07-03 09:00:00', `returned eventAt ${returned.eventAt}`)

const signed = classifySfRouteNodes([
  { acceptTime: '2026-07-01 10:00:00', acceptAddress: null, remark: '顺丰已收件', opCode: '50' },
  { acceptTime: '2026-07-02 18:00:00', acceptAddress: null, remark: '已签收,感谢使用顺丰', opCode: '80' },
])
assert(signed.outcome === 'signed', `expected signed got ${signed.outcome}`)
assert(signed.eventAt === '2026-07-02 18:00:00', `signed eventAt ${signed.eventAt}`)

const page = path.join(
  process.cwd(),
  'apps/web/src/pages/board/LuckyGiftsPage.tsx',
)
const pageSrc = fs.readFileSync(page, 'utf8')
assert(pageSrc.includes('未签收 / 退回运费'), 'page missing route panel title')
assert(pageSrc.includes('发货'), 'page missing ship time label')
assert(pageSrc.includes('拒收'), 'page missing reject time label')
assert(!pageSrc.includes('亏损'), 'page must not use 亏损')
assert(!pageSrc.includes('顺丰费用'), 'page must not use banned 顺丰费用 label')

if (issues.length) {
  console.error('FAIL', issues)
  process.exit(1)
}
console.log('OK verify-lucky-gift-sf-route')
