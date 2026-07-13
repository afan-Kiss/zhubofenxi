"""Aliyun deploy target defaults. Override with DEPLOY_HOST environment variable."""

from __future__ import annotations

import os

DEPLOY_HOST_DEFAULT = "47.108.21.50"
DEPLOY_USER_DEFAULT = "root"
DEPLOY_DIR = "/www/wwwroot/zhubo-analysis"
DEPLOY_DOMAINS = ("xiangyuzhubao.xyz", "www.xiangyuzhubao.xyz")
PUBLIC_APP_URL = "http://xiangyuzhubao.xyz/zhubofenxi/"


def resolve_deploy_host() -> str:
    return os.environ.get("DEPLOY_HOST", DEPLOY_HOST_DEFAULT).strip() or DEPLOY_HOST_DEFAULT


def web_cors_origins(host: str | None = None) -> str:
    h = host or resolve_deploy_host()
    parts = [
        f"http://{h}",
        f"http://{h}/zhubofenxi",
        *(f"http://{d}" for d in DEPLOY_DOMAINS),
        *(f"http://{d}/zhubofenxi" for d in DEPLOY_DOMAINS),
    ]
    return ",".join(parts)


def domain_origins(host: str | None = None) -> str:
    h = host or resolve_deploy_host()
    return ",".join([f"http://{h}", *(f"http://{d}" for d in DEPLOY_DOMAINS)])


def public_health_url(host: str | None = None) -> str:
    return f"http://{(host or resolve_deploy_host())}/api/health"


def control_server_url(host: str | None = None) -> str:
    return f"http://{(host or resolve_deploy_host())}/control"
