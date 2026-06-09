import { test, expect } from '@playwright/test'
import type { BuyerRankingState } from './helpers'
import {
  buyerRankingRoot,
  clickTab,
  expectNotStuckInLoading,
  FORBIDDEN_VISIBLE_WORDS,
  gotoBoard,
  safeScreenshot,
  waitForBuyerRankingState,
  waitForPageSettled,
} from './helpers'

const FORBIDDEN_BUYER_COPY = [
  '累计实付金额',
  '累计下单金额',
  '累计退款金额',
  '累计成交净额',
  '利润分析',
  ...FORBIDDEN_VISIBLE_WORDS,
]

test.describe('买家排行', () => {
  test('识别页面状态并验收（ready / building / empty）', async ({ page }, testInfo) => {
    await test.step('打开经营看板', async () => {
      await gotoBoard(page)
    })

    await test.step('进入买家排行', async () => {
      await clickTab(page, '买家排行')
    })

    const root = buyerRankingRoot(page)
    let state: BuyerRankingState = 'unknown'

    await test.step('识别买家排行状态', async () => {
      await expect(root).toBeVisible()
      await expect(root.getByRole('heading', { name: '买家排行' })).toBeVisible()
      state = await waitForBuyerRankingState(page, { timeoutMs: 15_000 })
      console.log(`[buyer-ranking] detected state: ${state}`)
    })

    if (state === 'error') {
      await test.step('error 时失败', async () => {
        await safeScreenshot(page, 'buyer-ranking-error.png')
        expect(state, '买家排行处于错误状态').not.toBe('error')
      })
      return
    }

    if (state === 'building') {
      await test.step('building 时检查自动重建提示', async () => {
        await expect(
          root
            .getByRole('heading', { name: /买家画像正在更新/ })
            .or(root.getByText(/买家画像正在更新/))
            .or(root.getByText(/正在生成买家画像/))
            .or(root.getByText(/正在分析历史订单/))
            .first(),
        ).toBeVisible()
        const pageText = await root.innerText()
        expect(pageText, '版本升级时不应要求手动重建').not.toMatch(/缓存版本.*需更新为/)
        await expectNotStuckInLoading(page, { scope: root, allowBuildingProgress: true })
        await safeScreenshot(page, 'buyer-ranking-building.png')
        testInfo.annotations.push({
          type: 'note',
          description: '买家画像正在自动重建，跳过 ready 数据断言',
        })
      })
      return
    }

    if (state === 'empty') {
      await test.step('empty 时检查空状态', async () => {
        await expect(
          root
            .getByRole('heading', { name: '买家画像尚未生成' })
            .or(root.getByText(/尚未生成|暂无买家|暂无历史订单/))
            .first(),
        ).toBeVisible()
        await expectNotStuckInLoading(page, { scope: root, allowBuildingProgress: true })
        await safeScreenshot(page, 'buyer-ranking-empty.png')
      })
      return
    }

    if (state === 'unknown') {
      await test.step('unknown 状态截图并失败', async () => {
        await safeScreenshot(page, 'buyer-ranking-unknown.png')
        expect(state, '无法识别买家排行页面状态').not.toBe('unknown')
      })
      return
    }

    await test.step('ready 时检查样本与卡片', async () => {
      await expect(root.getByText(/买家排行最后更新|尚未生成/).first()).toBeVisible({
        timeout: 10_000,
      })
      await expect(root.getByText(/历史订单|笔历史订单/).first()).toBeVisible()
      await expect(root.getByText(/客户/).first()).toBeVisible()

      await expect(root.getByText('高价值客户数')).toBeVisible()
      await expect(root.getByText('复购客户数')).toBeVisible()
      await expect(root.getByText('退款客户数')).toBeVisible()
      await expect(root.getByText('品退客户数')).toBeVisible()

      const highValueCard = root.getByRole('button', { name: /高价值客户数/ })
      await highValueCard.click()
      await waitForPageSettled(page)

      const countText = await highValueCard.innerText()
      const countMatch = countText.match(/(\d[\d,]*)\s*$/) ?? countText.match(/(\d[\d,]*)/)
      const count = countMatch ? Number(countMatch[1]!.replace(/,/g, '')) : 0

      await root.getByText(/正在加载买家画像/).waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => undefined)

      if (count === 0) {
        await expect(
          root.getByText(/暂无|没有|当前.*暂无|0 位/).first(),
        ).toBeVisible({ timeout: 10_000 })
      } else {
        const drawer = page.getByTestId('buyer-summary-drawer')
        await expect(drawer).toBeVisible({ timeout: 15_000 })
        await expect(drawer.getByRole('heading', { name: /高价值客户/ })).toBeVisible({
          timeout: 15_000,
        })
        await expect(drawer.locator('li').first()).toBeVisible({ timeout: 15_000 })
        await expect(drawer.getByText('赚到金额').first()).toBeVisible()
        await drawer.locator('header button').click()
        await drawer.waitFor({ state: 'hidden', timeout: 10_000 })
      }

      await root.getByText(/正在加载买家画像/).waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => undefined)
      await expect(root.locator('article[role="button"]').first()).toBeVisible({ timeout: 15_000 })
      await safeScreenshot(page, 'buyer-ranking.png')
      await expectNotStuckInLoading(page, { scope: root, allowBuildingProgress: true })
    })

    await test.step('页面不应长期显示缓存版本手动升级提示', async () => {
      const pageText = await root.innerText()
      expect(pageText, '不应要求用户手动升级缓存版本').not.toMatch(/缓存版本.*需更新为/)
      expect(pageText, '不应出现旧版手动升级文案').not.toContain('缓存版本 buyer_summary')
    })

    await test.step('页面应展示赚到金额且不含误导性金额文案', async () => {
      await root.getByText(/正在加载买家画像/).waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => undefined)
      const cards = root.locator('article[role="button"]')
      if ((await cards.count()) === 0) {
        testInfo.annotations.push({ type: 'note', description: '消费排行无卡片，跳过主列表赚到金额检查' })
        return
      }
      const pageText = await root.innerText()
      for (const forbidden of FORBIDDEN_BUYER_COPY) {
        expect(pageText, `买家排行不应出现「${forbidden}」`).not.toContain(forbidden)
      }
      await expect(root.getByText('赚到金额').first()).toBeVisible()
    })

    await test.step('Drawer 已取消订单赚到金额应为 0', async () => {
      const cards = root.locator('article[role="button"]')
      const cardCount = await cards.count()
      if (cardCount === 0) {
        testInfo.annotations.push({ type: 'note', description: '无买家卡片，跳过 Drawer 赚到金额检查' })
        return
      }
      await cards.first().click()
      const drawer = page.getByTestId('buyer-order-drawer')
      await expect(drawer).toBeVisible({ timeout: 15_000 })
      await expect(drawer.getByText('赚到金额').first()).toBeVisible()

      const drawerText = await drawer.innerText()
      for (const forbidden of FORBIDDEN_BUYER_COPY) {
        expect(drawerText, `Drawer 不应出现「${forbidden}」`).not.toContain(forbidden)
      }

      const cancelledRows = drawer.locator('tr').filter({ hasText: '已取消' })
      const cancelledCount = await cancelledRows.count()
      for (let i = 0; i < Math.min(cancelledCount, 5); i++) {
        const text = await cancelledRows.nth(i).innerText()
        const earnedMatch = text.match(/赚到[^¥\d]*¥?\s*([\d,]+(?:\.\d+)?)/)
        if (earnedMatch) {
          const amount = Number(earnedMatch[1]!.replace(/,/g, ''))
          expect(amount, `已取消订单行赚到金额应为 0: ${text.slice(0, 80)}`).toBe(0)
        }
      }

      await drawer.locator('header button').click().catch(() => undefined)
    })
  })
})
