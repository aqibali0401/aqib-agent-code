# ====================================
# Find IoT Hub and Monitor Messages
# ====================================

Write-Host "🔍 IoT Hub Discovery and Message Monitoring Helper" -ForegroundColor Cyan
Write-Host "=" * 50 -ForegroundColor Gray
Write-Host ""

# Check if Azure CLI is installed
$azInstalled = Get-Command az -ErrorAction SilentlyContinue

if (-not $azInstalled) {
    Write-Host "⚠️  Azure CLI is not installed on this system." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "You have two options:" -ForegroundColor White
    Write-Host ""
    Write-Host "Option 1: Install Azure CLI (Recommended for developers)" -ForegroundColor Green
    Write-Host "  • Download from: https://aka.ms/installazurecliwindows"
    Write-Host "  • Or run in PowerShell (as Admin): winget install -e --id Microsoft.AzureCLI"
    Write-Host ""
    Write-Host "Option 2: Use Azure IoT Explorer (Easier, GUI-based)" -ForegroundColor Green
    Write-Host "  • Download from: https://github.com/Azure/azure-iot-explorer/releases"
    Write-Host "  • No command line needed!"
    Write-Host ""
    Write-Host "📖 See HOW_TO_VIEW_MESSAGES.md for detailed instructions" -ForegroundColor Magenta
    Write-Host ""
    
    $choice = Read-Host "Would you like to open the download page for Azure IoT Explorer? (y/n)"
    if ($choice -eq 'y' -or $choice -eq 'Y') {
        Start-Process "https://github.com/Azure/azure-iot-explorer/releases"
    }
    exit
}

Write-Host "✅ Azure CLI is installed!" -ForegroundColor Green
Write-Host ""

# Check if logged in to Azure
Write-Host "Checking Azure login status..." -ForegroundColor Cyan
$loginStatus = az account show 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  Not logged in to Azure. Launching login..." -ForegroundColor Yellow
    az login
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Login failed. Please try again." -ForegroundColor Red
        exit 1
    }
}

Write-Host "✅ Logged in to Azure" -ForegroundColor Green
Write-Host ""

# List IoT Hubs
Write-Host "🔍 Finding IoT Hubs in your subscription..." -ForegroundColor Cyan
$hubs = az iot hub list --query "[].{Name:name, ResourceGroup:resourceGroup, Location:location}" -o json | ConvertFrom-Json

if ($hubs.Count -eq 0) {
    Write-Host "❌ No IoT Hubs found in your subscription." -ForegroundColor Red
    exit 1
}

Write-Host "Found $($hubs.Count) IoT Hub(s):" -ForegroundColor Green
Write-Host ""

for ($i = 0; $i -lt $hubs.Count; $i++) {
    Write-Host "  [$($i + 1)] $($hubs[$i].Name)" -ForegroundColor White
    Write-Host "      Resource Group: $($hubs[$i].ResourceGroup)" -ForegroundColor Gray
    Write-Host "      Location: $($hubs[$i].Location)" -ForegroundColor Gray
    Write-Host ""
}

# Select hub
$hubName = ""
if ($hubs.Count -eq 1) {
    $hubName = $hubs[0].Name
    Write-Host "✅ Using IoT Hub: $hubName" -ForegroundColor Green
} else {
    $selection = Read-Host "Enter the number of the IoT Hub to monitor (1-$($hubs.Count))"
    $index = [int]$selection - 1
    if ($index -ge 0 -and $index -lt $hubs.Count) {
        $hubName = $hubs[$index].Name
        Write-Host "✅ Selected: $hubName" -ForegroundColor Green
    } else {
        Write-Host "❌ Invalid selection" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "=" * 50 -ForegroundColor Gray
Write-Host ""

# Get device ID from .env file
$deviceId = "AIO_20VD_PG02W5PL"  # From your .env file

Write-Host "📱 Device ID: $deviceId" -ForegroundColor Cyan
Write-Host "🏢 IoT Hub: $hubName" -ForegroundColor Cyan
Write-Host ""

# Ask what to do
Write-Host "What would you like to do?" -ForegroundColor Yellow
Write-Host "  [1] Monitor messages from your device ($deviceId)"
Write-Host "  [2] Monitor messages from ALL devices"
Write-Host "  [3] Show device information"
Write-Host "  [4] Exit"
Write-Host ""

$action = Read-Host "Enter your choice (1-4)"

switch ($action) {
    "1" {
        Write-Host ""
        Write-Host "🎧 Monitoring messages from device: $deviceId" -ForegroundColor Green
        Write-Host "Press Ctrl+C to stop monitoring" -ForegroundColor Gray
        Write-Host ""
        Write-Host "=" * 50 -ForegroundColor Gray
        Write-Host ""
        
        az iot hub monitor-events --hub-name $hubName --device-id $deviceId --output table
    }
    "2" {
        Write-Host ""
        Write-Host "🎧 Monitoring messages from ALL devices" -ForegroundColor Green
        Write-Host "Press Ctrl+C to stop monitoring" -ForegroundColor Gray
        Write-Host ""
        Write-Host "=" * 50 -ForegroundColor Gray
        Write-Host ""
        
        az iot hub monitor-events --hub-name $hubName --output table
    }
    "3" {
        Write-Host ""
        Write-Host "📊 Device Information:" -ForegroundColor Cyan
        Write-Host ""
        
        az iot hub device-identity show --hub-name $hubName --device-id $deviceId --output table
        
        Write-Host ""
        Write-Host "📈 Device Twin:" -ForegroundColor Cyan
        az iot hub device-twin show --hub-name $hubName --device-id $deviceId
    }
    "4" {
        Write-Host "👋 Goodbye!" -ForegroundColor Cyan
        exit 0
    }
    default {
        Write-Host "❌ Invalid choice" -ForegroundColor Red
        exit 1
    }
}

