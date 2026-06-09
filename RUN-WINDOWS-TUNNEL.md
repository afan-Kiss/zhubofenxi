# Windows + 花生壳 运行说明

本系统生产模式使用 **单端口 3001**：同一进程提供 API 与前端静态资源。

---

## 启动步骤

### 1. 打开花生壳客户端

将内网映射到本机：

- 内网主机：`127.0.0.1`
- 内网端口：`3001`
- 外网示例：`http://25148di1mn10.vicp.fun`（以你花生壳控制台为准）

### 2. 打开 PowerShell

```powershell
$env:Path = "E:\node.js;" + $env:Path
cd E:\主播分析软件
```

### 3. 首次或更新后：安装依赖与数据库

**Prisma 必须在 `apps\server` 目录执行。** SQLite 路径相对 `prisma/schema.prisma` 解析，请用 `DATABASE_URL=file:../data/app.db`（对应 `apps/server/data/app.db`）。勿用 `file:./data/app.db`。

```powershell
npm install
cd apps\server
$env:DATABASE_URL="file:../data/app.db"
npx prisma migrate deploy --schema=prisma/schema.prisma
npx prisma generate --schema=prisma/schema.prisma
cd ..\..
```

或仓库根目录：

```powershell
npm install
npm run prisma:generate
npm run prisma:migrate
```

### 4. 配置环境变量

复制并编辑 `apps/server/.env`（参考 `apps/server/.env.example`）：

- `COOKIE_ENCRYPTION_KEY`：至少 32 字符随机串（必填）
- `PORT=3001`
- 可选：`DOWNLOAD_DIR`、`REPORT_DIR`、`BACKUP_DIR`

### 5. 构建并启动

```powershell
npm run build
npm run start:server
```

看到日志：`API + 前端静态 http://0.0.0.0:3001` 即成功。

### 6. 访问

- 本机：<http://127.0.0.1:3001>
- 花生壳外网：你的映射域名，例如 <http://25148di1mn10.vicp.fun>

---

## 注意事项

1. **电脑不能睡眠**：睡眠后服务与花生壳映射会中断。
2. **PowerShell 窗口不能关**：关闭窗口即停止 Node 服务。
3. **花生壳需在线**：客户端掉线则外网无法访问。
4. **Cookie 会过期**：平台 Cookie 失效后需在「配置中心」重新配置并测试。
5. **自动刷新期间勿关服务**：凌晨 2 点自动刷新会下载四表并写快照，中断会导致任务失败。
6. **长期正式使用建议 VPS**：Windows + 花生壳适合内网穿透试用；稳定运营请部署到 Linux 云服务器，并配置进程守护（如 PM2）。

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发：Vite 5173 + API 3001 |
| `npm run build` | 构建前端 + 编译服务端 |
| `npm run start:server` | 生产启动（会先检查 web dist） |
| `npm run prisma:migrate` | 应用数据库迁移 |

---

## 故障排查

| 现象 | 处理 |
|------|------|
| 外网能开页但 API 401 | 检查是否同域访问；不要混用 localhost 与外网域名 |
| 下载失败 | 重新配置 Cookie；看操作日志与下载任务错误信息 |
| 看板无数据 | 超管执行一次手动刷新；确认四表下载成功 |
| Prisma EPERM | 先停止 `start:server` 再 `prisma:generate` |
| 迁移落到错误路径 | 确认 `cd apps\server` 且 `DATABASE_URL=file:../data/app.db`（勿用 `file:./data/app.db`） |
| failed migration | 见 README-WEB.md「数据库」：`migrate resolve` 后再 `deploy` |

更多部署说明见 [README-WEB.md](./README-WEB.md)、[DEPLOY.md](./DEPLOY.md)。
