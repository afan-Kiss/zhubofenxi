import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.E2E_BASE_URL ?? 'https://xiangyuzhubao.xyz/zhubofenxi'
const OUT_DIR = path.join(process.cwd(), 'deploy', 'aliyun', 'screenshots-boss-dashboard')
const USER = process.env.E2E_USER ?? ''
const PASS = process.env.E2E_PASS ?? ''

test.describe('老板查看线上验收', () => {
  test.beforeAll(() => {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    test.skip(!USER || !PASS, '需要 E2E_USER/E2E_PASS 环境变量')
  })

  test('登录后电脑端老板页与公告', async ({ page }) => {
    await page.goto(`${BASE}/login`)
    await page.getByPlaceholder(/用户名|账号/i).fill(USER)
    await page.getByPlaceholder(/密码/i).fill(PASS)
    await page.getByRole('button', { name: /登录/ }).click()
    await page.waitForURL(/\/(zhubofenxi)?\/?$|overview|anchors|board/, { timeout: 20_000 })

    const bossTab = page.getByRole('link', { name: '老板查看' })
    await expect(bossTab).toBeVisible()
    await bossTab.click()
    await page.waitForURL(/boss-dashboard/, { timeout: 15_000 })

    await expect(page.getByText(/平台数据最近更新时间|数据更新时间|老板查看/)).toBeVisible({ timeout: 20_000 })

    const xhsRequests: string[] = []
    page.on('request', (req) => {
      const url = req.url()
      if (url.includes('xiaohongshu.com') || url.includes('ark.xiaohongshu')) {
        xhsRequests.push(url)
      }
    })

    await page.waitForTimeout(3000)
    expect(xhsRequests.length).toBe(0)

    await page.screenshot({ path: path.join(OUT_DIR, 'desktop-boss-dashboard.png'), fullPage: true })

    const annBtn = page.locator('button').filter({ hasText: /公告|通知/ }).first()
    if (await annBtn.isVisible().catch(() => false)) {
      await annBtn.click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: path.join(OUT_DIR, 'desktop-announcements.png') })
    }

    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    expect(errors).toEqual([])
  })

  test('手机端老板页布局', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${BASE}/login`)
    await page.getByPlaceholder(/用户名|账号/i).fill(USER)
    await page.getByPlaceholder(/密码/i).fill(PASS)
    await page.getByRole('button', { name: /登录/ }).click()
    await page.waitForURL(/\/(zhubofenxi)?\/?$|overview|anchors|board/, { timeout: 20_000 })

    await page.goto(`${BASE}/boss-dashboard`)
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
    await page.screenshot({ path: path.join(OUT_DIR, 'mobile-boss-dashboard.png'), fullPage: true })

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 8)
  })
})
