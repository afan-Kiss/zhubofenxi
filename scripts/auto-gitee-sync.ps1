$ErrorActionPreference = "Continue"

$Repo = "E:\主播分析软件"
$Branch = "master"
$LogFile = Join-Path $Repo "scripts\auto-gitee-sync.log"

function Write-Log($msg) {
  $time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "$time  $msg" | Tee-Object -FilePath $LogFile -Append
}

Set-Location $Repo

Write-Log "开始检查 Git 改动"

$inside = git rev-parse --is-inside-work-tree 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Log "当前目录不是 Git 仓库，停止"
  exit 1
}

$changes = git status --porcelain

if (-not $changes) {
  Write-Log "没有改动，不需要同步"
  exit 0
}

Write-Log "检测到改动，准备全部提交，不再拦截敏感文件"

git add -A

$commitMessage = "auto sync " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss")

git commit -m $commitMessage

if ($LASTEXITCODE -ne 0) {
  Write-Log "commit 失败，停止"
  exit 3
}

Write-Log "commit 成功：$commitMessage"

git pull --rebase --autostash origin $Branch

if ($LASTEXITCODE -ne 0) {
  Write-Log "pull 失败，可能有冲突，停止 push"
  exit 4
}

git push origin $Branch

if ($LASTEXITCODE -ne 0) {
  Write-Log "push 失败"
  exit 5
}

Write-Log "同步到 Gitee 成功"
