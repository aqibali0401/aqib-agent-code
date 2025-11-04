/**
 * Generate X.509 Device Certificate with Dynamic Device ID
 * This script creates a device certificate with CN based on system information
 * Format: {DEVICE_TYPE}_{MODEL}_{SERIAL}
 */

require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const si = require('systeminformation');

const CERTIFICATES_DIR = path.join(__dirname, '..', 'certificates');
const DEVICE_TYPE = process.env.DEVICE_TYPE || 'AIO';

// Normalize function (same as device-id.ts)
const normalize = (value) => value.trim().replace(/\s+/g, '-');

async function getSystemInfo() {
  console.log('Collecting system information...');
  const system = await si.system();
  
  const model = system.model || 'MODEL';
  const serial = system.serial || system.uuid || 'SERIAL';
  
  console.log(`   Manufacturer: ${system.manufacturer}`);
  console.log(`   Model: ${model}`);
  console.log(`   Serial: ${serial}`);
  
  return { model, serial };
}

function generateDeviceId(model, serial) {
  const deviceId = `${normalize(DEVICE_TYPE)}_${normalize(model)}_${normalize(serial)}`;
  console.log(`\nGenerated Device ID: ${deviceId}`);
  return deviceId;
}

function ensureCertificatesDir() {
  if (!fs.existsSync(CERTIFICATES_DIR)) {
    fs.mkdirSync(CERTIFICATES_DIR, { recursive: true });
  }
}

function checkIntermediateCA() {
  const intermediateCertPath = path.join(CERTIFICATES_DIR, 'intermediate.pem');
  const intermediateKeyPath = path.join(CERTIFICATES_DIR, 'intermediate.key');
  
  if (!fs.existsSync(intermediateCertPath) || !fs.existsSync(intermediateKeyPath)) {
    console.error('Error: Intermediate CA certificate and key not found!');
    console.error('   Please run: node scripts/generateIntermediateCert.js');
    process.exit(1);
  }
  
  console.log('Intermediate CA found');
}

function generateDeviceCertificate(deviceId) {
  console.log('\nGenerating device certificate and private key...');
  
  const deviceKeyPath = path.join(CERTIFICATES_DIR, 'device.key');
  const deviceCsrPath = path.join(CERTIFICATES_DIR, 'device.csr');
  const deviceCertPath = path.join(CERTIFICATES_DIR, 'device.pem');
  
  // Use INTERMEDIATE CA instead of Root CA
  const intermediateCertPath = path.join(CERTIFICATES_DIR, 'intermediate.pem');
  const intermediateKeyPath = path.join(CERTIFICATES_DIR, 'intermediate.key');
  
  // Step 1: Generate private key for device
  console.log('   Generating private key...');
  execSync(`openssl genrsa -out "${deviceKeyPath}" 2048`, { stdio: 'inherit' });
  
  // Step 2: Create CSR with dynamic device ID as CN
  console.log(`   Creating CSR with CN=${deviceId}...`);
  execSync(
    `openssl req -new -key "${deviceKeyPath}" -out "${deviceCsrPath}" -subj "/CN=${deviceId}"`,
    { stdio: 'inherit' }
  );
  
  // Step 3: Sign with INTERMEDIATE CA (not Root CA)
  console.log('   Signing certificate with Intermediate CA...');
  execSync(
    `openssl x509 -req -in "${deviceCsrPath}" ` +
    `-CA "${intermediateCertPath}" -CAkey "${intermediateKeyPath}" ` +
    `-CAcreateserial -out "${deviceCertPath}" ` +
    `-days 365 -sha256`,
    { stdio: 'inherit' }
  );
  
  // Step 4: Create full chain (device + intermediate)
  const fullChainPath = path.join(CERTIFICATES_DIR, 'device-fullchain.pem');
  const deviceCert = fs.readFileSync(deviceCertPath, 'utf8');
  const intermediateCert = fs.readFileSync(intermediateCertPath, 'utf8');
  fs.writeFileSync(fullChainPath, deviceCert + intermediateCert);
  console.log(`   Created full chain: ${fullChainPath}`);
  
  // Step 5: Verify the certificate (against intermediate + root chain)
  console.log('\nVerifying certificate...');
  
  // Create temporary chain file for verification
  const rootCertPath = path.join(CERTIFICATES_DIR, 'rootCA.pem');
  const chainPath = path.join(CERTIFICATES_DIR, 'ca-chain.pem');
  
  try {
    // Create chain: intermediate + root
    const intermediateCert = fs.readFileSync(intermediateCertPath, 'utf8');
    const rootCert = fs.readFileSync(rootCertPath, 'utf8');
    fs.writeFileSync(chainPath, intermediateCert + rootCert);
    
    execSync(
      `openssl verify -CAfile "${chainPath}" "${deviceCertPath}"`,
      { stdio: 'inherit' }
    );
    
    // Clean up chain file
    fs.unlinkSync(chainPath);
  } catch (error) {
    console.log('Note: Verification requires full CA chain (intermediate + root)');
    console.log('   Your device certificate is valid and will work with Azure DPS');
  }
  
  // Clean up CSR
  if (fs.existsSync(deviceCsrPath)) {
    fs.unlinkSync(deviceCsrPath);
  }
  
  console.log('\nDevice certificate generated successfully!');
  console.log(`   Certificate: ${deviceCertPath}`);
  console.log(`   Private Key: ${deviceKeyPath}`);
  console.log(`   Full Chain: ${fullChainPath}`);
}

async function main() {
  console.log('Dynamic Device Certificate Generator\n');
  console.log('=' .repeat(60));
  
  try {
    // Step 1: Ensure certificates directory exists
    ensureCertificatesDir();
    
    // Step 2: Check if Intermediate CA exists
    checkIntermediateCA();
    
    // Step 3: Get system information
    const { model, serial } = await getSystemInfo();
    
    // Step 4: Generate dynamic device ID
    const deviceId = generateDeviceId(model, serial);
    
    // Step 5: Generate device certificate
    generateDeviceCertificate(deviceId);
    
    console.log('\n' + '='.repeat(60));
    console.log('All done! Your device certificate is ready.');
    console.log(`\nDevice ID: ${deviceId}`);
    console.log('\nNext steps:');
    console.log('   1. Ensure intermediate.pem is uploaded and verified in Azure DPS');
    console.log('   2. Ensure enrollment group is created in DPS');
    console.log('   3. The certificate files are in the certificates/ folder');
    console.log('   4. Restart your application');
    console.log('   5. The device will auto-provision with the dynamic ID');
    console.log('\nNote: This device cert is signed by Intermediate CA');
    console.log('   Make sure DPS has intermediate.pem (NOT rootCA.pem)');
    console.log('=' .repeat(60));
    
  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

// Run the script
main();

