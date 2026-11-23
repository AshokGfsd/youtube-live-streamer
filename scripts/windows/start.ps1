<#
.SYNOPSIS
  StreamForge Studio - Windows PowerShell Startup Script
.DESCRIPTION
  Verifies requirements, sets up default local file-storage environment,
  starts the unified API and static dashboard, and launches the browser.
#>
[CmdletBinding()]
param(
  [int]$Port = 4000,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $PSScriptRoot
if (-not $ScriptDir -or -not (Test-Path "$ScriptDir\package.json")) {
  $ScriptDir = Resolve-Path "$PSScriptRoot\..\.."
}
Set-Location $ScriptDir

Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "                StreamForge Studio - Windows Launcher               " -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verify Node.js
try {
  $nodeVerOutput = (node -v) 2>$null
  if (-not $nodeVerOutput) { throw "Node.js not found" }
  $nodeMajor = [int]($nodeVerOutput -replace '^v([0-9]+)\..*', '$1')
  if ($nodeMajor -lt 22) {
    Write-Warning "Node.js version is $nodeVerOutput. StreamForge requires Node.js 22 or newer."
  } else {
    Write-Host "[OK] Node.js version $nodeVerOutput detected." -ForegroundColor Green
  }
} catch {
  Write-Error "Node.js is not installed or not available in PATH. Install Node.js 22+ via: winget install OpenJS.NodeJS.LTS"
  exit 1
}

# 2. Verify FFmpeg & FFprobe
$hasFfmpeg = [bool](Get-Command ffmpeg -ErrorAction SilentlyContinue)
$hasFfprobe = [bool](Get-Command ffprobe -ErrorAction SilentlyContinue)

if ($hasFfmpeg -and $hasFfprobe) {
  Write-Host "[OK] FFmpeg and FFprobe are available." -ForegroundColor Green
} else {
  Write-Warning "FFmpeg/FFprobe missing. To install on Windows: winget install Gyan.FFmpeg"
}

# 3. Environment configuration
$apiEnvPath = Join-Path $ScriptDir "apps\api\.env"
if (-not (Test-Path $apiEnvPath)) {
  $exampleWin = Join-Path $ScriptDir "deploy\windows\.env.example"
  $exampleTermux = Join-Path $ScriptDir "deploy\termux\.env.example"
  if (Test-Path $exampleWin) {
    Copy-Item $exampleWin $apiEnvPath
  } elseif (Test-Path $exampleTermux) {
    Copy-Item $exampleTermux $apiEnvPath
  }
  Write-Host "[OK] Created initial configuration at apps\api\.env" -ForegroundColor Green
}

# 4. Check dependencies
if (-not (Test-Path (Join-Path $ScriptDir "node_modules"))) {
  Write-Host "[INFO] Installing workspace dependencies..." -ForegroundColor Yellow
  npm install --omit=dev --no-audit --no-fund
}

# 5. Launch Server
$url = "http://127.0.0.1:$Port"
Write-Host "[INFO] Starting StreamForge on $url..." -ForegroundColor Cyan
Write-Host "[INFO] Press Ctrl+C in this terminal to stop." -ForegroundColor Gray
Write-Host ""

if (-not $NoBrowser) {
  Start-Job -ScriptBlock {
    param($targetUrl)
    Start-Sleep -Seconds 2
    Start-Process $targetUrl
  } -ArgumentList $url | Out-Null
}

Set-Location "$ScriptDir\apps\api"
node src\server.js
Set-Location "$ScriptDir\"
