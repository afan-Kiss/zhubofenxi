/** 运营报表商品榜单阈值 */
export const OPERATIONS_PRODUCT_RANKING = {
  /** 高退货榜正式入选：最少有效成交订单数 */
  minSoldOrderCountForHighReturn: 3,
  /** 人工主推候选池：ProductDimension.productRole 或复盘笔记 */
  slowManualRoles: [
    'traffic',
    'main',
    'profit',
    '引流',
    '引流款',
    '主推',
    '主推款',
    '利润',
    '利润款',
  ] as const,
  hotRankLimit: 10,
  slowRankLimit: 10,
  highReturnRankLimit: 5,
} as const

export type ProductRankingBasis =
  | 'official_exposure'
  | 'manual_product_dimension'
  | 'insufficient_data'
  | 'valid_performance_view'
