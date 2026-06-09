import { prisma } from '../lib/prisma'
import { encryptText, decryptText } from '../utils/crypto'
import { listEnabledLiveAccountsWithCookie } from './live-account.service'

const DEFAULT_PLATFORM = 'xiaohongshu'

export interface CredentialPublicView {
  platformName: string
  hasCookie: boolean
  remark: string | null
  updatedAt: Date
}

export async function getCredentialPublic(
  platformName = DEFAULT_PLATFORM,
): Promise<CredentialPublicView> {
  const row = await prisma.platformCredential.findUnique({
    where: { platformName },
  })
  if (!row) {
    return {
      platformName,
      hasCookie: false,
      remark: null,
      updatedAt: new Date(0),
    }
  }
  return {
    platformName: row.platformName,
    hasCookie: Boolean(row.cookieEncrypted),
    remark: row.remark,
    updatedAt: row.updatedAt,
  }
}

export async function saveCredential(input: {
  platformName: string
  cookie: string
  remark?: string
  updatedBy: string
}): Promise<CredentialPublicView> {
  const cookie = input.cookie.trim()
  if (!cookie) {
    throw new Error('Cookie 不能为空')
  }
  const encrypted = encryptText(cookie)
  const platformName = input.platformName.trim() || DEFAULT_PLATFORM

  const row = await prisma.platformCredential.upsert({
    where: { platformName },
    create: {
      platformName,
      cookieEncrypted: encrypted,
      remark: input.remark?.trim() || null,
      updatedBy: input.updatedBy,
    },
    update: {
      cookieEncrypted: encrypted,
      remark: input.remark?.trim() || null,
      updatedBy: input.updatedBy,
    },
  })

  return {
    platformName: row.platformName,
    hasCookie: true,
    remark: row.remark,
    updatedAt: row.updatedAt,
  }
}

export async function listPlatformCredentialsWithCookie(): Promise<string[]> {
  const accounts = await listEnabledLiveAccountsWithCookie()
  if (accounts.length > 0) return accounts.map((a) => a.platformName)
  return [DEFAULT_PLATFORM]
}

export async function getDecryptedCookie(platformName = DEFAULT_PLATFORM): Promise<string> {
  const row = await prisma.platformCredential.findUnique({
    where: { platformName },
  })
  if (!row?.cookieEncrypted) {
    const fallback = await prisma.platformCredential.findFirst({
      where: { NOT: { cookieEncrypted: '' } },
      orderBy: { createdAt: 'asc' },
    })
    if (fallback?.cookieEncrypted) {
      return decryptText(fallback.cookieEncrypted)
    }
    throw new Error('尚未配置平台 Cookie，请先在系统设置保存')
  }
  return decryptText(row.cookieEncrypted)
}

export async function testCredentialDecrypt(platformName = DEFAULT_PLATFORM): Promise<{
  ok: boolean
  message: string
}> {
  const row = await prisma.platformCredential.findUnique({
    where: { platformName },
  })
  if (!row?.cookieEncrypted) {
    return { ok: false, message: '尚未配置 Cookie' }
  }
  try {
    decryptText(row.cookieEncrypted)
    return { ok: true, message: 'Cookie 已加密保存，服务端可正常解密' }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Cookie 解密失败',
    }
  }
}
