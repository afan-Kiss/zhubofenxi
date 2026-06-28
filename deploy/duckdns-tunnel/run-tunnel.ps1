$ErrorActionPreference = "Continue"
$LogDir = Join-Path $env:USERPROFILE "zhubofenxi-tunnel-logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
while ($true) {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content (Join-Path $LogDir "tunnel.log") "[$ts] connect"
  ssh -N -o ExitOnForwardFailure=yes -R "127.0.0.1:14723:127.0.0.1:4723" zhubofenxi-vps 2>&1 | Add-Content (Join-Path $LogDir "tunnel.log")
  Start-Sleep -Seconds 10
}
