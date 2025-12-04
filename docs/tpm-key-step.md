## Step 2 – TPM Key Creation Playbook

Use this checklist on every device (or in automation) to generate and verify the TPM-bound private key that backs the CSR and certificate.

### 1. Confirm TPM Health
```powershell
tpmtool getdeviceinformation
```
- Ensure `TPM Present: True`, `Is Initialized: True`, and `Ready For Storage: True`.

### 2. Determine the Key Name
- Use the same device ID that will become the certificate CN, e.g. `AIO_<model>_<serial>`.
- Example key/container name: `AIO_20VD_PG02W5PL`.

### 3. Create/Verify the TPM Key (Automation Script)
- Run from an elevated PowerShell session on first boot:
```powershell
Start-Process powershell -Verb RunAs -ArgumentList '-ExecutionPolicy Bypass -File "D:\qsc-3\mithun-package\final-agent-nest\scripts\create-tpm-key.ps1" -DeviceId "<DEVICE_ID>"'
```
- The script uses Microsoft Platform Crypto Provider, creates a machine-level RSA key, and skips creation if it already exists.

### 4. Confirm the Key Exists
- Quick CNG provider check:
```powershell
$provider = New-Object System.Security.Cryptography.CngProvider("Microsoft Platform Crypto Provider")
[System.Security.Cryptography.CngKey]::Exists('<DEVICE_ID>', $provider, [System.Security.Cryptography.CngKeyOpenOptions]::MachineKey)
```
- Returns `True` when the TPM key container is present.

- Optional listing (GUID-based):
```powershell
certutil -csp "Microsoft Platform Crypto Provider" -key
```
- Confirms TPM is storing the key (names appear as GUIDs).

### 5. Persist Metadata for Later Steps
- Store `<DEVICE_ID>` and provider name so Step 3 (CSR) references the same key.
- Log success/failure to local provisioning logs for remote auditing.

### Notes
- All commands require administrator privileges (run service as `LOCAL SYSTEM` or elevate via UAC).
- The PowerShell script resides at `scripts/create-tpm-key.ps1`; embed its logic into the Windows service for full automation.
- After this step completes, move on to CSR generation using the same key container.

