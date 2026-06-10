# 主播分析软件（本地经营看板）

## 最近更新（2026-06-09）

| 模块 | 变更说明 |
|------|----------|
| **主播业绩口径** | 主播时间规则增加「生效日期」，新建规则不再回溯改写历史订单归属 |
| **低价刷单识别** | 唯一排除规则：支付基数 **低于 29 元** 视为刷单，不计入经营总览、主播业绩、买家排行；**不按店铺名排除** |
| **退款与签收** | 纯运费退款不再扣减签收金额；商品退款口径与导出支付时间已对齐修复 |
| **核对包导出** | 导出说明低价刷单阈值，订单明细新增「低价刷单排除」列 |
| **验收脚本** | 新增 `npm run accept:metrics-exclusion`、`npm run accept:anchor-metrics-fix` |

---

小红书直播订单经营分析系统：同步平台订单/直播/结算数据，按主播、买家、时间范围统计 GMV、退款、签收等指标。

- **本机访问**：http://127.0.0.1:3001（网页 + API 同一端口）
- **GitHub 仓库**：https://github.com/afan-Kiss/zhubofenxi
- **Gitee 仓库**：`git@gitee.com:ff472336362/qianfan-wechat-relay-pro.git`

---

## 一、环境要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10/11（推荐） |
| Node.js | 18+（推荐 20/22 LTS） |
| Git | 用于上传代码到 Gitee |
| Python 3.10+ | 仅「小红书动态签名」需要，见下文 |

首次使用请确认命令行可用：

```bat
node -v
npm -v
git -v
```

---

## 二、日常启动（推荐）

**双击项目根目录的 `一键启动.bat`**

脚本会自动完成：

1. **有道云授权校验**（见「授权说明」）
2. 首次自动 `npm install`
3. 关闭占用 3001 端口的旧服务
4. 数据库迁移（`prisma migrate deploy`）
5. 编译前后端（`npm run build`）
6. 启动服务并打开浏览器

启动成功后：

- 浏览器地址：http://127.0.0.1:3001
- **请勿关闭**标题为「**主播分析软件 - 请勿关闭**」的黑色命令行窗口，关闭即停止服务

### 手动启动（备用）

```bat
cd 项目根目录
npm install
npm run build
npm run start:server
```

---

## 三、授权说明

每次启动前会读取有道云分享笔记中的开关：

- 笔记分享页：https://share.note.youdao.com/ynoteshare/index.html?id=59fb59203600e841c444d96bad36d3e4
- 控制项格式：`[直播分析]=开` 或 `[直播分析]=关`

| 笔记内容 | 结果 |
|----------|------|
| `[直播分析]=开` | 允许启动 |
| `[直播分析]=关` | 弹窗提示「软件不可用，请联系17364583794 同V」，并终止启动 |
| 网络失败 / 读不到笔记 | 弹窗提示网络错误，并终止启动 |

---

## 四、首次安装与配置

### 1. 安装依赖

```bat
npm install
```

### 2. 配置环境变量

复制并编辑 `apps/server/.env`（参考 `apps/server/.env.example`）：

```env
DATABASE_URL="file:../data/app.db"
PORT=3001
NODE_ENV=production
COOKIE_ENCRYPTION_KEY=请替换成32位以上随机字符串
DOWNLOAD_DIR=./data/downloads
XHS_SIGNER_ENABLED=true
XHS_SIGNER_PYTHON=tools/xhs_signer/.venv/Scripts/python.exe
```

**必填项**：`COOKIE_ENCRYPTION_KEY`（至少 32 字符随机串，用于加密平台 Cookie）

### 3. 初始化数据库

```bat
npm run prisma:generate
npm run prisma:migrate
```

数据库文件位置：`apps/server/data/app.db`

> 注意：`.env` 中请使用 `DATABASE_URL="file:../data/app.db"`，不要用 `file:./data/app.db`。

### 4. 安装小红书签名（xhshow）

若配置中心显示「xhshow 未安装」，执行：

```bat
scripts\install-xhs-signer.bat
```

完成后重启服务，在配置中心点击「测试签名」验证。

### 5. 默认管理员

| 字段 | 值 |
|------|-----|
| 用户名 | `admin` |
| 密码 | `admin123456` |

首次启动无用户时自动创建，**登录后请尽快修改密码**。

---

## 五、功能说明

登录后顶部有四个主菜单：

### 1. 经营总览 `/`

- 按「今日 / 昨日 / 本周 / 本月 / 自定义」查看整体指标
- 展示 GMV、订单数、退款、签收等汇总
- 支持手动触发经营数据同步（默认约每 180 分钟自动同步）
- 点击指标卡片可下钻查看明细

### 2. 主播业绩 `/anchors`

- 按主播汇总支付金额、发货单金额、发出单数、退款等
- 点击主播卡片打开**订单抽屉**：
  - 查看该主播当期全部订单
  - 顶部显示**直播时长**（当天有几场、开始/结束时间）
  - 底部有一键**复制**业绩摘要
- 本周/本月/自定义较长区间会额外显示签收率、品退率

### 3. 买家排行 `/buyers`

- 按买家统计成交金额、退款等
- 点击买家可查看历史订单与售后情况

### 4. 系统设置 `/settings`

需输入设置密码解锁后进入，主要包含：

| 模块 | 说明 |
|------|------|
| **配置中心** | 粘贴小红书平台 Cookie、配置四表下载、测试签名与连通性 |
| **主播规则** | 配置主播名单、时间段归属规则 |
| **直播号管理** | 多直播账号 Cookie 与同步 |
| **用户管理** | 添加员工账号、绑定主播 |
| **数据管理** | 清理缓存、备份、全量核对包导出 |

#### 配置中心必做项

1. 保存有效的**平台 Cookie**（加密存储，前端不回显明文）
2. 配置 **order / live / pendingSettlement / settledSettlement** 四类下载
3. 点击「测试下载」或触发同步，确认能拉到数据

---

## 六、数据同步说明

- 系统从已配置的小红书接口/下载任务拉取订单、直播场次、待结算、已结算数据
- 同步结果写入 SQLite，经营看板只读本地已同步数据
- 自动同步间隔约 **180 分钟**；也可在经营总览手动触发
- Cookie 过期后需在配置中心重新粘贴并测试

同步期间请保持服务窗口开启，避免中途中断。

---

## 七、外网访问（可选）

生产模式使用单端口 **3001**，可用花生壳 / FRP 等将 `127.0.0.1:3001` 映射到外网。

详见 [RUN-WINDOWS-TUNNEL.md](./RUN-WINDOWS-TUNNEL.md)

注意：

- 电脑不要睡眠，否则服务与穿透会中断
- 外网访问时 `.env` 中 `CORS_ORIGIN` 可改为你的外网域名

---

## 八、上传代码到 Gitee

### 一键上传（日常）

**双击 `上传Gitee.bat`**

脚本会：

1. 确保远程指向 `git@gitee.com:ff472336362/qianfan-wechat-relay-pro.git`
2. `git add -A` 并提交（提交信息带时间戳）
3. `git pull --rebase --autostash` 拉取远程
4. `git push` 上传到 `master` 分支

`上传git.bat` 与 `上传Gitee.bat` 效果相同。

### 首次 push 前

本机需已配置 Gitee **SSH 公钥**，并在 Gitee 账号中添加该公钥。

验证 SSH：

```bat
ssh -T git@gitee.com
```

### 验收后上传

需要跑完整测试再上传时，使用 `验收并上传.bat`（会执行 acceptance + E2E + metrics 后再 push）。

---

## 九、常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式（前端 5173 + 后端 3001） |
| `npm run build` | 编译前后端 |
| `npm run start:server` | 生产启动（需先 build） |
| `npm run prisma:migrate` | 执行数据库迁移 |
| `npm run acceptance` | 业务规则验收 |

---

## 十、目录结构

```
主播分析软件/
├── 一键启动.bat          # 日常启动
├── 上传Gitee.bat           # 一键上传 Gitee
├── 验收并上传.bat          # 验收通过后上传
├── apps/
│   ├── web/                # 前端（React + Vite）
│   └── server/             # 后端（Express + Prisma + SQLite）
├── scripts/
│   ├── youdao-license-check.mjs   # 有道云授权校验
│   └── install-xhs-signer.bat     # 签名依赖安装
└── README.md               # 本说明
```

---

## 十一、常见问题

### 1. 双击一键启动后浏览器打不开

查看「主播分析软件 - 请勿关闭」窗口是否有红色报错。常见原因：

- 未配置 `apps/server/.env`
- `npm run build` 编译失败
- 3001 端口被其他程序占用

### 2. 看板没有数据

1. 进入系统设置 → 配置中心检查 Cookie 是否有效
2. 手动触发一次经营同步
3. 确认 `apps/server/data/app.db` 中有同步记录

### 3. 提示「软件不可用」

有道云笔记中 `[直播分析]=关`，联系管理员改为 `开`。

### 4. git push 失败

- 确认 SSH 公钥已添加到 Gitee
- 确认有 `qianfan-wechat-relay-pro` 仓库写权限
- 若有冲突，按 bat 提示手动 `git rebase --continue` 后再 push

### 5. 主播抽屉没有直播时长

需当天有匹配的直播场次，且订单支付时间落在该场次时段内；重启服务并重新 `npm run build` 后再试。

---

## 十二、更多文档

- [README-WEB.md](./README-WEB.md) — 开发与部署技术细节
- [DEPLOY.md](./DEPLOY.md) — VPS + Nginx + PM2 部署
- [RUN-WINDOWS-TUNNEL.md](./RUN-WINDOWS-TUNNEL.md) — Windows 内网穿透
