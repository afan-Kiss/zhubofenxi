const DEFAULT_BASE = 'http://127.0.0.1:3001'

export function getMetricsBaseUrl(): string {
  return (process.env.METRICS_BASE_URL ?? process.env.E2E_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, '')
}

export interface ApiEnvelope<T> {
  ok: boolean
  data?: T
  message?: string
  success?: boolean
}

export class MetricsApiError extends Error {
  constructor(
    message: string,
    readonly meta: {
      url: string
      status: number
      body?: unknown
    },
  ) {
    super(message)
    this.name = 'MetricsApiError'
  }
}

export async function getJson<T>(
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<{ url: string; data: T }> {
  const base = getMetricsBaseUrl()
  const url = new URL(path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  })
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new MetricsApiError(`响应非 JSON: HTTP ${res.status}`, {
      url: url.toString(),
      status: res.status,
    })
  }
  if (!res.ok) {
    throw new MetricsApiError(`HTTP ${res.status}`, {
      url: url.toString(),
      status: res.status,
      body,
    })
  }
  const envelope = body as ApiEnvelope<T> & T
  if (typeof envelope === 'object' && envelope !== null && 'ok' in envelope) {
    if (!envelope.ok) {
      throw new MetricsApiError(envelope.message ?? '接口返回 ok=false', {
        url: url.toString(),
        status: res.status,
        body,
      })
    }
    return { url: url.toString(), data: envelope.data as T }
  }
  return { url: url.toString(), data: body as T }
}

export async function getHealth(): Promise<{ url: string; ok: boolean; service?: string }> {
  const base = getMetricsBaseUrl()
  const url = `${base}/api/health`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  const body = (await res.json()) as { ok?: boolean; service?: string }
  return { url, ok: body.ok === true, service: body.service }
}
