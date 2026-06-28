#requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\_sakura-frp-lib.ps1"

$projectRoot = Get-ProjectRoot
$deployRoot = Get-SakuraFrpRoot
$envFile = Get-EnvFilePath
$pidFile = Get-PidFilePath
$logFile = Get-LogFilePath

Write-Host '=== Sakura Frp start ===' -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $envFile)) {
    Write-Host '[FAIL] deploy/sakura-frp/sakura-frp.env not found' -ForegroundColor Red
    Write-Host 'Copy sakura-frp.env.example to sakura-frp.env and fill tunnel info.'
    exit 1
}

$envMap = Read-DotEnvFile -Path $envFile
$localHost = if ($envMap.ContainsKey('LOCAL_HOST') -and $envMap['LOCAL_HOST']) { $envMap['LOCAL_HOST'] } else { '127.0.0.1' }
$localPort = if ($envMap.ContainsKey('LOCAL_PORT') -and $envMap['LOCAL_PORT']) { [int]$envMap['LOCAL_PORT'] } else { 4723 }

Write-Host "Step 1/4 Local health http://${localHost}:${localPort}/api/health"
$local = Test-LocalHealth -HostName $localHost -Port $localPort
if (-not $local.Ok) {
    Write-Host '[FAIL] Local service not ready. Tunnel will NOT start.' -ForegroundColor Red
    Write-Host "Reason: $($local.Reason)"
    Write-Host 'Start local app first: npm run start:server'
    exit 2
}
Write-Host "  OK: $($local.Body)" -ForegroundColor Green

Write-Host 'Step 2/4 Sakura Frp config'
try {
    $null = Get-FrpcArgumentList -EnvMap $envMap
}
catch {
    Write-Host "[FAIL] Config missing: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Set SAKURA_FRP_TOKEN + SAKURA_FRP_TUNNEL_ID (or SAKURA_FRP_EXTRA_ARGS).'
    exit 3
}

$tokenForLog = if ($envMap.ContainsKey('SAKURA_FRP_TOKEN')) { $envMap['SAKURA_FRP_TOKEN'] } else { '' }
Write-Host ("  Token (masked): {0}" -f (Mask-Secret -Value $tokenForLog))
if ($envMap.ContainsKey('SAKURA_FRP_TUNNEL_ID') -and $envMap['SAKURA_FRP_TUNNEL_ID']) {
    Write-Host ("  Tunnel ID: {0}" -f $envMap['SAKURA_FRP_TUNNEL_ID'])
}

$frpcPath = Resolve-FrpcPath -EnvMap $envMap -ProjectRoot $projectRoot
if (-not $frpcPath) {
    Write-Host '[FAIL] frpc.exe not found' -ForegroundColor Red
    Write-Host 'Run: deploy/sakura-frp/download-sakura-frpc.ps1'
    exit 4
}
Write-Host "  frpc: $frpcPath"

if (Test-Path -LiteralPath $pidFile) {
    $oldPidText = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    if ($oldPidText -match '^\d+$') {
        $oldPid = [int]$oldPidText
        $allowedRoots = @(
            (Join-Path $projectRoot 'tools\sakura-frp')
            (Join-Path $deployRoot 'bin')
        )
        if ((Get-Process -Id $oldPid -ErrorAction SilentlyContinue) -and (Test-IsManagedFrpcProcess -ProcessId $oldPid -AllowedRoots $allowedRoots)) {
            Write-Host "[WARN] Sakura Frp already running PID=$oldPid. Run stop-sakura-frp.ps1 first." -ForegroundColor Yellow
            exit 5
        }
    }
}

Write-Host 'Step 3/4 Start frpc'
$argList = Get-FrpcArgumentList -EnvMap $envMap
$stderrLog = Join-Path $deployRoot 'frpc.stderr.log'
$proc = Start-Process -FilePath $frpcPath -ArgumentList $argList -WorkingDirectory (Split-Path -Parent $frpcPath) -WindowStyle Hidden -PassThru -RedirectStandardOutput $logFile -RedirectStandardError $stderrLog
Set-Content -LiteralPath $pidFile -Value $proc.Id -Encoding ASCII -NoNewline
Write-Host "  PID=$($proc.Id) log=deploy/sakura-frp/frpc.log"

Write-Host 'Step 4/4 Wait for tunnel (~5s)...'
Start-Sleep -Seconds 5

if (-not (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue)) {
    Write-Host '[FAIL] frpc exited. Tunnel may be down.' -ForegroundColor Red
    if (Test-Path -LiteralPath $logFile) {
        Write-Host '--- frpc.log (tail) ---'
        Get-Content -LiteralPath $logFile -Tail 20 | ForEach-Object { Write-Host $_ }
    }
    if (Test-Path -LiteralPath $stderrLog) {
        Write-Host '--- frpc.stderr.log (tail) ---'
        Get-Content -LiteralPath $stderrLog -Tail 20 | ForEach-Object { Write-Host $_ }
    }
    exit 6
}

Write-Host '  frpc process is running.' -ForegroundColor Green

$remoteHost = if ($envMap.ContainsKey('SAKURA_FRP_REMOTE_HOST')) { $envMap['SAKURA_FRP_REMOTE_HOST'].Trim() } else { '' }
$remotePort = if ($envMap.ContainsKey('SAKURA_FRP_REMOTE_PORT')) { $envMap['SAKURA_FRP_REMOTE_PORT'].Trim() } else { '' }

if ([string]::IsNullOrWhiteSpace($remoteHost) -or [string]::IsNullOrWhiteSpace($remotePort)) {
    Write-Host '[HINT] SAKURA_FRP_REMOTE_HOST/PORT not set. Fill sakura-frp.env then run check-sakura-frp.ps1' -ForegroundColor Yellow
    exit 0
}

$healthUrl = "http://${remoteHost}:${remotePort}/api/health"
$pageUrl = "http://${remoteHost}:${remotePort}/operations-report"
Write-Host ''
Write-Host 'Public URLs (TCP, no HTTPS yet):' -ForegroundColor Cyan
Write-Host "  Health:  $healthUrl"
Write-Host "  Report:  $pageUrl"
Write-Host ''
Write-Host 'Check: deploy/sakura-frp/check-sakura-frp.ps1'
