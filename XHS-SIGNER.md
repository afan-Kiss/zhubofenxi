# 小红书动态签名（xhshow）安装说明

Web 后台通过 **Python 签名桥接** 为 ark/edith 接口生成 `x-s`、`x-t`、`x-s-common`，与老辅助出库软件逻辑一致。Cookie 与签名头**仅保存在服务端**，不会返回给浏览器。

## Windows 安装（推荐虚拟环境）

```powershell
cd E:\主播分析软件

python -m venv apps\server\tools\xhs_signer\.venv

apps\server\tools\xhs_signer\.venv\Scripts\pip install -r apps\server\tools\xhs_signer\requirements.txt
```

在 `apps/server/.env` 增加：

```env
XHS_SIGNER_ENABLED=true
XHS_SIGNER_PYTHON=apps/server/tools/xhs_signer/.venv/Scripts/python.exe
XHS_SIGNER_SCRIPT=apps/server/tools/xhs_signer/signer.py
```

修改配置后请重启 `npm run start:server`。

## 不使用 venv

```powershell
pip install xhshow>=0.1.9
```

保持 `XHS_SIGNER_PYTHON=python`（默认）即可。

## Cookie 要求

从**已登录**的小红书商家后台（ark.xiaohongshu.com）复制完整 Cookie，至少包含：

| 字段 | 说明 |
|------|------|
| `a1` | 签名必需 |
| `access-token-ark.xiaohongshu.com` | 形如 `customer.ark.AT-xxx`，系统会提取 `AT-xxx` 作为 Authorization |

## 配置中心自检

1. 保存 Cookie 后，查看「签名状态」卡片。
2. 点击 **测试签名**，应显示已生成 x-s / x-t / x-s-common（接口不返回明文）。
3. 在下载总控台执行四表「接口自动导出」验证。

## 故障判断

| 现象 | 可能原因 |
|------|----------|
| 提示 xhshow / pip install | Python 或依赖未安装 |
| Cookie 缺少 a1 / access-token | Cookie 不完整或不是商家后台 Cookie |
| 401/403 | Cookie 过期，重新登录后台并复制 |
| 签名失败但测试签名成功 | 接口风控或参数变更，可暂用手动链接下载 |

## 安全说明

- 日志与操作记录**不会**写入 Cookie、Authorization、x-s、x-t、x-s-common 明文。
- COS / 腾讯云文件直链下载**不需要**签名头。

更多细节见 [apps/server/tools/xhs_signer/README.md](apps/server/tools/xhs_signer/README.md)。
