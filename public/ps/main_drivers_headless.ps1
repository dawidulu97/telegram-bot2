param(
  [Parameter(Mandatory=$true)][string]$Hwid,
  [Parameter(Mandatory=$true)][string]$SupabaseUrl,
  [Parameter(Mandatory=$true)][string]$SupabaseKey
)

# Headless driver installation (no GUI, no password). Designed to run hidden and stream stdout.
# Steps:
# 0) Verify HWID is approved in Supabase
# 1) Bulk-install all INF drivers recursively (pnputil)
# 2) Install all MSI silently
# 3) Install EXE silently with common flags (try sets)
# 4) Optionally run autoinstall-intel.ps1 if present
# Note: Audio replacement is done separately by replaceDriver.ps1

$ErrorActionPreference = 'Stop'

function Write-Log {
  param([string]$msg)
  $ts = Get-Date -Format 'HH:mm:ss'
  Write-Output "[$ts] $msg"
}

function Check-Approval {
  param([string]$Hwid,[string]$SupabaseUrl,[string]$SupabaseKey)
  $headers = @{
    apikey        = $SupabaseKey
    Authorization = "Bearer $SupabaseKey"
    Accept        = "application/json"
  }
  $uri = "$SupabaseUrl/rest/v1/hwid_approvals?select=status&hwid=eq.$([uri]::EscapeDataString($Hwid))"
  $resp = Invoke-RestMethod -Method GET -Uri $uri -Headers $headers
  if (-not $resp -or -not $resp[0] -or -not $resp[0].status) {
    throw "HWID not found in database."
  }
  $st = ($resp[0].status).ToString().ToLower()
  if ($st -ne 'approved') {
    throw "HWID status is '$st' (not approved)."
  }
  Write-Log "HWID approved."
}

# Make script dir working dir (Electron sets CWD to Drivers/, but be defensive)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $scriptDir) { $scriptDir = Get-Location }
Set-Location $scriptDir
Write-Log "Starting headless driver installation in $scriptDir"

try {
  # 0) Verify license/HWID
  Check-Approval -Hwid $Hwid -SupabaseUrl $SupabaseUrl -SupabaseKey $SupabaseKey

  # 1) Bulk INF install
  Write-Log "Installing INF drivers via pnputil (recursive)…"
  $pnputil = Join-Path $env:SystemRoot 'System32\pnputil.exe'
  $infGlob = Join-Path $scriptDir '*\*.inf'
  $pnpargs = @('/add-driver', $infGlob, '/subdirs', '/install')
  $p = Start-Process -FilePath $pnputil -ArgumentList $pnpargs -WindowStyle Hidden -PassThru -Wait
  Write-Log "pnputil exit: $($p.ExitCode)"

  # 2) MSI install (quiet)
  Write-Log "Installing MSI packages quietly…"
  Get-ChildItem -Recurse -Filter *.msi | ForEach-Object {
    $msi = $_.FullName
    Write-Log "Installing MSI: $($_.Name)"
    $args = @('/i', "`"$msi`"", '/qn', '/norestart')
    $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList $args -WindowStyle Hidden -PassThru -Wait
    Write-Log "Installed MSI $($_.Name) exit: $($p.ExitCode)"
  }

  # 3) EXE install (silent flags, try sets)
  Write-Log "Installing EXE drivers silently…"
  $exeFlagSets = @(
    @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-'), # Inno Setup
    @('/S'),                                                  # NSIS
    @('--silent','--squirrel-firstrun'),                      # Squirrel
    @('/quiet','/norestart'),                                 # MSI-wrapped
    @('/silent')                                              # generic
  )

  # Install VC_redist first if present (specific flags)
  $vc = Join-Path $scriptDir 'VC_redist.x64.exe'
  if (Test-Path $vc) {
    Write-Log "Installing VC_redist.x64.exe"
    $p = Start-Process -FilePath $vc -ArgumentList @('/install','/quiet','/norestart') -WindowStyle Hidden -PassThru -Wait
    Write-Log "VC_redist.x64.exe exit: $($p.ExitCode)"
  }

  # Then all other EXEs
  Get-ChildItem -Recurse -Filter *.exe | Where-Object { $_.Name -ne 'VC_redist.x64.exe' } | ForEach-Object {
    $exe = $_.FullName
    $name = $_.Name
    $success = $false

    # Heuristics for known installers
    $flagList = $exeFlagSets
    if ($name -like '*crosec*') { $flagList = @(@('/quiet','/norestart','/acceptEULA')) }
    elseif ($name -like '*vc_redist*') { $flagList = @(@('/install','/quiet','/norestart')) }
    elseif ($name -like '*SetupRST*') { $flagList = @(@('-silent','-norestart')) }

    foreach ($flags in $flagList) {
      try {
        Write-Log "Installing EXE: $name flags: $($flags -join ' ')"
        $p = Start-Process -FilePath $exe -ArgumentList $flags -WindowStyle Hidden -PassThru -Wait
        if ($p.ExitCode -eq 0) { $success = $true; break }
      } catch { }
    }
    if ($success) { Write-Log "Installed $name exit: 0" }
    else { Write-Log "[WARN] Silent install failed for $name (all flag sets). You may need a specific flag." }
  }

  # 4) Optional Intel script
  $intel = Join-Path $scriptDir 'autoinstall-intel.ps1'
  if (Test-Path $intel) {
    Write-Log 'Running autoinstall-intel.ps1'
    try {
      $output = & $intel 2>&1 | Out-String
      Write-Log "autoinstall-intel.ps1 done"
      if ($output) { $output.Trim().Split([Environment]::NewLine) | ForEach-Object { if ($_ -and $_.Trim()) { Write-Log $_.Trim() } } }
    } catch { Write-Log "[ERROR] autoinstall-intel.ps1: $_" }
  }

  Write-Log 'Headless driver installation completed.'
  exit 0
}
catch {
  Write-Log \"[ERROR] $_\"
  exit 1
}