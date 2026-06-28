# 阿里云轻量 · 主播分析部署指南

公网 IP：**8.137.126.18**  
部署目录：**/www/wwwroot/zhubo-analysis**  
访问地址：**http://8.137.126.18**

不使用 Sakura Frp、不使用 SSH 反向隧道。公网只开放 **80**，业务进程监听 **127.0.0.1:4723**。

---

## 一、本地项目结构（已确认）

| 项 | 结论 |
|----|------|
| 包管理 | **npm**（根 `package.json` + workspaces） |
| 结构 | **monorepo**：`apps/web` + `apps/server` |
| 前端 | React + Vite → `apps/web/dist` |
| 后端 | Express + Prisma → `apps/server/dist` |
| 端口 | **4723**（`PORT` 环境变量） |
| 健康检查 | **GET /api/health** → `{"ok":true,"service":"live-business-api"}` |
| 构建 | `npm run build`（web + server） |
| 生产启动 | `npm run start:server`（含 prestart 检查 web dist） |
| ORM | **Prisma** |
| 数据库 | **SQLite** → `apps/server/data/app.db` |
| env 模板 | `apps/server/.env.example`、`deploy/aliyun/env.server.example` |

前端 API：**相对路径 `/api`**，不写死 localhost（见 `apps/web/src/lib/api.ts`）。

---

## 二、千帆 / 小红书依赖（Linux 可跑性）

| 能力 | Linux 服务器 | 说明 |
|------|-------------|------|
| 经营总览 / 运营报表 / 主播业绩 / 买家排行 | ✅ | 读 SQLite + 服务端调千帆/小红书 API |
| 数据同步（订单/售后/品退） | ✅ | 需 **直播号 Cookie**（系统设置里配置，加密存库） |
| 动态签名 xhshow | ✅ | 需 `python3` + `scripts/install-xhs-signer.sh` |
| 千帆订单详情跳转 | ✅ | 服务端 `qianfan-order-open-ticket`，用 Cookie 换票 |
| Windows 微信 Hook | ❌ | 代码库无微信 Hook 主路径依赖 |
| Electron 桌面 | ❌ | 仅本地开发用，服务器不部署 |

**环境变量（服务端，非 QIANFAN_* 硬编码名）：**

- `COOKIE_ENCRYPTION_KEY`（必填，≥32 字符）
- `SESSION_SECRET`（必填）
- `CORS_ORIGIN` / `WEB_ORIGIN` = `http://8.137.126.18`
- `HOST=127.0.0.1`、`PORT=4723`
- `XHS_SIGNER_ENABLED=true`
- `XHS_SIGNER_PYTHON=tools/xhs_signer/.venv/bin/python`
- `XHS_SELLER_ID`（可选）

**千帆 Cookie 不在 .env 明文配置** — 部署后在 **系统设置 → 直播号** 粘贴 Cookie（加密写入 SQLite）。

**初始化缓存（可选，部署后 SSH 执行）：**

```bash
cd /www/wwwroot/zhubo-analysis
# 登录系统设置配置 Cookie 后，在设置页触发「经营同步」
# 或启用维护工具后调用预热 API（生产默认关闭 ENABLE_MAINTENANCE_TOOLS）
```

---

## 三、部署前你需要准备

1. **SSH 登录**宝塔服务器（root 或有 sudo 的用户）
2. **Node.js 20 LTS**、**npm**、**pm2**、**python3**、**git**
3. **阿里云防火墙** 放行 **TCP 80**（443 暂不需要）
4. 复制并编辑 **`apps/server/.env`**（见 `deploy/aliyun/env.server.example`）
5. **（强烈建议）** 把本地 `apps/server/data/app.db` 上传到服务器同路径，保留历史订单数据

---

## 四、方式 A：Git 部署（推荐）

```bash
ssh root@8.137.126.18

# 安装 Node 20 / pm2（若宝塔未装，可用 nvm 或宝塔 Node 版本管理）
node -v   # 建议 v20.x
npm -v
pm2 -v

mkdir -p /www/wwwroot/zhubo-analysis/logs
cd /www/wwwroot/zhubo-analysis

# 首次：复制 env（在本地填好密钥后 scp 上传，或在服务器 vi 编辑）
# scp apps/server/.env root@8.137.126.18:/www/wwwroot/zhubo-analysis/apps/server/.env

bash deploy/aliyun/deploy.sh
```

> **注意：** 远程仓库 `main` 分支需包含你要部署的代码。本地若有未 push 修改，请先 `git push` 或使用方式 B。

---

## 五、方式 B：本地打包上传

在 **Windows 项目根目录** PowerShell：

```powershell
# 打包（排除 node_modules、.env、dist 等）
$dest = "$env:TEMP\zhubo-analysis-deploy.zip"
$root = "E:\我的软件源码\主播分析软件"
Compress-Archive -Path @(
  "$root\apps", "$root\deploy", "$root\scripts", "$root\package.json", "$root\package-lock.json"
) -DestinationPath $dest -Force

scp $dest root@8.137.126.18:/tmp/zhubo-analysis.zip
scp "$root\apps\server\.env" root@8.137.126.18:/tmp/zhubo-server.env
# 若有数据库：
# scp "$root\apps\server\data\app.db" root@8.137.126.18:/tmp/app.db
```

在 **服务器**：

```bash
mkdir -p /www/wwwroot/zhubo-analysis
cd /tmp && unzip -o zhubo-analysis.zip -d /www/wwwroot/zhubo-analysis
mkdir -p /www/wwwroot/zhubo-analysis/apps/server/data
mv /tmp/zhubo-server.env /www/wwwroot/zhubo-analysis/apps/server/.env
# mv /tmp/app.db /www/wwwroot/zhubo-analysis/apps/server/data/app.db

cd /www/wwwroot/zhubo-analysis
USE_GIT=0 bash deploy/aliyun/deploy.sh
```

---

## 六、Nginx（宝塔）

1. 宝塔 → **网站** → 添加站点 → 域名填 `8.137.126.18`（或纯 IP 站点）
2. 站点 **配置文件** 参考 `deploy/aliyun/nginx-zhubo-analysis.conf.example`
3. 保存后 **nginx -t** → **重载**
4. 确认 **4723 不对公网开放**，仅 `127.0.0.1:4723`

```bash
ss -lntp | grep -E '4723|:80'
curl -i http://127.0.0.1/api/health
curl -i http://8.137.126.18/api/health
```

---

## 七、简单访问口令（Nginx Basic Auth）

```bash
# 用户名/密码由你手动输入，不要写进 Git
apt install apache2-utils -y   # 或 yum install httpd-tools
htpasswd -c /www/wwwroot/zhubo-analysis/.htpasswd 你的用户名
```

在 Nginx 配置中取消 `auth_basic` 两行注释（`/api/health` 已单独放行）。

---

## 八、pm2 常用命令

```bash
pm2 status
pm2 logs zhubo-analysis
pm2 restart zhubo-analysis
pm2 save
pm2 startup   # 按提示执行一次，实现开机自启
```

项目内脚本：

```bash
bash deploy/aliyun/restart.sh
bash deploy/aliyun/status.sh
bash deploy/aliyun/rollback.sh
```

---

## 九、验收清单

- [ ] `curl http://127.0.0.1:4723/api/health` → ok:true
- [ ] `curl http://127.0.0.1/api/health` → ok:true
- [ ] 浏览器打开 http://8.137.126.18
- [ ] http://8.137.126.18/operations-report
- [ ] 系统设置里 Cookie 测试通过
- [ ] pm2 `zhubo-analysis` 为 online
- [ ] `ss -lntp` 中 4723 为 127.0.0.1，80 为 nginx

---

## 十、回滚

```bash
bash deploy/aliyun/rollback.sh
# 或手动恢复 /www/wwwroot/zhubo-analysis-backup-时间戳
```

---

## 日常发布（本地改完代码后）

在项目根目录执行（需设置环境变量 `SSH_PASS` 为服务器 root 密码）：

```bash
npm run deploy:aliyun
```

脚本会：打包代码 → 上传到 `8.137.126.18` → 构建 → pm2 重启 → 健康检查。  
本地 `apps/server/data/app.db` 若存在会一并上传覆盖服务器数据库（请谨慎）。

---

## 十一、安全提醒

- 勿将 `.env`、Cookie、`.htpasswd` 提交 Git  
- 经营数据敏感，务必加 Basic Auth 或项目登录  
- 不要对公网开放 4723、数据库、维护接口  

---

## 当前阻塞项

**需要您提供 SSH 登录方式**（root 密码或密钥），我才能替您在 `8.137.126.18` 上执行 `deploy.sh`、配置 Nginx 并完成公网验收。

请同时准备：

1. `apps/server/.env` 中的 `SESSION_SECRET`、`COOKIE_ENCRYPTION_KEY`（随机长字符串）
2. 系统设置用的 **小红书/千帆 Cookie**（部署后在 Web 界面填写）
3. （可选）Basic Auth 用户名密码
