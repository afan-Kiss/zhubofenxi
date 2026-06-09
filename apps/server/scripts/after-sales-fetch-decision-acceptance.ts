/**
 * 售后工作台补查判定验收
 * npx tsx apps/server/scripts/after-sales-fetch-decision-acceptance.ts
 */
import {
  shouldFetchAfterSalesWorkbench,
  canSkipAfterSalesWorkbenchFetch,
} from '../src/services/after-sales-fetch-decision.service'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const baseOrder = {
  displayOrderNo: 'P794053985617460471',
  officialOrderNo: 'P794053985617460471',
}

const cases: Array<{ name: string; input: Parameters<typeof shouldFetchAfterSalesWorkbench>[0]; expect: boolean }> = [
  {
    name: '已签收+无售后',
    input: {
      ...baseOrder,
      orderStatusText: '已签收',
      afterSaleStatusText: '无售后',
      orderStatusLabel: '已签收',
      afterSaleStatusLabel: '无售后',
    },
    expect: false,
  },
  {
    name: '已完成+无售后',
    input: {
      ...baseOrder,
      orderStatusText: '已完成',
      afterSaleStatusText: '无售后',
    },
    expect: false,
  },
  {
    name: '售后关闭+其他售后',
    input: {
      ...baseOrder,
      orderStatusText: '售后关闭',
      afterSaleStatusText: '其他售后',
      orderStatusLabel: '售后关闭',
      afterSaleStatusLabel: '其他售后',
    },
    expect: true,
  },
  {
    name: '已完成+售后关闭',
    input: {
      ...baseOrder,
      orderStatusText: '已完成',
      afterSaleStatusText: '售后关闭',
    },
    expect: true,
  },
  {
    name: '已签收+售后处理中',
    input: {
      ...baseOrder,
      orderStatusText: '已签收',
      afterSaleStatusText: '售后处理中',
    },
    expect: true,
  },
  {
    name: 'raw returns_id',
    input: {
      ...baseOrder,
      orderStatusText: '已发货',
      raw: { returns_id: 'R123' },
    },
    expect: true,
  },
  {
    name: 'raw afterSaleInfo',
    input: {
      ...baseOrder,
      orderStatusText: '已发货',
      raw: { afterSaleInfo: { refund_fee: 100 } },
    },
    expect: true,
  },
  {
    name: 'refundSource pending',
    input: {
      ...baseOrder,
      orderStatusText: '已签收',
      buyerProductRefundSource: 'after_sales_workbench_pending',
    },
    expect: true,
  },
]

function run(): void {
  for (const c of cases) {
    const got = shouldFetchAfterSalesWorkbench(c.input)
    assert(got === c.expect, `${c.name}: 期望 ${c.expect} 实际 ${got}`)
    console.log(`✓ ${c.name}`)
  }

  const skip = canSkipAfterSalesWorkbenchFetch({
    ...baseOrder,
    orderStatusText: '已签收',
    afterSaleStatusText: '无售后',
  })
  assert(skip === true, '已签收无售后应可跳过')

  const noSkip = canSkipAfterSalesWorkbenchFetch({
    ...baseOrder,
    orderStatusText: '售后关闭',
    afterSaleStatusText: '其他售后',
  })
  assert(noSkip === false, '售后关闭不可跳过')

  console.log('\n全部 after-sales-fetch-decision 验收通过')
}

run()
