# 数据账本八层框架

> 本文档描述小红书直播经营 BI 的 **数据分层与一致性原则**。  
> 各层只向下依赖；上层不得绕过下层改写口径。与 `DATA_METRICS_SPEC.md`（指标定义）、`AUTO_MONTHLY_CLOSE_AND_DATA_SAFETY_AUDIT.md`（结账与审计）配套。

---

## 核心原则

| 原则 | 说明 |
|------|------|
| **cent 整数** | 金额内部一律 **分（cent）** 存储与比较；元仅用于展示。禁止用浮点元做相等性判断。 |
| **1 分即危险** | 任意交叉核对 `diffCent !== 0` → `danger`；不允许「差几分无所谓」。 |
| **订单 diff 同等** | `diffCount !== 0` 与 cent 差异同级处理，避免「金额对、单数错」。 |
| **页面只读 DB** | 用户可见页面与 board API **不 write** 业务表，**不**以 `page_open` 触发小红书请求。 |
| **同步与展示分离** | 拉数仅在 scheduled / manual / retry；展示层读本地快照。 |
| **只读结账** | 月度结账、数据总检 **不** update/delete 订单、dedupeKey、归属、金额。 |
| **非财务边界** | 有效成交 ≠ 利润；缺成本/支出不得输出净利结论（见 reconciliation section F）。 |
| **上海时区** | 经营日、15 号结账月、审计 range 统一 `Asia/Shanghai`。 |
| **可回放** | 报告层、快照层、审计层落盘 JSON/JSONL，支持事后复盘。 |

---

## 八层结构总览

```text
┌─────────────────────────────────────────────────────────┐
│  L8  auto close     自动月度结账（编排 + cron + UI）      │
├─────────────────────────────────────────────────────────┤
│  L7  sync audit     同步请求审计（节流 / 熔断 / jsonl）   │
├─────────────────────────────────────────────────────────┤
│  L6  snapshot       运营日报/周报/月报快照（逐日 build）   │
├─────────────────────────────────────────────────────────┤
│  L5  reconciliation 月度结账核对（完整性 + 结算交叉）      │
├─────────────────────────────────────────────────────────┤
│  L4  report         页面报表（经营总览 / 主播 / 买家 / 运营）│
├─────────────────────────────────────────────────────────┤
│  L3  metric         标准指标聚合（validRevenue / 退款 / 品退）│
├─────────────────────────────────────────────────────────┤
│  L2  normalized     标准订单视图（AnalyzedOrderView 等）   │
├─────────────────────────────────────────────────────────┤
│  L1  raw            小红书原始 JSON（xhsRaw* 表）         │
└─────────────────────────────────────────────────────────┘
         ▲ 同步写入（scheduled/manual）          │
         └────────────────────────────────────────┘
              页面只读 ↑ 不反向写 raw、不直连接口
```

---

## L1 — Raw（原始层）

**职责**：持久化小红书 API / 导出返回的 **未改写 JSON**。

| 典型存储 | 说明 |
|----------|------|
| `xhsRawOrder` | 订单列表/详情 payload |
| `xhsRawPendingSettlement` / `xhsRawSettledSettlement` | 结算列表 |
| 直播/品退等 raw 表 | 场次、品质负反馈等 |

**规则**

- 只追加/ upsert 同步结果，**不在报表路径修改**
- 同步入口：`xhs-api-client` + `xhs-sync-job` + 导出任务
- Raw 条数 ≠ 业务订单数（含跨月、作废、未支付）；比较时须带 range 与 normalize 说明

---

## L2 — Normalized（标准化层）

**职责**：将 raw 解析为 **统一订单视图**（`AnalyzedOrderView`、支付时间、状态、买家键、packageId 等）。

| 关键服务 | 说明 |
|----------|------|
| `xhs-json-normalizer.service` | raw → 标准订单 |
| `board-scoped-views.service` | 按日期 range + 权限 scoped views |
| 低客单刷量过滤等 | 仅影响特定报表路径，须在 metric 层注明 |

**规则**

- 买家键：`buyerId` 优先，否则 `nick:{昵称}`（见 DATA_METRICS_SPEC §5）
- 支付时间、售后时间字段用于 **后续所有** 时间口径
- 标准化 **不产生** 页面指标；仅提供一致输入

---

## L3 — Metric（指标层）

**职责**：在 scoped views 上计算 **经营指标**（cent 整数输出）。

| 指标族 | 核心服务 |
|--------|----------|
| 有效成交 | `valid-revenue-order.service` → `validAmountCent` |
| 支付/成交单数 | `business-metrics` / `board-metrics` |
| 退款 | `operations-after-sale-order.util` |
| 品退 | 官方品退 + 售后原因交叉 |
| 主播业绩 | `aggregateAnchorLeaderboard`（含未归属） |

**规则**

- 聚合结果以 **cent + count** 对外；禁止在中间步骤用 yuan 累加再 round
- 同一指标在不同页面 **必须** 调用同一套 metric 函数或等价逻辑
- `data-accuracy-audit` 在本层做 **横向 diff**（大盘 vs 主播 vs 榜单）

---

## L4 — Report（报表层）

**职责**：面向用户的 **页面与 API**（经营总览、主播业绩、买家排行、运营报表 Drawer 等）。

**规则**

- **只读**：读 DB + 内存聚合，不写 raw、不触发 XHS（`trigger: page_open` 禁止）
- 买家排行：全量画像缓存，**不**随经营总览日期切换（产品规则）
- 金额展示：完整元字符串，禁止「万」缩写（UI_COPY_RULES）
- 长周期才强展示签收率/品退率；短周期不强行展示

---

## L5 — Reconciliation（结账核对层）

**职责**：每月复盘用的 **数据完整性 + 销售结果核对**（非利润表）。

| 输入 | 输出 |
|------|------|
| 整月 scoped views、日报快照、结算 raw、支付时间诊断 | `MonthlyCloseReconciliationReport` section A~F、`dataQuality` |

**规则**

- `validAmountYuan` = 有效成交，**不是**利润
- 缺成本/支出 → `conclusionTier` 不得为「可判断盈亏」
- dataQuality 低于 80 或存在 blockers → 与 L8 联动禁止 `canClose`
- 脚本/服务均 **只读**

---

## L6 — Snapshot（快照层）

**职责**：**逐日** 固化运营视角快照，供周/月报 **求和** 而非重算全量。

| 机制 | 说明 |
|------|------|
| `buildDailyOperationsReport` | 单日运营日报 payload |
| `aggregateWeeklySummaryForAcceptance` | 多日求和 |
| `getMonthlyOperationsReport` | 月报 = 日报快照聚合 |

**规则**

- 月有效成交 cent **必须**等于日快照 cent 之和（`monthly_close_vs_daily_sum` check）
- 快照 **不是** raw；变更 metric 口径须重跑快照或接受 diff
- 快照构建可走 batch，但仍不得改 L1 raw

---

## L7 — Sync Audit（同步审计层）

**职责**：管控 **所有** 小红书 HTTP 触点的频率、失败与可追溯性。

| 能力 | 实现 |
|------|------|
| 冷却 | 按 `apiName` 5~30min |
| 熔断 | 连续失败 5 次 → 1h |
| 审计 | `data/sync-request-audit/*.jsonl` |
| 风险摘要 | `buildSyncRiskStatus` → 并入 L8 报告 |

**规则**

- 必经 `runXhsRequestWithAuditAndThrottle`（或等价 `requestXhsApi` 包装）
- trigger 分类：`scheduled` | `manual` | `retry` | `page_open`(拒) | `unknown`
- 24h 内 failed/throttled/circuit 过高 → L8 `syncRisk.status = danger`

---

## L8 — Auto Close（自动结账层）

**职责**：**编排** L5 + L3 交叉审计（`data-accuracy-audit`）+ L7，定时产出可读的结账结论。

| 组件 | 说明 |
|------|------|
| `runMonthlyCloseAuto` | 并行执行，合成 `MonthlyCloseAutoReport` |
| `monthly-close-scheduler` | 每月 15 日 03:30（上海） |
| `monthly-close-report-store` | `data/monthly-close-reports/{YYYY-MM}.json` |
| `DataHealthPage` | `/data-health` 只读展示 |
| CLI / 维护 API | 手动重跑、状态查询 |

**规则**

- `canClose === true` 仅当：`status === 'pass'` 且无 blockers 且 money/order diff 均为 0 且 syncRisk 非 danger
- 已有 pass/warning 报告则 cron 跳过（幂等）
- 文件锁防并发；失败写 `monthly-close-runs.jsonl`

---

## 层间一致性检查矩阵

| 检查 key | 上层 | 下层 / 对照 |
|----------|------|-------------|
| `board_vs_daily_sum` | L4 经营总览 | L6 日报求和 |
| `monthly_close_vs_daily_sum` | L6 月报 | L6 日报求和 |
| `anchor_sum_vs_board` | L4 主播 | L3 大盘 − 未归属 |
| `ranking_vs_standard_orders` | L4 榜单 | L3 board-metrics |
| `raw_vs_normalized` | L1 raw | L2 normalize（带 range 说明） |
| `pay_time_gap` | L2 预筛 | L1 全表/宽扫诊断 |
| `buyer_ranking_vs_drawer` | L4 买家榜 | L3 buyerSummary |
| syncRisk | L7 | L8 结账门禁 |

任一 cent/订单 diff → **整链标记 danger**，不得用于「可以结账」结论。

---

## 开发与验收清单

1. 新指标：先改 L3 metric，再改 L4 展示；更新 `DATA_METRICS_SPEC.md`
2. 新 XHS 调用：必须接 L7；禁止从 route handler 直连
3. 新页面：确认无 write、无 `page_open` sync
4. 金额 PR：`npm run verify:data-accuracy-audit` + 相关 acceptance
5. 月度发布前：`npm run monthly:close-auto` 或等待 15 号 cron，检查 `/data-health`

---

## 与产品定位的关系

本框架服务于 **直播经营 BI**（支付、退款、品退、主播与客户表现），**不是**财务对账、平台结算或提成系统。  
L5/L8 的「结账」指 **数据是否足够完整、各层 cent 是否对齐**，以便老板做经营复盘；**不是**会计意义上的关账或利润确认。
