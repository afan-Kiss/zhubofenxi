import fs from 'node:fs'
import path from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'

const TAB_TEST_IDS: Record<string, string> = {
  经营总览: 'tab-overview',
  主播业绩: 'tab-anchors',
  买家排行: 'tab-buyers',
  系统设置: 'tab-settings',
}

const ANCHOR_CARD_TEST_IDS: Record<string, string> = {
  子杰: 'anchor-card-zijie',
  飞云: 'anchor-card-feiyun',
}

const RANGE_PRESET_TEST_IDS: Record<string, string> = {
  今日: 'range-preset-today',
  昨日: 'range-preset-yesterday',
  本周: 'range-preset-thisWeek',
  本月: 'range-preset-thisMonth',
  上月: 'range-preset-lastMonth',
  自定义: 'range-preset-custom',
}

export const FORBIDDEN_VISIBLE_WORDS = [
  '毛利润',
  '提成',
  '工资',
  '扣款',
  '责任',
  '黑名单',
  '账单对账',
  '财务中心',
  '平台结算',
] as const

export const FORBIDDEN_NAV_WORDS = [
  '订单明细',
  '账单对账',
  '财务中心',
  '利润分析',
  '提成',
  '工资',
  '结算管理',
] as const

const SCREENSHOT_DIR = path.join('test-results', 'screenshots')

const BUILDING_TEXT =
  /买家画像正在更新|正在生成买家画像|正在分析历史订单|正在加载买家画像|正在重建/

const EMPTY_TEXT = /买家画像尚未生成|尚未生成|暂无买家|暂无历史订单|暂无买家排行/

const ERROR_TEXT = /买家画像更新失败|加载买家画像失败|重建买家排行失败/

export type BuyerRankingState = 'ready' | 'building' | 'empty' | 'error' | 'unknown'

export type AnchorDrawerOrderState = 'table' | 'empty' | 'error'

export function buyerRankingRoot(page: Page): Locator {
  return page.getByTestId('buyer-ranking-page')
}

export async function gotoBoard(page: Page): Promise<void> {
  await page.goto('/')
  await waitForPageSettled(page)
  await expect(page.getByRole('heading', { name: '本地经营看板' })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByTestId('tab-overview')).toBeVisible()
}

export async function waitForPageSettled(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(600)
}

export async function clickTab(page: Page, name: string): Promise<void> {
  const testId = TAB_TEST_IDS[name]
  if (testId) {
    await page.getByTestId(testId).click()
  } else {
    await page.getByRole('link', { name }).click()
  }
  await waitForPageSettled(page)
}

export async function detectBuyerRankingState(page: Page): Promise<BuyerRankingState> {
  const root = buyerRankingRoot(page)
  if (!(await root.isVisible().catch(() => false))) return 'unknown'

  const text = (await root.innerText()).replace(/\s+/g, ' ')

  if (await root.getByRole('heading', { name: '买家画像更新失败' }).isVisible().catch(() => false)) {
    return 'error'
  }
  if (ERROR_TEXT.test(text) && (await root.locator('.border-red-200').count()) > 0) {
    const errBox = root.locator('.border-red-200').filter({ hasText: /失败/ })
    if (await errBox.first().isVisible().catch(() => false)) return 'error'
  }

  if (await root.getByRole('heading', { name: '买家画像尚未生成' }).isVisible().catch(() => false)) {
    return 'empty'
  }
  if (EMPTY_TEXT.test(text) && !/买家排行最后更新/.test(text) && !(await hasReadySummaryCards(root))) {
    return 'empty'
  }

  if (await root.getByText(/买家画像正在更新，请稍候/).isVisible().catch(() => false)) {
    return 'building'
  }

  const buildingHeading = await root
    .getByRole('heading', { name: /买家画像正在更新/ })
    .isVisible()
    .catch(() => false)
  const generating = await root.getByText(/正在生成买家画像/).isVisible().catch(() => false)
  const analyzing = await root.getByText(/正在分析历史订单/).isVisible().catch(() => false)
  const compactUpdating = await root.getByText(/买家画像正在更新/).isVisible().catch(() => false)
  const buildingCopy = buildingHeading || generating || analyzing || compactUpdating

  const hasLastUpdated = await root.getByText(/买家排行最后更新/).isVisible().catch(() => false)
  const hasReadyCards = await hasReadySummaryCards(root)

  if (buildingCopy && (!hasLastUpdated || !hasReadyCards)) {
    return 'building'
  }

  if (hasLastUpdated || hasReadyCards) {
    return 'ready'
  }

  if (await root.getByText(/正在加载买家画像/).isVisible().catch(() => false)) {
    return 'building'
  }

  return 'unknown'
}

async function hasReadySummaryCards(root: Locator): Promise<boolean> {
  return root.getByRole('button', { name: /高价值客户数/ }).isVisible().catch(() => false)
}

export async function waitForBuyerRankingState(
  page: Page,
  options?: { timeoutMs?: number },
): Promise<BuyerRankingState> {
  const timeoutMs = options?.timeoutMs ?? 5000
  const deadline = Date.now() + timeoutMs
  let last: BuyerRankingState = 'unknown'

  while (Date.now() < deadline) {
    last = await detectBuyerRankingState(page)
    if (last !== 'unknown') return last
    await page.waitForTimeout(400)
  }
  return detectBuyerRankingState(page)
}

export async function expectNotStuckInLoading(
  page: Page,
  options?: {
    scope?: Locator
    waitMs?: number
    allowBuildingProgress?: boolean
  },
): Promise<void> {
  const scope = options?.scope ?? page.locator('main')
  const waitMs = options?.waitMs ?? 8000
  const text = (await scope.innerText().catch(() => '')).replace(/\s+/g, ' ')

  if (options?.allowBuildingProgress !== false && BUILDING_TEXT.test(text)) {
    const onlySpinner =
      (await scope.locator('[data-testid="drawer-order-skeleton"]').count()) === 0
    if (onlySpinner) return
  }

  await page.waitForTimeout(waitMs)

  const postText = (await scope.innerText().catch(() => '')).replace(/\s+/g, ' ')
  if (BUILDING_TEXT.test(postText) && options?.allowBuildingProgress !== false) {
    const skeleton = scope.locator('[data-testid="drawer-order-skeleton"]')
    if ((await skeleton.count()) === 0 || !(await skeleton.first().isVisible().catch(() => false))) {
      return
    }
  }

  const drawerSkeleton = scope.locator('[data-testid="drawer-order-skeleton"]')
  if (await drawerSkeleton.first().isVisible().catch(() => false)) {
    expect(false, 'Drawer 订单明细不应长时间停留在骨架屏').toBe(true)
  }

  const listSkeletons = scope.locator('.animate-pulse.rounded-xl.bg-rose-50\\/80')
  const visiblePulse = await listSkeletons.evaluateAll((els) =>
    els.filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }),
  )
  if (visiblePulse.length >= 5 && !BUILDING_TEXT.test(postText)) {
    expect(false, '页面不应在长时间等待后仍显示大面积骨架屏').toBe(true)
  }
}

export async function expectNoInfiniteSkeleton(page: Page, scope?: Locator): Promise<void> {
  await expectNotStuckInLoading(page, { scope, allowBuildingProgress: true })
}

export async function expectNoForbiddenCopy(page: Page): Promise<void> {
  const navText = (await page.locator('header nav').innerText().catch(() => '')).replace(/\s+/g, ' ')
  for (const word of FORBIDDEN_NAV_WORDS) {
    expect(navText, `主导航不应出现「${word}」`).not.toContain(word)
  }

  const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  for (const word of FORBIDDEN_VISIBLE_WORDS) {
    expect(bodyText, `页面可见文案不应出现「${word}」`).not.toContain(word)
  }
}

export async function safeScreenshot(page: Page, name: string): Promise<string> {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const file = path.join(SCREENSHOT_DIR, name.endsWith('.png') ? name : `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  return file
}

async function isRangePresetSelected(el: Locator): Promise<boolean> {
  const ariaSelected = await el.getAttribute('aria-selected')
  if (ariaSelected === 'true') return true
  const ariaPressed = await el.getAttribute('aria-pressed')
  if (ariaPressed === 'true') return true
  const dataActive = await el.getAttribute('data-active')
  if (dataActive === 'true') return true
  if (await el.isDisabled().catch(() => false)) return true
  const className = (await el.getAttribute('class')) ?? ''
  if (/board-tab-btn--active|board-tab-btn--nav-active/.test(className)) return true
  if (/\b(active|selected|primary)\b/i.test(className)) return true
  return false
}

async function findRangePresetButton(page: Page, label: string): Promise<Locator> {
  const testId = RANGE_PRESET_TEST_IDS[label]
  if (testId) {
    const byTestId = page.getByTestId(testId)
    if ((await byTestId.count()) > 0) return byTestId.first()
  }
  const tab = page.getByRole('tab', { name: label, exact: true })
  if ((await tab.count()) > 0) return tab.first()
  return page.getByRole('button', { name: label, exact: true }).first()
}

async function waitAfterRangePreset(page: Page): Promise<void> {
  const anchorPage = page.getByTestId('anchor-performance-page')
  if ((await anchorPage.count()) > 0) {
    await expect(anchorPage).toBeVisible({ timeout: 10_000 })
    await waitForAnchorLeaderboard(page)
    return
  }
  await page.waitForTimeout(500)
}

export async function clickRangePreset(page: Page, label: string): Promise<void> {
  const preset = await findRangePresetButton(page, label)
  await preset.scrollIntoViewIfNeeded()

  if (await isRangePresetSelected(preset)) {
    console.log(`[clickRangePreset] 「${label}」已是选中状态，跳过点击`)
    await waitAfterRangePreset(page)
    return
  }

  try {
    await preset.click({ timeout: 5_000 })
  } catch (error) {
    const screenshot = await safeScreenshot(page, `clickRangePreset-failed-${label}.png`)
    throw new Error(
      `clickRangePreset 点击「${label}」失败（timeout 5s）。截图：${screenshot}。原因：${String(error)}`,
    )
  }

  await waitAfterRangePreset(page)
}

export async function findAnchorCard(page: Page, anchorName: string): Promise<Locator> {
  const testId = ANCHOR_CARD_TEST_IDS[anchorName]
  if (testId) {
    const byId = page.getByTestId(testId)
    if ((await byId.count()) > 0) return byId.first()
  }
  return page
    .locator('[data-testid^="anchor-card-"], article[role="button"], tr[data-testid^="anchor-card-"]')
    .filter({ hasText: anchorName })
    .first()
}

export async function clickAnchorCard(page: Page, anchorName: string): Promise<void> {
  const card = await findAnchorCard(page, anchorName)
  await expect(card).toBeVisible({ timeout: 20_000 })
  await card.scrollIntoViewIfNeeded()
  await card.click()
}

export async function waitForAnchorDrawerOpen(page: Page, anchorName: string): Promise<Locator> {
  const drawer = page.getByTestId('anchor-order-drawer')
  await expect(drawer).toBeVisible({ timeout: 10_000 })
  await expect(drawer.locator('h3').filter({ hasText: anchorName })).toBeVisible({ timeout: 5_000 })
  return drawer
}

export async function resolveAnchorDrawerOrderState(drawer: Locator): Promise<AnchorDrawerOrderState> {
  if (await drawer.getByText('订单明细加载失败').isVisible().catch(() => false)) {
    return 'error'
  }
  await expect(drawer.locator('[data-testid="drawer-order-skeleton"]')).toHaveCount(0, {
    timeout: 25_000,
  })
  if (await drawer.locator('[data-testid="drawer-empty-state"]').isVisible().catch(() => false)) {
    return 'empty'
  }
  if (await drawer.getByText('当前范围暂无该主播订单').isVisible().catch(() => false)) {
    return 'empty'
  }
  if (await drawer.locator('[data-testid="drawer-order-table"]').isVisible().catch(() => false)) {
    return 'table'
  }
  return 'unknown'
}

export async function expectAnchorDrawerReady(
  page: Page,
  anchorName: string,
): Promise<{ drawer: Locator; orderState: AnchorDrawerOrderState }> {
  const drawer = await waitForAnchorDrawerOpen(page, anchorName)

  await expect(drawer.getByText('支付金额')).toBeVisible()
  await expect(drawer.getByText(/有效/).first()).toBeVisible()
  await expect(drawer.getByText(/签收/).first()).toBeVisible()
  await expect(drawer.getByText(/退款/).first()).toBeVisible()
  await expect(drawer.getByText(/订单/).first()).toBeVisible()

  const orderState = await resolveAnchorDrawerOrderState(drawer)
  expect(
    orderState === 'error',
    '订单明细接口失败，属于真实问题，不应通过测试',
  ).toBe(false)

  expect(orderState, 'Drawer 订单明细应呈现表格或明确空态').not.toBe('unknown')

  if (orderState === 'table') {
    const table = drawer.locator('[data-testid="drawer-order-table"]')
    await expect(table).toBeVisible()
    await expect(table.locator('tbody tr').first()).toBeAttached()
  }

  return { drawer, orderState }
}

export async function closeDrawer(page: Page): Promise<void> {
  const drawer = page.getByTestId('anchor-order-drawer')
  const headerClose = drawer.locator('header button[type="button"]')
  if (await headerClose.isVisible().catch(() => false)) {
    await headerClose.click()
  } else {
    await page.getByRole('button', { name: '关闭' }).first().click()
  }
  await expect(drawer).not.toBeVisible({ timeout: 8_000 })
}

export async function waitForAnchorLeaderboard(page: Page): Promise<void> {
  const anchorPage = page.getByTestId('anchor-performance-page')
  if ((await anchorPage.count()) > 0) {
    await expect(anchorPage).toBeVisible({ timeout: 15_000 })
  }
  const panel = page.locator('[data-testid^="anchor-card-"], article[role="button"], table tbody tr')
  await expect(panel.first()).toBeVisible({ timeout: 25_000 })
  await page.waitForTimeout(400)
}
