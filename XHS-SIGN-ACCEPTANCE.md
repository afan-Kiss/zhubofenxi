# 小红书动态签名 — 验收清单

## 配置中心 · 测试签名

1. 超级管理员登录 → **配置中心** → **平台 Cookie**
2. 保存有效 Cookie 后点击 **测试签名**
3. 接口 `POST /api/settings/credential/test-sign` 仅返回：
   - `hasXS` / `hasXT` / `hasXSCommon` / `hasAuthorization`（布尔）
   - `message` / `reason`（失败原因分类）
4. **不得**在响应、操作日志、控制台日志中出现：
   - Cookie、Authorization、`x-s`、`x-t`、`x-s-common` 明文

### 失败提示对照

| 场景 | 用户可见文案 |
|------|----------------|
| Python 不可用 | Python 不可用，请安装 Python 并配置 XHS_SIGNER_PYTHON |
| xhshow 未安装 | xhshow 未安装，请执行 pip install -r apps/server/tools/xhs_signer/requirements.txt |
| Cookie 缺 a1 | Cookie 缺少 a1… |
| Cookie 缺 access-token-ark | Cookie 缺少 access-token-ark.xiaohongshu.com… |
| Authorization 提取失败 | Authorization 提取失败… |
| 签名生成失败 | 签名生成失败… |

## 下载总控台 · 五维验收

每张表任务卡片展示：

| 指标 | 说明 |
|------|------|
| 启用签名 | auto_export 且 `XHS_SIGNER_ENABLED=true` |
| 签名成功 | 首次带签名的 ark/edith 请求前签名成功 |
| 接口成功 | 小红书 JSON 接口 HTTP + 业务码成功 |
| 拿到 file_url | 轮询/结算拿到下载地址 |
| 下载 xlsx | 本地校验为 Excel |

失败时显示 **失败阶段**：签名 / 接口 / 轮询 / 下载 / 解析。

自动导出失败时页面顶部提示：可切换 **临时链接（direct_url）** 模式。

## 兜底

- 自动刷新/导出失败 **不删除** 已有 `AnalysisSnapshot`，看板 `GET /api/dashboard/snapshot/latest` 仍返回最近一次 `official_ready` 或 `preview_only` 快照。
- 前端 `ErrorBoundary` 防止单页白屏。

## 环境变量

```env
XHS_SIGNER_ENABLED=true
XHS_SIGNER_PYTHON=python
XHS_SIGNER_SCRIPT=apps/server/tools/xhs_signer/signer.py
```

## 本地冒烟

```powershell
cd E:\主播分析软件
npm run prisma:migrate
npm run build
# 签名探测（无需真实 Cookie）
python apps/server/tools/xhs_signer/signer.py --probe 2>$null; if (-not $?) { pip install -r apps/server/tools/xhs_signer/requirements.txt }
```

启动服务后：配置中心测试签名 → 下载总控台测试四表（需有效 Cookie 才能完成真实导出）。
