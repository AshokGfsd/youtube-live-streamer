<#
.SYNOPSIS
  StreamForge Studio - Windows PowerShell Stop Script
#>
[CmdletBinding()]
param(
  [int]$Port = 4000
)

$ErrorActionPreference = 'SilentlyContinue'

Write-Host "[INFO] Searching for StreamForge process on port $Port..." -ForegroundColor Cyan
$connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue

if ($connections) {
  foreach ($conn in $connections) {
    $procId = $conn.OwningProcess
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($proc) {
      Write-Host "[INFO] Terminating process $($proc.ProcessName) (PID: $procId)..." -ForegroundColor Yellow
      Stop-Process -Id $procId -Force
      Write-Host "[OK] Successfully stopped StreamForge on port $Port." -ForegroundColor Green
    }
  }
} else {
  Write-Host "[INFO] No process found listening on port $Port." -ForegroundColor Gray
}
