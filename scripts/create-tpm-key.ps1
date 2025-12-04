<#
.SYNOPSIS
Creates (if needed) a TPM-backed RSA key tied to a device ID.

.DESCRIPTION
Uses the Microsoft Platform Crypto Provider so the private key is generated
inside TPM hardware and is non-exportable. Designed to be run during device
boot as part of the provisioning workflow.

.PARAMETER DeviceId
Stable device identifier (e.g., value from formatDeviceId) used as the key
container name. This same string must be reused later for CSR generation.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$DeviceId
)

function Test-IsAdministrator {
    $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    Write-Error "Administrator privileges are required to create TPM machine keys."
    Write-Host "Please restart VS Code or your terminal with 'Run as Administrator' and try again." -ForegroundColor Yellow
    exit 1
}

$provider = New-Object System.Security.Cryptography.CngProvider("Microsoft Platform Crypto Provider")
$openOptions = [System.Security.Cryptography.CngKeyOpenOptions]::MachineKey

if ([System.Security.Cryptography.CngKey]::Exists($DeviceId, $provider, $openOptions)) {
    Write-Host "TPM key '$DeviceId' already exists. Skipping creation."
    return
}

$creationOptions = New-Object System.Security.Cryptography.CngKeyCreationParameters
$creationOptions.Provider = $provider
$creationOptions.KeyUsage = [System.Security.Cryptography.CngKeyUsages]::Signing
$creationOptions.ExportPolicy = [System.Security.Cryptography.CngExportPolicies]::None
$creationOptions.KeyCreationOptions = [System.Security.Cryptography.CngKeyCreationOptions]::MachineKey

try {
    [System.Security.Cryptography.CngKey]::Create([System.Security.Cryptography.CngAlgorithm]::Rsa, $DeviceId, $creationOptions) | Out-Null
    Write-Host "Created TPM-backed RSA key container '$DeviceId'."
}
catch {
    throw "Failed to create TPM key '$DeviceId': $($_.Exception.Message)"
}

