<#
.SYNOPSIS
  Install missing StreamForge dependencies on Windows using winget
#>
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "         StreamForge Windows Dependency Installer (winget)          " -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""

$hasWinget = [bool](Get-Command winget -ErrorAction SilentlyContinue)
if (-not $hasWinget) {
  Write-Error "Windows Package Manager (winget) is not available. Please install dependencies manually."
  exit 1
}

# 1. Node.js check
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Host "[INFO] Installing Node.js LTS via winget..." -ForegroundColor Yellow
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
} else {
  Write-Host "[OK] Node.js is already installed: $((node -v))" -ForegroundColor Green
}

# 2. FFmpeg check
$ffmpegCmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpegCmd) {
  Write-Host "[INFO] Installing FFmpeg via winget..." -ForegroundColor Yellow
  winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
} else {
  Write-Host "[OK] FFmpeg is already installed." -ForegroundColor Green
}

# 3. Google Chrome check
$chromeCandidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
)
$hasChrome = [bool]($chromeCandidates | Where-Object { Test-Path $_ })
if (-not $hasChrome) {
  Write-Host "[INFO] Chrome not found. Chrome is optional for Instagram Reels browser mode." -ForegroundColor Gray
} else {
  Write-Host "[OK] Google Chrome is available." -ForegroundColor Green
}

Write-Host ""
Write-Host "[SUCCESS] Dependency check complete. Restart your terminal if new tools were installed." -ForegroundColor Green
