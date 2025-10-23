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
    console.error("❌ Verification code is required");
    console.log(
      "Usage: node scripts/generateVerificationCert.js <verification-code>"
    );
    console.log(
      "Get the verification code from Azure IoT Hub portal after uploading your CA certificate"
    );
    process.exit(1);
  }

  console.log("🔐 Generating verification certificate...");
  console.log(`Verification code: ${verificationCode}`);

  try {
    const rootCAKeyPath = path.join(CERTIFICATES_DIR, "rootCA.key");
    const rootCACertPath = path.join(CERTIFICATES_DIR, "rootCA.pem");
    const verificationKeyPath = path.join(CERTIFICATES_DIR, "verification.key");
    const verificationCsrPath = path.join(CERTIFICATES_DIR, "verification.csr");
    const verificationCertPath = path.join(
      CERTIFICATES_DIR,
      "verification.pem"
    );

    // Check if root CA files exist
    if (!fs.existsSync(rootCAKeyPath) || !fs.existsSync(rootCACertPath)) {
      console.error(
        "❌ Root CA files not found. Run generateTestCertificates.js first."
      );
      process.exit(1);
    }

    // Generate verification certificate signing request
    console.log("1. Generating verification certificate signing request...");
    execSync(
      `openssl req -new -key "${verificationKeyPath}" -out "${verificationCsrPath}" -subj "/CN=${verificationCode}"`,
      { stdio: "inherit" }
    );

    // Generate verification certificate
    console.log("2. Generating verification certificate...");
    execSync(
      `openssl x509 -req -days 30 -in "${verificationCsrPath}" -CA "${rootCACertPath}" -CAkey "${rootCAKeyPath}" -CAcreateserial -out "${verificationCertPath}"`,
      { stdio: "inherit" }
    );

    // Clean up CSR file
    fs.unlinkSync(verificationCsrPath);

    console.log("✅ Verification certificate generated successfully!");
    console.log(`📄 Verification certificate: ${verificationCertPath}`);

    console.log("\n🔧 Next Steps:");
    console.log(
      "1. Upload the verification certificate to Azure IoT Hub portal"
    );
    console.log(
      "2. Azure will verify the certificate and mark your CA as verified"
    );
    console.log("3. You can now use device certificates signed by this CA");
  } catch (error) {
    console.error(
      "❌ Error generating verification certificate:",
      error.message
    );
    process.exit(1);
  }
}

// Get verification code from command line arguments
const verificationCode = process.argv[2];
generateVerificationCertificate(verificationCode);

module.exports = { generateVerificationCertificate };
