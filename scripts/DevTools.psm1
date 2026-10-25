Set-StrictMode -Version Latest

function Read-LocalEnvironment([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'Missing infrastructure/.env; run .\setup.ps1.' }
    $values = @{}
    $lineNumber = 0
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        $lineNumber++
        if ($line -match '^\s*(#.*)?$') { continue }
        if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
            throw "Malformed environment entry at line $lineNumber. Use one KEY=value per line; values are not displayed."
        }
        $key = $Matches[1]; $value = $Matches[2]
        if ($values.ContainsKey($key)) { throw "Duplicate environment key $key at line $lineNumber; keep exactly one entry." }
        if ($value.StartsWith("'") -or $value.StartsWith('"')) {
            $quote = $value.Substring(0, 1)
            if ($value -notmatch ('^' + $quote + '(.*)' + $quote + '\s*(?:#.*)?$')) { throw "Malformed quoted value for $key at line $lineNumber." }
            $value = $Matches[1]
        } else { $value = ($value -replace '\s+#.*$', '').Trim() }
        $values[$key] = $value
    }
    return $values
}

function Assert-LocalEnvironment([hashtable]$Values) {
    foreach ($key in @('JWT_SECRET', 'MONGO_ROOT_USER', 'MONGO_ROOT_PASSWORD', 'MONGO_APP_PASSWORD', 'REDIS_PASSWORD')) {
        if (-not $Values.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($Values[$key])) { throw "Missing or empty $key in infrastructure/.env." }
        if ($Values[$key] -match '(?i)replace[_-]?with|change[_-]?me|your[_-].*|<[^>]+>|\$\{') { throw "Unresolved placeholder in $key; replace it locally. Values are not displayed." }
    }
    if ($Values.JWT_SECRET.Length -lt 32) { throw 'JWT_SECRET must contain at least 32 characters from a secure random generator.' }
    # Passwords are interpolated into URLs. Reject ambiguous characters instead of silently corrupting credentials.
    foreach ($key in @('MONGO_APP_PASSWORD', 'REDIS_PASSWORD')) {
        if ($Values[$key] -notmatch '^[A-Za-z0-9._~-]+$') { throw "$key must use URL-unreserved characters (generated hex secrets work); do not change credentials on an existing database without its rotation procedure." }
    }
    if ($Values.ContainsKey('MONGO_HOST_PORT')) { $null = ConvertTo-HostPort $Values.MONGO_HOST_PORT }
}

function ConvertTo-HostPort([string]$Value) {
    $port = 0
    if ($Value -notmatch '^\d{1,5}$' -or -not [int]::TryParse($Value, [ref]$port) -or $port -lt 1024 -or $port -gt 65535) {
        throw 'MONGO_HOST_PORT must be an integer from 1024 through 65535.'
    }
    return $port
}

function Test-LoopbackPort([int]$Port) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    try {
        $listener.Server.ExclusiveAddressUse = $true
        $listener.Start()
        return $true
    } catch [Net.Sockets.SocketException] {
        # AccessDenied includes Windows excluded/reserved ranges, not just occupied ports.
        return $false
    } finally { $listener.Stop() }
}

function Select-MongoPort([int]$Preferred, [scriptblock]$Probe = { param($Port) Test-LoopbackPort $Port }, [int]$RunningPort = 0) {
    if ($RunningPort) { return (ConvertTo-HostPort ([string]$RunningPort)) }
    $null = ConvertTo-HostPort ([string]$Preferred)
    # Two bounded ranges allow fallback when Windows reserves the whole preferred range.
    $candidates = @($Preferred..([Math]::Min(65535, $Preferred + 31))) + @(37017..37048)
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (& $Probe $candidate) { return $candidate }
    }
    throw 'No usable MongoDB loopback port among at most 64 candidates. Inspect excluded ranges with netsh interface ipv4 show excludedportrange protocol=tcp; choose MONGO_HOST_PORT outside those ranges. No services were stopped.'
}

function Save-MongoPort([string]$Path, [int]$Port) {
    $null = ConvertTo-HostPort ([string]$Port)
    Save-LocalEnvironmentSetting $Path 'MONGO_HOST_PORT' ([string]$Port)
}

function Save-LocalEnvironmentSetting([string]$Path, [string]$Key, [string]$Value) {
    if ($Key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$' -or $Value -match '[\r\n]') { throw 'Invalid single-line environment setting.' }
    $null = Read-LocalEnvironment $Path # Reject duplicate/malformed entries before writing anything.
    $original = [IO.File]::ReadAllText($Path)
    $newline = if ($original.Contains("`r`n")) { "`r`n" } else { "`n" }
    if ($original -match "(?m)^\s*$Key\s*=") {
        # MatchEvaluator keeps literal dollar signs in values from becoming regex substitutions.
        $updated = [regex]::Replace($original, "(?m)^[ \t]*$Key[ \t]*=[^\r\n]*", [Text.RegularExpressions.MatchEvaluator]{ param($match) "${Key}=$Value" })
    } else {
        $updated = $original + $(if ($original -and -not $original.EndsWith("`n")) { $newline }) + "${Key}=$Value$newline"
    }
    if ($updated -eq $original) { return }
    $temp = "$Path.codecollab-$([guid]::NewGuid().ToString('N')).tmp"
    try {
        [IO.File]::WriteAllText($temp, $updated, [Text.UTF8Encoding]::new($false))
        if ([IO.File]::ReadAllText($Path) -cne $original) { throw 'Environment file changed during setting update; retry without overwriting concurrent edits.' }
        # Atomic replacement on the same volume, preserving destination metadata/ACLs.
        [IO.File]::Replace($temp, $Path, [NullString]::Value)
    } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force } }
}

function Repair-LocalJwtSecret([string]$Path) {
    $values = Read-LocalEnvironment $Path
    if ($values.JWT_SECRET -and $values.JWT_SECRET.Length -ge 32 -and $values.JWT_SECRET -notmatch '(?i)replace[_-]?with|change[_-]?me|your[_-].*|<[^>]+>|\$\{') { return $false }
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $values.JWT_SECRET = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
    Assert-LocalEnvironment $values # Refuse to write when other settings need attention.
    Save-LocalEnvironmentSetting $Path 'JWT_SECRET' $values.JWT_SECRET
    return $true
}

function Protect-DiagnosticText([string]$Text, [hashtable]$Values = @{}) {
    foreach ($key in $Values.Keys) {
        if ($key -match 'PASSWORD|SECRET|TOKEN|URI|URL' -and $Values[$key]) {
            $Text = $Text.Replace([string]$Values[$key], '[REDACTED]')
            $Text = $Text.Replace([Uri]::EscapeDataString([string]$Values[$key]), '[REDACTED]')
        }
    }
    $Text = $Text -replace '(?i)([a-z][a-z0-9+.-]*://)[^\s/@]+@', '$1[REDACTED]@'
    $Text = $Text -replace '(?i)(Bearer\s+|(?:password|secret|token)\s*[=:]\s*)[^\s,;]+', '$1[REDACTED]'
    $Text = $Text -replace 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[REDACTED JWT]'
    $bounded = (($Text -split '\r?\n' | Select-Object -Last 20) -join "`n")
    if ($bounded.Length -gt 5000) { $bounded = $bounded.Substring($bounded.Length - 5000) }
    return $bounded
}

function ConvertTo-NativeArgument([string]$Argument) {
    # Windows PowerShell 5.1 otherwise strips embedded quotes from Go templates and node -e.
    $escaped = [regex]::Replace($Argument, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

function Invoke-DockerCommand([string[]]$Arguments, [hashtable]$Secrets = @{}, [switch]$AllowFailure, [int]$TimeoutSeconds = 120, [switch]$IncludeStderr) {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = (Get-Command docker -ErrorAction Stop).Source
    $info.Arguments = ($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' '
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    try {
        $null = $process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            # Kill only the CLI child created by this invocation, never a daemon/container.
            $process.Kill()
            throw "Docker CLI exceeded $TimeoutSeconds seconds; operation may still be active in the engine. Inspect diagnostics before retrying."
        }
        $code = $process.ExitCode
        $output = $stdout.Result
        if ($code -ne 0 -or $IncludeStderr) { $output += "`n" + $stderr.Result }
    } finally { $process.Dispose() }
    if ($code -ne 0 -and -not $AllowFailure) {
        throw "Docker command failed (exit $code). $(Protect-DiagnosticText $output $Secrets)"
    }
    return [pscustomobject]@{ ExitCode = $code; Output = $output.Trim() }
}

function Get-ComposeArguments([string]$Root) {
    return @('compose', '--env-file', (Join-Path $Root 'infrastructure/.env'), '-f', (Join-Path $Root 'infrastructure/docker-compose.yml'), '--profile', 'local-dev-execution')
}

function Enter-ComposeEnvironment([hashtable]$Values) {
    # Compose shell variables override --env-file. Clear only Compose inputs and restore afterwards.
    $saved = @{}
    foreach ($key in @('MONGO_URI', 'MONGO_HOST_PORT', 'MONGO_ROOT_USER', 'MONGO_ROOT_PASSWORD', 'MONGO_APP_USER', 'MONGO_APP_PASSWORD', 'REDIS_PASSWORD', 'JWT_SECRET', 'CLIENT_URL', 'FRONTEND_BIND_ADDRESS', 'CONTAINER_RUNTIME')) {
        $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        # PowerShell 7/.NET preserves an empty string as an environment override.
        # Pass a real null, otherwise Compose ignores the env-file value.
        [Environment]::SetEnvironmentVariable($key, [NullString]::Value, 'Process')
    }
    # Port is deliberately pinned to the parsed local value, not a stale parent-shell value.
    [Environment]::SetEnvironmentVariable('MONGO_HOST_PORT', $(if ($Values.ContainsKey('MONGO_HOST_PORT')) { $Values.MONGO_HOST_PORT } else { '27017' }), 'Process')
    return $saved
}

function Exit-ComposeEnvironment([hashtable]$Saved) {
    foreach ($key in $Saved.Keys) {
        $value = if ($null -eq $Saved[$key]) { [NullString]::Value } else { $Saved[$key] }
        [Environment]::SetEnvironmentVariable($key, $value, 'Process')
    }
}

function Assert-DockerReady {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI missing; install Docker Desktop and use Linux containers.' }
    $null = Invoke-DockerCommand @('compose', 'version')
    $info = Invoke-DockerCommand @('info', '--format', '{{.OSType}}') -AllowFailure
    if ($info.ExitCode -ne 0) { throw 'Docker Engine is unreachable. Start Docker Desktop, wait for Engine running, and check docker context show. Do not restart a shared running daemon.' }
    if ($info.Output -ne 'linux') { throw 'Docker is using the wrong engine. Select Linux containers in Docker Desktop.' }
}

function Get-RunningMongoPort([string[]]$Compose, [hashtable]$Secrets = @{}) {
    $id = (Invoke-DockerCommand ($Compose + @('ps', '-q', 'mongo')) $Secrets).Output
    if (-not $id) { return 0 }
    $state = ((Invoke-DockerCommand @('inspect', '--format', '{{json .NetworkSettings.Ports}}', $id) $Secrets).Output | ConvertFrom-Json)
    $bindings = @($state.'27017/tcp')
    if ($bindings.Count -ne 1 -or $bindings[0].HostIp -ne '127.0.0.1') { throw 'Running project MongoDB has an unexpected port binding. Inspect it manually; startup will not recreate it or expose it publicly.' }
    return (ConvertTo-HostPort $bindings[0].HostPort)
}

function Repair-StoppedMongoMapping([string[]]$Compose, [int]$Port, [hashtable]$Secrets = @{}) {
    $id = (Invoke-DockerCommand ($Compose + @('ps', '--all', '-q', 'mongo')) $Secrets).Output
    if (-not $id) { return }
    $state = (Invoke-DockerCommand @('inspect', '--format', '{{.State.Status}}', $id) $Secrets).Output
    if ($state -eq 'running') { return }
    $bindings = (Invoke-DockerCommand @('inspect', '--format', '{{json .HostConfig.PortBindings}}', $id) $Secrets).Output | ConvertFrom-Json
    $mapping = @($bindings.'27017/tcp')
    if ($mapping.Count -eq 1 -and $mapping[0].HostIp -eq '127.0.0.1' -and $mapping[0].HostPort -eq [string]$Port) { return }
    if ($state -notin @('created', 'exited')) { throw "MongoDB is $state with an obsolete port mapping; inspect manually before changing it." }
    # A failed bind can leave a CREATED container. --no-recreate would retain its bad port forever.
    # Check again immediately before replacing only this inactive container; never remove its volume.
    $state = (Invoke-DockerCommand @('inspect', '--format', '{{.State.Status}}', $id) $Secrets).Output
    if ($state -notin @('created', 'exited')) { throw 'MongoDB state changed during startup; retry instead of interrupting it.' }
    Write-Host 'Recreating only the inactive MongoDB container to apply the selected port; preserving its data volume.'
    $null = Invoke-DockerCommand ($Compose + @('up', '-d', '--no-deps', '--no-build', '--force-recreate', 'mongo')) $Secrets
}

function ConvertTo-CanonicalConfig($Value, [bool]$OmitDefaults = $true) {
    # Newer Docker APIs omit legacy empty/false defaults that older APIs serialize.
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [string] -or $Value -is [ValueType]) { return (ConvertTo-Json -InputObject $Value -Compress) }
    if ($Value -is [array]) {
        return '[' + (($Value | ForEach-Object { ConvertTo-CanonicalConfig $_ $false }) -join ',') + ']'
    }
    $entries = @()
    foreach ($property in ($Value.PSObject.Properties | Sort-Object Name)) {
        $item = $property.Value
        if ($OmitDefaults -and ($null -eq $item -or ($item -is [bool] -and -not $item) -or
            ($item -is [string] -and $item.Length -eq 0) -or ($item -is [array] -and $item.Count -eq 0))) { continue }
        $content = ConvertTo-CanonicalConfig $item $false
        $entries += ((ConvertTo-Json $property.Name -Compress) + ':' + $content)
    }
    return '{' + ($entries -join ',') + '}'
}

function Get-RunnerFingerprint([string]$Image, [string[]]$DockerPrefix = @(), [hashtable]$Secrets = @{}) {
    # Desktop's containerd store reports a manifest/index ID; classic DinD reports a config ID.
    # Compare filesystem layer digests and the entire runtime configuration on the selected platform.
    $raw = (Invoke-DockerCommand ($DockerPrefix + @('image', 'inspect', '--format', '{{json .}}', $Image)) $Secrets).Output | ConvertFrom-Json
    $content = (ConvertTo-CanonicalConfig $raw.RootFS.Layers) + '|' + $raw.Os + '|' + $raw.Architecture + '|' + (ConvertTo-CanonicalConfig $raw.Config)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($content))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

Export-ModuleMember -Function *
