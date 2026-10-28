[CmdletBinding()]
param([switch]$ExecutionSmoke)
# Share the read-only checks so verification and recovery diagnostics cannot drift.
& (Join-Path $PSScriptRoot 'diagnose.ps1') -ExecutionSmoke:$ExecutionSmoke
exit $LASTEXITCODE
