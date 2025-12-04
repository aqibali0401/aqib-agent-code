## Step 4 – Certificate Enrollment Service Integration

This document captures the workflow, prerequisites, and research tasks needed to operationalize Step 4 of the provisioning flow: securely exchanging the TPM-backed CSR for a signed device certificate.

---

### 1. Current Device-Side Implementation
1. **Detect missing cert/chain**: `EdgeAssemblyService` now invokes `autoProvisionIfNeeded` before DPS. If `X509_CERT_FILE` (leaf cert) is absent, the agent runs steps 2–3 first (TPM key + CSR).
2. **Submit CSR**: `EnrollmentService` reads `CSR_OUTPUT_PATH`, POSTs to `${ENROLLMENT_URL}/api/enroll`, and authenticates with `ENROLLMENT_TOKEN`.
3. **Persist response**: The enrollment response must include `deviceCertPem` (mandatory) and optional `caChainPem`. The agent writes them to `X509_CERT_FILE` and `X509_CA_CHAIN_FILE`, keeping the private key inside the TPM.
4. **Rejoin provisioning flow**: With the cert chain in place, DPS onboarding proceeds and the device can connect using X.509 auth.

---

### 2. Environment Variables Required
| Variable | Purpose | Example |
| --- | --- | --- |
| `AUTO_ENROLL_ENABLED` | Toggle automation of Steps 2–4 | `true` |
| `ENROLLMENT_URL` | Base URL of the enrollment API | `https://enroll.mycompany.com` |
| `ENROLLMENT_TOKEN` | Bootstrap credential (Bearer token) | `eyJhbGci...` |.
| `X509_CA_CHAIN_FILE` | Path to persist CA chain | `./certificates/ca-chain.pem` |
| `CSR_OUTPUT_PATH` | CSR output location | `./certificates/csr-AIO_...req` |
| `TPM_KEY_SCRIPT_PATH` | Override for TPM script (optional) | `./scripts/create-tpm-key.ps1` |
| `CSR_SCRIPT_PATH` | Override for CSR script (optional) | `./scripts/create-csr.ps1` |

These settings allow per-device imaging while keeping defaults for scripts/certs.

---

### 3. Backend Requirements (To Research/Implement)
1. **Protocol Decision**  
   Choose the enrollment style best suited to your infrastructure:
   - EST/SCEP-compatible CA (e.g., Dogtag, Microsoft NDES)
   - ACME/step-ca with custom challenge
   - HashiCorp Vault PKI
   - Custom REST API backed by your CA logic

2. **CA Key Placement**  
   - Create/import the issuing CA private key into Azure Key Vault Managed HSM.
   - Ensure the enrollment service can invoke *sign* operations via the Key Vault Crypto client.

3. **Authentication / Authorization** (pick at least one, ideally more than one):
   - One-time provisioning token (current implementation).
   - TPM quote or EK certificate attestation check.
   - Frequently rotated installation secret baked into the image.
   - Hardware serial/model whitelist check against a backend database.

4. **Certificate Issuance Flow**  
   - Validate request + auth evidence.
   - Parse CSR, enforce policy (e.g., CN must equal deviceId, SANs must match metadata).
   - Call Managed HSM to sign TBSCertificate or delegate to CA software that already integrates with HSM.
   - Return `{ deviceCertPem, caChainPem }`.

5. **Audit & Observability**  
   - Log deviceId, CSR hash, cert serial, requester IP, auth mechanism.
   - Store issued certificates in a database to enable revocation.

---

### 4. Recommended Research & Testing Plan
1. **Prototype Enrollment Server (Local Dev)**
   - Use `npm run dev:enrollment-server` to start the provided Express server (`scripts/dev-enrollment-server.ts`).  
   - It expects `certificates/intermediate.pem` & `.key` (see `cert:root`, `cert:intermediate`) and signs CSRs with OpenSSL.  
   - Point `ENROLLMENT_URL=http://localhost:4300` and `ENROLLMENT_TOKEN=<DEV_ENROLL_AUTH_TOKEN>` to exercise the automated flow.

2. **Evaluate CA Options**
   - Compare EST/SCEP, ACME (`step-ca`), Vault PKI, and a custom implementation.
   - Criteria: ease of integrating Managed HSM, support for TPM attestation, scalability, ops overhead.

3. **Managed HSM Integration**
   - If using custom API: build logic to construct TBSCertificate and call `KeyClient`/`CryptographyClient` to sign.  
   - If using CA software: verify vendor documentation for Managed HSM support (e.g., EJBCA, Keyfactor).

4. **Security Controls**
   - Determine primary authentication (token vs. attestation).  
   - Design rotation strategy for tokens/secrets.  
   - Define how to validate TPM quotes or EK certs if used.

5. **Device Testing Scenarios**
   - Missing TPM key → script should regenerate.  
   - CSR regeneration with existing key.  
   - Enrollment API failures (network, 400/500) → ensure retries/backoff.  
   - Successful cert issuance and DPS onboarding.

6. **Staging vs. Production**
   - Stand up a staging enrollment endpoint to test new firmware images.  
   - Use separate Managed HSM keys for staging/production to isolate trust anchors.

---

### 5. Next Steps Checklist
- [ ] Finalize which enrollment protocol/server to adopt.
- [ ] Stand up the enrollment API + CA integration (staging).
- [ ] Configure `ENROLLMENT_URL` and `ENROLLMENT_TOKEN` in device images.
- [ ] Exercise full provisioning (Steps 2–7) using the staging backend.
- [ ] Document rollback/recovery (e.g., how to reissue a cert if onboarding fails).

Once the backend is selected and deployed, the current device agent code can consume it immediately—only the `.env` values need updating. Further enhancements (TPM attestation, token rotation, CRL/OCSP updates) can be layered atop this foundation.

---

### Appendix – Dev Enrollment Server Quickstart
1. Generate CA material once:
   ```
   npm run cert:root
   npm run cert:intermediate
   ```
2. Start the OpenSSL-backed server:
   ```
   DEV_ENROLL_AUTH_TOKEN=dev-provisioning-token \
   npm run dev:enrollment-server
   ```
3. Configure the agent environment:
   ```
   AUTO_ENROLL_ENABLED=true
   ENROLLMENT_URL=http://localhost:4300
   ENROLLMENT_TOKEN=dev-provisioning-token
   ```
4. Boot the device/agent. It will:
   - Create TPM key (if absent) via `create-tpm-key.ps1`
   - Generate CSR via `create-csr.ps1`
   - POST CSR to `/api/enroll`, receive `deviceCertPem` + `caChainPem`
   - Store files and proceed with DPS.
5. Once production CA is ready, turn off the dev server and update `ENROLLMENT_URL` / token to point to the real enrollment endpoint. No device code changes required.

