[CmdletBinding()]
param([switch]$RepairLocalJwtSecret)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'scripts/DevTools.psm1') -Force

$repoRoot = $PSScriptRoot
$infraDir = Join-Path $repoRoot 'infrastructure'
$examplePath = Join-Path $infraDir '.env.example'
$envPath = Join-Path $infraDir '.env'
$composePath = Join-Path $infraDir 'docker-compose.yml'

Write-Host 'CodeCollab local development setup' -ForegroundColor Cyan
Write-Host "Repository: $repoRoot"

if (-not (Test-Path $composePath -PathType Leaf)) {
    throw "Could not find infrastructure/docker-compose.yml. Save setup.ps1 in the CodeCollab repository root."
}
if (-not (Test-Path $examplePath -PathType Leaf)) {
    throw "Could not find infrastructure/.env.example. No files were changed."
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    Write-Warning 'Docker CLI was not found. Install Docker Desktop before running start.ps1.'
} else {
    $composeVersion = & docker compose version 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'Docker Compose v2 was not found. Update/install Docker Desktop before running start.ps1.'
    } else {
        Write-Host "Found $composeVersion" -ForegroundColor Green
    }
}

function New-CodeCollabSecret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    return [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}

if (Test-Path $envPath -PathType Leaf) {
    if ($RepairLocalJwtSecret -and (Repair-LocalJwtSecret $envPath)) {
        Write-Warning 'Replaced only the missing/weak local JWT_SECRET. Updating the backend will invalidate existing sessions; sign in again. Database credentials are unchanged.'
    } else { Write-Host 'infrastructure/.env already exists; preserving it.' -ForegroundColor Yellow }
    Assert-LocalEnvironment (Read-LocalEnvironment $envPath)
} else {
    $envText = [System.IO.File]::ReadAllText($examplePath)
    $secretValues = @{
        JWT_SECRET = New-CodeCollabSecret
        MONGO_ROOT_PASSWORD = New-CodeCollabSecret
        MONGO_APP_PASSWORD = New-CodeCollabSecret
        REDIS_PASSWORD = New-CodeCollabSecret
    }

    foreach ($key in $secretValues.Keys) {
        $envText = [System.Text.RegularExpressions.Regex]::Replace(
            $envText,
            "(?m)^$key=.*$",
            "$key=$($secretValues[$key])"
        )
    }

    [System.IO.Directory]::CreateDirectory($infraDir) | Out-Null
    $stream = [IO.File]::Open($envPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $bytes = [Text.UTF8Encoding]::new($false).GetBytes($envText)
        $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Dispose() }
    Write-Host 'Created infrastructure/.env with unique local secrets.' -ForegroundColor Green
    Write-Host 'Secret values were not printed. Keep this file local and never commit it.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Setup complete.' -ForegroundColor Green
Write-Host 'Next: run .\start.ps1 from this repository root.'
try { Assert-DockerReady; Write-Host 'PASS Docker Linux engine and Compose are ready.' } catch { Write-Warning $_.Exception.Message }
Write-Host 'This configuration is for trusted local development only; it does not qualify production sandbox security.' -ForegroundColor Yellow
