/**
 * Device Certificate Signing Script
 * This script signs device certificates using an existing rootCA.pem file
 *
 * Usage:
 * node scripts/signDeviceCertificate.js [device-id]
 *
 * If no device-id is provided, it will generate one dynamically
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

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
  console.log(`⚠️  Using static device ID: ${STATIC_DEVICE_ID}`);
  return STATIC_DEVICE_ID;
}

async function signDeviceCertificate(deviceId = null) {
  console.log("🔐 Signing Device Certificate with Root CA...");

  ensureDirectoryExists(CERTIFICATES_DIR);

  // Get device ID (from parameter, dynamic, or fallback)
  if (!deviceId) {
    deviceId = await getDeviceId();
  } else {
    console.log(`✅ Using provided device ID: ${deviceId}`);
  }

  try {
    // Check if root CA files exist
    const rootCAKeyPath = path.join(CERTIFICATES_DIR, "rootCA.key");
    const rootCACertPath = path.join(CERTIFICATES_DIR, "rootCA.pem");

    if (!fs.existsSync(rootCAKeyPath) || !fs.existsSync(rootCACertPath)) {
      console.error("❌ Root CA files not found!");
      console.error(
        `   Missing: ${!fs.existsSync(rootCAKeyPath) ? "rootCA.key " : ""}${
          !fs.existsSync(rootCACertPath) ? "rootCA.pem" : ""
        }`
      );
      console.error(
        "   Please ensure both rootCA.key and rootCA.pem exist in the certificates folder."
      );
      process.exit(1);
    }

    console.log("✅ Root CA files found:");
    console.log(`   - Root CA Certificate: ${rootCACertPath}`);
    console.log(`   - Root CA Private Key: ${rootCAKeyPath}`);

    // Generate device private key
    console.log("\n1. Generating device private key...");
    const deviceKeyPath = path.join(CERTIFICATES_DIR, "device-key.pem");
    execSync(`openssl genrsa -out "${deviceKeyPath}" 4096`, {
      stdio: "inherit",
    });

    // Generate device certificate signing request
    console.log("2. Generating device certificate signing request...");
    const deviceCsrPath = path.join(CERTIFICATES_DIR, "device.csr");
    execSync(
      `openssl req -new -key "${deviceKeyPath}" -out "${deviceCsrPath}" -subj "/C=US/ST=CA/L=San Francisco/O=IoT Company/OU=IoT Division/CN=${deviceId}"`,
      { stdio: "inherit" }
    );

    // Sign device certificate with root CA
    console.log("3. Signing device certificate with Root CA...");
    const deviceCertPath = path.join(CERTIFICATES_DIR, "device-cert.pem");
    execSync(
      `openssl x509 -req -days 365 -in "${deviceCsrPath}" -CA "${rootCACertPath}" -CAkey "${rootCAKeyPath}" -CAcreateserial -out "${deviceCertPath}"`,
      { stdio: "inherit" }
    );

    // Clean up CSR file
    if (fs.existsSync(deviceCsrPath)) {
      fs.unlinkSync(deviceCsrPath);
      console.log("4. Cleaned up certificate signing request file");
    }

    console.log("\n✅ Device certificate signed successfully!");
    console.log("\n📋 Generated files:");
    console.log(`   - Device Certificate: ${deviceCertPath}`);
    console.log(`   - Device Private Key: ${deviceKeyPath}`);

    console.log(`\n🆔 Device Identity:`);
    console.log(`   - Device ID/Registration ID: ${deviceId}`);

    console.log("\n🎯 Certificate Details:");
    try {
      console.log("   Subject:");
      execSync(`openssl x509 -in "${deviceCertPath}" -noout -subject`, {
        stdio: "inherit",
      });
      console.log("   Issuer:");
      execSync(`openssl x509 -in "${deviceCertPath}" -noout -issuer`, {
        stdio: "inherit",
      });
      console.log("   Validity:");
      execSync(`openssl x509 -in "${deviceCertPath}" -noout -dates`, {
        stdio: "inherit",
      });
    } catch (error) {
      console.log("   Could not display certificate details");
    }

    console.log("\n🔍 Certificate Verification:");
    try {
      execSync(
        `openssl verify -CAfile "${rootCACertPath}" "${deviceCertPath}"`,
        {
          stdio: "inherit",
        }
      );
    } catch (error) {
      console.log(
        "   ⚠️  Certificate verification failed - please check the certificate chain"
      );
    }

    console.log("\n🔧 Next Steps:");
    console.log(
      "1. Use the generated certificate files in your IoT device configuration"
    );
    console.log(
      "2. Update your config.js file with the certificate paths (if not already configured):"
    );
    console.log(`   - certFile: "./certificates/device-cert.pem"`);
    console.log(`   - keyFile: "./certificates/device-key.pem"`);
    console.log(
      "3. Ensure your Azure IoT Hub/DPS is configured to trust the Root CA"
    );

    return {
      deviceId,
      certificatePath: deviceCertPath,
      privateKeyPath: deviceKeyPath,
      rootCACertPath,
      rootCAKeyPath,
    };
  } catch (error) {
    console.error("❌ Error signing device certificate:", error.message);
    process.exit(1);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const deviceId = args[0]; // Optional device ID parameter

  if (deviceId) {
    console.log(`🎯 Using provided device ID: ${deviceId}`);
  }

  await signDeviceCertificate(deviceId);
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { signDeviceCertificate };
