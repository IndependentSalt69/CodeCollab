[CmdletBinding()]
param([switch]$ExecutionSmoke)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'scripts/DevTools.psm1') -Force
$script:failures = 0
$values = @{}
$saved = $null
$compose = Get-ComposeArguments $PSScriptRoot
function Report([string]$Status, [string]$Name, [string]$Reason, [string]$Next = '') {
    if ($Status -in @('FAIL', 'BLOCKED')) { $script:failures++ }
    Write-Host "$Status [$Name] $Reason $(if ($Next) { "Next: $Next" })"
}
function Check([string]$Name, [scriptblock]$Action, [string]$Next) {
    try { & $Action; Report PASS $Name 'Check completed.' }
    catch { Report FAIL $Name (Protect-DiagnosticText $_.Exception.Message $values) $Next }
}
function Stack([string[]]$Arguments) { Invoke-DockerCommand ($compose + $Arguments) $values }
try {
    $configured = $false
    try {
        $values = Read-LocalEnvironment (Join-Path $PSScriptRoot 'infrastructure/.env')
        $configured = $true # Parse success allows independent read-only checks even when a setting is weak.
        Assert-LocalEnvironment $values
        Report PASS Configuration 'Required settings are present; values hidden.'
    } catch { Report FAIL Configuration $_.Exception.Message '.\setup.ps1; correct the named key only, preserving existing credentials.' }
    $dockerReady = $false
    try { Assert-DockerReady; $dockerReady = $true; Report PASS Docker 'Linux Engine and Compose reachable.' }
    catch { Report BLOCKED Docker $_.Exception.Message 'Start Docker Desktop and wait for Linux Engine running.' }
    if (-not $configured) { Report 'NOT RUN' Compose 'Valid local configuration is required.'; exit 1 }
    $saved = Enter-ComposeEnvironment $values
    $composeValid = $false
    try { $null = Stack @('config', '--quiet'); $composeValid = $true; Report PASS Compose 'Interpolation valid; resolved secrets were not printed.' }
    catch { Report FAIL Compose (Protect-DiagnosticText $_.Exception.Message $values) 'Check the indicated YAML/key; do not paste resolved config.' }
    if (-not $dockerReady -or -not $composeValid) {
        foreach ($name in @('mongo', 'redis', 'backend', 'frontend', 'execution-daemon', 'execution-worker', 'Runner images', 'Resources', 'Functional dependencies')) {
            Report 'NOT RUN' $name 'Requires reachable Linux Docker Engine and valid Compose configuration.'
        }
    } else {
        Check 'MongoDB host port' {
            $runningPort = Get-RunningMongoPort $compose $values
            if ($runningPort) {
                if ($runningPort -ne [int]$env:MONGO_HOST_PORT) { Report WARN 'Port drift' "Running MongoDB uses loopback port $runningPort. start.ps1 will retain it." }
            } elseif (-not (Test-LoopbackPort ([int]$env:MONGO_HOST_PORT))) {
                throw 'Preferred loopback port cannot bind (occupied or Windows reserved/excluded).'
            }
        } 'Run start.ps1 for bounded fallback. Read exclusions: netsh interface ipv4 show excludedportrange protocol=tcp. Never kill unrelated processes.'
        $ids = @{}
        foreach ($service in @('mongo', 'redis', 'backend', 'frontend', 'execution-daemon', 'execution-worker')) {
            try {
                $id = (Stack @('ps', '--all', '-q', $service)).Output
                if (-not $id) { throw 'Service is missing.' }
                $ids[$service] = $id
                $state = (Invoke-DockerCommand @('inspect', '--format', '{{json .State}}', $id) $values).Output | ConvertFrom-Json
                $health = if ($state.PSObject.Properties.Name -contains 'Health') { $state.Health.Status } else { 'no health check' }
                if ($state.Status -ne 'running' -or $health -ne 'healthy') { throw "State=$($state.Status), health=$health, OOMKilled=$($state.OOMKilled)." }
                Report PASS $service "Running, health=$health (functional checks follow)."
                # Hash comparison detects config drift without printing resolved environment values.
                $expectedHash = ((Stack @('config', '--hash', $service)).Output -split '\s+')[-1]
                $labels = (Invoke-DockerCommand @('inspect', '--format', '{{json .Config.Labels}}', $id) $values).Output | ConvertFrom-Json
                $actualHash = $labels.'com.docker.compose.config-hash'
                if ($expectedHash -ne $actualHash) { Report WARN $service 'Configuration differs from the existing container.' 'Schedule a maintenance window and explicitly recreate only the affected service; start.ps1 preserves existing containers.' }
            } catch {
                Report FAIL $service (Protect-DiagnosticText $_.Exception.Message $values) '.\start.ps1 for missing services; review bounded logs below before any manual recreation.'
                $logs = Invoke-DockerCommand ($compose + @('logs', '--no-color', '--tail', '15', $service)) $values -AllowFailure -IncludeStderr
                Write-Host (Protect-DiagnosticText $logs.Output $values)
            }
        }
        Check 'Worker dependencies' { $null = Stack @('exec', '-T', 'execution-worker', 'node', 'execution/worker/healthcheck.js') } 'Run start.ps1 to transfer/inspect images; inspect worker Redis and daemon connectivity. Old worker images need explicit maintenance recreation.'
        foreach ($language in @('python', 'cpp', 'java')) {
            Check "$language image" {
                $image = "codecollab-runner-${language}:latest"
                $inner = Get-RunnerFingerprint $image ($compose + @('exec', '-T', 'execution-daemon', 'docker', '-H', 'tcp://127.0.0.1:2375')) $values
                $hostImage = Get-RunnerFingerprint $image -Secrets $values
                if ($hostImage -ne $inner) { throw 'Host and isolated-daemon image filesystem/configuration differ.' }
            } 'Run start.ps1. Build errors: check registry/HTTPS repository access; transfer errors: check disk and daemon capacity. Keep TLS and signatures enabled.'
        }
        Check 'MongoDB connection' {
            # Ping using the backend credentials without displaying them or writing any records.
            $probe = 'const m=require("mongoose");setTimeout(()=>process.exit(1),6000).unref();(async()=>{try{await m.connect(process.env.MONGO_URI,{serverSelectionTimeoutMS:3000});await m.connection.db.admin().ping();}catch(e){console.error("MongoDB authenticated ping failed; connection details hidden");process.exitCode=1;}finally{await m.disconnect();}})();'
            $null = Stack @('exec', '-T', 'backend', 'node', '-e', $probe)
        } 'Check the intended database. For Atlas, verify cluster availability and allow only the current client public IP in Network Access. Do not switch databases or rotate passwords to hide a connectivity failure.'
        Check 'Redis connection' {
            $probe = 'const R=require("ioredis");const r=new R(process.env.REDIS_URL,{connectTimeout:3000,commandTimeout:3000,maxRetriesPerRequest:0,retryStrategy:()=>null});r.on("error",()=>{});(async()=>{try{if(await r.ping()!=="PONG")throw Error();}catch{console.error("Redis authenticated ping failed; connection details hidden");process.exitCode=1;}finally{r.disconnect();}})();'
            $null = Stack @('exec', '-T', 'backend', 'node', '-e', $probe)
        } 'Check Redis health and the existing password configuration; preserve its data volume.'
        Check Resources {
            if (-not $ids.ContainsKey('execution-daemon')) { throw 'Execution daemon missing.' }
            $stats = Invoke-DockerCommand @('stats', '--no-stream', '--format', 'PIDs={{.PIDs}} Memory={{.MemUsage}} CPU={{.CPUPerc}}', $ids['execution-daemon']) $values
            Write-Host $stats.Output
            $probe = 'for f in pids.current pids.max pids.events memory.current memory.max memory.events; do if [ -r /sys/fs/cgroup/$f ]; then printf "%s=" "$f"; tr "\n" " " < /sys/fs/cgroup/$f; echo; fi; done; ps -eo stat,comm | sort | uniq -c'
            $resources = Stack @('exec', '-T', 'execution-daemon', 'sh', '-c', $probe)
            Write-Host (Protect-DiagnosticText $resources.Output $values)
            if ($resources.Output -match '(?m)^\s*\d+\s+Z\s+') { Report WARN 'Zombie helpers' 'Defunct processes are present in the execution daemon.' 'Inspect init/reaping and remaining runner containers. Apply init: true only during an operator-approved daemon maintenance window; do not kill unrelated processes or raise PID limits.' }
            if ($resources.Output -match 'memory.events=.*max ([1-9][0-9]*)') { Report WARN 'Memory pressure' 'The memory controller has recorded limit hits; this alone does not prove an OOM kill.' 'Check oom/oom_kill counters and workload/logs. Pause further stress tests before considering an operator-managed recovery.' }
            if ($stats.Output -match 'PIDs=(\d+)' -and [int]$Matches[1] -ge 100) { Report WARN Resources 'Approaching the configured 128-PID outer limit; helpers/threads count too.' 'Stop submitting tests, record pids.events, process states and remaining inner containers; do not raise limits. Only an operator may drain/restart during maintenance.' }
        } 'If exec itself fails with resource unavailable, collect docker stats/logs from outside. Distinguish zombie/helper accumulation from a proven runner leak before recovery.'
    }
    $bind = if ($values.ContainsKey('FRONTEND_BIND_ADDRESS')) { $values.FRONTEND_BIND_ADDRESS } else { '127.0.0.1' }
    foreach ($endpoint in @('http://127.0.0.1:5000/health', 'http://127.0.0.1:5000/ready', "http://${bind}:3000/", "http://${bind}:3000/health", "http://${bind}:3000/socket.io/?EIO=4&transport=polling")) {
        Check "HTTP $endpoint" {
            $response = Invoke-WebRequest -Uri $endpoint -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -ne 200) { throw 'Unexpected HTTP status.' }
            if ($endpoint -like '*/health' -and ($response.Content | ConvertFrom-Json).status -ne 'ok') { throw 'Health response is not backend JSON.' }
            if ($endpoint -like '*/ready' -and ($response.Content | ConvertFrom-Json).status -ne 'ready') { throw 'Backend dependencies are not ready.' }
            if ($endpoint -like '*socket.io*' -and $response.Content -notmatch '^0\{') { throw 'Socket.IO handshake missing; inspect frontend proxy configuration.' }
        } 'Check frontend/backend logs and proxy. HTTP health alone does not prove authentication, rooms or execution.'
    }
    if ($ExecutionSmoke -and $dockerReady -and $composeValid) {
        Check 'Live execution smoke' { $result = Stack @('exec', '-T', 'execution-worker', 'node', 'execution/worker/smoke.js'); Write-Host $result.Output } 'Inspect PID/memory events and runner images. This smoke checks worker-engine execution, not the authenticated API/room path.'
    } else { Report 'NOT RUN' 'Live execution smoke' 'Opt in with .\verify.ps1 -ExecutionSmoke (creates/removes three disposable runner containers).' }
    Report WARN LAN "Frontend bind address: $bind. API/realtime default to this same browser origin." 'For trusted Wi-Fi tests set explicit LAN bind and CLIENT_URL origins; see README. Check Windows private-network firewall rules manually; this script changes none.'
    if (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue) {
        Check 'LAN address selection' {
            $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.AddressState -eq 'Preferred' } | Select-Object -ExpandProperty IPAddress)
            if ($bind -notin @('127.0.0.1', '0.0.0.0') -and $bind -notin $addresses) { throw 'Configured frontend bind address is not assigned to an active local adapter.' }
            if ($bind -ne '127.0.0.1' -and $values.CLIENT_URL -notlike "*http://${bind}:3000*") { throw 'CLIENT_URL does not include the selected frontend LAN origin.' }
        } 'Select the active Wi-Fi IPv4 address, add its exact browser origin, then explicitly recreate frontend/backend during maintenance.'
    } else { Report 'NOT RUN' 'LAN address selection' 'Windows network cmdlets unavailable.' }
    if (Get-Command Get-NetFirewallProfile -ErrorAction SilentlyContinue) {
        try {
            $profile = Get-NetFirewallProfile -Name Private -ErrorAction Stop
            Report WARN 'Windows Firewall' "Private profile enabled=$($profile.Enabled); rules were not changed and device reachability is unproven." 'If LAN access fails, inspect active network profile and allow TCP 3000 only for the trusted local subnet; never expose daemon/database ports.'
        } catch { Report 'NOT RUN' 'Windows Firewall' 'Unable to read profile; inspect Windows Security manually.' }
    } else { Report 'NOT RUN' 'Windows Firewall' 'Windows firewall cmdlets unavailable.' }
    Report 'NOT RUN' 'Second device' 'A real second device must validate login, room join, editor sync and execution results.'
    Report 'NOT RUN' 'Production qualification' 'NOT_QUALIFIED_FOR_PRODUCTION. Native Linux qualification is DEFERRED - NOT REQUIRED FOR LAPTOP DEMO. Existing production gates remain enforced.'
} finally { if ($null -ne $saved) { Exit-ComposeEnvironment $saved } }
if ($script:failures) { exit 1 }
exit 0
