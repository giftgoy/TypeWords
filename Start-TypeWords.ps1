[CmdletBinding()]
param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$entryPath = Join-Path $projectRoot '.output\server\index.mjs'
$stateDir = Join-Path $projectRoot '.typewords.local'
$statePath = Join-Path $stateDir 'server.json'
$url = 'http://localhost:5567'

function Test-TypeWordsProcess([int]$ProcessId) {
    $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    return $null -ne $candidate -and $candidate.Name -eq 'node.exe' -and
        $candidate.CommandLine -like ('*"' + $entryPath + '"*')
}

if (-not (Test-Path -LiteralPath $entryPath)) {
    throw 'The production build is missing. Run pnpm install and pnpm run build in this folder first.'
}

$listeners = @(Get-NetTCPConnection -LocalPort 5567 -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
    foreach ($listener in $listeners) {
        if (-not (Test-TypeWordsProcess $listener.OwningProcess)) {
            throw 'Port 5567 is being used by another application. No process was stopped.'
        }
    }
    $serverProcessId = $listeners[0].OwningProcess
} else {
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    $env:NODE_ENV = 'production'
    $env:NITRO_HOST = '127.0.0.1'
    $env:NITRO_PORT = '5567'
    $server = Start-Process -FilePath $nodePath -ArgumentList ('"' + $entryPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDir 'server.log') -RedirectStandardError (Join-Path $stateDir 'server-error.log') -PassThru
    $serverProcessId = $server.Id
}

New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
@{ processId = $serverProcessId; entryPath = $entryPath; url = $url } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

$ready = $false
$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline) {
    if (-not (Test-TypeWordsProcess $serverProcessId)) {
        throw "TypeWords exited. See $stateDir\server-error.log for details."
    }
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {
        Start-Sleep -Milliseconds 500
    }
}
if (-not $ready) {
    throw "TypeWords did not become ready. See $stateDir\server-error.log for details."
}

Write-Output "TypeWords is running at $url (PID $serverProcessId)."
if (-not $NoBrowser) { Start-Process -FilePath $url }
