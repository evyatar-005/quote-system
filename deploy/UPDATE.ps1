# ============================================================================
#  Quote System - production update script
#  Run this ON THE SERVER, as Administrator, from inside the git checkout
#  (e.g. C:\quote-system\deploy\UPDATE.ps1).
#
#  Usage:
#    .\UPDATE.ps1                  Update to the latest tag on origin/main
#    .\UPDATE.ps1 -Version v1.0.5  Update (or roll back) to a specific tag
#
#  What it does: backs up the local database to a location OUTSIDE the repo
#  folder (so it survives even a full delete-and-reclone of C:\quote-system),
#  stops the running server, checks out the requested git tag, reinstalls/
#  rebuilds, restarts the server, and verifies it responds. If the database
#  is missing after checkout (e.g. a fresh clone with no database.sqlite at
#  all), it's restored automatically from the last known-good external
#  backup before the server starts — a reinstall never starts from an empty
#  database as long as any prior backup exists. If the post-update check
#  fails, it automatically rolls back to the previously running tag.
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
# Deliberately a SIBLING of the repo folder, not a subfolder of it — a
# `Remove-Item -Recurse C:\quote-system` (like a clean reinstall) must not be
# able to wipe this out along with the app.
$externalBackupDir = Join-Path (Split-Path -Parent $repoRoot) "quote-system-backups"
# Same reasoning as $externalBackupDir, for the agent-uploaded quote reference
# files (uploads/quote-attachments/) — those are user content, gitignored, and
# live nowhere else, so a clean reinstall must not be able to lose them either.
$externalUploadsDir = Join-Path (Split-Path -Parent $repoRoot) "quote-system-uploads-backup"

# When the admin UI triggers this script it runs hidden, detached, with stdio
# discarded — so without a transcript a failed deploy leaves no trace anywhere
# and can only be diagnosed by re-running it by hand over RDP. Kept outside the
# repo so a checkout can't clobber it mid-run, and capped at the last 20 runs.
$logDir = Join-Path (Split-Path -Parent $repoRoot) "quote-system-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("update-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
try { Start-Transcript -Path $logFile -Force | Out-Null } catch {}
Get-ChildItem -Path $logDir -Filter "update-*.log" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip 20 |
    Remove-Item -Force -ErrorAction SilentlyContinue

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

# --- 1. Must be elevated (needed to control the scheduled task) ---
# Two ways in: an admin running it over RDP, or the app itself triggering it
# from the admin UI. In the second case the caller is the QuoteSystemServer
# task, which runs as NT AUTHORITY\SYSTEM — that token does carry
# BUILTIN\Administrators, but it's checked explicitly so this stays obviously
# correct rather than depending on a Windows detail nobody remembers.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin  = (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$isSystem = $identity.User.Value -eq "S-1-5-18"
Write-Host "Running as: $($identity.Name) (admin=$isAdmin, system=$isSystem)"
if (-not ($isAdmin -or $isSystem)) {
    Write-Host "Please run this script as Administrator." -ForegroundColor Red
    exit 1
}

# --- 2. Backup the local database before touching anything ---
# Two backups are kept: a timestamped one (history/manual recovery) inside
# the repo (existing behavior), AND a copy outside the repo entirely —
# database-latest.sqlite in $externalBackupDir — which is what step 2b uses
# to auto-restore if this turns out to be a fresh install with no database
# of its own yet.
Write-Step "Backing up database.sqlite..."
$backupDir = Join-Path $repoRoot "backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
New-Item -ItemType Directory -Force -Path $externalBackupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dbPath = Join-Path $repoRoot "database.sqlite"
$externalLatest = Join-Path $externalBackupDir "database-latest.sqlite"
if (Test-Path $dbPath) {
    Copy-Item $dbPath (Join-Path $backupDir "database-$stamp.sqlite")
    Copy-Item $dbPath (Join-Path $externalBackupDir "database-$stamp.sqlite")
    Copy-Item $dbPath $externalLatest -Force
    Write-Host "Backed up to backups\database-$stamp.sqlite and $externalBackupDir"
} else {
    Write-Host "No database.sqlite found in the repo folder yet." -ForegroundColor Yellow
}

# --- 2b. If this install has no database of its own, restore the last known-
# good one instead of letting the app start from an empty, freshly-seeded
# database. Covers a fresh git clone (e.g. after a clean reinstall) that
# never had database.sqlite at all. ---
if (-not (Test-Path $dbPath)) {
    if (Test-Path $externalLatest) {
        Write-Step "No database.sqlite here - restoring the last known-good backup..."
        Copy-Item $externalLatest $dbPath
        Write-Host "Restored database.sqlite from $externalLatest"
    } else {
        Write-Host "No prior backup found either - starting from a fresh, freshly-seeded database (first deploy ever?)." -ForegroundColor Yellow
    }
}

# --- 2c. Mirror agent-uploaded quote attachments (images/PDFs) to the same
# external, outside-the-repo location — these are user content (a photo of a
# client's wall, a spec PDF), gitignored, and exist nowhere else. Mirrored
# BEFORE checkout (so anything uploaded since the last deploy is captured),
# then restored back if this turns out to be a fresh clone with no uploads
# folder of its own yet. robocopy /MIR keeps this cheap on repeat deploys —
# only new/changed files actually get copied. ---
Write-Step "Backing up quote attachments (uploads/quote-attachments)..."
$uploadsDir = Join-Path $repoRoot "uploads\quote-attachments"
New-Item -ItemType Directory -Force -Path $externalUploadsDir | Out-Null
if (Test-Path $uploadsDir) {
    robocopy $uploadsDir $externalUploadsDir /MIR /NFL /NDL /NJH /NJS | Out-Null
    Write-Host "Mirrored uploads\quote-attachments to $externalUploadsDir"
} else {
    Write-Host "No uploads\quote-attachments folder found yet."
}
if (-not (Test-Path $uploadsDir) -and (Get-ChildItem $externalUploadsDir -ErrorAction SilentlyContinue)) {
    Write-Step "No uploads folder here - restoring attachments from the external backup..."
    New-Item -ItemType Directory -Force -Path $uploadsDir | Out-Null
    robocopy $externalUploadsDir $uploadsDir /MIR /NFL /NDL /NJH /NJS | Out-Null
    Write-Host "Restored uploads\quote-attachments from $externalUploadsDir"
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
