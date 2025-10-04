#Requires -RunAsAdministrator
param(
  [string]$Hwid,
  [string]$SupabaseUrl,
  [string]$SupabaseKey,
  [string]$AudioSysPath
)

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

try {
  Check-Approval -Hwid $Hwid -SupabaseUrl $SupabaseUrl -SupabaseKey $SupabaseKey

  # Use provided AudioSysPath if supplied and exists; otherwise fall back to local 'audio' folder next to the script
  $DriverPath   = "C:\Windows\System32\drivers\csaudiointcsof.sys"
  $ScriptRoot   = Split-Path -Parent $MyInvocation.MyCommand.Path
  $LocalSysPath = Join-Path -Path $ScriptRoot -ChildPath "audio\csaudiointcsof.sys"
  $NewDriverPath = if ($AudioSysPath -and (Test-Path $AudioSysPath)) { $AudioSysPath } else { $LocalSysPath }

  if (-not (Test-Path $NewDriverPath)) {
    Write-Log "Error: New audio driver not found."
    Write-Log "Searched paths: $AudioSysPath ; $LocalSysPath"
    exit 2
  }
  Write-Log \"Using audio sys: $NewDriverPath\"

  # Take ownership & grant full control
  Write-Log 'Taking ownership of target driver…'
  takeown /f $DriverPath | Out-Null
  icacls $DriverPath /grant \"Administrators:F\" | Out-Null

  # Stop audio services
  Write-Log 'Stopping audio services…'
  Stop-Service Audiosrv -Force -ErrorAction SilentlyContinue
  Stop-Service AudioEndpointBuilder -Force -ErrorAction SilentlyContinue

  # Backup original driver
  $BackupPath = \"$DriverPath.bak\"
  if (Test-Path $DriverPath) {
    Copy-Item $DriverPath $BackupPath -Force
    Write-Log \"Backup created: $BackupPath\"
  }

  # Replace driver
  Write-Log 'Replacing audio driver…'
  Copy-Item $NewDriverPath $DriverPath -Force
  Write-Log 'Driver replaced successfully.'

  # Restart services
  Write-Log 'Restarting audio services…'
  Start-Service Audiosrv -ErrorAction SilentlyContinue
  Start-Service AudioEndpointBuilder -ErrorAction SilentlyContinue

  Write-Log 'Audio replacement completed.'
  exit 0
}
catch {
  Write-Log \"[ERROR] $_\"
  # Best-effort restore if backup exists
  try {
    $BackupPath = \"$DriverPath.bak\"
    if (Test-Path $BackupPath) {
      Copy-Item $BackupPath $DriverPath -Force
      Write-Log 'Restored original driver from backup.'
    }
  } catch {}
  exit 1
}