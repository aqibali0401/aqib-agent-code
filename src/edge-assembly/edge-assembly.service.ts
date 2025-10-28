import {
  Injectable,
  OnModuleInit,
  Inject,
  LoggerService,
} from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { EdgeAssembly } from '@qsc/edge-assembly';
import { formatDeviceId } from '../utils/device-id';
import { getHostDeviceSnapshot } from '../utils/device-info';
import { DEVICE_TYPE, EVENT_TYPE } from '../constants/app.constants';

@Injectable()
export class EdgeAssemblyService implements OnModuleInit {
  private edgeDevice: EdgeAssembly;
  private isInitialized = false;
  private telemetryInterval: NodeJS.Timeout | null = null;

  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService
  ) {
    this.edgeDevice = new EdgeAssembly();
  }

  async onModuleInit() {
    // Intentionally left blank to delay initialization until after app start
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
      // Get device information from system
      const snapshot = await getHostDeviceSnapshot();
      const model = snapshot.system.model || 'MODEL';
      const serial = snapshot.system.serial || snapshot.system.uuid || 'SERIAL';

      // Generate device ID (must match certificate CN)
      const deviceId = formatDeviceId(DEVICE_TYPE, model, serial);
      this.logger.log(`Using device ID: ${deviceId}`);

      // Verify the DEVICE_ID in env matches the generated one
      const envDeviceId = process.env.DEVICE_ID;
      if (envDeviceId && envDeviceId !== deviceId) {
        this.logger.warn(
          `ENV DEVICE_ID (${envDeviceId}) differs from generated ID (${deviceId}). Using env value.`
        );
      } else {
        // Set DEVICE_ID environment variable for edge-assembly config
        process.env.DEVICE_ID = deviceId;
      }

      // Initialize EdgeAssembly
      this.logger.log('🚀 Initializing EdgeAssembly...');
      await this.edgeDevice.init();
      this.logger.log('✓ EdgeAssembly configuration loaded');

      // Pair device with IoT Hub via DPS
      this.logger.log('🔗 Pairing device with Azure IoT Hub via DPS...');
      await this.edgeDevice.pair();
      this.logger.log('✓ Device paired successfully');

      // Check pair status
      const pairStatus = await this.edgeDevice.getPairStatus();
      this.logger.log(`📋 Pair Status: ${pairStatus}`);

      // Connect to IoT Hub
      this.logger.log('🌐 Connecting to IoT Hub...');
      await this.edgeDevice.connect();
      this.logger.log('✓ Connected to IoT Hub');

      // Verify connection status
      const ctrlStatus = await this.edgeDevice.getCtrlStatus();
      this.logger.log(`🎮 Control Status: ${ctrlStatus}`);

      // Ping to verify connectivity
      const isConnected = await this.edgeDevice.ping();
      this.logger.log(
        `📡 Connection status: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'}`
      );

      // Sync initial device state (twin properties)
      await this.syncDeviceState(snapshot);

      // Register command handlers
      this.registerCommandHandlers();

      // Start periodic telemetry (optional - can be enabled/disabled via env)
      if (process.env.ENABLE_PERIODIC_TELEMETRY === 'true') {
        this.startPeriodicTelemetry();
      }

      this.isInitialized = true;
      this.logger.log('✅ EdgeAssembly fully initialized and connected');
    } catch (error) {
      this.logger.error('❌ Failed to initialize EdgeAssembly:', error);
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

      await this.edgeDevice.syncState(desiredProperties);
      this.logger.log('📤 Device twin updated successfully');
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
    // Reboot command handler
    this.edgeDevice.onRequest('reboot', async (requestId, data) => {
      this.logger.log(`🔄 Reboot command received [${requestId}]:`, data);

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
    this.edgeDevice.onRequest('upgrade', async (requestId, data) => {
      this.logger.log(`⬆️  Upgrade command received [${requestId}]:`, data);

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
    this.edgeDevice.onRequest('healthCheck', async (requestId, data) => {
      this.logger.log(`💊 Health check requested [${requestId}]`);

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

    this.logger.log('📥 Direct method handlers registered (reboot, upgrade, healthCheck)');
  }

  /**
   * Register cloud-to-device message handlers (one-way notifications)
   * 
   * NOTE: Cloud-to-Device messages are not yet supported in @qsc/edge-assembly v0.0.0-alpha.3
   * The package only supports Direct Methods (request-response pattern) via onRequest()
   * This functionality will be available in a future version of the package.
   */
  private registerMessageHandlers() {
    // TODO: Uncomment when onNotification is available in edge-assembly package
    // Generic message handler for all topics
    // this.edgeDevice.onNotification('*', (message: string) => {
    //   this.logger.log(`📨 Cloud-to-Device message received: ${message}`);

    //   try {
    //     // Try to parse as JSON
    //     const parsedMessage = JSON.parse(message);
    //     this.handleCloudMessage(parsedMessage);
    //   } catch (error) {
    //     // If not JSON, log as plain text
    //     this.logger.log(`📨 Plain text message: ${message}`);
    //   }
    // });

    this.logger.log('📨 Cloud-to-Device message handlers not yet supported in current edge-assembly version');
  }

  /**
   * Handle parsed cloud-to-device messages
   */
  private handleCloudMessage(message: any) {
    const { type, payload, timestamp } = message;

    this.logger.log(`📬 Message Type: ${type || 'unknown'}`);
    this.logger.log(`📬 Payload:`, payload);

    // Handle different message types
    switch (type) {
      case 'alert':
        this.logger.warn(`🚨 Alert received: ${payload.message}`);
        break;

      case 'config_update':
        this.logger.log(`⚙️  Configuration update: ${JSON.stringify(payload)}`);
        // Update your application configuration here
        break;

      case 'notification':
        this.logger.log(`🔔 Notification: ${payload.message}`);
        break;

      case 'command':
        this.logger.log(`📋 Command: ${payload.command}`);
        // Execute command logic here
        break;

      default:
        this.logger.log(`❓ Unknown message type: ${type || 'none'}`);
    }
  }

  /**
   * Send telemetry data to IoT Hub (Device-to-Cloud)
   * 
   * NOTE: Sending telemetry/messages is not yet supported in @qsc/edge-assembly v0.0.0-alpha.3
   * The package currently only supports receiving Direct Methods via onRequest()
   * This functionality will be available in a future version of the package.
   */
  async sendTelemetry(topic: string, data: any): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('EdgeAssembly not initialized');
    }

    try {
      const message = typeof data === 'string' ? data : JSON.stringify(data);
      // TODO: Uncomment when notify() method is available in edge-assembly package
      // await this.edgeDevice.notify(topic, message);
      this.logger.log(`📤 Telemetry NOT sent (feature not available yet) - Topic: ${topic}, Data: ${message}`);
      this.logger.warn('Telemetry sending is not yet supported in the current edge-assembly version');
    } catch (error) {
      this.logger.error('Failed to send telemetry:', error);
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

    this.logger.log(`📊 Starting periodic telemetry (every ${interval}ms)`);

    this.telemetryInterval = setInterval(async () => {
      try {
        const snapshot = await getHostDeviceSnapshot();

        const telemetryData = {
          deviceId: process.env.DEVICE_ID,
          timestamp: new Date().toISOString(),
          uptime: snapshot.uptime,
          hostname: snapshot.hostname,
          cpuLoad: Math.random() * 100, // Replace with actual CPU load if available
          memoryUsage: Math.random() * 100, // Replace with actual memory usage
          temperature: 20 + Math.random() * 15, // Replace with actual temperature
          status: 'running',
        };

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
      this.logger.log('📊 Stopped periodic telemetry');
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
        await this.edgeDevice.syncState({ status: 'offline' });

        this.logger.log('Disconnecting from IoT Hub...');
        await this.edgeDevice.disconnect();
        this.logger.log('✓ Disconnected from IoT Hub');

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
    return this.edgeDevice;
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

    await this.edgeDevice.syncState(properties);
    this.logger.log('Device twin updated with custom properties');
  }

  /**
   * Check connection status
   */
  async checkConnection(): Promise<boolean> {
    if (!this.isInitialized) {
      return false;
    }

    return await this.edgeDevice.ping();
  }
}

