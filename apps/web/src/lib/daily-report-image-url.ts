import { API_PREFIX } from './api'

export function resolveDailyReportImageFetchUrl(publicUrl: string): string {
  const trimmed = publicUrl.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith(API_PREFIX)) return trimmed
  return `${API_PREFIX}${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`
}

export async function fetchDailyReportImageBlobUrl(publicUrl: string): Promise<string | null> {
  const url = resolveDailyReportImageFetchUrl(publicUrl)
  if (!url) return null
  try {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.size) return null
    return URL.createObjectURL(blob)
  } catch {
    return null
  }
}
