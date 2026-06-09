export const YOUDAO_LICENSE_SHARE_KEY = '59fb59203600e841c444d96bad36d3e4'
export const YOUDAO_LICENSE_DISABLED_MESSAGE = '软件不可用，请联系17364583794 同V'

const NOTE_API =
  `https://note.youdao.com/yws/api/note/${YOUDAO_LICENSE_SHARE_KEY}` +
  '?sev=j1&editorType=1&editorVersion=new-json-editor'

function createUnloginId(): string {
  return `unlogin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function collectNoteText(raw: unknown): string[] {
  const parts: string[] = []
  if (raw == null) return parts
  if (typeof raw === 'string') {
    parts.push(raw)
    try {
      parts.push(JSON.stringify(JSON.parse(raw)))
    } catch {
      // ignore
    }
    return parts
  }
  if (typeof raw === 'object') {
    parts.push(JSON.stringify(raw))
    const content = (raw as { content?: unknown }).content
    if (typeof content === 'string') parts.push(content)
  }
  return parts
}

export function parseLiveAnalysisSwitch(text: string): 'on' | 'off' | 'missing' {
  const normalized = text.replace(/\\u003d/gi, '=').replace(/\s+/g, '')
  const hit = normalized.match(/\[?直播分析\]?=(开|关)/)
  if (!hit) return 'missing'
  return hit[1] === '关' ? 'off' : 'on'
}

export async function checkYoudaoLiveAnalysisLicense(options?: {
  timeoutMs?: number
  unloginId?: string
}): Promise<{
  allowed: boolean
  status: 'on' | 'off' | 'missing'
  reason?: string
  error?: string
}> {
  const timeoutMs = options?.timeoutMs ?? 15000
  const unloginId = options?.unloginId ?? createUnloginId()
  const url = `${NOTE_API}&unloginId=${encodeURIComponent(unloginId)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'live-business-web/0.2 license-check',
      },
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    const json = (await res.json()) as unknown
    const blob = collectNoteText(json).join('\n')
    const status = parseLiveAnalysisSwitch(blob)
    if (status === 'off') {
      return { allowed: false, status, reason: YOUDAO_LICENSE_DISABLED_MESSAGE }
    }
    return { allowed: true, status }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      allowed: false,
      status: 'missing',
      error: msg,
      reason: `无法读取有道云授权笔记，请检查网络后重试（${msg}）`,
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function assertYoudaoLiveAnalysisLicense(): Promise<void> {
  const result = await checkYoudaoLiveAnalysisLicense()
  if (result.allowed) return
  throw new Error(result.reason ?? YOUDAO_LICENSE_DISABLED_MESSAGE)
}
