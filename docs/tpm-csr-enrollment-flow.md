## TPM → CSR → Enrollment Backend → Device Certificate

This document condenses the end-to-end flow the AIO device follows today (with OpenSSL-based signing) and how it evolves once a production Certificate Authority (CA) is wired into the enrollment backend.

### 1. Edge Agent Running On The Device
- The `Edge-agent` service is pre-installed on each AIO bar before it leaves the factory.
- When the customer powers the unit, Windows launches the agent, which orchestrates TPM key creation, CSR creation, and enrollment HTTP calls.

### 2. TPM Key Creation (Device-Side)
1. Agent (or helper script `scripts/create-tpm-key.ps1`) requests an asymmetric key pair from the device TPM via the Microsoft Platform Crypto Provider.
2. The private key is *non-exportable* and persists in TPM storage; only a key handle (container name) is stored locally.
3. This key underpins every later TLS client authentication, so it must never leave the hardware boundary.

### 3. CSR Generation (Device-Side)
1. Agent runs `scripts/create-csr.ps1`, telling CertEnroll to reference the TPM-held key.
2. The CSR’s subject/SANs include device identity data (deviceId, model, serial).
3. Output CSR is saved (e.g., `certificates/csr-AIO_...req`) and is ready to be sent upstream.

### 4. Upload To Enrollment Backend (Device → Cloud)
1. Agent calls `EnrollmentService.enroll()` (`src/provisioning/enrollment.service.ts`).
2. Request body contains `{ deviceId, model, serial, csrPem }`.
3. Headers carry `Authorization: Bearer ${ENROLLMENT_TOKEN}` to prove legitimacy.
4. `ENROLLMENT_URL` targets the centrally deployed enrollment backend (dev/staging/prod). It is **not** hosted on the device; it runs in your infrastructure (cloud VM, container app, Kubernetes, etc.) so it can serve every shipped unit.

### 5. Enrollment Backend Responsibilities (Off-Device Service)
The backend is a dedicated microservice because certificate issuance is sensitive, audited, and shared by the whole fleet.

1. **Authenticate** the call (validate the bearer token, TPM attestation, serial whitelist, etc.).
2. **Verify** CSR contents (CN/SAN must match the device metadata sent alongside).
3. **CA Integration**:
   - *Current dev mode*: backend shells out to OpenSSL using local CA material (see `scripts/dev-enrollment-server.ts`).
   - *Future production*: backend forwards the CSR to your enterprise CA chain (e.g., Azure Key Vault-backed CA, HashiCorp Vault PKI, EJBCA, DigiCert IoT CA). The CA lives in secured infrastructure, not on the device.
4. **Respond** with `{ deviceCertPem, caChainPem }`.

Because the backend is stateless relative to a device, it can be scaled, audited, and isolated from the rest of the IoT control plane.

### 6. Device Receives Certificate
1. Agent writes `deviceCertPem` to `X509_CERT_FILE` and the chain to `X509_CA_CHAIN_FILE`.
2. Windows automatically associates the leaf certificate with the TPM-held private key (same container name used for the CSR).
3. Agent resumes the Azure DPS/X.509 onboarding flow using the new credential.

### 7. Why Two Services Need To Communicate
- **Edge Agent (on-device)**: has physical TPM access, knows the device identity, and can prove possession of the private key but should never handle CA signing keys.
- **Enrollment Backend (off-device)**: has access to CA signing capability, policy enforcement, auditing, and security controls. It exists separately so devices in the field can request certificates securely over HTTPS.

Communication happens over TLS (HTTPS POST) using the enrollment token (and later, richer attestation) so the backend trusts the device enough to mint a certificate. No CA secrets or signing keys are ever shipped to the device.

### 8. Deployment Model Summary
- **Edge agent** → runs *inside* each IoT device (AIO bar).
- **Enrollment backend** → runs *outside* devices (cloud/on-prem service). It must be reachable over the internet or VPN so shipped devices can call it after they leave the factory.
- **Certificate Authority** → integrated inside the backend, typically via HSM or managed PKI. Only the backend talks to it.

With this separation, replacing the OpenSSL dev signer with a real CA only requires updates inside the enrollment backend; the on-device agent keeps posting the same payload to `ENROLLMENT_URL` and remains unchanged.

### 9. Sequence Diagram (Text Render)

```
┌─────────────┐        ┌────────────┐        ┌─────────────────────┐        ┌───────────────────────┐
│ Edge-agent  │        │    TPM     │        │ Enrollment Backend  │        │ Certificate Authority │
└─────┬───────┘        └────┬───────┘        └───────────┬─────────┘        └───────────┬──────────┘
      │ Request key pair    │                                │                             │
      │────────────────────>│                                │                             │
      │     key handle      │                                │                             │
      │<────────────────────│                                │                             │
      │ Build CSR w/ TPM key│                                │                             │
      │────────────────────>│                                │                             │
      │        CSR          │                                │                             │
      │<────────────────────│                                │                             │
      │ POST /api/enroll (CSR + device info + token)         │                             │
      │─────────────────────────────────────────────────────>│                             │
      │                        Authenticate, validate policy │                             │
      │                                                      │                             │
      │                    Forward CSR for signing           │                             │
      │                                                      │────────────────────────────>│
      │                                                      │   Signed cert + CA chain    │
      │                                                      │<────────────────────────────│
      │ Receive {cert, chain}                                │                             │
      │<─────────────────────────────────────────────────────│                             │
      │ Persist cert/chain, continue DPS onboarding          │                             │
```



