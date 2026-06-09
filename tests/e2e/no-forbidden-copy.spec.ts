import { test } from '@playwright/test'
import { clickTab, expectNoForbiddenCopy, gotoBoard } from './helpers'

const PAGES = ['经营总览', '主播业绩', '买家排行'] as const

test.describe('页面禁用文案', () => {
  for (const tab of PAGES) {
    test(`${tab} 不出现禁用词`, async ({ page }) => {
      await gotoBoard(page)
      await clickTab(page, tab)
      await expectNoForbiddenCopy(page)
    })
  }
})
