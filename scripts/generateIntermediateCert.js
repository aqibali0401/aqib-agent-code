/**
 * Generate Intermediate CA Certificate signed by Root CA
 * ONE-TIME SETUP - Run this once to create intermediate CA
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CERTIFICATES_DIR = path.join(__dirname, '..', 'certificates');

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
    console.error('   Please generate Root CA first.');
    process.exit(1);
  }
  
  console.log('✅ Root CA found');
}

function createIntermediateExtConfig() {
  const extConfigPath = path.join(CERTIFICATES_DIR, 'intermediate-ext.cnf');
  
  const config = `basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, digitalSignature, keyCertSign, cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer:always`;

  fs.writeFileSync(extConfigPath, config);
  console.log('✅ Created intermediate extension config');
  return extConfigPath;
}

function generateIntermediateCertificate() {
  console.log('\n🔐 Generating Intermediate CA...');
  
  const intermediateKeyPath = path.join(CERTIFICATES_DIR, 'intermediate.key');
  const intermediateCsrPath = path.join(CERTIFICATES_DIR, 'intermediate.csr');
  const intermediateCertPath = path.join(CERTIFICATES_DIR, 'intermediate.pem');
  const rootCertPath = path.join(CERTIFICATES_DIR, 'rootCA.pem');
  const rootKeyPath = path.join(CERTIFICATES_DIR, 'rootCA.key');
  
  // Step 1: Generate Intermediate CA private key
  console.log('   Generating Intermediate CA private key...');
  execSync(`openssl genrsa -out "${intermediateKeyPath}" 4096`, { stdio: 'inherit' });
  
  // Step 2: Create CSR for Intermediate CA
  console.log('   Creating Certificate Signing Request...');
  execSync(
    `openssl req -new -key "${intermediateKeyPath}" ` +
    `-out "${intermediateCsrPath}" ` +
    `-subj "/C=US/ST=State/O=YourCompany/CN=IntermediateCA"`,
    { stdio: 'inherit' }
  );
  
  // Step 3: Create extension config
  const extConfigPath = createIntermediateExtConfig();
  
  // Step 4: Sign Intermediate CSR with Root CA
  console.log('   Signing Intermediate CA with Root CA...');
  execSync(
    `openssl x509 -req -in "${intermediateCsrPath}" ` +
    `-CA "${rootCertPath}" -CAkey "${rootKeyPath}" ` +
    `-CAcreateserial -out "${intermediateCertPath}" ` +
    `-days 1825 -sha256 -extfile "${extConfigPath}"`,
    { stdio: 'inherit' }
  );
  
  // Step 5: Verify the Intermediate certificate
  console.log('\n🔍 Verifying Intermediate certificate...');
  execSync(`openssl verify -CAfile "${rootCertPath}" "${intermediateCertPath}"`, 
    { stdio: 'inherit' }
  );
  
  // Step 6: Display certificate details
  console.log('\n📋 Intermediate CA Certificate Details:');
  const certInfo = execSync(
    `openssl x509 -in "${intermediateCertPath}" -noout -subject -issuer -dates`,
    { encoding: 'utf8' }
  );
  console.log(certInfo);
  
  // Clean up CSR
  if (fs.existsSync(intermediateCsrPath)) {
    fs.unlinkSync(intermediateCsrPath);
  }
  
  console.log('\n✅ Intermediate CA generated successfully!');
  console.log(`   Certificate: ${intermediateCertPath}`);
  console.log(`   Private Key: ${intermediateKeyPath}`);
  console.log(`\n⚠️  IMPORTANT: Keep intermediate.key SECURE!`);
  console.log(`   In production, store it in Azure Key Vault or HSM.`);
}

function main() {
  console.log('🚀 Intermediate CA Generator\n');
  console.log('='.repeat(60));
  
  try {
    ensureCertificatesDir();
    checkRootCA();
    generateIntermediateCertificate();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Intermediate CA is ready!\n');
    console.log('📌 Next steps:');
    console.log('   1. Upload intermediate.pem to Azure DPS (NOT rootCA.pem)');
    console.log('   2. Verify intermediate.pem in DPS');
    console.log('   3. Create enrollment group using intermediate CA');
    console.log('   4. Update generateDeviceCert.js to use intermediate CA');
    console.log('   5. Store rootCA.key OFFLINE (remove from server)');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();