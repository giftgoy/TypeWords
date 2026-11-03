[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$entryPath = Join-Path $PSScriptRoot '.output\server\index.mjs'
$statePath = Join-Path $PSScriptRoot '.typewords.local\server.json'
if (-not (Test-Path -LiteralPath $statePath)) {
    Write-Output 'TypeWords has no recorded server process.'
    exit 0
}

$serverState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$serverState.processId)" -ErrorAction SilentlyContinue
if ($null -ne $candidate) {
    if ($candidate.Name -ne 'node.exe' -or $candidate.CommandLine -notlike ('*"' + $entryPath + '"*')) {
        throw 'The recorded PID belongs to another process. No process was stopped.'
    }
    Stop-Process -Id $candidate.ProcessId -ErrorAction Stop
    Wait-Process -Id $candidate.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $statePath
Write-Output 'TypeWords stopped.'
