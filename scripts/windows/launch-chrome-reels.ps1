<#
.SYNOPSIS
  Launch Google Chrome in portrait Reels kiosk mode for Windows
.DESCRIPTION
  Finds Google Chrome on Windows, verifies port 9222 availability, and
  launches Chrome in 540x960 portrait mode with remote debugging enabled.
#>
[CmdletBinding()]
param(
  [int]$Port = 9222,
  [string]$Url = "https://www.instagram.com/reels/"
)

$ErrorActionPreference = 'Stop'

# Candidate paths for Chrome on Windows
$chromeCandidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
)

$chromePath = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chromePath) {
  $commandChrome = Get-Command chrome.exe -ErrorAction SilentlyContinue
  if ($commandChrome) {
    $chromePath = $commandChrome.Source
  }
}

if (-not $chromePath) {
  Write-Error "Google Chrome executable was not found. Please install Chrome or verify its installation path."
  exit 1
}

Write-Host "[OK] Found Chrome: $chromePath" -ForegroundColor Green

# Check if debugger port 9222 is active
$activeDebugger = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($activeDebugger) {
  Write-Warning "A browser is already listening on port $Port."
  Write-Host "Connect directly to the active session or close all existing debugging Chrome windows first."
  exit 0
}

$userDataDir = Join-Path $env:USERPROFILE "streamforge-browser-profile"
if (-not (Test-Path $userDataDir)) {
  New-Item -ItemType Directory -Path $userDataDir -Force | Out-Null
}

$chromeArgs = @(
  "--user-data-dir=$userDataDir",
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=$Port",
  "--remote-allow-origins=*",
  "--window-position=0,0",
  "--window-size=540,960",
  "--no-first-run",
  "--no-default-browser-check",
  $Url
)

Write-Host "[INFO] Launching Chrome in portrait Reels mode on port $Port..." -ForegroundColor Cyan
Start-Process -FilePath $chromePath -ArgumentList $chromeArgs
Write-Host "[OK] Chrome started. Log in to Instagram and play a Reel before starting the live broadcast." -ForegroundColor Green
