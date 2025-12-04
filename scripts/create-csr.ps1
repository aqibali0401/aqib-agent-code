<#
.SYNOPSIS
Generates a PEM-encoded CSR using the TPM-backed key created in step 2.

.DESCRIPTION
Uses `certreq.exe` with an auto-generated INF file that references the existing
TPM key container, builds subject/SAN fields with device metadata, and outputs a
CSR suitable for the enrollment service.

.PARAMETER DeviceId
Device identifier used as both certificate CN and TPM key container name.

.PARAMETER Model
Hardware model string (optional, used in SAN metadata).

.PARAMETER Serial
Hardware serial number (optional, used in SAN metadata).

.PARAMETER OutputPath
Destination path for the CSR PEM file.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$DeviceId,

    [string]$Model,

    [string]$Serial,

    [string]$OutputPath
)

if (-not $OutputPath) {
    $safeId = ($DeviceId -replace '[\\/:*?"<>|]', '_')
    $OutputPath = Join-Path -Path (Get-Location) -ChildPath "csr-$safeId.req"
}

$provider = New-Object System.Security.Cryptography.CngProvider("Microsoft Platform Crypto Provider")
$machineKey = [System.Security.Cryptography.CngKeyOpenOptions]::MachineKey

if (-not [System.Security.Cryptography.CngKey]::Exists($DeviceId, $provider, $machineKey)) {
    throw "TPM key container '$DeviceId' not found. Run create-tpm-key.ps1 first."
}

$tempInf = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.inf'

$sanEntries = @("dns=$DeviceId")
if ($Model) { $sanEntries += "uri=urn:device:model:$Model" }
if ($Serial) { $sanEntries += "uri=urn:device:serial:$Serial" }

$extensionsSection = ""
if ($sanEntries.Count -gt 0) {
    $extensionsSection = "[Extensions]`r`n2.5.29.17 = `"{text}`"`r`n"
    foreach ($entry in $sanEntries) {
        $extensionsSection += "_continue_ = `"$entry`"`r`n"
    }
}

$inf = @"
[Version]
Signature=`"$Windows NT$`

[NewRequest]
Subject = "CN=$DeviceId"
KeySpec = 2
KeyLength = 2048
MachineKeySet = TRUE
ProviderName = "Microsoft Platform Crypto Provider"
ProviderType = 0
RequestType = PKCS10
UseExistingKeySet = TRUE
KeyContainer = "$DeviceId"

"@

if ($extensionsSection) {
    $inf += "`r`n$extensionsSection"
}

Set-Content -Path $tempInf -Value $inf -Encoding ascii

try {
    & certreq.exe -new $tempInf $OutputPath | Write-Host
    Write-Host "CSR written to $OutputPath"
}
finally {
    Remove-Item $tempInf -ErrorAction SilentlyContinue
}

