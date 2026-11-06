[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$dockerCommand = Get-Command docker.exe -ErrorAction SilentlyContinue
$dockerPath = if ($dockerCommand) { $dockerCommand.Source } else { Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe' }
if (-not (Test-Path -LiteralPath $dockerPath)) { throw 'Docker Desktop is not installed.' }

$dockerReady = $false
try {
    & $dockerPath info --format '{{.ServerVersion}}' *> $null
    $dockerReady = $LASTEXITCODE -eq 0
} catch { $dockerReady = $false }
if (-not $dockerReady) {
    Write-Output 'Docker is not running. No containers were stopped.'
    exit 0
}

& $dockerPath compose --project-directory $PSScriptRoot -f (Join-Path $PSScriptRoot 'docker-compose.yml') stop
if ($LASTEXITCODE -ne 0) { throw 'Could not stop TypeWords. Check Docker Desktop.' }
Write-Output 'TypeWords stopped. Its Docker volumes and learning data were kept.'
