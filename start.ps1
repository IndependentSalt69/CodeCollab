[CmdletBinding()]
param([switch]$SkipBuild)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'scripts/DevTools.psm1') -Force
$envPath = Join-Path $PSScriptRoot 'infrastructure/.env'
$values = Read-LocalEnvironment $envPath
Assert-LocalEnvironment $values
foreach ($file in @('infrastructure/docker-compose.yml', 'backend/Dockerfile', 'frontend/Dockerfile', 'execution/runners/python/Dockerfile', 'execution/runners/cpp/Dockerfile', 'execution/runners/java/Dockerfile')) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $file))) { throw "Required file missing: $file" }
}
Assert-DockerReady
$compose = Get-ComposeArguments $PSScriptRoot
$saved = Enter-ComposeEnvironment $values
$archive = Join-Path ([IO.Path]::GetTempPath()) "codecollab-$([guid]::NewGuid().ToString('N')).tar"
$innerArchive = '/tmp/' + [IO.Path]::GetFileName($archive)
$copyAttempted = $false
function Invoke-Stack([string[]]$Arguments) { Invoke-DockerCommand ($compose + $Arguments) $values -TimeoutSeconds 900 }
try {
    $null = Invoke-Stack @('config', '--quiet')
    $runningPort = Get-RunningMongoPort $compose $values
    $port = Select-MongoPort (ConvertTo-HostPort $env:MONGO_HOST_PORT) -RunningPort $runningPort
    Save-MongoPort $envPath $port
    $env:MONGO_HOST_PORT = [string]$port
    Write-Host "MongoDB loopback port: $port (container/service port remains 27017)."
    Write-Warning 'Trusted local development only. This nested daemon does not qualify production isolation.'
    $images = @('python', 'cpp', 'java') | ForEach-Object { "codecollab-runner-${_}:latest" }
    # Finish every build before touching the active stack; Docker reuses its build cache.
    foreach ($language in @('python', 'cpp', 'java')) {
        if (-not $SkipBuild) {
            Write-Host "Building $language runner (cached layers reused)..."
            $context = Join-Path $PSScriptRoot 'execution/runners'
            if ($language -eq 'python') { $context = Join-Path $context 'python' }
            try {
                $null = Invoke-DockerCommand @('build', '-t', "codecollab-runner-${language}:latest", '-f', (Join-Path $PSScriptRoot "execution/runners/$language/Dockerfile"), $context) $values -TimeoutSeconds 900
            } catch { throw "$language runner build failed before stack changes. Check network, HTTPS package repositories and image registry access. $($_.Exception.Message)" }
        }
        $null = Invoke-DockerCommand @('image', 'inspect', '--format', '{{.Id}}', "codecollab-runner-${language}:latest") $values
    }
    if (-not $SkipBuild) {
        Write-Host 'Building application and worker images before starting services...'
        $null = Invoke-Stack @('build', 'backend', 'frontend', 'execution-worker')
    }
    # Preserve existing data and daemon services. Operator-managed recreation is a maintenance action.
    if (-not $runningPort) { Repair-StoppedMongoMapping $compose $port $values }
    $null = Invoke-Stack @('up', '-d', '--no-build', '--no-recreate', 'mongo', 'redis', 'execution-daemon')
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $probe = Invoke-DockerCommand ($compose + @('exec', '-T', 'execution-daemon', 'docker', '-H', 'tcp://127.0.0.1:2375', 'info', '--format', '{{.ServerVersion}}')) $values -AllowFailure
        if ($probe.ExitCode -eq 0 -and $probe.Output -match '^\d+\.\d+\.\d+') { $ready = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw 'Execution daemon did not respond within 60 seconds. Run .\diagnose.ps1; do not raise PID limits or restart a shared daemon blindly.' }
    $missing = @()
    $innerDocker = $compose + @('exec', '-T', 'execution-daemon', 'docker', '-H', 'tcp://127.0.0.1:2375')
    foreach ($image in $images) {
        $hostId = Get-RunnerFingerprint $image -Secrets $values
        try { $innerId = Get-RunnerFingerprint $image $innerDocker $values } catch { $innerId = '' }
        if ($innerId -ne $hostId) { $missing += $image }
    }
    if ($missing.Count) {
        Write-Host 'Transferring missing or changed runner images...'
        $null = Invoke-DockerCommand (@('image', 'save', '--output', $archive) + $missing) $values
        $copyAttempted = $true
        $null = Invoke-Stack @('cp', $archive, "execution-daemon:$innerArchive")
        $null = Invoke-Stack @('exec', '-T', 'execution-daemon', 'docker', '-H', 'tcp://127.0.0.1:2375', 'load', '-i', $innerArchive)
    }
    foreach ($image in $images) {
        $expected = Get-RunnerFingerprint $image -Secrets $values
        $actual = Get-RunnerFingerprint $image $innerDocker $values
        if ($actual -ne $expected) { throw "Image verification failed for $image; worker was not started by this invocation." }
    }
    # Stateless app services: Compose replaces a container only when its image or configuration
    # changed, so a rebuilt image is actually deployed and an unchanged stack is left running.
    $null = Invoke-Stack @('up', '-d', '--no-build', 'backend', 'frontend', 'execution-worker')
    Write-Host 'Waiting for health checks (up to 60 seconds)...'
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $states = (Invoke-Stack @('ps', '--all', '--format', 'json')).Output
        $rows = @($states -split '\r?\n' | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
        if ($rows.Count -eq 6 -and @($rows | Where-Object { $_.State -ne 'running' -or $_.Health -ne 'healthy' }).Count -eq 0) { break }
        Start-Sleep -Seconds 2
    }
    & (Join-Path $PSScriptRoot 'verify.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Verification found failures. Run .\diagnose.ps1 for targeted recovery steps.' }
    Write-Host 'Startup verification passed. Data services were preserved; application services were updated only if their image or configuration changed. Run verify.ps1 -ExecutionSmoke for disposable language runs.'
} catch {
    Write-Host "FAIL startup: $(Protect-DiagnosticText $_.Exception.Message $values)" -ForegroundColor Red
    Write-Host 'Next: .\diagnose.ps1. Existing volumes and services were preserved; no rollback or cleanup of unrelated data was attempted.'
    throw 'Startup incomplete; see the redacted diagnostic above.'
} finally {
    try {
        if ($copyAttempted) {
            try {
                $cleanup = Invoke-DockerCommand ($compose + @('exec', '-u', '0', '-T', 'execution-daemon', 'rm', '-f', $innerArchive)) $values -AllowFailure
                if ($cleanup.ExitCode -ne 0) { throw 'Archive removal failed' }
            } catch { Write-Warning "Temporary daemon archive cleanup failed. Remove only $innerArchive manually when the daemon is reachable." }
        }
        if (Test-Path -LiteralPath $archive) {
            try { Remove-Item -LiteralPath $archive -Force }
            catch { Write-Warning "Temporary host archive cleanup failed. Remove only $archive manually." }
        }
    } finally {
        Exit-ComposeEnvironment $saved
    }
}
