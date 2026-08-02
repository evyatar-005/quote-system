# Proves the `git reset --hard` + `git clean -fd` pair used by the deploy
# removes what blocks a checkout while leaving production data alone.
#
# Runs in a throwaway repo under $env:TEMP, never against a real checkout —
# a test for "does this delete the database" must not be able to delete the
# database. The .gitignore is copied from the real repo so the thing under test
# is the actual ignore policy, not an idealised copy of it.
param([Parameter(Mandatory=$true)][string]$RealGitignore)

$ErrorActionPreference = "Stop"

# One of the assertions below deliberately runs a git command that must fail.
# In PowerShell 5.1 a native command's stderr becomes an ErrorRecord, which
# under ErrorActionPreference=Stop aborts the script — so the expected failure
# would look like a broken test instead of a passing one.
function Git-ExitCode {
    param([string[]]$GitArgs)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & git @GitArgs 2>$null | Out-Null
        return $LASTEXITCODE
    } finally { $ErrorActionPreference = $prev }
}

$script:failures = 0
function Check($label, $cond) {
    if ($cond) { Write-Host "  PASS  $label" -ForegroundColor Green }
    else { Write-Host "  FAIL  $label" -ForegroundColor Red; $script:failures++ }
}

$sandbox = Join-Path $env:TEMP ("clean-safety-" + [guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory -Force -Path $sandbox | Out-Null
Push-Location $sandbox
try {
    Git-ExitCode @("init","-q",".") | Out-Null
    Git-ExitCode @("config","user.email","test@example.com") | Out-Null
    Git-ExitCode @("config","user.name","test") | Out-Null
    Copy-Item $RealGitignore (Join-Path $sandbox ".gitignore")

    # v1 of the release: a tracked file that a later tag will also contain.
    New-Item -ItemType Directory -Force -Path "deploy" | Out-Null
    Set-Content "deploy\somescript.ps1" "v1" -Encoding ascii
    Git-ExitCode @("add","-A") | Out-Null
    Git-ExitCode @("commit","-q","-m","v1") | Out-Null
    Git-ExitCode @("tag","v1") | Out-Null

    # v2 additionally ships deploy/newfile.ps1 — the shape that broke v1.0.19,
    # where the server already had an untracked copy of that same path.
    Set-Content "deploy\newfile.ps1" "from tag" -Encoding ascii
    Git-ExitCode @("add","-A") | Out-Null
    Git-ExitCode @("commit","-q","-m","v2") | Out-Null
    Git-ExitCode @("tag","v2") | Out-Null
    Git-ExitCode @("checkout","-q","v1") | Out-Null

    # Production state on the server: real data (all ignored), a modified
    # tracked file (npm rewriting package-lock.json), and the untracked
    # collision.
    Set-Content "database.sqlite" "PRODUCTION DATA" -Encoding ascii
    Set-Content "VERSION.txt" "deploy info" -Encoding ascii
    New-Item -ItemType Directory -Force -Path "uploads\quote-attachments" | Out-Null
    Set-Content "uploads\quote-attachments\invoice.pdf" "customer file" -Encoding ascii
    New-Item -ItemType Directory -Force -Path "backups" | Out-Null
    Set-Content "backups\database-old.sqlite" "backup" -Encoding ascii
    Set-Content "deploy\somescript.ps1" "locally modified" -Encoding ascii
    Set-Content "deploy\newfile.ps1" "copied in by hand" -Encoding ascii

    Write-Host "`n=== checkout must fail without the cleanup (the v1.0.19 failure) ===" -ForegroundColor Cyan
    Git-ExitCode @("reset","--hard","-q") | Out-Null
    Check "checkout is blocked by the untracked collision" ((Git-ExitCode @("checkout","v2")) -ne 0)

    Write-Host "`n=== with reset --hard + clean -fd ===" -ForegroundColor Cyan
    Git-ExitCode @("reset","--hard","-q") | Out-Null
    Git-ExitCode @("clean","-fd") | Out-Null
    Check "checkout now succeeds" ((Git-ExitCode @("checkout","v2")) -eq 0)
    Check "tagged file has the tag's content, not the hand-edited one" ((Get-Content "deploy\newfile.ps1" -Raw).Trim() -eq "from tag")

    Write-Host "`n=== production data must survive ===" -ForegroundColor Cyan
    Check "database.sqlite survived"        ((Test-Path "database.sqlite") -and (Get-Content "database.sqlite" -Raw).Trim() -eq "PRODUCTION DATA")
    Check "uploads/quote-attachments survived" (Test-Path "uploads\quote-attachments\invoice.pdf")
    Check "backups/ survived"               (Test-Path "backups\database-old.sqlite")
    Check "VERSION.txt survived"            (Test-Path "VERSION.txt")

    Write-Host "`n=== and -x would destroy exactly those (why it is never used) ===" -ForegroundColor Cyan
    Git-ExitCode @("clean","-fdx") | Out-Null
    Check "-x deletes database.sqlite - confirms the flag must stay out" (-not (Test-Path "database.sqlite"))
}
finally {
    Pop-Location
    Remove-Item -LiteralPath $sandbox -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
if ($script:failures -eq 0) { Write-Host "ALL CHECKS PASSED" -ForegroundColor Green; exit 0 }
Write-Host "$($script:failures) CHECK(S) FAILED" -ForegroundColor Red
exit 1
