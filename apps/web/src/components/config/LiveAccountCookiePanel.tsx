import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiRequest } from '../../lib/api'
import {
  cookieAvailableLabel,
  cookieAvailableTone,
  cookieStatusLabel,
  cookieUploadSourceLabel,
  getAccountDisplayName,
  partitionLiveAccounts,
  resolveAccountCookieAvailable,
  resolveHealthFriendlyLabel,
  clearCookieExpiredModalShownKeys,
  type CookieHealthStatus,
  type LiveAccountPublic,
} from '../../lib/live-account'

type CookieTestStatus = 'valid' | 'invalid' | 'limited' | 'unknown' | 'testing'

type CookieTestResult = {
  ok: boolean
  message: string
  checkedAt: string
  accountId: string
  accountName: string
  apiName?: string
  status?: CookieTestStatus
}

type BatchProgress = {
  current: number
  total: number
  success: number
  failed: number
  currentName: string
  done: boolean
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

function mapCookieStatus(status: CookieHealthStatus): CookieTestStatus {
  if (status === 'valid') return 'valid'
  return 'invalid'
}

function testStatusLabel(status: CookieTestStatus | undefined): string {
  switch (status) {
    case 'valid':
      return '可用'
    case 'invalid':
      return '不可用'
    case 'testing':
      return '检测中'
    default:
      return '未检测'
  }
}

function testStatusTone(status: CookieTestStatus | undefined): string {
  switch (status) {
    case 'valid':
      return 'text-emerald-700 bg-emerald-50'
    case 'invalid':
      return 'text-rose-700 bg-rose-50'
    case 'testing':
      return 'text-indigo-700 bg-indigo-50'
    default:
      return 'text-slate-600 bg-slate-100'
  }
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* fallback */
    }
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } finally {
    document.body.removeChild(ta)
  }
  return ok
}

function applyTestResultToAccount(
  account: LiveAccountPublic,
  result: CookieTestResult,
): LiveAccountPublic {
  const available = result.ok
  return {
    ...account,
    cookieStatus: available ? 'valid' : 'invalid',
    canSyncOrders: available,
    healthStatus: available ? 'ok' : 'invalid',
    cookieLastCheckedAt: result.checkedAt,
    cookieLastErrorMessage: available ? null : result.message,
    syncReason: available ? 'Cookie 已验证有效，可同步订单' : result.message,
    statusLevel: available ? 'ok' : 'error',
    cookieDisplayStatus: available ? 'valid' : 'invalid',
  }
}
function parseTestResponse(
  res: {
    ok: boolean
    message: string
    cookieStatus?: CookieHealthStatus
    checkedAt?: string
    apiName?: string
    status?: string
    name?: string
  },
  account: LiveAccountPublic,
): CookieTestResult {
  const statusFromRes = res.status as CookieTestStatus | undefined
  const status: CookieTestStatus =
    statusFromRes ??
    (res.cookieStatus
      ? mapCookieStatus(res.cookieStatus)
      : res.ok
        ? 'valid'
        : 'invalid')
  return {
    ok: res.ok,
    message: res.message,
    checkedAt: res.checkedAt ?? new Date().toISOString(),
    accountId: account.id,
    accountName: res.name ?? account.name,
    apiName: res.apiName ?? '订单接口',
    status,
  }
}

function mergeAccounts(
  prev: LiveAccountPublic[],
  incoming: LiveAccountPublic[],
): LiveAccountPublic[] {
  const byId = new Map(incoming.map((a) => [a.id, a]))
  const merged = prev.map((a) => {
    const next = byId.get(a.id)
    if (!next) return a
    const prevCookie = resolveAccountCookie(a)
    const nextCookie = resolveAccountCookie(next)
    const cookie = nextCookie || prevCookie || null
    return {
      ...next,
      cookie,
      cookieText: cookie,
    }
  })
  const prevIds = new Set(prev.map((a) => a.id))
  return merged.concat(incoming.filter((a) => !prevIds.has(a.id)))
}

function resolveAccountCookie(account: LiveAccountPublic): string {
  return (account.cookieText ?? account.cookie ?? '').trim()
}

async function hydrateAccountCookies(
  accounts: LiveAccountPublic[],
  options?: { force?: boolean },
): Promise<LiveAccountPublic[]> {
  const needFetch = accounts.filter(
    (a) => a.hasCookie && (options?.force || !resolveAccountCookie(a)),
  )
  if (needFetch.length === 0) return accounts

  const cookieById = new Map<string, string>()
  for (const account of needFetch) {
    try {
      const res = await apiRequest<{ cookie?: string; cookieText?: string }>(
        `/api/settings/live-accounts/${account.id}/cookie`,
      )
      const text = (res.cookieText ?? res.cookie ?? '').trim()
      if (text) cookieById.set(account.id, text)
    } catch {
      /* 单账号失败不影响其他账号 */
    }
  }

  if (cookieById.size === 0) return accounts
  return accounts.map((a) => {
    const text = cookieById.get(a.id)
    if (!text) return a
    return { ...a, cookie: text, cookieText: text }
  })
}

export const LiveAccountCookiePanel: React.FC = () => {
  const [accounts, setAccounts] = useState<LiveAccountPublic[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCookie, setNewCookie] = useState('')
  const [editCookies, setEditCookies] = useState<Record<string, string>>({})
  const [editNames, setEditNames] = useState<Record<string, string>>({})
  const [editingNameId, setEditingNameId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set())
  const [testResults, setTestResults] = useState<Record<string, CookieTestResult>>({})
  const [batchTesting, setBatchTesting] = useState(false)
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null)
  const [qualityHints, setQualityHints] = useState<
    Record<string, { orderApiStatus: string; qualityApiHint: string }>
  >({})
  const toastTimer = useRef<number | null>(null)
  const accountsRef = useRef<LiveAccountPublic[]>([])
  const testResultsRef = useRef<Record<string, CookieTestResult>>({})
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null)
  const [purgingLegacy, setPurgingLegacy] = useState(false)

  useEffect(() => {
    accountsRef.current = accounts
  }, [accounts])

  useEffect(() => {
    testResultsRef.current = testResults
  }, [testResults])

  const showToast = useCallback((type: 'ok' | 'err', text: string) => {
    setToast({ type, text })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2800)
  }, [])

  const refreshAccounts = useCallback(async (options?: { silent?: boolean }) => {
    const scrollY = options?.silent ? window.scrollY : undefined
    if (!options?.silent) setLoading(true)
    try {
      const [res, health] = await Promise.all([
        apiRequest<{ accounts: LiveAccountPublic[] }>('/api/settings/live-accounts'),
        apiRequest<{
          qualityBadCaseSync?: {
            perAccountHints?: Array<{
              liveAccountId: string
              orderApiStatus: string
              qualityApiHint: string
            }>
          }
        }>('/api/settings/live-accounts/cookie-health'),
      ])
      let nextAccounts =
        options?.silent && accountsRef.current.length > 0
          ? mergeAccounts(accountsRef.current, res.accounts)
          : res.accounts
      nextAccounts = await hydrateAccountCookies(nextAccounts, { force: true })
      const sessionTests = testResultsRef.current
      nextAccounts = nextAccounts.map((account) => {
        const test = sessionTests[account.id]
        if (!test || test.status === 'testing') return account
        const testAt = Date.parse(test.checkedAt)
        const serverAt = account.cookieLastCheckedAt ? Date.parse(account.cookieLastCheckedAt) : 0
        const uploadedAt = account.cookieUpdatedAt ? Date.parse(account.cookieUpdatedAt) : 0
        if (!Number.isNaN(uploadedAt) && uploadedAt > testAt) return account
        if (!Number.isNaN(testAt) && testAt > serverAt) {
          return applyTestResultToAccount(account, test)
        }
        return account
      })
      setAccounts(nextAccounts)
      setTestResults((prev) => {
        const next = { ...prev }
        for (const [id, test] of Object.entries(prev)) {
          if (test.status === 'testing') continue
          const account = nextAccounts.find((a) => a.id === id)
          if (!account) {
            delete next[id]
            continue
          }
          const testAt = Date.parse(test.checkedAt)
          const serverAt = account.cookieLastCheckedAt ? Date.parse(account.cookieLastCheckedAt) : 0
          const uploadedAt = account.cookieUpdatedAt ? Date.parse(account.cookieUpdatedAt) : 0
          if (!Number.isNaN(uploadedAt) && uploadedAt > testAt) {
            delete next[id]
            continue
          }
          if (Number.isNaN(testAt) || serverAt >= testAt) {
            delete next[id]
          }
        }
        return next
      })
      const hints: Record<string, { orderApiStatus: string; qualityApiHint: string }> = {}
      for (const h of health.qualityBadCaseSync?.perAccountHints ?? []) {
        hints[h.liveAccountId] = {
          orderApiStatus: h.orderApiStatus,
          qualityApiHint: h.qualityApiHint,
        }
      }
      setQualityHints(hints)
      if (options?.silent && scrollY != null) {
        requestAnimationFrame(() => window.scrollTo({ top: scrollY }))
      }
    } catch (e) {
      if (!options?.silent) {
        showToast('err', e instanceof Error ? e.message : '加载失败')
      }
    } finally {
      if (!options?.silent) setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    void refreshAccounts()
  }, [refreshAccounts])

  useEffect(() => {
    const onFocus = () => void refreshAccounts({ silent: true })
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshAccounts])

  const patchAccount = useCallback((account: LiveAccountPublic) => {
    setAccounts((prev) =>
      prev.map((a) => {
        if (a.id !== account.id) return a
        const cookie = resolveAccountCookie(account) || resolveAccountCookie(a)
        return {
          ...a,
          ...account,
          cookie: cookie || (account.cookie ?? a.cookie ?? null),
          cookieText: cookie || (account.cookieText ?? a.cookieText ?? null),
        }
      }),
    )
  }, [])

  const handleCopyCookie = async (account: LiveAccountPublic) => {
    let cookie = resolveAccountCookie(account)
    if (!cookie && account.hasCookie) {
      try {
        const res = await apiRequest<{ cookie?: string; cookieText?: string }>(
          `/api/settings/live-accounts/${account.id}/cookie`,
        )
        cookie = (res.cookieText ?? res.cookie ?? '').trim()
        if (cookie) {
          setAccounts((prev) =>
            prev.map((a) =>
              a.id === account.id ? { ...a, cookie, cookieText: cookie } : a,
            ),
          )
        }
      } catch {
        /* handled below */
      }
    }
    if (!cookie) {
      showToast('err', '当前账号暂无 Cookie')
      return
    }
    const ok = await copyTextToClipboard(cookie)
    showToast(ok ? 'ok' : 'err', ok ? '已复制 Cookie' : '复制失败，请手动选中复制')
  }

  const runSingleTest = async (account: LiveAccountPublic): Promise<CookieTestResult> => {
    setTestingIds((prev) => new Set(prev).add(account.id))
    setTestResults((prev) => ({
      ...prev,
      [account.id]: {
        ok: false,
        message: '检测中…',
        checkedAt: new Date().toISOString(),
        accountId: account.id,
        accountName: account.name,
        status: 'testing',
      },
    }))
    try {
      const res = await apiRequest<{
        ok: boolean
        message: string
        cookieStatus?: CookieHealthStatus
        checkedAt?: string
        apiName?: string
        status?: string
        name?: string
      }>(`/api/settings/live-accounts/${account.id}/test-cookie`, { method: 'POST' })
      const result = parseTestResponse(res, account)
      setTestResults((prev) => ({ ...prev, [account.id]: result }))
      setAccounts((prev) =>
        prev.map((a) => (a.id === account.id ? applyTestResultToAccount(a, result) : a)),
      )
      return result
    } catch (e) {
      const result: CookieTestResult = {
        ok: false,
        message: e instanceof Error ? e.message : '检测失败',
        checkedAt: new Date().toISOString(),
        accountId: account.id,
        accountName: account.name,
        apiName: '订单接口',
        status: 'invalid',
      }
      setTestResults((prev) => ({ ...prev, [account.id]: result }))
      setAccounts((prev) =>
        prev.map((a) => (a.id === account.id ? applyTestResultToAccount(a, result) : a)),
      )
      return result
    } finally {
      setTestingIds((prev) => {
        const next = new Set(prev)
        next.delete(account.id)
        return next
      })
    }
  }

  const handleTest = async (account: LiveAccountPublic) => {
    if (testingIds.has(account.id) || batchTesting) return
    await runSingleTest(account)
  }

  const handleTestAllEnabledCookies = async () => {
    if (batchTesting) return
    const targets = activeAccounts.filter((a) => a.enabled && a.hasCookie)
    if (targets.length === 0) {
      showToast('err', '暂无可检测的启用直播号，请先添加或启用 Cookie。')
      return
    }

    setBatchTesting(true)
    let success = 0
    let failed = 0
    setBatchProgress({
      current: 0,
      total: targets.length,
      success: 0,
      failed: 0,
      currentName: getAccountDisplayName(targets[0]!),
      done: false,
    })

    for (let i = 0; i < targets.length; i++) {
      const account = targets[i]!
      setBatchProgress({
        current: i + 1,
        total: targets.length,
        success,
        failed,
        currentName: getAccountDisplayName(account),
        done: false,
      })
      const result = await runSingleTest(account)
      if (result.ok) success++
      else failed++
      setBatchProgress({
        current: i + 1,
        total: targets.length,
        success,
        failed,
        currentName: getAccountDisplayName(account),
        done: false,
      })
    }

    setBatchProgress({
      current: targets.length,
      total: targets.length,
      success,
      failed,
      currentName: '',
      done: true,
    })
    setBatchTesting(false)
    await refreshAccounts({ silent: true })
  }

  const handleCreate = async () => {
    if (!newName.trim() || !newCookie.trim()) {
      showToast('err', '请填写直播号名称和 Cookie')
      return
    }
    setCreating(true)
    try {
      const res = await apiRequest<LiveAccountPublic & { message?: string }>(
        '/api/settings/live-accounts',
        {
          method: 'POST',
          body: JSON.stringify({ name: newName.trim(), cookie: newCookie.trim(), enabled: true }),
        },
      )
      setNewName('')
      setNewCookie('')
      if (res.id) {
        setAccounts((prev) => [...prev, res])
      } else {
        await refreshAccounts({ silent: true })
      }
      showToast('ok', res.message ?? '直播号已创建')
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }

  const handleUpdateCookie = async (id: string) => {
    const cookie = editCookies[id]?.trim()
    if (!cookie) {
      showToast('err', '请粘贴新的 Cookie')
      return
    }
    setBusyId(id)
    try {
      const res = await apiRequest<LiveAccountPublic & { message?: string }>(
        `/api/settings/live-accounts/${id}/cookie`,
        {
          method: 'PUT',
          body: JSON.stringify({ cookie }),
        },
      )
      setEditCookies((prev) => ({ ...prev, [id]: '' }))
      patchAccount(res)
      setTestResults((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      showToast('ok', res.message ?? 'Cookie 已更新')
      clearCookieExpiredModalShownKeys()
      await refreshAccounts({ silent: true })
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : '更新失败')
    } finally {
      setBusyId(null)
    }
  }

  const handleSaveName = async (id: string) => {
    const name = (editNames[id] ?? '').trim()
    if (!name) {
      showToast('err', '直播号名称不能为空')
      return
    }
    setBusyId(id)
    try {
      const updated = await apiRequest<LiveAccountPublic>(`/api/settings/live-accounts/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      })
      setEditingNameId(null)
      patchAccount({ ...updated, cookie: accountsRef.current.find((a) => a.id === id)?.cookie ?? updated.cookie, cookieText: accountsRef.current.find((a) => a.id === id)?.cookieText ?? updated.cookieText })
      showToast('ok', '直播号名称已更新')
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : '更新名称失败')
    } finally {
      setBusyId(null)
    }
  }

  const handleToggleEnabled = async (account: LiveAccountPublic) => {
    setBusyId(account.id)
    try {
      const updated = await apiRequest<LiveAccountPublic>(`/api/settings/live-accounts/${account.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !account.enabled }),
      })
      patchAccount({ ...updated, cookie: account.cookie, cookieText: account.cookieText ?? account.cookie })
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : '更新失败')
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (account: LiveAccountPublic) => {
    const ok = window.confirm(
      '删除后该直播号不再参与同步，已产生的历史订单不会删除。确定删除吗？',
    )
    if (!ok) return
    setBusyId(account.id)
    try {
      await apiRequest(`/api/settings/live-accounts/${account.id}`, { method: 'DELETE' })
      setAccounts((prev) => prev.filter((a) => a.id !== account.id))
      setTestResults((prev) => {
        const next = { ...prev }
        delete next[account.id]
        return next
      })
      showToast('ok', `已删除直播号「${account.name}」`)
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : '删除失败')
    } finally {
      setBusyId(null)
    }
  }

  const toggleAccountExpanded = (id: string) => {
    setExpandedAccountId((prev) => (prev === id ? null : id))
  }

  const { activeAccounts, legacyAccounts } = useMemo(
    () => partitionLiveAccounts(accounts),
    [accounts],
  )

  const handlePurgeLegacyAccounts = async () => {
    if (legacyAccounts.length === 0) return
    const ok = window.confirm(
      `确定删除全部 ${legacyAccounts.length} 个历史重复账号吗？\n\n仅删除系统设置中的账号配置，已同步的订单和直播数据不会删除。`,
    )
    if (!ok) return
    setPurgingLegacy(true)
    try {
      const result = await apiRequest<{
        deletedCount: number
        deletedIds: string[]
        deletedNames: string[]
        message: string
      }>('/api/settings/live-accounts/legacy-duplicates', { method: 'DELETE' })
      const removed = new Set(result.deletedIds)
      setAccounts((prev) => prev.filter((a) => !removed.has(a.id)))
      setTestResults((prev) => {
        const next = { ...prev }
        for (const id of removed) delete next[id]
        return next
      })
      showToast('ok', result.message || `已删除 ${result.deletedCount} 个历史账号`)
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : '删除历史账号失败')
    } finally {
      setPurgingLegacy(false)
    }
  }

  const stats = useMemo(() => {
    const enabled = activeAccounts.filter((a) => a.enabled)
    const available = enabled.filter((a) => resolveAccountCookieAvailable(a, testResults[a.id])).length
    const checking = enabled.filter((a) => {
      const test = testResults[a.id]
      return test?.status === 'testing' || testingIds.has(a.id)
    }).length
    const unavailable = Math.max(0, enabled.length - available - checking)
    return { available, unavailable, checking }
  }, [activeAccounts, testResults, testingIds])

  const renderTestResultBlock = (account: LiveAccountPublic) => {
    const latest = testResults[account.id]
    const isTesting = testingIds.has(account.id)
    const available = resolveAccountCookieAvailable(account, latest)
    const displayStatus: CookieTestStatus = isTesting
      ? 'testing'
      : available
        ? 'valid'
        : 'invalid'
    const showSessionResult =
      latest &&
      latest.status !== 'testing' &&
      Date.parse(latest.checkedAt) >=
        (account.cookieLastCheckedAt ? Date.parse(account.cookieLastCheckedAt) : 0)

    return (
      <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/80 p-2.5 text-[11px]">
        <div className="grid gap-1.5 sm:grid-cols-2">
          <div>
            <span className="text-slate-400">Cookie 状态：</span>
            <span
              className={`ml-1 inline-flex rounded px-1.5 py-0.5 font-medium ${testStatusTone(displayStatus)}`}
            >
              {testStatusLabel(displayStatus)}
            </span>
          </div>
          <div>
            <span className="text-slate-400">最近检测时间：</span>
            <span className="text-slate-700">
              {formatTime(showSessionResult ? latest!.checkedAt : account.cookieLastCheckedAt)}
            </span>
          </div>
          {!available ? (
            <div className="sm:col-span-2">
              <span className="text-slate-400">状态说明：</span>
              <span className="text-rose-700">
                {resolveHealthFriendlyLabel(account, latest)}
              </span>
            </div>
          ) : null}
        </div>
        {(showSessionResult || isTesting) && (
          <div className="mt-2 border-t border-slate-200 pt-2">
            <span className="text-slate-400">本次检测：</span>
            {isTesting ? (
              <span className="ml-1 text-indigo-700">检测中…</span>
            ) : showSessionResult && latest ? (
              <>
                <span
                  className={`ml-1 inline-flex rounded px-1.5 py-0.5 font-medium ${testStatusTone(latest.ok ? 'valid' : 'invalid')}`}
                >
                  {latest.ok ? '通过' : '未通过'}
                </span>
                <span className="ml-2 text-slate-500">{formatTime(latest.checkedAt)}</span>
                {latest.apiName ? (
                  <span className="ml-2 text-slate-500">· {latest.apiName}</span>
                ) : null}
                <p className={`mt-1 ${latest.ok ? 'text-emerald-800' : 'text-rose-700'}`}>
                  {latest.message}
                </p>
              </>
            ) : null}
          </div>
        )}
      </div>
    )
  }

  const renderAccountRows = (
    accountList: LiveAccountPublic[],
    options?: { legacy?: boolean },
  ) =>
    accountList.map((account) => {
      const isTesting = testingIds.has(account.id)
      const isBusy = busyId === account.id
      const cookieText = resolveAccountCookie(account)
      const accountExpanded = expandedAccountId === account.id
      const latestTest = testResults[account.id]
      const cookieAvailable = resolveAccountCookieAvailable(account, latestTest)
      const cookieReason = resolveHealthFriendlyLabel(account, latestTest)
      const displayName = getAccountDisplayName(account)
      const isLegacy = options?.legacy === true

      return (
        <React.Fragment key={account.id}>
          <tr
            className={`border-b border-slate-100 ${
              accountExpanded ? 'bg-indigo-50/40' : 'hover:bg-slate-50/80'
            } ${isLegacy ? 'bg-amber-50/20' : ''}`}
          >
            <td className="px-3 py-2.5 font-medium text-slate-900">
              <div className="space-y-1">
                <span>{displayName}</span>
                {isLegacy ? (
                  <span className="block text-[10px] font-normal leading-snug text-amber-800">
                    这是旧账号，系统现在不会用它同步订单。四店 Cookie 请看上面的官方账号。
                  </span>
                ) : account.officialShopKey ? (
                  <span className="block text-[10px] font-normal text-indigo-600">
                    四店官方账号 · 外部上传覆盖此条
                  </span>
                ) : null}
              </div>
            </td>
            <td className="px-3 py-2.5">
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  account.enabled
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {account.enabled ? '已启用' : '已停用'}
              </span>
            </td>
            <td className="px-3 py-2.5">
              <div className="space-y-1">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${cookieAvailableTone(cookieAvailable)}`}
                >
                  {cookieAvailableLabel(cookieAvailable)}
                </span>
                {cookieReason && !cookieAvailable ? (
                  <p className="max-w-[260px] text-[10px] leading-snug text-rose-700">{cookieReason}</p>
                ) : cookieAvailable ? (
                  <p className="max-w-[260px] text-[10px] leading-snug text-emerald-700">
                    {account.cookieLastCheckedAt || latestTest?.ok ? '校验通过' : '已收到 Cookie'}
                  </p>
                ) : null}
                {isTesting ? (
                  <span className="block text-[10px] text-indigo-600">检测中</span>
                ) : null}
              </div>
            </td>
            <td className="px-3 py-2.5 text-slate-600">
              {formatTime(account.lastSyncSuccessAt)}
            </td>
            <td className="px-3 py-2.5 text-slate-600">
              <div className="space-y-0.5">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    account.cookieUploadSource === 'api'
                      ? 'bg-indigo-50 text-indigo-700'
                      : account.cookieUploadSource === 'manual'
                        ? 'bg-slate-100 text-slate-700'
                        : 'bg-slate-50 text-slate-400'
                  }`}
                >
                  {cookieUploadSourceLabel(account.cookieUploadSource)}
                </span>
                <p className="text-[10px] text-slate-500">{formatTime(account.cookieUpdatedAt)}</p>
              </div>
            </td>
            <td className="px-3 py-2.5">
              <div className="flex flex-wrap justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => toggleAccountExpanded(account.id)}
                  className="rounded border border-slate-200 px-2 py-1 text-[11px] hover:bg-white"
                >
                  {accountExpanded ? '收起' : '详情'}
                </button>
                {!isLegacy ? (
                  <button
                    type="button"
                    disabled={isTesting || batchTesting || isBusy || !account.hasCookie}
                    onClick={() => void handleTest(account)}
                    className="rounded border border-indigo-200 px-2 py-1 text-[11px] text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                  >
                    检测
                  </button>
                ) : null}
              </div>
            </td>
          </tr>
          {accountExpanded ? (
            <tr className="border-b border-slate-100 bg-slate-50/50">
              <td colSpan={6} className="px-3 py-3">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  {isLegacy ? (
                    <p className="mb-3 rounded-lg border border-amber-100 bg-amber-50/80 px-2.5 py-2 text-[11px] text-amber-900">
                      历史重复账号仅保留查看，不参与四店上传和订单同步。请使用上方对应官方账号。
                    </p>
                  ) : null}
                  {editingNameId === account.id && !isLegacy ? (
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <input
                        value={editNames[account.id] ?? account.name}
                        onChange={(e) =>
                          setEditNames((prev) => ({
                            ...prev,
                            [account.id]: e.target.value,
                          }))
                        }
                        className="rounded border border-slate-200 px-2 py-1 text-sm"
                      />
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleSaveName(account.id)}
                        className="rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
                      >
                        保存名称
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingNameId(null)}
                        className="text-xs text-slate-500"
                      >
                        取消
                      </button>
                    </div>
                  ) : !isLegacy ? (
                    <div className="mb-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={isBusy || Boolean(account.officialShopKey)}
                        onClick={() => {
                          setEditingNameId(account.id)
                          setEditNames((prev) => ({
                            ...prev,
                            [account.id]: account.name,
                          }))
                        }}
                        className="text-[11px] text-slate-500 underline hover:text-slate-800 disabled:opacity-50"
                      >
                        编辑名称
                      </button>
                      <button
                        type="button"
                        disabled={!cookieText.trim() || isBusy}
                        onClick={() => void handleCopyCookie(account)}
                        className="text-[11px] text-slate-500 underline hover:text-slate-800 disabled:opacity-50"
                      >
                        复制 Cookie
                      </button>
                      <button
                        type="button"
                        disabled={isBusy || batchTesting}
                        onClick={() => void handleToggleEnabled(account)}
                        className="text-[11px] text-slate-500 underline hover:text-slate-800"
                      >
                        {account.enabled ? '停用' : '启用'}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy || batchTesting}
                        onClick={() => void handleDelete(account)}
                        className="text-[11px] text-rose-600 underline hover:text-rose-800"
                      >
                        删除
                      </button>
                    </div>
                  ) : (
                    <div className="mb-3">
                      <button
                        type="button"
                        disabled={!cookieText.trim() || isBusy}
                        onClick={() => void handleCopyCookie(account)}
                        className="text-[11px] text-slate-500 underline hover:text-slate-800 disabled:opacity-50"
                      >
                        复制 Cookie（仅查看）
                      </button>
                    </div>
                  )}

                  {!isLegacy ? renderTestResultBlock(account) : null}

                  <div className="mt-3">
                    <label className="text-xs font-medium text-slate-700">当前 Cookie</label>
                    {account.hasCookie ? (
                      <textarea
                        readOnly
                        value={cookieText}
                        rows={4}
                        className="mt-1 max-h-40 min-h-[4rem] w-full resize-y overflow-auto rounded border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-slate-800"
                      />
                    ) : (
                      <p className="mt-1 text-xs text-slate-500">尚未保存 Cookie</p>
                    )}
                  </div>

                  {!isLegacy ? (
                    <>
                      <dl className="mt-3 grid gap-2 text-[11px] text-slate-600 sm:grid-cols-2">
                        <div>
                          <dt className="text-slate-400">最近成功同步</dt>
                          <dd>{formatTime(account.lastSyncSuccessAt)}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-400">Cookie 来源</dt>
                          <dd>{cookieUploadSourceLabel(account.cookieUploadSource)}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-400">Cookie 更新时间</dt>
                          <dd>{formatTime(account.cookieUpdatedAt)}</dd>
                        </div>
                        {qualityHints[account.id] ? (
                          <div className="sm:col-span-2">
                            <dt className="text-slate-400">接口探测</dt>
                            <dd>
                              订单接口：
                              {cookieStatusLabel(
                                qualityHints[account.id]!
                                  .orderApiStatus as LiveAccountPublic['cookieStatus'],
                              )}
                              {' · '}
                              官方品退：{qualityHints[account.id]!.qualityApiHint}
                            </dd>
                          </div>
                        ) : null}
                      </dl>

                      <div className="mt-3 border-t border-slate-100 pt-3">
                        <label className="text-xs text-slate-600">
                          更新 Cookie（粘贴新内容后保存）
                        </label>
                        <textarea
                          value={editCookies[account.id] ?? ''}
                          onChange={(e) =>
                            setEditCookies((prev) => ({
                              ...prev,
                              [account.id]: e.target.value,
                            }))
                          }
                          rows={2}
                          className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-xs"
                          placeholder="从浏览器开发者工具复制 Cookie"
                        />
                        <button
                          type="button"
                          disabled={isBusy || batchTesting}
                          onClick={() => void handleUpdateCookie(account.id)}
                          className="mt-2 rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                          {isBusy ? '保存中…' : '更新 Cookie'}
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              </td>
            </tr>
          ) : null}
        </React.Fragment>
      )
    })

  const renderAccountTable = (
    accountList: LiveAccountPublic[],
    options?: { legacy?: boolean },
  ) => (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-[720px] w-full text-left text-xs">
        <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2 font-medium">直播号</th>
            <th className="px-3 py-2 font-medium">启用</th>
            <th className="px-3 py-2 font-medium">Cookie 状态</th>
            <th className="px-3 py-2 font-medium">最近同步</th>
            <th className="px-3 py-2 font-medium">Cookie 来源 / 时间</th>
            <th className="px-3 py-2 font-medium text-right">操作</th>
          </tr>
        </thead>
        <tbody>{renderAccountRows(accountList, options)}</tbody>
      </table>
    </div>
  )

  return (
    <section id="live-account-cookie" className="scroll-mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-800">直播号 Cookie 管理</h3>
          <p className="mt-1 text-xs text-slate-500">
            上面四条官方账号就是系统实际使用的 Cookie。外部程序上传后，只会覆盖这里对应店铺的官方账号。
          </p>
        </div>
        <button
          type="button"
          disabled={batchTesting || loading || activeAccounts.length === 0}
          onClick={() => void handleTestAllEnabledCookies()}
          className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {batchTesting ? '批量检测中…' : '检测全部启用 Cookie'}
        </button>
      </div>

      {!loading && activeAccounts.length > 0 ? (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2">
            <p className="text-[10px] text-emerald-700">可用</p>
            <p className="mt-0.5 text-lg font-semibold text-emerald-800">{stats.available}</p>
          </div>
          <div
            className={`rounded-lg border px-3 py-2 ${
              stats.unavailable > 0
                ? 'border-rose-100 bg-rose-50/70'
                : 'border-slate-100 bg-slate-50'
            }`}
          >
            <p className={`text-[10px] ${stats.unavailable > 0 ? 'text-rose-700' : 'text-slate-500'}`}>
              需要处理
            </p>
            <p
              className={`mt-0.5 text-lg font-semibold ${
                stats.unavailable > 0 ? 'text-rose-800' : 'text-slate-900'
              }`}
            >
              {stats.unavailable}
            </p>
          </div>
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2">
            <p className="text-[10px] text-indigo-700">检测中</p>
            <p className="mt-0.5 text-lg font-semibold text-indigo-800">{stats.checking}</p>
          </div>
        </div>
      ) : null}

      {toast && (
        <p
          className={`fixed bottom-4 right-4 z-50 rounded-lg px-3 py-2 text-xs shadow-lg ${
            toast.type === 'ok' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
          }`}
        >
          {toast.text}
        </p>
      )}

      {batchProgress && (
        <div
          className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
            batchProgress.done
              ? batchProgress.failed > 0
                ? batchProgress.success > 0
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-rose-200 bg-rose-50 text-rose-900'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-indigo-200 bg-indigo-50 text-indigo-900'
          }`}
        >
          {batchProgress.done ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>
                检测完成：可用 {batchProgress.success} 个，不可用 {batchProgress.failed} 个（共{' '}
                {batchProgress.total} 个）
              </p>
              <button
                type="button"
                onClick={() => setBatchProgress(null)}
                className="shrink-0 rounded border border-current/20 px-2 py-0.5 text-[11px] hover:bg-white/60"
              >
                关闭
              </button>
            </div>
          ) : (
            <>
              <p>
                正在检测 {batchProgress.current}/{batchProgress.total}，可用 {batchProgress.success}{' '}
                个，不可用 {batchProgress.failed} 个
              </p>
              <p className="mt-1 text-indigo-700">正在检测「{batchProgress.currentName}」…</p>
            </>
          )}
        </div>
      )}

      {loading ? (
        <p className="mt-4 text-xs text-slate-500">加载中…</p>
      ) : activeAccounts.length === 0 && legacyAccounts.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-600">
          暂无直播号，请在下方添加，或通过外部程序调用上传接口写入 Cookie。
        </p>
      ) : null}

      {!loading && activeAccounts.length > 0 ? (
        <div className="mt-4">{renderAccountTable(activeAccounts)}</div>
      ) : null}

      {!loading && legacyAccounts.length > 0 ? (
        <details className="mt-4 rounded-lg border border-amber-100 bg-amber-50/40">
          <summary className="flex cursor-pointer select-none flex-wrap items-center justify-between gap-2 px-3 py-2.5">
            <span className="text-xs font-medium text-amber-900">
              历史重复账号（不参与四店上传和同步）
              <span className="ml-2 font-normal text-amber-700">共 {legacyAccounts.length} 条</span>
            </span>
            <button
              type="button"
              disabled={purgingLegacy || batchTesting}
              onClick={(e) => {
                e.preventDefault()
                void handlePurgeLegacyAccounts()
              }}
              className="rounded border border-rose-200 bg-white px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              {purgingLegacy ? '删除中…' : '全部删除'}
            </button>
          </summary>
          <div className="border-t border-amber-100 px-1 pb-1 pt-1">
            {renderAccountTable(legacyAccounts, { legacy: true })}
          </div>
        </details>
      ) : null}

      <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-[11px] text-slate-600">
        <p className="font-medium text-slate-700">Cookie 维护方式</p>
        <p className="mt-1">
          请在下方各直播号行内手动粘贴 Cookie 并保存。外部程序 API 上传已关闭，不再接收
          <code className="rounded bg-white px-1 py-0.5 text-[10px]">POST /api/shop-cookies/update</code>。
        </p>
      </div>

      <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-3">
        <h4 className="text-xs font-semibold text-slate-700">新增直播号</h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="直播号名称，如：主号"
            className="rounded border border-slate-200 px-2 py-1.5 text-xs"
          />
          <textarea
            value={newCookie}
            onChange={(e) => setNewCookie(e.target.value)}
            placeholder="粘贴 Cookie"
            rows={2}
            className="rounded border border-slate-200 px-2 py-1.5 text-xs sm:col-span-2"
          />
        </div>
        <button
          type="button"
          disabled={creating || batchTesting}
          onClick={() => void handleCreate()}
          className="mt-2 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {creating ? '保存中…' : '新增直播号'}
        </button>
      </div>
    </section>
  )
}
