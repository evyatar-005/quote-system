# Verifies the real Stop-Server from deploy/UPDATE.ps1 kills a process squatting
# on :3000. The function is lifted out of the shipped script via the PowerShell
# parser rather than copy-pasted, so this exercises the code that actually runs
# on the server — a copy would drift and quietly stop testing anything.
#
# The script path is a parameter: Windows PowerShell 5.1 reads .ps1 files as
# ANSI, so a Hebrew path embedded in the source would be mangled before it ever
# reached the filesystem.
param([Parameter(Mandatory=$true)][string]$ScriptPath)

$ErrorActionPreference = "Stop"

$ast = [System.Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$null, [ref]$null)
$fn = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Stop-Server' }, $true)
if (-not $fn) { Write-Host "FAIL: Stop-Server not found in UPDATE.ps1" -ForegroundColor Red; exit 1 }
Invoke-Expression $fn[0].Extent.Text
# Stop-Server references $taskName; no such task exists on this machine and
# Stop-ScheduledTask runs with -ErrorAction SilentlyContinue, so what gets
# exercised here is the port-clearing half — the half that failed in production.
$taskName = "QuoteSystemServer"

$script:failures = 0
function Check($label, $cond) {
    if ($cond) { Write-Host "  PASS  $label" -ForegroundColor Green }
    else { Write-Host "  FAIL  $label" -ForegroundColor Red; $script:failures++ }
}

# A file rather than `node -e "..."`: quoting an inline script through
# Start-Process -ArgumentList is fragile enough that a failure to launch reads
# as a failed assertion, which is the worst way for a test to lie.
$zombieFile = Join-Path $env:TEMP "zombie-server.js"
Set-Content -Path $zombieFile -Value 'require("http").createServer((q,s)=>s.end("zombie")).listen(3000);' -Encoding ascii
function Start-Zombie {
    $p = Start-Process -FilePath "node" -ArgumentList $zombieFile -PassThru -WindowStyle Hidden
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Milliseconds 400
        if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { return $p }
    }
    return $p
}

Write-Host "`n=== 0. clear the port so the tests start from a known state ===" -ForegroundColor Cyan
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
Check "port 3000 is free before testing" ($null -eq (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue))

Write-Host "`n=== 1. no zombie: reports success, changes nothing ===" -ForegroundColor Cyan
Check "returns True when the port is already free" ((Stop-Server) -eq $true)

Write-Host "`n=== 2. zombie holding :3000 gets killed ===" -ForegroundColor Cyan
$zombie = Start-Zombie
$held = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
Check "zombie is listening on :3000 before the test (pid $($zombie.Id))" ($null -ne $held)
if (-not $held) { Write-Host "  (zombie failed to start - aborting)" -ForegroundColor Red; exit 1 }

Check "returns True after clearing the port" ((Stop-Server) -eq $true)
Start-Sleep -Seconds 1
Check "zombie process is dead" ($null -eq (Get-Process -Id $zombie.Id -ErrorAction SilentlyContinue))
Check "port 3000 is free afterwards" ($null -eq (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue))

Write-Host "`n=== 3. un-killable holder is reported, not ignored ===" -ForegroundColor Cyan
# Stubbing Stop-Process so the holder survives. The real causes (permissions, a
# process wedged in I/O) can't be staged reliably, but the branch under test is
# the same one: "port still held after we tried".
$zombie2 = Start-Zombie
Check "second zombie is listening (pid $($zombie2.Id))" ($null -ne (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue))
function Stop-Process { param($Id, [switch]$Force, $ErrorAction) }
$result3 = Stop-Server
Remove-Item Function:\Stop-Process -ErrorAction SilentlyContinue
Check "returns False when the port cannot be freed" ($result3 -eq $false)

Stop-Process -Id $zombie2.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Check "cleanup: port free at end of test" ($null -eq (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue))

Write-Host ""
if ($script:failures -eq 0) { Write-Host "ALL CHECKS PASSED" -ForegroundColor Green; exit 0 }
Write-Host "$($script:failures) CHECK(S) FAILED" -ForegroundColor Red
exit 1
