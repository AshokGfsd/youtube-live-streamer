<#
.SYNOPSIS
  StreamForge Studio - One-command Windows Launcher
#>
param(
  [int]$Port = 4000,
  [switch]$NoBrowser
)

$PSScriptRootDirectory = Split-Path -Parent $MyInvocation.MyCommand.Definition
& (Join-Path $PSScriptRootDirectory "scripts\windows\start.ps1") -Port $Port -NoBrowser:$NoBrowser
