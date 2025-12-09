import { Injectable, Inject, LoggerService } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import * as fs from 'fs';
import * as path from 'path';

// Azure IoT Hub Device SDK
import { Client as IoTHubClient, Message, Twin } from 'azure-iot-device';
import { Mqtt as IoTHubMqtt } from 'azure-iot-device-mqtt';
import { X509AuthenticationProvider } from 'azure-iot-device';

export interface IoTHubConnectionConfig {
  /** IoT Hub hostname (e.g., your-hub.azure-devices.net) */
  iotHubHostname: string;
  /** Device ID (must match certificate CN) */
  deviceId: string;
  /** Path to device certificate PEM file */
  certFilePath: string;
  /** Path to certificate chain PEM file (optional) */
  chainFilePath?: string;
}

@Injectable()
export class IoTHubConnectionService {
  private client: IoTHubClient | null = null;
  private twin: Twin | null = null;
  private isConnected = false;

  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService
  ) {}

  /**
   * Connect to IoT Hub using X.509 certificate authentication (TPM-backed)
   */
  async connect(config: IoTHubConnectionConfig): Promise<void> {
    const { iotHubHostname, deviceId, certFilePath, chainFilePath } = config;

    this.logger.log('========================================');
    this.logger.log(' Connecting to IoT Hub (TPM-backed X.509)');
    this.logger.log('========================================');
    this.logger.log(`  IoT Hub: ${iotHubHostname}`);
    this.logger.log(`  Device ID: ${deviceId}`);
    this.logger.log(`  Certificate: ${certFilePath}`);

    // Validate and read certificate
    const certAbsPath = path.resolve(certFilePath);
    if (!fs.existsSync(certAbsPath)) {
      throw new Error(`Certificate file not found: ${certAbsPath}`);
    }

    let certPem = fs.readFileSync(certAbsPath, 'utf8');

    // Append chain if provided
    if (chainFilePath) {
      const chainAbsPath = path.resolve(chainFilePath);
      if (fs.existsSync(chainAbsPath)) {
        const chainPem = fs.readFileSync(chainAbsPath, 'utf8');
        certPem = certPem + '\n' + chainPem;
        this.logger.log('Certificate chain appended');
      }
    }

    // Create X509 authentication provider
    // For TPM-backed: key is empty, signing handled by Windows cert store
    const authProvider = X509AuthenticationProvider.fromX509Options(
      deviceId,
      iotHubHostname,
      {
        cert: certPem,
        key: '', // TPM-backed - signing via Windows cert store
      }
    );

    // Create IoT Hub client with MQTT transport
    this.client = IoTHubClient.fromAuthenticationProvider(authProvider, IoTHubMqtt);

    // Set up event handlers
    this.setupEventHandlers();

    // Open connection
    await this.client.open();
    this.isConnected = true;

    this.logger.log('========================================');
    this.logger.log(' Connected to IoT Hub Successfully!');
    this.logger.log('========================================');

    // Get device twin
    this.twin = await this.client.getTwin();
    this.logger.log('Device twin retrieved');
  }

  /**
   * Set up client event handlers
   */
  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on('connect', () => {
      this.logger.log('IoT Hub: Connected');
      this.isConnected = true;
    });

    this.client.on('disconnect', () => {
      this.logger.warn('IoT Hub: Disconnected');
      this.isConnected = false;
    });

    this.client.on('error', (err) => {
      this.logger.error(`IoT Hub Error: ${err.message}`);
    });

    this.client.on('message', (msg) => {
      this.logger.log(`Cloud-to-Device message received: ${msg.messageId}`);
      // Handle C2D messages here
      this.client?.complete(msg, (err) => {
        if (err) {
          this.logger.error(`Failed to complete message: ${err.message}`);
        }
      });
    });
  }

  /**
   * Send telemetry message to IoT Hub
   */
  async sendTelemetry(topic: string, data: Record<string, any>): Promise<void> {
    if (!this.client || !this.isConnected) {
      throw new Error('IoT Hub client not connected');
    }

    const payload = {
      ...data,
      topic,
      timestamp: new Date().toISOString(),
    };

    const message = new Message(JSON.stringify(payload));
    message.contentType = 'application/json';
    message.contentEncoding = 'utf-8';

    await this.client.sendEvent(message);
    this.logger.log(`Telemetry sent: ${topic}`);
  }

  /**
   * Check if connected to IoT Hub
   */
  isConnectedToHub(): boolean {
    return this.isConnected;
  }

  /**
   * Disconnect from IoT Hub
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.twin = null;
      this.isConnected = false;
      this.logger.log('Disconnected from IoT Hub');
    }
  }

  /**
   * Get the underlying IoT Hub client (for advanced use cases)
   */
  getClient(): IoTHubClient | null {
    return this.client;
  }

  /**
   * Get the device twin (for advanced use cases)
   */
  getTwin(): Twin | null {
    return this.twin;
  }
}
