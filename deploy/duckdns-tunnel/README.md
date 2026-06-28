# 主播分析 · DuckDNS 外网访问（反向隧道方案）

域名：`zhurofenxi.duckdns.org`  
VPS：`45.196.233.210`  
本地服务：`http://127.0.0.1:4723`

## 架构

```text
本地 Windows（4723）
    ↓ SSH 反向隧道 -R 127.0.0.1:14723:127.0.0.1:4723
VPS 127.0.0.1:14723
    ↓ Nginx 高端口 18080（不占用 80/443）
http://zhurofenxi.duckdns.org:18080
```

**不迁移数据库、不搬 Cookie、不停止 x-ui。**

---

## 第一步：本地确认

```powershell
netstat -ano | findstr :4723
Invoke-RestMethod http://127.0.0.1:4723/api/health
```

预期：`{"ok":true,"service":"live-business-api"}`

---

## 第二步：VPS 只读探测

```powershell
ssh root@45.196.233.210
```

登录后上传并执行（或复制脚本内容）：

```bash
bash vps-probe-readonly.sh
```

重点看：

- 80/443 是否被 x-ui / xray 占用
- 是否已有 Nginx
- `zhurofenxi.duckdns.org` 是否解析到本机 IPv4

---

## 第三步：建立反向隧道（本地 Windows）

**新开 PowerShell 窗口**，保持运行：

```powershell
ssh -N -R 127.0.0.1:14723:127.0.0.1:4723 root@45.196.233.210
```

或常驻重连：

```powershell
powershell -ExecutionPolicy Bypass -File deploy\duckdns-tunnel\start-tunnel.ps1
```

VPS 上验证：

```bash
curl -i http://127.0.0.1:14723/api/health
```

---

## 第四步：VPS 配置 Nginx 高端口（18080）

仅在隧道验证通过后：

```bash
sudo bash vps-setup-nginx-18080.sh
```

外网验证：

- `http://zhurofenxi.duckdns.org:18080/api/health`
- `http://zhurofenxi.duckdns.org:18080/operations-report`

---

## 第五步：本地 .env（按实际访问地址）

HTTP 高端口：

```env
CORS_ORIGIN=http://zhurofenxi.duckdns.org:18080
WEB_ORIGIN=http://zhurofenxi.duckdns.org:18080
COOKIE_SECURE=false
```

修改后重启本地 4723 服务。

---

## HTTPS（可选，仅当 80/443 未被 x-ui 占用）

```bash
sudo bash vps-setup-nginx-https.sh
```

---

## SSH 免密（推荐）

本地已有公钥时，把 `~/.ssh/id_ed25519.pub` 内容追加到 VPS：

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys   # 粘贴公钥
chmod 600 ~/.ssh/authorized_keys
```

---

## 回滚

1. 关闭本地 `start-tunnel.ps1` 或 SSH 隧道窗口 → 外网立即不可访问
2. VPS：`rm -f /etc/nginx/conf.d/zhubofenxi.conf && nginx -t && systemctl reload nginx`
3. 恢复 Nginx：从 `/root/backup-before-zhubofenxi/` 复制备份

---

## 禁止操作

- `systemctl stop x-ui`
- `ufw reset` / `iptables -F`
- `rm -rf /etc/nginx`
- 未经确认占用 80/443

---

## 安全提醒

1. 部署成功后修改 VPS root 密码
2. 使用 SSH key，禁用密码登录（可选）
3. 外网无登录保护时，知道地址的人都能看报表
4. 不要把平台 Cookie 暴露到公网
