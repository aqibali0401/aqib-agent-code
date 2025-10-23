/**
 * Generate X.509 Device Certificate with Dynamic Device ID
 * This script creates a device certificate with CN based on system information
 * Format: AIO_{MODEL}_{SERIAL}
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const si = require('systeminformation');

const CERTIFICATES_DIR = path.join(__dirname, '..', 'certificates');
const DEVICE_TYPE = 'AIO';

// Normalize function (same as device-id.ts)
const normalize = (value) => value.trim().replace(/\s+/g, '-');

async function getSystemInfo() {
  console.log('🔍 Collecting system information...');
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
  console.log(`\n✅ Generated Device ID: ${deviceId}`);
  return deviceId;
}

function ensureCertificatesDir() {
  if (!fs.existsSync(CERTIFICATES_DIR)) {
    fs.mkdirSync(CERTIFICATES_DIR, { recursive: true });
  }
}

function checkRootCA() {
  const rootCertPath = path.join(CERTIFICATES_DIR, 'rootCA.pem');
  const rootKeyPath = path.join(CERTIFICATES_DIR, 'rootCA.key');
  
  if (!fs.existsSync(rootCertPath) || !fs.existsSync(rootKeyPath)) {
    console.error('❌ Error: Root CA certificate and key not found!');
    console.error('   Please run the root CA generation script first.');
    process.exit(1);
  }
  
  console.log('✅ Root CA found');
}

function generateDeviceCertificate(deviceId) {
  console.log('\n📜 Generating device certificate and private key...');
  
  const deviceKeyPath = path.join(CERTIFICATES_DIR, 'device.key');
  const deviceCsrPath = path.join(CERTIFICATES_DIR, 'device.csr');
  const deviceCertPath = path.join(CERTIFICATES_DIR, 'device.pem');
  const rootCertPath = path.join(CERTIFICATES_DIR, 'rootCA.pem');
  const rootKeyPath = path.join(CERTIFICATES_DIR, 'rootCA.key');
  const extFilePath = path.join(CERTIFICATES_DIR, 'ext.cnf');
  
  // Step 1: Generate private key for device
  console.log('   Generating private key...');
  execSync(`openssl genrsa -out "${deviceKeyPath}" 2048`, { stdio: 'inherit' });
  
  // Step 2: Create CSR with dynamic device ID as CN
  console.log(`   Creating CSR with CN=${deviceId}...`);
  execSync(
    `openssl req -new -key "${deviceKeyPath}" -out "${deviceCsrPath}" -subj "/CN=${deviceId}"`,
    { stdio: 'inherit' }
  );
  
  // Step 3: Sign the CSR with Root CA (without extension file to avoid config issues)
  console.log('   Signing certificate with Root CA...');
  execSync(
    `openssl x509 -req -in "${deviceCsrPath}" -CA "${rootCertPath}" -CAkey "${rootKeyPath}" -CAcreateserial -out "${deviceCertPath}" -days 1095 -sha256`,
    { stdio: 'inherit' }
  );
  
  // Step 5: Verify the certificate
  console.log('\n🔍 Verifying certificate...');
  execSync(`openssl verify -CAfile "${rootCertPath}" "${deviceCertPath}"`, { stdio: 'inherit' });
  
  // Step 6: Display certificate details
  console.log('\n📋 Certificate Details:');
  const certInfo = execSync(`openssl x509 -in "${deviceCertPath}" -noout -subject -dates`, { encoding: 'utf8' });
  console.log(certInfo);
  
  // Clean up CSR file
  if (fs.existsSync(deviceCsrPath)) {
    fs.unlinkSync(deviceCsrPath);
  }
  
  console.log('\n✅ Device certificate generated successfully!');
  console.log(`   Certificate: ${deviceCertPath}`);
  console.log(`   Private Key: ${deviceKeyPath}`);
}

async function main() {
  console.log('🚀 Dynamic Device Certificate Generator\n');
  console.log('=' .repeat(60));
  
  try {
    // Step 1: Ensure certificates directory exists
    ensureCertificatesDir();
    
    // Step 2: Check if Root CA exists
    checkRootCA();
    
    // Step 3: Get system information
    const { model, serial } = await getSystemInfo();
    
    // Step 4: Generate dynamic device ID
    const deviceId = generateDeviceId(model, serial);
    
    // Step 5: Generate device certificate
    generateDeviceCertificate(deviceId);
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ All done! Your device certificate is ready.');
    console.log(`\n📌 Device ID: ${deviceId}`);
    console.log('\n💡 Next steps:');
    console.log('   1. The certificate files are in the certificates/ folder');
    console.log('   2. Restart your application');
    console.log('   3. The device will register with the dynamic ID');
    console.log('=' .repeat(60));
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
main();

