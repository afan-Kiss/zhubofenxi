#requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\_sakura-frp-lib.ps1"

$projectRoot = Get-ProjectRoot
$deployRoot = Get-SakuraFrpRoot
$envFile = Get-EnvFilePath
$pidFile = Get-PidFilePath

Write-Host '=== Sakura Frp check ===' -ForegroundColor Cyan
Write-Host ''

$envMap = @{}
if (Test-Path -LiteralPath $envFile) {
    $envMap = Read-DotEnvFile -Path $envFile
}
else {
    Write-Host '[config] sakura-frp.env missing (template-only check)' -ForegroundColor Yellow
}

$localHost = if ($envMap.ContainsKey('LOCAL_HOST') -and $envMap['LOCAL_HOST']) { $envMap['LOCAL_HOST'] } else { '127.0.0.1' }
$localPort = if ($envMap.ContainsKey('LOCAL_PORT') -and $envMap['LOCAL_PORT']) { [int]$envMap['LOCAL_PORT'] } else { 4723 }

Write-Host '[1] Local app'
$local = Test-LocalHealth -HostName $localHost -Port $localPort
if ($local.Ok) {
    Write-Host '  OK - local service is up' -ForegroundColor Green
    Write-Host "  $($local.Uri) -> $($local.Body)"
}
else {
    Write-Host '  FAIL - local service not ready' -ForegroundColor Red
    Write-Host "  Reason: $($local.Reason)"
}

Write-Host ''
Write-Host '[2] frpc binary'
$frpcPath = Resolve-FrpcPath -EnvMap $envMap -ProjectRoot $projectRoot
if ($frpcPath) {
    $sizeMb = [Math]::Round((Get-Item -LiteralPath $frpcPath).Length / 1MB, 2)
    Write-Host "  OK - $frpcPath (~${sizeMb} MB)" -ForegroundColor Green
}
else {
    Write-Host '  FAIL - run download-sakura-frpc.ps1' -ForegroundColor Red
}

Write-Host ''
Write-Host '[3] Tunnel client process'
$allowedRoots = @(
    (Join-Path $projectRoot 'tools\sakura-frp')
    (Join-Path $deployRoot 'bin')
)
$running = @()
if (Test-Path -LiteralPath $pidFile) {
    $pidText = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    if ($pidText -match '^\d+$') {
        $pid = [int]$pidText
        if ((Get-Process -Id $pid -ErrorAction SilentlyContinue) -and (Test-IsManagedFrpcProcess -ProcessId $pid -AllowedRoots $allowedRoots)) {
            $running += $pid
        }
    }
}
Get-CimInstance Win32_Process -Filter "Name='frpc.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ((Test-IsManagedFrpcProcess -ProcessId $_.ProcessId -AllowedRoots $allowedRoots) -and ($running -notcontains $_.ProcessId)) {
        $running += $_.ProcessId
    }
}
if ($running.Count -gt 0) {
    Write-Host ("  OK - frpc running PID {0}" -f ($running -join ', ')) -ForegroundColor Green
}
else {
    Write-Host '  WARN - tunnel client not running' -ForegroundColor Yellow
    Write-Host '  Run start-sakura-frp.ps1 after filling sakura-frp.env'
}

Write-Host ''
Write-Host '[4] Public health (if configured)'
$remoteHost = if ($envMap.ContainsKey('SAKURA_FRP_REMOTE_HOST')) { $envMap['SAKURA_FRP_REMOTE_HOST'].Trim() } else { '' }
$remotePort = if ($envMap.ContainsKey('SAKURA_FRP_REMOTE_PORT')) { $envMap['SAKURA_FRP_REMOTE_PORT'].Trim() } else { '' }

if ([string]::IsNullOrWhiteSpace($remoteHost) -or [string]::IsNullOrWhiteSpace($remotePort)) {
    Write-Host '  SKIP - set SAKURA_FRP_REMOTE_HOST and SAKURA_FRP_REMOTE_PORT'
}
else {
    $remoteUri = "http://${remoteHost}:${remotePort}/api/health"
    Write-Host "  Probe: $remoteUri"
    try {
        $remote = Invoke-WebRequest -Uri $remoteUri -UseBasicParsing -TimeoutSec 12
        if ($remote.Content -match '"ok"\s*:\s*true') {
            Write-Host '  OK - public health works' -ForegroundColor Green
            Write-Host "  Report: http://${remoteHost}:${remotePort}/operations-report"
        }
        else {
            Write-Host '  WARN - reachable but health body unexpected' -ForegroundColor Yellow
            Write-Host "  Body: $($remote.Content.Trim())"
        }
    }
    catch {
        Write-Host '  FAIL - public URL not reachable (tunnel down or wrong port?)' -ForegroundColor Red
        Write-Host "  Reason: $($_.Exception.Message)"
    }
}

Write-Host ''
Write-Host '--- Next steps ---'
if (-not $local.Ok) { Write-Host '1. npm run start:server' }
if (-not $frpcPath) { Write-Host '2. deploy/sakura-frp/download-sakura-frpc.ps1' }
if (-not (Test-Path -LiteralPath $envFile)) { Write-Host '3. copy sakura-frp.env.example -> sakura-frp.env' }
if ($running.Count -eq 0) { Write-Host '4. deploy/sakura-frp/start-sakura-frp.ps1' }
Write-Host '5. stop: deploy/sakura-frp/stop-sakura-frp.ps1'
Write-Host '6. CORS help: deploy/sakura-frp/README.md'
