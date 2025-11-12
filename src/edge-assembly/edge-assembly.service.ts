import {
  Injectable,
  OnModuleInit,
  Inject,
  LoggerService,
} from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { EdgeAssembly } from '@qsc/edge-assembly';
import type { IConfig } from '@qsc/edge-assembly/dist/interfaces';
import type { ConfigService as EdgeConfigService } from '@qsc/edge-assembly/dist/services/config';
import { formatDeviceId } from '../utils/device-id';
import { getHostDeviceSnapshot } from '../utils/device-info';
import {
  parseBoolean,
  parseNumber,
  parseSecurityType,
  parseTransportType,
  resolveLoggerLevel,
} from '../utils/config-parsers';
import { DEVICE_TYPE, EVENT_TYPE } from '../constants/app.constants';
import * as path from 'path';
import * as fs from 'fs';

type ConfigServiceContract = Pick<
  EdgeConfigService,
  'getConfig' | 'getAzureConfig' | 'get' | 'has' | 'validateRequired'
>;

class StaticConfigService implements ConfigServiceContract {
  constructor(private readonly config: IConfig) {}

  getConfig(): IConfig {
    return this.config;
  }

  getAzureConfig(): IConfig['azure'] {
    return this.config.azure;
  }

  get<T = any>(keyPath: string): T | undefined {
    return keyPath
      .split('.')
      .reduce<any>((obj, key) => (obj === undefined || obj === null ? undefined : obj[key]), this.config);
  }

  has(keyPath: string): boolean {
    const value = this.get(keyPath);
    return value !== undefined && value !== null && value !== '';
  }

  validateRequired(requiredKeys: string[]): void {
    const missing = requiredKeys.filter((key) => !this.has(key));
    if (missing.length > 0) {
      throw new Error(`Missing required configuration values: ${missing.join(', ')}`);
    }
  }
}

interface DeviceConfigurationContext {
  deviceId: string;
  snapshot: any;
  certFile: string;
  keyFile: string;
}

@Injectable()
export class EdgeAssemblyService implements OnModuleInit {
  private edgeDevice: EdgeAssembly | null = null;
  private isInitialized = false;
  private telemetryInterval: NodeJS.Timeout | null = null;
  private deviceId: string | null = null;

  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService
  ) {}

  async onModuleInit() {
    // Intentionally left blank to delay initialization until after app start
  }

  /**
   * Prepare device-specific configuration dynamically
   * This ensures all device-specific env variables are set before EdgeAssembly initialization
   */
  private async prepareDeviceConfiguration(): Promise<DeviceConfigurationContext> {
    // Get device information from system
    const snapshot = await getHostDeviceSnapshot();
    const model = snapshot.system.model || 'MODEL';
    const serial = snapshot.system.serial || snapshot.system.uuid || 'SERIAL';

    // Generate device ID dynamically (must match certificate CN)
    this.deviceId = formatDeviceId(DEVICE_TYPE, model, serial);
    this.logger.log(`Generated device ID: ${this.deviceId}`);

    const projectRoot = process.cwd();

    const certFileFromEnv = process.env.X509_CERT_FILE;
    const keyFileFromEnv = process.env.X509_KEY_FILE;

    if (!certFileFromEnv) {
      throw new Error(
        'Environment variable X509_CERT_FILE is not set. Please provide the certificate path in the environment.'
      );
    }

    if (!keyFileFromEnv) {
      throw new Error(
        'Environment variable X509_KEY_FILE is not set. Please provide the private key path in the environment.'
      );
    }

    const resolveFilePath = (filePath: string): string =>
      path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);

    const certFileAbsolute = resolveFilePath(certFileFromEnv);
    const keyFileAbsolute = resolveFilePath(keyFileFromEnv);

    if (!fs.existsSync(certFileAbsolute)) {
      throw new Error(
        `Device certificate not found at: ${certFileAbsolute}\n` +
        `Please generate certificate with: node scripts/generateDynamicCert.js`
      );
    }
    if (!fs.existsSync(keyFileAbsolute)) {
      throw new Error(
        `Device private key not found at: ${keyFileAbsolute}\n` +
        `Please generate certificate with: node scripts/generateDynamicCert.js`
      );
    }

    const certFile = certFileFromEnv.replace(/\\/g, '/');
    const keyFile = keyFileFromEnv.replace(/\\/g, '/');

    this.logger.log(`-----Device configuration prepared:`);
    this.logger.log(`  DEVICE_ID: ${this.deviceId}`);
    this.logger.log(`  X509_CERT_FILE: ${certFile}`);
    this.logger.log(`  X509_KEY_FILE: ${keyFile}`);

    return {
      deviceId: this.deviceId,
      snapshot,
      certFile,
      keyFile,
    };
  }

  private buildEdgeAssemblyConfig(context: DeviceConfigurationContext): IConfig {
    const passphrase =
      process.env.X509_KEY_PASSPHRASE || process.env.X509_PASSPHRASE || undefined;

    return {
      azure: {
        iot: {
          deviceId: context.deviceId,
          useCertificateAuth: parseBoolean(process.env.USE_CERTIFICATE_AUTH, true),
          x509: {
            certFile: context.certFile,
            keyFile: context.keyFile,
            passphrase,
          },
          mqtt: {
            useWebsockets: parseBoolean(process.env.USE_WEBSOCKETS, false),
            websocketPath: process.env.MQTT_WS_PATH || '/mqtt',
          },
          telemetry: {
            intervalMs: parseNumber(process.env.TELEMETRY_INTERVAL_MS, 5000),
          },
        },
        dps: {
          registrationId: process.env.DPS_REGISTRATION_ID || context.deviceId,
          transportType: parseTransportType(process.env.DPS_TRANSPORT_TYPE),
          registrationConfig: {
            provisioningHost:
              process.env.DPS_PROVISIONING_HOST || 'global.azure-devices-provisioning.net',
            idScope: process.env.DPS_ID_SCOPE || '',
          },
          securityType: parseSecurityType(process.env.DPS_SECURITY_TYPE),
        },
      },
      logger: {
        level: resolveLoggerLevel(process.env.EDGE_ASSEMBLY_LOG_LEVEL || process.env.LOG_LEVEL),
      },
    };
  }

  private ensureEdgeDeviceInitialized(): EdgeAssembly {
    if (!this.edgeDevice) {
      throw new Error('EdgeAssembly instance has not been initialized');
    }
    return this.edgeDevice;
  }

  /**
   * Initialize EdgeAssembly after the application starts
   * This method should be called from main.ts after the app starts listening
   */
  async initializeAfterAppStart() {
    if (this.isInitialized) {
      this.logger.warn('EdgeAssembly already initialized');
      return;
    }

    try {
      // Prepare device-specific configuration (sets env vars dynamically)
      const { deviceId, snapshot, certFile, keyFile } = await this.prepareDeviceConfiguration();

      const config = this.buildEdgeAssemblyConfig({ deviceId, snapshot, certFile, keyFile });
      const configService = new StaticConfigService(config);
      this.edgeDevice = new EdgeAssembly(configService as unknown as EdgeConfigService);

      this.logger.log('Initializing EdgeAssembly with explicit configuration...');
      await this.ensureEdgeDeviceInitialized().init();
      this.logger.log('EdgeAssembly configuration loaded');

      // Pair device with IoT Hub via DPS
      this.logger.log('Pairing device with Azure IoT Hub via DPS...');
      await this.ensureEdgeDeviceInitialized().pair();
      this.logger.log('Device paired successfully');

      // Check pair status
      const pairStatus = await this.ensureEdgeDeviceInitialized().getPairStatus();
      this.logger.log(`Pair Status: ${pairStatus}`);

      // Connect to IoT Hub
      this.logger.log('Connecting to IoT Hub...');
      await this.ensureEdgeDeviceInitialized().connect();
      this.logger.log('Connected to IoT Hub');

      // Verify connection status
      const ctrlStatus = await this.ensureEdgeDeviceInitialized().getCtrlStatus();
      this.logger.log(`Control Status: ${ctrlStatus}`);

      // Ping to verify connectivity
      const isConnected = await this.ensureEdgeDeviceInitialized().ping();
      this.logger.log(
        `Connection status: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'}`
      );

      // Sync initial device state (twin properties)
      await this.syncDeviceState(snapshot);

      // Register command handlers
      this.registerCommandHandlers();

      // Mark initialized before sending first telemetry to avoid guard failures
      this.isInitialized = true;

      // Send initial connection message/telemetry
      try {
        const deviceConnectPayload = this.buildDeviceTelemetryPayload(snapshot, deviceId);
        await this.sendTelemetry('deviceConnected', deviceConnectPayload);
        this.logger.log('Initial device connection telemetry sent successfully');
      } catch (error) {
        this.logger.warn(`Failed to send initial device connection telemetry: ${error instanceof Error ? error.message : String(error)}`);
        // Don't fail initialization if message sending fails
      }

      // Start periodic telemetry (optional - can be enabled/disabled via env)
      if (process.env.ENABLE_PERIODIC_TELEMETRY === 'true') {
        this.startPeriodicTelemetry();
      }

      this.logger.log('EdgeAssembly fully initialized and connected');
    } catch (error) {
      this.logger.error('Failed to initialize EdgeAssembly:', error);
      throw error;
    }
  }

  /**
   * Sync device state with IoT Hub (update device twin)
   */
  private async syncDeviceState(snapshot: any) {
    try {
      const desiredProperties = {
        firmwareVersion: process.env.APP_VERSION || '1.0.0',
        hostname: snapshot.hostname,
        model: snapshot.system.model,
        serial: snapshot.system.serial,
        uptime: snapshot.uptime,
        status: 'online',
        firstTimeRegistration: true,
        lastStartup: new Date().toISOString(),
        manufacturer: snapshot.system.manufacturer,
        deviceType: DEVICE_TYPE,
      };

      await this.ensureEdgeDeviceInitialized().syncState(desiredProperties);
      this.logger.log('Device twin updated successfully');
    } catch (error) {
      this.logger.error('Failed to sync device state:', error);
      throw error;
    }
  }

  /**
   * Register handlers for cloud-to-device commands (direct methods)
   */
  private registerCommandHandlers() {
    // Register Direct Method handlers (Request-Response)
    this.registerDirectMethods();

    // Register Cloud-to-Device Message handlers (One-way notifications)
    this.registerMessageHandlers();
  }

  /**
   * Register direct method handlers (request-response pattern)
   */
  private registerDirectMethods() {
    const edgeDevice = this.ensureEdgeDeviceInitialized();

    // Reboot command handler
    edgeDevice.onRequest('reboot', async (requestId, data) => {
      this.logger.log(`Reboot command received [${requestId}]:`, data);

      try {
        // Add your reboot logic here
        // Example: execSync('shutdown /r /t 10'); // Windows
        // Example: execSync('sudo reboot'); // Linux

        return {
          status: 'success',
          message: 'Rebooting device...',
          timestamp: new Date().toISOString(),
          requestId,
        };
      } catch (error) {
        this.logger.error('Error handling reboot command:', error);
        return {
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
          requestId,
        };
      }
    });

    // Upgrade command handler
    edgeDevice.onRequest('upgrade', async (requestId, data) => {
      this.logger.log(`Upgrade command received [${requestId}]:`, data);

      try {
        const payload = typeof data === 'string' ? JSON.parse(data) : data;
        const version = payload.version;

        if (!version) {
          throw new Error('Upgrade version missing');
        }

        // Add your upgrade logic here
        // Example: Download new version, extract, restart

        return {
          status: 'success',
          message: `Upgrading device to version ${version}...`,
          currentVersion: process.env.APP_VERSION,
          targetVersion: version,
          timestamp: new Date().toISOString(),
          requestId,
        };
      } catch (error) {
        this.logger.error('Error handling upgrade command:', error);
        return {
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
          requestId,
        };
      }
    });

    // Custom health check command
    edgeDevice.onRequest('healthCheck', async (requestId, data) => {
      this.logger.log(`Health check requested [${requestId}]`);

      try {
        const snapshot = await getHostDeviceSnapshot();

        return {
          status: 'healthy',
          uptime: snapshot.uptime,
          version: process.env.APP_VERSION,
          timestamp: new Date().toISOString(),
          requestId,
        };
      } catch (error) {
        return {
          status: 'unhealthy',
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
          requestId,
        };
      }
    });

    // Get device information
    edgeDevice.onRequest('getDeviceInfo', async (requestId, data) => {
      this.logger.log(`Get device info requested [${requestId}]`);

      try {
        return {
          status: 'success',
          deviceId: this.deviceId || process.env.DEVICE_ID || 'unknown',
          deviceType: DEVICE_TYPE,
          timestamp: new Date().toISOString(),
          requestId,
        };
      } catch (error) {
        this.logger.error('Error getting device info:', error);
        return {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          requestId,
        };
      }
    });

    this.logger.log('Direct method handlers registered (reboot, upgrade, healthCheck, getDeviceInfo)');
  }

  /**
   * Register cloud-to-device message handlers (one-way notifications)
   * 
   * NOTE: Updated for @qsc/edge-assembly v0.0.0 - now supports C2D messages
   * Messages are automatically received by AzureAdapter and routed to registered handlers
   */
  private registerMessageHandlers() {
    try {
      // Access the AzureAdapter through the edge-assembly's internal plugin
      // The edge-assembly package uses a plugin pattern internally
      const edgeDeviceAny = this.ensureEdgeDeviceInitialized() as any;
      
      // Try to access the plugin property (it's internal but we can access it)
      // The plugin structure: edgeDevice.plugin.connectivityPlugin
      if (edgeDeviceAny.plugin && edgeDeviceAny.plugin.connectivityPlugin) {
        const azureAdapter = edgeDeviceAny.plugin.connectivityPlugin;

        // CRITICAL FIX: Patch the _handleIncomingMessage method to handle both JSON and plain text
        // The original implementation tries to parse ALL messages as JSON, which fails for plain text
        const originalHandleIncomingMessage = azureAdapter._handleIncomingMessage.bind(azureAdapter);
        
        azureAdapter._handleIncomingMessage = (message: any) => {
          let payload: any;
          let messageProcessed = false;
          const messageType = message.properties?.getValue?.('type') || 'unknown';
          
          try {
            // Try to parse as JSON first
            const messageData = message.getData().toString();
            try {
              payload = JSON.parse(messageData);
              // Log JSON messages at debug level if available, otherwise use log
              if (this.logger.debug) {
                this.logger.debug(`Received JSON message: ${JSON.stringify(payload)}`);
              } else {
                this.logger.log(`Received JSON message: ${JSON.stringify(payload)}`);
              }
            } catch (parseError) {
              // It's plain text, not JSON - handle it as plain text
              payload = messageData;
              // Log plain text messages at debug level if available, otherwise use log
              if (this.logger.debug) {
                this.logger.debug(`Received plain text message: ${payload}`);
              } else {
                this.logger.log(`Received plain text message: ${payload}`);
              }
              
              // Call the handler for plain text messages
              const handler = azureAdapter._getMessageHandler(messageType);
              if (handler) {
                handler(message, payload);
                messageProcessed = true;
              } else {
                // No handler registered, handle as plain text
                this.handlePlainTextMessage(payload);
                messageProcessed = true;
              }
              
              // Acknowledge the message
              azureAdapter._acknowledgeMessage(message, messageProcessed);
              return;
            }
            
            // For JSON messages, proceed with normal handler logic
            const handler = azureAdapter._getMessageHandler(messageType);
            if (handler) {
              handler(message, payload);
              messageProcessed = true;
            } else {
              this.logger.warn(`No handler registered for message type: ${messageType}`);
              // Try to handle as generic JSON message
              this.handleCloudMessage(payload);
              messageProcessed = true;
            }
          } catch (error) {
            this.logger.error(`Error processing received message: ${error instanceof Error ? error.message : String(error)}`);
            // Try to handle as plain text if it's a string
            try {
              const messageData = message.getData().toString();
              this.handlePlainTextMessage(messageData);
              messageProcessed = true;
            } catch (fallbackError) {
              // Ignore fallback errors
            }
          }
          
          // Acknowledge the message
          azureAdapter._acknowledgeMessage(message, messageProcessed);
        };

        // Register a catch-all handler for 'unknown' type (default when no type property is set)
        azureAdapter.registerMessageHandler('unknown', (message: any, payload: any) => {
          this.handleIncomingMessage(message, payload);
        });

        // Register handlers for specific message types
        azureAdapter.registerMessageHandler('alert', (message: any, payload: any) => {
          this.handleIncomingMessage(message, payload);
        });

        azureAdapter.registerMessageHandler('config_update', (message: any, payload: any) => {
          this.handleIncomingMessage(message, payload);
        });

        azureAdapter.registerMessageHandler('notification', (message: any, payload: any) => {
          this.handleIncomingMessage(message, payload);
        });

        azureAdapter.registerMessageHandler('command', (message: any, payload: any) => {
          this.handleIncomingMessage(message, payload);
        });

        this.logger.log('Cloud-to-Device message handlers registered successfully');
      } else {
        this.logger.warn('Could not access AzureAdapter - C2D messages may not be handled properly');
        this.logger.warn('This may cause JSON parsing errors for plain text messages');
      }
    } catch (error) {
      this.logger.error('Failed to register C2D message handlers:', error);
      this.logger.warn('C2D messages may not be handled properly');
    }
  }

  /**
   * Handle incoming cloud-to-device messages
   * This method handles both JSON and plain text messages
   */
  private handleIncomingMessage(message: any, payload: any) {
    try {
      // The payload might already be parsed as JSON, or it might be a string
      let parsedPayload: any;
      
      if (typeof payload === 'string') {
        // Try to parse as JSON, but handle plain text gracefully
        try {
          parsedPayload = JSON.parse(payload);
        } catch (parseError) {
          // It's plain text, not JSON
          this.logger.log(`Plain text message received: ${payload}`);
          this.handlePlainTextMessage(payload);
          return;
        }
      } else {
        // Already parsed or is an object
        parsedPayload = payload;
      }

      // Handle structured JSON messages
      this.handleCloudMessage(parsedPayload);
    } catch (error) {
      this.logger.error(`Error handling incoming message: ${error instanceof Error ? error.message : String(error)}`);
      // If payload is a string, try to handle it as plain text
      if (typeof payload === 'string') {
        this.logger.log(`Treating as plain text message: ${payload}`);
        this.handlePlainTextMessage(payload);
      }
    }
  }

  /**
   * Handle plain text messages
   */
  private handlePlainTextMessage(message: string) {
    this.logger.log(`Plain text C2D message: ${message}`);
    // You can add custom logic here for plain text messages
    // For example, you might want to log them, display them, or trigger specific actions
  }

  /**
   * Handle parsed cloud-to-device messages (JSON format)
   */
  private handleCloudMessage(message: any) {
    const { type, payload, timestamp } = message;

    this.logger.log(`Message Type: ${type || 'unknown'}`);
    this.logger.log(`Payload:`, payload);

    // Handle different message types
    switch (type) {
      case 'alert':
        this.logger.warn(`Alert received: ${payload?.message || JSON.stringify(payload)}`);
        break;

      case 'config_update':
        this.logger.log(`Configuration update: ${JSON.stringify(payload)}`);
        // Update your application configuration here
        break;

      case 'notification':
        this.logger.log(`Notification: ${payload?.message || JSON.stringify(payload)}`);
        break;

      case 'command':
        this.logger.log(`Command: ${payload?.command || JSON.stringify(payload)}`);
        // Execute command logic here
        break;

      default:
        this.logger.log(`Unknown message type: ${type || 'none'}`);
        this.logger.log(`Full message: ${JSON.stringify(message)}`);
    }
  }

  /**
   * Build standard device telemetry payload
   * @param snapshot - Device snapshot from getHostDeviceSnapshot()
   * @param fallbackDeviceId - Optional fallback device ID if this.deviceId is not set
   * @returns Standardized telemetry payload
   */
  private buildDeviceTelemetryPayload(snapshot: any, fallbackDeviceId?: string): any {
    return {
      eventType: EVENT_TYPE.NEW_DEVICE_REGISTRATION,
      deviceId: this.deviceId || fallbackDeviceId || process.env.DEVICE_ID,
      serial: snapshot.system?.serial,
      name: snapshot.hostname,
      model: snapshot.system?.model,
      uptime: snapshot.uptime * 1000, // Convert to milliseconds
      modelNumber: snapshot.system?.model,
      serialNo: snapshot.system?.serial,
      deviceType: DEVICE_TYPE,
    };
  }

  /**
   * Send telemetry data to IoT Hub (Device-to-Cloud)
   * Uses the internal TelemetryService from the edge-assembly package
   * 
   * @param topic - Topic/route identifier (included in telemetry data as 'topic' field)
   * @param data - Telemetry data to send (can be object or string)
   */
  async sendTelemetry(topic: string, data: any): Promise<void> {
    try {
      // Access the telemetryService through the plugin structure
      const edgeDeviceAny = this.ensureEdgeDeviceInitialized() as any;
      const telemetryService = edgeDeviceAny.plugin?.telemetryService;
      const adapter = edgeDeviceAny.plugin?.connectivityPlugin;

      // Ensure we are connected even if initialization flag hasn't been set yet
      if (!adapter || typeof adapter.isConnected !== 'function' || !adapter.isConnected()) {
        throw new Error('Not connected to Azure IoT Hub');
      }

      // Prepare telemetry payload
      const telemetryPayload = typeof data === 'string' ? { message: data } : { ...data };
      
      // Add topic and timestamp to payload
      telemetryPayload.topic = topic;
      if (!telemetryPayload.timestamp) {
        telemetryPayload.timestamp = new Date().toISOString();
      }

      // Prefer TelemetryService; fall back to adapter if needed
      if (telemetryService && typeof telemetryService.sendTelemetry === 'function') {
        await telemetryService.sendTelemetry(telemetryPayload);
      } else if (adapter && typeof adapter.sendTelemetry === 'function') {
        await adapter.sendTelemetry(telemetryPayload);
      } else {
        throw new Error('No telemetry sender available (TelemetryService and AzureAdapter missing)');
      }

      this.logger.log(`Telemetry sent successfully - Topic: ${topic}, Data: ${JSON.stringify(telemetryPayload)}`);
    } catch (error) {
      this.logger.error(`Failed to send telemetry: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Send a simple notification message to IoT Hub
   */
  async sendMessage(message: string, topic: string = 'general'): Promise<void> {
    return this.sendTelemetry(topic, { message, timestamp: new Date().toISOString() });
  }

  /**
   * Start sending periodic telemetry
   */
  startPeriodicTelemetry(intervalMs?: number) {
    const interval = intervalMs || parseInt(process.env.TELEMETRY_INTERVAL_MS || '30000', 10);

    if (this.telemetryInterval) {
      this.logger.warn('Periodic telemetry already running');
      return;
    }

    this.logger.log(`Starting periodic telemetry (every ${interval}ms)`);

    this.telemetryInterval = setInterval(async () => {
      try {
        const snapshot = await getHostDeviceSnapshot();
        const telemetryData = this.buildDeviceTelemetryPayload(snapshot);
        await this.sendTelemetry('deviceTelemetry', telemetryData);
      } catch (error) {
        this.logger.error('Error sending periodic telemetry:', error);
      }
    }, interval);
  }

  /**
   * Stop sending periodic telemetry
   */
  stopPeriodicTelemetry() {
    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
      this.logger.log('Stopped periodic telemetry');
    }
  }

  /**
   * Disconnect from IoT Hub gracefully
   */
  async disconnect() {
    if (this.isInitialized) {
      try {
        // Stop periodic telemetry
        this.stopPeriodicTelemetry();

        this.logger.log('Updating device status to offline...');
        await this.ensureEdgeDeviceInitialized().syncState({ status: 'offline' });

        this.logger.log('Disconnecting from IoT Hub...');
        await this.ensureEdgeDeviceInitialized().disconnect();
        this.logger.log('Disconnected from IoT Hub');

        this.isInitialized = false;
      } catch (error) {
        this.logger.error('Error during disconnect:', error);
      }
    }
  }

  /**
   * Get the underlying EdgeAssembly instance
   */
  getEdgeDevice(): EdgeAssembly {
    return this.ensureEdgeDeviceInitialized();
  }

  /**
   * Get the dynamically generated device ID
   */
  getDeviceId(): string | null {
    return this.deviceId;
  }

  /**
   * Check if EdgeAssembly is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Update device twin with custom properties
   */
  async updateTwin(properties: Record<string, any>): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('EdgeAssembly not initialized');
    }

    await this.ensureEdgeDeviceInitialized().syncState(properties);
    this.logger.log('Device twin updated with custom properties');
  }

  /**
   * Check connection status
   */
  async checkConnection(): Promise<boolean> {
    if (!this.isInitialized) {
      return false;
    }

    return await this.ensureEdgeDeviceInitialized().ping();
  }
}

