import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

function deriveKey(): Buffer {
  const raw = process.env.COOKIE_ENCRYPTION_KEY?.trim()
  if (!raw || raw.length < 32 || raw.includes('请替换')) {
    throw new Error('COOKIE_ENCRYPTION_KEY 未配置或长度不足（至少 32 字符）')
  }
  return createHash('sha256').update(raw, 'utf8').digest()
}

export function encryptText(plainText: string): string {
  const key = deriveKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decryptText(payload: string): string {
  try {
    const key = deriveKey()
    const buf = Buffer.from(payload, 'base64')
    if (buf.length < IV_LENGTH + TAG_LENGTH + 1) {
      throw new Error('密文格式无效')
    }
    const iv = buf.subarray(0, IV_LENGTH)
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
    const data = buf.subarray(IV_LENGTH + TAG_LENGTH)
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Cookie 解密失败，请重新保存平台 Cookie')
  }
}
