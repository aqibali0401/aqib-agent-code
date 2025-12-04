# Certificate Renewal Flow - Production Best Practices

## Executive Summary

This document describes the **automated certificate renewal process** for TPM-backed X.509 certificates in production IoT deployments. The flow ensures devices maintain valid certificates without service interruption.

---

## Certificate Lifecycle Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Certificate Lifecycle (Example: 30 days validity)              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Day 0:    Certificate Issued                                   │
│ Day 1-22:  Normal Operation (0-75% of lifetime)                │
│ Day 23:    ⚠️  Renewal Window Opens (75% of lifetime)          │
│ Day 27:    ⚠️  Renewal Recommended (90% of lifetime)           │
│ Day 29:    🔴 Renewal Critical (96% of lifetime)               │
│ Day 30:    ❌ Certificate Expires                              │
│                                                                 │
│ Common Validity Periods:                                       │
│ • 30 days  - High security / Automated environments            │
│ • 90 days  - Standard automated renewal (Let's Encrypt)        │
│ • 365 days - Traditional enterprise PKI                        │
└─────────────────────────────────────────────────────────────────┘
```

**Industry Standard Renewal Triggers:**
- ✅ **Recommended**: Renew at 75% of certificate lifetime (Day 23 for 30-day cert)
- ⚠️ **Critical**: Must renew by 90% of lifetime (Day 27 for 30-day cert)
- 🔴 **Emergency**: Renew immediately if past 96% (Day 29 for 30-day cert)

---

## Complete Renewal Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          DEVICE (AIO Bar)                           │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  1. Certificate Monitoring Service                         │    │
│  │     - Runs daily (or on boot)                              │    │
│  │     - Checks certificate expiry date                       │    │
│  │     - Triggers renewal if needed                           │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓                                         │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  2. Renewal Decision Logic                                 │    │
│  │     - Parse device.pem                                     │    │
│  │     - Extract expiry date (notAfter)                       │    │
│  │     - Calculate days remaining                             │    │
│  │     - Check if < 25% lifetime remaining                    │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓                                         │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  3. Generate New CSR (TPM-backed)                          │    │
│  │     - REUSE existing TPM key (do NOT regenerate)           │    │
│  │     - Create new CSR with same key                         │    │
│  │     - Include device metadata (model, serial)              │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓ HTTPS POST                              │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            │ POST /api/certificate/renew
                            │ { deviceId, csrPem, reason: "renewal" }
                            ↓
┌─────────────────────────────────────────────────────────────────────┐
│                   ENROLLMENT BACKEND (Cloud)                        │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  4. Validate Renewal Request                               │    │
│  │     - Authenticate device (Bearer token or mTLS)           │    │
│  │     - Verify CSR signature matches existing cert           │    │
│  │     - Check device is authorized for renewal               │    │
│  │     - Validate CSR fields (deviceId, model, serial)        │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓                                         │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  5. Sign New Certificate                                   │    │
│  │     - Sign CSR with Intermediate CA                        │    │
│  │     - Set new validity period (365 days)                   │    │
│  │     - Same Subject DN as old certificate                   │    │
│  │     - Increment serial number                              │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓                                         │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  6. Revoke Old Certificate (Optional)                      │    │
│  │     - Add old cert to CRL (Certificate Revocation List)    │    │
│  │     - Update OCSP responder                                │    │
│  │     - Grace period: 24-48 hours overlap                    │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓ HTTPS Response                          │
└─────────────────────────────────────────────────────────────────────┘
                            │
                            │ Response: { deviceCertPem, caChainPem }
                            ↓
┌─────────────────────────────────────────────────────────────────────┐
│                          DEVICE (AIO Bar)                           │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  7. Atomic Certificate Replacement                         │    │
│  │     - Backup old device.pem → device.pem.bak              │    │
│  │     - Write new certificate to device.pem.new             │    │
│  │     - Atomic rename: device.pem.new → device.pem          │    │
│  │     - Update CA chain if changed                          │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓                                         │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  8. Connection Refresh                                     │    │
│  │     - Disconnect from IoT Hub gracefully                   │    │
│  │     - Reload certificate from disk                         │    │
│  │     - Reconnect with new certificate                       │    │
│  │     - Verify connection successful                         │    │
│  └────────────────────────────────────────────────────────────┘    │
│                           ↓                                         │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  9. Verification & Logging                                 │    │
│  │     - Verify new certificate is active                     │    │
│  │     - Log renewal success (timestamp, new expiry)          │    │
│  │     - Send telemetry to IoT Hub                           │    │
│  │     - Delete backup after 7 days                          │    │
│  └────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Implementation Steps

### **Step 1: Certificate Monitoring Service**

**Trigger Options:**
1. **Scheduled Check** (Recommended)
   - Run daily at low-traffic time (e.g., 3 AM local)
   - Lightweight operation (~100ms)
   - Consistent monitoring

2. **On-Boot Check**
   - Check every time device restarts
   - Catches long-offline devices
   - Immediate action if critical

3. **Periodic Background Task**
   - Every 24 hours while running
   - Part of health check routine

**Implementation:**
```typescript
// Certificate monitor service
class CertificateRenewalService {
  private renewalCheckInterval = 24 * 60 * 60 * 1000; // 24 hours
  
  async startMonitoring() {
    // Check on startup
    await this.checkAndRenewIfNeeded();
    
    // Schedule periodic checks
    setInterval(() => {
      this.checkAndRenewIfNeeded();
    }, this.renewalCheckInterval);
  }
}
```

---

### **Step 2: Renewal Decision Logic**

**Check Certificate Expiry:**
```typescript
async checkCertificateExpiry(): Promise<RenewalStatus> {
  // Read certificate
  const certPem = fs.readFileSync('certificates/device.pem', 'utf8');
  const cert = forge.pki.certificateFromPem(certPem);
  
  // Parse dates
  const now = new Date();
  const notBefore = cert.validity.notBefore;
  const notAfter = cert.validity.notAfter;
  
  // Calculate lifetime
  const totalLifetimeMs = notAfter.getTime() - notBefore.getTime();
  const remainingMs = notAfter.getTime() - now.getTime();
  const remainingDays = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
  const percentRemaining = (remainingMs / totalLifetimeMs) * 100;
  
  // Example with 30-day cert:
  // Day 23: percentRemaining = 23.3%, shouldRenew = true
  // Day 27: percentRemaining = 10%, isCritical = true
  // Day 29: percentRemaining = 3.3%, emergency!
  
  return {
    expiryDate: notAfter,
    daysRemaining: remainingDays,
    percentRemaining,
    shouldRenew: percentRemaining < 25, // Renew at 75% lifetime (Day 23 for 30-day)
    isExpired: remainingMs <= 0,
    isCritical: percentRemaining < 10, // Critical if < 10% remaining (Day 27)
  };
}
```

**Renewal Thresholds:**
```typescript
const RENEWAL_THRESHOLDS = {
  RECOMMENDED: 25,  // Start renewal when 25% lifetime remaining (75% elapsed)
  CRITICAL: 10,     // Critical - must renew ASAP
  EMERGENCY: 4,     // Emergency - < 96% lifetime used
};

function shouldRenew(status: RenewalStatus): boolean {
  return status.percentRemaining < RENEWAL_THRESHOLDS.RECOMMENDED;
}

function isCriticalRenewal(status: RenewalStatus): boolean {
  return status.percentRemaining < RENEWAL_THRESHOLDS.CRITICAL;
}
```

---

### **Step 3: Generate New CSR with Existing TPM Key**

**🔴 CRITICAL: Reuse Existing TPM Key**

```powershell
# DO NOT regenerate key - reuse existing TPM key!
# The same private key is used for renewal

# Get existing key container name (same as deviceId)
$keyContainer = $env:TPM_KEY_CONTAINER  # e.g., "AIO_20VD_PG02W5PL"

# Verify key exists in TPM
$keyExists = Get-ChildItem Cert:\LocalMachine\My | 
             Where-Object { $_.Subject -like "*$keyContainer*" }

if (-not $keyExists) {
    throw "TPM key not found: $keyContainer"
}

# Generate NEW CSR using EXISTING key
certreq -new renewal-request.inf renewal-csr.req

# renewal-request.inf (use existing key):
[NewRequest]
Subject = "CN=$keyContainer"
KeyLength = 2048
KeyUsage = 0xa0
Exportable = FALSE
MachineKeySet = TRUE
ProviderName = "Microsoft Platform Crypto Provider"

# ⚠️ Key parameter: Use existing key by name
UseExistingKeySet = TRUE
KeyContainer = $keyContainer

[Extensions]
2.5.29.17 = "{text}"  # Subject Alternative Name
_continue_ = "DNS=$keyContainer&"
```

**TypeScript Implementation:**
```typescript
async generateRenewalCSR(deviceId: string): Promise<string> {
  // Verify existing TPM key
  const keyExists = await this.verifyTpmKey(deviceId);
  if (!keyExists) {
    throw new Error(`TPM key not found for device: ${deviceId}`);
  }
  
  // Generate CSR with existing key
  const csrScript = `
    $infFile = @"
[NewRequest]
Subject = "CN=${deviceId}"
KeyLength = 2048
Exportable = FALSE
UseExistingKeySet = TRUE
KeyContainer = ${deviceId}
ProviderName = "Microsoft Platform Crypto Provider"
"@
    
    $infFile | Out-File -FilePath renewal.inf
    certreq -new renewal.inf renewal.req
    Get-Content renewal.req -Raw
  `;
  
  const result = execSync(`powershell -Command "${csrScript}"`, { encoding: 'utf8' });
  return result.trim();
}
```

---

### **Step 4: Submit Renewal Request to Backend**

**API Endpoint: `/api/certificate/renew`**

**Request Format:**
```typescript
interface CertificateRenewalRequest {
  deviceId: string;           // Device identifier
  csrPem: string;            // New CSR (PEM format)
  currentCertSerial: string; // Serial number of current cert
  reason: 'renewal' | 'emergency' | 'revoked';
  deviceMetadata: {
    model: string;
    serial: string;
    firmwareVersion: string;
  };
}
```

**Request Example:**
```typescript
async requestCertificateRenewal(): Promise<RenewalResponse> {
  // Generate new CSR
  const csrPem = await this.generateRenewalCSR(this.deviceId);
  
  // Get current certificate info
  const currentCert = await this.getCurrentCertificate();
  
  // Submit renewal request
  const response = await fetch(`${ENROLLMENT_API_URL}/api/certificate/renew`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ENROLLMENT_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      deviceId: this.deviceId,
      csrPem,
      currentCertSerial: currentCert.serialNumber,
      reason: 'renewal',
      deviceMetadata: {
        model: this.deviceModel,
        serial: this.deviceSerial,
        firmwareVersion: process.env.APP_VERSION,
      },
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Renewal failed: ${response.statusText}`);
  }
  
  return await response.json();
}
```

---

### **Step 5: Backend Validation & Signing**

**Backend Validation Checks:**

```typescript
// On enrollment backend
async validateRenewalRequest(request: CertificateRenewalRequest): Promise<boolean> {
  // 1. Authenticate device
  const isAuthenticated = await this.authenticateDevice(request.deviceId);
  if (!isAuthenticated) {
    throw new Error('Device authentication failed');
  }
  
  // 2. Verify CSR signature matches existing certificate public key
  const currentCert = await this.getCertificateByDeviceId(request.deviceId);
  const csrPublicKey = extractPublicKeyFromCSR(request.csrPem);
  const certPublicKey = extractPublicKeyFromCert(currentCert);
  
  if (!publicKeysMatch(csrPublicKey, certPublicKey)) {
    throw new Error('CSR public key does not match existing certificate');
  }
  
  // 3. Verify device is not revoked
  const isRevoked = await this.isDeviceRevoked(request.deviceId);
  if (isRevoked) {
    throw new Error('Device certificate has been revoked');
  }
  
  // 4. Validate CSR fields
  const csrSubject = extractSubjectFromCSR(request.csrPem);
  if (csrSubject.CN !== request.deviceId) {
    throw new Error('CSR subject does not match deviceId');
  }
  
  return true;
}
```

**Sign New Certificate:**
```typescript
async signRenewalCertificate(csrPem: string, deviceId: string): Promise<string> {
  // Sign with Intermediate CA
  const newCert = await this.caService.signCertificate({
    csr: csrPem,
    validityDays: 30,                     // 30 days validity (configurable: 30, 90, 365)
    extensions: {
      keyUsage: ['digitalSignature', 'keyEncipherment'],
      extendedKeyUsage: ['clientAuth'],
      subjectAltName: [`DNS:${deviceId}`],
    },
  });
  
  // Log renewal for audit trail
  await this.auditLog.log({
    event: 'certificate_renewed',
    deviceId,
    oldCertSerial: currentCert.serialNumber,
    newCertSerial: newCert.serialNumber,
    timestamp: new Date(),
  });
  
  return newCert.pem;
}
```

---

### **Step 6: Certificate Revocation (Optional)**

**Grace Period Strategy:**

```typescript
// Backend: Delayed revocation of old certificate
async scheduleOldCertificateRevocation(
  oldCertSerial: string,
  gracePeriodHours: number = 24  // 24 hours for 30-day certs
) {
  // Schedule revocation after grace period
  const revokeAt = new Date(Date.now() + gracePeriodHours * 60 * 60 * 1000);
  
  await this.revocationScheduler.schedule({
    certSerial: oldCertSerial,
    revokeAt,
    reason: 'superseded', // RFC 5280 revocation reason
  });
  
  // During grace period, both old and new certs are valid
  // This allows for smooth transition without service interruption
  
  // Grace period recommendations by certificate lifetime:
  // • 30 days validity  → 12-24 hour grace period
  // • 90 days validity  → 24-48 hour grace period
  // • 365 days validity → 48-72 hour grace period
}
```

**Why Grace Period?**
- ✅ Allows devices time to update
- ✅ Handles network failures gracefully
- ✅ Prevents service interruption
- ✅ Scaled to certificate lifetime (shorter certs = shorter grace period)

---

### **Step 7: Atomic Certificate Replacement**

**Safe File Update Strategy:**

```typescript
async replaceDeviceCertificate(newCertPem: string): Promise<void> {
  const certPath = 'certificates/device.pem';
  const backupPath = `${certPath}.bak`;
  const tempPath = `${certPath}.new`;
  
  try {
    // 1. Backup current certificate
    if (fs.existsSync(certPath)) {
      fs.copyFileSync(certPath, backupPath);
      this.logger.log(`Certificate backed up to ${backupPath}`);
    }
    
    // 2. Write new certificate to temp file
    fs.writeFileSync(tempPath, newCertPem, { mode: 0o600 }); // Secure permissions
    
    // 3. Verify new certificate is valid
    await this.verifyCertificate(tempPath);
    
    // 4. Atomic rename (OS-level atomic operation)
    fs.renameSync(tempPath, certPath);
    
    this.logger.log('Certificate replaced successfully');
    
    // 5. Schedule backup cleanup (keep for 7 days)
    setTimeout(() => {
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
        this.logger.log('Certificate backup deleted');
      }
    }, 7 * 24 * 60 * 60 * 1000); // 7 days
    
  } catch (error) {
    // Rollback on failure
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, certPath);
      this.logger.error('Certificate replacement failed - rolled back');
    }
    throw error;
  }
}
```

---

### **Step 8: Connection Refresh**

**Graceful Reconnection:**

```typescript
async refreshConnectionWithNewCertificate(): Promise<void> {
  try {
    // 1. Disconnect gracefully
    this.logger.log('Disconnecting for certificate renewal...');
    await this.edgeAssemblyService.disconnect();
    
    // 2. Wait for clean shutdown
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 3. Reload certificate from disk (new cert is now in place)
    this.logger.log('Reloading certificate configuration...');
    
    // 4. Reconnect with new certificate
    this.logger.log('Reconnecting with renewed certificate...');
    await this.edgeAssemblyService.initializeAfterAppStart();
    
    // 5. Verify connection
    const isConnected = await this.edgeAssemblyService.checkConnection();
    if (!isConnected) {
      throw new Error('Failed to reconnect after certificate renewal');
    }
    
    this.logger.log('✅ Certificate renewal complete - device reconnected');
    
    // 6. Send telemetry about renewal
    await this.sendRenewalTelemetry();
    
  } catch (error) {
    this.logger.error('Certificate renewal connection refresh failed:', error);
    // Rollback strategy if reconnection fails
    await this.rollbackCertificate();
    throw error;
  }
}
```

---

### **Step 9: Verification & Telemetry**

**Post-Renewal Verification:**

```typescript
async verifyRenewalSuccess(): Promise<RenewalVerification> {
  // 1. Read new certificate
  const certPem = fs.readFileSync('certificates/device.pem', 'utf8');
  const cert = forge.pki.certificateFromPem(certPem);
  
  // 2. Verify certificate properties
  const verification = {
    isValid: true,
    newExpiryDate: cert.validity.notAfter,
    daysUntilExpiry: this.calculateDaysUntilExpiry(cert.validity.notAfter),
    serialNumber: cert.serialNumber,
    issuer: cert.issuer.getField('CN').value,
    subject: cert.subject.getField('CN').value,
  };
  
  // 3. Verify connection is using new certificate
  const connStatus = await this.edgeAssemblyService.getCtrlStatus();
  if (!connStatus) {
    verification.isValid = false;
  }
  
  return verification;
}

async sendRenewalTelemetry(): Promise<void> {
  const verification = await this.verifyRenewalSuccess();
  
  await this.edgeAssemblyService.sendTelemetry('certificateRenewed', {
    eventType: 'certificate_renewal',
    deviceId: this.deviceId,
    timestamp: new Date().toISOString(),
    newExpiryDate: verification.newExpiryDate,
    daysUntilExpiry: verification.daysUntilExpiry,
    serialNumber: verification.serialNumber,
    renewalSuccess: verification.isValid,
  });
}
```

---

## Error Handling & Rollback Strategy

### **Failure Scenarios & Recovery**

```typescript
class CertificateRenewalService {
  async performRenewal(): Promise<void> {
    let backupCreated = false;
    
    try {
      // Step 1: Check expiry
      const status = await this.checkCertificateExpiry();
      if (!status.shouldRenew) {
        return; // No renewal needed
      }
      
      // Step 2: Generate CSR
      const csrPem = await this.generateRenewalCSR(this.deviceId);
      
      // Step 3: Request new certificate
      const response = await this.requestCertificateRenewal(csrPem);
      
      // Step 4: Backup current certificate
      await this.backupCurrentCertificate();
      backupCreated = true;
      
      // Step 5: Replace certificate (atomic)
      await this.replaceDeviceCertificate(response.deviceCertPem);
      
      // Step 6: Reconnect
      await this.refreshConnectionWithNewCertificate();
      
      // Step 7: Verify
      await this.verifyRenewalSuccess();
      
    } catch (error) {
      this.logger.error('Certificate renewal failed:', error);
      
      // Rollback if backup exists
      if (backupCreated) {
        await this.rollbackCertificate();
      }
      
      // Retry logic
      await this.scheduleRetry(error);
    }
  }
  
  async scheduleRetry(error: Error): Promise<void> {
    const retryDelays = [
      5 * 60 * 1000,      // 5 minutes
      30 * 60 * 1000,     // 30 minutes
      60 * 60 * 1000,     // 1 hour
      6 * 60 * 60 * 1000, // 6 hours
    ];
    
    for (const delay of retryDelays) {
      await new Promise(resolve => setTimeout(resolve, delay));
      
      try {
        await this.performRenewal();
        return; // Success
      } catch (retryError) {
        this.logger.warn(`Retry failed: ${retryError.message}`);
      }
    }
    
    // All retries failed - alert
    await this.sendCriticalAlert('Certificate renewal failed after all retries');
  }
}
```

---

## Production Deployment Configuration

### **Environment Variables**

```bash
# Certificate Renewal Settings
CERT_RENEWAL_ENABLED=true
CERT_RENEWAL_CHECK_INTERVAL_HOURS=12   # Check twice daily for 30-day certs
CERT_RENEWAL_THRESHOLD_PERCENT=25      # Renew at 75% lifetime (Day 23 for 30-day)
CERT_RENEWAL_CRITICAL_PERCENT=10       # Critical alert threshold (Day 27)
CERT_RENEWAL_GRACE_PERIOD_HOURS=24     # Old cert revocation delay (24h for 30-day)

# Certificate Validity Configuration
CERT_VALIDITY_DAYS=30                  # Certificate lifetime (30, 90, or 365 days)

# Backend Configuration
ENROLLMENT_API_URL=https://cert-service.example.com
ENROLLMENT_API_TOKEN=your-bearer-token
CERT_RENEWAL_RETRY_DELAYS=5,30,60,360  # Minutes

# Certificate Paths
X509_CERT_FILE=certificates/device.pem
X509_CERT_BACKUP_RETENTION_DAYS=7
```

---

## Monitoring & Alerts

### **Metrics to Track**

```typescript
interface CertificateMetrics {
  // Certificate Health
  daysUntilExpiry: number;
  percentLifetimeRemaining: number;
  isExpired: boolean;
  
  // Renewal Status
  lastRenewalAttempt: Date;
  lastRenewalSuccess: Date;
  renewalFailureCount: number;
  
  // Operational
  renewalDurationMs: number;
  reconnectionDurationMs: number;
}
```

### **Alert Thresholds**

```typescript
// Alert thresholds for 30-day certificate validity
const ALERT_THRESHOLDS = {
  WARNING: {
    daysRemaining: 8,         // ~8 days warning (25% remaining)
    percentRemaining: 25,     // 25% lifetime remaining
  },
  CRITICAL: {
    daysRemaining: 3,         // ~3 days critical (10% remaining)
    percentRemaining: 10,     // 10% lifetime remaining
  },
  EMERGENCY: {
    daysRemaining: 1,         // ~1 day emergency (3% remaining)
    percentRemaining: 3,      // 3% lifetime remaining
  },
};

// For different certificate lifetimes, scale thresholds proportionally:
// • 30-day cert:  Warning at Day 8,  Critical at Day 3,  Emergency at Day 1
// • 90-day cert:  Warning at Day 23, Critical at Day 9,  Emergency at Day 3
// • 365-day cert: Warning at Day 91, Critical at Day 37, Emergency at Day 11

async sendAlertIfNeeded(status: RenewalStatus): Promise<void> {
  if (status.daysRemaining <= ALERT_THRESHOLDS.EMERGENCY.daysRemaining) {
    await this.sendAlert('EMERGENCY', `Certificate expires in ${status.daysRemaining} days!`);
  } else if (status.daysRemaining <= ALERT_THRESHOLDS.CRITICAL.daysRemaining) {
    await this.sendAlert('CRITICAL', `Certificate expires in ${status.daysRemaining} days`);
  } else if (status.daysRemaining <= ALERT_THRESHOLDS.WARNING.daysRemaining) {
    await this.sendAlert('WARNING', `Certificate expires in ${status.daysRemaining} days`);
  }
}
```

---

## Best Practices Summary

### **✅ DO**

1. **Start Renewal Early**
   - Begin at 75% of certificate lifetime
   - Allow time for retries and failures
   - Avoid last-minute emergencies

2. **Reuse TPM Keys**
   - Never regenerate TPM key during renewal
   - Same key = same security properties
   - Maintains device identity

3. **Implement Grace Periods**
   - 24-48 hour overlap for old/new certs
   - Allows smooth transition
   - Handles network failures

4. **Atomic Operations**
   - Use atomic file operations
   - Always create backups
   - Implement rollback logic

5. **Monitor & Alert**
   - Track certificate expiry dates
   - Set multiple alert thresholds
   - Log all renewal attempts

### **❌ DON'T**

1. **Don't Wait Until Expiry**
   - Renewal at 95%+ is too late
   - Network issues can prevent renewal
   - Always renew with buffer time

2. **Don't Regenerate TPM Keys**
   - Breaks device identity
   - Requires DPS re-enrollment
   - Unnecessary security risk

3. **Don't Revoke Immediately**
   - Give grace period for transition
   - Prevents service interruption
   - Standard industry practice

4. **Don't Ignore Failures**
   - Implement retry logic
   - Alert operations team
   - Have manual fallback process

5. **Don't Skip Verification**
   - Always verify new certificate
   - Test connection after renewal
   - Send success/failure telemetry

---

## Industry Standards Reference

### **Certificate Lifetime Standards**

| Organization | Recommendation | Validity Period | Renewal Frequency |
|--------------|----------------|-----------------|-------------------|
| **High Security IoT** | **30 days** | Short-lived certs | **Day 23** (75% lifetime) |
| **Zero Trust / Let's Encrypt** | 90 days | Automated renewal | Day 68 (75% lifetime) |
| **CA/Browser Forum** | Max 398 days (13 months) | Public TLS certs | Day 299 (75% lifetime) |
| **Industry IoT (Standard)** | 365 days (1 year) | Traditional PKI | Day 274 (75% lifetime) |
| **NIST SP 800-57** | 1-3 years for device certs | Government standard | 75% of lifetime |

**Trend: Shorter certificate lifetimes are becoming the standard** for automated IoT deployments due to:
- ✅ Reduced attack window if key is compromised
- ✅ Forced automation of certificate management
- ✅ Better security posture (principle of least privilege)

### **Renewal Timing Standards**

| Standard | Renewal Threshold | Example (30-day cert) | Source |
|----------|------------------|----------------------|----------|
| **ACME Protocol** | 30 days before expiry | Day 0 (immediate for 30-day) | RFC 8555 |
| **Let's Encrypt** | 66% of lifetime | Day 20 (66% of 30 days) | Industry practice |
| **Enterprise PKI** | 25% lifetime remaining | Day 23 (75% elapsed) | NIST recommendation |
| **IoT Best Practice** | 75% lifetime elapsed | **Day 23** | Microsoft/AWS/Google |

**Recommendation for 30-Day Certificates:**
- 🟢 **Optimal**: Renew on **Day 22-23** (75% lifetime elapsed)
- 🟡 **Acceptable**: Renew on **Day 20** (66% lifetime elapsed)  
- 🔴 **Too Late**: Renew on **Day 27+** (< 10% remaining)
- ❌ **Critical**: Day 29+ (emergency renewal required)

---

## Quick Reference Checklist

### **Pre-Renewal**
- ☐ Monitor certificate expiry daily
- ☐ Alert when < 25% lifetime remaining
- ☐ Verify TPM key exists and accessible
- ☐ Confirm backend API is reachable

### **During Renewal**
- ☐ Generate CSR with existing TPM key
- ☐ Submit CSR to enrollment backend
- ☐ Backup current certificate
- ☐ Replace certificate atomically
- ☐ Reconnect to IoT Hub

### **Post-Renewal**
- ☐ Verify new certificate is active
- ☐ Check connection status
- ☐ Send success telemetry
- ☐ Schedule old cert revocation
- ☐ Delete backup after retention period

---

## Conclusion

**Certificate renewal is a critical operational process** that requires:
- ✅ Automated monitoring
- ✅ Early renewal timing (75% lifetime)
- ✅ Robust error handling
- ✅ Graceful fallback strategies
- ✅ Comprehensive logging and alerting

**Key Takeaway:**
> "Renew early, renew often, and always have a rollback plan."

By following this flow, your IoT fleet will maintain continuous connectivity with hardware-backed security and zero service interruption.
