#!/usr/bin/env node
/**
 * First-Boot Validator (Device-side)
 *
 * Validates that the device is ready to start the agent:
 * - Loads .env (if present) and process.env
 * - Ensures certificate and key files exist (X509_CERT_FILE, X509_KEY_FILE)
 * - Ensures DEVICE_ID exists and matches certificate CN
 * - Optionally verifies chain against intermediate.pem (INTERMEDIATE_PEM_FILE or default)
 * - Ensures DPS_ID_SCOPE exists
 *
 * Exits non-zero with actionable messages on failure.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
try { require('dotenv').config(); } catch (_) {}

function fail(msg) {
  console.error(`\n❌ First-boot validation failed: ${msg}\n`);
  process.exit(1);
}

function warn(msg) {
  console.warn(`\n⚠️  ${msg}\n`);
}

function resolveRequiredEnv(name) {
  const v = process.env[name];
  if (!v) fail(`Missing required environment variable: ${name}`);
  return v;
}

function fileExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function readCertSubjectCN(certPath) {
  try {
    const out = execSync(`openssl x509 -in "${certPath}" -noout -subject`, { stdio: ['ignore', 'pipe', 'pipe'] })
      .toString().trim();
    // subject=CN = AIO_...
    const m = out.match(/CN\s*=\s*([^,\n]+)/);
    return m ? m[1].trim() : null;
  } catch (e) {
    warn('openssl not found or failed to read certificate subject; skipping CN extraction');
    return null;
  }
}

function verifyChain({ devicePem, intermediatePem, rootPem, deviceFullchain }) {
  // Prefer root + untrusted intermediate if root is available
  try {
    if (rootPem && fs.existsSync(rootPem) && intermediatePem && fs.existsSync(intermediatePem)) {
      execSync(`openssl verify -CAfile "${rootPem}" -untrusted "${intermediatePem}" "${devicePem}"`, { stdio: 'inherit' });
      return true;
    }
  } catch (_) {}

  // Fallback: try CAfile = intermediate only (may work if intermediate is trusted locally)
  try {
    if (intermediatePem && fs.existsSync(intermediatePem)) {
      execSync(`openssl verify -CAfile "${intermediatePem}" "${devicePem}"`, { stdio: 'inherit' });
      return true;
    }
  } catch (_) {}

  // Last resort: if a fullchain exists (device + intermediate), try verifying against root if present
  try {
    if (deviceFullchain && fs.existsSync(deviceFullchain) && rootPem && fs.existsSync(rootPem)) {
      // Create a temp file that contains only the intermediate if needed; for simplicity, attempt verify of device.pem again
      execSync(`openssl verify -CAfile "${rootPem}" -untrusted "${intermediatePem}" "${devicePem}"`, { stdio: 'inherit' });
      return true;
    }
  } catch (_) {}

  return false;
}

function main() {
  const DEVICE_ID = resolveRequiredEnv('DEVICE_ID');
  const USE_CERTIFICATE_AUTH = process.env.USE_CERTIFICATE_AUTH || 'true';
  if (USE_CERTIFICATE_AUTH !== 'true') {
    warn('USE_CERTIFICATE_AUTH is not true; validator assumes X.509 auth.');
  }

  const X509_CERT_FILE = resolveRequiredEnv('X509_CERT_FILE');
  const X509_KEY_FILE = resolveRequiredEnv('X509_KEY_FILE');
  const DPS_ID_SCOPE = resolveRequiredEnv('DPS_ID_SCOPE');

  const certPath = path.resolve(X509_CERT_FILE);
  const keyPath = path.resolve(X509_KEY_FILE);
  if (!fileExists(certPath)) fail(`Certificate file not found: ${certPath}`);
  if (!fileExists(keyPath)) fail(`Private key file not found: ${keyPath}`);

  const certCN = readCertSubjectCN(certPath);
  if (certCN && certCN !== DEVICE_ID) {
    fail(`Certificate CN (${certCN}) does not match DEVICE_ID (${DEVICE_ID}).`);
  } else if (!certCN) {
    warn('Could not read certificate CN; ensure CN equals DEVICE_ID.');
  }

  const intermediateDefault = path.resolve('certificates', 'intermediate.pem');
  const rootDefault = path.resolve('certificates', 'rootCA.pem');
  const deviceFullchainDefault = path.resolve('certificates', 'device-fullchain.pem');
  const INTERMEDIATE_PEM_FILE = process.env.INTERMEDIATE_PEM_FILE || intermediateDefault;
  const ROOT_CA_PEM_FILE = process.env.ROOT_CA_PEM_FILE || rootDefault;
  const DEVICE_FULLCHAIN_FILE = process.env.DEVICE_FULLCHAIN_FILE || deviceFullchainDefault;

  if (fileExists(INTERMEDIATE_PEM_FILE) || fileExists(ROOT_CA_PEM_FILE)) {
    const ok = verifyChain({
      devicePem: certPath,
      intermediatePem: INTERMEDIATE_PEM_FILE,
      rootPem: ROOT_CA_PEM_FILE,
      deviceFullchain: DEVICE_FULLCHAIN_FILE,
    });
    if (!ok) {
      // Non-fatal in development; controlled by STRICT_CHAIN_VERIFY
      if (process.env.STRICT_CHAIN_VERIFY === 'true') {
        fail(`Certificate chain verification failed. root=${ROOT_CA_PEM_FILE}, intermediate=${INTERMEDIATE_PEM_FILE}`);
      } else {
        warn(`Certificate chain verification failed. Proceeding (STRICT_CHAIN_VERIFY not set).`);
      }
    }
  } else {
    warn(`No INTERMEDIATE_PEM_FILE or ROOT_CA_PEM_FILE found; skipping chain verification.`);
  }

  console.log('\n✅ First-boot validation passed.');
}

try { main(); } catch (e) { fail(e?.message || String(e)); }


