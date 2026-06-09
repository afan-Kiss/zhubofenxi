#!/usr/bin/env python3
"""小红书 ark/edith 接口动态签名（stdin JSON → stdout JSON）。不打印 Cookie 等敏感信息。"""
from __future__ import annotations

import json
import sys
from typing import Any
from urllib.parse import parse_qs, urlparse


def parse_cookie_string(cookie: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in cookie.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        key, value = part.split("=", 1)
        out[key.strip()] = value.strip()
    return out


def extract_a1_from_cookie(cookie: str) -> str:
    parsed = parse_cookie_string(cookie)
    a1 = parsed.get("a1", "")
    if not a1:
        raise ValueError("Cookie 缺少 a1 字段")
    return a1


def extract_authorization_from_cookie(cookie: str) -> str:
    parsed = parse_cookie_string(cookie)
    token = (
        parsed.get("access-token-ark.xiaohongshu.com")
        or parsed.get("access-token-ark")
        or ""
    )
    if not token:
        raise ValueError("Cookie 缺少 access-token-ark.xiaohongshu.com")
    prefix = "customer.ark."
    if token.startswith(prefix):
        token = token[len(prefix) :]
    return token


def sign_headers(
    method: str,
    url: str,
    body: dict[str, Any] | None,
    cookie: str,
    xsec_appid: str = "seller",
) -> dict[str, str]:
    from xhshow import Xhshow

    extract_a1_from_cookie(cookie)
    client = Xhshow()
    method_u = method.upper()

    if method_u == "GET":
        # GET：用完整 URL；query 拆成 params 供 xhshow 签名（无 body 时 payload 不参与）
        parsed = urlparse(url)
        params: dict[str, str] | None = None
        if parsed.query:
            params = {k: (v[0] if v else "") for k, v in parse_qs(parsed.query).items()}
        signed = client.sign_headers_get(
            uri=url,
            cookies=cookie,
            params=params,
            xsec_appid=xsec_appid,
        )
    elif method_u == "POST":
        payload = body if body is not None else {}
        signed = client.sign_headers_post(
            uri=url,
            cookies=cookie,
            payload=payload,
            xsec_appid=xsec_appid,
        )
    else:
        raise ValueError(f"不支持的 HTTP 方法: {method}")

    authorization = extract_authorization_from_cookie(cookie)
    return {
        "x-s": str(signed.get("x-s", "")),
        "x-t": str(signed.get("x-t", "")),
        "x-s-common": str(signed.get("x-s-common", "")),
        "authorization": authorization,
    }


def main() -> None:
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            raise ValueError("缺少输入 JSON")
        data = json.loads(raw)
        method = str(data.get("method", "POST"))
        url = str(data.get("url", "")).strip()
        cookie = str(data.get("cookie", "")).strip()
        xsec_appid = str(data.get("xsec_appid", "seller"))
        body = data.get("body")
        if body is not None and not isinstance(body, dict):
            raise ValueError("body 必须是 JSON 对象")
        if not url:
            raise ValueError("缺少 url")
        if not cookie:
            raise ValueError("缺少 cookie")

        headers = sign_headers(method, url, body, cookie, xsec_appid)
        print(
            json.dumps(
                {"ok": True, "headers": headers},
                ensure_ascii=False,
            ),
            flush=True,
        )
    except Exception as exc:
        msg = str(exc)
        if "xhshow" in msg.lower() or "no module named" in msg.lower():
            msg = (
                "小红书签名模块不可用，请安装 Python 依赖："
                "pip install -r apps/server/tools/xhs_signer/requirements.txt"
            )
        print(
            json.dumps(
                {"ok": False, "message": f"小红书请求签名失败：{msg}"},
                ensure_ascii=False,
            ),
            flush=True,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
