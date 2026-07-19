import { prisma } from '../../lib/prisma'
import { GOOD_REVIEW_MATERIAL_TAG_OPTIONS } from './good-review-material.constants'
import { rowToReviewViewWithBuyerNick } from './good-review-query.service'
import type { GoodReviewItemView } from './good-review.types'

const ALLOWED_TAGS = new Set<string>(GOOD_REVIEW_MATERIAL_TAG_OPTIONS)

export function normalizeMaterialTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const out: string[] = []
  for (const raw of tags) {
    const tag = String(raw ?? '').trim()
    if (!tag || !ALLOWED_TAGS.has(tag)) continue
    if (!out.includes(tag)) out.push(tag)
  }
  return out
}

export async function updateGoodReviewMaterialTags(params: {
  id: string
  tags: string[]
}): Promise<GoodReviewItemView | null> {
  const normalized = normalizeMaterialTags(params.tags)
  const existing = await prisma.goodReview.findUnique({ where: { id: params.id } })
  if (!existing) return null

  const updated = await prisma.goodReview.update({
    where: { id: params.id },
    data: { materialTagsJson: JSON.stringify(normalized) },
  })
  return rowToReviewViewWithBuyerNick(updated)
}
