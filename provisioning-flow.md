## TPM-Backed X.509 Provisioning Flow

### 1. First Boot → Windows Service Starts
- Device powers on at customer site.
- Pre-installed Windows service launches automatically.

### 2. Generate TPM Private Key
- Service requests a key pair via Windows CNG/CAPI bound to the TPM.
- Key is non-exportable and hardware protected; it never leaves the TPM silicon.

#### 2.1 Prerequisites
- TPM is provisioned/owned (check via `tpmtool getdeviceinformation` or `tpm.msc`).
- Windows service runs under an account with permission to create machine keys (usually `LOCAL SYSTEM`).
- .NET 6+ runtime installed if you use the sample below.

#### 2.2 Implementation Steps (C# Service)
1. Reference `System.Security.Cryptography` (`CngKey` APIs).
2. Target the Microsoft Platform Crypto Provider so the TPM generates/holds the key.
3. Create a persisted machine key so it survives reboots and is discoverable by CertEnroll later.
4. Store the key name (a GUID or hardware-serial-based string) for CSR and cert install steps.

```csharp
using System.Security.Cryptography;

const string KeyName = "device-id-key";
var provider = new CngProvider("Microsoft Platform Crypto Provider");
var options = new CngKeyCreationParameters
{
    Provider = provider,
    KeyUsage = CngKeyUsages.Signing,
    ExportPolicy = CngExportPolicies.None,      // keep non-exportable
    KeyCreationOptions = CngKeyCreationOptions.MachineKey
};

if (!CngKey.Exists(KeyName, provider, CngKeyOpenOptions.MachineKey))
{
    using var key = CngKey.Create(CngAlgorithm.Rsa, KeyName, options);
    // key now lives inside TPM; persist the container name for later use
}
```

#### 2.3 How the Service Uses the Key
- Later CSR generation (step 3) references the same `KeyName` and provider, so CertEnroll binds to the TPM key.
- When the signed certificate is installed (step 6), Windows associates it with the TPM-held key container automatically.

#### 2.4 Verification & Troubleshooting
- List keys: `certutil -csp "Microsoft Platform Crypto Provider" -key`.
- Confirm key is non-exportable: `certutil -repairstore my <thumbprint>` should not expose raw key material.
- If the TPM is not ready, prompt remediation (clear, enable, or ownership provisioning) before continuing the flow.

### 3. Build CSR From TPM Key
- CSR must be signed by the TPM-backed private key created in step 2.
- Subject CN should match the device ID (e.g., `AIO_<model>_<serial>`).
- SAN entries carry extra device metadata for backend checks.

#### 3.1 Prerequisites
- TPM key container exists (`CngKey.Exists(...)` returns true).
- Device identity info is available (model, serial, SKU, etc.).
- Windows CertEnroll COM components are available (default on Windows 10/11/Server).

#### 3.2 CSR Generation Flow
1. Initialize a `CX509PrivateKey` object that points to the TPM key:
   - `ProviderName = "Microsoft Platform Crypto Provider"`
   - `ContainerName = <DeviceId>`
   - `KeySpec = XCN_AT_KEYEXCHANGE` or `XCN_AT_SIGNATURE` (match key usage)
2. Build the subject with `CX500DistinguishedName`.
3. Attach SAN extensions (e.g., device serial, model, manufacturer) via `IX509ExtensionAlternativeNames`.
4. Use `CX509CertificateRequestPkcs10` to build and encode the CSR.

```csharp
using CERTENROLLLib;

var deviceId = "AIO_20VD_PG02W5PL";
var dn = new CX500DistinguishedName();
dn.Encode($"CN={deviceId}", X500NameFlags.XCN_CERT_NAME_STR);

var privateKey = new CX509PrivateKey
{
    ProviderName = "Microsoft Platform Crypto Provider",
    ContainerName = deviceId,
    KeySpec = X509KeySpec.XCN_AT_SIGNATURE,
    MachineContext = true
};
privateKey.Open();

var san = new CAlternativeNames();
san.Add(new CAlternativeName { AlternativeNameType = AlternativeNameType.XCN_CERT_ALT_NAME_DNS_NAME, strValue = deviceId });
san.Add(new CAlternativeName { AlternativeNameType = AlternativeNameType.XCN_CERT_ALT_NAME_OTHER_NAME, 
    strValue = "model=20VD;serial=PG02W5PL" });
var sanExtension = new CX509ExtensionAlternativeNames();
sanExtension.InitializeEncode(san);

var request = new CX509CertificateRequestPkcs10();
request.InitializeFromPrivateKey(X509CertificateEnrollmentContext.ContextMachine, privateKey, "");
request.Subject = dn;
request.X509Extensions.Add((CX509Extension)sanExtension);
request.Encode();

var enroll = new CX509Enrollment();
enroll.InitializeFromRequest(request);
var csrPem = enroll.CreateRequest(EncodingType.XCN_CRYPT_STRING_BASE64);
```

#### 3.3 Output Handling
- Convert the base64 CSR to PEM (`-----BEGIN CERTIFICATE REQUEST-----`) before sending to the enrollment service.
- Persist the CSR, metadata hash, and timestamp for troubleshooting.

#### 3.4 Verification
- `certreq -new request.inf csr.req` (optional alternative) can be used for manual testing; ensure `ProviderName` is set to the Platform Crypto Provider in the INF.
- Use `openssl req -text -noout -verify -in csr.pem` to confirm subject and SANs before uploading.

### 4. Call Certificate Enrollment Service
- Device contacts your controlled enrollment endpoint (EST/SCEP/ACME/Vault/Custom API).
- CA signing key resides in Azure Key Vault Managed HSM.
- Device authenticates using one of:
  - One-time provisioning token
  - TPM quote / EK attestation
  - Frequently rotated installation secret
  - Hardware serial whitelist

### 5. CA Issues Leaf Certificate
- Enrollment service validates request and signs CSR with Intermediate CA.
- Response returns leaf certificate plus chain.

### 6. Persist Certificate Chain
- Store certificate in Windows cert store or TPM-backed store; private key remains inside TPM.
- Maintain chain for TLS + DPS validation.

### 7. Authenticate to Azure DPS
- Device presents X.509 certificate to DPS Enrollment Group.
- DPS validates chain against uploaded CA certs, checks proof-of-possession, and assigns IoT Hub automatically.

### 8. Connect to IoT Hub
- Device initiates TLS connection using TPM key and issued certificate.
- IoT Hub accepts connection via DPS-assigned linkage.

## Why This Architecture Fits
- Zero-touch: once imaged, devices self-provision on first boot.
- Manufacturer simplicity: no per-device cert injection during production.
- TPM protection: keys cannot be copied or exfiltrated even under OS compromise.
- Scales to 100k+ devices using Enrollment Groups + standard PKI.
- Straightforward lifecycle: rotate certificates periodically, revoke compromised identities, maintain CRLs/OCSP.
- Avoids TPM attestation complexity in DPS (no per-device enrollments).

## Components To Stand Up
- **Azure**: DPS instance, X.509 Enrollment Group, verified Intermediate CA upload.
- **Device**: TPM key generation logic, CSR builder, certificate enrollment client, DPS X.509 client.
- **Backend**: Root + Intermediate CA, enrollment service (EST/SCEP/API), HSM-backed signing keys, revocation/rotation tooling.

## Takeaway
Using the TPM purely as key protection with X.509 attestation to DPS delivers:
- High security with immutable device identity.
- Massive, automated fleet onboarding.
- Flexible long-term certificate management without manufacturer dependencies.



