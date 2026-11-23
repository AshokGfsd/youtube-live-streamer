<#
.SYNOPSIS
  StreamForge Studio - One-command Windows Stopper
#>
param(
  [int]$Port = 4000
)

$PSScriptRootDirectory = Split-Path -Parent $MyInvocation.MyCommand.Definition
& (Join-Path $PSScriptRootDirectory "scripts\windows\stop.ps1") -Port $Port
