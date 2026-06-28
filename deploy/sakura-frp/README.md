# 主播分析 · Sakura Frp 内网穿透（TCP）

把本机 **4723** 端口的经营看板，通过 [Sakura Frp](https://www.natfrp.com/) 暴露为外网 `http://节点域名:远程端口`。

**本方案特点：**

- 只穿透本地 `127.0.0.1:4723`，不碰 VPS、x-ui、Nginx
- 优先 **TCP 隧道**，先跑通 `节点域名:远程端口`
- 真实密钥保存在 `sakura-frp.env`，**不进 Git**
- 一键启动 / 停止 / 验收脚本

---

## 架构

```text
外网浏览器
    ↓  http://节点域名:远程端口
Sakura Frp 节点（TCP）
    ↓  隧道
本机 frpc  →  127.0.0.1:4723（主播分析 API + 前端静态）
```

健康检查：`http://127.0.0.1:4723/api/health`  
预期：`{"ok":true,"service":"live-business-api"}`

---

## 第一步：确认本地服务（只读）

```powershell
netstat -ano | findstr :4723
Invoke-RestMethod http://127.0.0.1:4723/api/health
```

本地服务必须先运行，例如：

```powershell
npm run start:server
```

**不要**为了穿透而关闭现有 node 进程。

---

## 第二步：下载 Sakura Frp 官方客户端

官方来源（任选其一核对）：

| 来源 | 地址 |
|------|------|
| 官方文档 | https://doc.natfrp.com/frpc/usage.html |
| 管理面板下载 | https://www.natfrp.com/tunnel/download |
| 官方 CDN 目录 | https://nya.globalslb.net/natfrp/client/frpc/ |

**不要使用**第三方网盘、论坛、博客里的 exe。

本项目提供官方 CDN 下载脚本（当前版本 `0.51.0-sakura-12.3`，Windows amd64）：

```powershell
powershell -ExecutionPolicy Bypass -File deploy/sakura-frp/download-sakura-frpc.ps1
```

下载后客户端位于（二选一，脚本会自动查找）：

- `tools/sakura-frp/frpc.exe`（推荐）
- `deploy/sakura-frp/bin/frpc.exe`

也可在 Sakura 管理面板 → **服务 → 软件下载** → 选择 **frpc / Windows / amd64** 手动下载，重命名为 `frpc.exe` 放到上述目录。

> Windows 上官方更推荐「启动器」图形界面；本项目为便于命令行一键启停，采用 **frpc 命令行** 方式。

---

## 第三步：在 Sakura Frp 面板创建 TCP 隧道

1. 登录 https://www.natfrp.com/ 管理面板  
2. **查看访问密钥**（客户端专用，不是网站登录密码）  
3. 新建隧道，建议参数：

| 项 | 值 |
|----|-----|
| 隧道类型 | **TCP**（优先） |
| 本地地址 | `127.0.0.1` |
| 本地端口 | `4723` |
| 远程端口 | 平台自动分配，或您手动选择 |
| 备注 | 主播分析本地经营看板 |

4. 创建成功后，记录：

- **访问密钥**（Token）
- **隧道 ID**（纯数字，在隧道列表或「配置文件」里可见）
- **节点域名**（连接地址）
- **远程端口**（外网 TCP 端口）

5. 在隧道操作里点 **配置文件**，可看到类似启动参数：

```text
-f <访问密钥>:<隧道ID>
```

---

## 第四步：填写本地配置（不进 Git）

```powershell
copy deploy\sakura-frp\sakura-frp.env.example deploy\sakura-frp\sakura-frp.env
notepad deploy\sakura-frp\sakura-frp.env
```

填写示例（**请换成您自己的值**）：

```env
SAKURA_FRP_TOKEN=您的访问密钥
SAKURA_FRP_TUNNEL_ID=123456
SAKURA_FRP_REMOTE_HOST=节点域名.example.natfrp.cloud
SAKURA_FRP_REMOTE_PORT=54321
LOCAL_HOST=127.0.0.1
LOCAL_PORT=4723
```

也可把面板复制的完整参数写入（二选一）：

```env
SAKURA_FRP_EXTRA_ARGS=-f 您的访问密钥:隧道ID
```

**安全提醒：**

- 不要把 Token 写进 README、脚本或 Git
- 脚本日志里 Token 只会显示前 4 位 + 后 4 位

---

## 第五步：一键启动隧道

```powershell
powershell -ExecutionPolicy Bypass -File deploy/sakura-frp/start-sakura-frp.ps1
```

脚本会：

1. 检查 `http://127.0.0.1:4723/api/health`（失败则**不启动**隧道）
2. 检查 `sakura-frp.env` 与 `frpc.exe`
3. 启动 frpc，等待约 5 秒
4. 输出外网地址，例如：
   - `http://节点域名:远程端口/api/health`
   - `http://节点域名:远程端口/operations-report`

---

## 第六步：验收

```powershell
powershell -ExecutionPolicy Bypass -File deploy/sakura-frp/check-sakura-frp.ps1
```

验收项：

- 本地服务正常
- frpc 文件存在
- 隧道进程在运行
- （若已填远程地址）外网 health 是否正常

---

## 停止隧道（不影响本地 4723）

```powershell
powershell -ExecutionPolicy Bypass -File deploy/sakura-frp/stop-sakura-frp.ps1
```

只停止 **本项目目录内** 的 `frpc.exe` / 相关 launcher 进程，**不会**停止 node、npm、数据库、微信、千帆中转。

---

## 外网访问地址格式

| 用途 | URL |
|------|-----|
| 健康检查 | `http://<节点域名>:<远程端口>/api/health` |
| 经营总览 | `http://<节点域名>:<远程端口>/` |
| 运营报表 | `http://<节点域名>:<远程端口>/operations-report` |

当前为 **TCP + HTTP**，暂无 HTTPS / 自定义域名。

---

## CORS / WEB_ORIGIN（按需）

若外网 `health` 正常，但页面加载后 API 报跨域错误，再检查 `apps/server/.env`。

**不要直接覆盖**现有 `.env`，请手动追加或修改（把地址换成您的外网地址）：

```env
CORS_ORIGIN=http://节点域名:远程端口
WEB_ORIGIN=http://节点域名:远程端口
COOKIE_SECURE=false
```

修改后**重启本地 4723 服务**：

```powershell
npm run start:server
```

参考模板：`apps/server/.env.example`

---

## 访问保护提醒（必读）

当前 Sakura Frp 外网地址 **如果不加登录保护**，知道地址的人都可能访问经营报表。

报表里可能包含 **订单、买家、售后、成交金额** 等敏感信息。

建议后续增加：

1. 页面访问密码  
2. Basic Auth / 反向代理鉴权  
3. 只读模式（不开放写接口）  
4. **不要**通过穿透暴露千帆 Cookie、微信 Hook、数据库端口  
5. 定期轮换 Sakura 访问密钥  

---

## 打不开时的排查顺序

1. **本地 health 是否正常**  
   `Invoke-RestMethod http://127.0.0.1:4723/api/health`

2. **sakura-frp.env 是否填写完整**  
   Token、隧道 ID、远程域名、远程端口

3. **frpc 是否存在**  
   运行 `download-sakura-frpc.ps1`

4. **隧道进程是否在跑**  
   运行 `check-sakura-frp.ps1`，或查看 `deploy/sakura-frp/frpc.log`

5. **Sakura 面板隧道是否在线**  
   节点是否到期、流量是否用尽、隧道是否被禁用

6. **远程端口是否正确**  
   TCP 模式下必须用面板显示的 **远程端口**，不是本地 4723

7. **外网 health 正常但页面空白 / 接口失败**  
   检查 `CORS_ORIGIN` / `WEB_ORIGIN`，重启 4723

8. **杀软是否拦截 frpc**  
   将 `tools/sakura-frp` 加入白名单

---

## 回滚

1. 停止隧道：`stop-sakura-frp.ps1`  
2. 删除或清空 `deploy/sakura-frp/sakura-frp.env`  
3. 在 Sakura 面板禁用或删除隧道  
4. 若改过 `apps/server/.env` 的 CORS，改回本地地址并重启服务  
5. 本地 `http://127.0.0.1:4723` 不受影响  

---

## 文件清单

| 文件 | 说明 |
|------|------|
| `README.md` | 本文档 |
| `sakura-frp.env.example` | 配置模板（可提交 Git） |
| `sakura-frp.env` | 真实配置（**已 gitignore**） |
| `start-sakura-frp.ps1` | 一键启动 |
| `stop-sakura-frp.ps1` | 安全停止 |
| `check-sakura-frp.ps1` | 验收 |
| `download-sakura-frpc.ps1` | 从官方 CDN 下载 frpc |
| `_sakura-frp-lib.ps1` | 脚本公共函数 |
| `.gitignore` | 忽略密钥与日志 |

---

## 与 DuckDNS 方案的关系

项目内另有 `deploy/duckdns-tunnel/`（SSH 反向隧道 + VPS Nginx）。  
**Sakura Frp 与 DuckDNS 可并存，但不要同时映射同一服务到两个外网入口**，以免混淆。测试 Sakura 时无需改动 VPS / x-ui。
