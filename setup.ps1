[CmdletBinding()]
param(
    [switch]$RepairLocalJwtSecret,
    # Skip `npm ci` (for example when dependencies are managed another way).
    [switch]$SkipInstall,
    # Do not configure or start the local LiveKit voice server.
    [switch]$SkipVoice
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'scripts/DevTools.psm1') -Force

$repoRoot = $PSScriptRoot
$infraDir = Join-Path $repoRoot 'infrastructure'
$examplePath = Join-Path $infraDir '.env.example'
$envPath = Join-Path $infraDir '.env'
$composePath = Join-Path $infraDir 'docker-compose.yml'

# Secrets that must never be generated for an existing database without a rotation procedure.
$secretKeys = @('JWT_SECRET', 'MONGO_ROOT_PASSWORD', 'MONGO_APP_PASSWORD', 'REDIS_PASSWORD')
# LiveKit's built-in development-mode credentials. Only valid for a local `livekit-server --dev`.
$localVoice = [ordered]@{ LIVEKIT_URL = 'ws://localhost:7880'; LIVEKIT_API_KEY = 'devkey'; LIVEKIT_API_SECRET = 'secret' }
$livekitImage = 'livekit/livekit-server:v1.8.4'
$livekitContainer = 'codecollab-livekit'

$script:actions = [Collections.Generic.List[string]]::new()
function Pass([string]$Message) { Write-Host "PASS   $Message" -ForegroundColor Green }
function Info([string]$Message) { Write-Host "INFO   $Message" -ForegroundColor Cyan }
function Need([string]$Message) { $script:actions.Add($Message); Write-Host "ACTION $Message" -ForegroundColor Yellow }

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

function Get-EnvEntries([string]$Path) {
    # Key/line/empty flags only; values are never returned or printed.
    $entries = @()
    $lineNumber = 0
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        $lineNumber++
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
            $value = ($Matches[2] -replace '\s+#.*$', '').Trim().Trim('"').Trim("'")
            $entries += [pscustomobject]@{ Key = $Matches[1]; Line = $lineNumber; Empty = [string]::IsNullOrWhiteSpace($value) }
        }
    }
    return $entries
}

function Repair-DuplicateEnvKeys([string]$Path) {
    # Removes duplicate lines only when they are empty and exactly one filled entry remains.
    # Anything else is left for the developer, with line numbers but never values.
    $remove = @()
    foreach ($group in (Get-EnvEntries $Path | Group-Object Key | Where-Object Count -gt 1)) {
        $filled = @($group.Group | Where-Object { -not $_.Empty })
        if ($filled.Count -le 1) {
            $keep = if ($filled.Count -eq 1) { $filled[0] } else { $group.Group[-1] }
            $remove += @($group.Group | Where-Object { $_.Line -ne $keep.Line } | ForEach-Object Line)
            Info "Removed empty duplicate $($group.Name) line(s) from infrastructure/.env."
        } else {
            Need "infrastructure/.env sets $($group.Name) more than once with different values (lines $(($group.Group | ForEach-Object Line) -join ', ')). Keep the correct line, delete the others, then rerun .\setup.ps1."
        }
    }
    if (-not $remove.Count) { return }
    $original = [IO.File]::ReadAllText($Path)
    $newline = if ($original.Contains("`r`n")) { "`r`n" } else { "`n" }
    $lines = $original -split '\r?\n'
    $kept = for ($i = 0; $i -lt $lines.Count; $i++) { if (($i + 1) -notin $remove) { $lines[$i] } }
    $temp = "$Path.codecollab-$([guid]::NewGuid().ToString('N')).tmp"
    try {
        [IO.File]::WriteAllText($temp, ($kept -join $newline), [Text.UTF8Encoding]::new($false))
        [IO.File]::Replace($temp, $Path, [NullString]::Value)
    } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force } }
}

function Get-ExcludedPortRange([int]$Port) {
    $output = & netsh interface ipv4 show excludedportrange protocol=tcp 2>$null
    foreach ($line in $output) {
        if ($line -match '^\s*(\d+)\s+(\d+)') {
            if ($Port -ge [int]$Matches[1] -and $Port -le [int]$Matches[2]) { return "$($Matches[1])-$($Matches[2])" }
        }
    }
    return $null
}

function Test-LiveKit {
    try { return ((Invoke-WebRequest 'http://127.0.0.1:7880' -UseBasicParsing -TimeoutSec 3).Content.Trim() -eq 'OK') } catch { return $false }
}

Write-Host 'CodeCollab local development setup' -ForegroundColor Cyan
Write-Host "Repository: $repoRoot"
Write-Host ''

if (-not (Test-Path $composePath -PathType Leaf)) {
    throw "Could not find infrastructure/docker-compose.yml. Save setup.ps1 in the CodeCollab repository root."
}
if (-not (Test-Path $examplePath -PathType Leaf)) {
    throw "Could not find infrastructure/.env.example. No files were changed."
}

# 1. Tools ---------------------------------------------------------------------------------------
if (Get-Command git -ErrorAction SilentlyContinue) { Pass "$(& git --version)" }
else { Need 'Install Git: winget install --id Git.Git -e   (then open a new PowerShell window).' }

$nodeReady = $false
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Need 'Install Node.js 20 LTS or newer: winget install --id OpenJS.NodeJS.LTS -e   (then open a new PowerShell window and rerun .\setup.ps1).'
} else {
    $nodeVersion = (& node --version).TrimStart('v')
    if ([int]$nodeVersion.Split('.')[0] -lt 20) {
        Need "Node.js $nodeVersion is too old. Install Node.js 20 LTS or newer: winget install --id OpenJS.NodeJS.LTS -e"
    } else { Pass "Node.js $nodeVersion"; $nodeReady = $true }
}

$dockerReady = $false
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Need 'Install Docker Desktop: winget install --id Docker.DockerDesktop -e   Start it once, accept its terms, keep "Use the WSL 2 based engine" on, then rerun .\setup.ps1.'
} else {
    $dockerError = $null
    try { Assert-DockerReady; $dockerReady = $true } catch { $dockerError = $_.Exception.Message }
    $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (-not $dockerReady -and (Test-Path -LiteralPath $desktop) -and -not (Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue)) {
        Info 'Docker Desktop is not running; starting it (this can take up to 3 minutes)...'
        Start-Process -FilePath $desktop
        for ($attempt = 0; $attempt -lt 60 -and -not $dockerReady; $attempt++) {
            Start-Sleep -Seconds 3
            try { Assert-DockerReady; $dockerReady = $true } catch { $dockerError = $_.Exception.Message }
        }
    }
    if ($dockerReady) { Pass 'Docker Desktop Linux engine and Compose v2' }
    else { Need "Docker is not ready: $dockerError" }
}

# 2. Local configuration -------------------------------------------------------------------------
if (Test-Path $envPath -PathType Leaf) {
    Info 'infrastructure/.env already exists; preserving existing values.'
    Repair-DuplicateEnvKeys $envPath
    if ($RepairLocalJwtSecret -and (Repair-LocalJwtSecret $envPath)) {
        Write-Warning 'Replaced only the missing/weak local JWT_SECRET. Updating the backend will invalidate existing sessions; sign in again. Database credentials are unchanged.'
    }
} else {
    $envText = [System.IO.File]::ReadAllText($examplePath)
    foreach ($key in $secretKeys) {
        $secret = New-CodeCollabSecret
        $envText = [System.Text.RegularExpressions.Regex]::Replace($envText, "(?m)^$key=.*$", [Text.RegularExpressions.MatchEvaluator]{ param($match) "$key=$secret" })
    }

    [System.IO.Directory]::CreateDirectory($infraDir) | Out-Null
    $stream = [IO.File]::Open($envPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $bytes = [Text.UTF8Encoding]::new($false).GetBytes($envText)
        $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Dispose() }
    Pass 'Created infrastructure/.env with unique local secrets (values not printed; never commit this file).'
}

$envReady = $false
if (-not @(Get-EnvEntries $envPath | Group-Object Key | Where-Object Count -gt 1).Count) {
    # Settings added to .env.example after this .env was created (for example new rate limits).
    $current = @(Get-EnvEntries $envPath | ForEach-Object Key)
    $added = @()
    foreach ($entry in (Get-EnvEntries $examplePath)) {
        if ($entry.Key -in $current -or $entry.Key -in $secretKeys) { continue }
        $exampleLine = [IO.File]::ReadAllLines($examplePath)[$entry.Line - 1]
        $null = $exampleLine -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*?)\s*$'
        Save-LocalEnvironmentSetting $envPath $entry.Key $Matches[1]
        $added += $entry.Key
    }
    if ($added.Count) { Info "Added new settings from .env.example: $($added -join ', ')." }

    if (-not $SkipVoice) {
        $voice = Read-LocalEnvironment $envPath
        $empty = @($localVoice.Keys | Where-Object { -not $voice.ContainsKey($_) -or [string]::IsNullOrWhiteSpace($voice[$_]) })
        if ($empty.Count -eq $localVoice.Count) {
            foreach ($key in $localVoice.Keys) { Save-LocalEnvironmentSetting $envPath $key $localVoice[$key] }
            Info 'Configured voice chat for the local LiveKit dev server (LiveKit dev-mode credentials, local use only).'
        } elseif ($empty.Count) {
            Need "Voice chat is partly configured. Set $($empty -join ', ') in infrastructure/.env, or clear all three LIVEKIT_* values and rerun .\setup.ps1 to use the local dev server."
        }
    }

    try { Assert-LocalEnvironment (Read-LocalEnvironment $envPath); Pass 'infrastructure/.env is valid'; $envReady = $true }
    catch { Need "infrastructure/.env: $($_.Exception.Message)" }
}

# 3. Ports ---------------------------------------------------------------------------------------
# MongoDB picks a free port automatically in start.ps1, so only fixed ports are checked here.
$ports = [ordered]@{ '3000' = 'frontend'; '5000' = 'backend API'; '6379' = 'Redis' }
if (-not $SkipVoice) { $ports['7880'] = 'LiveKit voice'; $ports['7881'] = 'LiveKit voice' }
$reserved = @()
foreach ($port in $ports.Keys) {
    $range = Get-ExcludedPortRange $port
    if ($range) { $reserved += "$port ($($ports[$port]), reserved range $range)"; continue }
    $listener = Get-NetTCPConnection -State Listen -LocalPort ([int]$port) -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        $name = if ($process) { $process.ProcessName } else { "PID $($listener.OwningProcess)" }
        # Docker Desktop forwards our own containers' ports through these processes.
        if ($name -notmatch '^(com\.docker\.backend|wslrelay|vpnkit|docker.*)$') {
            Need "Port $port ($($ports[$port])) is used by '$name' (PID $($listener.OwningProcess)). Close that program, or stop it with: Stop-Process -Id $($listener.OwningProcess)"
        }
    }
}
if ($reserved.Count) {
    Need "Windows has reserved port(s) $($reserved -join '; '). Docker cannot use them. In an Administrator PowerShell run:  net stop winnat ; net start winnat   then rerun .\setup.ps1 (restarting the PC also usually works)."
} else { Pass "Ports $(@($ports.Keys) -join ', ') are not reserved by Windows" }

# 4. Voice server --------------------------------------------------------------------------------
if (-not $SkipVoice -and $dockerReady -and $envReady) {
    $voice = Read-LocalEnvironment $envPath
    if ($voice.LIVEKIT_URL -ne $localVoice.LIVEKIT_URL) {
        Info 'LIVEKIT_URL points to an external LiveKit server; not starting the local one.'
    } elseif (Test-LiveKit) {
        Pass 'LiveKit voice server is reachable on 127.0.0.1:7880'
    } else {
        $existing = (Invoke-DockerCommand @('ps', '--all', '--quiet', '--filter', "name=^$livekitContainer$") -AllowFailure).Output
        if ($existing) { $null = Invoke-DockerCommand @('start', $livekitContainer) -AllowFailure }
        else {
            Info "Starting the local LiveKit voice server ($livekitImage)..."
            $null = Invoke-DockerCommand @('run', '--detach', '--name', $livekitContainer, '--restart', 'unless-stopped',
                '-p', '127.0.0.1:7880:7880', '-p', '127.0.0.1:7881:7881', '-p', '127.0.0.1:7882:7882/udp',
                $livekitImage, '--dev', '--bind', '0.0.0.0', '--node-ip', '127.0.0.1') -AllowFailure -TimeoutSeconds 300
        }
        $voiceUp = $false
        for ($attempt = 0; $attempt -lt 15 -and -not $voiceUp; $attempt++) { Start-Sleep -Seconds 2; $voiceUp = Test-LiveKit }
        if ($voiceUp) { Pass "LiveKit voice server running (container $livekitContainer)" }
        else { Need "The LiveKit voice server did not start. Check: docker logs $livekitContainer   (voice chat is optional; everything else works without it)." }
    }
}

# 5. Dependencies --------------------------------------------------------------------------------
if (-not $SkipInstall -and $nodeReady -and (Test-Path -LiteralPath (Join-Path $repoRoot 'package-lock.json'))) {
    $lock = Join-Path $repoRoot 'package-lock.json'
    $installed = Join-Path $repoRoot 'node_modules/.package-lock.json'
    if (-not (Test-Path -LiteralPath $installed) -or (Get-Item -LiteralPath $lock).LastWriteTimeUtc -gt (Get-Item -LiteralPath $installed).LastWriteTimeUtc) {
        Info 'Installing Node.js dependencies (npm ci)...'
        Push-Location $repoRoot
        try { & npm ci --no-audit --no-fund; $npmExit = $LASTEXITCODE } finally { Pop-Location }
        if ($npmExit -eq 0) { Pass 'Node.js dependencies installed' }
        else { Need 'npm ci failed. Check your internet connection and the error above, then rerun .\setup.ps1.' }
    } else { Pass 'Node.js dependencies are up to date' }
}

# Summary ----------------------------------------------------------------------------------------
Write-Host ''
if ($script:actions.Count) {
    Write-Host "Setup needs $($script:actions.Count) thing(s) from you:" -ForegroundColor Yellow
    for ($i = 0; $i -lt $script:actions.Count; $i++) { Write-Host "  $($i + 1). $($script:actions[$i])" -ForegroundColor Yellow }
    Write-Host 'Then run .\setup.ps1 again.'
    Write-Host 'This configuration is for trusted local development only; it does not qualify production sandbox security.' -ForegroundColor Yellow
    exit 1
}
Write-Host 'Setup complete.' -ForegroundColor Green
Write-Host 'Next: run .\start.ps1 from this repository root, then open http://localhost:3000'
Write-Host 'This configuration is for trusted local development only; it does not qualify production sandbox security.' -ForegroundColor Yellow
