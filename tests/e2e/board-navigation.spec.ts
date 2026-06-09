import { test, expect } from '@playwright/test'
import {
  clickTab,
  expectNoForbiddenCopy,
  expectNoInfiniteSkeleton,
  gotoBoard,
  safeScreenshot,
} from './helpers'

const MAIN_TAB_IDS = ['tab-overview', 'tab-anchors', 'tab-buyers', 'tab-settings'] as const

const FORBIDDEN_NAV = [
  '订单明细',
  '账单对账',
  '财务中心',
  '利润分析',
  '提成',
  '工资',
] as const

test.describe('经营看板主导航', () => {
  test('主 TAB 结构正确且核心页面可访问', async ({ page }) => {
    await gotoBoard(page)

    for (const id of MAIN_TAB_IDS) {
      await expect(page.getByTestId(id)).toBeVisible()
    }

    const navText = (await page.locator('header nav').innerText()).replace(/\s+/g, ' ')
    for (const word of FORBIDDEN_NAV) {
      expect(navText).not.toContain(word)
    }

    for (const tab of ['经营总览', '主播业绩', '买家排行'] as const) {
      await clickTab(page, tab)
      await expect(page.locator('main')).toBeVisible()
      await expectNoForbiddenCopy(page)
      await expectNoInfiniteSkeleton(page)
      await safeScreenshot(page, `board-nav-${tab}.png`)
    }
  })
})
