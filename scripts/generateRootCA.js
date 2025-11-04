/**
 * Generate Root CA Certificate
 * ONE-TIME SETUP - Generate root CA for signing intermediate certificates
 * 
 * IMPORTANT: Store rootCA.key OFFLINE after generating intermediate CA
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

function generateRootCA() {
  console.log('Generating Root CA Certificate\n');
  console.log('='.repeat(60));

  const rootKeyPath = path.join(CERTIFICATES_DIR, 'rootCA.key');
  const rootCertPath = path.join(CERTIFICATES_DIR, 'rootCA.pem');

  // Check if Root CA already exists
  if (fs.existsSync(rootKeyPath) && fs.existsSync(rootCertPath)) {
    console.log('Root CA already exists!');
    console.log(`   Certificate: ${rootCertPath}`);
    console.log(`   Private Key: ${rootKeyPath}`);
    console.log('\nDo you want to overwrite? (This will invalidate all existing certificates)');
    console.log('   To continue, delete the existing files manually and run again.');
    process.exit(0);
  }

  try {
    // Step 1: Generate Root CA private key
    console.log('Generating Root CA private key (4096-bit RSA)...');
    execSync(`openssl genrsa -out "${rootKeyPath}" 4096`, { stdio: 'inherit' });

    // Step 2: Generate Root CA certificate (self-signed)
    console.log('Generating Root CA certificate (self-signed, 10 years)...');
    execSync(
      `openssl req -new -x509 -days 3650 ` +
      `-key "${rootKeyPath}" -out "${rootCertPath}" ` +
      `-subj "/C=US/ST=CA/L=San Francisco/O=IoT Company/OU=IoT Division/CN=IoT Root CA"`,
      { stdio: 'inherit' }
    );

    // Step 3: Display certificate details
    console.log('\nRoot CA Certificate Details:');
    const certInfo = execSync(
      `openssl x509 -in "${rootCertPath}" -noout -subject -issuer -dates`,
      { encoding: 'utf8' }
    );
    console.log(certInfo);

    console.log('\nRoot CA generated successfully!');
    console.log(`   Certificate: ${rootCertPath}`);
    console.log(`   Private Key: ${rootKeyPath}`);

    console.log('\n' + '='.repeat(60));
    console.log('Next steps:');
    console.log('   1. Generate Intermediate CA: npm run generate-intermediate');
    console.log('   2. Upload intermediate.pem to Azure DPS (NOT rootCA.pem)');
    console.log('   3. Move rootCA.key to OFFLINE storage (air-gapped/HSM)');
    console.log('   4. Keep rootCA.key secure - never expose it online!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\nError generating Root CA:', error.message);
    console.log('\nMake sure OpenSSL is installed and available in PATH');
    process.exit(1);
  }
}

function main() {
  ensureCertificatesDir();
  generateRootCA();
}

main();

