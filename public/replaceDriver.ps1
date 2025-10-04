#Requires -RunAsAdministrator

$DriverPath = "C:\Windows\System32\drivers\csaudiointcsof.sys"
$NewDriverPath = Join-Path -Path $PSScriptRoot -ChildPath "audio\csaudiointcsof.sys"

# Check if new driver exists
if (-not (Test-Path $NewDriverPath)) {
    Write-Host "Error: New driver not found in the 'audio' folder!" -ForegroundColor Red
    Write-Host "Expected path: $NewDriverPath" -ForegroundColor Yellow
    exit 1
}

# Take ownership & grant full control
try {
    takeown /f $DriverPath
    icacls $DriverPath /grant "Administrators:F"
    Write-Host "Ownership and permissions set." -ForegroundColor Green
} catch {
    Write-Host "Failed to take ownership: $_" -ForegroundColor Red
    exit 1
}

# Stop audio services
try {
    Stop-Service Audiosrv -Force -ErrorAction Stop
    Stop-Service AudioEndpointBuilder -Force -ErrorAction Stop
    Write-Host "Stopped audio services." -ForegroundColor Green
} catch {
    Write-Host "Failed to stop services: $_" -ForegroundColor Red
    exit 1
}

# Backup original driver
try {
    $BackupPath = "$DriverPath.bak"
    Copy-Item $DriverPath $BackupPath -Force
    Write-Host "Backup created: $BackupPath" -ForegroundColor Green
} catch {
    Write-Host "Failed to backup driver: $_" -ForegroundColor Red
    exit 1
}

# Replace driver
try {
    Copy-Item $NewDriverPath $DriverPath -Force
    Write-Host "Driver replaced successfully!" -ForegroundColor Green
} catch {
    Write-Host "Failed to replace driver: $_" -ForegroundColor Red
    # Attempt to restore backup if replacement fails
    if (Test-Path $BackupPath) {
        Copy-Item $BackupPath $DriverPath -Force
        Write-Host "Restored original driver from backup." -ForegroundColor Yellow
    }
    exit 1
}

# Restart services
try {
    Start-Service Audiosrv
    Start-Service AudioEndpointBuilder
    Write-Host "Audio services restarted." -ForegroundColor Green
} catch {
    Write-Host "Warning: Could not restart services. A reboot may be required." -ForegroundColor Yellow
}

Write-Host "Done! A reboot may be needed for changes to take full effect." -ForegroundColor Cyan