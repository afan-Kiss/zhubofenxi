#requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\_sakura-frp-lib.ps1"

$projectRoot = Get-ProjectRoot
$version = '0.51.0-sakura-12.3'
$fileName = 'frpc_windows_amd64.exe'
$officialUrl = "https://nya.globalslb.net/natfrp/client/frpc/$version/$fileName"
$docUrl = 'https://doc.natfrp.com/frpc/usage.html'
$panelUrl = 'https://www.natfrp.com/tunnel/download'

$targets = @(
    (Join-Path $projectRoot 'tools\sakura-frp\frpc.exe')
    (Join-Path (Get-SakuraFrpRoot) 'bin\frpc.exe')
)

Write-Host '=== Download Sakura Frp frpc (official CDN) ===' -ForegroundColor Cyan
Write-Host "CDN:   $officialUrl"
Write-Host "Docs:  $docUrl"
Write-Host "Panel: $panelUrl"
Write-Host ''

foreach ($dest in $targets) {
    $dir = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    Write-Host "Saving: $dest"
    Invoke-WebRequest -Uri $officialUrl -OutFile $dest -UseBasicParsing
    $item = Get-Item -LiteralPath $dest
    $sizeMb = [Math]::Round($item.Length / 1MB, 2)
    Write-Host ("  OK: {0} bytes (~{1} MB)" -f $item.Length, $sizeMb) -ForegroundColor Green
}

Write-Host ''
Write-Host 'Optional version check:'
try {
    & $targets[0] -v
}
catch {
    Write-Host '  Could not read version (antivirus may block frpc).' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Next: copy sakura-frp.env.example to sakura-frp.env, then run start-sakura-frp.ps1'
