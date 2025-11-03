# Production-Ready Automated IoT Device Provisioning – Implementation Plan

This document defines the concrete implementation blueprint for zero-touch device provisioning using Azure DPS with X.509 certificates. It aligns with security best practices: Root CA offline, Intermediate CA in a secure signer (Key Vault/HSM), device certs short-lived, and no Intermediate private key on devices.

## Scope
- Manufacturing-time PKI/DPS setup (one-time per environment)
- Device first-boot auto-provisioning
- Runtime certificate lifecycle management (renewal/self-heal)
- Error handling, observability and CI/CD integration

---

## 1) Manufacturing (one-time per environment)

Security stance
- Root CA private key: offline-only (air-gapped/HSM). Never in CI/CD or devices.
- Intermediate CA: per environment (dev/stage/prod) stored in Key Vault/HSM. Private key never leaves signer.

Steps
1. Create Intermediate CA (in Key Vault Certificates or HSM)
2. Upload and verify Intermediate in DPS
   - az iot dps certificate create
   - az iot dps certificate generate-verification-code
   - Sign verification code (Key Vault policy)
   - az iot dps certificate verify
3. Create DPS enrollment group bound to Intermediate
   - az iot dps enrollment-group create --attestation-type x509 --provisioning-status enabled
4. Bake only intermediate.pem (public) into the device image for chain validation

Deliverables
- Verified DPS certificate
- Enabled enrollment group for the environment
- Device OS image containing intermediate.pem (no private keys)

---

## 2) Device Auto-Provisioning (first boot)

Device identity
- Compute `deviceId = AIO_<MODEL>_<SERIAL>` (reuse existing hardware info util)

Key/certificate issuance (production)
- Generate device keypair locally (prefer TPM/HSM; else OS keystore)
- Create CSR with `CN = deviceId`
- POST CSR to Signing Service (behind Key Vault/HSM)
- Receive signed `device.pem` and install alongside private key

Validation
- CN == deviceId
- `openssl verify -CAfile intermediate.pem device.pem`
- Private key permissions (or hardware-backed)

Configuration and start
- Write env vars: `DEVICE_ID`, `X509_CERT_FILE`, `X509_KEY_FILE`, `DPS_ID_SCOPE`, `USE_CERTIFICATE_AUTH=true`
- Start Edge Assembly: `init → pair (DPS) → connect (IoT Hub) → telemetry`

Development override (non-production)
- Allow `AUTO_GENERATE_CERT=true` to use `scripts/generateDynamicCert.js` for local testing

---

## 3) Certificate Lifecycle Manager (runtime)

Monitoring
- Read `notAfter` from `device.pem`
- Emit metric/log for time-to-expiry

Renewal
- T-14 days: create new CSR → Signing Service → new `device.pem`
- Validate new cert; atomically swap files (write to temp, verify, move)
- Reconnect to IoT Hub; rollback to previous cert on failure; alert

---

## 4) Error Handling, Logging, Observability

Pre-start validator (ExecStartPre or prelaunch)
- Files exist (device.pem, device.key)
- CN == DEVICE_ID
- Chain validates to intermediate.pem
- Exit non-zero with actionable logs if any step fails

Logging & alerts
- Standardized Winston logs shipped to Log Analytics
- Alerts on: DPS verification failures, connection failures, cert expiry window, CN mismatch

---

## 5) CI/CD Integration

Secrets & access
- Use OIDC to access Azure Key Vault; never export private keys

Pipeline stages
1. pki-prepare (secured)
   - Upload/verify Intermediate in DPS
   - Create/update enrollment group
2. build
   - npm ci; npm run build; run repo sanity checks
3. package
   - npm run build:package → agent_nest.zip
4. sign-device-certs (factory/secure signer)
   - Batch CSR signing via Key Vault/HSM – produce device cert bundles
5. deploy
   - Deliver agent + device certs via MDM/OTA

CLI examples
- az iot dps certificate create|generate-verification-code|verify
- az iot dps enrollment-group create|update|list

---

## 6) Repository Tasks (to implement next)

New code/scripts
- scripts/deployment/first-boot-setup.js
  - Validate presence, CN==DEVICE_ID, chain verify; exit non-zero on failure
- src/provisioning/
  - provisioning.module.ts
  - provisioning.service.ts (first-boot orchestrator)
  - certificate-manager.service.ts (key/CSR/validation/atomic swap)
  - device-identity.service.ts (AIO_MODEL_SERIAL)
- scripts/pipeline/dps-setup.ps1 (or .js)
  - Upload & verify Intermediate in DPS; create/update enrollment group
- scripts/pipeline/signing-stub.js
  - CSR → call Signing Service (Key Vault/HSM), receive device.pem

Enhancements
- Extend scripts/testEdgeAssembly.js to include cert CN/chain checks
- Systemd/Windows service example with ExecStartPre calling first-boot-setup.js

---

## 7) Configuration

Minimum runtime env vars
- DEVICE_ID (must match certificate CN)
- USE_CERTIFICATE_AUTH=true
- X509_CERT_FILE=./certificates/device/device.pem
- X509_KEY_FILE=./certificates/device/device.key
- DPS_PROVISIONING_HOST=global.azure-devices-provisioning.net
- DPS_ID_SCOPE=<your_scope>

Development-only
- AUTO_GENERATE_CERT=true (non-production)

---

## 8) Milestones
- M1: DPS Intermediate verified + enrollment group created
- M2: First-boot provisioning service and validator in place (dev mode)
- M3: Signing Service integration (staging/prod) with CSR issuance
- M4: Rotation implemented (renewal, atomic swap, rollback)
- M5: CI/CD jobs (pki-prepare, build, package, deploy) live
- M6: Observability dashboards and alerts online

---

## 9) Security Notes
- Never ship or commit Root/Intermediate private keys
- Prefer hardware-backed device keys (TPM/HSM)
- Short-lived device certs; rotate proactively
- Principle of least privilege for CI/CD and DPS ops

---

## Next Actions
1. Add pre-start validator and provisioning scaffolding
2. Add DPS setup pipeline script
3. Define Signing Service API (.md) and local dev stub
4. Wire first-boot provisioning before Edge Assembly initialization
