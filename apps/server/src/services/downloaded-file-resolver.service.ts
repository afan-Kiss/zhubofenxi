import fs from 'node:fs'
import { prisma } from '../lib/prisma'
import { DOWNLOAD_TYPES, DOWNLOAD_TYPE_LABELS, type DownloadType } from '../types/download'
import type { LatestDownloadFiles } from '../types/analysis'

export interface ResolvedDownloadFiles {
  files: LatestDownloadFiles
  warnings: string[]
}

const OPTIONAL_WARNINGS: Record<Exclude<DownloadType, 'order'>, string> = {
  live: '未找到直播场次表，将使用默认时间规则归属主播',
  pendingSettlement: '未找到待结算明细，待结算金额可能不完整',
  settledSettlement: '未找到已结算明细，已结算金额和毛利润可能不完整',
}

/**
 * 从 DownloadTask 解析最近一次成功下载的四张表本地路径。
 * order 必填；其余可选并附带 warnings。
 */
export async function resolveLatestDownloadedFiles(): Promise<ResolvedDownloadFiles> {
  const files: LatestDownloadFiles = {}
  const warnings: string[] = []

  for (const type of DOWNLOAD_TYPES) {
    const task = await prisma.downloadTask.findFirst({
      where: {
        type,
        status: 'success',
        filePath: { not: null },
      },
      orderBy: { finishedAt: 'desc' },
    })

    if (task?.filePath && fs.existsSync(task.filePath)) {
      files[type] = {
        filePath: task.filePath,
        fileName: task.fileName ?? `${type}.xlsx`,
        taskId: task.id,
      }
    } else if (type !== 'order') {
      warnings.push(OPTIONAL_WARNINGS[type])
    }
  }

  if (!files.order) {
    throw new Error('请先在系统设置下载订单表')
  }

  return { files, warnings }
}

export function getResolvedFileLabel(type: DownloadType): string {
  return DOWNLOAD_TYPE_LABELS[type]
}
