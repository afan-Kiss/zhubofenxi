import { test, expect } from '@playwright/test'
import {
  clickAnchorCard,
  clickRangePreset,
  clickTab,
  closeDrawer,
  expectAnchorDrawerReady,
  findAnchorCard,
  gotoBoard,
  safeScreenshot,
  waitForAnchorLeaderboard,
  waitForPageSettled,
} from './helpers'

test.describe('主播业绩 Drawer 订单明细', () => {
  test('子杰 / 飞云 Drawer 可打开且明细不无限 skeleton', async ({ page }) => {
    await test.step('打开经营看板', async () => {
      await gotoBoard(page)
    })

    await test.step('进入主播业绩', async () => {
      await clickTab(page, '主播业绩')
      await expect(page.getByTestId('anchor-performance-page')).toBeVisible()
      await expect(page.getByRole('heading', { name: '主播业绩' })).toBeVisible()
    })

    await test.step('确认/切换本月', async () => {
      await clickRangePreset(page, '本月')
    })

    await test.step('等待主播卡片', async () => {
      await waitForAnchorLeaderboard(page)
    })

    await test.step('点击子杰', async () => {
      const zijieCard = await findAnchorCard(page, '子杰')
      await expect(zijieCard).toBeVisible()
      await clickAnchorCard(page, '子杰')
    })

    const zijieResult = await test.step('检查子杰 Drawer', async () => {
      return expectAnchorDrawerReady(page, '子杰')
    })

    await test.step('检查子杰订单明细状态', async () => {
      const { orderState } = zijieResult
      expect(['table', 'empty']).toContain(orderState)
      await safeScreenshot(page, 'anchor-zijie-drawer.png')
    })

    await test.step('关闭 Drawer', async () => {
      await closeDrawer(page)
      await waitForPageSettled(page)
    })

    await test.step('点击飞云', async () => {
      const feiyunCard = await findAnchorCard(page, '飞云')
      await expect(feiyunCard).toBeVisible()
      await clickAnchorCard(page, '飞云')
    })

    await test.step('检查飞云 Drawer', async () => {
      const { drawer, orderState } = await expectAnchorDrawerReady(page, '飞云')
      expect(['table', 'empty']).toContain(orderState)
      await expect(drawer.locator('h3')).toContainText('飞云')
      await expect(drawer.locator('h3')).not.toContainText('子杰')
      await safeScreenshot(page, 'anchor-feiyun-drawer.png')
    })

    await test.step('检查不串数据', async () => {
      const feiyunDrawer = page.getByTestId('anchor-order-drawer')
      if (await feiyunDrawer.isVisible().catch(() => false)) {
        await expect(feiyunDrawer.locator('h3')).not.toContainText('子杰')
      }
    })
  })
})
