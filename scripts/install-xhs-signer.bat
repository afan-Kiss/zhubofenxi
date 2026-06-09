@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1

rem 进入项目根目录（本脚本位于 scripts\）
cd /d "%~dp0.."
if errorlevel 1 (
  echo 错误: 无法进入项目根目录
  exit /b 1
)

set "VENV_DIR=apps\server\tools\xhs_signer\.venv"
set "REQ=apps\server\tools\xhs_signer\requirements.txt"
set "PY=%VENV_DIR%\Scripts\python.exe"

echo ========================================
echo  小红书签名依赖一键安装
echo ========================================
echo 项目目录: %CD%
echo.

if not exist "apps\server\tools\xhs_signer" (
  echo 错误: 未找到 apps\server\tools\xhs_signer 目录
  exit /b 1
)

if not exist "%REQ%" (
  echo 错误: 未找到 %REQ%
  exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
  echo 错误: 未在 PATH 中找到 python，请先安装 Python 3.10 或更高版本
  exit /b 1
)

for /f "delims=" %%V in ('python -c "import sys; print(sys.version.split()[0])" 2^>nul') do set "PY_VER=%%V"
echo 检测到 Python %PY_VER%

if not exist "%PY%" (
  echo.
  echo 正在创建虚拟环境: %VENV_DIR%
  python -m venv "%VENV_DIR%"
  if errorlevel 1 (
    echo.
    echo 安装失败: 创建虚拟环境失败，请确认已安装 Python 的 venv 模块
    exit /b 1
  )
) else (
  echo 虚拟环境已存在: %VENV_DIR%
)

echo.
echo 正在安装依赖: %REQ%
"%PY%" -m pip install --upgrade pip
if errorlevel 1 (
  echo.
  echo 安装失败: pip 升级失败，请查看上方错误信息
  exit /b 1
)

"%PY%" -m pip install -r "%REQ%"
if errorlevel 1 (
  echo.
  echo 安装失败: pip install 失败，请查看上方错误信息
  exit /b 1
)

echo.
echo 正在测试 import xhshow ...
"%PY%" -c "import xhshow; v=getattr(xhshow,'__version__',None); print('xhshow OK', v if v else '')"
if errorlevel 1 (
  echo.
  echo 安装失败: import xhshow 测试未通过，请查看上方错误信息
  exit /b 1
)

echo.
echo 小红书签名依赖安装完成。
echo.
echo 建议在 apps\server\.env 中取消注释并设置:
echo   XHS_SIGNER_PYTHON=tools/xhs_signer/.venv/Scripts/python.exe
echo.
echo 安装后请重启 API 服务，并在配置中心点击「测试签名」验证。
echo.

endlocal
exit /b 0
