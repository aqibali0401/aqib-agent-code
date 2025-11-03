#!/usr/bin/env node
/**
 * DPS Setup Script (Development/Manufacturing Helper)
 *
 * Purpose:
 * - Create/Update the Intermediate CA certificate in Azure DPS
 * - Generate verification code and produce verification certificate
 * - Verify the certificate in DPS (proof-of-possession)
 * - Create/Update an X.509 Enrollment Group bound to the Intermediate
 *
 * Requirements:
 * - Azure CLI installed and logged in (az)
 * - az extension add --name azure-iot
 * - Environment variables provided (see below)
 * - Development mode: local intermediate.pem and intermediate.key present
 *
 * Environment Variables:
 *   DPS_NAME                  (required)
 *   DPS_RESOURCE_GROUP        (required)
 *   DPS_CERT_NAME             (required)  // Friendly name for the cert in DPS
 *   INTERMEDIATE_PEM_PATH     (required)  // Path to intermediate.pem
 *   ENROLLMENT_ID             (required)  // Name of enrollment group to create/update
 *   ENROLLMENT_PROVISIONING_STATUS (optional, default: enabled)
 *   VERIFICATION_WORK_DIR     (optional, default: certificates)
 *   DEV_USE_LOCAL_SIGNING     (optional, 'true' to use local intermediate.key via generateVerificationCert.js)
 *
 * Notes:
 * - In production, verification cert should be created by Key Vault/HSM signer.
 * - This script supports a DEV mode that calls scripts/generateVerificationCert.js
 *   using a locally available intermediate.key for convenience.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Get Azure CLI command - use explicit path if provided, otherwise use 'az'
const AZ_CMD = process.env.AZ_CLI_PATH || 'az';

function sh(cmd, opts = {}) {
  // Replace 'az' command with the actual Azure CLI path if needed
  let actualCmd = cmd;
  if (AZ_CMD !== 'az' && cmd.startsWith('az ')) {
    actualCmd = AZ_CMD + ' ' + cmd.substring(3);
  }
  console.log(`\n$ ${actualCmd}`);
  return execSync(actualCmd, { stdio: 'inherit', ...opts });
}

function getOutput(cmd) {
  // Replace 'az' command with the actual Azure CLI path if needed
  let actualCmd = cmd;
  if (AZ_CMD !== 'az' && cmd.startsWith('az ')) {
    actualCmd = AZ_CMD + ' ' + cmd.substring(3);
  }
  return execSync(actualCmd, { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

async function main() {
  const DPS_NAME = requireEnv('DPS_NAME');
  const DPS_RESOURCE_GROUP = requireEnv('DPS_RESOURCE_GROUP');
  const DPS_CERT_NAME = requireEnv('DPS_CERT_NAME');
  const INTERMEDIATE_PEM_PATH = requireEnv('INTERMEDIATE_PEM_PATH');
  const ENROLLMENT_ID = requireEnv('ENROLLMENT_ID');
  const ENROLLMENT_PROVISIONING_STATUS = process.env.ENROLLMENT_PROVISIONING_STATUS || 'enabled';
  const VERIFICATION_WORK_DIR = process.env.VERIFICATION_WORK_DIR || 'certificates';
  const DEV_USE_LOCAL_SIGNING = process.env.DEV_USE_LOCAL_SIGNING === 'true';

  const absIntermediatePem = path.resolve(INTERMEDIATE_PEM_PATH);
  if (!fs.existsSync(absIntermediatePem)) {
    throw new Error(`Intermediate PEM not found at ${absIntermediatePem}`);
  }

  console.log('\n=== DPS: Upload/Update Intermediate Certificate ===');
  // Create or update the certificate in DPS
  // Note: Using create; if exists, consider az iot dps certificate update
  try {
    sh(`az iot dps certificate create --dps-name ${DPS_NAME} --resource-group ${DPS_RESOURCE_GROUP} --name ${DPS_CERT_NAME} --path "${absIntermediatePem}"`);
  } catch (e) {
    console.warn('Certificate may already exist. Attempting update...');
    sh(`az iot dps certificate update --dps-name ${DPS_NAME} --resource-group ${DPS_RESOURCE_GROUP} --name ${DPS_CERT_NAME} --path "${absIntermediatePem}"`);
  }

  console.log('\n=== DPS: Generate Verification Code ===');
  const codeCmd = `az iot dps certificate generate-verification-code --dps-name ${DPS_NAME} --resource-group ${DPS_RESOURCE_GROUP} --name ${DPS_CERT_NAME} --query properties.verificationCode -o tsv`;
  const verificationCode = getOutput(codeCmd);
  console.log(`Verification Code: ${verificationCode}`);

  const workDir = path.resolve(VERIFICATION_WORK_DIR);
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });
  const verificationPem = path.join(workDir, 'verification.pem');

  console.log('\n=== Create Verification Certificate ===');
  if (DEV_USE_LOCAL_SIGNING) {
    // Dev helper: reuse existing script to generate verification cert with local key
    // Expect generateVerificationCert.js to read env/inputs and place verification.pem
    const genScript = path.resolve('scripts/generateVerificationCert.js');
    if (!fs.existsSync(genScript)) {
      throw new Error('scripts/generateVerificationCert.js not found. Cannot proceed with DEV_USE_LOCAL_SIGNING.');
    }
    // Pass the code via env so the script can consume it
    console.log('Using local signing (development mode) to produce verification.pem');
    execSync(`${process.execPath} ${genScript}`, {
      stdio: 'inherit',
      env: { ...process.env, DPS_VERIFICATION_CODE: verificationCode },
    });
    if (!fs.existsSync(verificationPem)) {
      throw new Error(`Expected verification certificate at ${verificationPem} not found.`);
    }
  } else {
    console.log('Production mode: Use Key Vault/HSM signer to produce verification.pem using the verification code.');
    console.log(`Place the generated verification certificate at: ${verificationPem}`);
    throw new Error('Verification certificate creation not automated in production mode. Set DEV_USE_LOCAL_SIGNING=true for dev.');
  }

  console.log('\n=== DPS: Verify Certificate (Proof of Possession) ===');
  sh(`az iot dps certificate verify --dps-name ${DPS_NAME} --resource-group ${DPS_RESOURCE_GROUP} --name ${DPS_CERT_NAME} --path "${verificationPem}"`);

  console.log('\n=== DPS: Create/Update Enrollment Group (X.509) ===');
  // Try create, if exists then update
  try {
    sh(`az iot dps enrollment-group create --dps-name ${DPS_NAME} --resource-group ${DPS_RESOURCE_GROUP} --enrollment-id ${ENROLLMENT_ID} --attestation-type x509 --primary-certificate-path "${absIntermediatePem}" --provisioning-status ${ENROLLMENT_PROVISIONING_STATUS}`);
  } catch (e) {
    console.warn('Enrollment group may exist. Attempting update...');
    sh(`az iot dps enrollment-group update --dps-name ${DPS_NAME} --resource-group ${DPS_RESOURCE_GROUP} --enrollment-id ${ENROLLMENT_ID} --primary-certificate-path "${absIntermediatePem}" --provisioning-status ${ENROLLMENT_PROVISIONING_STATUS}`);
  }

  console.log('\n✅ DPS Intermediate verified and enrollment group ready.');
}

main().catch((err) => {
  console.error('\n❌ DPS setup failed:');
  console.error(err?.message || err);
  process.exit(1);
});


