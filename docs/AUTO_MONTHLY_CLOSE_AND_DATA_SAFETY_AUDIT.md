# 自动月度结账与数据安全审计说明

> 本文档记录 **自动月度结账与数据安全体系上线前** 的现状审计，以及本次改造新增的能力。  
> 与 `MONTHLY_CLOSE_RECONCILIATION.md`（核对口径）、`DATA_LEDGER_FRAMEWORK.md`（八层账本框架）配套阅读。

---

## 1. 改造前：月度结账仅为 CLI 只读脚本

**现状（改造前）**

| 能力 | 状态 |
|------|------|
| 月度核对逻辑 | 有，`buildMonthlyCloseReconciliation` + `npm run monthly:close-check` |
| 数据安全基线 | 有，`npm run monthly:close-baseline` |
| 支付时间漏单诊断 | 有，`npm run diagnose:order-pay-time-gap` |
| 结果持久化 | **无**，stdout JSON，不落盘 |
| 与运营月报/经营总览交叉核对 | 部分在 reconciliation 内，**无独立总检服务** |
| 自动执行 | **无**，需人工 SSH / 本地跑脚本 |
| 前端展示 | **无** |

**缺口**：每月 15 号复盘依赖人工记忆与手动执行；核对结论无法被老板或运维直接查看；多模块 cent 差异无统一评分与 blocker 汇总。

**本次补齐**

- `monthly-close-auto.service.ts`：并行跑 **结账核对 + 数据准确性总检 + 同步风险**，合成 `MonthlyCloseAutoReport`
- CLI：`npm run monthly:close-auto`、`npm run monthly:close-status`
- 报告写入 `data/monthly-close-reports/{YYYY-MM}.json`，运行日志 `data/monthly-close-runs.jsonl`

---

## 2. 改造前：无 UI、无 Cron 调度

**现状（改造前）**

- 主菜单五页（经营总览、主播业绩、买家排行、运营报表、系统设置）**不含**数据健康/结账入口
- `scheduler.service` 仅有订单/直播/售后等业务同步 cron，**无**月度结账任务
- 15 号规则仅写在文档与 `resolveMonthlyCloseMonth`，**不会自动触发**

**缺口**：无人值守；错过 15 号需人工补跑；线上无法只读查看最新结账状态。

**本次补齐**

| 组件 | 职责 |
|------|------|
| `monthly-close-scheduler.service.ts` | 注册 cron：`30 3 15 * *`（Asia/Shanghai），核对 **上个月** |
| 启动补跑 | 服务启动后 16~20 号若尚无成功报告，自动补跑一次 |
| 并发锁 | `data/monthly-close-auto.lock`，防止重复执行 |
| 幂等 | 已有 `pass`/`warning` 报告则跳过（`force` 可重跑） |
| `DataHealthPage` | 路由 `/data-health`，主菜单「数据健康」，**只读**展示最新报告 |
| API | `GET /api/board/monthly-close/status`、`/report`；重跑需维护工具 `POST /monthly-close/rerun` |

---

## 3. 小红书（XHS）同步触点盘点

官方 API 经 `XHS_API_REGISTRY` 统一登记，主要触点：

| apiName | 用途 | 典型 trigger |
|---------|------|--------------|
| `order_list` / `order_detail` | 订单拉取 | `scheduled`、`manual` |
| `live_session_list` / `live_overview` / `live_traffic_core` | 直播场次与回放 | `scheduled` |
| `pending_settlement_list` / `settled_settlement_list` / `settlement_detail` | 结算账单 | `scheduled` |
| 品退/品质负反馈 | 独立同步链路 | `scheduled` / `manual` |
| 订单导出（`xhs-export.service`） | 大区间补数 | `manual` |

**改造前风险**

- 冷却、熔断、审计分散在各调用点，**无统一 gate**
- 页面路由或 Service 存在 **直连小红书** 的可能（静态扫描 `xhs-sync-frequency-scan.util` 标记 high/medium）
- 失败重试无全局计数，易在 cron + 手动叠加时 **打爆接口**

**本次补齐：`sync-request-audit.service.ts`**

- 所有经 `requestXhsApi` → `runXhsRequestWithAuditAndThrottle` 的请求统一过闸
- 按 API 冷却（如 `order_list` 5min、`order_detail` 10min、直播/结算 30min）
- 连续失败熔断（5 次 → 开 1h）
- 审计落盘：`data/sync-request-audit/{YYYY-MM-DD}.jsonl`
- `buildSyncRiskStatus()`：24h 请求量、节流/失败/熔断次数 → 并入月度结账 `syncRisk`
- `trigger: page_open` **硬拒绝**（见第 4 节）

---

## 4. 页面访问不触发小红书同步（设计约束）

**原则**：经营 BI 页面 **只读本地 DB / 缓存**；拉数仅在 **定时任务、系统设置手动同步、维护脚本** 中发生。

**改造前**

- 部分 Service / 路由在请求路径上仍可能触发远程调用（导出、品退补拉、直播查询等）
- 前端打开页面即间接加压小红书，与「老板只看数」定位冲突

**改造后硬约束**

```text
checkXhsRequestAllowed({ trigger: 'page_open' }) → allowed: false, status: 'throttled'
```

- `DataHealthPage`、`/api/board/monthly-close/*`：**只读** JSON 报告，不触发 sync
- `GET /api/board/data-accuracy-audit`：现场跑 DB 只读总检，**不**调 XHS
- 验收：`verify-xhs-sync-throttle`、`verify-sync-request-audit` 断言路由层无 high 风险直连

**剩余注意**：未接入 `runXhsRequestWithAuditAndThrottle` 的历史路径（如部分 export/sign 工具）仍须在代码审查中标记；静态扫描结果写入 `syncRisk.directRequestFindings`。

---

## 5. 浮点与 cent 一致性风险

**改造前问题**

| 风险 | 说明 |
|------|------|
| 元 ↔ 分混算 | 多处 `validAmountYuan * 100` 与 `validAmountCent` 并存，JS 浮点累加可能差 1 分 |
| 多路径聚合 | 经营总览、运营日报逐日求和、运营月报、主播业绩、榜单中心 **各自算一遍**，无统一 blocker |
| 展示层 round | 前端 `formatMoney` 与后端 cent 不一致时，肉眼「对得上」、机器对不上 |
| 订单数 vs 金额 | 金额 cent 为 0 但订单 diff ≠ 0（或反之）未统一升格为 danger |

**审计规则（`data-accuracy-audit.service`）**

- 内部比较 **一律 cent 整数**；`diffCent !== 0` 或 `diffCount !== 0` → `danger`
- 核心交叉项：经营总览 vs 日报逐日求和、月报 vs 日报求和、主播合计 vs 大盘、榜单 vs 标准订单、重复单、支付时间漏单、买家榜 vs buyerSummary、售后口径等
- `moneyDiffCentTotal` / `orderDiffTotal` 非零 → 整份报告 `status: danger`，`canClose: false`

**与结账核对关系**

- `monthly-close-reconciliation` 仍输出 section A~F 与 dataQuality 评分（缺成本封顶等）
- 自动结账取 `min(audit.score, reconciliation.dataQuality.score)`，任一侧 `danger` 则不可结账

---

## 6. 新增服务与填补的缺口

| 服务 | 文件 | 作用 |
|------|------|------|
| 自动结账编排 | `monthly-close-auto.service.ts` | 并行 reconciliation + audit + syncRisk，写报告 |
| 定时调度 | `monthly-close-scheduler.service.ts` | 15 号 03:30 + 补跑；挂接 `initScheduler` |
| 报告存储 | `monthly-close-report-store.service.ts` | JSON 报告、jsonl 日志、文件锁 |
| 数据准确性总检 | `data-accuracy-audit.service.ts` | 多模块 cent/订单交叉核对 |
| 同步请求审计 | `sync-request-audit.service.ts` | 节流、熔断、审计、风险摘要 |
| 类型契约 | `monthly-close-auto.types.ts` | `MonthlyCloseAutoReport`、`DataAccuracyCheck` 等 |

**保留的改造前能力（未删除）**

- `monthly-close-reconciliation.service.ts` — 结账核对核心
- `npm run monthly:close-check` / `monthly:close-baseline` — 运维/debug 仍可用
- `docs/MONTHLY_CLOSE_RECONCILIATION.md` — 口径与字段来源表

**新增 npm 脚本**

```bash
npm run monthly:close-auto          # 手动跑自动结账（可 --month= / --force）
npm run monthly:close-status        # CLI 查看最新状态
npm run data:audit                  # 指定日期范围总检
npm run data:audit:month            # 上个月总检
npm run verify:monthly-close-auto
npm run verify:data-accuracy-audit
npm run verify:sync-request-audit
```

---

## 7. 报告存储、API 与 DataHealthPage

### 7.1 持久化路径（相对 `data/`）

| 路径 | 内容 |
|------|------|
| `monthly-close-reports/{YYYY-MM}.json` | 完整 `MonthlyCloseAutoReport` |
| `monthly-close-runs.jsonl` | 每次自动/手动运行一行 |
| `monthly-close-auto.lock` | 执行中锁 |
| `sync-request-audit/{date}.jsonl` | 单次 XHS 请求审计 |

### 7.2 报告关键字段

- `status`：`pass` | `warning` | `danger`
- `canClose`：仅 `pass` 且无 blockers 时为 `true`
- `summary`：有效成交 cent、订单/退款/品退/未归属/重复、moneyDiffCentTotal、orderDiffTotal
- `checks[]`：每项含 diffCent / diffCount
- `syncRisk`：24h 接口健康摘要

### 7.3 前端 `DataHealthPage`（`/data-health`）

- 加载 `GET /api/board/monthly-close/status` → 展示最新报告
- 金额用 `formatMoney`（完整元，非「万」）
- 文案：数据健康 / 月度结账；**不**展示利润、盈亏结论（仍遵守 BI 非财务定位）
- 权限：`operations_report`（与运营报表同级）

### 7.4 验收建议

1. 本地或 staging：`npm run verify:monthly-close-auto`（含 mock 月报告路径断言）
2. `npm run data:audit:month` 对黄金月份 cent 差异为 0
3. 部署后：`GET /api/health` + 打开 `/data-health` 有报告或友好空态
4. 确认打开经营总览/买家排行 **不**新增 `sync-request-audit` 条目（trigger ≠ page_open 成功请求）

---

## 附录：改造前后对照

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| 执行方式 | 人工 CLI | Cron + CLI + 维护 API 重跑 |
| 结果可见性 | 终端 JSON | JSON 文件 + `/data-health` |
| 多模块一致性 | 分散脚本 | `data-accuracy-audit` 统一 checks |
| XHS 频率控制 | 分散 | `sync-request-audit` 统一 gate |
| 页面触发 sync | 存在风险 | `page_open` 禁止；健康页只读 |
| cent 差异 | 无总评 | 1 分即 danger，block 结账 |

**结论**：改造 **不**改变经营指标口径与「非财务系统」定位；在 **可观测、可定时、可审计** 三层补齐月度复盘与数据安全基线。
