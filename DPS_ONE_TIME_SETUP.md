# Azure DPS One-Time Setup vs. Ongoing Device Provisioning

This guide explains what must be done once (with Azure credentials) and what devices do automatically (without credentials) for X.509-based provisioning.

## One-Time Admin Tasks (Per Environment)

Requires Azure portal/CLI credentials. Performed once for each environment (dev/staging/prod).

1) Upload and verify Intermediate CA certificate in DPS
- You can do this via Azure Portal or scripted CLI.
- CLI (development-friendly) steps:
  - az login
  - Set environment variables:
    - DPS_NAME
    - DPS_RESOURCE_GROUP
    - DPS_CERT_NAME
    - INTERMEDIATE_PEM_PATH (path to intermediate.pem)
    - ENROLLMENT_ID (name for enrollment group)
    - DEV_USE_LOCAL_SIGNING=true (development only)
  - Run:
    - npm run manufacturing:dps-setup
  - What it does:
    - Uploads/updates the Intermediate certificate into DPS
    - Generates verification code and (dev) creates verification.pem
    - Verifies the certificate in DPS
    - Creates/updates an X.509 enrollment group bound to the Intermediate

2) Create X.509 Enrollment Group bound to the Intermediate
- If not using the script above, do this in Portal or via:
  - az iot dps enrollment-group create --attestation-type x509 --provisioning-status enabled

3) Bake only intermediate.pem into the device image
- Copy public Intermediate CA (intermediate.pem) into the image
- Never ship private keys (root or intermediate) to devices

Result
- DPS trusts your Intermediate CA and has an enabled enrollment group for devices signed by it.

---

## Ongoing Device Provisioning (No Azure Credentials on Device)

Devices self-provision using X.509. They never need Azure portal or CLI credentials.

Device requirements (in .env / config)
- DEVICE_ID (must match certificate CN)
- X509_CERT_FILE (path to device certificate)
- X509_KEY_FILE (path to device private key)
- DPS_ID_SCOPE (from DPS)
- DPS_PROVISIONING_HOST (usually global.azure-devices-provisioning.net)
- USE_CERTIFICATE_AUTH=true

Flow on device startup
1) Device presents its X.509 certificate (CN = DEVICE_ID) to DPS
2) DPS verifies the cert against the previously uploaded Intermediate CA
3) DPS checks the enrollment group bound to that Intermediate
4) DPS assigns the device to an IoT Hub
5) Device connects to IoT Hub using the same X.509 cert

Notes
- No Azure credentials are present on the device at any time
- Only the certificate/key pair and DPS identifiers are required

---

## Quick Commands (Development)

- Manufacturing setup (dev-friendly):
  - az login
  - Set env: DPS_NAME, DPS_RESOURCE_GROUP, DPS_CERT_NAME, INTERMEDIATE_PEM_PATH, ENROLLMENT_ID, DEV_USE_LOCAL_SIGNING=true
  - npm run manufacturing:dps-setup

- Prepare image with public CA:
  - INTERMEDIATE_PEM_PATH=certificates/intermediate.pem npm run manufacturing:prepare-image

---

## Summary
- One-time (with Azure creds): Upload/verify Intermediate CA in DPS and create an X.509 enrollment group (Portal or npm run manufacturing:dps-setup)
- Ongoing (no creds on device): Devices use only their X.509 cert + DPS_HOST/ID_SCOPE to self-provision and connect to IoT Hub.
