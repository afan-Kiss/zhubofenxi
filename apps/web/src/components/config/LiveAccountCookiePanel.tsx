import React, { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '../../lib/api'
import {
  cookieStatusLabel,
  cookieStatusTone,
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
  if (status === 'invalid') return 'invalid'
  if (status === 'suspected') return 'limited'
  return 'unknown'
}

function testStatusLabel(status: CookieTestStatus | undefined): string {
  switch (status) {
    case 'valid':
      return '可用'
    case 'invalid':
      return '失效'
    case 'limited':
      return '限流/风控'
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
    case 'limited':
      return 'text-amber-800 bg-amber-50'
    case 'testing':
      return 'text-indigo-700 bg-indigo-50'
    default:
      return 'text-slate-600 bg-slate-100'
  }
}

function apiLabel(api: string | null | undefined): string {
  if (!api) return '—'
  if (api === 'order_list') return '订单接口'
  return api
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
    return {
      ...next,
      cookie: nextCookie || prevCookie || (next.cookie ?? null),
      cookieText: nextCookie || prevCookie || (next.cookieText ?? null),
    }
  })
  const prevIds = new Set(prev.map((a) => a.id))
  return merged.concat(incoming.filter((a) => !prevIds.has(a.id)))
}

function resolveAccountCookie(account: LiveAccountPublic): string {
  return (account.cookieText ?? account.cookie ?? '').trim()
}

async function hydrateAccountCookies(accounts: LiveAccountPublic[]): Promise<LiveAccountPublic[]> {
  const needFetch = accounts.filter((a) => a.hasCookie && !resolveAccountCookie(a))
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

  useEffect(() => {
    accountsRef.current = accounts
  }, [accounts])

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
      nextAccounts = await hydrateAccountCookies(nextAccounts)
      setAccounts(nextAccounts)
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
    await refreshAccounts({ silent: true })
  }

  const handleTestAllEnabledCookies = async () => {
    if (batchTesting) return
    const targets = accounts.filter((a) => a.enabled && a.hasCookie)
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
      currentName: targets[0]!.name,
      done: false,
    })

    for (let i = 0; i < targets.length; i++) {
      const account = targets[i]!
      setBatchProgress({
        current: i + 1,
        total: targets.length,
        success,
        failed,
        currentName: account.name,
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
        currentName: account.name,
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
      const res = await apiRequest<
        LiveAccountPublic & { message?: string; testResult?: { ok: boolean; message: string } }
      >('/api/settings/live-accounts', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim(), cookie: newCookie.trim(), enabled: true }),
      })
      setNewName('')
      setNewCookie('')
      if (res.id) {
        setAccounts((prev) => [...prev, res])
        if (res.testResult) {
          setTestResults((prev) => ({
            ...prev,
            [res.id]: {
              ok: res.testResult!.ok,
              message: res.testResult!.message,
              checkedAt: new Date().toISOString(),
              accountId: res.id,
              accountName: res.name,
              apiName: '订单接口',
              status: res.testResult!.ok ? 'valid' : 'invalid',
            },
          }))
        }
      } else {
        await refreshAccounts({ silent: true })
      }
      showToast(res.testResult?.ok ? 'ok' : 'err', res.message ?? '直播号已创建')
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
      const res = await apiRequest<
        LiveAccountPublic & { message?: string; testResult?: { ok: boolean; message: string } }
      >(`/api/settings/live-accounts/${id}/cookie`, {
        method: 'PUT',
        body: JSON.stringify({ cookie }),
      })
      setEditCookies((prev) => ({ ...prev, [id]: '' }))
      patchAccount(res)
      if (res.testResult) {
        setTestResults((prev) => ({
          ...prev,
          [id]: {
            ok: res.testResult!.ok,
            message: res.testResult!.message,
            checkedAt: new Date().toISOString(),
            accountId: id,
            accountName: res.name,
            apiName: '订单接口',
            status: res.testResult!.ok ? 'valid' : 'invalid',
          },
        }))
      }
      showToast(res.testResult?.ok ? 'ok' : 'err', res.message ?? 'Cookie 已更新')
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

  const renderTestResultBlock = (account: LiveAccountPublic) => {
    const latest = testResults[account.id]
    const isTesting = testingIds.has(account.id)
    const recentStatus = mapCookieStatus(account.cookieStatus)
    const thisStatus: CookieTestStatus | undefined = isTesting
      ? 'testing'
      : latest?.status

    return (
      <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/80 p-2.5 text-[11px]">
        <div className="grid gap-1.5 sm:grid-cols-2">
          <div>
            <span className="text-slate-400">最近检测状态：</span>
            <span
              className={`ml-1 inline-flex rounded px-1.5 py-0.5 font-medium ${testStatusTone(recentStatus)}`}
            >
              {testStatusLabel(recentStatus)}
            </span>
          </div>
          <div>
            <span className="text-slate-400">最近检测时间：</span>
            <span className="text-slate-700">{formatTime(account.cookieLastCheckedAt)}</span>
          </div>
          <div>
            <span className="text-slate-400">最近检测接口：</span>
            <span className="text-slate-700">{apiLabel(account.cookieLastFailedApi ?? 'order_list')}</span>
          </div>
          {account.cookieLastErrorMessage && account.cookieStatus !== 'valid' && (
            <div className="sm:col-span-2">
              <span className="text-slate-400">最近失败原因：</span>
              <span className="text-rose-700">{account.cookieLastErrorMessage}</span>
            </div>
          )}
        </div>
        {(latest || isTesting) && (
          <div className="mt-2 border-t border-slate-200 pt-2">
            <span className="text-slate-400">本次检测结果：</span>
            {isTesting ? (
              <span className="ml-1 text-indigo-700">检测中…</span>
            ) : latest ? (
              <>
                <span
                  className={`ml-1 inline-flex rounded px-1.5 py-0.5 font-medium ${testStatusTone(thisStatus)}`}
                >
                  {latest.ok ? '本次成功' : '本次失败'}
                </span>
                <span className="ml-2 text-slate-500">{formatTime(latest.checkedAt)}</span>
                {latest.apiName && (
                  <span className="ml-2 text-slate-500">· {latest.apiName}</span>
                )}
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

  return (
    <section id="live-account-cookie" className="scroll-mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-800">直播号 Cookie 管理</h3>
          <p className="mt-1 text-xs text-slate-500">
            每个直播号独立保存 Cookie，启用后参与经营数据同步。Cookie 可在本页完整查看和复制。
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400">
            用于确认各直播号 Cookie 是否还能正常查询订单接口。
          </p>
        </div>
        <button
          type="button"
          disabled={batchTesting || loading || accounts.length === 0}
          onClick={() => void handleTestAllEnabledCookies()}
          className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {batchTesting ? '批量检测中…' : '检测全部启用 Cookie'}
        </button>
      </div>

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
          className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
            batchProgress.done
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-indigo-200 bg-indigo-50 text-indigo-900'
          }`}
        >
          {batchProgress.done ? (
            <p>
              检测完成：成功 {batchProgress.success} 个，失败 {batchProgress.failed} 个（共{' '}
              {batchProgress.total} 个）
            </p>
          ) : (
            <>
              <p>
                正在检测：{batchProgress.current} / {batchProgress.total}
                <span className="ml-3">成功：{batchProgress.success}</span>
                <span className="ml-2">失败：{batchProgress.failed}</span>
                <span className="ml-2">
                  剩余：{Math.max(0, batchProgress.total - batchProgress.current)}
                </span>
              </p>
              <p className="mt-1 text-indigo-700">
                正在检测「{batchProgress.currentName}」Cookie，请稍等…
              </p>
            </>
          )}
        </div>
      )}

      {loading ? (
        <p className="mt-4 text-xs text-slate-500">加载中…</p>
      ) : accounts.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-600">
          暂无直播号，请添加直播号 Cookie。
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {accounts.map((account) => {
            const isTesting = testingIds.has(account.id)
            const isBusy = busyId === account.id
            const cookieText = resolveAccountCookie(account)

            return (
              <div key={account.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {editingNameId === account.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={editNames[account.id] ?? account.name}
                          onChange={(e) =>
                            setEditNames((prev) => ({ ...prev, [account.id]: e.target.value }))
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
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{account.name}</span>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            setEditingNameId(account.id)
                            setEditNames((prev) => ({ ...prev, [account.id]: account.name }))
                          }}
                          className="text-[10px] text-slate-500 underline hover:text-slate-800"
                        >
                          编辑名称
                        </button>
                      </div>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          account.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {account.enabled ? '已启用' : '已停用'}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cookieStatusTone(account.cookieStatus)}`}
                      >
                        Cookie {cookieStatusLabel(account.cookieStatus)}
                      </span>
                      {isTesting && (
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                          检测中…
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {renderTestResultBlock(account)}

                <div className="mt-3">
                  <label className="text-xs font-medium text-slate-700">Cookie</label>
                  {account.hasCookie ? (
                    <textarea
                      readOnly
                      value={cookieText}
                      rows={4}
                      className="mt-1 max-h-40 min-h-[4rem] w-full resize-y overflow-auto rounded border border-slate-200 bg-white px-2 py-1.5 font-mono text-[11px] leading-relaxed text-slate-800"
                      style={{ maxHeight: '160px' }}
                    />
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">尚未保存 Cookie</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!cookieText.trim() || isBusy}
                      onClick={() => void handleCopyCookie(account)}
                      className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                    >
                      复制 Cookie
                    </button>
                    <button
                      type="button"
                      disabled={isTesting || batchTesting || isBusy || !account.hasCookie}
                      onClick={() => void handleTest(account)}
                      className="rounded border border-indigo-200 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                    >
                      {isTesting ? '检测中…' : '检测'}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy || batchTesting}
                      onClick={() => void handleToggleEnabled(account)}
                      className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                    >
                      {account.enabled ? '停用' : '启用'}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy || batchTesting}
                      onClick={() => void handleDelete(account)}
                      className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      删除
                    </button>
                  </div>
                </div>

                <dl className="mt-3 grid gap-1 text-[11px] text-slate-600 sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-400">最近成功同步</dt>
                    <dd>{formatTime(account.lastSyncSuccessAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Cookie 更新时间</dt>
                    <dd>{formatTime(account.cookieUpdatedAt)}</dd>
                  </div>
                  {qualityHints[account.id] && (
                    <div className="sm:col-span-2">
                      <dt className="text-slate-400">接口探测</dt>
                      <dd className="text-slate-600">
                        订单接口：
                        {cookieStatusLabel(
                          qualityHints[account.id]!.orderApiStatus as LiveAccountPublic['cookieStatus'],
                        )}
                        {' · '}
                        官方品退：{qualityHints[account.id]!.qualityApiHint}
                      </dd>
                    </div>
                  )}
                </dl>

                <div className="mt-3 border-t border-slate-100 pt-3">
                  <label className="text-xs text-slate-600">更新 Cookie（粘贴新内容后保存）</label>
                  <textarea
                    value={editCookies[account.id] ?? ''}
                    onChange={(e) =>
                      setEditCookies((prev) => ({ ...prev, [account.id]: e.target.value }))
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
                    {isBusy ? '保存并检测中…' : '更新 Cookie'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-5 rounded-lg border border-dashed border-slate-300 p-3">
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
          {creating ? '保存并检测中…' : '新增直播号'}
        </button>
      </div>
    </section>
  )
}
