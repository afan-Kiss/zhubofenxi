# 直播订单经营看板 · Web 版

> **使用说明（启动、配置、功能、上传 Git）请优先阅读根目录 [README.md](./README.md)。**  
> 本文档面向开发与部署维护人员。

Monorepo：`apps/web`（前端）+ `apps/server`（API）。



## 开发运行



```bash

npm install

npm run db:generate

npm run db:migrate

npm run dev

```



- 前端：http://localhost:5173（Vite 将 `/api` 代理到 3001）

- API：http://localhost:3001



分别启动：



```bash

npm run dev:web

npm run dev:server

```



前端请求 API 使用相对路径 `/api`（见 `apps/web/src/lib/api.ts`），不要写死 `localhost`。



## 生产运行（单端口：网页 + API 均在 3001）



适合花生壳等内网穿透，映射到 `127.0.0.1:3001`：



```bash

npm install

npm run prisma:generate

npm run prisma:migrate

npm run build

npm run start:server

```



验证：



| 地址 | 预期 |

|------|------|

| http://127.0.0.1:3001 | 登录页 |

| http://127.0.0.1:3001/login | 登录页（刷新不 404） |

| http://127.0.0.1:3001/admin | 需登录；刷新不 404 |

| http://127.0.0.1:3001/api/health | `{"ok":true,...}` |



花生壳外网示例：`http://25148di1mn10.vicp.fun`（映射 3001 后可直接打开登录页）。



`apps/server/.env` 建议：



```env

NODE_ENV=production

PORT=3001

CORS_ORIGIN=http://25148di1mn10.vicp.fun

COOKIE_SECURE=false

```



未执行 `npm run build` 时，`start:server` 会提示缺少 `apps/web/dist`。



## 数据库

运行时 SQLite 路径：`apps/server/data/app.db`（绝对路径示例：`e:\主播分析软件\apps\server\data\app.db`）。

**勿使用** `file:./data/app.db`（Prisma 会解析到 `apps/server/prisma/data/app.db`）。`.env` 中应写 `DATABASE_URL="file:../data/app.db"`，对应真实运行库 `apps/server/data/app.db`。

**Prisma 必须在 `apps/server` 目录执行：**

```powershell
cd e:\主播分析软件\apps\server
$env:DATABASE_URL="file:../data/app.db"
npx prisma migrate deploy --schema=prisma/schema.prisma
npx prisma generate --schema=prisma/schema.prisma
```

开发环境新建迁移：

```bash
cd apps/server
cp .env.example .env   # 首次
npx prisma migrate dev --schema=prisma/schema.prisma
npx prisma generate --schema=prisma/schema.prisma
```

仓库根目录也可使用 workspace 脚本（等效在 apps/server 执行）：

```bash
npm run prisma:generate
npm run prisma:migrate
```



## 配置中心与下载（super_admin）

登录后进入 **系统管理 → 配置中心**：

1. **平台 Cookie**：粘贴后保存（AES-256-GCM 加密，仅服务端存储，前端不回显明文）
2. **四张表下载链接**：`order` / `live` / `pendingSettlement` / `settledSettlement`
3. **测试下载**：单表或批量；文件保存在 `apps/server/data/downloads/`

环境变量（`apps/server/.env`）：

```env
COOKIE_ENCRYPTION_KEY=至少32位随机字符串
DOWNLOAD_DIR=./data/downloads
MAX_DOWNLOAD_SIZE_MB=100
```

迁移（首次或 schema 更新后）：

```bash
npm run prisma:generate
npm run prisma:migrate
```

### 小红书签名（xhshow）

接口采集依赖 Python 动态签名。若 **配置中心 → 签名状态** 显示 **xhshow 未安装**，请在项目根目录双击或执行：

```bat
scripts\install-xhs-signer.bat
```

脚本会创建 `apps/server/tools/xhs_signer/.venv` 并安装 `requirements.txt`，完成后在 `apps/server/.env` 中配置（如未自动识别）：

```env
XHS_SIGNER_PYTHON=tools/xhs_signer/.venv/Scripts/python.exe
```

然后重启 API 服务，在配置中心点击「测试签名」验证。

## 默认管理员



- 用户名：`admin`

- 密码：`admin123456`



首次启动无用户时自动创建。登录后请尽快修改密码。



## VPS 生产部署（Nginx 反代，可选）



详见 **[DEPLOY.md](./DEPLOY.md)**（Nginx + PM2 + SQLite 持久化）。



快速命令：



```bash

npm install

cp apps/server/.env.production.example apps/server/.env

# 编辑 .env 后：

npm run prisma:generate && npm run prisma:migrate && npm run build

npm run deploy:check

pm2 start ecosystem.config.cjs

```



## 原 Electron 桌面版



仍保留在项目根目录 `src/`，运行：



```bash

npm run dev:desktop

```


