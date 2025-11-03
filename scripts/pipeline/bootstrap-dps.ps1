Param(
  [Parameter(Mandatory=$false)] [string]$DpsResourceGroup = $env:DPS_RESOURCE_GROUP,
  [Parameter(Mandatory=$false)] [string]$DpsName = $env:DPS_NAME,
  [Parameter(Mandatory=$false)] [string]$DpsCertName = $env:DPS_CERT_NAME,
  [Parameter(Mandatory=$false)] [string]$IntermediatePemPath = $env:INTERMEDIATE_PEM_PATH,
  [Parameter(Mandatory=$false)] [string]$EnrollmentId = $env:ENROLLMENT_ID,
  [Parameter(Mandatory=$false)] [string]$SubscriptionName = $env:SUBSCRIPTION_NAME,
  [Parameter(Mandatory=$false)] [switch]$DevUseLocalSigning
)

# Validate required parameters
if ([string]::IsNullOrEmpty($DpsResourceGroup)) {
    Write-Error "DpsResourceGroup is required. Provide via -DpsResourceGroup parameter or DPS_RESOURCE_GROUP environment variable."
    exit 1
}
if ([string]::IsNullOrEmpty($DpsName)) {
    Write-Error "DpsName is required. Provide via -DpsName parameter or DPS_NAME environment variable."
    exit 1
}
if ([string]::IsNullOrEmpty($DpsCertName)) {
    Write-Error "DpsCertName is required. Provide via -DpsCertName parameter or DPS_CERT_NAME environment variable."
    exit 1
}
if ([string]::IsNullOrEmpty($IntermediatePemPath)) {
    Write-Error "IntermediatePemPath is required. Provide via -IntermediatePemPath parameter or INTERMEDIATE_PEM_PATH environment variable."
    exit 1
}
if ([string]::IsNullOrEmpty($EnrollmentId)) {
    Write-Error "EnrollmentId is required. Provide via -EnrollmentId parameter or ENROLLMENT_ID environment variable."
    exit 1
}

# Handle DevUseLocalSigning from environment if not provided as switch
if (-not $DevUseLocalSigning -and $env:DEV_USE_LOCAL_SIGNING -eq 'true') {
    $DevUseLocalSigning = $true
}

function Get-AzCliPath {
  # Try common installation paths
  $azPaths = @(
    "$env:ProgramFiles\Microsoft SDKs\Azure\CLI2\wbin\az.cmd",
    "${env:ProgramFiles(x86)}\Microsoft SDKs\Azure\CLI2\wbin\az.cmd",
    "$env:LOCALAPPDATA\Microsoft\WindowsApps\az.cmd"
  )
  
  foreach ($path in $azPaths) {
    if (Test-Path $path) {
      return $path
    }
  }
  
  # Try to find az in PATH
  $azCmd = Get-Command az -ErrorAction SilentlyContinue
  if ($azCmd) {
    return $azCmd.Source
  }
  
  return $null
}

function Ensure-AzCli {
  $azPath = Get-AzCliPath
  
  if ($azPath -and (Test-Path $azPath)) {
    Write-Host "Azure CLI found at: $azPath" -ForegroundColor Green
    return $azPath
  }
  
  Write-Host "Azure CLI not found. Installing via winget..." -ForegroundColor Yellow
  try {
    winget install -e --id Microsoft.AzureCLI --source winget --silent
    Write-Host "Azure CLI installation completed. Locating installation..." -ForegroundColor Yellow
    
    # Wait a moment for installation to complete
    Start-Sleep -Seconds 5
    
    # Refresh environment PATH from registry
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path","Machine")
    $userPath = [System.Environment]::GetEnvironmentVariable("Path","User")
    $env:Path = "$machinePath;$userPath"
    
    # Common Azure CLI installation paths (check these directly)
    $commonPaths = @(
      "$env:ProgramFiles\Microsoft SDKs\Azure\CLI2\wbin\az.cmd",
      "${env:ProgramFiles(x86)}\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
    )
    
    foreach ($testPath in $commonPaths) {
      if (Test-Path $testPath) {
        Write-Host "Azure CLI found after installation at: $testPath" -ForegroundColor Green
        return $testPath
      }
    }
    
    # Try to find via Get-Command after PATH refresh
    $azPath = Get-AzCliPath
    if ($azPath -and (Test-Path $azPath)) {
      Write-Host "Azure CLI found after installation at: $azPath" -ForegroundColor Green
      return $azPath
    }
    
    Write-Warning "Azure CLI was installed but not found in PATH. You may need to restart PowerShell."
    Write-Warning "Or manually add: C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin to your PATH"
    Write-Error "Please restart PowerShell and try again, or install Azure CLI manually from https://aka.ms/installazurecliwindows"
    exit 1
  } catch {
    Write-Error "Failed to install Azure CLI automatically. Install from https://aka.ms/installazurecliwindows and rerun."
    exit 1
  }
}

function Invoke-AzCommand {
  param(
    [string]$AzPath,
    [string[]]$Arguments
  )
  
  if ($AzPath) {
    & $AzPath $Arguments
  } else {
    & az $Arguments
  }
  
  # PowerShell automatically sets $LASTEXITCODE after external commands
  return $LASTEXITCODE
}

function Ensure-AzIotExtension {
  param([string]$AzPath)
  
  # First check if extension is already installed
  try {
    $checkArgs = @("extension", "list", "--query", "[?name=='azure-iot'].name", "-o", "tsv")
    $extensionCheck = Invoke-AzCommand -AzPath $AzPath -Arguments $checkArgs 2>&1
    if ($extensionCheck -match "azure-iot") {
      Write-Host "Azure IoT extension is already installed." -ForegroundColor Green
      return
    }
  } catch {
    # Extension check failed, try to install
  }
  
  # Try to install the extension
  Write-Host "Installing Azure IoT extension..." -ForegroundColor Cyan
  try {
    $args = @("extension", "add", "--name", "azure-iot", "--only-show-errors")
    $installOutput = Invoke-AzCommand -AzPath $AzPath -Arguments $args 2>&1
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Azure IoT extension installed successfully." -ForegroundColor Green
    } else {
      # Check again if it was installed despite the error
      $checkArgs = @("extension", "list", "--query", "[?name=='azure-iot'].name", "-o", "tsv")
      $extensionCheck = Invoke-AzCommand -AzPath $AzPath -Arguments $checkArgs 2>&1
      if ($extensionCheck -match "azure-iot") {
        Write-Host "Azure IoT extension is installed (despite previous warning)." -ForegroundColor Green
      } else {
        Write-Warning "Azure IoT extension installation had issues, but continuing..."
        Write-Warning "You may need to install it manually: az extension add --name azure-iot"
      }
    }
  } catch {
    Write-Warning "Azure IoT extension installation failed, but continuing..."
    Write-Warning "You may need to install it manually: az extension add --name azure-iot"
  }
}

function Ensure-LoginAndSubscription {
  param([string]$AzPath)
  
  # Check if already logged in
  try {
    $checkArgs = @("account", "show", "--query", "name", "-o", "tsv")
    $currentAccount = Invoke-AzCommand -AzPath $AzPath -Arguments $checkArgs 2>&1
    if ($currentAccount -and -not ($currentAccount -match "Please run 'az login'")) {
      Write-Host "Already logged in to Azure as: $currentAccount" -ForegroundColor Green
      
      # Set subscription if specified
      if ($SubscriptionName -ne "") {
        Write-Host "Setting subscription to: $SubscriptionName" -ForegroundColor Cyan
        $subArgs = @("account", "set", "--subscription", $SubscriptionName)
        Invoke-AzCommand -AzPath $AzPath -Arguments $subArgs | Out-Null
        Write-Host "Subscription set successfully." -ForegroundColor Green
      }
      return
    }
  } catch {
    # Not logged in, continue to login
  }
  
  # Need to login interactively
  Write-Host "Signing in to Azure (interactive login required)..." -ForegroundColor Yellow
  Write-Host "A browser window will open for authentication, or follow the device code instructions." -ForegroundColor Cyan
  Write-Host ""
  
  $loginArgs = @("login")
  # Execute login interactively - DO NOT suppress output
  Invoke-AzCommand -AzPath $AzPath -Arguments $loginArgs
  
  Write-Host ""
  Write-Host "Checking login status..." -ForegroundColor Cyan
  
  # Check if login was successful
  $checkArgs = @("account", "show", "--query", "name", "-o", "tsv")
  $accountCheck = Invoke-AzCommand -AzPath $AzPath -Arguments $checkArgs 2>&1 | Out-String
  
  if ($accountCheck -match "Please run 'az login'") {
    Write-Error "Azure login failed. Please try again."
    exit 1
  }
  
  Write-Host "Successfully logged in to Azure." -ForegroundColor Green
  
  # Set subscription if specified
  if ($SubscriptionName -ne "") {
    Write-Host "Setting subscription to: $SubscriptionName" -ForegroundColor Cyan
    $subArgs = @("account", "set", "--subscription", $SubscriptionName)
    Invoke-AzCommand -AzPath $AzPath -Arguments $subArgs | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Subscription set successfully." -ForegroundColor Green
    } else {
      Write-Warning "Failed to set subscription. Continuing with default subscription."
    }
  }
}

# 1) Ensure tooling
$azCliPath = Ensure-AzCli
Ensure-AzIotExtension -AzPath $azCliPath
Ensure-LoginAndSubscription -AzPath $azCliPath

# 2) Export env variables for Node script
$env:DPS_RESOURCE_GROUP = $DpsResourceGroup
$env:DPS_NAME = $DpsName
$env:DPS_CERT_NAME = $DpsCertName
$env:INTERMEDIATE_PEM_PATH = $IntermediatePemPath
$env:ENROLLMENT_ID = $EnrollmentId
$env:DEV_USE_LOCAL_SIGNING = $(if ($DevUseLocalSigning) { 'true' } else { 'false' })

# Pass Azure CLI path to Node script if found
if ($azCliPath) {
  $env:AZ_CLI_PATH = $azCliPath
}

Write-Host "Running DPS setup with:" -ForegroundColor Cyan
Write-Host "  RG=$($env:DPS_RESOURCE_GROUP)" -ForegroundColor Cyan
Write-Host "  DPS=$($env:DPS_NAME)" -ForegroundColor Cyan
Write-Host "  CERT_NAME=$($env:DPS_CERT_NAME)" -ForegroundColor Cyan
Write-Host "  PEM=$($env:INTERMEDIATE_PEM_PATH)" -ForegroundColor Cyan
Write-Host "  ENROLLMENT_ID=$($env:ENROLLMENT_ID)" -ForegroundColor Cyan
Write-Host "  DEV_USE_LOCAL_SIGNING=$($env:DEV_USE_LOCAL_SIGNING)" -ForegroundColor Cyan

# 3) Run Node DPS setup
node scripts/pipeline/dps-setup.js

if ($LASTEXITCODE -ne 0) {
  Write-Error "DPS setup failed."; exit $LASTEXITCODE
}

Write-Host "DPS setup complete." -ForegroundColor Green
