Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Import-Module (Join-Path $root 'scripts/DevTools.psm1') -Force
$script:passed = 0
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message }; $script:passed++ }
function Reject([scriptblock]$Action, [string]$Pattern) {
    $caught = $false
    try { & $Action | Out-Null } catch { $caught = $_.Exception.Message -match $Pattern }
    Assert $caught "Expected failure matching $Pattern"
}
$dir = Join-Path ([IO.Path]::GetTempPath()) "codecollab-tests-$([guid]::NewGuid().ToString('N'))"
$null = New-Item -ItemType Directory -Path $dir
$file = Join-Path $dir '.env'
$savedPort = $env:MONGO_HOST_PORT
$savedSecret = $env:JWT_SECRET
try {
    Assert ((Select-MongoPort 27017 -Probe { $true }) -eq 27017) 'Preferred port should be retained'
    Assert ((Select-MongoPort 27017 -Probe { param($p) $p -eq 27020 }) -eq 27020) 'Occupied/reserved preferred ports must be skipped'
    Assert ((Select-MongoPort 27017 -Probe { param($p) $p -eq 37017 }) -eq 37017) 'Reserved range must fall back to second range'
    Assert ((Select-MongoPort 27017 -RunningPort 28017 -Probe { throw 'Must not probe running mapping' }) -eq 28017) 'Running mapping must be retained'
    $script:probes = 0
    Reject { Select-MongoPort 27017 -Probe { $script:probes++; $false } } 'No usable MongoDB'
    Assert ($script:probes -eq 64) 'Port search must be bounded to 64 probes'
    foreach ($bad in @('', '0', '65536', '-1', '27x', '1.2', '27017 #oops')) { Reject { ConvertTo-HostPort $bad } 'integer' }
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { Assert (-not (Test-LoopbackPort $listener.LocalEndpoint.Port)) 'Real occupied port must fail bind' } finally { $listener.Stop() }
    $fixture = "# preserve comments`r`nJWT_SECRET=" + ('a' * 64) + "`r`nMONGO_ROOT_USER=admin`r`nMONGO_ROOT_PASSWORD=root-fixture`r`nMONGO_APP_PASSWORD=app-fixture`r`nREDIS_PASSWORD=redis-fixture`r`nKEEP='unrelated value'`r`n"
    [IO.File]::WriteAllText($file, $fixture)
    Assert-LocalEnvironment (Read-LocalEnvironment $file)
    Save-MongoPort $file 37017
    Assert ([IO.File]::ReadAllText($file) -ceq ($fixture + "MONGO_HOST_PORT=37017`r`n")) 'Only port may be appended'
    Save-MongoPort $file 37018
    Assert ([IO.File]::ReadAllText($file) -ceq ($fixture + "MONGO_HOST_PORT=37018`r`n")) 'Only port may be replaced'
    $before = [IO.File]::ReadAllBytes($file)
    Save-MongoPort $file 37018
    Assert ([Convert]::ToBase64String($before) -ceq [Convert]::ToBase64String([IO.File]::ReadAllBytes($file))) 'Idempotent save must preserve bytes'
    [IO.File]::AppendAllText($file, "MONGO_HOST_PORT=37019`r`n")
    Reject { Save-MongoPort $file 27017 } 'Duplicate'
    [IO.File]::WriteAllText($file, $fixture + "MONGO_HOST_PORT:27017`r`n")
    Reject { Save-MongoPort $file 27017 } 'Malformed'
    [IO.File]::WriteAllText($file, $fixture + "MONGO_HOST_PORT='unterminated`r`n")
    Reject { Read-LocalEnvironment $file } 'Malformed quoted'
    [IO.File]::WriteAllText($file, $fixture + "MONGO_HOST_PORT=37018`r`n")
    $values = Read-LocalEnvironment $file
    $secureOriginal = [IO.File]::ReadAllText($file)
    Assert (-not (Repair-LocalJwtSecret $file)) 'Secure JWT must not be rotated'
    Assert ([IO.File]::ReadAllText($file) -ceq $secureOriginal) 'Valid JWT repair must preserve exact file'
    $weakOriginal = $secureOriginal.Replace($values.JWT_SECRET, 'weak-demo-only')
    [IO.File]::WriteAllText($file, $weakOriginal)
    Assert (Repair-LocalJwtSecret $file) 'Weak JWT must be replaced when explicitly requested'
    $repaired = Read-LocalEnvironment $file
    Assert ($repaired.JWT_SECRET -match '^[0-9a-f]{64}$') 'Replacement must contain 32 random bytes'
    Assert ([IO.File]::ReadAllText($file) -ceq $weakOriginal.Replace('weak-demo-only', $repaired.JWT_SECRET)) 'JWT repair must preserve all other settings and comments'
    [IO.File]::AppendAllText($file, "JWT_SECRET=duplicate`r`n")
    Reject { Repair-LocalJwtSecret $file } 'Duplicate'
    [IO.File]::WriteAllText($file, $secureOriginal)
    foreach ($invalid in @('', 'replace_with_secret', '${MISSING}', 'changeme')) {
        $badValues = $values.Clone(); $badValues.JWT_SECRET = $invalid
        Reject { Assert-LocalEnvironment $badValues } 'Missing|placeholder'
    }
    $redacted = Protect-DiagnosticText 'redis://:redis-fixture@redis:6379 JWT_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa Bearer abcdef' $values
    Assert ($redacted -notmatch 'redis-fixture|aaaa|abcdef') 'Diagnostics must redact known values and bearer tokens'
    $env:MONGO_HOST_PORT = '49999'; $env:JWT_SECRET = 'shell-override'
    $saved = Enter-ComposeEnvironment $values
    try {
        Assert ($env:MONGO_HOST_PORT -eq '37018') 'Local Mongo port must override stale process environment'
        Assert (-not $env:JWT_SECRET) 'Compose must use env-file secrets, not stale shell values'
        if (Get-Command docker -ErrorAction SilentlyContinue) {
            $result = Invoke-DockerCommand @('compose', '--env-file', $file, '-f', (Join-Path $root 'infrastructure/docker-compose.yml'), '--profile', 'local-dev-execution', 'config', '--format', 'json') $values
            $config = $result.Output | ConvertFrom-Json
            Assert ($config.services.mongo.ports[0].host_ip -eq '127.0.0.1') 'Mongo must bind loopback'
            Assert ($config.services.mongo.ports[0].published -eq '37018') 'Compose must use persisted port'
            Assert ($config.services.mongo.ports[0].target -eq 27017) 'Container port must stay 27017'
            Assert ($config.services.backend.environment.MONGO_URI -match '@mongo:27017/') 'Internal Mongo connection must use service hostname/port'
            Assert ($config.services.backend.environment.JWT_SECRET -eq $values.JWT_SECRET) 'Env-file must win over stale secret override'
            Assert ($config.services.backend.ports[0].host_ip -eq '127.0.0.1') 'Backend must remain private'
            Assert (-not ($config.services.'execution-daemon'.PSObject.Properties.Name -contains 'ports')) 'Daemon must have no published ports'
            Assert ($config.services.'execution-daemon'.init -eq $true) 'Daemon must reap orphaned helpers via init'
            Assert ($config.services.'execution-daemon'.pids_limit -eq 128) 'Outer PID limit must not be raised'
        } else { Write-Host 'NOT RUN Compose interpolation: Docker CLI missing' }
    } finally { Exit-ComposeEnvironment $saved }
    Assert ($env:MONGO_HOST_PORT -eq '49999' -and $env:JWT_SECRET -eq 'shell-override') 'Parent environment must be restored'
    $newConfig = '{"User":"sandbox","Env":["A=B"],"Entrypoint":["python"]}' | ConvertFrom-Json
    $oldConfig = '{"Hostname":"","User":"sandbox","Env":["A=B"],"Entrypoint":["python"],"AttachStdin":false,"Cmd":null,"Labels":null}' | ConvertFrom-Json
    Assert ((ConvertTo-CanonicalConfig $newConfig) -ceq (ConvertTo-CanonicalConfig $oldConfig)) 'Docker API omitted defaults must not cause endless transfers'
    $oldConfig.User = 'root'
    Assert ((ConvertTo-CanonicalConfig $newConfig) -cne (ConvertTo-CanonicalConfig $oldConfig)) 'Runtime configuration drift must be detected'
    Assert ((ConvertTo-CanonicalConfig (@('', 'False', $false, 0))) -ceq '["","False",false,0]') 'Literal empty/false argv elements must not be dropped during image comparison'
    foreach ($path in @('setup.ps1', 'start.ps1', 'verify.ps1', 'diagnose.ps1', 'scripts/DevTools.psm1', 'testing/infrastructure/dev_workflow.tests.ps1')) {
        $tokens = $null; $errors = $null
        $null = [Management.Automation.Language.Parser]::ParseFile((Join-Path $root $path), [ref]$tokens, [ref]$errors)
        Assert ($errors.Count -eq 0) "PowerShell syntax: $path"
    }
    Write-Host "PASS $script:passed infrastructure assertions (real loopback bind, fixture env/Compose, synthetic unavailable/reserved candidates)."
} finally {
    [Environment]::SetEnvironmentVariable('MONGO_HOST_PORT', $savedPort, 'Process')
    [Environment]::SetEnvironmentVariable('JWT_SECRET', $savedSecret, 'Process')
    # Only exact fixture files created here; no recursive cleanup of user paths.
    if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    Remove-Item -LiteralPath $dir -Force
}
