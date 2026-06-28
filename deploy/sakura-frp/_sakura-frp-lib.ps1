#requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Dot-sourced: $PSScriptRoot here is deploy/sakura-frp (this file's directory)
$script:SakuraFrpDeployRoot = $PSScriptRoot

function Get-SakuraFrpRoot {
    return $script:SakuraFrpDeployRoot
}

function Get-ProjectRoot {
    return (Resolve-Path (Join-Path $script:SakuraFrpDeployRoot '..\..')).Path
}

function Read-DotEnvFile {
    param([string]$Path)
    $map = @{}
    if (-not (Test-Path -LiteralPath $Path)) {
        return $map
    }
    Get-Content -LiteralPath $Path -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if ($line.Length -eq 0 -or $line.StartsWith('#')) { return }
        $eq = $line.IndexOf('=')
        if ($eq -lt 1) { return }
        $key = $line.Substring(0, $eq).Trim()
        $value = $line.Substring($eq + 1).Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $map[$key] = $value
    }
    return $map
}

function Mask-Secret {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return '(empty)' }
    $t = $Value.Trim()
    if ($t.Length -le 8) { return ('*' * [Math]::Min(8, $t.Length)) }
    return ($t.Substring(0, 4) + '...' + $t.Substring($t.Length - 4))
}

function Test-LocalHealth {
    param(
        [string]$HostName = '127.0.0.1',
        [int]$Port = 4723,
        [int]$TimeoutSec = 8
    )
    $uri = "http://${HostName}:${Port}/api/health"
    try {
        $resp = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec $TimeoutSec
        if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) {
            if ($resp.Content -match '"ok"\s*:\s*true') {
                return @{ Ok = $true; Uri = $uri; Body = $resp.Content.Trim() }
            }
        }
        return @{ Ok = $false; Uri = $uri; Body = $resp.Content.Trim(); Reason = 'health ok is not true' }
    }
    catch {
        return @{ Ok = $false; Uri = $uri; Body = ''; Reason = $_.Exception.Message }
    }
}

function Resolve-FrpcPath {
    param([hashtable]$EnvMap, [string]$ProjectRoot)
    $candidates = @()
    if ($EnvMap.ContainsKey('FRPC_PATH') -and -not [string]::IsNullOrWhiteSpace($EnvMap['FRPC_PATH'])) {
        $candidates += $EnvMap['FRPC_PATH']
    }
    $candidates += @(
        (Join-Path $ProjectRoot 'tools\sakura-frp\frpc.exe')
        (Join-Path (Get-SakuraFrpRoot) 'bin\frpc.exe')
    )
    foreach ($rel in $candidates) {
        $full = if ([System.IO.Path]::IsPathRooted($rel)) { $rel } else { Join-Path $ProjectRoot $rel }
        if (Test-Path -LiteralPath $full) {
            return (Resolve-Path -LiteralPath $full).Path
        }
    }
    return $null
}

function Get-FrpcArgumentList {
    param([hashtable]$EnvMap)
    if ($EnvMap.ContainsKey('SAKURA_FRP_EXTRA_ARGS') -and -not [string]::IsNullOrWhiteSpace($EnvMap['SAKURA_FRP_EXTRA_ARGS'])) {
        $extra = $EnvMap['SAKURA_FRP_EXTRA_ARGS'].Trim()
        if ($extra -match '^-f\s+(\S+)$') {
            return @('-f', $Matches[1])
        }
        return $extra -split '\s+' | Where-Object { $_.Length -gt 0 }
    }
    $token = $EnvMap['SAKURA_FRP_TOKEN']
    $tunnelId = $EnvMap['SAKURA_FRP_TUNNEL_ID']
    if ([string]::IsNullOrWhiteSpace($token)) {
        throw 'Missing SAKURA_FRP_TOKEN'
    }
    if ([string]::IsNullOrWhiteSpace($tunnelId)) {
        throw 'Missing SAKURA_FRP_TUNNEL_ID'
    }
    return @('-f', "${token}:${tunnelId}")
}

function Get-FrpcLaunchArgs {
    param([hashtable]$EnvMap)
    return (Get-FrpcArgumentList -EnvMap $EnvMap) -join ' '
}

function Get-ProcessExecutablePath {
    param([int]$ProcessId)
    try {
        return (Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId").ExecutablePath
    }
    catch {
        return $null
    }
}

function Test-IsManagedFrpcProcess {
    param(
        [int]$ProcessId,
        [string[]]$AllowedRoots
    )
    $exe = Get-ProcessExecutablePath -ProcessId $ProcessId
    if ([string]::IsNullOrWhiteSpace($exe)) { return $false }
    $norm = $exe.ToLowerInvariant()
    foreach ($root in $AllowedRoots) {
        if ($norm.StartsWith($root.ToLowerInvariant())) { return $true }
    }
    return $false
}

function Get-PidFilePath {
    return Join-Path (Get-SakuraFrpRoot) '.frpc.pid'
}

function Get-LogFilePath {
    return Join-Path (Get-SakuraFrpRoot) 'frpc.log'
}

function Get-EnvFilePath {
    return Join-Path (Get-SakuraFrpRoot) 'sakura-frp.env'
}
