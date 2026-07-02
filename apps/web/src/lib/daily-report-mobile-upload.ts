import { API_PREFIX } from './api'

const REPORT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidReportDate(value: string): boolean {
  return REPORT_DATE_RE.test(value.trim())
}

export function buildDailyReportMobileUploadUrl(reportDate: string, token: string): string {
  const params = new URLSearchParams({
    date: reportDate.trim(),
    token: token.trim(),
  })
  return `${window.location.origin}/mobile/daily-report-upload?${params.toString()}`
}

export interface DailyReportUploadTokenPayload {
  token: string
  expiresAt: string
  expiresInSeconds: number
}

export async function uploadDailyReportImageMobile(params: {
  reportDate: string
  uploadToken: string
  file: File
  caption?: string
}): Promise<void> {
  const form = new FormData()
  form.append('reportDate', params.reportDate)
  form.append('uploadToken', params.uploadToken)
  form.append('caption', params.caption?.trim() ?? '')
  form.append('file', params.file)

  const res = await fetch(`${API_PREFIX}/daily-report-images/mobile`, {
    method: 'POST',
    body: form,
  })
  const body = (await res.json()) as { ok?: boolean; message?: string }
  if (!res.ok || body.ok === false) {
    throw new Error(body.message || '上传失败')
  }
}
