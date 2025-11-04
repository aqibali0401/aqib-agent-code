/**
 * Generate Verification Certificate for Azure IoT Hub
 * This script generates a verification certificate using the verification code from Azure portal
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const CERTIFICATES_DIR = path.join(__dirname, "..", "certificates");

function generateVerificationCertificate(verificationCode) {
  if (!verificationCode) {
    console.error("Verification code is required");
    console.log(
      "Usage: node scripts/generateVerificationCert.js <verification-code>"
    );
    console.log(
      "Get the verification code from Azure IoT Hub portal after uploading your CA certificate"
    );
    process.exit(1);
  }

  console.log("Generating verification certificate...");
  console.log(`Verification code: ${verificationCode}`);

  try {
    // Use INTERMEDIATE CA to sign verification cert (since intermediate.pem was uploaded to DPS)
    const intermediateKeyPath = path.join(CERTIFICATES_DIR, "intermediate.key");
    const intermediateCertPath = path.join(CERTIFICATES_DIR, "intermediate.pem");
    const verificationKeyPath = path.join(CERTIFICATES_DIR, "verification.key");
    const verificationCsrPath = path.join(CERTIFICATES_DIR, "verification.csr");
    const verificationCertPath = path.join(
      CERTIFICATES_DIR,
      "verification.pem"
    );

    // Check if intermediate CA files exist
    if (!fs.existsSync(intermediateKeyPath) || !fs.existsSync(intermediateCertPath)) {
      console.error(
        "Intermediate CA files not found. Run: npm run cert:intermediate"
      );
      process.exit(1);
    }

    // Generate verification key if it doesn't exist
    if (!fs.existsSync(verificationKeyPath)) {
      console.log("1. Generating verification private key...");
      execSync(`openssl genrsa -out "${verificationKeyPath}" 4096`, {
        stdio: "inherit",
      });
    } else {
      console.log("1. Using existing verification private key...");
    }

    // Generate verification certificate signing request
    console.log("2. Generating verification certificate signing request...");
    execSync(
      `openssl req -new -key "${verificationKeyPath}" -out "${verificationCsrPath}" -subj "/CN=${verificationCode}"`,
      { stdio: "inherit" }
    );

    // Generate verification certificate (signed by INTERMEDIATE CA)
    console.log("3. Generating verification certificate (signed by Intermediate CA)...");
    execSync(
      `openssl x509 -req -days 30 -in "${verificationCsrPath}" -CA "${intermediateCertPath}" -CAkey "${intermediateKeyPath}" -CAcreateserial -out "${verificationCertPath}"`,
      { stdio: "inherit" }
    );

    // Clean up CSR file
    fs.unlinkSync(verificationCsrPath);

    console.log("Verification certificate generated successfully!");
    console.log(`Verification certificate: ${verificationCertPath}`);
    console.log(`   Signed by: Intermediate CA (intermediate.pem)`);

    console.log("\nNext Steps:");
    console.log(
      "1. Upload verification.pem to Azure DPS certificate verification"
    );
    console.log(
      "2. Azure will verify and mark your Intermediate CA as 'Verified'"
    );
    console.log("3. Create enrollment group using the verified intermediate CA");
  } catch (error) {
    console.error(
      "Error generating verification certificate:",
      error.message
    );
    process.exit(1);
  }
}

// Get verification code from command line arguments
const verificationCode = process.argv[2];
generateVerificationCertificate(verificationCode);

module.exports = { generateVerificationCertificate };
