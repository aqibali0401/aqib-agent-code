/**
 * Demo script to showcase the Enterprise IoT Solution capabilities
 */

const fs = require("fs");

function displayBanner() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                        🏭 ENTERPRISE IoT SOLUTION                            ║
║                     Windows Device + Azure IoT Hub + DPS                    ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
}

function displayFeatures() {
  console.log(`
🚀 SOLUTION FEATURES:

┌─ 📱 Windows IoT Device Client (windowsIoTDevice.js)
├── ✅ Azure DPS Integration - Automatic device provisioning
├── ✅ Comprehensive System Metrics - CPU, Memory, Disk, Network, Temperature
├── ✅ Real-time Telemetry - Configurable intervals (30s default)
├── ✅ Device Twin Support - Remote configuration updates
├── ✅ Direct Methods - Remote device control (reboot, getInfo, updateConfig)
├── ✅ Heartbeat Monitoring - Device health status every minute
├── ✅ Security Features - Data sanitization, encryption, rate limiting
├── ✅ Error Recovery - Automatic reconnection with exponential backoff
└── ✅ Graceful Shutdown - Clean resource cleanup

┌─ 📊 Device Monitor Service (deviceMonitor.js)
├── ✅ Real-time Dashboard - Live device status with visual indicators
├── ✅ Device Discovery - Automatic IoT Hub device enumeration
├── ✅ Health Monitoring - System health analysis and alerts
├── ✅ Metric Analysis - Performance statistics and trends
├── ✅ Alert System - CPU >80%, Memory >85%, Disk >90%, Offline >2min
├── ✅ Direct Method Invocation - Remote device management interface
├── ✅ Historical Data - Metric history with automatic cleanup
└── ✅ Periodic Reports - Health reports every 15 minutes

┌─ 🔒 Security Manager (security.js)
├── ✅ Data Encryption - AES-256 for sensitive data protection
├── ✅ Rate Limiting - API abuse prevention (100 req/min)
├── ✅ Suspicious Activity Detection - Security monitoring and alerting
├── ✅ Audit Logging - Comprehensive security event logging
├── ✅ Configuration Validation - Security best practices enforcement
├── ✅ Data Sanitization - PII protection (hashed serials, MACs)
└── ✅ Secure Device ID Generation - Cryptographically secure identifiers
`);
}

function displaySystemMetrics() {
  console.log(`
📈 TELEMETRY DATA STRUCTURE:

{
  "timestamp": "2025-09-24T10:30:00.000Z",
  "deviceId": "windows-device-01",
  "system": {
    "uptime": 86400,           // System uptime in seconds
    "cpuUsage": 25.5,          // CPU usage percentage
    "memoryUsage": 68.2,       // Memory usage percentage
    "processes": 156,          // Number of running processes
    "temperature": 45.2,       // CPU temperature (if available)
    "loadAverage": [0.5, 0.3, 0.2]
  },
  "network": [{
    "iface": "Ethernet",
    "rx_bytes": 1024000,       // Received bytes
    "tx_bytes": 512000,        // Transmitted bytes
    "rx_errors": 0,            // Receive errors
    "tx_errors": 0             // Transmit errors
  }],
  "storage": [{
    "fs": "C:",
    "type": "NTFS",
    "size": 500000000000,      // Total size in bytes
    "used": 250000000000,      // Used space in bytes
    "available": 250000000000, // Available space in bytes
    "use": 50.0                // Usage percentage
  }]
}
`);
}

function displayDashboard() {
  console.log(`
📊 REAL-TIME MONITORING DASHBOARD:

╔══════════════════════════════════════════════════════════════╗
║                    IoT Device Monitor Dashboard              ║
╠══════════════════════════════════════════════════════════════╣
║ Total Devices: 3          System Health: HEALTHY            ║
║ Online: 2               Offline: 1                          ║
║ Devices with Alerts: 1     Total Alerts: 3                 ║
╠══════════════════════════════════════════════════════════════╣
║                        Device Status                         ║
╠══════════════════════════════════════════════════════════════╣
║ ⚠️  windows-device-01      🟢 ONLINE  Alerts: 2             ║
║    windows-device-02      🟢 ONLINE  Alerts: 0              ║
║    windows-device-03      🔴 OFFLINE Alerts: 1              ║
╚══════════════════════════════════════════════════════════════╝

🔄 Updates every 10 seconds with real-time device status
`);
}

function displayDirectMethods() {
  console.log(`
🎛️  DIRECT METHODS (Remote Device Control):

┌─ reboot
│  Payload: { "delay": 5000 }
│  Action: Gracefully reboot the device after specified delay
│
┌─ getDeviceInfo  
│  Payload: {}
│  Action: Returns comprehensive device information and status
│
└─ updateConfig
   Payload: { "telemetryInterval": 60000, "logLevel": "debug" }
   Action: Update device configuration in real-time

💡 Invoke from Azure Portal or monitoring service
`);
}

function displaySecurity() {
  console.log(`
🔐 SECURITY FEATURES:

┌─ Data Protection
├── AES-256 encryption for sensitive data
├── PII sanitization (hashed serials, MAC addresses)
├── Secure key management and rotation
└── Data validation and sanitization

┌─ Access Control  
├── Rate limiting (100 requests/minute)
├── Connection retry limits (5 attempts max)
├── Authentication validation
└── Certificate validation support

┌─ Monitoring & Alerting
├── Suspicious activity detection
├── Security audit logging
├── Configuration validation
├── Real-time threat monitoring
└── Automated incident response

┌─ Best Practices
├── Secure defaults configuration
├── Minimal data exposure
├── Comprehensive error handling
├── Graceful degradation
└── Industry compliance ready
`);
}

function displayUsage() {
  console.log(`
🚀 GETTING STARTED:

1️⃣  Configure Azure Services:
   • Create Azure IoT Hub
   • Setup Device Provisioning Service (DPS)
   • Create device enrollment
   • Update config.js with credentials

2️⃣  Start IoT Device:
   npm run device
   
3️⃣  Start Monitoring Service:
   npm run monitor

4️⃣  Monitor in Azure Portal:
   • View telemetry in IoT Hub
   • Use Device Twin for remote config
   • Invoke Direct Methods
   • Monitor device status

📋 Configuration Required:
   • DPS Scope ID, Registration ID, Symmetric Key
   • IoT Hub Service Connection String
   • Device settings and thresholds

🔧 Environment Variables Support:
   TELEMETRY_INTERVAL=30000 npm run device
   
📖 Full documentation in README.md
`);
}

function displayArchitecture() {
  console.log(`
🏗️  SOLUTION ARCHITECTURE:

┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Windows Device │────│  Azure DPS       │────│  Azure IoT Hub  │
│  (Client)       │    │  (Provisioning)  │    │  (Messages)     │
│                 │    │                  │    │                 │
│ • System Info   │    │ • Auto Provision │    │ • Telemetry     │
│ • Telemetry     │    │ • Device Enroll  │    │ • Device Twin   │
│ • Device Twin   │    │ • Security       │    │ • Direct Methods│
│ • Direct Methods│    │ • Load Balance   │    │ • Monitoring    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                                               │
         │              ┌─────────────────┐             │
         └──────────────│ Device Monitor  │─────────────┘
                        │ (Real-time)     │
                        │                 │
                        │ • Dashboard     │
                        │ • Alerts        │
                        │ • Analytics     │
                        │ • Health Check  │
                        └─────────────────┘

🔄 Data Flow:
1. Device provisions via DPS → Gets IoT Hub assignment
2. Device connects to IoT Hub → Sends telemetry & heartbeat
3. Monitor service → Discovers devices & tracks status
4. Azure Portal → Manages devices & views data
5. Direct Methods → Remote device control
6. Device Twin → Configuration synchronization
`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    displayBanner();
    console.log("Usage: node demo.js [section]");
    console.log(
      "Sections: features, metrics, dashboard, methods, security, usage, architecture"
    );
    return;
  }

  displayBanner();

  const section = args[0];

  switch (section) {
    case "features":
      displayFeatures();
      break;
    case "metrics":
      displaySystemMetrics();
      break;
    case "dashboard":
      displayDashboard();
      break;
    case "methods":
      displayDirectMethods();
      break;
    case "security":
      displaySecurity();
      break;
    case "usage":
      displayUsage();
      break;
    case "architecture":
      displayArchitecture();
      break;
    default:
      displayFeatures();
      displayUsage();
      break;
  }

  console.log(`
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🎯 Ready for Production: Industry-grade security, monitoring, and reliability │
│ 🔗 GitHub: https://github.com/your-repo/enterprise-iot-solution              │
│ 📧 Support: Create an issue for questions and assistance                     │
└─────────────────────────────────────────────────────────────────────────────┘
`);
}

if (require.main === module) {
  main();
}

module.exports = { displayBanner, displayFeatures, displayUsage };

