param(
  [Parameter(Mandatory = $true)][string]$Name,
  [Parameter(Mandatory = $true)][string]$Command,
  [int]$MaxSeconds = 600
)

function Write-Stage([string]$msg) {
  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Write-Host "[$ts] $msg"
}

$start = Get-Date
Write-Stage "START $Name (max ${MaxSeconds}s)"
Write-Stage "CMD: $Command"

$job = Start-Job -ScriptBlock {
  param($cmd, $cwd)
  Set-Location $cwd
  powershell -NoProfile -Command $cmd
} -ArgumentList $Command, (Get-Location).Path

$lastLog = Get-Date
$exitCode = $null

while ($true) {
  $elapsed = ((Get-Date) - $start).TotalSeconds
  if ($elapsed -ge $MaxSeconds) {
    Write-Stage "TIMEOUT $Name after ${MaxSeconds}s — stopping job"
    Stop-Job $job -Force -ErrorAction SilentlyContinue
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    exit 124
  }

  $state = (Get-Job -Id $job.Id).State
  if ($state -eq 'Completed' -or $state -eq 'Failed' -or $state -eq 'Stopped') {
    $output = Receive-Job $job
    if ($output) { $output | ForEach-Object { Write-Host $_ } }
    $exitCode = if ($state -eq 'Completed') { 0 } else { 1 }
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    break
  }

  $partial = Receive-Job $job
  if ($partial) {
    $partial | ForEach-Object { Write-Host $_ }
    $lastLog = Get-Date
  } elseif (((Get-Date) - $lastLog).TotalSeconds -ge 60) {
    Write-Stage "WAITING $Name — still running (${[int]$elapsed}s elapsed, state=$state)"
    $lastLog = Get-Date
  }

  Start-Sleep -Seconds 2
}

$end = Get-Date
$dur = [int](($end - $start).TotalSeconds)
Write-Stage "END $Name exit=$exitCode duration=${dur}s"
exit $exitCode
