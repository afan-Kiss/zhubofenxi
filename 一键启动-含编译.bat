@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

title 主播分析软件 - 编译并启动

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

echo.
echo ==================================================
echo   主播分析软件 - 先编译再启动
echo   适用：刚改过代码、需要更新 dist 后再运行
echo ==================================================
echo.

cd /d "%ROOT%" || (
  echo [错误] 无法进入项目目录：%ROOT%
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  if exist "E:\node.js\node.exe" set "PATH=E:\node.js;%PATH%"
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 npm，请先安装 Node.js。
  pause
  exit /b 1
)

echo [1/2] 正在编译 npm run build ...
echo.
call npm run build
if errorlevel 1 (
  echo.
  echo [错误] 编译失败，请查看上方报错。
  pause
  exit /b 1
)

echo.
echo [2/2] 编译完成，正在启动服务...
echo.
call "%ROOT%\一键启动.bat"
