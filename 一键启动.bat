@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

title 主播分析软件 - 一键启动

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

set "PORT=3001"
set "LOCAL_URL=http://127.0.0.1:%PORT%"
set "HEALTH_URL=%LOCAL_URL%/api/health"

echo.
echo ==================================================
echo   主播分析软件 - 一键启动
echo ==================================================
echo  项目目录：%ROOT%
echo  本机访问：%LOCAL_URL%
echo ==================================================
echo.

cd /d "%ROOT%" || (
  echo [错误] 无法进入项目目录：%ROOT%
  pause
  exit /b 1
)

if not exist "%ROOT%\package.json" (
  echo [错误] 当前目录没有 package.json，请把本 BAT 放在项目根目录。
  pause
  exit /b 1
)

rem 常见 Node 安装路径兜底
where node >nul 2>nul
if errorlevel 1 (
  if exist "E:\node.js\node.exe" (
    set "PATH=E:\node.js;%PATH%"
  )
)

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 node，请先安装 Node.js 或把 node 加入 PATH。
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 npm，请检查 Node.js 安装。
  pause
  exit /b 1
)

for /f "delims=" %%V in ('node -v 2^>nul') do set "NODE_VER=%%V"
echo  Node 版本：!NODE_VER!
echo.

echo [0/8] 正在读取有道云授权笔记 ...
echo.
node "%ROOT%\scripts\youdao-license-check.mjs"
set "LICENSE_CODE=!ERRORLEVEL!"
if "!LICENSE_CODE!"=="2" (
  echo.
  echo [授权] 直播分析=关，软件不可用。
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show('软件不可用，请联系17364583794 同V','提示',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Warning)"
  pause
  exit /b 2
)
if not "!LICENSE_CODE!"=="0" (
  echo.
  echo [授权] 校验失败，无法确认授权状态。
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show('无法读取有道云授权笔记，请检查网络后重试。','授权校验失败',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Error)"
  pause
  exit /b 1
)
echo  授权校验通过。
echo.

if not exist "%ROOT%\node_modules" (
  echo [1/8] 首次运行，正在安装依赖 npm install ...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [错误] npm install 失败，请查看上方报错。
    pause
    exit /b 1
  )
  echo.
) else (
  echo [1/8] 依赖已就绪，跳过 npm install。
  echo.
)

if not exist "%ROOT%\apps\server\.env" (
  echo [警告] 未找到 apps\server\.env
  echo         请复制 apps\server\.env.example 为 .env 并填写 COOKIE_ENCRYPTION_KEY 等配置。
  echo.
)

echo [2/8] 正在关闭占用 %PORT% 端口的旧服务 ...
echo.

set "KILLED=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  echo  发现旧服务 PID=%%a，正在关闭...
  taskkill /PID %%a /F >nul 2>nul
  set "KILLED=1"
)

if "!KILLED!"=="0" (
  echo  未发现占用 %PORT% 的旧服务。
) else (
  echo  旧服务已关闭。
)

echo.
echo [3/8] 清理 SQLite 临时文件 ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item '%ROOT%\apps\server\data\app.db-journal' -Force -ErrorAction SilentlyContinue" >nul 2>nul
echo  完成。
echo.

echo [4/8] 正在同步数据库 prisma migrate deploy ...
echo.
pushd "%ROOT%\apps\server"
set "DATABASE_URL=file:../data/app.db"
call npx prisma migrate deploy --schema=prisma/schema.prisma
if errorlevel 1 (
  echo.
  echo [错误] 数据库迁移失败，请查看上方报错。
  popd
  pause
  exit /b 1
)
call npx prisma generate --schema=prisma/schema.prisma >nul 2>nul
popd
echo  数据库已就绪。
echo.

echo [5/8] 正在编译项目 npm run build ...
echo.
call npm run build
if errorlevel 1 (
  echo.
  echo [错误] 编译失败，请查看上方报错。
  pause
  exit /b 1
)
echo.

echo [6/8] 正在启动服务（新窗口）...
echo.
start "主播分析软件 - 请勿关闭" cmd /k "cd /d ""%ROOT%"" && npm run start:server"

echo  正在等待服务就绪...
echo.

set "OK=0"
for /l %%i in (1,1,60) do (
  curl.exe -s "%HEALTH_URL%" 2>nul | findstr /i "live-business-api" >nul 2>nul
  if not errorlevel 1 (
    set "OK=1"
    goto HEALTH_OK
  )
  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%HEALTH_URL%'; if ($r.Content -match 'live-business-api') { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 (
    set "OK=1"
    goto HEALTH_OK
  )
  echo  等待中... %%i/60
  timeout /t 1 /nobreak >nul
)

:HEALTH_OK
echo.

if not "!OK!"=="1" (
  echo [警告] 60 秒内未检测到服务启动成功。
  echo         请查看「主播分析软件 - 请勿关闭」窗口里的报错。
  echo.
  pause
  exit /b 1
)

echo [7/8] 服务已启动，正在打开浏览器...
start "" "%LOCAL_URL%"

echo.
echo ==================================================
echo   启动完成
echo.
echo   本机访问：%LOCAL_URL%
echo.
echo   请勿关闭标题为「主播分析软件 - 请勿关闭」的窗口，
echo   关闭该窗口即停止服务。
echo.
echo   需要 FRP 外网隧道时，请自行配置 frpc 映射 3001 端口。
echo ==================================================
echo.

pause
