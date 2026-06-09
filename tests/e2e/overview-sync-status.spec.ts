import { test, expect } from '@playwright/test'
import { gotoBoard, waitForPageSettled } from './helpers'

test.describe('经营总览同步状态提示', () => {
  test('success 时不应长期显示订单列表 10%', async ({ page, request }) => {
    await gotoBoard(page)

    const metaRes = await request.get('/api/board/sync-meta')
    expect(metaRes.ok()).toBeTruthy()
    const meta = (await metaRes.json()) as {
      data?: {
        businessSync?: { status?: string; currentTask?: unknown }
        activeSyncJob?: {
          currentStep?: string
          progress?: number
          currentPage?: number
          orderCount?: number
        } | null
      }
    }
    const syncMeta = meta.data
    const biz = syncMeta?.businessSync
    const job = syncMeta?.activeSyncJob

    const header = page.locator('main').first()
    await expect(header).toBeVisible()

    if (biz?.status === 'success' && !biz.currentTask) {
      await expect(header).not.toContainText('经营数据正在更新')
      await expect(header).not.toContainText('当前步骤：订单列表')
      await expect(header.getByText(/进度 10%/)).toHaveCount(0)
      const cards = page.locator('main')
      await expect(cards.first()).toBeVisible()
      return
    }

    if (job?.currentStep === 'syncing_order_list') {
      await waitForPageSettled(page)
      const text = (await header.innerText()).replace(/\s+/g, ' ')
      expect(text).toMatch(/经营数据正在|同步/)
      const hasProgressDetail =
        /第 \d+/.test(text) ||
        /已获取：订单 \d+/.test(text) ||
        /已耗时：/.test(text) ||
        (job.progress ?? 0) > 10 ||
        (job.orderCount ?? 0) > 0
      expect(
        hasProgressDetail,
        '订单列表同步中必须展示页数、已读取订单数或已耗时之一，不能只有固定 10%',
      ).toBeTruthy()
      if ((job.progress ?? 0) === 10 && !hasProgressDetail) {
        expect(false, '不允许只有「订单列表 · 进度 10%」无其他进度信息').toBe(true)
      }
    }
  })
})
