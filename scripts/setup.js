/**
 * Setup script for Enterprise IoT Solution
 * Validates configuration and prepares the environment
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class SetupManager {
  constructor() {
    this.requiredDirs = ["logs"];
    this.configFile = "config.js";
    this.templateFile = "config.template.js";
  }

  async setup() {
    console.log("🚀 Setting up Enterprise IoT Solution...\n");

    try {
      // Create required directories
      this.createDirectories();

      // Check configuration
      this.checkConfiguration();

      // Validate Azure connectivity (basic checks)
      await this.validateConfiguration();

      // Create sample config if needed
      this.createSampleConfig();

      console.log("✅ Setup completed successfully!\n");
      console.log("📋 Next steps:");
      console.log("1. Update config.js with your Azure credentials");
      console.log("2. Run: npm run device (to start IoT device)");
      console.log("3. Run: npm run monitor (to start monitoring service)");
      console.log("\n📖 See README.md for detailed instructions");
    } catch (error) {
      console.error("❌ Setup failed:", error.message);
      process.exit(1);
    }
  }

  createDirectories() {
    console.log("📁 Creating required directories...");

    this.requiredDirs.forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`   ✓ Created: ${dir}`);
      } else {
        console.log(`   ✓ Exists: ${dir}`);
      }
    });

    console.log("");
  }

  checkConfiguration() {
    console.log("⚙️  Checking configuration...");

    if (!fs.existsSync(this.configFile)) {
      console.log(`   ⚠️  Configuration file not found: ${this.configFile}`);
      console.log(
        `   📝 Please copy ${this.templateFile} to ${this.configFile}`
      );
      return false;
    }

    try {
      const config = require(`./${this.configFile}`);
      this.validateConfigStructure(config);
      console.log("   ✓ Configuration file valid");
      return true;
    } catch (error) {
      console.log(`   ❌ Configuration error: ${error.message}`);
      return false;
    }
  }

  validateConfigStructure(config) {
    const required = {
      "dps.scopeId": config.dps?.scopeId,
      "dps.registrationId": config.dps?.registrationId,
      "dps.symmetricKey": config.dps?.symmetricKey,
      "iotHub.connectionString": config.iotHub?.connectionString,
      "device.deviceId": config.device?.deviceId,
    };

    const missing = [];
    Object.entries(required).forEach(([key, value]) => {
      if (!value || value.includes("your_") || value.includes("_here")) {
        missing.push(key);
      }
    });

    if (missing.length > 0) {
      throw new Error(
        `Missing or incomplete configuration: ${missing.join(", ")}`
      );
    }
  }

  async validateConfiguration() {
    console.log("🔍 Validating configuration...");

    try {
      const config = require(`./${this.configFile}`);

      // Validate connection string format
      this.validateConnectionString(config.iotHub.connectionString);

      // Validate DPS configuration
      this.validateDPSConfig(config.dps);

      console.log("   ✓ Configuration validation passed");
    } catch (error) {
      if (error.code === "MODULE_NOT_FOUND") {
        console.log(
          "   ⚠️  Configuration file not found - skipping validation"
        );
        return;
      }
      throw error;
    }
  }

  validateConnectionString(connectionString) {
    const parts = connectionString.split(";");
    const requiredParts = [
      "HostName",
      "SharedAccessKeyName",
      "SharedAccessKey",
    ];
    const foundParts = {};

    parts.forEach((part) => {
      const [key, value] = part.split("=");
      if (key && value) {
        foundParts[key] = value;
      }
    });

    requiredParts.forEach((part) => {
      if (!foundParts[part]) {
        throw new Error(`IoT Hub connection string missing: ${part}`);
      }
    });
  }

  validateDPSConfig(dpsConfig) {
    const required = ["scopeId", "registrationId", "symmetricKey"];

    required.forEach((field) => {
      if (!dpsConfig[field] || dpsConfig[field].includes("your_")) {
        throw new Error(`DPS configuration incomplete: ${field}`);
      }
    });
  }

  createSampleConfig() {
    if (!fs.existsSync(this.configFile) && fs.existsSync(this.templateFile)) {
      console.log("📝 Creating sample configuration...");

      const template = fs.readFileSync(this.templateFile, "utf8");

      // Generate sample values
      const sampleConfig = template
        .replace("your_device_registration_id_here", this.generateDeviceId())
        .replace("windows-device-01", this.generateDeviceId());

      fs.writeFileSync(this.configFile, sampleConfig);
      console.log(`   ✓ Created: ${this.configFile}`);
      console.log("   ⚠️  Please update with your actual Azure credentials");
    }
  }

  generateDeviceId() {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(4).toString("hex");
    return `windows-device-${timestamp}-${random}`;
  }

  displayHelp() {
    console.log(`
🏗️  Enterprise IoT Solution Setup

Commands:
  node setup.js          - Run setup and validation
  npm run device         - Start IoT device client
  npm run monitor        - Start device monitoring service

Configuration:
  1. Copy config.template.js to config.js
  2. Update with your Azure IoT Hub and DPS credentials
  3. Run setup to validate configuration

Azure Setup Required:
  - IoT Hub with service policy
  - Device Provisioning Service (DPS)
  - Device enrollment in DPS
  - Network connectivity to Azure

For detailed instructions, see README.md
`);
  }
}

// Run setup if called directly
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    new SetupManager().displayHelp();
  } else {
    new SetupManager().setup();
  }
}

module.exports = SetupManager;

