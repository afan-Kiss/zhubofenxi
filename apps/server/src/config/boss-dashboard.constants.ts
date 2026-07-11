import {
  GOOD_REVIEW_SHOPS,
  type GoodReviewShopDefinition,
  type GoodReviewShopKey,
} from './good-review-shops.constants'

export const BOSS_DASHBOARD_SHOP_KEYS = [
  'shiyuju',
  'hetianyayu',
  'xiangyu',
  'xyxiangyu',
] as const

export type BossDashboardShopKey = GoodReviewShopKey

export const BOSS_DASHBOARD_SHOPS: GoodReviewShopDefinition[] = [...GOOD_REVIEW_SHOPS]

export const BOSS_FINANCE_API = {
  aggregateAccount:
    'https://ark.xiaohongshu.com/api/suez/finance/accountforweb/getAggregateAccount',
  afterSaleFrozen:
    'https://ark.xiaohongshu.com/api/suez/finance/accountforweb/getAfterSaleFrozenAmount',
  canWithdraw: 'https://ark.xiaohongshu.com/api/suez/finance/accountforweb/canWithdraw',
  listAccountRecord:
    'https://ark.xiaohongshu.com/api/suez/finance/accountforweb/listAccountRecord',
} as const

export const BOSS_SCORE_API = {
  shopScore: 'https://ark.xiaohongshu.com/api/edith/home/get_shop_score',
  scoreTrend: 'https://ark.xiaohongshu.com/api/edith/query/shop/score/trend',
} as const

export const BOSS_FINANCE_REFERER = 'https://ark.xiaohongshu.com/app-merchant/finance/account'
export const BOSS_SCORE_REFERER = 'https://ark.xiaohongshu.com/app-violation/shop-score'

export const BOSS_SCORE_TREND_LABELS = {
  quality: 'sellerQualityScore',
  logistics: 'sellerLogisticsScore',
  service: 'sellerServiceScore',
} as const

export const BOSS_SCORE_SYNC_AFTER_HM = '15:10'
export const BOSS_SCORE_TREND_DAYS = 14
export const BOSS_INCOME_MONTHS = 12
export const BOSS_FLOW_PAGE_SIZE = 50
export const BOSS_FLOW_MAX_PAGES_FIRST_SYNC = 200

export const BOSS_FLOW_KIND = {
  statementIn: 'statement_in',
  withdrawSuccess: 'withdraw_success',
  other: 'other',
} as const

export type BossFlowKind = (typeof BOSS_FLOW_KIND)[keyof typeof BOSS_FLOW_KIND]
