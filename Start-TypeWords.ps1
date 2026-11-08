[CmdletBinding()]
param([switch]$NoBrowser, [switch]$Build)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$composePath = Join-Path $projectRoot 'docker-compose.yml'
$url = 'http://localhost:5567'
$dockerCommand = Get-Command docker.exe -ErrorAction SilentlyContinue
$dockerPath = if ($dockerCommand) { $dockerCommand.Source } else { Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe' }

if (-not (Test-Path -LiteralPath $dockerPath)) {
    throw 'Docker Desktop is not installed. Install Docker Desktop with the WSL 2 engine first.'
}
if (-not (Test-Path -LiteralPath $composePath)) {
    throw "Docker Compose configuration is missing: $composePath"
}

function Test-DockerReady {
    try {
        & $dockerPath info --format '{{.ServerVersion}}' *> $null
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}

if (-not (Test-DockerReady)) {
    $desktopPath = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (-not (Test-Path -LiteralPath $desktopPath)) { throw 'Start the Docker engine and try again.' }
    Start-Process -FilePath $desktopPath -WindowStyle Hidden
    $deadline = (Get-Date).AddSeconds(120)
    do {
        Start-Sleep -Seconds 2
        if (Test-DockerReady) { break }
    } while ((Get-Date) -lt $deadline)
    if (-not (Test-DockerReady)) { throw 'Docker Desktop did not become ready. Check its WSL 2 engine status.' }
}

$composeArgs = @('compose', '--project-directory', $projectRoot, '-f', $composePath, 'up', '-d', '--wait', '--wait-timeout', '180')
if ($Build) { $composeArgs += '--build' }
& $dockerPath @composeArgs
if ($LASTEXITCODE -ne 0) { throw 'TypeWords failed to start. Check docker compose ps and docker compose logs --tail 100.' }

$response = Invoke-WebRequest -Uri "$url/api/data/health" -UseBasicParsing -TimeoutSec 10
if ($response.StatusCode -ne 200) { throw 'TypeWords data service is not ready.' }
Write-Output "TypeWords is running in Docker at $url."

# 网页端口已经绑定 0.0.0.0，同一局域网的平板/手机可以走下面这些地址
$virtualAdapters = 'vEthernet|WSL|Default Switch|Loopback|Virtual|Bluetooth'
$lanAddresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
        $_.IPAddress -notlike '127.*' -and
        $_.IPAddress -notlike '169.254.*' -and
        $_.InterfaceAlias -notmatch $virtualAdapters
    } |
    ForEach-Object { '  http://' + $_.IPAddress + ':5567' }
if ($lanAddresses) {
    Write-Output 'Same Wi-Fi (LAN) access for tablet / phone:'
    $lanAddresses | ForEach-Object { Write-Output $_ }
}

if (-not $NoBrowser) { Start-Process -FilePath $url }
