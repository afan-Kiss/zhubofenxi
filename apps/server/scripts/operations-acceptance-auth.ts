/**
 * 运营报表 HTTP 验收：自动登录或 local 免登录
 */
import { config as loadDotenv } from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from '../src/config/env'
import { prisma } from '../src/lib/prisma'
import { loginUser } from '../src/services/auth.service'
import { SESSION_COOKIE_NAME } from '../src/services/session.service'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
loadDotenv({ path: path.join(SCRIPT_DIR, '../.env') })
loadEnv()

const DEFAULT_BASE = (process.env.METRICS_BASE_URL ?? process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4723').replace(
  /\/$/,
  '',
)

const DEFAULT_USERNAME = process.env.ACCEPT_TEST_USERNAME?.trim() || 'admin'
const DEFAULT_PASSWORD = process.env.ACCEPT_TEST_PASSWORD?.trim() || 'admin123456'

let cachedCookieHeader: string | null | undefined

export function resetAcceptanceAuthCache(): void {
  cachedCookieHeader = undefined
}

async function tryLocalDbLogin(): Promise<string | null> {
  const passwordCandidates = [
    process.env.ACCEPT_TEST_PASSWORD?.trim(),
    process.env.ACCEPTANCE_LOGIN_PASSWORD?.trim(),
    DEFAULT_PASSWORD,
    'admin123456',
  ].filter((v): v is string => Boolean(v && v.length > 0))

  const users = await prisma.user.findMany({
    where: { enabled: true },
    orderBy: [{ createdAt: 'asc' }],
    take: 8,
    select: { username: true, managedPassword: true, role: true },
  })

  const orderedUsers = [
    ...users.filter((u) => u.role === 'super_admin'),
    ...users.filter((u) => u.role !== 'super_admin'),
  ]

  for (const user of orderedUsers) {
    const passwords = [...passwordCandidates]
    if (user.managedPassword?.trim()) {
      passwords.unshift(user.managedPassword.trim())
    }
    const tried = new Set<string>()
    for (const password of passwords) {
      if (tried.has(password)) continue
      tried.add(password)
      try {
        const { token } = await loginUser({
          username: user.username,
          password,
          audit: { ip: '127.0.0.1', userAgent: 'operations-acceptance-auth' },
        })
        return `${SESSION_COOKIE_NAME}=${token}`
      } catch {
        // try next password
      }
    }
  }
  return null
}

export async function resolveAcceptanceFetchHeaders(
  baseUrl: string = DEFAULT_BASE,
): Promise<Record<string, string>> {
  if (cachedCookieHeader !== undefined) {
    return cachedCookieHeader ? { Cookie: cachedCookieHeader } : {}
  }

  const modeRes = await fetch(`${baseUrl}/api/auth/mode`, {
    headers: { Accept: 'application/json' },
  }).catch(() => null)

  if (modeRes?.ok) {
    const modeBody = (await modeRes.json()) as { data?: { mode?: string } }
    if (modeBody.data?.mode === 'local') {
      cachedCookieHeader = null
      return {}
    }
  }

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD }),
  }).catch(() => null)

  if (loginRes?.ok) {
    const loginBody = (await loginRes.json()) as { ok?: boolean; message?: string }
    if (loginBody.ok) {
      const setCookie = loginRes.headers.getSetCookie?.() ?? []
      const cookiePair = setCookie
        .map((c) => c.split(';')[0]?.trim())
        .filter(Boolean)
        .join('; ')
      if (cookiePair) {
        cachedCookieHeader = cookiePair
        return { Cookie: cookiePair }
      }
      const raw = loginRes.headers.get('set-cookie')
      if (raw) {
        cachedCookieHeader = raw.split(';')[0] ?? null
        if (cachedCookieHeader) return { Cookie: cachedCookieHeader }
      }
    }
  }

  const dbCookie = await tryLocalDbLogin()
  if (dbCookie) {
    cachedCookieHeader = dbCookie
    return { Cookie: dbCookie }
  }

  throw new Error(
    `验收登录失败（${DEFAULT_USERNAME}），请设置 ACCEPT_TEST_USERNAME / ACCEPT_TEST_PASSWORD / ACCEPTANCE_LOGIN_PASSWORD，或启动 AUTH_MODE=local`,
  )
}

export async function acceptanceFetch(
  path: string,
  init?: RequestInit & { query?: Record<string, string | undefined>; baseUrl?: string },
): Promise<Response> {
  const base = (init?.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '')
  const url = new URL(`${base}${path}`)
  if (init?.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v))
    }
  }
  const authHeaders = await resolveAcceptanceFetchHeaders(base)
  const { query: _q, baseUrl: _b, ...rest } = init ?? {}
  return fetch(url.toString(), {
    ...rest,
    headers: {
      Accept: 'application/json',
      ...authHeaders,
      ...(rest.headers as Record<string, string> | undefined),
    },
  })
}
