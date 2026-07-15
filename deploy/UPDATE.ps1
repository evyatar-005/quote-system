# ============================================================================
#  Quote System - production update script
#  Run this ON THE SERVER, as Administrator, from inside the git checkout
#  (e.g. C:\quote-system\deploy\UPDATE.ps1).
#
#  Usage:
#    .\UPDATE.ps1                  Update to the latest tag on origin/main
#    .\UPDATE.ps1 -Version v1.0.5  Update (or roll back) to a specific tag
#
#  What it does: backs up the local database, stops the running server,
#  checks out the requested git tag, reinstalls/rebuilds, restarts the
#  server, and verifies it responds. If the post-update check fails, it
#  automatically rolls back to the previously running tag.
# ============================================================================

param(
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$taskName   = "QuoteSystemServer"
$deployDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot   = Split-Path -Parent $deployDir
$nodePath   = "C:\Program Files\nodejs"
$env:PATH   = $env:PATH + ";$nodePath;C:\Program Files\Git\cmd"

function Write-Step($msg) {
    Write-Host ""
    Write-Host ">>> $msg" -ForegroundColor Cyan
}

function Invoke-Checked($exe, $exeArgs, $workDir) {
    Push-Location $workDir
    try {
        & $exe @exeArgs
        if ($LASTEXITCODE -ne 0) {
            throw "$exe $($exeArgs -join ' ') failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

function Install-And-Build($tag) {
    Write-Step "Installing server dependencies..."
    Invoke-Checked "npm" @("install") $repoRoot

    Write-Step "Installing and building the frontend..."
    Invoke-Checked "npm" @("install") (Join-Path $repoRoot "sign-smart-quote")
    Invoke-Checked "npm" @("run", "build") (Join-Path $repoRoot "sign-smart-quote")

    Write-Step "Writing VERSION.txt..."
    $pkgVersion = (Get-Content (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json).version
    $commit = (git -C $repoRoot rev-parse --short HEAD).Trim()
    $versionInfo = @{
        version    = $pkgVersion
        commit     = $commit
        tag        = $tag
        deployedAt = (Get-Date).ToString("o")
    } | ConvertTo-Json
    Set-Content -Path (Join-Path $repoRoot "VERSION.txt") -Value $versionInfo -Encoding utf8
}

function Ensure-Task-Configured {
    # Always re-register the auto-start task (not just "create if missing") -
    # this guarantees correct settings (SYSTEM account, run at every boot,
    # auto-restart on crash) even if it was never created or got misconfigured.
    # The server must come back up by itself after any unplanned shutdown or
    # restart, with nobody needing to log in.
    Write-Step "(Re-)configuring auto-start task..."
    $serverScript = Join-Path $repoRoot "src\server.js"
    $nodeExe = Join-Path $nodePath "node.exe"
    $action = New-ScheduledTaskAction -Execute $nodeExe -Argument "`"$serverScript`"" -WorkingDirectory $repoRoot
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
}

function Start-Server-And-Check {
    Ensure-Task-Configured
    Write-Step "Starting the server..."
    Start-ScheduledTask -TaskName $taskName

    # DB init/seeding + first request can take a while on a loaded server
    # (especially with real-time antivirus scanning), so poll for up to
    # ~60 seconds instead of checking once right away.
    for ($i = 1; $i -le 20; $i++) {
        Start-Sleep -Seconds 3
        try {
            $resp = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 5
            if ($resp.StatusCode -eq 200) { return $true }
        } catch {
            Write-Host "  ...not responding yet (attempt $i/20)"
        }
    }
    return $false
}

# --- 1. Must be run as Administrator (needed to control the scheduled task) ---
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Please run this script as Administrator." -ForegroundColor Red
    exit 1
}

# --- 2. Backup the local database before touching anything ---
Write-Step "Backing up database.sqlite..."
$backupDir = Join-Path $repoRoot "backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dbPath = Join-Path $repoRoot "database.sqlite"
if (Test-Path $dbPath) {
    Copy-Item $dbPath (Join-Path $backupDir "database-$stamp.sqlite")
    Write-Host "Backed up to backups\database-$stamp.sqlite"
} else {
    Write-Host "No database.sqlite found yet - skipping backup (first deploy?)." -ForegroundColor Yellow
}

# --- 3. Record the currently-running tag (for rollback) ---
Push-Location $repoRoot
$previousTag = $null
try { $previousTag = (git describe --tags 2>$null).Trim() } catch {}
Pop-Location

# --- 4. Fetch tags and resolve the target version ---
Write-Step "Fetching tags from origin..."
Invoke-Checked "git" @("fetch", "--tags") $repoRoot

$targetTag = $Version
if (-not $targetTag) {
    Push-Location $repoRoot
    $targetTag = (git tag --sort=-v:refname | Select-Object -First 1)
    Pop-Location
}
if (-not $targetTag) {
    Write-Host "No git tags found. Nothing to deploy." -ForegroundColor Red
    exit 1
}
Write-Host "Target version: $targetTag (previously running: $previousTag)"

# --- 5. Stop the running server ---
Write-Step "Stopping the running server..."
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

# --- 6. Checkout the target tag ---
Write-Step "Checking out $targetTag..."
Invoke-Checked "git" @("checkout", $targetTag) $repoRoot

# --- 7. Install, build, start, verify ---
$deploySucceeded = $false
try {
    Install-And-Build $targetTag
    $deploySucceeded = Start-Server-And-Check
} catch {
    Write-Host "Deployment step failed: $($_.Exception.Message)" -ForegroundColor Red
    $deploySucceeded = $false
}

if ($deploySucceeded) {
    Write-Host ""
    Write-Host "=========================================================" -ForegroundColor Green
    Write-Host " DEPLOY OK - now running $targetTag" -ForegroundColor Green
    Write-Host "=========================================================" -ForegroundColor Green
    exit 0
}

# --- 8. Automatic rollback ---
Write-Host ""
Write-Host "Post-deploy check FAILED. Rolling back..." -ForegroundColor Red

if (-not $previousTag) {
    Write-Host "No previous tag recorded - cannot auto-rollback. Manual intervention needed." -ForegroundColor Red
    exit 1
}

Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Invoke-Checked "git" @("checkout", $previousTag) $repoRoot
Install-And-Build $previousTag
$rollbackOk = Start-Server-And-Check

if ($rollbackOk) {
    Write-Host "Rolled back successfully to $previousTag." -ForegroundColor Yellow
    exit 1
} else {
    Write-Host "Rollback ALSO failed. The server may be down. Manual intervention needed." -ForegroundColor Red
    exit 1
}
