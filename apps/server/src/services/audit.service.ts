import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import type { AuditAction, AuditModule } from '../types/audit'
import { sanitizeMeta } from '../utils/url-sanitize'

export interface WriteAuditInput {
  userId?: string | null
  username?: string | null
  role?: string | null
  action: AuditAction
  module: AuditModule
  description: string
  ip?: string | null
  userAgent?: string | null
  path?: string | null
  method?: string | null
  requestId?: string | null
  durationMs?: number | null
  meta?: Record<string, unknown> | null
}

export function createRequestId(): string {
  return randomUUID()
}

export async function writeOperationLog(input: WriteAuditInput): Promise<void> {
  try {
    const metaJson = input.meta ? JSON.stringify(sanitizeMeta(input.meta)) : null
    await prisma.operationLog.create({
      data: {
        userId: input.userId ?? null,
        username: input.username ?? null,
        role: input.role ?? null,
        action: input.action,
        module: input.module,
        description: input.description,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        path: input.path ?? null,
        method: input.method ?? null,
        requestId: input.requestId ?? null,
        durationMs: input.durationMs ?? null,
        metaJson,
      },
    })
  } catch (err) {
    console.error('[audit] 写入操作日志失败', err instanceof Error ? err.message : err)
  }
}

export async function startPageView(input: {
  userId: string
  username: string
  role: string
  page: string
  path?: string
  ip?: string
  userAgent?: string
}): Promise<string> {
  const row = await prisma.pageViewLog.create({
    data: {
      userId: input.userId,
      username: input.username,
      role: input.role,
      page: input.page,
      path: input.path ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  })
  return row.id
}

export async function heartbeatPageView(viewId: string): Promise<boolean> {
  const row = await prisma.pageViewLog.findUnique({ where: { id: viewId } })
  if (!row || row.endedAt) return false
  await prisma.pageViewLog.update({
    where: { id: viewId },
    data: { lastSeenAt: new Date() },
  })
  return true
}

export async function endPageView(viewId: string): Promise<void> {
  const row = await prisma.pageViewLog.findUnique({ where: { id: viewId } })
  if (!row || row.endedAt) return
  const endedAt = new Date()
  const durationSeconds = Math.max(
    0,
    Math.floor((endedAt.getTime() - row.startedAt.getTime()) / 1000),
  )
  await prisma.pageViewLog.update({
    where: { id: viewId },
    data: { endedAt, durationSeconds, lastSeenAt: endedAt },
  })
}

function startOfToday(): Date {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

export async function getAuditSummary() {
  const since = startOfToday()

  const logs = await prisma.operationLog.findMany({
    where: { createdAt: { gte: since } },
    select: { action: true, userId: true, username: true },
  })

  const loginSuccess = logs.filter((l) => l.action === 'login_success')
  const loginUserIds = new Set(loginSuccess.map((l) => l.userId).filter(Boolean))

  const pageViews = await prisma.pageViewLog.findMany({
    where: { startedAt: { gte: since } },
    select: { durationSeconds: true, username: true, lastSeenAt: true, startedAt: true, endedAt: true },
  })

  let totalDuration = 0
  let durationCount = 0
  for (const pv of pageViews) {
    const sec =
      pv.durationSeconds ??
      Math.floor(
        ((pv.endedAt ?? pv.lastSeenAt).getTime() - pv.startedAt.getTime()) / 1000,
      )
    if (sec > 0) {
      totalDuration += sec
      durationCount += 1
    }
  }

  const recentUsers = [...new Set(logs.map((l) => l.username).filter(Boolean))].slice(0, 8)

  return {
    todayLoginUsers: loginUserIds.size,
    todayLoginCount: loginSuccess.length,
    todayRefreshCount: logs.filter((l) => l.action === 'refresh_dashboard').length,
    todayDownloadCount: logs.filter((l) =>
      ['trigger_download', 'trigger_download_all', 'export_order_success', 'download_file_success'].includes(
        l.action,
      ),
    ).length,
    todayDashboardViews: logs.filter((l) => l.action === 'view_dashboard').length,
    avgStaySeconds: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
    recentActiveUsers: recentUsers,
  }
}

export async function listOperationLogs(query: {
  page: number
  pageSize: number
  username?: string
  action?: string
  module?: string
  startDate?: string
  endDate?: string
}) {
  const where: Record<string, unknown> = {}
  if (query.username) where.username = { contains: query.username }
  if (query.action) where.action = query.action
  if (query.module) where.module = query.module
  if (query.startDate || query.endDate) {
    const createdAt: Record<string, Date> = {}
    if (query.startDate) createdAt.gte = new Date(`${query.startDate}T00:00:00`)
    if (query.endDate) createdAt.lte = new Date(`${query.endDate}T23:59:59.999`)
    where.createdAt = createdAt
  }

  const [total, rows] = await Promise.all([
    prisma.operationLog.count({ where }),
    prisma.operationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ])

  return {
    total,
    list: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      username: r.username ?? '—',
      role: r.role ?? '—',
      action: r.action,
      module: r.module,
      description: r.description,
      ip: r.ip ?? '—',
      userAgent: r.userAgent ?? '—',
      path: r.path,
      method: r.method,
      requestId: r.requestId,
      durationMs: r.durationMs,
      metaJson: r.metaJson,
      createdAt: r.createdAt.toISOString(),
    })),
  }
}

export async function listPageViewLogs(query: {
  page: number
  pageSize: number
  username?: string
  pageName?: string
  startDate?: string
  endDate?: string
}) {
  const where: Record<string, unknown> = {}
  if (query.username) where.username = { contains: query.username }
  if (query.pageName) where.page = query.pageName
  if (query.startDate || query.endDate) {
    const startedAt: Record<string, Date> = {}
    if (query.startDate) startedAt.gte = new Date(`${query.startDate}T00:00:00`)
    if (query.endDate) startedAt.lte = new Date(`${query.endDate}T23:59:59.999`)
    where.startedAt = startedAt
  }

  const [total, rows] = await Promise.all([
    prisma.pageViewLog.count({ where }),
    prisma.pageViewLog.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ])

  return {
    total,
    list: rows.map((r) => ({
      id: r.id,
      username: r.username,
      role: r.role,
      page: r.page,
      path: r.path,
      startedAt: r.startedAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
      durationSeconds:
        r.durationSeconds ??
        Math.max(
          0,
          Math.floor(
            ((r.endedAt ?? r.lastSeenAt).getTime() - r.startedAt.getTime()) / 1000,
          ),
        ),
      ip: r.ip ?? '—',
      userAgent: r.userAgent ?? '—',
    })),
  }
}
