import {
  Injectable,
  OnModuleInit,
  Inject,
  LoggerService,
} from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { formatDeviceId } from '../utils/device-id';
import { getHostDeviceSnapshot } from '../utils/device-info';
import { getUDIClient } from '../utils/udi/udi-client';
import { parseBoolean } from '../utils/config-parsers';
import * as path from 'path';
import * as fs from 'fs';
import { EnrollmentService } from '../provisioning/enrollment.service';
import { autoProvisionIfNeeded, resolveFilePath } from '../provisioning/provisioning.utils';
import { DpsProvisioningService, DpsProvisioningResult } from '../provisioning/dps-provisioning.service';
import { IoTHubConnectionService } from '../provisioning/iot-hub-connection.service';

interface DeviceConfigurationContext {
  deviceId: string;
  model: string;
  serial: string;
  snapshot: any;
  certFile: string;
  chainFile?: string;
}

@Injectable()
export class EdgeAssemblyService implements OnModuleInit {
  private isInitialized = false;
  private deviceId: string | null = null;
  private assignedHub: string | null = null;

  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    private readonly enrollmentService: EnrollmentService,
    private readonly dpsProvisioningService: DpsProvisioningService,
    private readonly iotHubConnectionService: IoTHubConnectionService
  ) {}

  async onModuleInit() {
    // Intentionally left blank to delay initialization until after app start
  }

  /**
   * Prepare device-specific configuration dynamically
   */
  private async prepareDeviceConfiguration(): Promise<DeviceConfigurationContext> {
    let model: string;
    let serial: string;
    let snapshot: any;

    try {
      this.logger.log('Attempting to get device information from UDI framework...');
      
      const udiClient = getUDIClient();
      const udiInfo = await udiClient.getSystemInfo();
      const methodUsed = udiClient.getLastMethod();
      
      model = udiInfo.model || 'MODEL';
      serial = udiInfo.serial || 'SERIAL';
      
      this.logger.log(
        `UDI Framework Info (via ${methodUsed || 'unknown'}) - Model: ${model}, Serial: ${serial}, Name: ${udiInfo.name}`
      );
      
      snapshot = {
        hostname: udiInfo.name || 'UNKNOWN',
        system: {
          model: udiInfo.model,
          serial: udiInfo.serial,
          manufacturer: 'QSC',
        },
        uptime: 0,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to get device info from UDI framework: ${error instanceof Error ? error.message : String(error)}`
      );
      this.logger.warn('Falling back to system information...');
      
      snapshot = await getHostDeviceSnapshot();
      model = snapshot.system.model || 'MODEL';
      serial = snapshot.system.serial || snapshot.system.uuid || 'SERIAL';
    }

    // Generate device ID (must match certificate CN)
    this.deviceId = formatDeviceId('AIO', model, serial);
    this.logger.log(`Generated device ID: ${this.deviceId}`);

    const projectRoot = process.cwd();

    // Set default certificate paths
    if (!process.env.X509_CERT_FILE) {
      process.env.X509_CERT_FILE = path.join(projectRoot, 'certificates', 'device.pem');
    }

    if (!process.env.X509_CA_CHAIN_FILE) {
      process.env.X509_CA_CHAIN_FILE = path.join(projectRoot, 'certificates', 'device-fullchain.pem');
    }

    if (!process.env.CSR_OUTPUT_PATH) {
      process.env.CSR_OUTPUT_PATH = path.join(projectRoot, 'certificates', `csr-${this.deviceId}.req`);
    }

    // Run auto-provisioning (TPM key, CSR, enrollment, cert import)
    this.logger.log('Starting auto provisioning...');
    await autoProvisionIfNeeded({
      deviceId: this.deviceId,
      model,
      serial,
      projectRoot,
      logger: this.logger,
      enrollmentService: this.enrollmentService,
    });
    this.logger.log('Auto provisioning completed.');

    const certFile = resolveFilePath(process.env.X509_CERT_FILE!, projectRoot);
    const chainFile = process.env.X509_CA_CHAIN_FILE 
      ? resolveFilePath(process.env.X509_CA_CHAIN_FILE, projectRoot)
      : undefined;

    return {
      deviceId: this.deviceId,
      model,
      serial,
      snapshot,
      certFile,
      chainFile,
    };
  }

  /**
   * Initialize and connect to Azure IoT Hub via DPS
   * This method should be called from main.ts after the app starts listening
   */
  async initializeAfterAppStart() {
    if (this.isInitialized) {
      this.logger.warn('Already initialized');
      return;
    }

    try {
      // Step 1: Prepare device configuration and certificates
      const context = await this.prepareDeviceConfiguration();

      // Step 2: Provision with DPS to get assigned IoT Hub
      this.logger.log('========================================');
      this.logger.log(' Phase 1: DPS Provisioning');
      this.logger.log('========================================');

      const dpsConfig = this.dpsProvisioningService.buildConfigFromEnv(
        context.deviceId,
        context.certFile,
        context.chainFile
      );

      const dpsResult: DpsProvisioningResult = await this.dpsProvisioningService.provisionDevice(dpsConfig);
      
      this.assignedHub = dpsResult.assignedHub;
      this.logger.log(`Device assigned to IoT Hub: ${this.assignedHub}`);

      // Step 3: Connect to the assigned IoT Hub
      this.logger.log('========================================');
      this.logger.log(' Phase 2: IoT Hub Connection');
      this.logger.log('========================================');

      await this.iotHubConnectionService.connect({
        iotHubHostname: this.assignedHub,
        deviceId: context.deviceId,
        certFilePath: context.certFile,
        chainFilePath: context.chainFile,
      });

      this.isInitialized = true;

      this.logger.log('========================================');
      this.logger.log(' ✅ Device Fully Connected!');
      this.logger.log('========================================');
      this.logger.log(`  Device ID: ${this.deviceId}`);
      this.logger.log(`  IoT Hub: ${this.assignedHub}`);
      this.logger.log(`  Status: CONNECTED`);

    } catch (error) {
      this.logger.error('Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Send telemetry data to IoT Hub
   */
  async sendTelemetry(topic: string, data: Record<string, any>): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Not initialized - call initializeAfterAppStart first');
    }
    await this.iotHubConnectionService.sendTelemetry(topic, data);
  }

  /**
   * Disconnect from IoT Hub gracefully
   */
  async disconnect() {
    if (this.isInitialized) {
      try {
        this.logger.log('Disconnecting from IoT Hub...');
        await this.iotHubConnectionService.disconnect();
        this.isInitialized = false;
        this.logger.log('Disconnected from IoT Hub');
      } catch (error) {
        this.logger.error('Error during disconnect:', error);
      }
    }
  }

  /**
   * Get the dynamically generated device ID
   */
  getDeviceId(): string | null {
    return this.deviceId;
  }

  /**
   * Get the assigned IoT Hub hostname
   */
  getAssignedHub(): string | null {
    return this.assignedHub;
  }

  /**
   * Check if service is initialized and connected
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Check connection status
   */
  isConnected(): boolean {
    return this.iotHubConnectionService.isConnectedToHub();
  }

  /**
   * Get the IoT Hub client for advanced operations
   */
  getIoTHubClient() {
    return this.iotHubConnectionService.getClient();
  }

  /**
   * Get the device twin for advanced operations
   */
  getDeviceTwin() {
    return this.iotHubConnectionService.getTwin();
  }
}
