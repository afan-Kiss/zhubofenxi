import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SERVER_ROOT } from '../../config/env'
import { importCsChatArchiveFromPath, importLatestCsChatArchive } from './cs-chat-import.service'

export interface CsChatSyncResult {
  ok: boolean
  mode: 'archive' | 'live-export+archive'
  message: string
  archivePath?: string
  sessionCount: number
  messageCount: number
  shopCounts: Record<string, { sessions: number; messages: number }>
  liveLogTail?: string
}

function siblingQianfanRoot(): string {
  if (process.env.QIANFAN_BOT_ROOT?.trim()) return process.env.QIANFAN_BOT_ROOT.trim()
  // apps/server → 仓库根 → 同级千帆中转机器人
  return path.resolve(SERVER_ROOT, '..', '..', '千帆中转机器人')
}

function runNodeScript(
  cwd: string,
  scriptRel: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptRel, ...args], {
      cwd,
      env: process.env,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }, timeoutMs)
    child.stdout.on('data', (buf) => {
      stdout += String(buf)
      if (stdout.length > 200_000) stdout = stdout.slice(-160_000)
    })
    child.stderr.on('data', (buf) => {
      stderr += String(buf)
      if (stderr.length > 80_000) stderr = stderr.slice(-60_000)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: 1, stdout, stderr: `${stderr}\n${err.message}` })
    })
  })
}

function findNewestExport(desktop: string, days: number): string | null {
  try {
    const files = fs.readdirSync(desktop)
    const prefix = `千帆近${days}天-四店全部-`
    const matched = files
      .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
      .map((f) => ({ f, t: fs.statSync(path.join(desktop, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    return matched[0] ? path.join(desktop, matched[0].f) : null
  } catch {
    return null
  }
}

/**
 * 同步策略：
 * 1) 若本机有千帆中转机器人导出脚本 → 拉近 N 天 → 导入 DB
 * 2) 否则直接导入已有档案（桌面 / CS_CHAT_ARCHIVE_PATH）
 */
export async function syncCsChatSessions(options?: {
  days?: number
  preferLive?: boolean
  archivePath?: string
}): Promise<CsChatSyncResult> {
  const days = Math.min(Math.max(Number(options?.days) || 60, 1), 180)
  const preferLive = options?.preferLive !== false
  const botRoot = siblingQianfanRoot()
  const exportScript = path.join(botRoot, 'scripts', 'export-qianfan-recent-chats-desktop.js')

  if (preferLive && fs.existsSync(exportScript)) {
    const before = Date.now()
    const run = await runNodeScript(
      botRoot,
      path.join('scripts', 'export-qianfan-recent-chats-desktop.js'),
      ['--days', String(days)],
      20 * 60 * 1000,
    )
    const desktop = path.join(os.homedir(), 'Desktop')
    const newest = findNewestExport(desktop, days)
    const logTail = `${run.stdout}\n${run.stderr}`.trim().slice(-4000)

    if (run.code === 0 && newest && fs.statSync(newest).mtimeMs >= before - 5_000) {
      const imported = await importCsChatArchiveFromPath(newest)
      return {
        ok: imported.ok,
        mode: 'live-export+archive',
        message: imported.ok
          ? `已从千帆拉近 ${days} 天并入库`
          : imported.error || '导入失败',
        archivePath: newest,
        sessionCount: imported.sessionCount,
        messageCount: imported.messageCount,
        shopCounts: imported.shopCounts,
        liveLogTail: logTail,
      }
    }

    // live 失败时回退档案
    const fallback = await importLatestCsChatArchive(options?.archivePath)
    return {
      ok: fallback.ok,
      mode: 'archive',
      message: fallback.ok
        ? `在线拉取失败，已改用本地档案：${fallback.sourcePath}`
        : `在线拉取失败，且无可用档案。live=${run.code ?? 'null'} ${fallback.error || ''}`.trim(),
      archivePath: fallback.sourcePath || undefined,
      sessionCount: fallback.sessionCount,
      messageCount: fallback.messageCount,
      shopCounts: fallback.shopCounts,
      liveLogTail: logTail,
    }
  }

  const imported = await importLatestCsChatArchive(options?.archivePath)
  return {
    ok: imported.ok,
    mode: 'archive',
    message: imported.ok
      ? `已从本地档案入库：${imported.sourcePath}`
      : imported.error || '导入失败',
    archivePath: imported.sourcePath || undefined,
    sessionCount: imported.sessionCount,
    messageCount: imported.messageCount,
    shopCounts: imported.shopCounts,
  }
}
