[CmdletBinding()]
param(
    [string]$ServerHost = "193.123.187.241",
    [string]$ServerUser = "ubuntu",
    [string]$KeyPath = "$PSScriptRoot/../../ssh-key-2025-11-14.key",
    [string]$RemoteDir = "/home/ubuntu/faizan-e-madina-backend",
    [switch]$SkipBuild,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "🕌 FMMS Strapi Backend Deployment Pipeline" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$BackendDir = Resolve-Path "$PSScriptRoot/.."
Set-Location $BackendDir

# 1. Branch check
$CurrentBranch = git symbolic-ref --short HEAD
Write-Host "[1/6] Current branch: $CurrentBranch" -ForegroundColor Yellow
if ($CurrentBranch -ne "main") {
    Write-Warning "Deploying from non-main branch: $CurrentBranch. Production is normally deployed from main."
}

# 2. Quality check
Write-Host "[2/6] Running TypeScript checks..." -ForegroundColor Yellow
npm run typecheck

# 3. Local build
if (-not $SkipBuild) {
    Write-Host "[3/6] Building Strapi locally (prevents VPS OOM crashes)..." -ForegroundColor Yellow
    npm run build
} else {
    Write-Host "[3/6] Skipping local build (-SkipBuild specified)" -ForegroundColor Gray
}

# 4. Git sync
Write-Host "[4/6] Verifying git state and pushing changes..." -ForegroundColor Yellow
$GitStatus = git status --porcelain dist/
if ($GitStatus) {
    Write-Host "Staging compiled dist artifacts..." -ForegroundColor Gray
    git add dist/
    git commit -m "chore(release): compile production artifacts [FMMS]"
    git push origin $CurrentBranch
} else {
    Write-Host "No changes in dist/, proceeding." -ForegroundColor Green
}

if ($DryRun) {
    Write-Host "Dry run enabled. Skipping remote SSH execution." -ForegroundColor Yellow
    return
}

# 5. Remote SSH execution
Write-Host "[5/6] Connecting to $ServerUser@$ServerHost via SSH..." -ForegroundColor Yellow
$ResolvedKey = Resolve-Path $KeyPath
$RemoteCmd = "cd $RemoteDir && git pull origin main && npm install --omit=dev && pm2 reload ecosystem.config.js --update-env && pm2 status"

ssh -i "$ResolvedKey" -o StrictHostKeyChecking=no "$ServerUser@$ServerHost" "$RemoteCmd"

# 6. HTTP Health verification
Write-Host "[6/6] Verifying live HTTP health endpoint..." -ForegroundColor Yellow
Start-Sleep -Seconds 5
$HealthUrl = "https://portal.faizanemadinasouthend.co.uk/_health"
try {
    $Response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 15
    if ($Response.StatusCode -in 200, 204) {
        Write-Host "✅ Deployment Succeeded! Strapi is healthy at $HealthUrl (Status: $($Response.StatusCode))" -ForegroundColor Green
    } else {
        Write-Warning "Health check returned status: $($Response.StatusCode)"
    }
} catch {
    Write-Error "❌ Health check failed after deployment: $_"
}
