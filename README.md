# Azure IoT Edge Agent

A NestJS-based IoT Edge Agent that establishes secure X.509 certificate-based connections to Azure IoT Hub via Device Provisioning Service (DPS). The agent supports bidirectional communication, telemetry streaming, direct methods, and device twin synchronization.

## 📋 Table of Contents

- [Features](#-features)
- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
- [Certificate Generation](#-certificate-generation)
- [Configuration](#-configuration)
- [Running the Application](#-running-the-application)
- [Testing & Usage](#-testing--usage)
- [API Endpoints](#-api-endpoints)
- [Azure Integration](#-azure-integration)
- [Monitoring](#-monitoring)
- [Troubleshooting](#-troubleshooting)
- [Project Structure](#-project-structure)

---

## 🚀 Features

- ✅ **Secure X.509 Certificate Authentication** with Azure IoT Hub
- ✅ **Device Provisioning Service (DPS)** automatic provisioning
- ✅ **MQTT over WebSockets** for firewall-friendly connectivity
- ✅ **Bidirectional Communication**:
  - Device-to-Cloud (D2C): Telemetry and messages
  - Cloud-to-Device (C2D): Direct methods and notifications
- ✅ **Device Twin Synchronization** for state management
- ✅ **Health Monitoring** and status endpoints
- ✅ **Comprehensive Logging** with Winston (daily rotating files)
- ✅ **NestJS Framework** for robust, scalable architecture
- ✅ **Edge Assembly Package** integration for IoT operations

---

## 📦 Prerequisites

### Software Requirements

1. **Node.js** (v16 or later)
   - Download: https://nodejs.org/

2. **npm** (comes with Node.js)

3. **TypeScript** (globally installed recommended)
   ```powershell
   npm install -g typescript
   ```

4. **Azure CLI** (for testing and management)
   ```powershell
   # Using winget (recommended)
   winget install -e --id Microsoft.AzureCLI
   
   # Or download from: https://aka.ms/installazurecliwindows
   ```

### Azure Requirements

1. **Azure Subscription** with an active IoT Hub
2. **Device Provisioning Service (DPS)** linked to your IoT Hub
3. **DPS Enrollment Group** configured for X.509 certificate authentication
4. **Root CA Certificate** uploaded to DPS (for certificate verification)

---

## 🚀 Quick Start

### Step 1: Clone and Install

```powershell
cd aqib-agent-nest
npm install
```

### Step 2: Generate Device ID

Your device ID is based on your hardware information:

```powershell
node scripts/showDeviceId.js
```

**Example Output:**
```
✅ Generated Device ID:
════════════════════════════════════════════════════════════

  AIO_20VD_PG02W5PL

════════════════════════════════════════════════════════════
```

**Important:** Save this Device ID - you'll need it for certificate generation and configuration.

### Step 3: Generate X.509 Certificates

Generate device certificates with the correct Common Name (CN):

```powershell
node scripts/generateDynamicCert.js
```

This will:
- Generate a device certificate and private key
- Use your device ID as the Common Name (CN)
- Store certificates in `./certificates/` folder
- Create:
  - `device.pem` - Device certificate
  - `device.key` - Private key
  - `rootCA.pem` - Root CA certificate (if not exists)

**Files created:**
```
certificates/
├── device.pem       # Device certificate
├── device.key       # Private key
└── rootCA.pem       # Root CA certificate
```

### Step 4: Upload Root CA to Azure DPS

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to your **Device Provisioning Service**
3. Go to **Certificates** → **Add**
4. Upload `certificates/rootCA.pem`
5. Complete verification (generate verification certificate if needed):
   ```powershell
   node scripts/generateVerificationCert.js
   ```

### Step 5: Configure Environment Variables

Create a `.env` file in the root directory:

```env
# ============================================
# Device Identity
# ============================================
DEVICE_ID=AIO_20VD_PG02W5PL  # Use the ID from Step 2

# ============================================
# X.509 Certificate Authentication
# ============================================
USE_CERTIFICATE_AUTH=true
X509_CERT_FILE=./certificates/device.pem
X509_KEY_FILE=./certificates/device.key
X509_PASSPHRASE=

# ============================================
# Azure DPS Configuration
# ============================================
DPS_PROVISIONING_HOST=global.azure-devices-provisioning.net
DPS_ID_SCOPE=0ne0106AE1F  # Your DPS ID Scope
DPS_SECURITY_TYPE=x509
DPS_TRANSPORT_TYPE=mqtt

# ============================================
# MQTT Settings
# ============================================
USE_WEBSOCKETS=true
MQTT_WS_PATH=/mqtt

# ============================================
# Telemetry Configuration
# ============================================
ENABLE_PERIODIC_TELEMETRY=false
TELEMETRY_INTERVAL_MS=30000

# ============================================
# Application Settings
# ============================================
APP_VERSION=1.0.1
LOG_LEVEL=info
PORT=5000
```

### Step 6: Build the Application

```powershell
npm run build
```

### Step 7: Run the Application

**Development mode** (with auto-reload):
```powershell
npm run dev
```

**Production mode:**
```powershell
npm start
```

### Step 8: Verify Connection

You should see output like:

```
Agent is listening on port: 5000
========================================
🚀 Starting with Edge Assembly
========================================
Using device ID: AIO_20VD_PG02W5PL
🚀 Initializing EdgeAssembly...
✓ EdgeAssembly configuration loaded
🔗 Pairing device with Azure IoT Hub via DPS...
✓ Device paired successfully
📋 Pair Status: true
🌐 Connecting to IoT Hub...
✓ Connected to IoT Hub
🎮 Control Status: true
📡 Connection status: CONNECTED
📤 Device twin updated successfully
📥 Direct method handlers registered (reboot, upgrade, healthCheck)
📨 Cloud-to-Device message handlers registered
✅ EdgeAssembly fully initialized and connected
```

---

## 🔐 Certificate Generation

### Automatic Generation (Recommended)

```powershell
# Generate all certificates automatically
node scripts/generateDynamicCert.js
```

### Manual Certificate Setup

If you have existing certificates:

1. Place your device certificate in `./certificates/device.pem`
2. Place your private key in `./certificates/device.key`
3. Ensure the certificate CN matches your `DEVICE_ID`
4. Update `.env` with correct file paths

### Certificate Requirements

- **Format:** PEM
- **Common Name (CN):** Must exactly match your `DEVICE_ID`
- **Key Size:** 2048-bit RSA minimum
- **Validity:** Not expired
- **Chain:** Root CA must be uploaded to Azure DPS

---

## ⚙️ Configuration

### Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEVICE_ID` | ✅ | - | Unique device identifier (must match cert CN) |
| `USE_CERTIFICATE_AUTH` | ✅ | `true` | Use X.509 certificate authentication |
| `X509_CERT_FILE` | ✅ | - | Path to device certificate |
| `X509_KEY_FILE` | ✅ | - | Path to private key |
| `DPS_ID_SCOPE` | ✅ | - | Azure DPS ID Scope |
| `DPS_PROVISIONING_HOST` | ✅ | - | DPS endpoint |
| `USE_WEBSOCKETS` | ❌ | `true` | Use MQTT over WebSockets |
| `ENABLE_PERIODIC_TELEMETRY` | ❌ | `false` | Auto-send telemetry |
| `TELEMETRY_INTERVAL_MS` | ❌ | `30000` | Telemetry interval (ms) |
| `LOG_LEVEL` | ❌ | `info` | Logging level |
| `PORT` | ❌ | `5000` | HTTP server port |

### Finding Your DPS ID Scope

1. Go to [Azure Portal](https://portal.azure.com)
2. Search for "Device Provisioning Services"
3. Select your DPS instance
4. Find **ID Scope** in the Overview page

---

## 🎯 Running the Application

### Development Mode

```powershell
npm run dev
```
- Auto-reloads on file changes
- Uses `ts-node-dev`
- Ideal for development

### Production Mode

```powershell
# Build first
npm run build

# Then run
npm start
```

### Build and Package

Create a distributable package:

```powershell
npm run build:package
```

This creates `agent_nest.zip` with all compiled files and dependencies.

---

## 🧪 Testing & Usage

### Health Check

```powershell
curl http://localhost:5000/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-10-27T10:30:00.000Z"
}
```

### Check IoT Status

```powershell
curl http://localhost:5000/iot-test/status
```

**Response:**
```json
{
  "initialized": true,
  "connected": true,
  "deviceId": "AIO_20VD_PG02W5PL"
}
```

### Device-to-Cloud (D2C) Communication

#### Send Telemetry

```powershell
curl -Method POST -Uri "http://localhost:5000/iot-test/send-telemetry" `
  -Headers @{"Content-Type"="application/json"} `
  -Body '{"topic":"temperature","data":{"value":25.5,"unit":"celsius"}}'
```

#### Send Message

```powershell
curl -Method POST -Uri "http://localhost:5000/iot-test/send-message" `
  -Headers @{"Content-Type"="application/json"} `
  -Body '{"message":"Hello from device!"}'
```

#### Update Device Twin

```powershell
curl -Method POST -Uri "http://localhost:5000/iot-test/update-twin" `
  -Headers @{"Content-Type"="application/json"} `
  -Body '{"properties":{"firmwareVersion":"2.0.0","location":"Building A"}}'
```

#### Start Periodic Telemetry

```powershell
curl -Method POST -Uri "http://localhost:5000/iot-test/telemetry/start" `
  -Headers @{"Content-Type"="application/json"} `
  -Body '{"intervalMs":10000}'
```

#### Stop Periodic Telemetry

```powershell
curl -Method POST -Uri "http://localhost:5000/iot-test/telemetry/stop"
```

---

## 🌐 API Endpoints

### Health & Status

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Application health status |
| `/iot-test/status` | GET | IoT connection status |
| `/iot-test/help` | GET | Available endpoints and examples |

### Device-to-Cloud Operations

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/iot-test/send-telemetry` | POST | `{"topic": "string", "data": any}` | Send telemetry data |
| `/iot-test/send-message` | POST | `{"message": "string"}` | Send message to cloud |
| `/iot-test/update-twin` | POST | `{"properties": {}}` | Update device twin |
| `/iot-test/telemetry/start` | POST | `{"intervalMs": number}` | Start periodic telemetry |
| `/iot-test/telemetry/stop` | POST | - | Stop periodic telemetry |

---

## ☁️ Azure Integration

### Direct Methods (Cloud-to-Device Commands)

The agent handles these direct methods:

#### 1. Health Check

**Azure CLI:**
```bash
az iot hub invoke-device-method \
  --hub-name <your-hub-name> \
  --device-id AIO_20VD_PG02W5PL \
  --method-name healthCheck \
  --method-payload '{}'
```

**Azure Portal:**
1. IoT Hub → IoT devices → Select device
2. Direct Method → Method name: `healthCheck`
3. Payload: `{}`
4. Invoke Method

**Response:**
```json
{
  "status": "healthy",
  "uptime": 12345,
  "version": "1.0.1",
  "timestamp": "2025-10-27T10:30:00.000Z"
}
```

#### 2. Reboot Device

```bash
az iot hub invoke-device-method \
  --hub-name <your-hub-name> \
  --device-id AIO_20VD_PG02W5PL \
  --method-name reboot \
  --method-payload '{}'
```

#### 3. Upgrade Firmware

```bash
az iot hub invoke-device-method \
  --hub-name <your-hub-name> \
  --device-id AIO_20VD_PG02W5PL \
  --method-name upgrade \
  --method-payload '{"version": "2.0.0"}'
```

### Cloud-to-Device Messages

**Send via Azure CLI:**

```bash
# Alert message
az iot device c2d-message send \
  --hub-name <your-hub-name> \
  --device-id AIO_20VD_PG02W5PL \
  --data '{"type":"alert","payload":{"message":"High temperature detected!"}}'

# Configuration update
az iot device c2d-message send \
  --hub-name <your-hub-name> \
  --device-id AIO_20VD_PG02W5PL \
  --data '{"type":"config_update","payload":{"interval":5000}}'

# Plain text notification
az iot device c2d-message send \
  --hub-name <your-hub-name> \
  --device-id AIO_20VD_PG02W5PL \
  --data "System maintenance scheduled"
```

**Send via Azure Portal:**
1. IoT Hub → IoT devices → Select device
2. Message to Device
3. Enter message body
4. Send Message

### Message Types Handled

The agent recognizes these C2D message types:

- `alert` - Critical alerts
- `config_update` - Configuration changes
- `notification` - General notifications
- `command` - Simple commands
- Plain text - Logged as-is

---

## 📊 Monitoring

### View Device-to-Cloud Messages

#### Method 1: Azure IoT Explorer (Recommended) ⭐

1. **Download:** https://github.com/Azure/azure-iot-explorer/releases
2. **Get Connection String:**
   - Azure Portal → IoT Hub → Shared access policies → iothubowner
   - Copy "Connection string—primary key"
3. **Connect:**
   - Azure IoT Explorer → Add connection → Paste connection string
   - Find your device → Telemetry → Start
4. **View Messages** in real-time

#### Method 2: Azure CLI

```bash
# Monitor specific device
az iot hub monitor-events \
  --hub-name <your-hub-name> \
  --device-id AIO_20VD_PG02W5PL \
  --output table

# Monitor all devices
az iot hub monitor-events \
  --hub-name <your-hub-name> \
  --output table
```

#### Method 3: VS Code Extension

1. Install "Azure IoT Hub" extension
2. Set IoT Hub connection string
3. Right-click hub → Start Monitoring Built-in Event Endpoint
4. View messages in OUTPUT panel

#### Method 4: Azure Portal

1. Azure Portal → IoT Hub → Metrics
2. Add metric: "Telemetry messages sent"
3. View charts and statistics

### Find Your IoT Hub Name

**Using PowerShell script:**
```powershell
.\scripts\findIoTHub.ps1
```

**Using Azure CLI:**
```bash
az iot hub list --query "[].name" -o table
```

**Using Azure Portal:**
- Portal → Search "IoT Hub" → Your hub name is listed

### Application Logs

Logs are stored in `./logs/` with daily rotation:

```
logs/
├── combined-logs/
│   └── combined-2025-10-27.log
├── error-logs/
│   └── error-2025-10-27.log
├── exceptions/
│   └── exceptions-2025-10-27.log
└── rejections/
    └── rejections-2025-10-27.log
```

**View logs in real-time:**
```powershell
# PowerShell
Get-Content -Path ".\logs\combined-logs\combined-$(Get-Date -Format yyyy-MM-dd).log" -Wait

# CMD
tail -f logs/combined-logs/combined-2025-10-27.log
```

---

## 🔧 Troubleshooting

### Issue: "Missing required configuration values"

**Symptoms:** Application fails to start

**Solution:**
1. Verify `.env` file exists in root directory
2. Check all required variables are set:
   ```powershell
   # View your .env file
   cat .env
   ```
3. Ensure no typos in variable names
4. Restart the application

### Issue: "Failed to load X.509 certificate"

**Symptoms:** Certificate authentication fails

**Solutions:**

1. **Verify certificates exist:**
   ```powershell
   dir certificates\
   ```
   
2. **Check file paths in .env:**
   ```env
   X509_CERT_FILE=./certificates/device.pem
   X509_KEY_FILE=./certificates/device.key
   ```

3. **Regenerate certificates:**
   ```powershell
   node scripts/generateDynamicCert.js
   ```

4. **Verify certificate CN matches Device ID:**
   ```powershell
   # Windows (requires OpenSSL)
   openssl x509 -in certificates\device.pem -noout -subject
   
   # Should show: subject=CN=AIO_20VD_PG02W5PL
   ```

### Issue: "DPS registration failed"

**Symptoms:** Device can't provision through DPS

**Solutions:**

1. **Verify DPS ID Scope:**
   - Azure Portal → DPS → Overview → Copy ID Scope
   - Update `.env` with correct value

2. **Check enrollment group:**
   - DPS → Manage enrollments → Enrollment groups
   - Verify X.509 enrollment group exists
   - Ensure Root CA certificate is uploaded and verified

3. **Verify Root CA:**
   - DPS → Certificates
   - Check certificate status is "Verified"
   - If not, complete proof-of-possession verification

4. **Check device certificate chain:**
   - Device certificate must be signed by uploaded Root CA

### Issue: "Device connects but doesn't send messages"

**Symptoms:** Connection successful but no telemetry

**Solutions:**

1. **Check initialization:**
   ```powershell
   curl http://localhost:5000/iot-test/status
   ```
   
2. **Enable periodic telemetry:**
   ```env
   ENABLE_PERIODIC_TELEMETRY=true
   TELEMETRY_INTERVAL_MS=10000
   ```

3. **Send test message:**
   ```powershell
   curl -Method POST -Uri "http://localhost:5000/iot-test/send-message" `
     -Headers @{"Content-Type"="application/json"} `
     -Body '{"message":"Test"}'
   ```

4. **Check logs for errors:**
   ```powershell
   cat logs\error-logs\error-$(Get-Date -Format yyyy-MM-dd).log
   ```

### Issue: "Port already in use"

**Symptoms:** `Error: listen EADDRINUSE: address already in use :::5000`

**Solutions:**

1. **Change port in .env:**
   ```env
   PORT=5001
   ```

2. **Kill process using port 5000:**
   ```powershell
   # Find process
   netstat -ano | findstr :5000
   
   # Kill process (replace PID)
   taskkill /PID <process-id> /F
   ```

### Issue: "Cannot find module '@qsc/edge-assembly'"

**Symptoms:** Module import error

**Solutions:**

```powershell
# Reinstall edge-assembly package
cd ../edge-assembly
npm run build
cd ../aqib-agent-nest
npm install ../edge-assembly
```

### Common Azure Portal Issues

**Can't find IoT Hub:**
- Search for "IoT Hub" in portal search
- Check you're in correct subscription
- Use PowerShell script: `.\scripts\findIoTHub.ps1`

**Can't invoke direct method:**
- Verify device is connected (green status in portal)
- Check device ID is correct
- Ensure method name matches registered handlers

**Messages not appearing:**
- Use Azure IoT Explorer (easiest method)
- Verify device is sending (check app logs)
- Check you're monitoring correct hub and device

---

## 📁 Project Structure

```
aqib-agent-nest/
├── certificates/           # X.509 certificates
│   ├── device.pem         # Device certificate
│   ├── device.key         # Private key
│   └── rootCA.pem         # Root CA certificate
│
├── dist/                  # Compiled JavaScript (after build)
│
├── logs/                  # Application logs (daily rotation)
│   ├── combined-logs/
│   ├── error-logs/
│   ├── exceptions/
│   └── rejections/
│
├── node_modules/          # Dependencies
│
├── scripts/               # Utility scripts
│   ├── generateDynamicCert.js    # Generate X.509 certificates
│   ├── showDeviceId.js           # Show generated device ID
│   ├── findIoTHub.ps1            # Find IoT Hub name
│   └── ...
│
├── src/                   # TypeScript source code
│   ├── config/           # Configuration module
│   ├── constants/        # Application constants
│   ├── edge-assembly/    # EdgeAssembly service & controller
│   ├── utils/            # Utility functions
│   ├── app.module.ts     # Main application module
│   └── main.ts           # Application entry point
│
├── .env                   # Environment variables (create this)
├── package.json          # Project dependencies
├── tsconfig.json         # TypeScript configuration
└── README.md             # This file
```

### Key Files

- **`src/main.ts`** - Application entry point, bootstraps NestJS app
- **`src/edge-assembly/edge-assembly.service.ts`** - IoT communication logic
- **`src/edge-assembly/edge-assembly-test.controller.ts`** - HTTP API endpoints
- **`scripts/generateDynamicCert.js`** - Certificate generation script
- **`.env`** - Configuration (you create this)

---

## 🔄 Edge Assembly Integration

This project uses the `@qsc/edge-assembly` package for IoT operations.

**Benefits:**
- ✅ Cleaner API
- ✅ Better error handling  
- ✅ Modular architecture
- ✅ Easier to maintain
- ✅ Abstraction over Azure IoT SDK complexity

---

## 📚 Additional Resources

### Documentation

- [Azure IoT Hub Docs](https://docs.microsoft.com/en-us/azure/iot-hub/)
- [Device Provisioning Service](https://docs.microsoft.com/en-us/azure/iot-dps/)
- [X.509 Certificate Authentication](https://docs.microsoft.com/en-us/azure/iot-hub/iot-hub-x509ca-overview)
- [NestJS Documentation](https://docs.nestjs.com/)

### Tools

- [Azure IoT Explorer](https://github.com/Azure/azure-iot-explorer)
- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli)
- [VS Code Azure IoT Extension](https://marketplace.visualstudio.com/items?itemName=vsciot-vscode.azure-iot-toolkit)

### Scripts Reference

| Script | Purpose |
|--------|---------|
| `showDeviceId.js` | Display generated device ID |
| `generateDynamicCert.js` | Generate X.509 certificates |
| `generateVerificationCert.js` | Generate DPS verification cert |
| `findIoTHub.ps1` | Find your IoT Hub name |
| `testEdgeAssembly.js` | Test EdgeAssembly integration |

---

## 🤝 Support

### Getting Help

1. **Check logs:** `./logs/` directory
2. **Review troubleshooting:** See [Troubleshooting](#-troubleshooting) section above
3. **Verify configuration:** Double-check `.env` file
4. **Test connectivity:** Use `/iot-test/status` endpoint

### Common Commands Cheatsheet

```powershell
# Install dependencies
npm install

# Generate device ID
node scripts/showDeviceId.js

# Generate certificates
node scripts/generateDynamicCert.js

# Build project
npm run build

# Run development mode
npm run dev

# Run production
npm start

# Check health
curl http://localhost:5000/health

# Check IoT status
curl http://localhost:5000/iot-test/status

# Send test message
curl -Method POST -Uri "http://localhost:5000/iot-test/send-message" `
  -Headers @{"Content-Type"="application/json"} `
  -Body '{"message":"Test"}'

# Monitor Azure messages
az iot hub monitor-events --hub-name <hub-name> --device-id <device-id>

# Find IoT Hub
.\scripts\findIoTHub.ps1
```

---

## ✅ Success Checklist

Before running in production, verify:

- [ ] Node.js and npm installed
- [ ] Azure CLI installed (for management)
- [ ] Azure IoT Hub created and accessible
- [ ] DPS configured and linked to IoT Hub
- [ ] Device ID generated (`showDeviceId.js`)
- [ ] X.509 certificates generated (`generateDynamicCert.js`)
- [ ] Root CA uploaded to DPS and verified
- [ ] `.env` file created with all required variables
- [ ] Device ID matches certificate CN
- [ ] Application builds successfully (`npm run build`)
- [ ] Application connects to IoT Hub
- [ ] Can send messages to cloud
- [ ] Can receive direct methods from cloud
- [ ] Device twin updates successfully
- [ ] Logs are being written
- [ ] Health endpoint responds

---

## 📝 License

ISC

---

## 👤 Authors

- **Ashwani Goyal** - Initial work
- **Edge Assembly Team** - EdgeAssembly package integration

---

**🎉 You're all set! Happy coding!**

For questions or issues, please check the troubleshooting section or review the application logs.
