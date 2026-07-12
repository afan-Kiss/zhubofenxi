import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { addDaysShanghai, formatDateKeyShanghai } from '../../apps/web/src/lib/business-timezone'
import { gotoBoard, waitForPageSettled } from './helpers'

const MIN_EXPORT_WIDTH = 600
const MIN_EXPORT_HEIGHT = 300
const MIN_FILE_BYTES = 20 * 1024

type ImageSampleResult = {
  naturalWidth: number
  naturalHeight: number
  nonWhitePixels: number
  sampledPixels: number
  srcPrefix: string
}

async function samplePreviewImageNonWhite(page: import('@playwright/test').Page): Promise<ImageSampleResult> {
  return page.evaluate(() => {
    const img = document.querySelector(
      '[data-testid="ops-daily-export-preview-img"]',
    ) as HTMLImageElement | null
    if (!img) {
      throw new Error('preview img not found')
    }

    const naturalWidth = img.naturalWidth
    const naturalHeight = img.naturalHeight
    const canvas = document.createElement('canvas')
    const w = Math.min(160, naturalWidth)
    const h = Math.min(160, naturalHeight)
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas unavailable')

    const regions = [
      { sx: 0, sy: 0 },
      { sx: Math.max(0, naturalWidth * 0.3), sy: Math.max(0, naturalHeight * 0.2) },
      { sx: Math.max(0, naturalWidth * 0.5), sy: Math.max(0, naturalHeight * 0.55) },
    ]

    let nonWhitePixels = 0
    let sampledPixels = 0

    for (const region of regions) {
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(img, region.sx, region.sy, w, h, 0, 0, w, h)
      const data = ctx.getImageData(0, 0, w, h).data
      const step = 5
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const i = (y * w + x) * 4
          const r = data[i] ?? 255
          const g = data[i + 1] ?? 255
          const b = data[i + 2] ?? 255
          const a = data[i + 3] ?? 255
          sampledPixels++
          if (a > 20 && !(r > 248 && g > 248 && b > 248)) {
            nonWhitePixels++
          }
        }
      }
    }

    return {
      naturalWidth,
      naturalHeight,
      nonWhitePixels,
      sampledPixels,
      srcPrefix: img.src.slice(0, 32),
    }
  })
}

async function gotoOperationsDailyReport(
  page: import('@playwright/test').Page,
  dateKey: string,
): Promise<void> {
  await gotoBoard(page)
  await page.getByTestId('tab-operations-report').click()
  await waitForPageSettled(page)
  await expect(page.getByRole('heading', { name: '运营报表' })).toBeVisible({ timeout: 15_000 })

  const dateInput = page.locator('input[type="date"]').first()
  await dateInput.fill(dateKey)
  await page.waitForTimeout(800)
  await expect(page.getByTestId('ops-daily-export-btn')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('ops-daily-export-btn')).toBeEnabled({ timeout: 30_000 })
}

async function exportAndAssertPreview(
  page: import('@playwright/test').Page,
  label: string,
): Promise<{ sample: ImageSampleResult; downloadBytes: number }> {
  await page.getByTestId('ops-daily-export-btn').click()
  await expect(page.getByTestId('ops-daily-export-preview')).toBeVisible({ timeout: 60_000 })

  const previewError = page.getByTestId('ops-daily-export-error')
  if (await previewError.isVisible().catch(() => false)) {
    const msg = await previewError.innerText()
    throw new Error(`导出失败（${label}）：${msg}`)
  }

  const img = page.getByTestId('ops-daily-export-preview-img')
  await expect(img).toBeVisible({ timeout: 15_000 })

  await page.waitForFunction(() => {
    const el = document.querySelector(
      '[data-testid="ops-daily-export-preview-img"]',
    ) as HTMLImageElement | null
    return Boolean(el && el.complete && el.naturalWidth > 0 && el.naturalHeight > 0)
  }, { timeout: 20_000 })

  const sample = await samplePreviewImageNonWhite(page)
  expect(sample.naturalWidth, `${label} naturalWidth`).toBeGreaterThan(MIN_EXPORT_WIDTH)
  expect(sample.naturalHeight, `${label} naturalHeight`).toBeGreaterThan(MIN_EXPORT_HEIGHT)
  expect(sample.srcPrefix, `${label} src`).toMatch(/^blob:|^data:image\/png/)
  expect(sample.nonWhitePixels, `${label} 非白像素`).toBeGreaterThan(20)
  expect(sample.nonWhitePixels / Math.max(1, sample.sampledPixels), `${label} 白图比例`).toBeLessThan(
    0.99,
  )

  const downloadBtn = page.getByTestId('ops-daily-export-download')
  await expect(downloadBtn).toBeEnabled({ timeout: 20_000 })

  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 })
  await downloadBtn.click()
  const download = await downloadPromise
  const downloadPath = await download.path()
  expect(downloadPath, `${label} download path`).toBeTruthy()

  const bytes = fs.readFileSync(downloadPath!)
  expect(bytes.length, `${label} 文件大小`).toBeGreaterThan(MIN_FILE_BYTES)
  expect(bytes[0]).toBe(0x89)
  expect(bytes[1]).toBe(0x50)
  expect(bytes[2]).toBe(0x4e)
  expect(bytes[3]).toBe(0x47)

  await page.getByTestId('ops-daily-export-close').click()
  await expect(page.getByTestId('ops-daily-export-preview')).toHaveCount(0)

  return { sample, downloadBytes: bytes.length }
}

test.describe('运营日报长图导出', () => {
  const today = formatDateKeyShanghai(new Date())
  const yesterday = addDaysShanghai(today, -1)

  test('今天与昨天日报导出预览非白图', async ({ page }) => {
    test.setTimeout(180_000)

    await gotoOperationsDailyReport(page, today)
    const todayResult = await exportAndAssertPreview(page, `today-${today}`)
    console.log(
      `[daily-report-image-export] today ${today}: ${todayResult.sample.naturalWidth}x${todayResult.sample.naturalHeight}, ${todayResult.downloadBytes} bytes, nonWhite=${todayResult.sample.nonWhitePixels}`,
    )

    await gotoOperationsDailyReport(page, yesterday)
    const yesterdayResult = await exportAndAssertPreview(page, `yesterday-${yesterday}`)
    console.log(
      `[daily-report-image-export] yesterday ${yesterday}: ${yesterdayResult.sample.naturalWidth}x${yesterdayResult.sample.naturalHeight}, ${yesterdayResult.downloadBytes} bytes, nonWhite=${yesterdayResult.sample.nonWhitePixels}`,
    )
  })
})
