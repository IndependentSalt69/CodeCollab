# Execute the real startup script against a fake Docker adapter in an isolated fixture tree.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$dir = Join-Path ([IO.Path]::GetTempPath()) "codecollab-start-tests-$([guid]::NewGuid().ToString('N'))"
$null = New-Item -ItemType Directory -Path $dir
$script:passed = 0
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message }; $script:passed++ }
try {
    foreach ($folder in @('scripts', 'infrastructure', 'backend', 'frontend', 'execution/runners/python', 'execution/runners/cpp', 'execution/runners/java')) {
        $null = New-Item -ItemType Directory -Path (Join-Path $dir $folder) -Force
    }
    Copy-Item -LiteralPath (Join-Path $root 'start.ps1') -Destination (Join-Path $dir 'start.ps1')
    Copy-Item -LiteralPath (Join-Path $root 'scripts/DevTools.psm1') -Destination (Join-Path $dir 'scripts/DevTools.psm1')
    foreach ($file in @('infrastructure/docker-compose.yml', 'backend/Dockerfile', 'frontend/Dockerfile', 'execution/runners/python/Dockerfile', 'execution/runners/cpp/Dockerfile', 'execution/runners/java/Dockerfile')) {
        [IO.File]::WriteAllText((Join-Path $dir $file), '# fixture')
    }
    [IO.File]::WriteAllText((Join-Path $dir 'verify.ps1'), 'exit 0')
    $fixture = "JWT_SECRET=" + ('a' * 64) + "`nMONGO_ROOT_USER=admin`nMONGO_ROOT_PASSWORD=fixture-root`nMONGO_APP_PASSWORD=fixture-app`nREDIS_PASSWORD=fixture-redis`nMONGO_HOST_PORT=37018`n"
    [IO.File]::WriteAllText((Join-Path $dir 'infrastructure/.env'), $fixture)
    $adapter = @'
$script:loaded = $false
$script:daemonProbes = 0
function Invoke-DockerCommand([string[]]$Arguments, [hashtable]$Secrets = @{}, [switch]$AllowFailure, [int]$TimeoutSeconds = 120) {
    Add-Content -LiteralPath $env:CODECOLLAB_TEST_TRACE -Value (ConvertTo-Json -InputObject $Arguments -Compress)
    $joined = $Arguments -join ' '
    $output = ''
    if ($Arguments[0] -eq 'info') { $output = 'linux' }
    if ($Arguments -contains 'build' -and $env:CODECOLLAB_TEST_FAILURE -eq 'build') { throw 'simulated package repository failure' }
    if ($Arguments -contains 'save') {
        $archive = $Arguments[[array]::IndexOf($Arguments, '--output') + 1]
        [IO.File]::WriteAllText($archive, 'fixture archive')
    }
    if ($Arguments -contains 'cp' -and $env:CODECOLLAB_TEST_FAILURE -in @('copy', 'copy-cleanup')) { throw 'simulated partial image copy failure' }
    if ($Arguments -contains 'rm' -and $env:CODECOLLAB_TEST_FAILURE -eq 'copy-cleanup') { throw 'simulated cleanup timeout' }
    if ($Arguments -contains 'load') {
        if ($env:CODECOLLAB_TEST_FAILURE -eq 'load') { throw 'simulated image load failure' }
        $script:loaded = $true
    }
    if ($joined -like '*info --format*') { $output = if ($Arguments -contains 'exec') { '27.5.1' } else { 'linux' } }
    if ($Arguments -contains 'exec' -and $joined -like '*info --format*') {
        $script:daemonProbes++
        if ($env:CODECOLLAB_TEST_FAILURE -eq 'empty-info' -and $script:daemonProbes -eq 1) { $output = '' }
    }
    if ($Arguments -contains 'inspect') {
        if ($Arguments -contains 'exec' -and $script:loaded -and $env:CODECOLLAB_TEST_FAILURE -eq 'inspect') { throw 'simulated post-load image inspection failure' }
        $user = if (($Arguments -contains 'exec') -and -not $script:loaded) { 'old' } else { 'sandbox' }
        $output = '{"RootFS":{"Layers":["sha256:fixture"]},"Os":"linux","Architecture":"amd64","Config":{"User":"' + $user + '"}}'
        if ($Arguments -contains '{{.State.Status}}') { $output = 'created' }
        if ($Arguments -contains '{{json .HostConfig.PortBindings}}') { $output = '{"27017/tcp":[{"HostIp":"127.0.0.1","HostPort":"27017"}]}' }
    }
    if ($joined -like '*ps --all -q mongo*' -and $env:CODECOLLAB_TEST_FAILURE -eq 'stopped-port') { $output = 'fixture-stopped-mongo' }
    if ($joined -like '*ps --all --format json*') {
        $output = (@('mongo','redis','backend','frontend','execution-daemon','execution-worker') | ForEach-Object { '{"State":"running","Health":"healthy"}' }) -join "`n"
    }
    return [pscustomobject]@{ ExitCode = 0; Output = $output }
}
Export-ModuleMember -Function *
'@
    Add-Content -LiteralPath (Join-Path $dir 'scripts/DevTools.psm1') -Value $adapter
    foreach ($failure in @('build', 'copy', 'copy-cleanup', 'load', 'inspect', 'none', 'stopped-port', 'empty-info')) {
        $env:CODECOLLAB_TEST_FAILURE = $failure
        $env:CODECOLLAB_TEST_TRACE = Join-Path $dir "$failure.jsonl"
        $ErrorActionPreference = 'Continue'
        try {
            $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'start.ps1') 2>&1 | Out-String
            $exitCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = 'Stop' }
        $trace = @([IO.File]::ReadAllLines($env:CODECOLLAB_TEST_TRACE) | ForEach-Object { ,($_ | ConvertFrom-Json) })
        $calls = @($trace | ForEach-Object { $_ -join ' ' })
        $success = $failure -in @('none', 'stopped-port', 'empty-info')
        Assert (($exitCode -eq 0) -eq $success) "Unexpected exit for ${failure}: $output"
        $workerStarts = @($calls | Where-Object { $_ -like '*up*execution-worker*' })
        Assert (($workerStarts.Count -gt 0) -eq $success) "Worker started before image availability for $failure"
        if ($failure -eq 'empty-info') { Assert (@($calls | Where-Object { $_ -like '*exec*info --format*' }).Count -eq 2) 'An empty successful daemon probe must not satisfy readiness' }
        Assert ((@($calls | Where-Object { $_ -like '*--force-recreate mongo' }).Count -eq 1) -eq ($failure -eq 'stopped-port')) 'Only an inactive Mongo container with stale mapping may be recreated'
        if ($failure -eq 'build') { Assert (@($calls | Where-Object { $_ -like '* up *' }).Count -eq 0) 'Build failure must not change active stack' }
        else {
            $firstUp = [array]::FindIndex($calls, [Predicate[string]]{ param($call) $call -like '* up *' })
            $lastBuild = [array]::FindLastIndex($calls, [Predicate[string]]{ param($call) $call -match '(^| )build( |$)' })
            Assert ($lastBuild -lt $firstUp) 'All builds must precede first stack mutation'
            Assert (@($calls | Where-Object { $_ -like '*rm -f /tmp/codecollab-*' }).Count -eq 1) "Daemon archive cleanup not attempted for $failure"
            $save = @($trace | Where-Object { $_ -contains 'save' })[0]
            $archive = $save[[array]::IndexOf($save, '--output') + 1]
            Assert (-not (Test-Path -LiteralPath $archive)) "Host archive leaked after $failure"
        }
        Assert (@($calls | Where-Object { $_ -match '\b(prune|down|restart|stop)\b' }).Count -eq 0) 'Startup must not use destructive recovery'
    }
    Write-Host "PASS $script:passed startup assertions (mock Docker: build/copy/load/inspection failure and success, ordering, worker gating, archive cleanup)."
} finally {
    Remove-Item Env:CODECOLLAB_TEST_FAILURE -ErrorAction SilentlyContinue
    Remove-Item Env:CODECOLLAB_TEST_TRACE -ErrorAction SilentlyContinue
    $resolved = [IO.Path]::GetFullPath($dir)
    $allowed = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\codecollab-start-tests-'
    if (-not $resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing fixture cleanup outside test temp directory' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
