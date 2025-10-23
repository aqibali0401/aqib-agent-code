/**
 * Universal X.509 Certificate Generator for IoT Device Authentication
 * This script generates certificates with dynamic device IDs based on system serial number
 * Falls back to static ID if system serial is not available
 * DO NOT use these certificates in production without proper CA
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Try to import systeminformation, fallback gracefully if not available
let si;
try {
  si = require("systeminformation");
} catch (error) {
  console.warn(
    "⚠️  systeminformation module not available, using fallback method"
  );
  si = null;
}

const os = require("os");

const CERTIFICATES_DIR = path.join(__dirname, "..", "certificates");
const STATIC_DEVICE_ID = "windows-device-01"; // Fallback static ID

function ensureDirectoryExists(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
}

async function getDeviceId() {
  console.log("🔍 Determining device ID...");

  // Try to get system serial number dynamically
  if (si) {
    try {
      const system = await si.system();
      const systemSerial = system.serial || system.uuid;

      if (
        systemSerial &&
        systemSerial.trim() &&
        systemSerial !== "To be filled by O.E.M."
      ) {
        const deviceId = `device-${systemSerial}`;
        console.log(`✅ Using dynamic device ID: ${deviceId}`);
        console.log(`   System Serial: ${systemSerial}`);
        return deviceId;
      }
    } catch (error) {
      console.warn("⚠️  Could not read system information:", error.message);
    }
  }

  // Fallback to hostname if available
  try {
    const hostname = os.hostname();
    if (hostname && hostname.trim()) {
      const deviceId = `device-${hostname}`;
      console.log(`⚠️  Using hostname-based device ID: ${deviceId}`);
      console.log(`   Hostname: ${hostname}`);
      return deviceId;
    }
  } catch (error) {
    console.warn("⚠️  Could not read hostname:", error.message);
  }

  // Final fallback to static ID
  console.log(`⚠️  Using static fallback device ID: ${STATIC_DEVICE_ID}`);
  return STATIC_DEVICE_ID;
}

async function generateCertificates() {
  console.log(
    "🔐 Generating X.509 certificates for IoT Device Authentication..."
  );

  ensureDirectoryExists(CERTIFICATES_DIR);

  // Get device ID (dynamic or fallback)
  const deviceId = await getDeviceId();

  try {
    // Check if root CA already exists
    const rootCAKeyPath = path.join(CERTIFICATES_DIR, "rootCA.key");
    const rootCACertPath = path.join(CERTIFICATES_DIR, "rootCA.pem");

    let shouldGenerateRootCA =
      !fs.existsSync(rootCAKeyPath) || !fs.existsSync(rootCACertPath);

    if (shouldGenerateRootCA) {
      // Generate root CA private key
      console.log("1. Generating root CA private key...");
      execSync(`openssl genrsa -out "${rootCAKeyPath}" 4096`, {
        stdio: "inherit",
      });

      // Generate root CA certificate
      console.log("2. Generating root CA certificate...");
      execSync(
        `openssl req -new -x509 -days 365 -key "${rootCAKeyPath}" -out "${rootCACertPath}" -subj "/C=US/ST=CA/L=San Francisco/O=IoT Company/OU=IoT Division/CN=IoT Root CA"`,
        { stdio: "inherit" }
      );
    } else {
      console.log("1-2. Root CA already exists, skipping generation...");
    }

    // Always generate new device certificate (in case device ID changed)
    console.log("3. Generating device private key...");
    const deviceKeyPath = path.join(CERTIFICATES_DIR, "device-key.pem");
    execSync(`openssl genrsa -out "${deviceKeyPath}" 4096`, {
      stdio: "inherit",
    });

    // Generate device certificate signing request with dynamic device ID as CN
    console.log("4. Generating device certificate signing request...");
    const deviceCsrPath = path.join(CERTIFICATES_DIR, "device.csr");
    execSync(
      `openssl req -new -key "${deviceKeyPath}" -out "${deviceCsrPath}" -subj "/C=US/ST=CA/L=San Francisco/O=IoT Company/OU=IoT Division/CN=${deviceId}"`,
      { stdio: "inherit" }
    );

    // Generate device certificate signed by root CA
    console.log("5. Generating device certificate...");
    const deviceCertPath = path.join(CERTIFICATES_DIR, "device-cert.pem");
    execSync(
      `openssl x509 -req -days 365 -in "${deviceCsrPath}" -CA "${rootCACertPath}" -CAkey "${rootCAKeyPath}" -CAcreateserial -out "${deviceCertPath}"`,
      { stdio: "inherit" }
    );

    // Generate verification key for Azure IoT Hub (if it doesn't exist)
    const verificationKeyPath = path.join(CERTIFICATES_DIR, "verification.key");
    if (!fs.existsSync(verificationKeyPath)) {
      console.log("6. Generating verification key for Azure IoT Hub...");
      execSync(`openssl genrsa -out "${verificationKeyPath}" 4096`, {
        stdio: "inherit",
      });
    } else {
      console.log("6. Verification key already exists, skipping...");
    }

    // Clean up CSR file
    if (fs.existsSync(deviceCsrPath)) {
      fs.unlinkSync(deviceCsrPath);
    }

    console.log("\n✅ Certificates generated successfully!");
    console.log("\n📋 Generated files:");
    console.log(`   - Root CA Certificate: ${rootCACertPath}`);
    console.log(`   - Root CA Private Key: ${rootCAKeyPath}`);
    console.log(`   - Device Certificate: ${deviceCertPath}`);
    console.log(`   - Device Private Key: ${deviceKeyPath}`);
    console.log(`   - Verification Key: ${verificationKeyPath}`);

    console.log(`\n🆔 Device Identity:`);
    console.log(`   - Device ID/Registration ID: ${deviceId}`);

    console.log("\n🎯 Certificate Details:");
    try {
      execSync(`openssl x509 -in "${deviceCertPath}" -noout -subject`, {
        stdio: "inherit",
      });
    } catch (error) {
      console.log("Could not display certificate subject");
    }

    console.log("\n🔧 Next Steps:");
    console.log("1. Upload rootCA.pem to Azure IoT Hub as a CA certificate");
    console.log(
      "2. Generate proof of possession certificate when prompted by Azure:"
    );
    console.log("   npm run generate-verification <verification-code>");
    console.log(
      "3. Create DPS enrollment group with your verified CA certificate"
    );
    console.log("4. Run your device: npm run device");

    console.log("\n⚠️  IMPORTANT:");
    if (deviceId === STATIC_DEVICE_ID) {
      console.log(
        "   - Using static device ID - not suitable for multiple devices"
      );
      console.log(
        "   - Consider installing 'systeminformation' module for dynamic IDs"
      );
    } else {
      console.log(
        "   - Using dynamic device ID - suitable for multiple devices"
      );
    }
    console.log(
      "   - These are test certificates - use proper CA for production"
    );
  } catch (error) {
    console.error("❌ Error generating certificates:", error.message);
    console.log(
      "\n💡 Make sure OpenSSL is installed and available in your PATH"
    );
    console.log(
      "   Windows: Download from https://slproweb.com/products/Win32OpenSSL.html"
    );
    console.log("   macOS: brew install openssl");
    console.log("   Linux: sudo apt-get install openssl (Ubuntu/Debian)");
    process.exit(1);
  }
}

function displayCertificateInfo() {
  const certPath = path.join(CERTIFICATES_DIR, "device-cert.pem");
  if (fs.existsSync(certPath)) {
    console.log("\n📄 Current Device Certificate Information:");
    try {
      // Try Windows command first
      execSync(
        `openssl x509 -in "${certPath}" -text -noout | findstr "Subject:"`,
        { stdio: "inherit" }
      );
    } catch (error) {
      try {
        // Fallback for Unix systems
        execSync(
          `openssl x509 -in "${certPath}" -text -noout | grep "Subject:"`,
          { stdio: "inherit" }
        );
      } catch (err) {
        console.log("Could not display certificate info");
      }
    }
  }
}

// Run the script
if (require.main === module) {
  generateCertificates()
    .then(() => {
      displayCertificateInfo();
    })
    .catch((error) => {
      console.error("❌ Script failed:", error);
      process.exit(1);
    });
}

module.exports = {
  generateCertificates,
  getDeviceId,
  CERTIFICATES_DIR,
};
