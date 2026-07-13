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

export const BOSS_BILL_API = {
  storeInfo: 'https://ark.xiaohongshu.com/api/edith/settlebill/query_store_info',
  sellerPreIncome: 'https://ark.xiaohongshu.com/api/edith/settlebill/query_seller_pre_income',
  settleBillList: 'https://ark.xiaohongshu.com/api/edith/settlebill/query_settle_bill_list',
  periodSettleBillList:
    'https://ark.xiaohongshu.com/api/edith/settlebill/query_period_settle_bill_list',
  periodFundBillList:
    'https://ark.xiaohongshu.com/api/edith/settlebill/query_period_fund_bill_list',
} as const

export const BOSS_BILL_REFERER = 'https://ark.xiaohongshu.com/app-finance/bill/to-settle'

export const BOSS_BILL_PAGE_SIZE = 50
export const BOSS_BILL_SCAN_FALLBACK_DAYS = 180
export const BOSS_BILL_WINDOW_DAYS = 30
export const BOSS_BILL_RECONCILE_TOLERANCE_CENT = 1

export const BOSS_BILL_FEE_CODES = [
  'STATEMENT_IN',
  'STATEMENT_REFUND',
  'FREIGHT_INSURANCE',
  'COMPENSATE_COUPON',
  'COMPENSATE_CASH',
  'USER_PAYMENT',
  'SELLER_FINE',
  'USER_COLLECTION',
  'PURCHASE_SHIPPING_SERVICE',
  'COMPENSATE_SHIPPING_FEE',
  'LOGISTIC_FEE',
  'MESSAGE_FEE',
  'QUALITY_INSPECTION_FEE',
  'CUSTOMER_SERVICE',
  'ARBITRATION_ADJUST',
  'COMMISION_RETURN',
  'OTHERS',
] as const

export const BOSS_SHOP_RANK_ORDER: BossDashboardShopKey[] = [
  'shiyuju',
  'hetianyayu',
  'xiangyu',
  'xyxiangyu',
]

/** 趋势接口请求 labels 与 sellerScoreTrendMap 键（HAR 实测，非 sellerLogisticsScore） */
export const BOSS_SCORE_TREND_LABELS = {
  quality: 'sellerQualityScore',
  logistics: 'logisticsScore',
  service: 'customerServiceScore',
} as const

export const BOSS_SCORE_SYNC_AFTER_HM = '15:10'
export const BOSS_SCORE_TREND_DAYS = 14
export const BOSS_INCOME_MONTHS = 12
export const BOSS_FLOW_PAGE_SIZE = 50
export const BOSS_FLOW_MAX_PAGES_FIRST_SYNC = 200
/** 增量同步至少翻页数，避免新提现流水落在第 2 页以后时被过早停止 */
export const BOSS_FLOW_MIN_PAGES_INCREMENTAL = 3

export const BOSS_FLOW_KIND = {
  statementIn: 'statement_in',
  withdrawSuccess: 'withdraw_success',
  other: 'other',
} as const

export type BossFlowKind = (typeof BOSS_FLOW_KIND)[keyof typeof BOSS_FLOW_KIND]
