#requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\_sakura-frp-lib.ps1"

$projectRoot = Get-ProjectRoot
$deployRoot = Get-SakuraFrpRoot
$pidFile = Get-PidFilePath

Write-Host '=== Stop Sakura Frp ===' -ForegroundColor Cyan

$allowedRoots = @(
    (Join-Path $projectRoot 'tools\sakura-frp')
    (Join-Path $deployRoot 'bin')
)

$targets = @()

if (Test-Path -LiteralPath $pidFile) {
    $pidText = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    if ($pidText -match '^\d+$') {
        $pid = [int]$pidText
        if (Get-Process -Id $pid -ErrorAction SilentlyContinue) {
            if (Test-IsManagedFrpcProcess -ProcessId $pid -AllowedRoots $allowedRoots) {
                $name = (Get-Process -Id $pid).ProcessName
                $targets += [PSCustomObject]@{ Id = $pid; Name = $name; Source = 'pid-file' }
            }
            else {
                Write-Host "[SKIP] PID $pid is not under project frpc dirs." -ForegroundColor Yellow
            }
        }
    }
}

Get-CimInstance Win32_Process -Filter "Name='frpc.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if (Test-IsManagedFrpcProcess -ProcessId $_.ProcessId -AllowedRoots $allowedRoots) {
        if ($targets.Id -notcontains $_.ProcessId) {
            $targets += [PSCustomObject]@{ Id = $_.ProcessId; Name = 'frpc'; Source = 'scan' }
        }
    }
}

$launcherNames = @('natfrp-service.exe', 'SakuraFrpLauncher.exe', 'natfrp_launcher.exe')
foreach ($ln in $launcherNames) {
    Get-CimInstance Win32_Process -Filter "Name='$ln'" -ErrorAction SilentlyContinue | ForEach-Object {
        $exe = $_.ExecutablePath
        if ($exe) {
            $lower = $exe.ToLowerInvariant()
            $managed = $false
            foreach ($root in $allowedRoots) {
                if ($lower.StartsWith($root.ToLowerInvariant())) { $managed = $true; break }
            }
            if ($managed -and ($targets.Id -notcontains $_.ProcessId)) {
                $targets += [PSCustomObject]@{ Id = $_.ProcessId; Name = $ln; Source = 'scan' }
            }
        }
    }
}

if ($targets.Count -eq 0) {
    Write-Host 'No Sakura Frp process to stop.'
    if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force }
    exit 0
}

Write-Host 'Will stop:'
foreach ($t in $targets) {
    $path = Get-ProcessExecutablePath -ProcessId $t.Id
    Write-Host ("  - {0} PID={1} source={2}" -f $t.Name, $t.Id, $t.Source)
    if ($path) { Write-Host "    $path" }
}

foreach ($t in $targets) {
    try {
        Stop-Process -Id $t.Id -Force -ErrorAction Stop
        Write-Host ("Stopped PID={0}" -f $t.Id) -ForegroundColor Green
    }
    catch {
        Write-Host ("Failed PID={0}: {1}" -f $t.Id, $_.Exception.Message) -ForegroundColor Red
    }
}

Start-Sleep -Milliseconds 800

$still = @()
foreach ($t in $targets) {
    if (Get-Process -Id $t.Id -ErrorAction SilentlyContinue) {
        $still += $t.Id
    }
}

if ($still.Count -gt 0) {
    Write-Host ("[WARN] Still running: {0}" -f ($still -join ', ')) -ForegroundColor Yellow
    exit 1
}

if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force }
Write-Host 'Done. node / DB / other apps were NOT touched.' -ForegroundColor Green
