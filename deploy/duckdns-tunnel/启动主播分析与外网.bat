@echo off
chcp 65001 >nul
setlocal EnableExtensions

REM 脚本位于 deploy\duckdns-tunnel\，项目根目录为上两级
set "ROOT=%~dp0..\.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"

title 主播分析 · 一键启动
echo ========================================
echo   主播分析 · 本地服务 + 外网隧道
echo ========================================
echo.

cd /d "%ROOT%"
if errorlevel 1 (
  echo [错误] 找不到项目目录: %ROOT%
  pause
  exit /b 1
)

REM ---------- 1. 本地服务 4723 ----------
powershell -NoProfile -Command "try { (Invoke-RestMethod 'http://127.0.0.1:4723/api/health' -TimeoutSec 2).ok } catch { $false }" | findstr /i "True" >nul
if errorlevel 1 (
  echo [1/2] 正在启动本地服务 ^(4723^)...
  start "主播分析-本地服务" /MIN cmd /k "cd /d "%ROOT%" && npm run start:server"
  echo       等待服务就绪...
  timeout /t 10 /nobreak >nul
) else (
  echo [1/2] 本地服务已在运行 ^(4723^)
)

powershell -NoProfile -Command "try { $h=Invoke-RestMethod 'http://127.0.0.1:4723/api/health' -TimeoutSec 5; if($h.ok){exit 0}else{exit 1} } catch { exit 1 }"
if errorlevel 1 (
  echo [警告] 本地 4723 仍未响应，请查看「主播分析-本地服务」窗口
) else (
  echo       本地健康检查通过
)

REM ---------- 2. 外网 SSH 隧道 ----------
echo [2/2] 正在启动外网隧道 ^(14723^)...
start "主播分析-外网隧道" cmd /k ""%~dp0run-tunnel-loop.bat""

echo.
echo ========================================
echo   启动完成
echo ========================================
echo   本机: http://127.0.0.1:4723
echo   外网: http://zhurofenxi.duckdns.org:18080
echo   报表: http://zhurofenxi.duckdns.org:18080/operations-report
echo.
echo   请勿关闭「主播分析-外网隧道」窗口
echo   关闭后外网将无法访问
echo ========================================
echo.
timeout /t 5 /nobreak >nul
