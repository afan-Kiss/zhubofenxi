import { prisma } from '../lib/prisma'
import type {
  DownloadApiDebugItem,
  DownloadDebugTableKey,
  TaskApiDebugEnvelope,
} from '../types/download-api-debug'
import { DOWNLOAD_DEBUG_TABLE_KEYS } from '../types/download-api-debug'
import { inspectCookieForSigning, probeXhsSigner } from './xhs-sign.service'
import { getDecryptedCookie } from './credential.service'

export type {
  DownloadApiDebugItem,
  DownloadFailedPhase,
  DownloadSignProbeDebug,
  TaskApiDebugEnvelope,
} from '../types/download-api-debug'

function mergeDebugItem(
  prev: DownloadApiDebugItem | undefined,
  patch: Partial<DownloadApiDebugItem>,
): DownloadApiDebugItem {
  const signProbe =
    patch.signProbe !== undefined
      ? { ...prev?.signProbe, ...patch.signProbe }
      : prev?.signProbe
  return {
    ...prev,
    ...patch,
    ...(signProbe !== undefined ? { signProbe } : {}),
  }
}

function mergeEnvelope(
  current: TaskApiDebugEnvelope,
  patch: Partial<TaskApiDebugEnvelope>,
): TaskApiDebugEnvelope {
  const next: TaskApiDebugEnvelope = { ...current }
  for (const key of DOWNLOAD_DEBUG_TABLE_KEYS) {
    const itemPatch = patch[key]
    if (itemPatch !== undefined) {
      next[key] = mergeDebugItem(current[key], itemPatch)
    }
  }
  return next
}

export async function loadTaskApiDebug(taskId: string): Promise<TaskApiDebugEnvelope> {
  const row = await prisma.downloadTask.findUnique({
    where: { id: taskId },
    select: { apiDebugJson: true },
  })
  if (!row?.apiDebugJson) return {}
  try {
    return JSON.parse(row.apiDebugJson) as TaskApiDebugEnvelope
  } catch {
    return {}
  }
}

export async function updateTaskApiDebug(
  taskId: string,
  patch: Partial<TaskApiDebugEnvelope>,
): Promise<void> {
  const current = await loadTaskApiDebug(taskId)
  const next = mergeEnvelope(current, patch)
  await prisma.downloadTask.update({
    where: { id: taskId },
    data: { apiDebugJson: JSON.stringify(next) },
  })
}

/** @deprecated 使用 updateTaskApiDebug */
export const patchTaskApiDebug = updateTaskApiDebug

export async function updateTaskApiDebugForType(
  taskId: string,
  table: DownloadDebugTableKey,
  patch: Partial<DownloadApiDebugItem>,
): Promise<void> {
  await updateTaskApiDebug(taskId, { [table]: patch })
}

export async function initLiveTaskApiDebug(taskId: string): Promise<void> {
  const probe = await probeXhsSigner()
  let cookieInspect = {
    hasA1: false,
    hasAccessTokenArk: false,
    canExtractAuthorization: false,
  }
  try {
    const cookie = await getDecryptedCookie()
    cookieInspect = inspectCookieForSigning(cookie)
  } catch {
    /* no cookie */
  }

  await updateTaskApiDebug(taskId, {
    live: {
      enabledSign: true,
      signProbe: {
        pythonAvailable: probe.pythonAvailable,
        xhshowInstalled: probe.xhshowInstalled,
        hasA1: cookieInspect.hasA1,
        hasAccessTokenArk: cookieInspect.hasAccessTokenArk,
        authorizationOk: cookieInspect.canExtractAuthorization,
      },
    },
  })
}

export interface LiveDiagnosticsView {
  signCallSuccess: boolean | null
  pythonAvailable: boolean
  xhshowInstalled: boolean
  hasA1: boolean
  hasAccessTokenArk: boolean
  authorizationOk: boolean
  lastHttpStatus: number | null
  lastApiCode: number | null
  lastApiSuccess: boolean | null
  lastApiMsg: string | null
  failedPhase: string | null
  apiSuccess: boolean | null
  signSuccess: boolean | null
}

export function liveDiagnosticsToView(
  debug: TaskApiDebugEnvelope,
  pipeline?: {
    signSuccess: boolean | null
    apiSuccess: boolean | null
    failedPhase: string | null
  },
): LiveDiagnosticsView {
  const live = debug.live
  const probe = live?.signProbe
  return {
    signCallSuccess: live?.signOk ?? pipeline?.signSuccess ?? null,
    pythonAvailable: probe?.pythonAvailable ?? false,
    xhshowInstalled: probe?.xhshowInstalled ?? false,
    hasA1: probe?.hasA1 ?? false,
    hasAccessTokenArk: probe?.hasAccessTokenArk ?? false,
    authorizationOk: probe?.authorizationOk ?? false,
    lastHttpStatus: live?.httpStatus ?? null,
    lastApiCode: live?.xhsCode ?? null,
    lastApiSuccess: live?.xhsSuccess ?? null,
    lastApiMsg: live?.xhsMsg ?? null,
    failedPhase: live?.failedPhase ?? pipeline?.failedPhase ?? null,
    apiSuccess: live?.apiOk ?? pipeline?.apiSuccess ?? null,
    signSuccess: live?.signOk ?? pipeline?.signSuccess ?? null,
  }
}
