# 月度结账核对说明

## 定位

- **运营月报**（`getMonthlyOperationsReport`）：给老板看直播经营表现，由**每日运营日报**逐日汇总。
- **月度结账核对**（`npm run monthly:close-check`）：给每月 15 号复盘**上个月**用，先查数据完不完整，再决定能不能谈盈利/亏损。

**运营月报 ≠ 财务利润表。**  
缺成本、缺支出、缺完整结算时，系统**不会**输出「本月盈利 X 万」。

## 每月 15 号日期规则

统一 **Asia/Shanghai**：

| 执行日 | 核对月份 |
|--------|----------|
| 2026-07-15 | 2026-06-01 ~ 2026-06-30 |
| 2026-08-15 | 2026-07-01 ~ 2026-07-31 |

```bash
npm run monthly:close-check -- --auto-prev-month
npm run monthly:close-check -- --month=2026-06
```

## 月报口径（代码诊断）

1. **汇总方式**：`loadDailySnapshots` → 每天 `buildDailyOperationsReport` → `aggregateWeeklySummaryForAcceptance` 求和。
2. **有效成交金额**：`sumValidRevenueFromViews`（支付口径 + 售后剔除），与日报主播行合计一致。
3. **成交单数**：各日 `soldOrderCount` 相加；与整月 `getBoardScopedViewsForRange` 再算一遍应一致（结账脚本会交叉核对）。
4. **退货/售后**：`computeOperationsRefundMetricsFromViews`（退款单数 ÷ 支付单数）。
5. **不是利润**：无商品成本表、无支出表；`grossProfit` 仅出现在旧版/验收工具，**不进入运营月报主指标**。
6. **风险点**：未归属主播、缺支付时间、重复 package、售后缓存未拉全、结算未同步。

## 字段来源表（利润相关）

| 字段/概念 | 表/接口来源 | 是否真实数据 | 能否用于利润 | 风险说明 |
|-----------|-------------|--------------|--------------|----------|
| validAmountYuan | 订单 raw + 分析视图 | 是 | 仅销售结果 | 不是利润 |
| soldOrderCount | 同上 | 是 | 仅销售结果 | 与有效成交口径一致 |
| refundAmount | 售后工作台缓存 + 订单视图 | 部分 | 需完整售后同步 | 待拉取会偏低 |
| settlementAmount | XhsRawPending/SettledSettlement | 有则真实 | 到账参考 | 不等于利润；扣费需人工对 |
| platform fee/commission | 结算 raw JSON | 有则真实 | 费用项 | 需结算同步齐全 |
| productCost | **无表** | 否 | 否 | 不能算毛利 |
| labor/工资 | **无表** | 否 | 否 | 不能算净利 |
| expense/支出 | **无表** | 否 | 否 | 不能算净利 |
| grossProfitCent | 旧 analyze/验收 | 勿用于月报 | 否 | 易误导 |
| opsReviewNote.profitProducts | 运营备注 | 配置 | 否 | 商品角色标签 |

## 数据完整性评分（100 分）

| 维度 | 满分 | 说明 |
|------|------|------|
| 订单 | 20 | 重复/异常金额会扣分 |
| 支付时间 | 20 | 缺支付时间会封顶 60 分 |
| 售后/退款 | 20 | 缓存 pending/failed 会扣分 |
| 结算/到账 | 20 | 无结算数据封顶约 70 分 |
| 成本/支出 | 20 | **当前无数据源，恒 0 分** |

**低于 80 分不输出最终盈亏结论。**  
**缺成本/支出时最多只能「经营销售结果」，不能判断净利润。**

## 支付时间预筛漏单诊断

`npm run diagnose:order-pay-time-gap` **直接扫描 `xhsRawOrder` 全表/宽范围**，不做 `orderTime range` 业务预筛，避免「预筛漏单却诊断不到」的假阴性。

输出字段：`diagnoseMode`（`full_raw_scan` / `wide_raw_scan`）、`rawRowsScanned`、`latePayOver30DaysCount`、`wouldMissWithCurrentPrefilterCount`。

## 只读脚本

```bash
npm run monthly:close-baseline -- --auto-prev-month
npm run monthly:close-check -- --auto-prev-month
npm run diagnose:order-pay-time-gap -- --month=2026-06
npm run diagnose:order-pay-time-gap -- --all
npm run verify:order-pay-time-prefilter
npm run data-safety-baseline
```

以上脚本 **不 write/update/delete** 业务表。

## 禁止事项

- 不得把 `validAmountYuan` 当利润展示
- 不得缺成本还输出盈利/亏损
- 不得批量改历史订单、dedupeKey、金额、归属
