# IoT Certificate Lifecycle Automation Plan

This plan describes a production-grade, end-to-end automation workflow for managing X.509 certificates and provisioning for your IoT agent using Azure DPS/IoT Hub. It maps to the scripts already in this repo and identifies new automation pieces to add in CI/CD and device boot.

## Goals
- Zero-touch device onboarding: device boots and connects to DPS/IoT Hub automatically.
- Secure PKI: Root CA offline; Intermediate per environment; device certs short-lived; no private keys leaked to devices except device private key.
- Reproducible automation across dev/staging/prod with CI/CD.
- Robust logging, validation, and error handling.

## Roles and Boundaries
- Root CA: Generated offline (never in CI/CD; never on devices).
- Intermediate CA (per env): Hosted in secure signer (HSM/Key Vault). Public certificate uploaded and verified in DPS; private key never leaves signer.
- Device certificates: Signed centrally by Intermediate. Optionally device-generated CSR using TPM/HSM.

---

## Phase A: PKI Bootstrap (One-time per environment)

1) Root CA (offline)
- Generate on an air-gapped machine or HSM.
- Archive Root CA cert (rootCA.pem). Keep private key offline.
- Repo reference scripts (dev only): `scripts/generateRootCA.js`.

2) Intermediate CA (per environment)
- Generate Intermediate CA (or issue via Root CA).
- Store intermediate private key in secure signer (Azure Key Vault Certificates or HSM). Do not commit or ship.
- Repo script (dev bootstrap): `scripts/generateIntermediateCert.js`.

3) DPS Certificate Upload & Verification
- Upload intermediate certificate to DPS and verify proof-of-possession.
- Repo script (verification material): `scripts/generateVerificationCert.js`.
- Automation (CI/CD): `az iot dps certificate create|generate-verification-code|verify`.

4) DPS Enrollment Group
- Create an enrollment group bound to the verified Intermediate CA.
- Automation (CI/CD): `az iot dps enrollment-group create --attestation-type x509`.

Outputs
- DPS has a verified Intermediate CA cert and an enabled enrollment group for x509.

---

## Phase B: Device Certificate Issuance (Factory or Secure Service)

Production best practice
- Device private key is generated on-device (TPM/HSM) or in a secure factory signer.
- A CSR is produced with `CN = deviceId` (format: `AIO_<MODEL>_<SERIAL>`), signed by the Intermediate CA.
- Device receives its signed certificate (device.pem). Private key stays in secure hardware or device keystore.

Development convenience (not for production)
- Use `scripts/generateDynamicCert.js` to generate device.key + device.pem signed by intermediate for quick tests.

Outputs
- For each device: `device.pem` (cert) and `device.key` (if not hardware-protected), delivered securely to the device.

---

## Phase C: Device Bootstrapping (Device-side)

Pre-start validation (ExecStartPre / prelaunch step)
- Validate `X509_CERT_FILE` and `X509_KEY_FILE` exist and are readable.
- Validate certificate CN equals computed `DEVICE_ID` (via `scripts/showDeviceId.js`).
- Validate certificate chain to Intermediate (openssl verify).
- If any check fails: log actionable guidance and abort start.

Agent startup (already in place)
- Load env vars: `DEVICE_ID`, `X509_CERT_FILE`, `X509_KEY_FILE`, `DPS_ID_SCOPE`, `DPS_PROVISIONING_HOST`, `USE_CERTIFICATE_AUTH=true`.
- EdgeAssembly init() → pair() with DPS (x509) → connect() to IoT Hub.

Optional dev path
- If `AUTO_GENERATE_CERT=true` and missing certs, run `scripts/generateDynamicCert.js` then re-check.

Outputs
- Device pairs and connects automatically on first boot.

---

## Phase D: Certificate Rotation

Strategy
- Short validity (e.g., 90–180 days). Central scheduler monitors expiry (Key Vault/PKI database).
- T-14 days: signer issues a new device cert; deliver securely to the device.
- Device performs atomic swap (write new files to temp, validate, update env/paths, restart agent).
- Optionally, CSR flow from device → signer returns signed cert → device installs.

Automation hooks
- CI/CD job or scheduler queries expiring certs; triggers issuance and delivery pipeline.
- Device pre-start validator rejects expired certs and falls back to latest if present.

---

## Phase E: Error Handling, Logging, and Observability

Logging
- Use existing Winston with daily rotate; ship logs to Azure Monitor/Log Analytics.
- Standardize error messages for missing certs, CN mismatch, DPS verification errors.

Validations to add
- CN==DEVICE_ID check (openssl subject vs computed deviceId).
- Chain verify to Intermediate.
- Permission checks: private key readable only by agent user.

Alerts
- Configure alerts on provisioning failures, connection failures, cert expiry, DPS cert verification failures.

---

## Phase F: CI/CD Integration (Azure DevOps/GitHub Actions)

Secrets
- Store Intermediate CA in Key Vault. Access via OIDC with short-lived tokens. **Never** export private keys.

Pipeline Stages
1. `pki-prepare` (secured)
   - Validate DPS certificate presence & status.
   - Verify/update enrollment group for env.

2. `build`
   - `npm ci`
   - `npm run build`
   - Basic sanity checks (`node scripts/testEdgeAssembly.js`).

3. `package`
   - `npm run build:package` → `agent_nest.zip`.

4. `sign-device-certs` (factory/secure runner)
   - For batch devices: accept CSV of deviceIds; sign CSRs or generate certs via Key Vault Certificates.
   - Output device cert bundles for secure delivery.

5. `deploy`
   - Push agent and device certs via device management solution/OTA.

CLI Automation (examples)
- `az iot dps certificate create` / `generate-verification-code` / `verify`.
- `az iot dps enrollment-group create|update|list`.

---

## Phase G: Repository Changes to Implement

To add
- `scripts/validateCerts.js` (cross-platform):
  - Check presence of cert/key; CN==DEVICE_ID; chain verification. Exit non-zero if fail.
- `scripts/pipeline/dps-setup.ps1` or `.js`:
  - Upload/verify Intermediate in DPS; create/update enrollment group.
- `scripts/pipeline/sign-device-certs.js` (stub):
  - Integrate with Key Vault/HSM signing API for batch issuance.
- `systemd`/Windows service pre-start wiring example in README.

To keep (existing)
- `scripts/generateRootCA.js` (dev/offline)
- `scripts/generateIntermediateCert.js`
- `scripts/generateVerificationCert.js`
- `scripts/generateDynamicCert.js` (dev only)
- `scripts/showDeviceId.js`
- `scripts/testEdgeAssembly.js` (extend with cert checks)

---

## Phase H: Testing Plan

Dev environment
- Use `generateIntermediateCert.js` + `generateDynamicCert.js` to simulate end-to-end.
- Run `scripts/validateCerts.js` → expect success.
- Start agent → should pair and connect.

Staging
- Upload Intermediate to DPS; verify; create enrollment group.
- Issue device certs from secure signer; deliver to test devices.
- Validate zero-touch onboarding.

Production
- Intermediate CA in Key Vault/HSM; DPS enrollment group pre-configured.
- Factory signer issues device certs; devices boot and connect.
- Monitoring + alerts enabled.

---

## Environment Variables (minimum)
- `DEVICE_ID` (must match CN)
- `USE_CERTIFICATE_AUTH=true`
- `X509_CERT_FILE=./certificates/device.pem`
- `X509_KEY_FILE=./certificates/device.key`
- `DPS_PROVISIONING_HOST=global.azure-devices-provisioning.net`
- `DPS_ID_SCOPE=<your_scope>`

Optional (dev)
- `AUTO_GENERATE_CERT=true` (local/dev only)

---

## Milestones & Deliverables
1. PKI bootstrap documented and Intermediate uploaded/verified in DPS.
2. Enrollment group created for x509 Intermediate.
3. Device cert issuance pipeline integrated (factory/Key Vault/HSM).
4. Device pre-start validator added and wired to service.
5. CI/CD stages for DPS setup, build, package, signing, deploy.
6. Rotation scheduler/process in place with alerts.
7. Operational runbooks for failures (DPS verify, CN mismatch, expired certs).

---

## Security Notes
- Never ship or commit Root/Intermediate private keys.
- Prefer hardware-backed keys on the device (TPM/HSM).
- Enforce strict file permissions for `device.key` if file-based.
- Use short-lived certificates and rotate proactively.
- Limit DPS/IoT Hub credentials in CI with least privilege.

---

This plan leverages your existing scripts and adds the missing automation pieces (validator, DPS CLI steps, signing integration, CI/CD stages) to achieve a fully automated, production-ready certificate lifecycle.

