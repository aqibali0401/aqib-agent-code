## Step 3 – CSR Generation Playbook

This guide shows how to build a PKCS#10 CSR using the TPM-backed private key created in Step 2, so the request can be sent to the certificate enrollment service.

### 1. Inputs
- `DeviceId`: same value used as TPM key container and eventual certificate CN.
- Device metadata for SANs: model, serial, SKU, etc.

### 2. Pre-checks
```powershell
$provider = New-Object System.Security.Cryptography.CngProvider("Microsoft Platform Crypto Provider")
[System.Security.Cryptography.CngKey]::Exists($DeviceId, $provider, [System.Security.Cryptography.CngKeyOpenOptions]::MachineKey)
```
- Must return `True`; otherwise run the TPM key creation step.

### 3. Generate CSR (PowerShell automation)
```powershell
Start-Process powershell -Verb RunAs -ArgumentList `
    '-ExecutionPolicy Bypass -File "D:\qsc-3\mithun-package\final-agent-nest\scripts\create-csr.ps1" `
    '-DeviceId "AIO_20VD_PG02W5PL" -Model "20VD" -Serial "PG02W5PL" -OutputPath "csr-AIO_20VD_PG02W5PL.req"'
```
- Script writes a temporary INF referencing the TPM key (`UseExistingKeySet=TRUE`) and calls `certreq -new`.
- Output is Base64 CSR (`.req` or `.pem`) ready for Step 4.

### 4. Validate CSR (optional)
```powershell
openssl req -in csr-AIO_20VD_PG02W5PL.pem -noout -text
```
- Confirms subject and SANs match expectations before calling the enrollment API.

### 5. Persist/Log
- Store CSR content or SHA256 hash plus device ID and timestamp for audit trails.
- Record success/failure in provisioning logs, including the output path.

### Notes
- Requires administrator context or service running as `LOCAL SYSTEM`.
- Script lives at `scripts/create-csr.ps1`. Integrate its logic into the Windows service for zero-touch operation on first boot.
- After CSR is produced, proceed to Step 4 (Certificate Enrollment Service).

