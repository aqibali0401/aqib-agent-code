/**
 * X.509 Certificate Setup Script
 * Automates the setup process for X.509 certificate authentication
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

console.log("🚀 Starting X.509 Certificate Setup...\n");

// Optional verification code passed via CLI
const verificationCode = process.argv[2];

// Check if OpenSSL is available
function checkOpenSSL() {
  try {
    execSync("openssl version", { stdio: "pipe" });
    console.log("✅ OpenSSL is available");
    return true;
  } catch (error) {
    console.log("❌ OpenSSL is not available");
    console.log("Please install OpenSSL:");
    console.log("  Windows: https://slproweb.com/products/Win32OpenSSL.html");
    console.log("  macOS: brew install openssl");
    console.log("  Linux: sudo apt-get install openssl");
    return false;
  }
}

// Check if config.js exists
function checkConfig() {
  const configPath = path.join(__dirname, "..", "config", "config.js");
  if (fs.existsSync(configPath)) {
    console.log("✅ config.js exists");
    return true;
  } else {
    console.log("⚠️  config.js not found");
    console.log(
      "Proceeding without config.js. You may need to create it later for runtime configuration."
    );
    return true;
  }
}

// Install required dependencies
function installDependencies() {
  console.log("📦 Installing X.509 certificate dependencies...");
  try {
    execSync("npm install azure-iot-security-x509", { stdio: "inherit" });
    console.log("✅ Dependencies installed");
    return true;
  } catch (error) {
    console.log("❌ Failed to install dependencies:", error.message);
    return false;
  }
}

// Create certificates directory
function createCertificateDirectory() {
  const certDir = path.join(__dirname, "..", "certificates");
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
    console.log("✅ Created certificates directory");
  } else {
    console.log("✅ Certificates directory exists");
  }
  return true;
}

// Check if root CA certificates exist
function checkRootCACertificates() {
  const certDir = path.join(__dirname, "..", "certificates");
  const rootCAKeyPath = path.join(certDir, "rootCA.key");
  const rootCACertPath = path.join(certDir, "rootCA.pem");

  const hasRootCAKey = fs.existsSync(rootCAKeyPath);
  const hasRootCACert = fs.existsSync(rootCACertPath);

  if (hasRootCAKey && hasRootCACert) {
    console.log("✅ Existing Root CA certificates found");
    console.log(`   - Root CA Certificate: ${rootCACertPath}`);
    console.log(`   - Root CA Private Key: ${rootCAKeyPath}`);
    return { exists: true, keyPath: rootCAKeyPath, certPath: rootCACertPath };
  } else if (hasRootCAKey || hasRootCACert) {
    console.log("⚠️  Incomplete Root CA certificates found");
    console.log(`   - rootCA.key exists: ${hasRootCAKey}`);
    console.log(`   - rootCA.pem exists: ${hasRootCACert}`);
    console.log("   Will generate missing certificates...");
    return { exists: false, partial: true };
  } else {
    console.log("ℹ️  No existing Root CA certificates found");
    console.log("   Will generate new Root CA certificates...");
    return { exists: false, partial: false };
  }
}

// Generate or use existing certificates
function generateCertificates() {
  console.log("🔐 Setting up certificates...");

  const rootCAStatus = checkRootCACertificates();

  try {
    if (rootCAStatus.exists) {
      // Use existing Root CA to sign new device certificate
      console.log(
        "🔄 Using existing Root CA to generate device certificate..."
      );
      const signScript = path.join(__dirname, "signDeviceCertificate.js");
      execSync(`node "${signScript}"`, { stdio: "inherit" });

      // Generate verification key if it doesn't exist
      const verificationKeyPath = path.join(
        __dirname,
        "..",
        "certificates",
        "verification.key"
      );
      if (!fs.existsSync(verificationKeyPath)) {
        console.log("🔑 Generating verification key...");
        execSync(`openssl genrsa -out "${verificationKeyPath}" 4096`, {
          stdio: "inherit",
        });
        console.log("✅ Verification key generated");
      } else {
        console.log("✅ Verification key already exists");
      }

      console.log("✅ Certificate setup completed using existing Root CA");
    } else {
      // Generate everything from scratch
      console.log("🔄 Generating complete certificate chain from scratch...");
      const generateScript = path.join(__dirname, "generateCertificates.js");
      execSync(`node "${generateScript}"`, { stdio: "inherit" });
      console.log("✅ Complete certificate chain generated");
    }

    return true;
  } catch (error) {
    console.log("❌ Failed to setup certificates:", error.message);
    return false;
  }
}

// Display next steps
function displayNextSteps() {
  console.log("\n🎉 X.509 Certificate setup completed!\n");
  console.log("📋 Next Steps:");
  console.log("1. Upload certificates/rootCA.pem to Azure IoT Hub");
  console.log("2. Complete certificate verification in Azure portal");
  console.log("3. Configure DPS enrollment group or individual enrollment");
  console.log("4. Update your config.js with certificate paths");
  console.log("5. Test your device connection: npm run device\n");

  console.log("📚 Documentation:");
  console.log("- X.509 Setup Guide: docs/X509_CERTIFICATE_SETUP_GUIDE.md");
  console.log("- Migration Guide: docs/X509_MIGRATION_GUIDE.md");
  console.log("- Production Guide: docs/PRODUCTION_CERTIFICATE_GUIDE.md\n");

  console.log("🔧 Useful Commands:");
  console.log("- Generate certificates: npm run generate-certs");
  console.log(
    "- Sign device certificate: npm run sign-certificate [device-id]"
  );
  console.log(
    "- Generate verification cert: npm run generate-verification <code>"
  );
  console.log("- Run device: npm run device");
  console.log("- Run Event Hub monitor: npm run monitor:eventhub");
  console.log("- Run IoT Hub monitor: npm run monitor:iothub\n");

  console.log("⚠️  Remember: These are test certificates only!");
  console.log("   Use proper CA-issued certificates for production.\n");
}

// Main setup function
async function setup() {
  const steps = [
    { name: "Checking OpenSSL", fn: checkOpenSSL },
    { name: "Installing dependencies", fn: installDependencies },
    { name: "Creating certificate directory", fn: createCertificateDirectory },
    { name: "Checking configuration", fn: checkConfig },
    { name: "Setting up certificates", fn: generateCertificates },
  ];

  for (const step of steps) {
    console.log(`\n🔄 ${step.name}...`);
    if (!step.fn()) {
      console.log(`\n❌ Setup failed at: ${step.name}`);
      process.exit(1);
    }
  }

  // If a verification code was provided, generate the verification certificate now
  if (verificationCode) {
    try {
      console.log("\n🔄 Generating verification certificate using provided code...");
      const genScript = path.join(__dirname, "generateVerificationCert.js");
      execSync(`node "${genScript}" ${verificationCode}`, { stdio: "inherit" });
    } catch (err) {
      console.log("❌ Failed to generate verification certificate:", err.message);
      process.exit(1);
    }
  }

  displayNextSteps();
}

// Run setup if this script is executed directly
if (require.main === module) {
  setup().catch((error) => {
    console.error("❌ Setup failed:", error);
    process.exit(1);
  });
}

module.exports = { setup };
