# Boot-Time TPM Key & CSR Generation Flow - Production Best Practices

## Executive Summary

This document describes the **automated boot-time provisioning process** for TPM-backed X.509 certificates in production IoT deployments. The flow ensures devices automatically provision TPM keys and certificates on first boot and regenerate CSRs when needed, with proper administrator privilege handling.

---

## Overview: Boot-Time Provisioning Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    DEVICE BOOT SEQUENCE                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. OS Boot (Windows)                                               │
│  2. Application Service Starts (as Administrator)                   │
│  3. Auto-Provisioning Triggered                                     │
│     ├─ Check TPM Key Exists                                         │
│     ├─ Generate TPM Key (if missing)                                │
│     ├─ Generate CSR (always fresh)                                  │
│     ├─ Submit CSR to Enrollment Backend                             │
│     └─ Store Device Certificate                                     │
│  4. Application Connects to IoT Hub                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Complete Boot-Time Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                   APPLICATION STARTUP (main.ts)                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  bootstrap()                                               │    │
│  │  - Load environment variables (.env)                      │    │
│  │  - Create NestJS application                              │    │
│  │  - Start HTTP server on port 5000                         │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓                                         │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  edgeAssemblyService.initializeAfterAppStart()            │    │
│  │  - Device configuration preparation                        │    │
│  │  - Auto-provisioning workflow                              │    │
│  │  - IoT Hub connection initialization                       │    │
│  └────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ↓
┌─────────────────────────────────────────────────────────────────────┐
│              STEP 1: DEVICE CONFIGURATION PREPARATION               │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  prepareDeviceConfiguration()                              │    │
│  │  - Get device info (UDI framework or system info)          │    │
│  │  - Extract: model, serial, hostname                        │    │
│  │  - Generate deviceId = formatDeviceId('AIO', model, serial)│    │
│  │  - Set default paths if not in environment:                │    │
│  │    • X509_CERT_FILE = certificates/device.pem             │    │
│  │    • CSR_OUTPUT_PATH = csr-{deviceId}.req                 │    │
│  │    • X509_CA_CHAIN_FILE = certificates/device-fullchain.pem│    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓                                         │
│         ✅ Device ID Generated: AIO_20VD_PG02W5PL                   │
│         ✅ Certificate Paths Configured                             │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ↓
┌─────────────────────────────────────────────────────────────────────┐
│            STEP 2: AUTO-PROVISIONING WORKFLOW                       │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  autoProvisionIfNeeded()                                   │    │
│  │  - Check AUTO_ENROLL_ENABLED (default: true)              │    │
│  │  - Verify Windows platform (TPM support)                   │    │
│  │  - Locate PowerShell scripts:                              │    │
│  │    • scripts/create-tpm-key.ps1                           │    │
│  │    • scripts/create-csr.ps1                               │    │
│  └────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ↓
┌─────────────────────────────────────────────────────────────────────┐
│          STEP 3: TPM KEY GENERATION (IF NEEDED)                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  runPowerShellScript('create-tpm-key.ps1')                 │    │
│  │  Arguments: -DeviceId AIO_20VD_PG02W5PL                    │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓                                         │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  ELEVATION CHECK (Administrator Privileges)                │    │
│  │  - Check if process is elevated (admin)                    │    │
│  │  - If NOT elevated:                                        │    │
│  │    ❌ Throw error: "Administrator privileges required"     │    │
│  │  - If elevated:                                            │    │
│  │    ✅ Proceed with TPM key creation                        │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓                                         │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  TPM KEY CREATION (create-tpm-key.ps1)                     │    │
│  │  1. Check if key exists in TPM:                            │    │
│  │     CngKey::Exists(deviceId, "Microsoft Platform Crypto")  │    │
│  │                                                             │    │
│  │  2. If key EXISTS:                                          │    │
│  │     ✅ "TPM key 'deviceId' already exists. Skipping."      │    │
│  │     ⚠️  DO NOT regenerate (preserves device identity)      │    │
│  │                                                             │    │
│  │  3. If key MISSING:                                         │    │
│  │     - Create CngKeyCreationParameters:                      │    │
│  │       • Provider: "Microsoft Platform Crypto Provider"      │    │
│  │       • Algorithm: RSA 2048-bit                             │    │
│  │       • KeyUsage: Signing                                   │    │
│  │       • ExportPolicy: None (non-exportable)                 │    │
│  │       • KeyCreationOptions: MachineKey                      │    │
│  │     - Generate key in TPM hardware                          │    │
│  │     ✅ "Created TPM-backed RSA key container 'deviceId'"    │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓                                         │
│         ✅ TPM Key Ready (Created or Already Exists)                │
│         📍 Storage: TPM Hardware Chip (non-exportable)              │
│         🔑 Key Container Name: AIO_20VD_PG02W5PL                    │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ↓
┌─────────────────────────────────────────────────────────────────────┐
│             STEP 4: CSR GENERATION (ALWAYS FRESH)                   │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  CSR Generation Decision Logic                             │    │
│  │  - Check if CSR file exists: csr-{deviceId}.req            │    │
│  │                                                             │    │
│  │  IF CSR EXISTS:                                             │    │
│  │  ✅ "CSR already present, skipping generation"             │    │
│  │  - Reuse existing CSR for enrollment                       │    │
│  │  - Common scenario: restart without re-enrollment          │    │
│  │                                                             │    │
│  │  IF CSR MISSING:                                            │    │
│  │  🔄 Generate new CSR                                        │    │
│  │  - Common scenarios:                                        │    │
│  │    • First boot (initial provisioning)                      │    │
│  │    • Certificate renewal (old CSR deleted)                  │    │
│  │    • Manual CSR deletion for re-enrollment                  │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓                                         │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  runPowerShellScript('create-csr.ps1')                     │    │
│  │  Arguments:                                                 │    │
│  │  - DeviceId: AIO_20VD_PG02W5PL                             │    │
│  │  - Model: MODEL_NAME                                       │    │
│  │  - Serial: SERIAL_NUMBER                                   │    │
│  │  - OutputPath: csr-AIO_20VD_PG02W5PL.req                   │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓                                         │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  CSR CREATION (create-csr.ps1)                             │    │
│  │  1. Verify TPM key exists:                                 │    │
│  │     CngKey::Exists(deviceId, "Microsoft Platform Crypto")  │    │
│  │     If NOT found: ❌ Error "TPM key not found"             │    │
│  │                                                             │    │
│  │  2. Create temporary INF file for certreq:                  │    │
│  │     [NewRequest]                                            │    │
│  │     Subject = "CN=AIO_20VD_PG02W5PL"                       │    │
│  │     KeyLength = 2048                                        │    │
│  │     MachineKeySet = TRUE                                    │    │
│  │     ProviderName = "Microsoft Platform Crypto Provider"     │    │
│  │     UseExistingKeySet = TRUE                                │    │
│  │     KeyContainer = "AIO_20VD_PG02W5PL"                     │    │
│  │     [Extensions]                                            │    │
│  │     2.5.29.17 = "{text}" # Subject Alternative Name         │    │
│  │     _continue_ = "dns=AIO_20VD_PG02W5PL"                   │    │
│  │     _continue_ = "uri=urn:device:model:MODEL_NAME"         │    │
│  │     _continue_ = "uri=urn:device:serial:SERIAL_NUMBER"     │    │
│  │                                                             │    │
│  │  3. Execute: certreq -new temp.inf output.req              │    │
│  │                                                             │    │
│  │  4. Clean up temporary INF file                             │    │
│  │                                                             │    │
│  │  ✅ "CSR written to csr-AIO_20VD_PG02W5PL.req"             │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓                                         │
│         ✅ CSR Generated (PEM format)                                │
│         📍 Storage: File System (csr-{deviceId}.req)                │
│         🔐 Signed with: TPM Private Key (non-exportable)            │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ↓
┌─────────────────────────────────────────────────────────────────────┐
│           STEP 5: CERTIFICATE ENROLLMENT                            │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  Certificate Existence Check                               │    │
│  │  - Check if device certificate exists:                     │    │
│  │    certificates/device.pem                                 │    │
│  │                                                             │    │
│  │  IF CERTIFICATE EXISTS:                                     │    │
│  │  ✅ "Device certificate already exists. Skipping enrollment"│    │
│  │  - Common scenario: restart after successful enrollment    │    │
│  │  - Jump to Step 6 (IoT Hub connection)                     │    │
│  │                                                             │    │
│  │  IF CERTIFICATE MISSING:                                    │    │
│  │  🔄 Proceed with enrollment                                 │    │
│  │  - Common scenarios:                                        │    │
│  │    • First boot (initial provisioning)                      │    │
│  │    • Certificate renewal (old cert deleted)                 │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓                                         │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  enrollmentService.enrollDeviceCertificate()               │    │
│  │  - Read CSR from: csr-AIO_20VD_PG02W5PL.req                │    │
│  │  - Submit to enrollment backend                             │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓ HTTPS POST                              │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            │ POST /api/enroll
                            │ { deviceId, model, serial, csrPem }
                            │ Authorization: Bearer {token}
                            ↓
┌─────────────────────────────────────────────────────────────────────┐
│               ENROLLMENT BACKEND (Cloud Service)                    │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  1. Authenticate Request                                   │    │
│  │     - Verify Bearer token                                  │    │
│  │     - Check device authorization                           │    │
│  │                                                             │    │
│  │  2. Validate CSR                                            │    │
│  │     - Parse CSR PEM                                        │    │
│  │     - Verify signature (matches TPM public key)            │    │
│  │     - Validate Subject CN matches deviceId                 │    │
│  │     - Check SAN extensions                                 │    │
│  │                                                             │    │
│  │  3. Sign Certificate                                        │    │
│  │     - Sign with Intermediate CA                            │    │
│  │     - Set validity period (30/90/365 days)                 │    │
│  │     - Include extensions:                                   │    │
│  │       • Key Usage: digitalSignature, keyEncipherment       │    │
│  │       • Extended Key Usage: clientAuth                     │    │
│  │       • Subject Alternative Name: DNS:{deviceId}           │    │
│  │                                                             │    │
│  │  4. Return Certificate                                      │    │
│  │     Response: { deviceCertPem, caChainPem }                │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓ HTTPS Response                          │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            │ Response: { deviceCertPem, caChainPem }
                            ↓
┌─────────────────────────────────────────────────────────────────────┐
│            STEP 6: CERTIFICATE STORAGE                              │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  Store Device Certificate                                  │    │
│  │  - Create directory: certificates/ (if missing)            │    │
│  │  - Write: certificates/device.pem (deviceCertPem)          │    │
│  │  - Write: certificates/device-fullchain.pem (caChainPem)   │    │
│  │  - Permissions: 0600 (read/write owner only)               │    │
│  │                                                             │    │
│  │  ⚠️  SECURITY CHECK:                                        │    │
│  │  - If backend returns deviceKeyPem:                         │    │
│  │    ❌ Log security warning                                  │    │
│  │    ❌ DO NOT save key (TPM keys must stay in hardware)      │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓                                         │
│         ✅ Certificate Stored Successfully                           │
│         📍 Certificate: certificates/device.pem                     │
│         📍 CA Chain: certificates/device-fullchain.pem              │
│         🔑 Private Key: TPM Hardware (never saved to disk)          │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            ↓
┌─────────────────────────────────────────────────────────────────────┐
│           STEP 7: IOT HUB CONNECTION                                │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  EdgeAssembly Initialization                               │    │
│  │  - Load configuration from environment                     │    │
│  │  - Set up X.509 authentication:                            │    │
│  │    • Certificate: certificates/device.pem                  │    │
│  │    • Private Key: TPM (via Windows CNG provider)           │    │
│  │  - Initialize connection to IoT Hub                        │    │
│  │  - Start telemetry and messaging                           │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓                                         │
│         ✅ Device Connected to Azure IoT Hub                         │
│         🔐 Authentication: TPM-backed X.509 Certificate             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Administrator Privileges Requirement

### **Why Administrator Access is Required**

```
┌─────────────────────────────────────────────────────────────────────┐
│  TPM Key Operations Require Elevated Privileges                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ✅ REQUIRES ADMIN:                                                 │
│  • TPM key creation (CngKey::Create with MachineKey)              │
│  • Accessing TPM hardware via Microsoft Platform Crypto Provider   │
│  • Writing to TPM key storage (system-level operation)             │
│                                                                     │
│  ❌ NO ADMIN NEEDED:                                                │
│  • CSR generation (uses existing TPM key, read-only)               │
│  • Certificate enrollment (HTTP API call)                           │
│  • Certificate storage (file system write)                          │
│  • IoT Hub connection (uses existing certificate)                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### **Elevation Check Implementation**

**Location:** `src/provisioning/provisioning.utils.ts`

```typescript
async function runPowerShellScript(
  scriptPath: string,
  args: string[],
  logger: LoggerService,
  requiresElevation: boolean = false
): Promise<void> {
  
  if (requiresElevation) {
    logger.warn(
      'TPM key creation requires administrator privileges. ' +
      'Please run this application from an elevated (administrator) PowerShell or Command Prompt.'
    );
    
    // Check if current process is elevated
    const isElevated = await checkIfElevated();
    
    if (!isElevated) {
      throw new Error(
        'Administrator privileges required for TPM operations. ' +
        'Please restart VS Code or this application with "Run as Administrator".'
      );
    }
  }
  
  // Execute PowerShell script
  const child = spawn(
    'powershell.exe',
    ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
    { stdio: 'inherit' }
  );
}
```

**Usage:**
```typescript
// TPM key creation - REQUIRES ADMIN
await runPowerShellScript(
  tpmScriptPath, 
  ['-DeviceId', deviceId], 
  logger, 
  true  // requiresElevation = true
);

// CSR generation - NO ADMIN NEEDED
await runPowerShellScript(
  csrScriptPath,
  ['-DeviceId', deviceId, '-Model', model, '-Serial', serial],
  logger,
  false  // requiresElevation = false
);
```

---

## Boot-Time Behavior Matrix

### **Scenario 1: First Boot (Fresh Device)**

| Resource | Status | Action | Requires Admin |
|----------|--------|--------|----------------|
| TPM Key | ❌ Missing | ✅ Create new TPM key | ✅ YES |
| CSR File | ❌ Missing | ✅ Generate CSR | ❌ NO |
| Certificate | ❌ Missing | ✅ Enroll and store | ❌ NO |
| **Result** | - | 🎉 Device provisioned | - |

**Timeline:**
1. Boot → Check TPM key → NOT FOUND
2. Create TPM key (admin required) → SUCCESS
3. Generate CSR → SUCCESS
4. Submit CSR to backend → SUCCESS
5. Store certificate → SUCCESS
6. Connect to IoT Hub → CONNECTED

---

### **Scenario 2: Restart (Normal Operation)**

| Resource | Status | Action | Requires Admin |
|----------|--------|--------|----------------|
| TPM Key | ✅ Exists | ⏭️ Skip (reuse existing) | ❌ NO |
| CSR File | ✅ Exists | ⏭️ Skip (reuse existing) | ❌ NO |
| Certificate | ✅ Exists | ⏭️ Skip (reuse existing) | ❌ NO |
| **Result** | - | 🚀 Quick startup | - |

**Timeline:**
1. Boot → Check TPM key → FOUND
2. Skip TPM key creation
3. Check CSR file → FOUND
4. Skip CSR generation
5. Check certificate → FOUND
6. Skip enrollment
7. Connect to IoT Hub → CONNECTED

**Performance:** ~2-5 seconds (vs ~30-60 seconds for first boot)

---

### **Scenario 3: Certificate Renewal**

| Resource | Status | Action | Requires Admin |
|----------|--------|--------|----------------|
| TPM Key | ✅ Exists | ⏭️ Skip (reuse same key) | ❌ NO |
| CSR File | ❌ Deleted | ✅ Generate new CSR | ❌ NO |
| Certificate | ❌ Deleted/Expired | ✅ Enroll and store | ❌ NO |
| **Result** | - | 🔄 Certificate renewed | - |

**Timeline:**
1. Boot → Check TPM key → FOUND
2. Skip TPM key creation (reuse existing key)
3. Check CSR file → NOT FOUND
4. Generate new CSR with existing TPM key → SUCCESS
5. Submit CSR to backend → SUCCESS
6. Store new certificate → SUCCESS
7. Connect to IoT Hub → CONNECTED

**Key Point:** ✅ NO ADMIN REQUIRED for renewal (TPM key already exists)

---

### **Scenario 4: Re-enrollment (Manual Intervention)**

| Resource | Status | Action | Requires Admin |
|----------|--------|--------|----------------|
| TPM Key | ✅ Exists | ⏭️ Skip (reuse existing) | ❌ NO |
| CSR File | ❌ Manually deleted | ✅ Generate new CSR | ❌ NO |
| Certificate | ❌ Manually deleted | ✅ Enroll and store | ❌ NO |
| **Result** | - | 🔄 Re-enrolled | - |

**Use Case:** Administrator manually deletes certificate for troubleshooting or security reasons.

---

### **Scenario 5: TPM Key Corruption (Rare)**

| Resource | Status | Action | Requires Admin |
|----------|--------|--------|----------------|
| TPM Key | ❌ Corrupted/Lost | ✅ Regenerate TPM key | ✅ YES |
| CSR File | ✅ Exists (old) | ✅ Generate new CSR | ❌ NO |
| Certificate | ✅ Exists (invalid) | ✅ Re-enroll | ❌ NO |
| **Result** | - | ⚠️ New device identity | - |

**Impact:** ⚠️ Device identity changes (new TPM key = new public key)
**Recovery:** Requires admin access to regenerate TPM key

---

## CSR Storage and Retrieval

### **CSR File Location**

```bash
# Default CSR path (configured automatically)
PROJECT_ROOT/
  ├─ csr-AIO_20VD_PG02W5PL.req    # CSR file (PEM format)
  ├─ certificates/
  │   ├─ device.pem                # Device certificate
  │   └─ device-fullchain.pem      # CA chain
  └─ scripts/
      ├─ create-tpm-key.ps1
      └─ create-csr.ps1
```

**Environment Variable:**
```bash
CSR_OUTPUT_PATH=csr-AIO_20VD_PG02W5PL.req
```

### **CSR Lifecycle**

```
┌─────────────────────────────────────────────────────────────────────┐
│  CSR Lifecycle in Production                                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. GENERATION (First Boot / Renewal)                               │
│     - Generated by: scripts/create-csr.ps1                          │
│     - Format: PEM-encoded PKCS#10 request                           │
│     - Signed with: TPM private key                                  │
│     - Storage: File system (csr-{deviceId}.req)                     │
│                                                                     │
│  2. SUBMISSION (Enrollment)                                         │
│     - Read from: csr-{deviceId}.req                                 │
│     - Submit to: ENROLLMENT_URL/api/enroll                          │
│     - Backend signs CSR → returns certificate                       │
│                                                                     │
│  3. RETENTION (After Enrollment)                                    │
│     - ✅ KEEP: CSR file remains on disk                             │
│     - Purpose: Avoid regeneration on restart                        │
│     - No security risk (public data only)                           │
│                                                                     │
│  4. REGENERATION (When Needed)                                      │
│     - Manual deletion: rm csr-{deviceId}.req                        │
│     - Automatic: Certificate renewal workflow deletes old CSR       │
│     - Next boot: New CSR generated automatically                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### **How to Check CSR**

**PowerShell:**
```powershell
# Check if CSR exists
Test-Path "csr-AIO_20VD_PG02W5PL.req"

# View CSR contents
Get-Content "csr-AIO_20VD_PG02W5PL.req"

# Decode CSR (requires OpenSSL or certutil)
certutil -dump "csr-AIO_20VD_PG02W5PL.req"
```

**TypeScript (Application Logic):**
```typescript
import * as fs from 'fs';
import * as path from 'path';

// Check if CSR exists
const csrPath = path.join(process.cwd(), `csr-${deviceId}.req`);
const csrExists = fs.existsSync(csrPath);

if (csrExists) {
  console.log(`CSR found at ${csrPath}`);
  
  // Read CSR content
  const csrPem = fs.readFileSync(csrPath, 'utf8');
  console.log('CSR Content:', csrPem);
} else {
  console.log('CSR not found - will generate new one');
}
```

---

## CSR Regeneration Triggers

### **When CSR is Regenerated**

| Trigger | Automatic | Manual | Reason |
|---------|----------|--------|--------|
| **First Boot** | ✅ Auto | - | No CSR exists yet |
| **Certificate Renewal** | ✅ Auto | - | Old CSR deleted by renewal workflow |
| **Manual Deletion** | ✅ Auto | ✅ Admin | Troubleshooting or forced re-enrollment |
| **Restart (Normal)** | ❌ Skip | - | CSR already exists, no need to regenerate |
| **TPM Key Regeneration** | ✅ Auto | ✅ Admin | New key requires new CSR |

### **CSR Regeneration Decision Logic**

```typescript
async function autoProvisionIfNeeded(options: AutoProvisionOptions): Promise<void> {
  const { deviceId, model, serial, projectRoot, logger } = options;
  
  // Step 1: TPM Key (always check, create if missing)
  await ensureTpmKeyExists(deviceId, logger);
  
  // Step 2: CSR Generation (check existence)
  const csrPath = path.join(projectRoot, `csr-${deviceId}.req`);
  
  if (!fs.existsSync(csrPath)) {
    // CSR missing - generate new one
    logger.log(`CSR not found at ${csrPath}. Generating via create-csr.ps1`);
    await runPowerShellScript(
      'scripts/create-csr.ps1',
      ['-DeviceId', deviceId, '-Model', model, '-Serial', serial, '-OutputPath', csrPath],
      logger,
      false  // No admin needed
    );
  } else {
    // CSR exists - skip generation
    logger.log(`CSR already present at ${csrPath}, skipping generation.`);
  }
  
  // Step 3: Certificate Enrollment (check existence)
  const certPath = path.join(projectRoot, 'certificates', 'device.pem');
  
  if (!fs.existsSync(certPath)) {
    // Certificate missing - enroll
    logger.log('Device certificate not found. Starting enrollment...');
    await enrollmentService.enrollDeviceCertificate({
      deviceId,
      model,
      serial,
      csrPath,
      certPath,
    });
  } else {
    // Certificate exists - skip enrollment
    logger.log(`Device certificate already exists at ${certPath}.`);
  }
}
```

---

## Production Deployment Recommendations

### **✅ DO: Automated Boot-Time Provisioning**

```yaml
# Recommended Configuration (.env)
AUTO_ENROLL_ENABLED=true           # Enable auto-provisioning
USE_TPM_AUTH=true                  # Use TPM-backed authentication
X509_CERT_FILE=certificates/device.pem
CSR_OUTPUT_PATH=csr-{deviceId}.req
ENROLLMENT_URL=https://cert-service.example.com
ENROLLMENT_TOKEN=your-secure-token
```

**Service Setup (Windows):**
```powershell
# Install application as Windows Service with SYSTEM privileges
# SYSTEM account has administrator privileges for TPM operations

# Option 1: Using NSSM (Non-Sucking Service Manager)
nssm install AIODeviceAgent "C:\Program Files\nodejs\node.exe" "C:\app\dist\main.js"
nssm set AIODeviceAgent AppDirectory "C:\app"
nssm set AIODeviceAgent AppExit Default Restart
nssm set AIODeviceAgent Start SERVICE_AUTO_START
nssm start AIODeviceAgent

# Option 2: Using Windows Task Scheduler
# Create scheduled task with "Run with highest privileges" enabled
schtasks /create /tn "AIODeviceAgent" /tr "node C:\app\dist\main.js" /sc onstart /ru SYSTEM
```

### **✅ DO: Handle Administrator Privileges Gracefully**

**Error Messaging:**
```typescript
try {
  await runPowerShellScript(tpmScriptPath, ['-DeviceId', deviceId], logger, true);
} catch (error) {
  if (error.message.includes('Administrator privileges required')) {
    logger.error(
      '❌ TPM key creation failed: Administrator privileges required.\n' +
      '\n' +
      '🔧 Solutions:\n' +
      '1. Run application as Windows Service (recommended for production)\n' +
      '2. Restart application with "Run as Administrator"\n' +
      '3. Use Task Scheduler with "Run with highest privileges"\n' +
      '\n' +
      '⚠️  Note: Admin access is only needed for initial TPM key creation.\n' +
      '   Subsequent restarts do NOT require elevation.'
    );
    throw error;
  }
}
```

### **✅ DO: Implement Idempotent Provisioning**

```typescript
// Provisioning should be idempotent - safe to run multiple times
// If resources exist, skip creation (no errors)

async function ensureTpmKeyExists(deviceId: string, logger: LoggerService) {
  // Check if key exists
  const keyExists = await checkTpmKeyExists(deviceId);
  
  if (keyExists) {
    logger.log(`✅ TPM key '${deviceId}' already exists. Skipping creation.`);
    return;
  }
  
  // Create key (requires admin)
  logger.log(`Creating TPM key '${deviceId}'...`);
  await createTpmKey(deviceId);
  logger.log(`✅ TPM key '${deviceId}' created successfully.`);
}
```

### **✅ DO: Log Provisioning Steps**

```typescript
// Detailed logging for troubleshooting
logger.log('========================================');
logger.log(' Auto-Provisioning Workflow');
logger.log('========================================');
logger.log(`Device ID: ${deviceId}`);
logger.log(`TPM Key Status: ${tpmKeyExists ? 'EXISTS' : 'CREATING'}`);
logger.log(`CSR Status: ${csrExists ? 'EXISTS' : 'GENERATING'}`);
logger.log(`Certificate Status: ${certExists ? 'EXISTS' : 'ENROLLING'}`);
logger.log('========================================');
```

### **❌ DON'T: Regenerate TPM Keys on Every Boot**

```typescript
// ❌ BAD: Regenerates key on every boot (breaks device identity)
await createTpmKey(deviceId);  // ALWAYS creates new key

// ✅ GOOD: Check existence first
if (!await checkTpmKeyExists(deviceId)) {
  await createTpmKey(deviceId);  // Only create if missing
}
```

### **❌ DON'T: Delete CSR After Enrollment**

```typescript
// ❌ BAD: Deletes CSR after enrollment (forces regeneration on restart)
await enrollmentService.enrollDeviceCertificate({ ... });
fs.unlinkSync(csrPath);  // Don't do this!

// ✅ GOOD: Keep CSR for future restarts (no security risk)
await enrollmentService.enrollDeviceCertificate({ ... });
// CSR remains on disk - used for checking if enrollment needed
```

---

## Boot-Time Performance Optimization

### **Startup Time Comparison**

| Scenario | TPM Key | CSR | Enrollment | Total Time |
|----------|---------|-----|------------|------------|
| **First Boot** | ~10s | ~2s | ~15s | ~30-35s |
| **Normal Restart** | Skip | Skip | Skip | ~2-5s |
| **Certificate Renewal** | Skip | ~2s | ~15s | ~20-25s |

**Optimization Tips:**
1. ✅ Reuse existing resources (TPM key, CSR, certificate)
2. ✅ Parallel checks (TPM key + CSR + certificate in parallel)
3. ✅ Cache device info (UDI framework results)
4. ✅ Skip unnecessary operations (check existence before creation)

---

## Industry Standards Compliance

### **Certificate Management Standards**

| Standard | Requirement | Implementation |
|----------|-------------|----------------|
| **NIST SP 800-57** | Hardware-backed key storage | ✅ TPM 2.0 hardware |
| **FIPS 140-2** | Non-exportable private keys | ✅ TPM ExportPolicy=None |
| **Zero Trust** | Automated certificate lifecycle | ✅ Boot-time provisioning + renewal |
| **ACME Protocol** | Automated enrollment | ✅ REST API enrollment |
| **TPM 2.0 Spec** | Platform Crypto Provider | ✅ Microsoft Platform Crypto Provider |

### **Boot-Time Provisioning Best Practices**

| Practice | Industry Standard | Implementation |
|----------|------------------|----------------|
| **Idempotent Operations** | DevOps best practice | ✅ Check existence before creation |
| **Least Privilege** | Security principle | ✅ Admin only for TPM key creation |
| **Automated Recovery** | High Availability | ✅ Auto-regenerate missing resources |
| **Audit Logging** | Compliance requirement | ✅ Log all provisioning steps |
| **Fail-Fast Validation** | Error handling | ✅ Validate prerequisites early |

---

## Quick Reference Checklist

### **Initial Deployment**
- ☐ Install application as Windows Service (SYSTEM privileges)
- ☐ Configure environment variables (.env)
- ☐ Verify TPM 2.0 hardware available
- ☐ Set AUTO_ENROLL_ENABLED=true
- ☐ Configure ENROLLMENT_URL and ENROLLMENT_TOKEN
- ☐ Test provisioning on one device
- ☐ Deploy to fleet

### **First Boot (Fresh Device)**
- ☐ Application starts with admin privileges
- ☐ TPM key created successfully
- ☐ CSR generated
- ☐ Certificate enrolled and stored
- ☐ IoT Hub connection established
- ☐ Logs show successful provisioning

### **Normal Restart**
- ☐ Application starts (no admin needed)
- ☐ TPM key exists - skipped
- ☐ CSR exists - skipped
- ☐ Certificate exists - skipped
- ☐ IoT Hub connection established
- ☐ Startup time < 5 seconds

### **Certificate Renewal**
- ☐ Old certificate deleted
- ☐ Old CSR deleted
- ☐ Application starts (no admin needed)
- ☐ TPM key reused (not regenerated)
- ☐ New CSR generated with existing key
- ☐ New certificate enrolled
- ☐ IoT Hub reconnected

---

## Troubleshooting Guide

### **Problem: "Administrator privileges required"**

**Cause:** Application not running with elevated privileges

**Solution:**
```powershell
# Option 1: Run as Administrator
Start-Process powershell -Verb runAs
cd C:\app
npm start

# Option 2: Install as Windows Service
nssm install AIODeviceAgent node "C:\app\dist\main.js"
nssm start AIODeviceAgent
```

---

### **Problem: "TPM key not found"**

**Cause:** TPM key creation failed or was deleted

**Solution:**
```powershell
# Verify TPM is available
Get-Tpm

# Manually create TPM key
.\scripts\create-tpm-key.ps1 -DeviceId "AIO_20VD_PG02W5PL"

# Restart application
```

---

### **Problem: "CSR signature verification failed"**

**Cause:** CSR was generated with wrong TPM key

**Solution:**
```powershell
# Delete old CSR
Remove-Item "csr-*.req"

# Verify TPM key exists
.\scripts\create-tpm-key.ps1 -DeviceId "AIO_20VD_PG02W5PL"

# Regenerate CSR with correct key
.\scripts\create-csr.ps1 -DeviceId "AIO_20VD_PG02W5PL" -Model "MODEL" -Serial "SERIAL"

# Restart application
```

---

## Conclusion

**Boot-time provisioning is critical for production IoT deployments** because:
- ✅ **Zero-Touch Deployment**: Devices self-provision without manual intervention
- ✅ **Idempotent**: Safe to run on every boot, only provisions what's missing
- ✅ **Hardware Security**: TPM keys never leave hardware
- ✅ **Automated Recovery**: Regenerates missing resources automatically
- ✅ **Performance**: Restarts are fast (< 5s) when resources exist

**Key Takeaways:**
1. **TPM keys**: Generated once, reused forever (requires admin only on first boot)
2. **CSR files**: Generated on-demand, kept for restart efficiency
3. **Certificates**: Enrolled once, renewed automatically when needed
4. **Administrator privileges**: Required only for initial TPM key creation

> "Provision once, restart many times, renew automatically."

By following this flow, your IoT fleet will have **secure, automated, and resilient** certificate provisioning that works reliably in production environments.
