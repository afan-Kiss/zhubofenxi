import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '../lib/prisma'
import type { SessionUser } from '../types/auth'
import { isUserRole } from '../types/roles'

export const SESSION_COOKIE_NAME = 'session_token'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function createSession(userId: string): Promise<{
  token: string
  expiresAt: Date
}> {
  const token = generateSessionToken()
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  await prisma.session.create({
    data: {
      tokenHash,
      userId,
      expiresAt,
    },
  })

  return { token, expiresAt }
}

export async function resolveUserFromSessionToken(
  token: string,
): Promise<SessionUser | null> {
  const tokenHash = hashToken(token)
  const row = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  })

  if (!row) return null
  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: row.id } }).catch(() => undefined)
    return null
  }
  if (!row.user.enabled) return null
  if (!isUserRole(row.user.role)) return null

  return {
    id: row.user.id,
    username: row.user.username,
    role: row.user.role,
  }
}

export async function deleteSessionByToken(token: string): Promise<void> {
  const tokenHash = hashToken(token)
  await prisma.session.deleteMany({ where: { tokenHash } })
}

export async function cleanupExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })
  return result.count
}
