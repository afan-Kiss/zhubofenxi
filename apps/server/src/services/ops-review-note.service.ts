import { prisma } from '../lib/prisma'

export type OpsReviewReportType = 'daily' | 'weekly'

export interface OpsReviewNotePayload {
  reportDate: string
  reportType: OpsReviewReportType
  problemText: string
  reasonText: string
  trafficProducts: string[]
  mainProducts: string[]
  profitProducts: string[]
  scriptText: string
  ownerName: string
  createdBy?: string | null
  updatedAt?: string
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map((v) => String(v ?? '').trim()).filter(Boolean)
  } catch {
    return []
  }
}

function toPayload(row: {
  reportDate: string
  reportType: string
  problemText: string
  reasonText: string
  trafficProductsJson: string
  mainProductsJson: string
  profitProductsJson: string
  scriptText: string
  ownerName: string
  createdBy: string | null
  updatedAt: Date
}): OpsReviewNotePayload {
  return {
    reportDate: row.reportDate,
    reportType: row.reportType as OpsReviewReportType,
    problemText: row.problemText,
    reasonText: row.reasonText,
    trafficProducts: parseJsonArray(row.trafficProductsJson),
    mainProducts: parseJsonArray(row.mainProductsJson),
    profitProducts: parseJsonArray(row.profitProductsJson),
    scriptText: row.scriptText,
    ownerName: row.ownerName,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function getOpsReviewNote(params: {
  reportDate: string
  reportType: OpsReviewReportType
}): Promise<OpsReviewNotePayload | null> {
  const row = await prisma.opsReviewNote.findUnique({
    where: {
      reportDate_reportType: {
        reportDate: params.reportDate,
        reportType: params.reportType,
      },
    },
  })
  return row ? toPayload(row) : null
}

export async function upsertOpsReviewNote(params: {
  reportDate: string
  reportType: OpsReviewReportType
  problemText?: string
  reasonText?: string
  trafficProducts?: string[]
  mainProducts?: string[]
  profitProducts?: string[]
  scriptText?: string
  ownerName?: string
  createdBy?: string
}): Promise<OpsReviewNotePayload> {
  const row = await prisma.opsReviewNote.upsert({
    where: {
      reportDate_reportType: {
        reportDate: params.reportDate,
        reportType: params.reportType,
      },
    },
    create: {
      reportDate: params.reportDate,
      reportType: params.reportType,
      problemText: params.problemText ?? '',
      reasonText: params.reasonText ?? '',
      trafficProductsJson: JSON.stringify(params.trafficProducts ?? []),
      mainProductsJson: JSON.stringify(params.mainProducts ?? []),
      profitProductsJson: JSON.stringify(params.profitProducts ?? []),
      scriptText: params.scriptText ?? '',
      ownerName: params.ownerName ?? '',
      createdBy: params.createdBy ?? null,
    },
    update: {
      problemText: params.problemText,
      reasonText: params.reasonText,
      trafficProductsJson:
        params.trafficProducts != null ? JSON.stringify(params.trafficProducts) : undefined,
      mainProductsJson:
        params.mainProducts != null ? JSON.stringify(params.mainProducts) : undefined,
      profitProductsJson:
        params.profitProducts != null ? JSON.stringify(params.profitProducts) : undefined,
      scriptText: params.scriptText,
      ownerName: params.ownerName,
    },
  })
  return toPayload(row)
}
