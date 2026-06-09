/**
 * 后台任务统一日志：开始 / 进度 / 完成 / 失败
 */
import { logError, logInfo, logWarn } from './server-log'

export function taskStart(scope: string, message: string): void {
  logInfo(scope, `开始：${message}`)
}

export function taskProgress(scope: string, message: string): void {
  logInfo(scope, `进度：${message}`)
}

export function taskComplete(scope: string, message: string): void {
  logInfo(scope, `完成：${message}`)
}

export function taskFail(scope: string, message: string, error?: unknown): void {
  logWarn(scope, `失败：${message}`)
  if (error != null) {
    logError(scope, '失败详情', error)
  }
}

/** 按间隔打印进度（每 progressEvery 次或每 intervalMs） */
export class TaskProgressReporter {
  private lastLogAt = 0
  private processed = 0
  private success = 0
  private failed = 0

  constructor(
    private readonly scope: string,
    private readonly total: number,
    private readonly progressEvery = 10,
    private readonly intervalMs = 15_000,
  ) {}

  tick(ok: boolean, extra?: string): void {
    this.processed++
    if (ok) this.success++
    else this.failed++

    const now = Date.now()
    const byCount = this.processed % this.progressEvery === 0
    const byTime = now - this.lastLogAt >= this.intervalMs
    const isLast = this.processed >= this.total

    if (!byCount && !byTime && !isLast) return

    this.lastLogAt = now
    const base = `${this.processed}/${this.total}，成功 ${this.success}，失败 ${this.failed}`
    taskProgress(this.scope, extra ? `${base}，${extra}` : base)
  }

  finish(message: string): void {
    taskComplete(this.scope, message)
  }

  getStats(): { processed: number; success: number; failed: number } {
    return {
      processed: this.processed,
      success: this.success,
      failed: this.failed,
    }
  }
}
