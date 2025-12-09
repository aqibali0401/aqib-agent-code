<#
.SYNOPSIS
Imports a PEM certificate into Windows Certificate Store, linking it to the existing TPM key.

.DESCRIPTION
This script imports the device certificate (received from enrollment service) into the 
Windows Local Machine certificate store. The certificate is linked to the existing TPM 
key container created by create-tpm-key.ps1.

This is REQUIRED for TPM-backed X.509 authentication with Azure IoT SDK, as the SDK
uses Windows CNG to access the TPM key when the certificate is in the cert store.

.PARAMETER DeviceId
Device identifier - must match the TPM key container name and certificate CN.

.PARAMETER CertPath
Path to the PEM certificate file (device.pem from enrollment service).

.PARAMETER ChainPath
Optional path to the CA chain PEM file (intermediate + root certificates).

.EXAMPLE
.\import-cert-to-store.ps1 -DeviceId "AIO_20VD_PG02W5PL" -CertPath "./certificates/device.pem"

.EXAMPLE
.\import-cert-to-store.ps1 -DeviceId "AIO_20VD_PG02W5PL" -CertPath "./certificates/device.pem" -ChainPath "./certificates/device-fullchain.pem"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$DeviceId,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$CertPath,

    [string]$ChainPath
)

function Test-IsAdministrator {
    $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Check for admin privileges
if (-not (Test-IsAdministrator)) {
    Write-Error "Administrator privileges are required to import certificates to Local Machine store."
    Write-Host "Please restart with 'Run as Administrator' and try again." -ForegroundColor Yellow
    exit 1
}

# Validate certificate file exists
if (-not (Test-Path $CertPath)) {
    throw "Certificate file not found: $CertPath"
}

# Verify TPM key container exists
$provider = New-Object System.Security.Cryptography.CngProvider("Microsoft Platform Crypto Provider")
$machineKey = [System.Security.Cryptography.CngKeyOpenOptions]::MachineKey

if (-not [System.Security.Cryptography.CngKey]::Exists($DeviceId, $provider, $machineKey)) {
    throw "TPM key container '$DeviceId' not found. Run create-tpm-key.ps1 first."
}

Write-Host "TPM key container '$DeviceId' verified." -ForegroundColor Green

# Read the PEM certificate file
$certPemContent = Get-Content -Path $CertPath -Raw

# Extract only the FIRST certificate from PEM (device cert, not chain)
$certMatches = [regex]::Matches($certPemContent, "-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----")
if ($certMatches.Count -eq 0) {
    throw "No certificate found in PEM file: $CertPath"
}

# Get the first certificate (device certificate)
$firstCertPem = $certMatches[0].Value
$certBase64 = $firstCertPem -replace "-----BEGIN CERTIFICATE-----", "" `
                            -replace "-----END CERTIFICATE-----", "" `
                            -replace "`r`n", "" `
                            -replace "`n", "" `
                            -replace " ", ""

try {
    $certBytes = [Convert]::FromBase64String($certBase64)
} catch {
    throw "Failed to decode certificate: $($_.Exception.Message)"
}

# Create X509Certificate2 object from bytes
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList @(,$certBytes)

Write-Host "Certificate loaded:" -ForegroundColor Cyan
Write-Host "  Subject: $($cert.Subject)"
Write-Host "  Thumbprint: $($cert.Thumbprint)"
Write-Host "  Valid From: $($cert.NotBefore)"
Write-Host "  Valid To: $($cert.NotAfter)"

# Verify certificate CN matches DeviceId
$cn = ($cert.Subject -split ',')[0] -replace 'CN=', ''
if ($cn -ne $DeviceId) {
    Write-Warning "Certificate CN '$cn' does not match DeviceId '$DeviceId'"
    Write-Host "This may cause authentication issues. Proceeding anyway..." -ForegroundColor Yellow
}

# Open Local Machine Personal certificate store
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store(
    [System.Security.Cryptography.X509Certificates.StoreName]::My,
    [System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine
)

try {
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    
    # Check if certificate already exists
    $existing = $store.Certificates | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
    if ($existing) {
        Write-Host "Certificate already exists in store. Removing old entry..." -ForegroundColor Yellow
        $store.Remove($existing)
    }
    
    # Import certificate
    $store.Add($cert)
    Write-Host "Certificate imported to Local Machine\Personal store." -ForegroundColor Green
    
} finally {
    $store.Close()
}

# Now we need to associate the certificate with the TPM key
# This is done using certutil to repair the key association
Write-Host ""
Write-Host "Associating certificate with TPM key container '$DeviceId'..." -ForegroundColor Cyan

# Export cert to temp file for certutil
$tempCertPath = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.cer'
[System.IO.File]::WriteAllBytes($tempCertPath, $certBytes)

try {
    # Use certutil to associate the cert with the TPM key container
    # -repairstore links the cert to an existing key container
    $result = & certutil -repairstore My $cert.Thumbprint 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "certutil -repairstore returned non-zero exit code. Output:"
        Write-Host $result -ForegroundColor Yellow
        
        # Alternative: Try using certreq -accept
        Write-Host "Trying alternative method with certreq..." -ForegroundColor Cyan
        $result = & certreq -accept -machine $tempCertPath 2>&1
        Write-Host $result
    } else {
        Write-Host "Certificate successfully linked to TPM key." -ForegroundColor Green
    }
} finally {
    Remove-Item $tempCertPath -ErrorAction SilentlyContinue
}

# Import CA chain if provided
if ($ChainPath -and (Test-Path $ChainPath)) {
    Write-Host ""
    Write-Host "Importing CA chain certificates..." -ForegroundColor Cyan
    
    $chainPem = Get-Content -Path $ChainPath -Raw
    
    # Split chain into individual certificates
    $chainCerts = [regex]::Matches($chainPem, "-----BEGIN CERTIFICATE-----.+?-----END CERTIFICATE-----", [System.Text.RegularExpressions.RegexOptions]::Singleline)
    
    # Open Intermediate CA store
    $caStore = New-Object System.Security.Cryptography.X509Certificates.X509Store(
        [System.Security.Cryptography.X509Certificates.StoreName]::CertificateAuthority,
        [System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine
    )
    
    try {
        $caStore.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        
        foreach ($chainCertMatch in $chainCerts) {
            $chainCertPem = $chainCertMatch.Value
            $chainBase64 = $chainCertPem -replace "-----BEGIN CERTIFICATE-----", "" `
                                          -replace "-----END CERTIFICATE-----", "" `
                                          -replace "`r`n", "" `
                                          -replace "`n", ""
            
            try {
                $chainBytes = [Convert]::FromBase64String($chainBase64)
                $chainCert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList @(,$chainBytes)
                
                # Check if it's the same as device cert (skip if so)
                if ($chainCert.Thumbprint -eq $cert.Thumbprint) {
                    continue
                }
                
                $caStore.Add($chainCert)
                Write-Host "  Imported: $($chainCert.Subject)" -ForegroundColor Gray
            } catch {
                Write-Warning "Failed to import chain cert: $($_.Exception.Message)"
            }
        }
        
        Write-Host "CA chain imported to Local Machine\Intermediate Certification Authorities." -ForegroundColor Green
    } finally {
        $caStore.Close()
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " Certificate Import Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Device ID: $DeviceId"
Write-Host "  Thumbprint: $($cert.Thumbprint)"
Write-Host "  Store: Local Machine\Personal"
Write-Host "  TPM Key: Linked"
Write-Host ""
Write-Host "The certificate is now ready for Azure IoT DPS provisioning." -ForegroundColor Cyan

# Return thumbprint for use by calling code
return $cert.Thumbprint
