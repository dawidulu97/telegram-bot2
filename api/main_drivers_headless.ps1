# Headless driver installation (no GUI, no password). Designed to run hidden and stream stdout.
# Steps:
# 1) Install VC_redist.x64.exe first if present
# 2) Install all other .exe drivers silently
# 3) Run autoinstall-intel.ps1 if present
# Note: Audio replacement is done separately by the app via replaceDriver.ps1

$ErrorActionPreference = 'Continue'

function Write-Log {
  param([string]$msg)
  $ts = Get-Date -Format 'HH:mm:ss'
  Write-Output "[$ts] $msg"
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptDir) { $scriptDir = Get-Location }
Set-Location $scriptDir

Write-Log "Starting headless driver installation in $scriptDir"

# Exclusions from main .exe loop
$excludeFiles = @('autoinstall-intel.ps1','replaceDriver.ps1','DriverInstaller_WithGUI.ps1','main_drivers.ps1','main_drivers_headless.ps1')

# Ensure logs dir exists
$logsRoot = Join-Path $scriptDir 'DriverInstallLogs'
$session = Get-Date -Format 'yyyyMMdd_HHmmss'
$logDir = Join-Path $logsRoot $session
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

# 1) VC_redist first
$vc = Join-Path $scriptDir 'VC_redist.x64.exe'
if (Test-Path $vc) {
  Write-Log "Installing VC_redist.x64.exe"
  try {
    $p = Start-Process -FilePath $vc -ArgumentList '/install /quiet /norestart' -PassThru -NoNewWindow -Wait
    Write-Log "VC_redist.x64.exe exit: $($p.ExitCode)"
  } catch { Write-Log "[ERROR] VC_redist.x64.exe: $_" }
}

# 2) Other EXEs
$drivers = Get-ChildItem -Path $scriptDir -Filter '*.exe' -File | Where-Object { $excludeFiles -notcontains $_.Name -and $_.Name -ne 'VC_redist.x64.exe' }
$total = ($drivers | Measure-Object).Count
$idx = 0

foreach ($d in $drivers) {
  $idx++
  $percent = if ($total -gt 0) { [math]::Round(($idx/$total)*100) } else { 100 }
  Write-Log "[$percent%] Installing $($d.Name) ($idx/$total)"
  try {
    # Basic flag heuristics
    $flags = '/S /norestart'
    if ($d.Name -like '*crosec*') { $flags = '/quiet /norestart /acceptEULA' }
    elseif ($d.Name -like '*vc_redist*') { $flags = '/install /quiet /norestart' }
    elseif ($d.Name -like '*SetupRST*') { $flags = '-silent -norestart' }

    $p = Start-Process -FilePath $d.FullName -ArgumentList $flags -PassThru -NoNewWindow
    $start = Get-Date
    while (-not $p.HasExited) {
      if ((Get-Date) - $start -gt ([TimeSpan]::FromMinutes(5))) { Stop-Process -Id $p.Id -Force; throw "Timeout after 5 minutes" }
      Start-Sleep -Seconds 1
    }
    Write-Log "Installed $($d.Name) exit: $($p.ExitCode)"
  } catch { Write-Log "[ERROR] $($d.Name): $_" }
}

# 3) Intel installer
$intel = Join-Path $scriptDir 'autoinstall-intel.ps1'
if (Test-Path $intel) {
  Write-Log 'Running autoinstall-intel.ps1'
  try {
    $output = & $intel 2>&1 | Out-String
    Write-Log "autoinstall-intel.ps1 done"
    if ($output) { $output.Trim().Split("`n") | ForEach-Object { Write-Log $_.Trim() } }
  } catch { Write-Log "[ERROR] autoinstall-intel.ps1: $_" }
}

Write-Log 'Headless driver installation completed.'
exit 0
