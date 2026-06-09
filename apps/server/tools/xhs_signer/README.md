# 小红书动态签名（xhshow）

本目录为 Node 后端调用的小红书 `x-s` / `x-t` / `x-s-common` 签名桥接脚本，逻辑与老辅助出库软件 `xhs_signer.py` 一致。

## Windows 安装（推荐 venv）

```powershell
cd E:\主播分析软件

python -m venv apps\server\tools\xhs_signer\.venv

apps\server\tools\xhs_signer\.venv\Scripts\pip install -r apps\server\tools\xhs_signer\requirements.txt
```

在 `apps/server/.env` 中配置：

```env
XHS_SIGNER_ENABLED=true
XHS_SIGNER_PYTHON=apps/server/tools/xhs_signer/.venv/Scripts/python.exe
XHS_SIGNER_SCRIPT=apps/server/tools/xhs_signer/signer.py
```

## 不使用 venv

```powershell
pip install xhshow>=0.1.9
```

## 手动测试

```powershell
echo '{"method":"POST","url":"https://ark.xiaohongshu.com/api/edith/fulfillment/tool/file/start_export","body":{},"cookie":"a1=xxx; access-token-ark.xiaohongshu.com=customer.ark.AT-xxx"}' | python apps/server/tools/xhs_signer/signer.py
```

成功时 stdout 为 `{"ok":true,"headers":{...}}`，不会在 stderr 打印 Cookie。

## Cookie 要求

- 必须包含 `a1`
- 必须包含 `access-token-ark.xiaohongshu.com`（值可为 `customer.ark.AT-xxx`，脚本会提取 `AT-xxx` 作为 Authorization）
