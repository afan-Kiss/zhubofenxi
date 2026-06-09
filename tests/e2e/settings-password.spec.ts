import { test, expect } from '@playwright/test'
import { gotoBoard, waitForPageSettled } from './helpers'

test.describe('系统设置密码门', () => {
  test('未验证不能直接查看设置内容', async ({ page }) => {
    await gotoBoard(page)
    await page.evaluate(() => sessionStorage.removeItem('board_settings_unlocked'))
    await page.goto('/settings')
    await waitForPageSettled(page)
    await expect(page.getByTestId('settings-page-locked')).toBeVisible()
    await expect(page.getByTestId('settings-page-unlocked')).toHaveCount(0)
  })

  test('错误密码不能进入，正确密码可进入且同会话刷新仍可用', async ({ page }) => {
    await gotoBoard(page)
    await page.evaluate(() => sessionStorage.removeItem('board_settings_unlocked'))

    await page.getByTestId('tab-settings').click()
    await expect(page.getByTestId('settings-password-dialog')).toBeVisible()

    await page.getByTestId('settings-password-input').fill('wrong-password')
    await page.getByTestId('settings-password-submit').click()
    await expect(page.getByTestId('settings-password-error')).toContainText('密码不正确')
    await expect(page).not.toHaveURL(/\/settings$/)

    await page.getByTestId('settings-password-input').fill('fanfan9724')
    await page.getByTestId('settings-password-submit').click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByTestId('settings-page-unlocked')).toBeVisible({ timeout: 10_000 })

    await page.reload()
    await waitForPageSettled(page)
    await expect(page.getByTestId('settings-page-unlocked')).toBeVisible()
    await expect(page.getByTestId('settings-password-dialog')).toHaveCount(0)
  })

  test('取消弹窗返回经营总览', async ({ page }) => {
    await gotoBoard(page)
    await page.evaluate(() => sessionStorage.removeItem('board_settings_unlocked'))
    await page.getByTestId('tab-settings').click()
    await expect(page.getByTestId('settings-password-dialog')).toBeVisible()
    await page.getByTestId('settings-password-cancel').click()
    await expect(page.getByTestId('settings-password-dialog')).toHaveCount(0)
    await expect(page).toHaveURL(/\/$/)
  })
})
