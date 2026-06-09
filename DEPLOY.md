# VPS 生产环境部署指南

本文档说明如何在 Linux VPS 上部署 **直播订单经营看板 Web 版**（Nginx + PM2 + SQLite）。

> 原 Electron 桌面版代码仍在项目根目录 `src/`，不受影响。Web 版位于 `apps/web` 与 `apps/server`。

---

## 架构说明

| 组件 | 说明 |
|------|------|
| Nginx | 对外 80 端口，静态文件 + `/api` 反代 |
| PM2 | 运行 `apps/server/dist/index.js`，端口 3001 |
| SQLite | `apps/server/data/app.db`（业务数据） |
| 登录会话 | `app.db` 内 `Session` 表（Prisma，无需 node-gyp） |

**重要：** `apps/server/data/` 为持久化目录，部署更新代码时 **不要删除** 该目录。

---

## 一、服务器准备

推荐：Ubuntu 22.04 / Debian 12，1GB+ 内存。

### 1. 安装 Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

### 2. 安装 PM2 与 Nginx

```bash
sudo npm install -g pm2
sudo apt-get update
sudo apt-get install -y nginx
```

### 3. 防火墙（按需）

```bash
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

---

## 二、上传项目

示例目录：`/var/www/live-business-web`

```bash
sudo mkdir -p /var/www
sudo chown $USER:$USER /var/www
cd /var/www

# 方式 A：git clone
git clone <你的仓库地址> live-business-web
cd live-business-web

# 方式 B：本地上传 zip 后解压到该目录
```

---

## 三、安装依赖与配置环境变量

```bash
cd /var/www/live-business-web
npm install
```

复制生产环境配置：

```bash
cp apps/server/.env.production.example apps/server/.env
nano apps/server/.env
```

**必须修改：**

| 变量 | 说明 |
|------|------|
| `SESSION_SECRET` | 随机长字符串，例如：`openssl rand -base64 48` |
| `CORS_ORIGIN` | 浏览器访问地址，如 `http://123.45.67.89`（与 Nginx 对外一致） |
| `COOKIE_SECURE` | 仅 HTTP 访问时保持 `false`；配置 HTTPS 后改为 `true` |

示例：

```env
NODE_ENV=production
PORT=3001
DATABASE_URL="file:../data/app.db"
SESSION_SECRET=这里填随机生成的长字符串
CORS_ORIGIN=http://123.45.67.89
COOKIE_SECURE=false
```

---

## 四、构建与数据库迁移

**重要：** 所有 Prisma 命令必须在 `apps/server` 目录执行。SQLite 的 `DATABASE_URL` 相对 `prisma/schema.prisma` 解析，请使用 `file:../data/app.db`（真实运行库 `apps/server/data/app.db`）。  
**勿用** `file:./data/app.db`（会落到 `apps/server/prisma/data/app.db`）。勿在仓库根目录用 `file:./apps/server/data/app.db`。

```bash
cd /var/www/live-business-web/apps/server

# 确认 .env 中 DATABASE_URL="file:../data/app.db"
npm run db:generate
npm run db:migrate:deploy
```

Windows PowerShell 示例：

```powershell
cd e:\主播分析软件\apps\server
$env:DATABASE_URL="file:../data/app.db"
npx prisma migrate deploy --schema=prisma/schema.prisma
npx prisma generate --schema=prisma/schema.prisma
```

继续构建：

```bash
cd /var/www/live-business-web
npm run build
npm run deploy:check
```

或在仓库根目录（workspace 会自动在 apps/server 下执行）：

```bash
cd /var/www/live-business-web
npm run prisma:generate
npm run prisma:migrate
npm run build
npm run deploy:check
```

说明：

- `build` = 前端 `apps/web/dist` + 后端 `apps/server/dist`
- `prisma:migrate` 在生产环境执行 `prisma migrate deploy`（不会交互提示）

---

## 五、PM2 启动后端

```bash
cd /var/www/live-business-web

# 首次启动
pm2 start ecosystem.config.cjs

# 查看状态
pm2 status
pm2 logs live-business-server

# 开机自启
pm2 save
pm2 startup
# 按提示执行输出的 sudo 命令
```

验证 API：

```bash
curl http://127.0.0.1:3001/api/health
# 应返回 {"ok":true,"service":"live-business-api"}
```

---

## 六、配置 Nginx

1. 编辑示例配置，替换路径与 IP：

```bash
nano deploy/nginx-live-business.conf
```

将：

- `YOUR_SERVER_IP` → 公网 IP，或暂时写 `_`
- `/var/www/live-business-web` → 你的实际项目路径

2. 安装站点配置：

```bash
sudo cp deploy/nginx-live-business.conf /etc/nginx/sites-available/live-business
sudo ln -sf /etc/nginx/sites-available/live-business /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # 可选，避免冲突
sudo nginx -t
sudo systemctl reload nginx
```

3. 浏览器访问：`http://你的公网IP`

---

## 七、首次登录

| 项目 | 值 |
|------|------|
| 用户名 | `admin` |
| 密码 | `admin123456` |

首次启动且数据库无用户时会自动创建。

登录后请立即进入 **用户管理** 修改默认密码。

---

## 八、更新部署（发新版）

```bash
cd /var/www/live-business-web
git pull   # 或重新上传代码

npm install
npm run prisma:generate
npm run prisma:migrate
npm run build
npm run deploy:check

pm2 restart live-business-server
# 前端静态文件更新后无需重启 Nginx，必要时：sudo systemctl reload nginx
```

**切勿删除** `apps/server/data/`，否则用户与业务数据丢失。

---

## 九、备份建议

定期备份：

```bash
# 示例：每日备份 SQLite
tar -czf backup-$(date +%Y%m%d).tar.gz -C /var/www/live-business-web/apps/server data/
```

建议将备份文件存到对象存储或其他服务器。

---

## 十、后续绑定域名与 HTTPS

1. 域名 A 记录指向 VPS IP  
2. 修改 Nginx `server_name` 为域名  
3. 使用 certbot 申请证书：`sudo certbot --nginx -d your-domain.com`  
4. 修改 `apps/server/.env`：  
   - `CORS_ORIGIN=https://your-domain.com`  
   - `COOKIE_SECURE=true`  
5. `pm2 restart live-business-server`

---

## 安全提醒

1. **默认 admin 密码上线后必须修改。**  
2. **不要把 VPS root 密码、SESSION_SECRET、平台 Cookie 写入 Git 或前端代码。**  
3. **Cookie 下载等功能只能放在后端**，绝不能暴露给浏览器。  
4. **SESSION_SECRET 必须使用随机强字符串。**  
5. 有域名时强烈建议配置 **HTTPS**，并设置 `COOKIE_SECURE=true`。  
6. **定期备份** `apps/server/data/`（含 `app.db`，会话在 `Session` 表中）。

---

## 常用命令速查

| 命令 | 说明 |
|------|------|
| `npm run dev` | 本地开发（前后端） |
| `npm run build` | 生产构建 |
| `npm run start:server` | 直接 node 启动（调试用） |
| `pm2 start ecosystem.config.cjs` | 生产启动 |
| `pm2 restart live-business-server` | 重启后端 |
| `npm run deploy:check` | 部署前检查 |

---

## 故障排查

| 现象 | 处理 |
|------|------|
| 登录后立刻退出 | 检查 `CORS_ORIGIN` 是否与浏览器地址完全一致；HTTP 时 `COOKIE_SECURE=false` |
| 502 Bad Gateway | `pm2 status` 确认后端运行；`curl 127.0.0.1:3001/api/health` |
| 页面空白 | 确认已 `npm run build:web` 且 Nginx `root` 指向 `apps/web/dist` |
| 刷新 404 | 确认 Nginx 配置了 `try_files ... /index.html` |
