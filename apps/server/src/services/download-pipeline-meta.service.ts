import { prisma } from '../lib/prisma'
import {
  FAILED_PHASE_LABELS,
  normalizeDownloadFailedPhase,
  type DownloadFailedPhase,
} from '../types/download-api-debug'
import { isSignerEnabled } from './xhs-sign.service'

export type { DownloadFailedPhase } from '../types/download-api-debug'

export interface DownloadPipelineMeta {
  signEnabled: boolean
  signSuccess: boolean | null
  apiSuccess: boolean | null
  fileUrlObtained: boolean | null
  xlsxDownloaded: boolean | null
  failedPhase: DownloadFailedPhase | null
}

export interface DownloadPipelineView extends DownloadPipelineMeta {
  signEnabledLabel: string
  signSuccessLabel: string
  apiSuccessLabel: string
  fileUrlLabel: string
  xlsxLabel: string
  failedPhaseLabel: string | null
}

const EMPTY: DownloadPipelineMeta = {
  signEnabled: false,
  signSuccess: null,
  apiSuccess: null,
  fileUrlObtained: null,
  xlsxDownloaded: null,
  failedPhase: null,
}

function boolLabel(v: boolean | null, naWhenNull = false): string {
  if (v === null) return naWhenNull ? '不适用' : '—'
  return v ? '是' : '否'
}

export function parsePipelineMeta(json: string | null | undefined): DownloadPipelineMeta {
  if (!json) return { ...EMPTY }
  try {
    const raw = JSON.parse(json) as Partial<DownloadPipelineMeta> & {
      failedPhase?: string | null
    }
    return {
      signEnabled: Boolean(raw.signEnabled),
      signSuccess: raw.signSuccess ?? null,
      apiSuccess: raw.apiSuccess ?? null,
      fileUrlObtained: raw.fileUrlObtained ?? null,
      xlsxDownloaded: raw.xlsxDownloaded ?? null,
      failedPhase: normalizeDownloadFailedPhase(raw.failedPhase),
    }
  } catch {
    return { ...EMPTY }
  }
}

export function toPipelineView(
  json: string | null | undefined,
  mode: string | null,
): DownloadPipelineView {
  const meta = parsePipelineMeta(json)
  const direct = mode === 'direct_url'
  return {
    ...meta,
    signEnabled: direct ? false : meta.signEnabled,
    signSuccess: direct ? null : meta.signSuccess,
    signEnabledLabel: direct ? '否（临时链接）' : meta.signEnabled ? '是' : '否',
    signSuccessLabel: boolLabel(direct ? null : meta.signSuccess, direct),
    apiSuccessLabel: boolLabel(meta.apiSuccess),
    fileUrlLabel: boolLabel(meta.fileUrlObtained),
    xlsxLabel: boolLabel(meta.xlsxDownloaded),
    failedPhaseLabel: meta.failedPhase
      ? (FAILED_PHASE_LABELS[meta.failedPhase] ?? meta.failedPhase)
      : null,
  }
}

export async function initDownloadPipeline(
  taskId: string,
  mode: string | null,
): Promise<void> {
  const auto = mode === 'auto_export'
  const meta: DownloadPipelineMeta = {
    signEnabled: auto && isSignerEnabled(),
    signSuccess: auto ? false : null,
    apiSuccess: false,
    fileUrlObtained: false,
    xlsxDownloaded: false,
    failedPhase: null,
  }
  await savePipelineMeta(taskId, meta)
}

export async function patchDownloadPipeline(
  taskId: string,
  patch: Partial<DownloadPipelineMeta>,
): Promise<void> {
  const row = await prisma.downloadTask.findUnique({
    where: { id: taskId },
    select: { pipelineMetaJson: true },
  })
  const current = parsePipelineMeta(row?.pipelineMetaJson)
  const merged: DownloadPipelineMeta = {
    ...current,
    ...patch,
    failedPhase:
      patch.failedPhase !== undefined
        ? normalizeDownloadFailedPhase(patch.failedPhase)
        : current.failedPhase,
  }
  await savePipelineMeta(taskId, merged)
}

async function savePipelineMeta(taskId: string, meta: DownloadPipelineMeta): Promise<void> {
  await prisma.downloadTask.update({
    where: { id: taskId },
    data: { pipelineMetaJson: JSON.stringify(meta) },
  })
}

export function failedPhaseFromStep(step: string | null | undefined): DownloadFailedPhase {
  if (!step) return 'unknown'
  if (step === 'export_start' || step === 'get_download_url') return 'api'
  if (step === 'wait_history' || step === 'poll_record') return 'poll'
  if (step === 'download_file') return 'download'
  if (step === 'validate_file') return 'validate'
  if (step === 'failed') return 'unknown'
  return normalizeDownloadFailedPhase(step) ?? 'unknown'
}
